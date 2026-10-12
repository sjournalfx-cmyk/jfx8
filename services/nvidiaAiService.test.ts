import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AiRequestError,
  MODAL_MODELS,
  NVIDIA_CHAT_MODEL_ID,
  NVIDIA_FALLBACK_MODEL_ID,
  buildAiRequestPayload,
  classifyAiError,
  describeAiError,
  getAssistantMode,
  modalResearchService,
} from './nvidiaAiService';
import type { Trade, UserProfile } from '../types';

vi.mock('../lib/supabase', () => ({
  getSessionToken: async () => 'test-token',
}));

const sampleTrade: Trade = {
  id: 'trade-1',
  ticketId: 'T-1001',
  pair: 'XAUUSD',
  assetType: 'Commodities',
  date: '2026-04-20',
  time: '09:30',
  session: 'London',
  direction: 'Long',
  entryPrice: 3200,
  exitPrice: 3215,
  stopLoss: 3190,
  takeProfit: 3230,
  lots: 1,
  result: 'Win',
  pnl: 150,
  rr: 1.5,
  rating: 4,
  tags: ['breakout'],
  notes: 'Private journal note',
  planAdherence: 'Followed Exactly',
  mindset: 'Confident',
};

const sampleProfile: UserProfile = {
  name: 'Ava Trader',
  country: 'ZA',
  accountName: 'Primary',
  initialBalance: 10000,
  currency: 'USD',
  currencySymbol: '$',
  syncMethod: 'Manual',
  experienceLevel: 'Intermediate',
  tradingStyle: 'Day Trader',
  onboarded: true,
  plan: 'pro',
  themePreference: 'obsidian',
  defaultRR: 2,
};

