import { useId } from 'react';
import {
  action,
  createLibrary,
  defineAction,
  defineComponent,
  useIsStreaming,
  useTriggerAction,
} from '@openuidev/react-lang';
import { z } from 'zod/v4';
import { AlertTriangle, CheckCircle2, Circle, ChevronRight } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const cardClass = 'w-full min-w-0 rounded-2xl border border-white/10 bg-[#0a0a0a] p-4 text-white';
const mutedClass = 'text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500';

const toneToText: Record<string, string> = {
  positive: 'text-emerald-400',
  negative: 'text-rose-400',
  neutral: 'text-zinc-300',
};

const toneToBg: Record<string, string> = {
  positive: 'bg-emerald-500/10',
  negative: 'bg-rose-500/10',
  neutral: 'bg-white/[0.06]',
};

const MetricCard = defineComponent({
  name: 'MetricCard',
  description: 'A single KPI or metric with a label, value and optional change/tone.',
  props: z.object({
    label: z.string().describe('Metric label, e.g. "Net P&L"'),
    value: z.string().describe('Formatted value, e.g. "$1,240.50", "62.4%", "1.8R"'),
    change: z.string().optional().describe('Optional change text, e.g. "+4.2% vs last week"'),
    tone: z.enum(['positive', 'negative', 'neutral']).optional().describe('Colour tone for the value'),
  }),
  component: ({ props }) => {
    const tone = props.tone || 'neutral';
    return (
      <div className={`${cardClass} flex items-center justify-between gap-3`}>
        <div className="min-w-0">
          <p className={`${mutedClass} truncate`}>{props.label}</p>
          <p className={`mt-1 truncate text-xl font-bold tracking-tight ${toneToText[tone]}`}>
            {props.value}
          </p>
        </div>
        {props.change ? (
          <span className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold ${toneToBg[tone]} ${toneToText[tone]}`}>
            {props.change}
          </span>
        ) : null}
      </div>
    );
  },
});

const EquityChart = defineComponent({
  name: 'EquityChart',
  description: 'An area chart of account equity over time. Points must be ordered oldest to newest.',
  props: z.object({
    points: z.array(z.object({
      date: z.string().describe('Date label, e.g. "2026-10-01"'),
      value: z.number().describe('Account equity value'),
    })).describe('Equity points from oldest to newest'),
  }),
  component: ({ props }) => {
    const rawId = useId();
    const gradientId = `jfx-equity-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const points = props.points || [];
    const first = points[0]?.value ?? 0;
    const last = points[points.length - 1]?.value ?? 0;
    const positive = last >= first;
    const stroke = positive ? '#34d399' : '#fb7185';
    const fill = positive ? '#10b981' : '#f43f5e';

    return (
      <div className={cardClass}>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <p className={mutedClass}>Equity curve</p>
          <span className={`text-[11px] font-semibold ${positive ? 'text-emerald-400' : 'text-rose-400'}`}>
            {positive ? 'Trending up' : 'Trending down'}
          </span>
        </div>
        {points.length < 2 ? (
          <p className="py-8 text-center text-xs text-zinc-500">Not enough equity points to draw a chart.</p>
        ) : (
          <div className="h-[200px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={fill} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={fill} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#71717a', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fill: '#71717a', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                  tickFormatter={(value: number) => (Math.abs(value) >= 1000 ? `${Math.round(value / 1000)}k` : String(Math.round(value)))}
                />
                <Tooltip
                  contentStyle={{ background: '#09090b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, fontSize: 12 }}
                  labelStyle={{ color: '#a1a1aa' }}
                  formatter={(value: number) => [value.toLocaleString(), 'Equity']}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={stroke}
                  strokeWidth={2}
                  fill={`url(#${gradientId})`}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    );
  },
});

const TradeTable = defineComponent({
  name: 'TradeTable',
  description: 'A compact table of trades. Use for best/worst trades, recent trades, or filtered trade lists.',
  props: z.object({
    rows: z.array(z.object({
      pair: z.string().describe('Instrument, e.g. "EURUSD"'),
      side: z.string().describe('Direction: Long/Short or Buy/Sell'),
      result: z.string().describe('Outcome, e.g. "Win", "Loss", "BE"'),
      r: z.union([z.number(), z.string()]).describe('R multiple, e.g. 2.4 or "+2.4R"'),
      date: z.string().describe('Trade date, e.g. "2026-10-14"'),
      tradeId: z.string().optional().describe('Journal trade id/ticket, enables opening the trade detail'),
    })).describe('Trade rows'),
  }),
  component: ({ props }) => {
    const triggerAction = useTriggerAction();
    const rows = props.rows || [];

    const openTrade = (tradeId?: string) => {
      if (!tradeId) return;
      void triggerAction('Open trade detail', undefined, {
        type: 'OpenTradeDetail',
        params: { tradeId },
      });
    };

    return (
      <div className={cardClass}>
        <p className={`${mutedClass} mb-3`}>Trades</p>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-zinc-500">No trades to show.</p>
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[440px] border-collapse text-left text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                  <th className="px-2 py-2 font-semibold">Pair</th>
                  <th className="px-2 py-2 font-semibold">Side</th>
                  <th className="px-2 py-2 font-semibold">Result</th>
                  <th className="px-2 py-2 text-right font-semibold">R</th>
                  <th className="px-2 py-2 text-right font-semibold">Date</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const isWin = /win|profit|target/i.test(row.result);
                  const isLoss = /loss|lose|stop/i.test(row.result);
                  return (
                    <tr
                      key={`${row.pair}-${row.date}-${index}`}
                      className="border-t border-white/[0.06] text-zinc-300"
                    >
                      <td className="px-2 py-2.5 font-semibold text-white">{row.pair}</td>
                      <td className="px-2 py-2.5 uppercase text-zinc-400">{row.side}</td>
                      <td className={`px-2 py-2.5 font-medium ${isWin ? 'text-emerald-400' : isLoss ? 'text-rose-400' : 'text-zinc-400'}`}>
                        {row.result}
                      </td>
                      <td className={`px-2 py-2.5 text-right font-mono ${isWin ? 'text-emerald-400' : isLoss ? 'text-rose-400' : 'text-zinc-300'}`}>
                        {typeof row.r === 'number' ? `${row.r > 0 ? '+' : ''}${row.r}R` : row.r}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right text-zinc-500">{row.date}</td>
                      <td className="px-2 py-2.5 text-right">
                        {row.tradeId ? (
                          <button
                            type="button"
                            onClick={() => openTrade(row.tradeId)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/10 hover:text-white"
                            aria-label={`Open trade ${row.pair} ${row.date}`}
                          >
                            <ChevronRight size={14} />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  },
});

const RuleViolationList = defineComponent({
  name: 'RuleViolationList',
  description: 'A list of broken trading rules with occurrence counts. Use for discipline/compliance reviews.',
  props: z.object({
    items: z.array(z.object({
      rule: z.string().describe('Rule or violation name'),
      count: z.number().describe('How many times it happened'),
      lastSeen: z.string().optional().describe('Last occurrence date'),
    })).describe('Rule violations'),
  }),
  component: ({ props }) => {
    const items = props.items || [];
    return (
      <div className={cardClass}>
        <p className={`${mutedClass} mb-3`}>Rule violations</p>
        {items.length === 0 ? (
          <div className="flex items-center gap-2 py-4 text-xs text-emerald-400">
            <CheckCircle2 size={16} /> No violations in this period.
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-white/[0.06]">
            {items.map((item, index) => (
              <li key={`${item.rule}-${index}`} className="flex items-center gap-3 py-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-400">
                  <AlertTriangle size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-zinc-200">{item.rule}</p>
                  {item.lastSeen ? (
                    <p className="mt-0.5 text-[10px] text-zinc-500">Last seen {item.lastSeen}</p>
                  ) : null}
                </div>
                <span className="shrink-0 rounded-md bg-rose-500/10 px-2 py-1 text-[11px] font-bold text-rose-400">
                  {item.count}×
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  },
});

const SessionBreakdown = defineComponent({
  name: 'SessionBreakdown',
  description: 'Win rate and trade count by trading session (London, New York, Asia, etc.).',
  props: z.object({
    rows: z.array(z.object({
      session: z.string().describe('Session name'),
      winRate: z.number().describe('Win rate percentage, 0-100'),
      trades: z.number().describe('Number of trades in the session'),
    })).describe('Session rows'),
  }),
  component: ({ props }) => {
    const rows = props.rows || [];
    return (
      <div className={cardClass}>
        <p className={`${mutedClass} mb-3`}>Sessions</p>
        {rows.length === 0 ? (
          <p className="py-4 text-center text-xs text-zinc-500">No session data.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map((row, index) => {
              const rate = Math.max(0, Math.min(100, row.winRate));
              return (
                <div key={`${row.session}-${index}`}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium text-zinc-200">{row.session}</span>
                    <span className="shrink-0 text-zinc-500">
                      <span className="font-semibold text-zinc-300">{rate.toFixed(0)}%</span> · {row.trades} trades
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
                    <div
                      className="h-full rounded-full bg-emerald-400"
                      style={{ width: `${rate}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  },
});

const ChecklistCard = defineComponent({
  name: 'ChecklistCard',
  description: 'A short pre-trade or review checklist with checked/unchecked items.',
  props: z.object({
    items: z.array(z.object({
      label: z.string().describe('Checklist item'),
      checked: z.boolean().optional().describe('Whether the item is complete'),
    })).describe('Checklist items'),
  }),
  component: ({ props }) => {
    const items = props.items || [];
    return (
      <div className={cardClass}>
        <p className={`${mutedClass} mb-3`}>Checklist</p>
        {items.length === 0 ? (
          <p className="py-4 text-center text-xs text-zinc-500">Empty checklist.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item, index) => (
              <li key={`${item.label}-${index}`} className="flex items-start gap-2 text-xs text-zinc-300">
                {item.checked ? (
                  <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-400" />
                ) : (
                  <Circle size={15} className="mt-0.5 shrink-0 text-zinc-600" />
                )}
                <span className={item.checked ? 'text-zinc-400 line-through' : ''}>{item.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  },
});

const ActionButtons = defineComponent({
  name: 'ActionButtons',
  description: 'Navigation shortcuts rendered as buttons. Buttons may only open existing app screens; they never place, close or edit trades.',
  props: z.object({
    buttons: z.array(z.object({
      label: z.string().describe('Button label'),
      action: action().describe('Navigation action, e.g. @OpenJournal()'),
    })).describe('Buttons'),
  }),
  component: ({ props }) => {
    const triggerAction = useTriggerAction();
    const isStreaming = useIsStreaming();
    const buttons = props.buttons || [];
    if (buttons.length === 0) return null;

    return (
      <div className="flex w-full min-w-0 flex-wrap gap-2">
        {buttons.map((button, index) => (
          <button
            key={`${button.label}-${index}`}
            type="button"
            disabled={isStreaming}
            onClick={() => void triggerAction(button.label, undefined, button.action)}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] font-semibold text-zinc-200 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {button.label}
            <ChevronRight size={13} />
          </button>
        ))}
      </div>
    );
  },
});

const Stack = defineComponent({
  name: 'Stack',
  description: 'Root vertical container. Pass the other components as its children, in display order.',
  props: z.object({
    children: z.array(z.union([
      MetricCard.ref,
      EquityChart.ref,
      TradeTable.ref,
      RuleViolationList.ref,
      SessionBreakdown.ref,
      ChecklistCard.ref,
      ActionButtons.ref,
    ])).describe('Components to display top to bottom'),
  }),
  component: ({ props, renderNode }) => (
    <div className="flex w-full min-w-0 flex-col gap-3">
      {renderNode(props.children)}
    </div>
  ),
});

export const openJournal = defineAction({
  name: 'OpenJournal',
  description: 'Navigate to the trade journal (history).',
  params: z.object({}),
});

export const openAnalytics = defineAction({
  name: 'OpenAnalytics',
  description: 'Navigate to analytics / weekly review.',
  params: z.object({}),
});

export const openLogTrade = defineAction({
  name: 'OpenLogTrade',
  description: 'Navigate to the log-trade form. It never submits or modifies a trade.',
  params: z.object({}),
});

export const openTradeDetail = defineAction({
  name: 'OpenTradeDetail',
  description: 'Open an existing trade in the app. Requires the trade id from the journal context.',
  params: z.object({
    tradeId: z.string(),
  }),
});

export const library = createLibrary({
  root: 'Stack',
  components: [
    MetricCard,
    EquityChart,
    TradeTable,
    RuleViolationList,
    SessionBreakdown,
    ChecklistCard,
    ActionButtons,
    Stack,
  ],
  actions: [openJournal, openAnalytics, openLogTrade, openTradeDetail],
});
