import { describe, expect, it, vi } from 'vitest';
import {
  classifyTradingError,
  notifyTradingEvent,
  tradingNotificationContent,
} from './tradingNotifications';

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