describe('nvidiaAiService payload builder', () => {
  it('keeps research mode free of private trading context', () => {
    const payload = buildAiRequestPayload({
      query: 'Research a London session breakout framework.',
      trades: [sampleTrade],
      userProfile: sampleProfile,
      history: Array.from({ length: 10 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
        content: `history-${index}`,
      })),
      modelType: 'deepseek',
    });

    const systemPrompt = payload.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n');

    expect(getAssistantMode('deepseek')).toBe('research');
    expect(payload.assistantMode).toBe('research');
    expect(payload.maxTokens).toBe(420);
    expect(payload.messages).toHaveLength(3);
    expect(payload.contextSummary).toMatchObject({
      mode: 'research',
      historyUsed: 0,
      privateDataAllowed: false,
    });
    expect(systemPrompt).toContain("do NOT have access to the user's trading journal");
    expect(systemPrompt).not.toContain('Ava Trader');
    expect(systemPrompt).not.toContain('XAUUSD');
    expect(systemPrompt).not.toContain('Private journal note');
  });

  it('injects the market data guidance into research mode', () => {
    const payload = buildAiRequestPayload({
      query: 'What is happening in the markets?',
      trades: [sampleTrade],
      userProfile: sampleProfile,
      modelType: 'deepseek',
    });

    const systemPrompt = payload.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n');

    expect(systemPrompt).toContain('MARKET DATA');
    expect(systemPrompt).toContain('FMP');
    expect(systemPrompt).toContain('Finnhub');
    expect(systemPrompt).toContain('Data Tools');
  });

  it('includes compact private context for mentor mode and caps history', () => {
    const payload = buildAiRequestPayload({
      query: 'Analyze my trading psychology based on my trade data.',
      trades: [sampleTrade],
      userProfile: sampleProfile,
      history: Array.from({ length: 12 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
        content: `history-${index}`,
      })),
      modelType: 'kimi',
    });

    const systemPrompt = payload.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n');

    expect(getAssistantMode('kimi')).toBe('mentor');
    expect(payload.assistantMode).toBe('mentor');
    expect(payload.maxTokens).toBe(900);
    expect(payload.messages).toHaveLength(8);
    expect(payload.contextSummary).toMatchObject({
      mode: 'mentor',
      historyUsed: 5,
      privateDataAllowed: true,
    });
    expect(systemPrompt).toContain('Ava');
    expect(systemPrompt).toContain('XAUUSD');
    expect(systemPrompt).toContain('"totalTrades": 1');
    expect(systemPrompt).toContain('"startingBalance": 10000');
    expect(payload.messages.at(-2)?.content).toBe('history-11');
    expect(payload.messages.at(-3)?.content).toBe('history-10');
  });

  it('sends full mentor context: trade notes, mechanics, compliance, notebook, goals, positions', () => {
    const mentorTrade: Trade = {
      ...sampleTrade,
      id: 'trade-2',
      exitComment: 'Scaled out too early at resistance',
      emotions: ['FOMO', 'Anxious'],
      setupName: 'London breakout',
      adherenceRate: 60,
      executionGrade: 'D',
      behaviorTags: ['FOMO / Early Entry', 'Moved Stop Loss'],
    };
    const payload = buildAiRequestPayload({
      query: 'Review my recent trading.',
      trades: [mentorTrade],
      userProfile: sampleProfile,
      history: [],
      modelType: 'kimi',
      extraContext: {
        notes: [
          {
            id: 'n1',
            title: 'Impatience reminder',
            content: '<p>Stop entering before the candle closes.</p>',
            date: '2026-09-20',
            tags: ['psychology'],
            color: 'yellow',
          },
        ],
        goals: [
          {
            id: 'g1',
            title: 'Make $2000 this month',
            type: 'Financial',
            metric: 'currency',
            targetValue: 2000,
            startValue: 0,
            startDate: '2026-09-01',
            endDate: '2026-09-30',
            milestones: [],
            status: 'active',
            createdAt: '2026-09-01',
          },
        ],
        openPositions: [
          { symbol: 'EURUSD', side: 'BUY', volume: 0.5, openPrice: 1.085, currentPrice: 1.09, profit: 25 },
        ],
      },
    });

    const systemPrompt = payload.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n');

    // Trade mechanics + notes
    expect(systemPrompt).toContain('Private journal note');
    expect(systemPrompt).toContain('Scaled out too early at resistance');
    expect(systemPrompt).toContain('"entry": 3200');
    expect(systemPrompt).toContain('"lots": 1');
    expect(systemPrompt).toContain('London breakout');
    // Per-trade compliance
    expect(systemPrompt).toContain('"grade": "D"');
    expect(systemPrompt).toContain('Moved Stop Loss');
    expect(systemPrompt).toContain('overallComplianceRate');
    // Notebook + goals + positions
    expect(systemPrompt).toContain('Impatience reminder');
    expect(systemPrompt).toContain('Stop entering before the candle closes');
    expect(systemPrompt).toContain('Make $2000 this month');
    expect(systemPrompt).toContain('EURUSD');
    // Grounding instructions
    expect(systemPrompt).toContain('GROUNDING');
  });

  it('keeps research mode free of mentor extras even when provided', () => {
    const payload = buildAiRequestPayload({
      query: 'Explain risk management.',
      trades: [sampleTrade],
      userProfile: sampleProfile,
      modelType: 'deepseek',
      extraContext: {
        notes: [
          {
            id: 'n1',
            title: 'Secret notebook title',
            content: 'Secret notebook content',
            date: '2026-09-20',
            tags: [],
            color: 'yellow',
          },
        ],
        goals: [],
      },
    });

    const systemPrompt = payload.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n');

    expect(payload.assistantMode).toBe('research');
    expect(systemPrompt).not.toContain('Secret notebook title');
    expect(systemPrompt).not.toContain('Secret notebook content');
    expect(systemPrompt).not.toContain('Private journal note');
  });
});

