import React, { useState } from 'react';
import { Activity, RefreshCw, ChevronDown } from 'lucide-react';
import { Portfolio } from '../types';
import { APP_CONSTANTS, PLAN_FEATURES, normalizePlan } from '../lib/constants';
import { dataService, getLastTradesLoadError } from '../services/dataService';
import { getSaveReceipt } from '../lib/saveReceipt';

interface DiagnosticsPanelProps {
  isDarkMode: boolean;
  userId?: string | null;
  plan?: string;
  tradesThisMonth?: number;
  tradesCount?: number;
  tradeCounts?: Record<string, number>;
  portfolios?: Portfolio[];
  activePortfolioId?: string | null;
  offlineQueueCount?: number;
}

/**
 * Self-serve "is my data missing?" panel. Reads live state + probes the
 * server directly (bypassing every filter), so a missing-trade report is
 * answerable from one screenshot — no Supabase dashboard needed.
 */
export const DiagnosticsPanel: React.FC<DiagnosticsPanelProps> = ({
  isDarkMode,
  userId,
  plan,
  tradesThisMonth = 0,
  tradesCount = 0,
  tradeCounts = {},
  portfolios = [],
  activePortfolioId = null,
  offlineQueueCount = 0,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isProbing, setIsProbing] = useState(false);
  const [probe, setProbe] = useState<{
    at: string;
    serverTotal: number;
    error: string | null;
    recent: Array<{ id: string; pair: string; date: string; portfolio: string }>;
  } | null>(null);

  const normalizedPlan = normalizePlan(plan);
  const limit = PLAN_FEATURES[normalizedPlan]?.maxTradesPerMonth ?? PLAN_FEATURES[APP_CONSTANTS.PLANS.FREE].maxTradesPerMonth;
  const receipt = getSaveReceipt();
  const loadError = getLastTradesLoadError();

  const runProbe = async () => {
    if (!userId || isProbing) return;
    setIsProbing(true);
    try {
      const rows = await dataService.getTrades(userId);
      const sorted = [...rows].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      const pidName = (pid?: string | null) =>
        portfolios.find(p => p.id === pid)?.name || (pid ? pid.slice(0, 8) : 'Default');
      setProbe({
        at: new Date().toISOString(),
        serverTotal: rows.length,
        error: null,
        recent: sorted.slice(0, 10).map(t => ({
          id: String(t.id).slice(0, 8),
          pair: t.pair || '?',
          date: t.date || '?',
          portfolio: pidName((t as { portfolio_id?: string }).portfolio_id),
        })),
      });
    } catch (e: any) {
      setProbe({
        at: new Date().toISOString(),
        serverTotal: -1,
        error: String(e?.message || e).slice(0, 220),
        recent: [],
      });
    } finally {
      setIsProbing(false);
    }
  };

  const row = 'flex items-center justify-between gap-3 py-1';
  const label = `text-[11px] font-bold ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`;
  const value = `text-[11px] font-black font-mono text-right ${isDarkMode ? 'text-white' : 'text-slate-900'}`;

  return (
    <section className={`rounded-3xl border p-3 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-white'}`}>
      <button onClick={() => setIsOpen(o => !o)} className="flex w-full items-center gap-2 text-left">
        <Activity size={14} className="text-[#FF4F01] shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-black leading-tight">Diagnostics</h3>
          <p className="text-[10px] opacity-50 leading-tight">Missing trades? Check here first.</p>
        </div>
        <ChevronDown size={15} className={`shrink-0 opacity-50 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="mt-2 space-y-0.5 border-t border-white/[0.06] pt-2">
          <div className={row}><span className={label}>Journal rows loaded</span><span className={value}>{tradesCount}</span></div>
          <div className={row}><span className={label}>Plan usage this month</span><span className={value}>{limit === Infinity ? `${tradesThisMonth} (unlimited)` : `${tradesThisMonth}/${limit}`}</span></div>
          <div className={row}><span className={label}>Offline queue</span><span className={value}>{offlineQueueCount} waiting</span></div>
          <div className={row}><span className={label}>Last save</span><span className={value}>{receipt ? `${receipt.kind} · ${receipt.detail}` : 'none yet'}</span></div>
          {receipt && <div className={row}><span className={label}>Last save at</span><span className={value}>{new Date(receipt.at).toLocaleString()}</span></div>}
          <div className={row}><span className={label}>Last History load</span><span className={value}>{loadError ? `ERROR: ${loadError}` : 'OK'}</span></div>

          {portfolios.length > 0 && (
            <div className="pt-1">
              <p className={label}>Rows per portfolio {activePortfolioId ? '(● = viewing)' : ''}</p>
              {portfolios.map(p => (
                <div key={p.id} className={row}>
                  <span className={label}>{p.id === activePortfolioId ? '● ' : ''}{p.name}</span>
                  <span className={value}>{tradeCounts[p.id] ?? 0}</span>
                </div>
              ))}
            </div>
          )}

          <div className="pt-1.5">
            <button
              onClick={() => { void runProbe(); }}
              disabled={!userId || isProbing}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-[#FF4F01] px-3 text-xs font-bold text-white disabled:opacity-50"
            >
              <RefreshCw size={14} className={isProbing ? 'animate-spin' : ''} />
              {isProbing ? 'Checking server…' : 'Check server now'}
            </button>
            {probe && (
              <div className="mt-2 space-y-1">
                <div className={row}><span className={label}>Server rows total</span><span className={value}>{probe.serverTotal >= 0 ? probe.serverTotal : 'failed'}</span></div>
                {probe.error && <p className="text-[11px] font-bold text-rose-400">Server check failed: {probe.error}</p>}
                {probe.serverTotal >= 0 && probe.serverTotal !== tradesCount && (
                  <p className="text-[11px] font-bold text-amber-400">
                    Server ({probe.serverTotal}) and app ({tradesCount}) disagree — screenshot this panel and report it.
                  </p>
                )}
                {probe.recent.map(r => (
                  <div key={r.id} className={row}>
                    <span className={label}>{r.date} · {r.pair} · {r.portfolio}</span>
                    <span className={value}>…{r.id}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
