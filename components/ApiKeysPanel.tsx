import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot, Check, Copy, Download, KeyRound, Plus, RefreshCw, Terminal, Trash2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import ConfirmationModal from './ConfirmationModal';
import { describeApiError, formatRelativeTime, getApiKeyStatus } from '../lib/apiKeyUi';

type ApiKey = { id: string; name: string; key_prefix: string; scopes: string[]; last_used_at: string | null; expires_at: string | null; created_at: string; status: 'active' | 'revoked'; revoked_at: string | null };
type Scope = 'trades:read' | 'trades:write' | 'notes:read' | 'notes:write' | 'bridge:read' | 'me:read';
type CheckState = 'pass' | 'warn' | 'fail';
type CheckKey = 'journal' | 'trading' | 'candles';
type CheckResult = { state: CheckState; detail: string };
type TestChecks = Record<CheckKey, CheckResult>;

const CHECK_LABELS: Record<CheckKey, string> = {
  journal: 'Journal',
  trading: 'cTrader trading',
  candles: 'Live candles',
};

const checkBadge = (state: CheckState, isDarkMode: boolean) => {
  if (state === 'pass') return isDarkMode ? 'bg-emerald-500/15 text-emerald-300' : 'bg-emerald-100 text-emerald-700';
  if (state === 'warn') return isDarkMode ? 'bg-amber-500/15 text-amber-300' : 'bg-amber-100 text-amber-700';
  return isDarkMode ? 'bg-rose-500/15 text-rose-300' : 'bg-rose-100 text-rose-700';
};

const checkWord = (state: CheckState) => state === 'pass' ? 'Pass' : state === 'warn' ? 'Attention' : 'Fail';

const scopeGroups: Array<{ label: string; items: Array<{ value: Scope; label: string; desc?: string }> }> = [
  {
    label: 'Trades & cTrader',
    items: [
      { value: 'trades:read', label: 'Read trades & analytics', desc: 'Query journal trades, metrics & win rates' },
      { value: 'trades:write', label: 'Trade execution & write trades', desc: 'Open, close & modify cTrader positions and log journal entries' },
    ],
  },
  {
    label: 'Bridge & Positions',
    items: [
      { value: 'bridge:read', label: 'Read live positions & bridge', desc: 'Inspect open positions and sync health' },
    ],
  },
  {
    label: 'Notes',
    items: [
      { value: 'notes:read', label: 'Read notes', desc: 'Access journal notes and strategy logs' },
      { value: 'notes:write', label: 'Write notes', desc: 'Create and update playbook notes' },
    ],
  },
  {
    label: 'Self',
    items: [
      { value: 'me:read', label: 'Read profile & metadata', desc: 'View user profile and key information' },
    ],
  },
];

