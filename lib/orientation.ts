import { isNative } from './capacitor';

/**
 * Screen-rotation lock helper for mobile views and landscape charts.
 * Web-safe version for jfx8: uses screen.orientation and requestFullscreen
 * with graceful fallback (Safari iOS throws or ignores — callers toast instead of crashing).
 */

export type OrientationLock =
    | 'auto'
    | 'portrait'
    | 'landscape'
    | 'portrait-secondary'
    | 'landscape-secondary';

const STORAGE_KEY = 'jfx_backtest_orientation';

export const ORIENTATION_OPTIONS: { value: OrientationLock; label: string; hint: string }[] = [
    { value: 'auto', label: 'Auto (sensor)', hint: 'Follow device rotation' },
    { value: 'portrait', label: 'Portrait', hint: 'Upright' },
    { value: 'landscape', label: 'Landscape', hint: 'Sideways' },
    { value: 'portrait-secondary', label: 'Upside down', hint: 'Portrait flipped' },
    { value: 'landscape-secondary', label: 'Landscape reverse', hint: 'Other sideways' },
];

export const orientationLabel = (value: OrientationLock): string =>
    ORIENTATION_OPTIONS.find(o => o.value === value)?.label ?? 'Auto (sensor)';

export function getOrientationLock(): OrientationLock {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === 'portrait' || raw === 'landscape' || raw === 'portrait-secondary' || raw === 'landscape-secondary') {
            return raw;
        }
    } catch { /* storage blocked */ }
    return 'auto';
}

function persist(lock: OrientationLock) {
    try {
        if (lock === 'auto') localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, lock);
    } catch { /* blocked */ }
}

export async function lockOrientation(lock: OrientationLock): Promise<void> {
    if (lock === 'auto') return unlockOrientation();
    const orient = typeof screen !== 'undefined' ? (screen as any)?.orientation : undefined;
    if (!orient?.lock) throw new Error('Rotation lock is not supported in this browser.');
    await orient.lock(lock);
    persist(lock);
}

export async function unlockOrientation(): Promise<void> {
    try {
        (screen as any)?.orientation?.unlock?.();
    } catch { /* ignore */ }
    persist('auto');
}

export type LandscapeViewResult = 'locked' | 'overlay-only';

export async function enterLandscapeView(): Promise<LandscapeViewResult> {
    if (typeof document !== 'undefined') {
        const docEl = document.documentElement as any;
        if (typeof docEl?.requestFullscreen === 'function') {
            try {
                await docEl.requestFullscreen();
            } catch {
                return 'overlay-only';
            }
        }
    }
    const orient = typeof screen !== 'undefined' ? (screen as any)?.orientation : undefined;
    if (!orient?.lock) return 'overlay-only';
    try {
        await orient.lock('landscape');
        persist('landscape');
        return 'locked';
    } catch {
        return 'overlay-only';
    }
}

export async function exitLandscapeView(): Promise<void> {
    try {
        if (typeof document !== 'undefined' && (document as any).fullscreenElement) {
            await (document as any).exitFullscreen();
        }
    } catch { /* already exited (e.g. Esc) */ }
    await unlockOrientation();
}
