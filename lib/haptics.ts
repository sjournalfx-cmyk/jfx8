/**
 * Haptics — tiny vibration helpers for Material You feel.
 * No-ops on desktop / unsupported devices.
 */
const vibrate = (pattern: number | number[]): void => {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    navigator.vibrate(pattern);
  } catch {
    /* vibration is a progressive enhancement */
  }
};

export const haptic = {
  light: () => vibrate(10),
  medium: () => vibrate(20),
  heavy: () => vibrate([30, 20, 30]),
  selection: () => vibrate(8),
  success: () => vibrate([10, 30, 10]),
  error: () => vibrate([30, 15, 30]),
};
export const hapticLight = haptic.light;
export const hapticMedium = haptic.medium;
export const hapticSuccess = haptic.success;
