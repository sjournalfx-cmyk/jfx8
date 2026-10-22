import { describe, it, expect } from 'vitest';
import { extractGenerativeParts, isGenerativeReply } from './detect';

describe('extractGenerativeParts', () => {
  it('ignores plain markdown replies', () => {
    expect(extractGenerativeParts('Hi! Your win rate is **62%** this week.')).toBeNull();
    expect(isGenerativeReply('## Weekly review\n- 3 wins\n- 2 losses')).toBe(false);
  });

  it('detects a pure OpenUI program', () => {
    const code = 'root = Stack([m])\nm = MetricCard("Win rate", "62%")';
    const parts = extractGenerativeParts(code);
    expect(parts?.pure).toBe(true);
    expect(parts?.code).toContain('MetricCard');
  });

  it('splits prose and a fenced program, even while streaming', () => {
    const text = 'Here is your week:\n```openui-lang\nroot = Stack([m])\nm = MetricCard("Net P&L", "+$120")';
    const parts = extractGenerativeParts(text);
    expect(parts?.before).toBe('Here is your week:');
    expect(parts?.code.startsWith('root = Stack')).toBe(true);
    expect(parts?.pure).toBe(false);
  });

  it('does not treat unrelated code fences as UI', () => {
    expect(extractGenerativeParts('```js\nconst x = 1\n```')).toBeNull();
  });
});