describe('nvidiaAiService fallback model', () => {
  it('configures a fallback model distinct from the primary', () => {
    expect(NVIDIA_FALLBACK_MODEL_ID).toBeTruthy();
    expect(NVIDIA_FALLBACK_MODEL_ID).not.toBe(NVIDIA_CHAT_MODEL_ID);
    expect(MODAL_MODELS.deepseek.fallbackId).toBe(NVIDIA_FALLBACK_MODEL_ID);
    expect(MODAL_MODELS.kimi.fallbackId).toBe(NVIDIA_FALLBACK_MODEL_ID);
  });

  it('classifies and describes errors without leaking internals', () => {
    expect(classifyAiError(new AiRequestError('x', 'auth'))).toBe('auth');
    expect(classifyAiError(new Error('Generation aborted'))).toBe('aborted');
    expect(classifyAiError(new Error('NVIDIA API timeout after 30000ms'))).toBe('timeout');
    expect(classifyAiError(new Error('NVIDIA API key is not configured on the server'))).toBe(
      'not-configured'
    );
    expect(classifyAiError(new Error('Rate limit exceeded. Please slow down'))).toBe('rate-limit');
    expect(classifyAiError(new Error('something totally new'))).toBe('unknown');

    const messages = [
      describeAiError(new AiRequestError('x', 'auth')),
      describeAiError(new AiRequestError('x', 'not-configured')),
      describeAiError(new AiRequestError('x', 'model-not-found')),
      describeAiError(new AiRequestError('x', 'rate-limit')),
      describeAiError(new AiRequestError('x', 'timeout')),
      describeAiError(new AiRequestError('x', 'network')),
      describeAiError(new AiRequestError('x', 'empty')),
      describeAiError(new AiRequestError('x', 'server')),
      describeAiError(new AiRequestError('x', 'unknown')),
    ];
    for (const message of messages) {
      expect(message).toBeTruthy();
      expect(message).not.toContain('nvapi-');
    }
    expect(new Set(messages).size).toBeGreaterThan(1);
  });
});

