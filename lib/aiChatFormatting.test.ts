import { describe, expect, it } from 'vitest';

import { normalizeAssistantMarkdown, stripAssistantWidgetMarkup } from './aiChatFormatting';

describe('normalizeAssistantMarkdown', () => {
  it('preserves mermaid widget bodies and leaves surrounding prose intact', () => {
    const input = [
      'SUMMARY: keep it tight',
      '[WIDGET:MERMAID:FLOWCHART]',
      'graph TD',
      'A[START: Setup] --> B[Risk Check]',
      '[/WIDGET:MERMAID]',
    ].join('\n');

    const output = normalizeAssistantMarkdown(input);

    expect(output).toContain('SUMMARY: keep it tight');
    expect(output).toContain('[WIDGET:MERMAID:FLOWCHART]\ngraph TD\nA[START: Setup] --> B[Risk Check]\n[/WIDGET:MERMAID]');
    expect(output).not.toContain('__JFX_WIDGET_');
  });

  it('does not append or balance markdown delimiters on plain prose', () => {
    const input = 'Your biggest mistake is overtrading without a plan and drifting into inconsistent risk.';

    expect(normalizeAssistantMarkdown(input)).toBe(input);
  });

  it('removes checklist widget wrappers while preserving useful checklist text', () => {
    const input = [
      'Use this before every trade:',
      '[WIDGET:CHECKLIST:Pre-Trade Plan]',
      '- Write the entry reason',
      '- Define stop loss and take profit',
      '[/WIDGET:CHECKLIST]',
    ].join('\n');

    const output = stripAssistantWidgetMarkup(input);

    expect(output).toContain('Use this before every trade:');
    expect(output).toContain('- Write the entry reason');
    expect(output).toContain('- Define stop loss and take profit');
    expect(output).not.toContain('[WIDGET:');
    expect(output).not.toContain('[/WIDGET');
  });

  it('removes unfinished widget openings so malformed mentor output stays readable', () => {
    const output = stripAssistantWidgetMarkup('Use a [WIDGET:CHECKLIST:Pre-Trade Plan] before entry.');

    expect(output).toBe('Use a before entry.');
  });
});
