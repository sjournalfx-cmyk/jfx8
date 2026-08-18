import { describe, expect, it } from 'vitest';
import { cleanAssistantResponse } from './thinkingCleaner';

describe('cleanAssistantResponse', () => {
  it('removes tagged reasoning blocks', () => {
    expect(cleanAssistantResponse('<think>private reasoning</think>Final answer.')).toBe('Final answer.');
  });

  it('suppresses an untagged reasoning response without a final-answer marker', () => {
    expect(cleanAssistantResponse("Here's a thinking process:\nAnalyze the user input..."))
      .toBe('');
  });

  it('keeps only the marked final answer after an untagged reasoning preamble', () => {
    expect(cleanAssistantResponse("Here's my reasoning:\nPrivate steps.\n\nFinal answer: Use an H1 bias."))
      .toBe('Use an H1 bias.');
  });
});
