import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildLockBlockContent,
  classifyTradingError,
  notifyElapsedLockChanges,
  notifyLockBlock,
  notifyTradingEvent,
  tradingNotificationContent,
} from './tradingNotifications';
import {
  blankPortfolioLocks,
  LOCK_UNLOCK_COOLDOWN_MS,
  writePortfolioLocks,
} from './tradingLocks';

describe('classifyTradingError', () => {
  it('maps broker failures onto notification kinds', () => {
    expect(classifyTradingError('Off quotes')).toBe('off_quotes');
    expect(classifyTradingError('Requote: price moved')).toBe('requote');
    expect(classifyTradingError('Invalid stops')).toBe('invalid_stops');
    expect(classifyTradingError('Order rejected: insufficient funds')).toBe('insufficient_funds');
    expect(classifyTradingError('Market is closed')).toBe('market_closed');
    expect(classifyTradingError('Execution failed')).toBe('execution_failure');
    expect(classifyTradingError('Daily limit reached (2/2)')).toBe('locked_by_rule');
    expect(classifyTradingError('anything else')).toBe('unknown');
  });

  it('prefers the structured API code over the message', () => {
    expect(classifyTradingError('Order failed', 'locked_by_rule')).toBe('locked_by_rule');
  });
});

describe('notifyTradingEvent', () => {
  it('adds an in-app toast for fresh events', () => {
    const addToast = vi.fn();
    const content = notifyTradingEvent(
      { kind: 'error', message: 'Requote' },
      { addToast, browserNotifications: false }
    );
    expect(content.kind).toBe('requote');
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Requote', type: 'warning' })
    );
  });

  it('does not duplicate toasts that the component already showed', () => {
    const addToast = vi.fn();
    notifyTradingEvent(
      { kind: 'order_placed', message: 'Buy 0.01 EURUSD placed', alreadyToasted: true },
      { addToast, browserNotifications: false }
    );
    expect(addToast).not.toHaveBeenCalled();
  });

  it('exposes the mapping for success events', () => {
    expect(tradingNotificationContent('position_closed').title).toBe('Position closed');
  });
});


describe('lock block notifications', () => {
  it('names the rule and explains the concrete block', () => {
    expect(buildLockBlockContent({ rule: 'pairWhitelist', symbolName: 'EURUSD' })).toMatchObject({
      title: 'Trade blocked by Allowed pairs',
      message: 'EURUSD not in allowed pairs',
    });
    expect(
      buildLockBlockContent({ rule: 'maxTrades', context: { maxPerDay: 2, fillsToday: 2 } })
    ).toMatchObject({ title: 'Trade blocked by Max trades per day', message: 'Max 2 trades/day reached (2/2 today)' });
    expect(
      buildLockBlockContent({ rule: 'lotGuard', context: { minLots: 0.01, maxLots: 1, volumeLots: 2 } })
    ).toMatchObject({ title: 'Trade blocked by Lot size limits', message: 'Lot size 2 is outside 0.01–1 lots' });
  });

  it('keeps the count-unavailable explanation', () => {
    const content = buildLockBlockContent({
      rule: 'maxTrades',
      message: "Couldn't confirm today's trade count. Try again in a moment.",
      context: { reason: 'count_unavailable' },
    });
    expect(content.message).toContain("Couldn't confirm today's trade count");
  });

  it('shows an error toast when a block occurs', () => {
    const addToast = vi.fn();
    notifyLockBlock(
      { rule: 'pairWhitelist', symbolName: 'EURUSD' },
      { addToast, browserNotifications: false }
    );
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', title: 'Trade blocked by Allowed pairs' })
    );
  });
});

describe('elapsed lock change notifications', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('fires exactly once per elapsed pending change', () => {
    const portfolioId = 'notify-portfolio';
    const locks = blankPortfolioLocks();
    locks.maxTrades = {
      enabled: true,
      maxPerDay: 2,
      unlockRequestedAt: null,
      pendingChange: {
        value: { maxPerDay: 5 },
        requestedAt: new Date(Date.now() - LOCK_UNLOCK_COOLDOWN_MS - 1_000).toISOString(),
      },
    };
    writePortfolioLocks(portfolioId, locks);

    const addToast = vi.fn();
    const first = notifyElapsedLockChanges(portfolioId, addToast);
    expect(first).toHaveLength(1);
    expect(first[0].title).toBe('Lock change now active');
    expect(first[0].message).toBe('Max trades per day is now 5');
    expect(addToast).toHaveBeenCalledTimes(1);

    expect(notifyElapsedLockChanges(portfolioId, addToast)).toHaveLength(0);
    expect(addToast).toHaveBeenCalledTimes(1);
  });
});