describe('nvidiaAiService generateResponseWithMeta', () => {
  const okResponse = (content: string) =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
    }) as unknown as Response;

  const errResponse = (status: number, body: string) =>
    ({
      ok: false,
      status,
      json: async () => {
        try {
          return JSON.parse(body);
        } catch {
          return {};
        }
      },
      text: async () => body,
    }) as unknown as Response;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const fetchMock = () => vi.mocked(fetch as unknown as (...args: any[]) => Promise<Response>);

  const modelOfCall = (callIndex: number) => {
    const init = fetchMock().mock.calls[callIndex]?.[1] as RequestInit | undefined;
    return JSON.parse(String(init?.body)).model as string;
  };

  it('returns the primary answer without fallback on success', async () => {
    fetchMock().mockResolvedValue(okResponse('Primary answer'));

    const result = await modalResearchService.generateResponseWithMeta(
      'Hello',
      [],
      null,
      [],
      null,
      false,
      [],
      'deepseek',
      false
    );

    expect(result.text).toBe('Primary answer');
    expect(result.fellBack).toBe(false);
    expect(result.modelId).toBe(NVIDIA_CHAT_MODEL_ID);
    expect(fetchMock()).toHaveBeenCalledTimes(1);
  });

  it('keeps the string-returning generateResponse working', async () => {
    fetchMock().mockResolvedValue(okResponse('Plain text'));

    const text = await modalResearchService.generateResponse('Hello', [], null);

    expect(text).toBe('Plain text');
  });

  it('automatically retries once on the fallback model when the primary is gone', async () => {
    fetchMock()
      .mockResolvedValueOnce(errResponse(404, JSON.stringify({ error: 'model not found' })))
      .mockResolvedValueOnce(okResponse('Backup answer'));

    const result = await modalResearchService.generateResponseWithMeta(
      'Hello',
      [],
      null,
      [],
      null,
      false,
      [],
      'kimi',
      false
    );

    expect(result.text).toBe('Backup answer');
    expect(result.fellBack).toBe(true);
    expect(result.modelId).toBe(NVIDIA_FALLBACK_MODEL_ID);
    expect(result.fallbackReason).toBe('model-not-found');
    expect(fetchMock()).toHaveBeenCalledTimes(2);
    expect(modelOfCall(0)).toBe(NVIDIA_CHAT_MODEL_ID);
    expect(modelOfCall(1)).toBe(NVIDIA_FALLBACK_MODEL_ID);
  });

  it('does not waste a fallback attempt on auth failures', async () => {
    fetchMock().mockResolvedValue(errResponse(401, JSON.stringify({ error: 'unauthorized' })));

    await expect(
      modalResearchService.generateResponseWithMeta('Hello', [], null)
    ).rejects.toMatchObject({ code: 'auth' });
    expect(fetchMock()).toHaveBeenCalledTimes(1);
  });

  it('surfaces an empty error when both models return no usable content', async () => {
    fetchMock()
      .mockResolvedValueOnce(okResponse(''))
      .mockResolvedValueOnce(
        okResponse('<think>hidden reasoning only</think>')
      );

    await expect(
      modalResearchService.generateResponseWithMeta('Hello', [], null)
    ).rejects.toMatchObject({ code: 'empty' });
    expect(fetchMock()).toHaveBeenCalledTimes(2);
  });

  it('never leaks reasoning-only fallback content as an answer', async () => {
    fetchMock()
      .mockResolvedValueOnce(errResponse(500, JSON.stringify({ error: 'boom' })))
      .mockResolvedValueOnce(okResponse(''))
      .mockResolvedValueOnce(okResponse(''));

    await expect(
      modalResearchService.generateResponseWithMeta('Hello', [], null, [], null, false, [], 'deepseek', false, undefined, undefined, { retryDelayMs: 10 })
    ).rejects.toMatchObject({ code: 'empty' });
    // 500 -> same-model retry -> empty -> fallback -> empty -> throw
    expect(fetchMock()).toHaveBeenCalledTimes(3);
  });

  it('retries once on the same model for transient 5xx before failing over', async () => {
    fetchMock()
      .mockResolvedValueOnce(errResponse(500, JSON.stringify({ error: 'boom' })))
      .mockResolvedValueOnce(okResponse('Recovered'));

    const result = await modalResearchService.generateResponseWithMeta(
      'Hello', [], null, [], null, false, [], 'deepseek', false,
      undefined, undefined, { retryDelayMs: 10 }
    );

    expect(result.text).toBe('Recovered');
    expect(result.fellBack).toBe(false);
    expect(fetchMock()).toHaveBeenCalledTimes(2);
    expect(modelOfCall(0)).toBe(NVIDIA_CHAT_MODEL_ID);
    expect(modelOfCall(1)).toBe(NVIDIA_CHAT_MODEL_ID);
  });

  it('fails over to the backup only after the same-model retry is exhausted', async () => {
    fetchMock()
      .mockResolvedValueOnce(errResponse(500, JSON.stringify({ error: 'boom' })))
      .mockResolvedValueOnce(errResponse(500, JSON.stringify({ error: 'boom again' })))
      .mockResolvedValueOnce(okResponse('Backup after retry'));

    const result = await modalResearchService.generateResponseWithMeta(
      'Hello', [], null, [], null, false, [], 'kimi', false,
      undefined, undefined, { retryDelayMs: 10 }
    );

    expect(result.text).toBe('Backup after retry');
    expect(result.fellBack).toBe(true);
    expect(result.fallbackReason).toBe('server');
    expect(fetchMock()).toHaveBeenCalledTimes(3);
    expect(modelOfCall(2)).toBe(NVIDIA_FALLBACK_MODEL_ID);
  });

  it('trips the first-token watchdog on a hung upstream and surfaces timeout', async () => {
    // Abort-aware like real fetch: rejects when the combined signal fires.
    fetchMock().mockImplementation(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          const onAbort = () => reject(new DOMException('This operation was aborted', 'AbortError'));
          if ((init?.signal as AbortSignal | undefined)?.aborted) {
            onAbort();
            return;
          }
          (init?.signal as AbortSignal | undefined)?.addEventListener('abort', onAbort, { once: true });
        })
    );

    await expect(
      modalResearchService.generateResponseWithMeta(
        'Hello', [], null, [], null, false, [], 'deepseek', false,
        undefined, undefined, { timeoutMs: 300, firstTokenTimeoutMs: 50, retryDelayMs: 10 }
      )
    ).rejects.toMatchObject({ code: 'timeout' });
    // primary + same-model retry + fallback attempt
    expect(fetchMock()).toHaveBeenCalledTimes(3);
  });

  it('streams tokens progressively and assembles the final text', async () => {
    const enc = new TextEncoder();
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(enc.encode(chunk));
        controller.close();
      },
    });
    fetchMock().mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
      text: async () => '',
      json: async () => ({}),
    } as unknown as Response);

    const seen: string[] = [];
    const result = await modalResearchService.generateResponseWithMeta(
      'Hello', [], null, [], null, false, [], 'deepseek', false,
      (partial) => { seen.push(partial); }
    );

    expect(result.text).toBe('Hello world');
    expect(result.fellBack).toBe(false);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe('Hello world');
    expect(JSON.parse(String((fetchMock().mock.calls[0]?.[1] as RequestInit)?.body)).stream).toBe(true);
  });
});
