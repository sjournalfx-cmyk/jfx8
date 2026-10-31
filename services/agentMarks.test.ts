import { describe, expect, it } from 'vitest';
import { AGENT_TAG, buildAgentMarkIndex, matchesAgentMark } from './agentMarks';

const mark = (over: Partial<Parameters<typeof buildAgentMarkIndex>[0][number]> = {}) => ({
  order_id: null as string | null,
  position_id: null as string | null,
  deal_id: null as string | null,
  symbol: null as string | null,
  created_at: '2026-11-01T10:00:00.000Z',
  action: 'close' as string | undefined,
  ...over,
});

describe('buildAgentMarkIndex', () => {
  it('indexes ids and timed symbol events by action', () => {
    const idx = buildAgentMarkIndex([
      mark({ order_id: ' 771 ', position_id: '555', symbol: 'eurusd', action: 'open' }),
      mark({ deal_id: '9', symbol: 'AUDCAD', created_at: '2026-11-01T11:00:00.000Z', action: 'close_all' }),
      mark({}),
    ]);
    expect(idx.orderIds.has('771')).toBe(true);
    expect(idx.positionIds.has('555')).toBe(true);
    expect(idx.dealIds.has('9')).toBe(true);
    expect(idx.openEvents).toHaveLength(1);
    expect(idx.closeEvents).toHaveLength(1);
  });
});

describe('matchesAgentMark', () => {
  const base = buildAgentMarkIndex([
    mark({ order_id: '771' }),
    mark({ position_id: '555' }),
    mark({ deal_id: '9' }),
    mark({ symbol: 'EURUSD', created_at: '2026-11-01T10:00:00.000Z', action: 'open' }),
    mark({ symbol: 'AUDCAD', created_at: '2026-11-01T10:00:00.000Z', action: 'close' }),
  ]);

  it('matches by order id, position id, and deal id', () => {
    expect(matchesAgentMark(base, { orderId: 771 })).toBe(true);
    expect(matchesAgentMark(base, { orderId: '771' })).toBe(true);
    expect(matchesAgentMark(base, { positionId: '555' })).toBe(true);
    expect(matchesAgentMark(base, { dealId: 9 })).toBe(true);
  });

  it('matches close marks by symbol + time window', () => {
    expect(
      matchesAgentMark(base, { symbol: 'AUDCAD', closeTimestamp: '2026-11-01T10:01:00.000Z' })
    ).toBe(true);
  });

  it('matches open marks by symbol + deal open time', () => {
    expect(
      matchesAgentMark(base, { symbol: 'eurusd', openTimestamp: '2026-11-01T10:01:30.000Z' })
    ).toBe(true);
  });

  it('rejects non-agent deals', () => {
    expect(matchesAgentMark(base, { orderId: 42, symbol: 'NZDUSD' })).toBe(false);
    expect(
      matchesAgentMark(base, { symbol: 'AUDCAD', closeTimestamp: '2026-11-01T10:05:00.000Z' })
    ).toBe(false);
  });

  it('is false without an index or deal', () => {
    expect(matchesAgentMark(null, { orderId: 771 })).toBe(false);
    expect(matchesAgentMark(base, null)).toBe(false);
  });
});

describe('AGENT_TAG', () => {
  it('is the journal tag rendered as the robot badge', () => {
    expect(AGENT_TAG).toBe('Agent');
  });
});