const formatDate = (value: string | null) => value ? new Date(value).toLocaleDateString() : 'Never';
const JFX_API_BASE = 'https://lwlikhjgwazyrahucatl.supabase.co/functions/v1/jfx-api';
// Use www directly — the apex host 307-redirects to www and some browsers strip
// auth headers on redirect, which surfaced as "Failed to fetch".
const JFX_CTRADER_TRADE_URL = 'https://www.jfxjournal.site/api/ctrader/trade';
const JFX_CTRADER_TRADE_URL_DEV = 'http://127.0.0.1:3000/api/ctrader/trade';
// Live OHLC trendbars for the user's own connected cTrader account. The
// canonical route is /api/ctrader/candles (vercel.json rewrites it internally
// to the trade function as ?action=candles because Hobby caps a deployment at
// 12 Serverless Functions). The alias is kept for old links.
// (The APK resolves this through apiUrl() from lib/capacitor; web has no native
// shell to prefix, so it uses the absolute URL — never import a static
// @capacitor/* specifier into this bundle.)
const JFX_CTRADER_CANDLES_URL = 'https://www.jfxjournal.site/api/ctrader/candles';
// Local Vite middleware only implements the trade alias.
const JFX_CTRADER_CANDLES_URL_DEV = JFX_CTRADER_TRADE_URL_DEV + '?action=candles';
const DEFAULT_SCOPES: Scope[] = ['trades:read', 'trades:write'];
const agentSkill = `---
name: jfx-journal
description: Use the JFX Journal and cTrader API to query journal data, analytics, bridge state, and execute live or demo cTrader trades (open, close, modify).
---

# JFX Journal & cTrader Agent Skill

The API key is stored in the \`JFX_KEY\` environment variable. Never reveal the key, include it in an answer, write it to source control, or put it in a URL.

Base URLs:
- Journal & Analytics API: ${JFX_API_BASE}
- cTrader Execution API: ${JFX_CTRADER_TRADE_URL} (local dev: ${JFX_CTRADER_TRADE_URL_DEV})
- cTrader Live Candles API: ${JFX_CTRADER_CANDLES_URL} (local dev alias: ${JFX_CTRADER_CANDLES_URL_DEV})

Environment (.env downloaded from the key screen):
\`\`\`
JFX_KEY=jfx_pat_...
JFX_BASE=${JFX_API_BASE}
JFX_CTRADER_TRADE_URL=${JFX_CTRADER_TRADE_URL}
JFX_CTRADER_CANDLES_URL=${JFX_CTRADER_CANDLES_URL}
\`\`\`

Auth headers (either works — do not mix a truncated key):
- \`X-API-Key: $JFX_KEY\` (preferred)
- \`Authorization: Bearer $JFX_KEY\`

Copy the FULL key (starts with \`jfx_pat_\`). Do not trim, wrap, or URL-encode it.

---

## 1. Journal & Analytics Requests

- Latest trade: \`GET /v1/trades?limit=1\`
- Recent trades: \`GET /v1/trades?limit=20\`
- Trade summary: \`GET /v1/analytics/summary\`
- Monthly summary: \`GET /v1/analytics/summary?from=YYYY-MM-DD&to=YYYY-MM-DD\`
- Notes: \`GET /v1/notes?limit=20\` — requires \`notes:read\` (\`notes:write\` implies read)
- Bridge health: \`GET /v1/bridge/status\` — requires \`bridge:read\`
- Open positions (MT5 bridge): \`GET /v1/positions\` — requires \`bridge:read\` or \`trades:read\`/\`trades:write\`
- Me: \`GET /v1/me\` — requires \`me:read\`

Scopes: \`trades:read\` for reads, \`trades:write\` for journal writes and cTrader execution (\`trades:write\` implies \`trades:read\`).

Quick test (requires \`trades:read\`):
\`\`\`bash
curl -sS -H "X-API-Key: $JFX_KEY" "$JFX_BASE/v1/trades?limit=1"
\`\`\`

---

## 2. cTrader Live Trading (Open, Close, Modify)

Endpoint: \`POST \${JFX_CTRADER_TRADE_URL:-${JFX_CTRADER_TRADE_URL}}\`
Auth: \`X-API-Key: $JFX_KEY\` (or \`Authorization: Bearer $JFX_KEY\`).
Header: \`Content-Type: application/json\` (required).
Scopes: trade execution requires \`trades:write\`. Reading positions/accounts requires \`trades:read\` (or \`trades:write\`).

### Multi-Account & Multi-Broker Guide
- **Default Account (Automatic)**: Omit \`ctidTraderAccountId\` to trade on the user's active default account automatically.
- **Specific Account**: Pass \`"ctidTraderAccountId": <id>\` to target a specific broker account.
- **Demo vs. Live**: Set \`"isDemo": true\` for Demo or \`"isDemo": false\` for Live. Defaults to Demo for safety.

### Discover Accounts & Portfolios (call this first)
Agents cannot guess which account or portfolio an order will hit. Always start with these two reads (both need only \`trades:read\`):
- \`{"action":"get_accounts"}\` — every cTrader account on demo+live with \`ctidTraderAccountId\`, \`isDemo\`, \`isDefault\`, and its bound \`portfolioId\`/\`portfolioName\` (\`null\` = unlinked, no portfolio rules apply).
- \`{"action":"get_portfolios"}\` — portfolios with linked cTrader account ids and lock summaries (which rules are active + thresholds).
- NOTE: the older \`get_accounts\` alias previously returned positions — it now returns the real account inventory. \`check_auth\`/\`auth_status\` still return positions.
- If you omit \`ctidTraderAccountId\`, the user's stored default account is used; responses always echo the \`accountId\` + \`isDemo\` actually used. \`isDemo\` defaults to true — explicitly set \`isDemo: false\` for live.
- Unknown account ids return \`400 unknown_account\` with \`suggestions\`, or a hint to flip \`isDemo\` when the account lives on the other host.

### Step 1: Healthcheck (Zero-Risk)
Verify the key and see the active account before trading:
\`\`\`bash
curl -sS -H "X-API-Key: $JFX_KEY" -H "Content-Type: application/json" \\
  -d '{"action":"check_auth"}' "\${JFX_CTRADER_TRADE_URL:-${JFX_CTRADER_TRADE_URL}}"
\`\`\`

### Step 2: List Accounts Across Brokers
\`\`\`bash
curl -sS -H "X-API-Key: $JFX_KEY" -H "Content-Type: application/json" \\
  -d '{"action":"get_accounts"}' "\${JFX_CTRADER_TRADE_URL:-${JFX_CTRADER_TRADE_URL}}"
\`\`\`

### Step 3: Get Open Positions
\`\`\`bash
curl -sS -H "X-API-Key: $JFX_KEY" -H "Content-Type: application/json" \\
  -d '{"action":"get_positions","isDemo":true}' "\${JFX_CTRADER_TRADE_URL:-${JFX_CTRADER_TRADE_URL}}"
\`\`\`

### Step 4: Open Market / Limit / Stop Order
Every \`open\` request from an API key MUST carry a fresh \`Idempotency-Key\` header (or \`idempotencyKey\` body field) — a UUID per order. Retrying the same request with the same key + identical params replays the stored result (\`deduplicated: true\`) instead of opening a second position. Same key + different params returns \`409 idempotency_conflict\`.
- \`symbol\` (\`pair\`, \`instrument\`): e.g. \`EURUSD\`, \`XAUUSD\` (broker suffixes auto-matched).
- \`volumeLots\` (or \`volume\`): standard lots (\`0.01\` = 1 micro lot).
- \`side\`: \`"buy"\` or \`"sell"\`.
\`\`\`json
{
  "action": "open",
  "symbol": "EURUSD",
  "side": "buy",
  "volumeLots": 0.01,
  "orderType": "market",
  "stopLoss": 1.0750,
  "takeProfit": 1.0950,
  "isDemo": true,
  "comment": "Opened by AI agent"
}
\`\`\`
Header: \`X-API-Key: $JFX_KEY\` + \`Idempotency-Key: <uuid-v4>\`
Symbol names resolve against the broker listing with exact match preferred (\`EURUSD\` never resolves to \`EURUSDm\` when \`EURUSD\` exists); unknown names return \`400\` with \`suggestions\`.

### Step 5: Close Position (Full or Partial)
\`\`\`json
{
  "action": "close",
  "positionId": 41352173,
  "volumeLots": 0.01,
  "isDemo": true
}
\`\`\`

### Step 6: Modify Position (SL & TP)
\`\`\`json
{
  "action": "modify_position",
  "positionId": 41352173,
  "stopLoss": 1.0760,
  "takeProfit": 1.0960,
  "isDemo": true
}
\`\`\`

### Modify / Cancel Pending Order
\`\`\`json
{
  "action": "modify_order",
  "orderId": 456789,
  "limitPrice": 1.0820,
  "stopLoss": 1.0760,
  "takeProfit": 1.0960,
  "isDemo": true
}
\`\`\`
\`\`\`json
{
  "action": "cancel_order",
  "orderId": 456789,
  "isDemo": true
}
\`\`\`

Only execute trading actions when explicitly requested or confirmed by the user.

## 2b. cTrader Live Candles (OHLC)

Endpoint: \`GET \${JFX_CTRADER_CANDLES_URL:-${JFX_CTRADER_CANDLES_URL}}?symbol=EURUSD&timeframe=H1&count=500\`
Header: \`X-API-Key: $JFX_KEY\` — requires \`trades:read\` (or \`trades:write\`).
Reads live trendbars from the user's own broker account (their cTrader must be connected), unlike the shared backtest store.

Query params: \`symbol\` (required, e.g. \`EURUSD\`), \`timeframe\` (default \`H1\`; \`M1 M5 M15 M30 H1 H4 D1 W1 MN1\`), \`count\` (default 500, max 5000), optional \`from\`/\`to\` (unix seconds or ms; values < 1e12 are treated as seconds), \`ctidTraderAccountId\`, \`isDemo\` (default true).
Response: \`{ ok, symbol, symbolId, timeframe, digits, accountId, isDemo, count, bars: [{ time, open, high, low, close }] }\` (\`time\` is unix seconds).

\`\`\`bash
curl -sS -H "X-API-Key: $JFX_KEY" \
  "\${JFX_CTRADER_CANDLES_URL:-${JFX_CTRADER_CANDLES_URL}}?symbol=EURUSD&timeframe=H1&count=5"
\`\`\`

## 3. Error Handling

- \`401 missing_api_key / malformed_token / invalid_token / expired_token\` — key missing, truncated, revoked, or expired. Ask the user to press **Test connection** in Settings → Developer Tools, then recreate the key if needed.
- \`403 insufficient_scope need trades:write\` — key lacks \`trades:write\`; ask user to recreate with trading scopes in Settings → Developer Tools
- \`403 locked_by_rule\` — the portfolio's trading locks blocked this order. The response names \`portfolioId\`/\`portfolioName\`/\`accountId\` and includes \`context\` (allowed pairs, daily limit + fills so far, or lot range) plus \`cooldownMsRemaining\` when a rule is cooling down; do not retry, tell the user which rule fired and what is allowed
- \`warnings\` on success — \`account_not_linked_to_portfolio\` (order executed with NO portfolio rules), \`locks_unchecked\` (locks unreachable, fail-open), \`multiple_portfolios_linked\` (account bound twice — first portfolio wins; ask user to fix linking in the app)
- \`400 idempotency_key_required\` — an \`open\` via API key needs a fresh \`Idempotency-Key\`; generate a UUID and send again
- \`409 idempotency_conflict\` — that key was already used for a different order; generate a fresh key for new orders
- \`400 unknown_account\` — the supplied \`ctidTraderAccountId\` does not exist; the response carries \`suggestions\` (or a hint to flip \`isDemo\` when the account lives on the other host)
- \`400 ctrader_not_connected\`: key valid but cTrader not linked; ask user to connect cTrader once on the **Connect cTrader** page
- \`502 ctrader_auth_failed\`: stored cTrader grant expired/revoked; ask user to reconnect cTrader on the **Connect cTrader** page, then retry
- \`429 rate_limited\` — too many requests; retry after \`Retry-After\` seconds. \`503 rate_limiter_unavailable\` means the server limiter is down — retry shortly, do not recreate the key.
- \`503 ctrader_refresh_in_progress\` — another request is rotating this account's cTrader token; retry after \`Retry-After\` (1s).
- \`503 server_not_configured / service_unavailable\` — backend is not configured or temporarily down; retry shortly and report it if it persists. Do not recreate the key.
- \`500 internal_error / auth_failed\` — unexpected server/auth failure. Retry once; if it persists, report the request id/time.
- \`404 not_found\` — wrong path or resource; check the base URL and query parameters.
`;

