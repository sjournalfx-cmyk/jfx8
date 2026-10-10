import type { ChecklistTemplate, ChecklistTemplateItem, ChecklistPhase, Trade } from '../types';

// --- Phase metadata ---
export const CHECKLIST_PHASES: { id: ChecklistPhase; label: string; hint: string }[] = [
  { id: 'pre-entry', label: 'Pre-Entry Checks', hint: 'Verification before opening' },
  { id: 'in-trade', label: 'In-Trade Management', hint: 'Execution steps' },
  { id: 'post-trade', label: 'Post-Trade Review', hint: 'Reflection questions' },
];

export const phaseLabel = (phase: ChecklistPhase): string =>
  CHECKLIST_PHASES.find((p) => p.id === phase)?.label ?? phase;

// --- Canonical behavior tags ---
export const POSITIVE_TAGS = ['Flawless Execution', 'Patient Entry', 'Let Winner Run'] as const;
export const VIOLATION_TAGS = [
  'Revenge Trade',
  'Moved Stop Loss',
  'FOMO / Early Entry',
  'Over-leveraged',
] as const;

export const isViolationTag = (tag: string): boolean =>
  (VIOLATION_TAGS as readonly string[]).includes(tag);

// --- Seed template (remapped from the legacy DEFAULT_CHECKLIST + strategy examples) ---
export const DEFAULT_TEMPLATE_SEED: Omit<ChecklistTemplate, 'id' | 'createdAt' | 'updatedAt'> = {
  name: 'Default Strategy',
  isActive: true,
  items: [
    { id: 'seed-trend', text: 'Setup aligned with HTF trend?', phase: 'pre-entry' },
    { id: 'seed-levels', text: '15m candle closed above/below the level?', phase: 'pre-entry' },
    { id: 'seed-rr', text: 'Risk-to-Reward ≥ 1:2?', phase: 'pre-entry' },
    { id: 'seed-news', text: 'No high-impact news within 30 min?', phase: 'pre-entry' },
    { id: 'seed-sl', text: 'Stop loss placed immediately?', phase: 'in-trade' },
    { id: 'seed-risk', text: 'Risked ≤ 1% of account?', phase: 'in-trade' },
    { id: 'seed-exit', text: 'Did I follow my exit plan?', phase: 'post-trade' },
    { id: 'seed-tamper', text: 'No FOMO or impulse to tamper with the trade?', phase: 'post-trade' },
    { id: 'seed-mental', text: 'Emotionally calm & focused?', phase: 'post-trade' },
  ],
};

export const newTemplateId = (): string =>
  `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const newItemId = (): string =>
  `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// --- Grading (locked bands) ---
export type ExecutionGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export const COMPLIANT_THRESHOLD = 80; // ≥80% (A & B) counts as rule-compliant

export const computeAdherence = (
  checks: Record<string, boolean> | undefined,
  items: Pick<ChecklistTemplateItem, 'id'>[],
): number | null => {
  if (!items.length) return null;
  const checked = items.filter((item) => checks?.[item.id] === true).length;
  return Math.round((checked / items.length) * 100);
};

export const gradeFor = (rate: number): ExecutionGrade => {
  if (rate >= 100) return 'A';
  if (rate >= 80) return 'B';
  if (rate >= 70) return 'C';
  if (rate >= 60) return 'D';
  return 'F';
};

export type PlanAdherence = 'Followed Exactly' | 'Minor Deviation' | 'Major Deviation' | 'No Plan';

export const derivePlanAdherence = (rate: number): Exclude<PlanAdherence, 'No Plan'> => {
  if (rate >= 100) return 'Followed Exactly';
  if (rate >= 70) return 'Minor Deviation';
  return 'Major Deviation';
};

const GRADE_TO_GPA: Record<ExecutionGrade, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };

export const averageExecutionGrade = (grades: ExecutionGrade[]): string | null => {
  if (!grades.length) return null;
  const avg = grades.reduce((sum, g) => sum + GRADE_TO_GPA[g], 0) / grades.length;
  if (avg >= 3.85) return 'A';
  if (avg >= 3.5) return 'A-';
  if (avg >= 3.15) return 'B+';
  if (avg >= 2.85) return 'B';
  if (avg >= 2.5) return 'B-';
  if (avg >= 2.15) return 'C+';
  if (avg >= 1.85) return 'C';
  if (avg >= 1.5) return 'C-';
  if (avg >= 1.15) return 'D+';
  if (avg >= 0.85) return 'D';
  if (avg >= 0.5) return 'D-';
  return 'F';
};

