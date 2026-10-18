import { useEffect, useRef, useState } from 'react';
import { type OrientationLock, enterLandscapeView, exitLandscapeView, getOrientationLock, lockOrientation, unlockOrientation } from '../lib/orientation';
import { useToast } from '../components/ui/Toast';

interface UseFullscreenLandscapeOptions {
    unavailableTitle?: string;
    unavailableMessage?: string;
}

export function useFullscreenLandscape(options: UseFullscreenLandscapeOptions = {}) {
    const {
        unavailableTitle = 'Landscape unavailable',
        unavailableMessage = 'Rotate your device to see the full view.',
    } = options;

    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showRotateHint, setShowRotateHint] = useState(false);
    const [isPortrait, setIsPortrait] = useState(() =>
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia('(orientation: portrait)').matches
            : true
    );
    const prevOrientationRef = useRef<OrientationLock | null>(null);
    const lockEngagedRef = useRef(false);
    const landscapeActiveRef = useRef(false);
    const { addToast } = useToast();

    const restoreOrientation = async () => {
        const prev = prevOrientationRef.current;
        prevOrientationRef.current = null;
        if (!prev) return;
        try {
            await lockOrientation(prev);
        } catch {
            try { await unlockOrientation(); } catch { /* ignore */ }
        }
    };

    const notifyLandscapeUnavailable = () => {
        setShowRotateHint(true);
        addToast({ type: 'info', title: unavailableTitle, message: unavailableMessage, duration: 4000 });
    };

    const teardownLandscapeView = () => {
        if (!landscapeActiveRef.current) return;
        landscapeActiveRef.current = false;
        lockEngagedRef.current = false;
        setShowRotateHint(false);
        void exitLandscapeView().then(() => restoreOrientation());
    };

    const openFullscreen = () => {
        prevOrientationRef.current = getOrientationLock();
        landscapeActiveRef.current = true;
        setIsFullscreen(true);
        setShowRotateHint(false);
        void enterLandscapeView().then(result => {
            if (result !== 'locked') {
                notifyLandscapeUnavailable();
                return;
            }
            if (typeof document !== 'undefined' && document.fullscreenElement) {
                lockEngagedRef.current = true;
            }
        }).catch(() => {
            notifyLandscapeUnavailable();
        });
    };

    const closeFullscreen = () => {
        setIsFullscreen(false);
        teardownLandscapeView();
    };

    // Fullscreen takeover: lock background scroll, flag the body so the
    // global MobileNav island can hide, and notify MobileLayout (which lives
    // outside the widget tree) via a window event. Portal rendering in the
    // widgets escapes card/scroll stacking contexts; this handles nav + scroll.
    useEffect(() => {
        if (typeof document === 'undefined') return;
        const body = document.body;
        if (!body) return;
        if (!isFullscreen) {
            body.classList.remove('jfx-fullscreen-open');
            return;
        }
        const prevOverflow = body.style.overflow;
        body.classList.add('jfx-fullscreen-open');
        body.style.overflow = 'hidden';
        try {
            window.dispatchEvent(new CustomEvent('jfx:fullscreen-change', { detail: { open: true } }));
        } catch { /* ignore */ }
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeFullscreen();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
            body.classList.remove('jfx-fullscreen-open');
            body.style.overflow = prevOverflow;
            try {
                window.dispatchEvent(new CustomEvent('jfx:fullscreen-change', { detail: { open: false } }));
            } catch { /* ignore */ }
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [isFullscreen]);

    useEffect(() => {
        if (!isFullscreen) return;
        return () => { teardownLandscapeView(); };
    }, [isFullscreen]);

    useEffect(() => {
        if (!isFullscreen || !showRotateHint) return;
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mq = window.matchMedia('(orientation: portrait)');
        setIsPortrait(mq.matches);
        const onChange = (e: MediaQueryListEvent) => setIsPortrait(e.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, [isFullscreen, showRotateHint]);

    useEffect(() => {
        if (!isFullscreen || typeof document === 'undefined') return;
        const onFsChange = () => {
            if (!document.fullscreenElement && lockEngagedRef.current) {
                setShowRotateHint(true);
            }
        };
        document.addEventListener('fullscreenchange', onFsChange);
        return () => document.removeEventListener('fullscreenchange', onFsChange);
    }, [isFullscreen]);

    return { isFullscreen, showRotateHint, isPortrait, openFullscreen, closeFullscreen };
}
