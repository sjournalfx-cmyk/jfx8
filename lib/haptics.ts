/**
 * Haptics — tiny vibration helpers for Material You feel.
 * No-ops on desktop / unsupported devices.
 */
export const haptic = {
  light: () => { try { navigator.vibrate?.(10); } catch {} },
  medium: () => { try { navigator.vibrate?.(20); } catch {} },
  heavy: () => { try { navigator.vibrate?.([30, 20, 30]); } catch {} },
  selection: () => { try { navigator.vibrate?.(8); } catch {} },
  success: () => { try { navigator.vibrate?.([10, 30, 10]); } catch {} },
  error: () => { try { navigator.vibrate?.([30, 15, 30]); } catch {} },
};
export const hapticLight = haptic.light;
export const hapticMedium = haptic.medium;
export const hapticSuccess = haptic.success;
