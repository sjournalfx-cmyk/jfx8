const COMPONENT_NAMES = [
  'Stack',
  'MetricCard',
  'EquityChart',
  'TradeTable',
  'RuleViolationList',
  'SessionBreakdown',
  'ChecklistCard',
  'ActionButtons',
].join('|');

const COMPONENT_CALL_RE = new RegExp(
  `^\\s*(?:root\\s*=\\s*)?(?:${COMPONENT_NAMES})\\s*\\(`,
  'm',
);
const STATEMENT_RE = new RegExp(
  `^\\s*[A-Za-z_]\\w*\\s*=\\s*(?:${COMPONENT_NAMES})\\s*\\(`,
  'm',
);
const FENCE_OPEN_RE = /```(?:openui|openui-lang|jfx-ui)\s*\n/i;

export type GenerativeParts = {
  /** True when the whole message is the program (no prose before/after). */
  pure: boolean;
  before: string;
  code: string;
  after: string;
};

const hasProgram = (code: string) => COMPONENT_CALL_RE.test(code) || STATEMENT_RE.test(code);

/**
 * Split a model reply into optional prose and one OpenUI Lang program.
 * Supports both a pure program and a ```openui-lang fenced program (open or
 * closed, so it also works while the response is still streaming).
 */
export const extractGenerativeParts = (text: string): GenerativeParts | null => {
  if (!text) return null;

  const fence = FENCE_OPEN_RE.exec(text);
  if (fence) {
    const rest = text.slice(fence.index + fence[0].length);
    const closeIndex = rest.indexOf('```');
    const code = (closeIndex >= 0 ? rest.slice(0, closeIndex) : rest).trim();
    if (!hasProgram(code)) return null;
    const before = text.slice(0, fence.index).trim();
    const after = closeIndex >= 0 ? rest.slice(closeIndex + 3).trim() : '';
    return { pure: !before && !after, before, code, after };
  }

  const rootMatch = /^\s*root\s*=\s*\w+\s*\(/m.exec(text);
  if (rootMatch) {
    const code = text.slice(rootMatch.index).trim();
    if (hasProgram(code) && /^\s*root\s*=\s*(?:Stack)\s*\(/m.test(code)) {
      const before = text.slice(0, rootMatch.index).trim();
      return { pure: !before, before, code, after: '' };
    }
  }

  const statementMatch = STATEMENT_RE.exec(text);
  if (statementMatch) {
    const code = text.slice(statementMatch.index).trim();
    const before = text.slice(0, statementMatch.index).trim();
    return { pure: !before, before, code, after: '' };
  }

  return null;
};

export const isGenerativeReply = (text: string) => extractGenerativeParts(text) !== null;
