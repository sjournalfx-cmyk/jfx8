import { generateSystemPrompt, type LibrarySpec } from '@openuidev/lang-core';
// @ts-ignore - Vite handles JSON imports; tsc does not enable resolveJsonModule.
import specJson from './spec.json';

const LIBRARY_SPEC = specJson as unknown as LibrarySpec;

const RULES = [
  'When the user asks for performance stats, comparisons, trade lists, weekly reviews, session breakdowns, rule violations, checklists or next steps, answer with an OpenUI Lang program built from the components above.',
  'For greetings, short factual answers, single-sentence coaching, or when structured UI would not help, answer in plain Markdown and emit no OpenUI Lang.',
  'Prefer a pure OpenUI Lang program with no markdown fences and no surrounding prose. If you must add prose, put the complete program inside one ```openui-lang fenced block.',
  'Always emit the complete program, not a patch. Put root = Stack(...) first.',
  'Never invent trades, metrics, dates, pairs or rule names. Use only the journal context provided in this prompt. If data is unavailable, say so in plain text.',
  'ActionButtons may only navigate: @OpenJournal(), @OpenAnalytics(), @OpenLogTrade(), @OpenTradeDetail(tradeId). Never place, close, or modify a trade, and never imply that a button does.',
  'In Research mode you have no private journal data. Do not fabricate personal metrics; only use components when the response is fully supported by public/general information.',
  'Keep generated UI compact enough for a 360px-wide phone. Prefer short labels and at most 6 rows per component.',
];

let cachedPrompt: string | null = null;

/** The OpenUI Lang fragment appended to the existing JFX chat system prompts. */
export const getOpenUiSystemPrompt = (): string => {
  if (cachedPrompt) return cachedPrompt;

  cachedPrompt = generateSystemPrompt({
    library: LIBRARY_SPEC,
    promptOptions: {
      preamble: 'You can also answer with live interactive UI. The components below are rendered directly inside the JFX AI chat, so compose them instead of describing the same numbers in prose.',
      additionalRules: RULES,
      examples: [
        [
          'root = Stack([metrics, recent, actions])',
          'metrics = MetricCard("Net P&L", "+$1,240", "+4.2% this week", "positive")',
          'recent = TradeTable([{pair: "EURUSD", side: "Long", result: "Win", r: 2.4, date: "2026-10-14", tradeId: "abc123"}])',
          'actions = ActionButtons([{label: "Open journal", action: @OpenJournal()}])',
        ].join('\n'),
        [
          'root = Stack([summary, sessions, rules])',
          'summary = MetricCard("Win rate", "62.4%", "18 trades", "positive")',
          'sessions = SessionBreakdown([{session: "London", winRate: 68, trades: 9}, {session: "New York", winRate: 44, trades: 9}])',
          'rules = RuleViolationList([{rule: "Moved stop loss", count: 3, lastSeen: "2026-10-16"}])',
        ].join('\n'),
      ],
    },
  });

  return cachedPrompt;
};
