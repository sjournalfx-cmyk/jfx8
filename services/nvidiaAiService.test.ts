import { describe, expect, it } from 'vitest';
import { buildAiRequestPayload, getAssistantMode } from './nvidiaAiService';
import type { Trade, UserProfile } from '../types';

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
});