// --- Trade helpers ---
const safePnL = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

export const tradePnl = (t: Trade): number => safePnL(t.pnl);

export const isCompletedTrade = (t: Trade): boolean => t.result !== 'Pending';

export const isWinningTrade = (t: Trade): boolean => t.result === 'Win';

const tradeRate = (t: Trade): number | null =>
  typeof t.adherenceRate === 'number' && Number.isFinite(t.adherenceRate) ? t.adherenceRate : null;

const tradeGrade = (t: Trade): ExecutionGrade | null => {
  if (t.executionGrade) return t.executionGrade;
  const rate = tradeRate(t);
  return rate === null ? null : gradeFor(rate);
};

export const isCompliantTrade = (t: Trade): boolean => {
  const rate = tradeRate(t);
  return rate !== null && rate >= COMPLIANT_THRESHOLD;
};

/** Trades that carry a discipline snapshot (graded by the engine). */
export const snapshotTrades = (trades: Trade[]): Trade[] =>
  trades.filter((t) => isCompletedTrade(t) && tradeRate(t) !== null);

// --- KPI selectors ---
export const overallComplianceRate = (trades: Trade[]): number | null => {
  const snaps = snapshotTrades(trades);
  if (!snaps.length) return null;
  const total = snaps.reduce((sum, t) => sum + (tradeRate(t) ?? 0), 0);
  return Math.round((total / snaps.length) * 10) / 10;
};

export const disciplinePnlImpact = (
  trades: Trade[],
): { compliantPnl: number; nonCompliantPnl: number; compliantCount: number; nonCompliantCount: number } => {
  const snaps = snapshotTrades(trades);
  let compliantPnl = 0;
  let nonCompliantPnl = 0;
  let compliantCount = 0;
  let nonCompliantCount = 0;
  for (const t of snaps) {
    if (isCompliantTrade(t)) {
      compliantPnl += tradePnl(t);
      compliantCount += 1;
    } else {
      nonCompliantPnl += tradePnl(t);
      nonCompliantCount += 1;
    }
  }
  return {
    compliantPnl: Math.round(compliantPnl * 100) / 100,
    nonCompliantPnl: Math.round(nonCompliantPnl * 100) / 100,
    compliantCount,
    nonCompliantCount,
  };
};

