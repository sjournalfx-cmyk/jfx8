import { afterEach, describe, expect, it, vi } from 'vitest';
import { haptic } from './haptics';

const originalVibrate = navigator.vibrate;

afterEach(() => {
  Object.defineProperty(navigator, 'vibrate', {
    configurable: true,
    value: originalVibrate,
  });
});

describe('haptic', () => {
  it('uses the Vibration API when available', () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    haptic.selection();
    expect(vibrate).toHaveBeenCalledWith(8);
  });

  it('is a no-op when the API is missing (desktop)', () => {
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: undefined });
    expect(() => haptic.success()).not.toThrow();
  });

  it('swallows browser rejections', () => {
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: () => { throw new Error('vibration blocked'); },
    });
    expect(() => haptic.error()).not.toThrow();
  });
});
