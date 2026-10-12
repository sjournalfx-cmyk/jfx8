import React, { useEffect, useRef } from 'react';

/**
 * Drawer — minimal, polished bottom sheet.
 *
 * One shell for every sheet in the replay / backtest lab so they stay
 * identical: pure-black glass panel, one grab pill, optional centered title,
 * safe-area padding, scroll containment, Escape-to-close, body-scroll lock and
 * a spring-eased slide-up + fade (uses the existing `sheet-up` / `sheet-fade`
 * keyframes in index.css, so no new animation runtime is pulled in).
 */
export interface DrawerProps {
    open: boolean;
    onClose: () => void;
    /** Small uppercase label rendered above the content. */
    title?: string;
    /** Muted second line under the title (e.g. "EURUSD · H1"). */
    subtitle?: string;
    isDarkMode?: boolean;
    /** Panel max height as a Tailwind class. */
    maxHeight?: string;
    showHandle?: boolean;
    overlayZIndex?: number;
    panelZIndex?: number;
    className?: string;
    children: React.ReactNode;
}

const Drawer: React.FC<DrawerProps> = ({
    open,
    onClose,
    title,
    subtitle,
    isDarkMode = true,
    maxHeight = 'max-h-[80dvh]',
    showHandle = true,
    overlayZIndex = 500,
    panelZIndex = 510,
    className = '',
    children,
}) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const wasOpenRef = useRef(false);

    // Escape to close + body scroll lock while the sheet owns the screen.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                onClose();
            }
        };
        document.addEventListener('keydown', onKey, true);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey, true);
            document.body.style.overflow = prevOverflow;
        };
    }, [open, onClose]);

    // Move focus into the sheet on open so keyboard/screen-reader users land
    // inside it (and so the first input picks up focus on mobile).
    useEffect(() => {
        if (open && !wasOpenRef.current) {
            const id = window.setTimeout(() => {
                const first = panelRef.current?.querySelector<HTMLElement>(
                    'input, button, [tabindex]:not([tabindex="-1"])'
                );
                first?.focus?.({ preventScroll: true });
            }, 120);
            wasOpenRef.current = true;
            return () => window.clearTimeout(id);
        }
        if (!open) wasOpenRef.current = false;
    }, [open]);

    if (!open) return null;

    return (
        <>
            <div
                className="fixed inset-0 bg-black/60 backdrop-blur-[2px] animate-sheet-fade"
                style={{ zIndex: overlayZIndex }}
                onClick={onClose}
                aria-hidden
            />
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label={title || 'Panel'}
                className={`fixed bottom-0 left-0 right-0 rounded-t-[28px] border-t shadow-[0_-8px_44px_rgba(0,0,0,0.6)] animate-sheet-up overscroll-contain no-scrollbar ${maxHeight} overflow-y-auto px-4 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))] ${
                    isDarkMode
                        ? 'bg-black/85 border-white/10 text-zinc-200 backdrop-blur-2xl'
                        : 'bg-white border-slate-200 text-slate-700'
                } ${className}`}
                style={{ zIndex: panelZIndex }}
            >
                {showHandle && <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-white/20" aria-hidden />}
                {(title || subtitle) && (
                    <div className="mb-3 text-center">
                        {title && (
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">
                                {title}
                            </p>
                        )}
                        {subtitle && (
                            <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.15em] text-white/25">
                                {subtitle}
                            </p>
                        )}
                    </div>
                )}
                {children}
            </div>
        </>
    );
};

export default Drawer;