export const topViolation = (trades: Trade[]): { tag: string; count: number } | null => {
  const counts = new Map<string, number>();
  for (const t of trades) {
    for (const tag of t.behaviorTags ?? []) {
      if (isViolationTag(tag)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  let best: { tag: string; count: number } | null = null;
  for (const [tag, count] of counts) {
    if (!best || count > best.count) best = { tag, count };
  }
  return best;
};

// --- Win Rate by Execution Grade ---
export interface GradeBucketStats {
  grade: string;
  count: number;
  wins: number;
  winRate: number | null;
  netPnl: number;
}

export const winRateByGrade = (trades: Trade[]): GradeBucketStats[] => {
  const buckets: { grade: string; match: (g: ExecutionGrade) => boolean }[] = [
    { grade: 'A', match: (g) => g === 'A' },
    { grade: 'B', match: (g) => g === 'B' },
    { grade: 'C–D', match: (g) => g === 'C' || g === 'D' },
    { grade: 'F', match: (g) => g === 'F' },
  ];
  return buckets.map(({ grade, match }) => {
    const inBucket = snapshotTrades(trades).filter((t) => {
      const g = tradeGrade(t);
      return g !== null && match(g);
    });
    const completed = inBucket.filter(isCompletedTrade);
    const wins = completed.filter(isWinningTrade).length;
    return {
      grade,
      count: completed.length,
      wins,
      winRate: completed.length ? Math.round((wins / completed.length) * 1000) / 10 : null,
      netPnl: Math.round(completed.reduce((sum, t) => sum + tradePnl(t), 0) * 100) / 100,
    };
  });
};

// --- Dual equity curve: compliant vs non-compliant (cumulative, chronological) ---
export interface ComplianceEquityPoint {
  date: string;
  compliant: number;
  nonCompliant: number;
}

export const complianceEquityCurve = (trades: Trade[]): ComplianceEquityPoint[] => {
  const snaps = snapshotTrades(trades)
    .slice()
    .sort((a, b) => `${a.date}T${a.time || '00:00'}`.localeCompare(`${b.date}T${b.time || '00:00'}`));
  let compliant = 0;
  let nonCompliant = 0;
  return snaps.map((t) => {
    if (isCompliantTrade(t)) compliant += tradePnl(t);
    else nonCompliant += tradePnl(t);
    return {
      date: t.date,
      compliant: Math.round(compliant * 100) / 100,
      nonCompliant: Math.round(nonCompliant * 100) / 100,
    };
  });
};

// --- Discipline trend (weekly compliance % + cumulative PnL) ---
export interface DisciplineTrendPoint {
  week: string; // ISO week key YYYY-Www
  complianceRate: number | null;
  cumulativePnl: number;
}

const isoWeekKey = (dateStr: string): string => {
  const d = new Date(`${dateStr}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr.slice(0, 7);
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() - day + 3);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = (jan4.getUTCDay() + 6) % 7;
  const week1 = new Date(jan4);
  week1.setUTCDate(jan4.getUTCDate() - jan4Day);
  const week = Math.floor((thursday.getTime() - week1.getTime()) / (7 * 86400000)) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
};

export const disciplineTrend = (trades: Trade[]): DisciplineTrendPoint[] => {
  const snaps = snapshotTrades(trades)
    .slice()
    .sort((a, b) => `${a.date}T${a.time || '00:00'}`.localeCompare(`${b.date}T${b.time || '00:00'}`));
  const byWeek = new Map<string, Trade[]>();
  for (const t of snaps) {
    const key = isoWeekKey(t.date);
    const list = byWeek.get(key) ?? [];
    list.push(t);
    byWeek.set(key, list);
  }
  let cumulative = 0;
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, list]) => {
      cumulative += list.reduce((sum, t) => sum + tradePnl(t), 0);
      const avg = list.reduce((sum, t) => sum + (tradeRate(t) ?? 0), 0) / list.length;
      return {
        week,
        complianceRate: Math.round(avg * 10) / 10,
        cumulativePnl: Math.round(cumulative * 100) / 100,
      };
    });
};

// --- Cost of Mistakes (per violation tag) ---
export interface ViolationCost {
  tag: string;
  count: number;
  wins: number;
  winRate: number | null;
  totalPnl: number;
  avgPnl: number;
}

export const costOfViolations = (trades: Trade[]): ViolationCost[] => {
  const byTag = new Map<string, Trade[]>();
  for (const t of trades) {
    if (!isCompletedTrade(t)) continue;
    for (const tag of t.behaviorTags ?? []) {
      if (!isViolationTag(tag)) continue;
      const list = byTag.get(tag) ?? [];
      list.push(t);
      byTag.set(tag, list);
    }
  }
  return [...byTag.entries()]
    .map(([tag, list]) => {
      const total = list.reduce((sum, t) => sum + tradePnl(t), 0);
      const wins = list.filter(isWinningTrade).length;
      return {
        tag,
        count: list.length,
        wins,
        winRate: list.length ? Math.round((wins / list.length) * 1000) / 10 : null,
        totalPnl: Math.round(total * 100) / 100,
        avgPnl: Math.round((total / list.length) * 100) / 100,
      };
    })
    .sort((a, b) => a.totalPnl - b.totalPnl);
};

// --- Rule Leakage (per checklist item fail-rate, grouped by phase) ---
export interface RuleLeakage {
  itemId: string;
  text: string;
  phase: ChecklistPhase;
  failCount: number;
  tradeCount: number;
  failRate: number | null;
}

export const ruleLeakage = (trades: Trade[], template: ChecklistTemplate): RuleLeakage[] => {
  const snaps = snapshotTrades(trades).filter(
    (t) => !t.checklistTemplateId || t.checklistTemplateId === template.id,
  );
  return template.items.map((item) => {
    const applicable = snaps.filter((t) => t.checklistChecks && item.id in t.checklistChecks);
    const denominator = applicable.length ? applicable : snaps;
    const failCount = denominator.filter((t) => t.checklistChecks?.[item.id] !== true).length;
    return {
      itemId: item.id,
      text: item.text,
      phase: item.phase,
      failCount,
      tradeCount: denominator.length,
      failRate: denominator.length ? Math.round((failCount / denominator.length) * 1000) / 10 : null,
    };
  }).sort((a, b) => (b.failRate ?? -1) - (a.failRate ?? -1));
};
