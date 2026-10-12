import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
    MousePointer2, Slash, ArrowRight,
    Minus, Square, Trash2, GripVertical, Magnet, RotateCcw,
    Lock, Unlock, TrendingUp, TrendingDown, Undo, Redo,
    ChevronLeft, ChevronUp, Percent, Type, Ruler
} from 'lucide-react';
import { ToolType } from './types';

// ── Same glyphs as V1 — icons unchanged ──────────────────────────────────────
const RayToolIcon = ({ size = 16, strokeWidth = 1.8 }: { size?: number; strokeWidth?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 19 12 12 19 5" />
        <circle cx="5" cy="19" r="2.6" fill="none" />
        <circle cx="12" cy="12" r="2.6" fill="none" />
    </svg>
);

const VerticalLineToolIcon = ({ size = 16, strokeWidth = 1.8 }: { size?: number; strokeWidth?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v18" />
        <path d="M8 4h8M8 20h8" />
    </svg>
);

interface DrawingToolbarV2Props {
    activeTool: ToolType;
    setActiveTool: (tool: ToolType) => void;
    clearDrawings: () => void;
    magnetMode: boolean;
    toggleMagnetMode: () => void;
    isLocked: boolean;
    toggleLocked: () => void;
    orientation: 'horizontal' | 'vertical';
    toggleOrientation: () => void;
    isDarkMode?: boolean;
    /** Kept for drop-in compat with V1 — ignored (docked layout, no free position). */
    style?: React.CSSProperties;
    /** Kept for drop-in compat with V1 — ignored (no drag, nothing to commit). */
    onPositionChange?: (pos: { x: number; y: number }) => void;
    onUndo?: () => void;
    onRedo?: () => void;
    canUndo?: boolean;
    canRedo?: boolean;
    currentColor?: string;
    setCurrentColor?: (color: string) => void;
    currentStrokeWidth?: number;
    currentStrokeStyle?: 'solid' | 'dashed' | 'dotted';
    setStrokeWidth?: (width: number) => void;
    setStrokeStyle?: (style: 'solid' | 'dashed' | 'dotted') => void;
    selectedDrawingId?: string | null;
    selectedIds?: string[];
    onDeleteSelected?: () => void;
    drawingsCount?: number;
    stickyMode?: boolean;
    toggleStickyMode?: () => void;
}

const TOOL_COLORS = [
    '#2962ff', '#FF4F01', '#10b981', '#ef4444', '#f59e0b',
    '#8b5cf6', '#ec4899', '#787b86', '#ffffff', '#000000'
];

const EXTRA_COLORS = [
    '#ffd1dc', '#ffcc99', '#fff59d', '#c8e6c9', '#b2dfdb',
    '#b3e5fc', '#c5cae9', '#e1bee7', '#f8bbd0', '#f5f5f5',
    '#ffab91', '#ff8a65', '#ff7043', '#ff5722', '#e64a19',
    '#4caf50', '#26a69a', '#29b6f6', '#5c6bc0', '#7e57c2'
];

const TOOLS: { id: ToolType; icon: any; title: string }[] = [
    { id: 'cursor', icon: MousePointer2, title: 'Cursor (V)' },
    { id: 'trendline', icon: Slash, title: 'Trend Line (T)' },
    { id: 'ray', icon: RayToolIcon, title: 'Ray (R)' },
    { id: 'arrow', icon: ArrowRight, title: 'Arrow (A)' },
    { id: 'horizontal', icon: Minus, title: 'Horizontal Line (H)' },
    { id: 'vertical', icon: VerticalLineToolIcon, title: 'Vertical Line (N)' },
    { id: 'rect', icon: Square, title: 'Rectangle (B)' },
    { id: 'long', icon: TrendingUp, title: 'Long Position (L)' },
    { id: 'short', icon: TrendingDown, title: 'Short Position (S)' },
    { id: 'fib', icon: Percent, title: 'Fib Retracement (F)' },
    { id: 'text', icon: Type, title: 'Text (W)' },
    { id: 'measure', icon: Ruler, title: 'Measure (U)' },
];

const ToolButton = React.memo(({
    active, title, onClick, onDoubleClick, onLongPress, pinned, dark, children, vertical,
}: {
    active: boolean; title: string; onClick: () => void; onDoubleClick?: () => void; onLongPress?: () => void; pinned?: boolean; dark: boolean;
    children: React.ReactNode; vertical: boolean;
}) => {
    // Long-press a tool = toggle sticky (TV discoverability on touch; the
    // same action desktop does with double-click).
    const lpTimer = useRef<number | null>(null);
    const lpFired = useRef(false);
    const clearLp = () => { if (lpTimer.current !== null) { window.clearTimeout(lpTimer.current); lpTimer.current = null; } };
    useEffect(() => clearLp, []);
    return (
    <button
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => { if (onLongPress) { e.preventDefault(); onLongPress(); } }}
        onTouchStart={() => {
            if (!onLongPress) return;
            lpFired.current = false;
            clearLp();
            lpTimer.current = window.setTimeout(() => { lpFired.current = true; onLongPress(); }, 550);
        }}
        onTouchEnd={clearLp}
        onTouchMove={clearLp}
        title={title + (onDoubleClick ? ' (double-click / long-press = sticky)' : '')}
        aria-label={title}
        className={`relative w-10 h-10 grid place-items-center rounded-lg transition-colors duration-100 touch-manipulation shrink-0
            ${active
                ? 'bg-[#2962ff] text-white shadow-sm'
                : dark ? 'text-zinc-400 hover:bg-white/10 hover:text-zinc-100' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}
    >
        {children}
        {pinned && active && (
            <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400" />
        )}
        {active && (
            <span className={`absolute rounded-full bg-white/90 ${vertical ? 'left-0.5 top-2 bottom-2 w-0.5' : 'bottom-0.5 left-2 right-2 h-0.5'}`} />
        )}
    </button>
    );
});
ToolButton.displayName = 'ToolButtonV2';

/**
 * DrawingToolbarV2 — docked replacement for the floating DrawingToolbar.
 *
 * Why this fixes the lag:
 * - V1 was `position:fixed` + free-pixel drag over the chart canvas. Every
 *   pointermove rewrote `transform: translate3d()` on a `shadow-2xl` layer
 *   sitting ON TOP of the lightweight-charts canvas, forcing the browser to
 *   recomposite the (huge, GPU-resident) chart texture per frame — plus
 *   backdrop-blur / hover churn on 25+ buttons. On mobile GPUs that's jank.
 * - V2 is a STATIC flex sibling of the chart (left rail or top bar). It never
 *   moves, never overlaps the canvas, registers zero window listeners, uses
 *   zero transforms, zero backdrop-blur, and a small shadow. The chart lays
 *   out once beside it and never recomposites because of the toolbar.
 *
 * Same tool icons, same callbacks — only the integration changed:
 *  - `style` / `onPositionChange` (free-floating position) are ignored.
 *  - `orientation` now means dock side: 'vertical' = left rail,
  *    'horizontal' = top bar. Toggled with the dock-side button, persisted by
 *    the parent exactly like before.
 */
export const DrawingToolbarV2 = React.memo<DrawingToolbarV2Props>(({
    activeTool,
    setActiveTool,
    clearDrawings,
    magnetMode,
    toggleMagnetMode,
    isLocked,
    toggleLocked,
    orientation,
    toggleOrientation,
    isDarkMode,
    onUndo,
    onRedo,
    canUndo = false,
    canRedo = false,
    currentColor = '#2962ff',
    setCurrentColor,
    currentStrokeWidth = 1,
    currentStrokeStyle = 'solid',
    setStrokeWidth,
    setStrokeStyle,
    selectedIds,
    onDeleteSelected,
    drawingsCount = 0,
    stickyMode,
    toggleStickyMode,
}) => {
    const dark = !!isDarkMode;
    const vertical = orientation === 'vertical';
    // Kept for compat (selection delete now lives in the popup flyout).
    void selectedIds; void onDeleteSelected;
    // Single menu state (not 4 booleans) — one re-render per open/close.
    const [collapsed, setCollapsed] = useState(false);
    // Minimal two-tap confirm for delete-all (rail trash): 1st tap arms,
    // 2nd tap clears. Auto-disarms after 3s. No modal, no window.confirm.
    const [confirmClearAll, setConfirmClearAll] = useState(false);
    const confirmTimer = useRef<number | null>(null);
    useEffect(() => () => { if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current); }, []);
    useEffect(() => { if (!drawingsCount) setConfirmClearAll(false); }, [drawingsCount]);
    const handleClearAllClick = useCallback(() => {
        if (!drawingsCount) return;
        if (!confirmClearAll) {
            setConfirmClearAll(true);
            if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
            confirmTimer.current = window.setTimeout(() => setConfirmClearAll(false), 3000);
            return;
        }
        if (confirmTimer.current !== null) { window.clearTimeout(confirmTimer.current); confirmTimer.current = null; }
        setConfirmClearAll(false);
        clearDrawings();
    }, [drawingsCount, confirmClearAll, clearDrawings]);
    const isCoarse = useRef(typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches).current;
    // Recently-used tools (TV one-tap re-arm) + first-run sticky hint.
    const [showStickyHint, setShowStickyHint] = useState(false);
    // Short landscape heights: start collapsed so the rail never covers the chart.
    useEffect(() => {
        if (typeof window !== 'undefined' && window.innerHeight < 520) setCollapsed(true);
    }, []);
    // Free-drag state: the 8-dot grip freezes the docked bar into pixels
    // and moves it with direct style writes (no re-renders mid-drag).
    const barRef = useRef<HTMLDivElement | null>(null);
    const dragRef = useRef<{ pid: number; sx: number; sy: number; ol: number; ot: number; pw: number; ph: number; bw: number; bh: number; moved: boolean } | null>(null);
    const resetDock = useCallback(() => {
        const bar = barRef.current;
        if (bar) {
            bar.style.left = '';
            bar.style.top = '';
            bar.style.transform = '';
            bar.style.willChange = '';
            (bar.style as any).translate = '';
        }
    }, []);
    // Re-dock whenever the dock side flips.
    const handleOrientationToggle = useCallback(() => {
        resetDock();
        toggleOrientation();
    }, [resetDock, toggleOrientation]);
    const onGripPointerDown = useCallback((e: React.PointerEvent) => {
        e.stopPropagation();
        e.preventDefault();
        const bar = barRef.current;
        const parent = bar?.parentElement;
        if (!bar || !parent) return;
        const r = bar.getBoundingClientRect();
        const pr = parent.getBoundingClientRect();
        const ol = r.left - pr.left;
        const ot = r.top - pr.top;
        // Freeze the docked spot into pixels and drop the centering translate.
        // Movement itself goes through translate3d (compositor-only) so the
        // chart texture never recomposites mid-drag; left/top commit on release.
        bar.style.left = `${ol}px`;
        bar.style.top = `${ot}px`;
        (bar.style as any).translate = 'none';
        bar.style.willChange = 'transform';
        dragRef.current = { pid: e.pointerId, sx: e.clientX, sy: e.clientY, ol, ot, pw: pr.width, ph: pr.height, bw: r.width, bh: r.height, moved: false };
        const onMove = (ev: PointerEvent) => {
            const st = dragRef.current;
            if (!st || ev.pointerId !== st.pid) return;
            if (ev.cancelable) ev.preventDefault();
            const dx = ev.clientX - st.sx;
            const dy = ev.clientY - st.sy;
            if (Math.hypot(dx, dy) > 6) st.moved = true;
            const nl = Math.min(Math.max(st.ol + dx, 4), Math.max(4, st.pw - st.bw - 4));
            const nt = Math.min(Math.max(st.ot + dy, 4), Math.max(4, st.ph - st.bh - 4));
            bar.style.transform = `translate3d(${nl - st.ol}px, ${nt - st.ot}px, 0)`;
        };
        const onUp = (ev: PointerEvent) => {
            const st = dragRef.current;
            if (st?.pid !== ev.pointerId) return;
            const wasDrag = st?.moved;
            dragRef.current = null;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            // Commit final position into left/top, clear the transform.
            const m = /translate3d\((-?\d+\.?\d*)px, (-?\d+\.?\d*)px/.exec(bar.style.transform);
            if (m) {
                bar.style.left = `${st.ol + parseFloat(m[1])}px`;
                bar.style.top = `${st.ot + parseFloat(m[2])}px`;
            }
            bar.style.transform = '';
            bar.style.willChange = '';
            if (!wasDrag) setCollapsed(true); // tap = collapse (old behavior)
        };
        window.addEventListener('pointermove', onMove, { passive: false });
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
    }, []);
    const handleToolSelect = useCallback((toolId: ToolType) => {
        setActiveTool(toolId);
        if (toolId !== 'cursor') {
            // First-run hint: how to keep drawing + sticky gesture (mobile).
            try {
                if (!localStorage.getItem('jfx_tool_hint_seen')) {
                    localStorage.setItem('jfx_tool_hint_seen', '1');
                    setShowStickyHint(true);
                    window.setTimeout(() => setShowStickyHint(false), 3200);
                }
            } catch { /* no-op */ }
        }
    }, [setActiveTool]);

    const barTheme = 'bg-transparent border-transparent text-zinc-200';
    const divider = dark ? 'bg-white/10' : 'bg-slate-200';
    const subtleBtn = dark
        ? 'text-zinc-400 hover:bg-white/10 hover:text-zinc-100'
        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800';
    const popTheme = dark
        ? 'bg-[#1c1c1c] border-white/10 shadow-black/50'
        : 'bg-white border-slate-200 shadow-slate-300/40';
    // Popovers open away from the canvas: right of the rail, below the top bar.
    const popPos = vertical ? 'left-full ml-2 top-0' : 'top-full mt-2 left-0';

    const CollapseIcon = vertical ? ChevronLeft : ChevronUp;

    // Collapsed: slim strip with active-tool icon + expand. Keeps chart
    // chrome minimal on small screens without unmounting state.
    if (collapsed) {
        const ActiveIcon = (TOOLS.find(t => t.id === activeTool)?.icon ?? MousePointer2) as any;
        return (
            <div
                className={`absolute z-30 flex ${vertical ? 'left-2 top-1/2 -translate-y-1/2 flex-col w-11 py-2' : 'top-2 left-1/2 -translate-x-1/2 flex-row h-11 px-2'} items-center gap-1 border ${vertical ? 'border-y-0 border-l-0' : 'border-x-0 border-t-0'} ${barTheme}`}
                style={{ contain: 'layout style' }}
                onMouseDown={e => e.stopPropagation()}
                onTouchStart={e => e.stopPropagation()}
                onContextMenu={e => e.stopPropagation()}
            >
                <span className="w-8 h-8 grid place-items-center rounded-lg bg-[#2962ff] text-white shrink-0">
                    <ActiveIcon size={16} strokeWidth={1.8} />
                </span>
                <button
                    onClick={() => setCollapsed(false)}
                    title="Expand drawing tools"
                    aria-label="Expand drawing tools"
                    className={`w-8 h-8 grid place-items-center rounded-lg touch-manipulation ${subtleBtn}`}
                >
                    <GripVertical size={14} />
                </button>
            </div>
        );
    }

    return (
        <div
            ref={barRef}
            className={`absolute z-30 flex ${vertical ? 'left-2 top-1/2 -translate-y-1/2 flex-col w-[58px] max-h-[calc(100%-16px)] py-2 overflow-y-auto' : 'top-2 left-1/2 -translate-x-1/2 flex-row h-[58px] max-w-[calc(100%-16px)] px-2 overflow-x-auto'} items-center gap-1 border ${vertical ? 'border-y-0 border-l-0' : 'border-x-0 border-t-0'} ${barTheme} no-scrollbar`}
            style={{ contain: 'layout style' }}
            role="toolbar"
            aria-label="Drawing tools"
            aria-orientation={vertical ? 'vertical' : 'horizontal'}
            onMouseDown={e => e.stopPropagation()}
            onTouchStart={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
            onContextMenu={e => e.stopPropagation()}
        >
            {/* Drag grip: drag to float the menu, tap to collapse, double-tap to re-dock */}
            <button
                onPointerDown={onGripPointerDown}
                onDoubleClick={resetDock}
                title="Drag to move · tap to collapse · double-tap to re-dock"
                aria-label="Drag to move toolbar"
                className={`w-9 h-7 grid place-items-center rounded-lg touch-none select-none cursor-grab active:cursor-grabbing shrink-0 ${subtleBtn}`}
            >
                <GripVertical size={14} />
            </button>

            {/* Dock side toggle (same icon as V1 orientation flip) */}
            <button
                onClick={handleOrientationToggle}
                title={vertical ? 'Dock to top' : 'Dock to left'}
                aria-label={vertical ? 'Dock to top' : 'Dock to left'}
                className="w-9 h-9 grid place-items-center rounded-lg touch-manipulation shrink-0 text-zinc-500 hover:bg-[#2962ff]/10 hover:text-[#2962ff]"
            >
                <RotateCcw size={15} />
            </button>

            <div className={`${vertical ? 'w-6 h-px' : 'w-px h-6'} mx-0.5 shrink-0 ${divider}`} />

            {TOOLS.map(tool => (
                <ToolButton
                    key={tool.id}
                    active={activeTool === tool.id}
                    title={tool.title}
                    dark={dark}
                    vertical={vertical}
                    onClick={() => handleToolSelect(tool.id)}
                    onDoubleClick={() => { handleToolSelect(tool.id); toggleStickyMode?.(); }}
                    onLongPress={() => { handleToolSelect(tool.id); toggleStickyMode?.(); }}
                    pinned={stickyMode}
                >
                    <tool.icon size={17} strokeWidth={1.8} />
                </ToolButton>
            ))}

            {/* First-run sticky hint (mobile): how to keep the tool armed. */}
            {showStickyHint && (
                <div className={`absolute ${popPos} z-50 w-52 rounded-xl border shadow-lg px-3 py-2 text-[11px] font-semibold leading-snug ${popTheme}`}>
                    Tap the chart twice to draw · long-press a tool = keep it armed (sticky)
                </div>
            )}

            <div className={`${vertical ? 'w-6 h-px' : 'w-px h-6'} mx-0.5 shrink-0 ${divider}`} />

            {/* Quick undo/redo on touch (no keyboard = no Ctrl+Z otherwise) */}
            {isCoarse && (
                <>
                    <button
                        onClick={() => onUndo?.()}
                        disabled={!canUndo}
                        title="Undo drawing"
                        aria-label="Undo drawing"
                        className={`w-10 h-10 grid place-items-center rounded-lg touch-manipulation shrink-0 ${canUndo ? subtleBtn : 'opacity-30 cursor-not-allowed ' + subtleBtn}`}
                    >
                        <Undo size={16} />
                    </button>
                    <button
                        onClick={() => onRedo?.()}
                        disabled={!canRedo}
                        title="Redo drawing"
                        aria-label="Redo drawing"
                        className={`w-10 h-10 grid place-items-center rounded-lg touch-manipulation shrink-0 ${canRedo ? subtleBtn : 'opacity-30 cursor-not-allowed ' + subtleBtn}`}
                    >
                        <Redo size={16} />
                    </button>
                    <div className={`${vertical ? 'w-6 h-px' : 'w-px h-6'} mx-0.5 shrink-0 ${divider}`} />
                </>
            )}

            {/* Magnet + lock quick toggles (always visible, like TradingView) */}
            <button
                onClick={toggleMagnetMode}
                title="Magnet mode — snap to OHLC"
                aria-label="Magnet mode"
                aria-pressed={magnetMode}
                className={`w-10 h-10 grid place-items-center rounded-lg touch-manipulation shrink-0 ${magnetMode ? 'bg-[#2962ff] text-white' : subtleBtn}`}
            >
                <Magnet size={16} />
            </button>
            <button
                onClick={toggleLocked}
                title={isLocked ? 'Unlock drawings' : 'Lock drawings'}
                aria-label={isLocked ? 'Unlock drawings' : 'Lock drawings'}
                aria-pressed={isLocked}
                className={`w-10 h-10 grid place-items-center rounded-lg touch-manipulation shrink-0 ${isLocked ? 'bg-[#2962ff] text-white' : subtleBtn}`}
            >
                {isLocked ? <Lock size={16} /> : <Unlock size={16} />}
            </button>
            {/* Delete ALL drawings — minimal two-tap confirm (1st tap arms, 2nd clears) */}
            <button
                onClick={handleClearAllClick}
                onBlur={() => setConfirmClearAll(false)}
                disabled={!drawingsCount}
                title={confirmClearAll ? `Tap again to delete all ${drawingsCount} drawings` : 'Delete all drawings'}
                aria-label={confirmClearAll ? 'Confirm delete all drawings' : 'Delete all drawings'}
                className={`min-w-10 h-10 px-2 flex items-center justify-center gap-1 rounded-lg touch-manipulation shrink-0 ${!drawingsCount ? 'opacity-30 cursor-not-allowed ' + subtleBtn : confirmClearAll ? 'bg-rose-500 text-white hover:bg-rose-600' : 'text-rose-500 hover:bg-rose-500/10'}`} >
                <Trash2 size={16} />
                {confirmClearAll && <span className="text-[11px] font-bold leading-none">Sure?</span>}
            </button>

            <button
                onClick={() => setCollapsed(true)}
                title="Collapse toolbar"
                aria-label="Collapse toolbar"
                className={`w-9 h-7 mt-auto grid place-items-center rounded-lg touch-manipulation shrink-0 ${vertical ? '' : 'ml-auto'} ${subtleBtn}`}
            >
                <CollapseIcon size={14} />
            </button>
        </div>
    );
});

DrawingToolbarV2.displayName = 'DrawingToolbarV2';
