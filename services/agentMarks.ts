import { supabase } from '../lib/supabase';
import type { Trade } from '../types';

// Agent trade provenance. The API bridge stamps every agent open/close into
// the agent_trade_marks table (service-role write); deal imports read the
// user's marks (RLS: select own) and tag matching trades with 'Agent' so the
// journal renders the robot badge. Pure matching helpers are exported for
// tests; the supabase fetch is fail-open (no marks → no tag, badge never
// blocks journaling).

export const AGENT_TAG = 'Agent';

// Marks older than this are ignored — a deal imported months later than its
// broker execution is almost never an agent trade.
const MARKS_LOOKBACK_MS = 14 * 24 * 3600 * 1000;

// Fallback window for marks that carry no ids (open orders whose broker
// response echoed no orderId): match by symbol + execution timestamp proximity.
const TIME_WINDOW_MS = 90 * 1000;

const CACHE_TTL_MS = 60 * 1000;

export interface AgentMarkRow {
  order_id: string | null;
  position_id: string | null;
  deal_id: string | null;
  symbol: string | null;
  created_at: string;
  action?: string;
}

export interface AgentMarkIndex {
  orderIds: Set<string>;
  positionIds: Set<string>;
  dealIds: Set<string>;
  openEvents: { symbol: string; atMs: number }[];
  closeEvents: { symbol: string; atMs: number }[];
}

export const buildAgentMarkIndex = (rows: AgentMarkRow[]): AgentMarkIndex => {  const index: AgentMarkIndex = {
    orderIds: new Set(),
    positionIds: new Set(),
    dealIds: new Set(),
    openEvents: [],
    closeEvents: [],
  };
  (rows || []).forEach(row => {
    if (row.order_id) index.orderIds.add(String(row.order_id).trim());
    if (row.position_id) index.positionIds.add(String(row.position_id).trim());
    if (row.deal_id) index.dealIds.add(String(row.deal_id).trim());
    const atMs = Date.parse(String(row.created_at || ''));
    const symbol = String(row.symbol || '').toUpperCase();
    if (Number.isFinite(atMs) && symbol) {
      const slot = row.action === 'open' ? index.openEvents : index.closeEvents;
      slot.push({ symbol, atMs });
    }
  });
  return index;
};

const proximity = (events: { symbol: string; atMs: number }[], symbol: string, tsMs: number): boolean =>
  events.some(e => e.symbol === symbol && Math.abs(e.atMs - tsMs) <= TIME_WINDOW_MS);

const toIdString = (value: any): string => {
  if (value === undefined || value === null) return '';
  const num = Number(value);
  return Number.isFinite(num) && num !== 0 ? String(num) : String(value).trim();
};

export interface DealKeyFields {
  orderId?: number | string;
  positionId?: string;
  dealId?: number | string;
  symbol?: string;
  openTimestamp?: string;
  closeTimestamp?: string;
}

export const matchesAgentMark = (index: AgentMarkIndex | null, deal: DealKeyFields | null): boolean => {
  if (!index || !deal) return false;
  const dealId = toIdString(deal.dealId);
  const orderId = toIdString(deal.orderId);
  const positionId = String(deal.positionId || '').trim();
  if (orderId && index.orderIds.has(orderId)) return true;
  if (positionId && index.positionIds.has(positionId)) return true;
  if (dealId && index.dealIds.has(dealId)) return true;

  const symbol = String(deal.symbol || '').toUpperCase();
  if (!symbol) return false;
  const closeMs = deal.closeTimestamp ? Date.parse(deal.closeTimestamp) : NaN;
  const openMs = deal.openTimestamp ? Date.parse(deal.openTimestamp) : NaN;
  // Close marks and open marks both fire right around their execution, so a
  // broker close deals' openTimestamp (position opened by the agent earlier)
  // also falls into the open-event window.
  if (Number.isFinite(closeMs) && (proximity(index.closeEvents, symbol, closeMs) || proximity(index.openEvents, symbol, closeMs))) return true;
  if (Number.isFinite(openMs) && proximity(index.openEvents, symbol, openMs)) return true;
  return false;
};

let cache: { at: number; index: AgentMarkIndex } | null = null;
let inflight: Promise<AgentMarkIndex> | null = null;

export const resetAgentMarkCache = (): void => {
  cache = null;
  inflight = null;
};

const loadAgentMarkIndex = async (): Promise<AgentMarkIndex> => {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.index;
  if (!inflight) {
    inflight = (async () => {
      try {
        const since = new Date(Date.now() - MARKS_LOOKBACK_MS).toISOString();
        const { data, error } = await supabase
          .from('agent_trade_marks')
          .select('order_id, position_id, deal_id, symbol, action, created_at')
          .gte('created_at', since);
        if (!error) {
          const index = buildAgentMarkIndex((data || []) as AgentMarkRow[]);
          cache = { at: Date.now(), index };
          return index;
        }
      } catch {
        /* not signed in / table offline — badge lookup fails open */
      } finally {
        inflight = null;
      }
      const empty = buildAgentMarkIndex([]);
      cache = { at: Date.now(), index: empty };
      return empty;
    })();
  }
  return inflight;
};

/** Tags a deal-import journal row with 'Agent' when the API bridge stamped it. */
export const withAgentTag = async (trade: Trade, deal: DealKeyFields | null | undefined): Promise<Trade> => {
  if (!trade) return trade;
  try {
    const index = await loadAgentMarkIndex();
    if (matchesAgentMark(index, deal)) {
      const tags = trade.tags || [];
      return tags.includes(AGENT_TAG) ? trade : { ...trade, tags: [...tags, AGENT_TAG] };
    }
  } catch {
    /* fail open: journal the trade without the badge */
  }
  return trade;
};