function TestCheckRows({ checks, isDarkMode }: { checks: TestChecks; isDarkMode: boolean }) {
  return (
    <div className="mt-2 space-y-1.5">
      {(Object.keys(CHECK_LABELS) as CheckKey[]).map(name => {
        const check = checks[name];
        return (
          <div key={name} className={`flex flex-col gap-1 rounded-xl px-3 py-2 text-[11px] sm:flex-row sm:items-start sm:gap-2 ${isDarkMode ? 'bg-white/[0.03]' : 'bg-white'}`}>
            <span className={`w-fit shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${checkBadge(check.state, isDarkMode)}`}>{checkWord(check.state)}</span>
            <span className="shrink-0 font-black">{CHECK_LABELS[name]}</span>
            <span className="min-w-0 opacity-70">{check.detail}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ApiKeysPanel({ isDarkMode }: { isDarkMode: boolean }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Scope[]>([...DEFAULT_SCOPES]);
  const [expiry, setExpiry] = useState('90');
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedGuide, setCopiedGuide] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testKeyInput, setTestKeyInput] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testChecks, setTestChecks] = useState<TestChecks | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<ApiKey | null>(null);

  const cardClass = isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-white';
  const inputClass = isDarkMode ? 'border-white/[0.1] bg-white/[0.04] text-white' : 'border-slate-200 bg-white text-slate-900';

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('list_api_keys');
    if (error) setError(error.message); else setKeys((data ?? []) as ApiKey[]);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const expiresAt = useMemo(() => {
    if (expiry === 'never') return null;
    const next = new Date(); next.setDate(next.getDate() + Number(expiry)); return next.toISOString();
  }, [expiry]);

  const create = async () => {
    setError(null);
    if (!name.trim() || !scopes.length) return setError('Enter a name and choose at least one scope.');
    const { data, error } = await supabase.rpc('generate_api_key', { p_name: name.trim(), p_scopes: scopes, p_expires_at: expiresAt });
    if (error) return setError(error.message);
    setRawKey(data?.raw_key ?? null); setCreating(false); setName(''); setScopes([...DEFAULT_SCOPES]); await load();
  };
  const confirmRevoke = async () => {
    const key = pendingRevoke;
    if (!key) return;
    setPendingRevoke(null);
    const { data, error } = await supabase.rpc('revoke_api_key', { p_key_id: key.id });
    if (error) return setError(error.message);
    if (!data) return setError('The key could not be revoked. It may already be inactive.');
    await load();
  };
  const toggleScope = (scope: Scope) => setScopes(previous => previous.includes(scope) ? previous.filter(item => item !== scope) : [...previous, scope]);
  const testConnection = async (candidate?: string) => {
    const keyToTest = (candidate ?? testKeyInput ?? '').trim() || rawKey || '';
    setTestChecks(null);
    setTestResult(null);
    if (!keyToTest) { setTestResult('Paste a key first (starts with jfx_pat_).'); return; }
    if (!/^jfx_pat_[a-z0-9]{8}_[A-Za-z0-9]{32}$/.test(keyToTest)) {
      setTestResult('That does not look like a full key — it should match jfx_pat_<8>_<32>. Copy the full value; do not truncate or add spaces.');
      return;
    }
    setTesting(true);
    const checks: TestChecks = {
      journal: { state: 'fail', detail: 'Not run.' },
      trading: { state: 'fail', detail: 'Not run.' },
      candles: { state: 'fail', detail: 'Not run.' },
    };
    const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const activeTradeUrl = isLocal ? JFX_CTRADER_TRADE_URL_DEV : JFX_CTRADER_TRADE_URL;
    const activeCandlesUrl = isLocal ? JFX_CTRADER_CANDLES_URL_DEV : JFX_CTRADER_CANDLES_URL;
    const headers = { 'X-API-Key': keyToTest };
    try {
      // 1) Journal API (Supabase Edge).
      const journalRes = await fetch(`${JFX_API_BASE}/v1/trades?limit=1`, { headers });
      const journalBody = await journalRes.json().catch(() => ({}));
      if (journalRes.ok) {
        checks.journal = { state: 'pass', detail: 'Key accepted; journal API reachable.' };
      } else {
        checks.journal = {
          state: 'fail',
          detail: `${journalRes.status} ${journalBody?.error || 'request_failed'} — ${describeApiError(journalBody?.error, journalRes.status)}`,
        };
      }

      // 2) cTrader trading route (check_auth never opens a position).
      const tradeRes = await fetch(activeTradeUrl, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check_auth', isDemo: true }),
      });
      const tradeBody = await tradeRes.json().catch(() => ({}));
      if (tradeRes.ok) {
        checks.trading = { state: 'pass', detail: `cTrader verified (Account #${tradeBody?.accountId || 'active'}).` };
      } else {
        const code = String(tradeBody?.error || 'request_failed');
        const warn = ['ctrader_not_connected', 'insufficient_scope', 'ctrader_auth_failed', 'ctrader_refresh_in_progress'].includes(code);
        checks.trading = {
          state: warn ? 'warn' : 'fail',
          detail: `${tradeRes.status} ${code} — ${describeApiError(code, tradeRes.status)}`,
        };
      }

      // 3) Live OHLC candles (canonical route). Read-only; proves broker data access.
      const candlesUrl = `${activeCandlesUrl}${activeCandlesUrl.includes('?') ? '&' : '?'}symbol=EURUSD&timeframe=H1&count=5`;
      const candlesRes = await fetch(candlesUrl, { headers });
      const candlesBody = await candlesRes.json().catch(() => ({}));
      if (candlesRes.ok) {
        const bars = candlesBody?.count ?? candlesBody?.bars?.length ?? 0;
        checks.candles = { state: 'pass', detail: `${bars} ${candlesBody?.symbol || 'EURUSD'} bars returned.` };
      } else {
        const code = String(candlesBody?.error || 'request_failed');
        const warn = ['ctrader_not_connected', 'insufficient_scope', 'ctrader_auth_failed', 'ctrader_refresh_in_progress'].includes(code);
        checks.candles = {
          state: warn ? 'warn' : 'fail',
          detail: `${candlesRes.status} ${code} — ${describeApiError(code, candlesRes.status)}`,
        };
      }
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e);
      const detail = /failed to fetch|networkerror|load failed|cors/i.test(raw)
        ? 'The browser blocked the request (CORS/network). The key may still be fine — verify with curl and check VPN/ad-blockers.'
        : raw;
      (Object.keys(checks) as CheckKey[]).forEach(name => {
        if (checks[name].detail === 'Not run.') checks[name] = { state: 'fail', detail };
      });
      setTestResult(`Network error while testing: ${detail}`);
    } finally {
      setTestChecks(checks);
      setTesting(false);
    }
  };
  const downloadEnv = () => {
    if (!rawKey) return;
    const content = `# JFX Journal Personal API Key (created ${new Date().toISOString()})\nJFX_KEY=${rawKey}\nJFX_BASE=${JFX_API_BASE}\nJFX_CTRADER_TRADE_URL=${JFX_CTRADER_TRADE_URL}\nJFX_CTRADER_CANDLES_URL=${JFX_CTRADER_CANDLES_URL}\n# Local dev override:\n# JFX_CTRADER_TRADE_URL=${JFX_CTRADER_TRADE_URL_DEV}\n# JFX_CTRADER_CANDLES_URL=${JFX_CTRADER_CANDLES_URL_DEV}\n`;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'jfx-journal.env'; link.click();
    URL.revokeObjectURL(url);
  };
  const downloadSkill = () => {
    const url = URL.createObjectURL(new Blob([agentSkill], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'SKILL.md'; link.click();
    URL.revokeObjectURL(url);
  };
  const copySkill = async () => {
    await navigator.clipboard.writeText(agentSkill);
    setCopiedGuide(true);
    window.setTimeout(() => setCopiedGuide(false), 2000);
  };
  const copyField = async (value: string, field: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(current => current === field ? null : current), 1800);
    } catch {
      setError('Clipboard access was blocked by the browser. Select and copy the value manually.');
    }
  };

  return <>
  <section className={`rounded-3xl border p-5 ${cardClass}`}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2"><KeyRound size={17} className="text-[#FF4F01]" /><h3 className="text-sm font-black">Personal API Keys</h3></div>
        <p className="mt-1 text-xs opacity-60">Connect Claude, Cursor, Codex, and trading bots to query your journal and execute cTrader trades.</p>
      </div>
      <button onClick={() => { setCreating(true); setError(null); }} className="flex items-center gap-2 rounded-xl bg-[#FF4F01] px-3 py-2 text-xs font-black text-white"><Plus size={15} /> Create key</button>
    </div>
    <section className={`mt-5 rounded-2xl border p-4 ${isDarkMode ? 'border-white/[0.08] bg-white/[0.02]' : 'border-slate-200 bg-slate-50'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-2.5"><div className="rounded-lg bg-[#FF4F01]/10 p-2 text-[#FF4F01]"><Bot size={16} /></div><div><p className="text-xs font-black">Connect an AI agent</p><p className="mt-0.5 text-[11px] opacity-60">Give Claude Code, Codex CLI, or Hermes the instructions once; they can review journal history and execute trades via cTrader.</p></div></div><div className="flex gap-2"><button onClick={() => void copySkill()} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-black ${inputClass}`}>{copiedGuide ? <Check size={13} /> : <Copy size={13} />}{copiedGuide ? 'Copied' : 'Copy instructions'}</button><button onClick={downloadSkill} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-black ${inputClass}`}><Download size={13} />SKILL.md</button></div></div>
      <div className="mt-3 grid gap-2 md:grid-cols-3"><div className="rounded-xl border border-dashed p-2.5 text-[10px] opacity-75"><p className="font-black">1. Choose scopes</p><p className="mt-1">Select <code>trades:read</code> for metrics and <code>trades:write</code> to let agents open/close trades.</p></div><div className="rounded-xl border border-dashed p-2.5 text-[10px] opacity-75"><p className="font-black">2. Save the secret</p><p className="mt-1">Download the <code>.env</code> file from the one-time key screen.</p></div><div className="rounded-xl border border-dashed p-2.5 text-[10px] opacity-75"><p className="font-black">3. Install the skill</p><p className="mt-1">Place <code>SKILL.md</code> in your agent’s skills folder, then restart it.</p></div></div>
      <div className={`mt-3 flex items-center gap-2 rounded-lg px-2.5 py-2 text-[10px] ${isDarkMode ? 'bg-black/30' : 'bg-white'}`}><Terminal size={13} className="text-[#FF4F01]" /><code className="break-all">curl -H "X-API-Key: $JFX_KEY" "{JFX_API_BASE}/v1/trades?limit=1"</code></div>
      <p className="mt-2 text-[10px] leading-relaxed opacity-60">Trading agents must send a fresh <code>Idempotency-Key</code> UUID on every <code>open</code> (replays are deduplicated, a reused key with different params returns <code>409 idempotency_conflict</code>), should discover accounts with <code>get_accounts</code> / <code>get_portfolios</code> before trading, and must not retry when a portfolio lock answers <code>locked_by_rule</code> — the payload names the portfolio, the rule context and any <code>cooldownMsRemaining</code>.</p>
    </section>
    {error && <p className="mt-4 rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-500">{error}</p>}
    <section className={`mt-4 rounded-2xl border p-4 ${isDarkMode ? 'border-white/[0.08] bg-white/[0.02]' : 'border-slate-200 bg-slate-50'}`}>
      <p className="text-xs font-black">Test a key before giving it to an agent</p>
      <p className="mt-0.5 text-[11px] opacity-60">Paste the full key (starts with <code>jfx_pat_</code>). This checks journal access, cTrader demo reachability and a live OHLC candles read without opening a trade. Your key never leaves your browser except to call your own API.</p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input value={testKeyInput} onChange={e => setTestKeyInput(e.target.value)} placeholder="jfx_pat_…" spellCheck={false} className={`flex-1 rounded-xl border px-3 py-2 font-mono text-xs outline-none ${inputClass}`} />
        <button onClick={() => void testConnection()} disabled={testing} className="flex items-center justify-center gap-2 rounded-xl bg-[#FF4F01] px-3 py-2 text-xs font-black text-white disabled:opacity-50"><RefreshCw size={14} className={testing ? 'animate-spin' : ''} />{testing ? 'Testing…' : 'Test connection'}</button>
      </div>
      {testResult && <p className={`mt-2 rounded-xl px-3 py-2 text-xs ${testResult.startsWith('OK') ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-500'}`}>{testResult}</p>}
      {testChecks && <TestCheckRows checks={testChecks} isDarkMode={isDarkMode} />}
    </section>
    <div className="mt-5 rounded-2xl border border-dashed">
      {loading ? <p className="p-4 text-xs opacity-50">Loading API keys…</p> : keys.length === 0 ? <p className="p-4 text-xs opacity-55">No API keys yet. Create a scoped key for an external tool.</p> : <div>
        <div className={`hidden grid-cols-[1.6fr_1fr_0.8fr_0.8fr_0.9fr_40px] gap-3 border-b px-4 py-2 text-[9px] font-black uppercase tracking-[0.14em] opacity-45 sm:grid ${isDarkMode ? 'border-white/[0.08]' : 'border-slate-200'}`}><span>Name / Key</span><span>Scopes</span><span>Created</span><span>Last Used</span><span>Status</span><span /></div>
        {keys.map(key => {
          const life = getApiKeyStatus(key);
          const prefixField = `prefix-${key.id}`;
          const idField = `id-${key.id}`;
          const toneClass = life.tone === 'success'
            ? 'bg-emerald-500/10 text-emerald-500'
            : life.tone === 'warning'
              ? 'bg-amber-500/10 text-amber-600'
              : 'bg-rose-500/10 text-rose-500';
          return <div key={`${key.status}-${key.id}`} className={`grid grid-cols-1 gap-2 px-4 py-3 text-xs sm:grid-cols-[1.6fr_1fr_0.8fr_0.8fr_0.9fr_40px] sm:items-center sm:gap-3 ${isDarkMode ? 'border-b border-white/[0.06] even:bg-white/[0.02]' : 'border-b border-slate-100 even:bg-slate-50'}`}>
            <div className="min-w-0">
              <p className="font-black">{key.name}</p>
              <div className="mt-0.5 flex min-w-0 items-center gap-1">
                <code className="truncate text-[10px] text-[#FF4F01]">{key.key_prefix}_••••••••</code>
                <button onClick={() => void copyField(key.key_prefix, prefixField)} title="Copy key prefix" className="shrink-0 rounded p-0.5 opacity-50 hover:opacity-100">
                  {copiedField === prefixField ? <Check size={11} /> : <Copy size={11} />}
                </button>
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-1 opacity-40">
                <code className="truncate text-[9px]">id {key.id.slice(0, 8)}…</code>
                <button onClick={() => void copyField(key.id, idField)} title="Copy full key id" className="shrink-0 rounded p-0.5 hover:opacity-100">
                  {copiedField === idField ? <Check size={10} /> : <Copy size={10} />}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1"><span className="mr-1 text-[9px] font-black uppercase tracking-wide opacity-40 sm:hidden">Scopes</span>{key.scopes.map(scope => <span key={scope} className="rounded-md bg-[#FF4F01]/10 px-1.5 py-0.5 text-[9px] font-bold text-[#FF4F01]">{scope}</span>)}</div>
            <span className="hidden opacity-60 sm:block">{formatDate(key.created_at)}</span>
            <span className="hidden opacity-60 sm:block">{formatRelativeTime(key.last_used_at)}</span>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`w-fit rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-wide ${toneClass}`}>{life.label}</span>
              <span className="text-[10px] opacity-45 sm:hidden">Created {formatDate(key.created_at)} · Last used {formatRelativeTime(key.last_used_at)}</span>
            </div>
            {key.status === 'active' ? <button onClick={() => setPendingRevoke(key)} title="Revoke key (retains audit metadata)" className="w-fit rounded-lg p-2 text-rose-500 hover:bg-rose-500/10"><Trash2 size={15} /></button> : <span className="hidden sm:block" />}
          </div>;
        })}
      </div>}
    </div>

    {creating && createPortal(<div className="api-key-modal-layer bg-black/80 backdrop-blur-sm p-4">
      <div className="api-key-modal-card border border-white/[0.1] bg-[#000000] p-6 text-white shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-white tracking-tight">Create Personal API Key</h3>
              <span className="rounded-full border border-[#FF4F01]/30 bg-[#FF4F01]/10 px-2 py-0.5 text-[10px] font-semibold text-[#FF4F01]">
                cTrader Ready
              </span>
            </div>
            <p className="mt-1 text-xs text-white/50">
              The secret will be shown once. Store it in a password manager or environment variable.
            </p>
          </div>
          <button
            onClick={() => setCreating(false)}
            className="rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-4">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-white/50">Name</label>
          <input
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder="e.g. Claude trade review & execution"
            className="mt-1.5 w-full rounded-xl border border-white/[0.1] bg-[#0a0a0a] px-3.5 py-2.5 text-xs text-white placeholder-white/25 outline-none transition-all focus:border-[#FF4F01]/70 focus:ring-1 focus:ring-[#FF4F01]/30"
          />
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-white/50">Permissions</label>
            <span className="text-[10px] text-white/40">{scopes.length} selected</span>
          </div>

          <div className="space-y-2.5 max-h-[260px] overflow-y-auto pr-1">
            {scopeGroups.map(group => (
              <div key={group.label} className="rounded-xl border border-white/[0.06] bg-[#080808] p-2.5">
                <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-white/40">{group.label}</p>
                <div className="space-y-1">
                  {group.items.map(item => {
                    const isChecked = scopes.includes(item.value);
                    return (
                      <label
                        key={item.value}
                        className={`flex items-start gap-2.5 rounded-lg p-1.5 text-xs cursor-pointer select-none transition-colors ${
                          isChecked ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 h-3.5 w-3.5 rounded border-white/20 accent-[#FF4F01]"
                          checked={isChecked}
                          onChange={() => toggleScope(item.value)}
                        />
                        <div className="flex-1">
                          <span className={`font-medium ${isChecked ? 'text-white' : 'text-white/70'}`}>
                            {item.label}
                          </span>
                          {item.desc && <p className="text-[10px] text-white/40 leading-tight mt-0.5">{item.desc}</p>}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {!scopes.includes('trades:write') ? (
          <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[11px] text-amber-300">
            <span className="font-bold">Read-only:</span> Without <code className="font-semibold text-white">trades:write</code> agents can only review journal metrics. Enable it above for buy/sell execution.
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2 text-[11px] text-emerald-300">
            <span className="font-bold">Trading enabled:</span> Agents with this key can open, close, and modify cTrader positions.
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          <label className="text-[11px] font-bold uppercase tracking-wider text-white/50">Expiry</label>
          <select
            value={expiry}
            onChange={event => setExpiry(event.target.value)}
            className="rounded-xl border border-white/[0.1] bg-[#0a0a0a] px-3 py-1.5 text-xs text-white outline-none focus:border-[#FF4F01]/60"
          >
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="180">180 days</option>
            <option value="365">365 days</option>
            <option value="never">Never expires</option>
          </select>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-white/[0.08] pt-3.5">
          <button
            onClick={() => setCreating(false)}
            className="rounded-xl px-3.5 py-2 text-xs font-semibold text-white/60 hover:bg-white/[0.05] hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void create()}
            className="rounded-xl bg-[#FF4F01] px-4 py-2 text-xs font-bold text-white transition-all hover:bg-[#FF4F01]/90 shadow-md shadow-[#FF4F01]/20"
          >
            Generate Key
          </button>
        </div>
      </div>
    </div>, document.body)}

    {rawKey && createPortal(<div className="api-key-modal-layer bg-black/80 backdrop-blur-sm p-4">
      <div className="api-key-modal-card border border-white/[0.1] bg-[#000000] p-6 text-white shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-bold text-white">Save your API key now</h3>
            <p className="mt-0.5 text-xs text-amber-400">For security, this secret cannot be shown again.</p>
          </div>
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
            One-time view
          </span>
        </div>

        <code className="mt-4 block break-all rounded-xl border border-white/[0.1] bg-[#0a0a0a] p-3 font-mono text-xs text-white/90 select-all">
          {rawKey}
        </code>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              navigator.clipboard.writeText(rawKey);
              setCopied(true);
              setCopiedKey(true);
              window.setTimeout(() => setCopiedKey(false), 2000);
            }}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-[#FF4F01] px-3 py-2 text-xs font-bold text-white hover:bg-[#FF4F01]/90 transition-all shadow-md shadow-[#FF4F01]/20"
          >
            {copiedKey ? <Check size={14} /> : <Copy size={14} />}
            {copiedKey ? 'Copied' : 'Copy Key'}
          </button>
          <button
            onClick={downloadEnv}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.1] bg-[#0a0a0a] px-3 py-2 text-xs font-semibold text-white hover:bg-white/[0.05] transition-all"
          >
            <Download size={14} />
            Download .env
          </button>
        </div>

        <button
          onClick={() => void testConnection(rawKey)}
          disabled={testing}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/[0.1] bg-[#0a0a0a] px-3 py-2 text-xs font-semibold text-white/80 hover:text-white hover:bg-white/[0.05] transition-all disabled:opacity-50"
        >
          <RefreshCw size={13} className={testing ? 'animate-spin' : ''} />
          {testing ? 'Testing…' : 'Test this key now'}
        </button>

        {testResult && (
          <p className="mt-2.5 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
            {testResult}
          </p>
        )}
        {testChecks && <TestCheckRows checks={testChecks} isDarkMode={isDarkMode} />}

        <div className="mt-4 flex items-center gap-2 text-xs text-white/70">
          <input
            type="checkbox"
            id="saved-securely"
            className="h-3.5 w-3.5 rounded border-white/20 accent-[#FF4F01]"
            checked={copied}
            onChange={event => setCopied(event.target.checked)}
          />
          <label htmlFor="saved-securely" className="cursor-pointer select-none">
            I have saved this key securely.
          </label>
        </div>

        <button
          disabled={!copied}
          onClick={() => { setRawKey(null); setCopied(false); setCopiedKey(false); setTestResult(null); setTestChecks(null); }}
          className="mt-4 w-full rounded-xl border border-white/[0.15] bg-white/[0.05] hover:bg-white/[0.1] px-3 py-2 text-xs font-bold text-white transition-all disabled:opacity-30"
        >
          Done
        </button>
      </div>
    </div>, document.body)}
  </section>
  <ConfirmationModal
    isOpen={pendingRevoke !== null}
    title="Revoke API key?"
    description={pendingRevoke ? `Revoke “${pendingRevoke.name}”? Agents using it lose access immediately. The key is disabled, not deleted — its row and audit metadata stay for your records. This cannot be undone.` : ''}
    confirmText="Revoke key"
    variant="danger"
    onConfirm={confirmRevoke}
    onCancel={() => setPendingRevoke(null)}
    isDarkMode={isDarkMode}
  />
  </>;
}
