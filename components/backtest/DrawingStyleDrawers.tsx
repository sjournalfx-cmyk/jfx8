import React, { useEffect, useRef, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import Drawer from '../ui/Drawer';

// ── Drawing style drawers (Color / Width / Line style) ─────────────────────
// Shared bottom sheets opened from the selection pill in BacktestLab and
// TradeReplayOverlay. One implementation so both surfaces stay identical.
//
// Color model: opacity is encoded as the alpha channel of the hex color
// (#RRGGBBAA), which canvas fill/strokeStyle and SVG stroke accept natively —
// no schema change, no migration. The slider only rewrites alpha; swatches
// only rewrite rgb, so opacity survives color picks (TradingView behavior).

// Grayscale row (matches the reference picker top row).
export const STYLE_GRAYSCALE = [
    '#FFFFFF', '#F5F5F5', '#E0E0E0', '#BDBDBD', '#9E9E9E',
    '#757575', '#616161', '#424242', '#212121', '#000000',
];

// Hue columns: [saturated, tint1, tint2, tint3, shade1, shade2, shade3].
// Matches the reference picker (10 hue columns x 7 rows).
export const STYLE_HUES: string[][] = [
    ['#EF4444', '#FCA5A5', '#FECACA', '#FEE2E2', '#DC2626', '#B91C1C', '#7F1D1D'],
    ['#F97316', '#FDBA74', '#FED7AA', '#FFEDD5', '#EA580C', '#C2410C', '#7C2D12'],
    ['#EAB308', '#FDE047', '#FEF08A', '#FEF9C3', '#CA8A04', '#A16207', '#713F12'],
    ['#22C55E', '#86EFAC', '#BBF7D0', '#DCFCE7', '#16A34A', '#15803D', '#14532D'],
    ['#14B8A6', '#5EEAD4', '#99F6E4', '#CCFBF1', '#0D9488', '#0F766E', '#134E4A'],
    ['#0EA5E9', '#7DD3FC', '#BAE6FD', '#E0F2FE', '#0284C7', '#0369A1', '#0C4A6E'],
    ['#3B82F6', '#93C5FD', '#BFDBFE', '#DBEAFE', '#2563EB', '#1D4ED8', '#1E3A8A'],
    ['#8B5CF6', '#C4B5FD', '#DDD6FE', '#EDE9FE', '#7C3AED', '#6D28D9', '#4C1D95'],
    ['#A855F7', '#D8B4FE', '#E9D5FF', '#F3E8FF', '#9333EA', '#7E22CE', '#581C87'],
    ['#EC4899', '#F9A8D4', '#FBCFE8', '#FCE7F3', '#DB2777', '#BE185D', '#831843'],
];

export const WIDTH_OPTIONS = [1, 2, 3, 4];

export const STYLE_OPTIONS = [
    { key: 'solid' as const, label: 'Line' },
    { key: 'dashed' as const, label: 'Dashed line' },
    { key: 'dotted' as const, label: 'Dotted line' },
];

export type LineStyleKey = 'solid' | 'dashed' | 'dotted';

// ── Hex helpers (alpha lives in the color string) ──────────────────────────

function parseHex(color: string): [number, number, number, number] | null {
    let h = color.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(h)) h = h.split('').map(ch => ch + ch).join('') + 'FF';
    else if (/^[0-9a-fA-F]{6}$/.test(h)) h += 'FF';
    else if (!/^[0-9a-fA-F]{8}$/.test(h)) return null;
    const n = parseInt(h, 16);
    return [(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const to2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0').toUpperCase();

/** #RRGGBB base (alpha stripped), uppercased. Falls back to #2962FF. */
export function rgbOf(color: string): string {
    const p = parseHex(color);
    if (!p) return '#2962FF';
    return `#${to2(p[0])}${to2(p[1])}${to2(p[2])}`;
}

/** Alpha 0..1. Missing/invalid alpha means fully opaque. */
export function alphaOf(color: string): number {
    const p = parseHex(color);
    if (!p) return 1;
    return p[3] / 255;
}

/** Combine an rgb hex with an alpha 0..1 into #RRGGBBAA. */
export function withAlpha(color: string, alpha01: number): string {
    const p = parseHex(color);
    if (!p) return `#2962FF${to2(alpha01 * 255)}`;
    return `#${to2(p[0])}${to2(p[1])}${to2(p[2])}${to2(alpha01 * 255)}`;
}

/** Same rgb ignoring alpha/case — drives the selected ring. */
export function sameRgb(a: string, b: string): boolean {
    return rgbOf(a) === rgbOf(b);
}

// ── Shared bits ────────────────────────────────────────────────────────────

function swatchClass(selected: boolean, isDarkMode: boolean): string {
    return `aspect-square w-full rounded-[7px] touch-manipulation active:scale-90 transition-transform ${
        selected
            ? 'ring-2 ring-[#2962FF] scale-105'
            : 'ring-1 ring-white/20'
    } ${isDarkMode ? 'ring-offset-black' : 'ring-offset-white'}`;
}

interface StyleDrawerShell {
    open: boolean;
    onClose: () => void;
    isDarkMode: boolean;
    subtitle?: string;
}

// ── Color ──────────────────────────────────────────────────────────────────

interface ColorDrawerProps extends StyleDrawerShell {
    /** Current color (may carry alpha). */
    value: string;
    /** Live-apply. Drawer stays open — caller must NOT close here. */
    onPick: (color: string) => void;
    /** Haptic tick; called on swatch/custom picks only (never slider drags). */
    buzz?: (ms: number) => void;
}

export const ColorDrawer: React.FC<ColorDrawerProps> = ({ open, onClose, isDarkMode, subtitle, value, onPick, buzz }) => {
    const [alphaPct, setAlphaPct] = useState(100);
    const [custom, setCustom] = useState('#14B8A6');
    const nativePickerRef = useRef<HTMLInputElement>(null);

    // Re-sync the slider every time the drawer opens (stays put while open so
    // swatch picks preserve the current opacity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { if (open) setAlphaPct(Math.round(alphaOf(value) * 100)); }, [open]);

    const pickSwatch = (hex: string) => {
        onPick(withAlpha(hex, alphaPct / 100));
        buzz?.(8);
    };
    const onSlider = (pct: number) => {
        setAlphaPct(pct);
        onPick(withAlpha(rgbOf(value), pct / 100));
    };
    const onCustom = (hex: string) => {
        setCustom(hex);
        onPick(withAlpha(hex, alphaPct / 100));
        buzz?.(8);
    };

    return (
        <Drawer open={open} onClose={onClose} title="Line color" subtitle={subtitle} isDarkMode={isDarkMode}>
            {/* Grayscale row */}
            <div className="grid grid-cols-10 gap-1 mb-1.5">
                {STYLE_GRAYSCALE.map(hex => (
                    <button
                        key={hex}
                        onClick={() => pickSwatch(hex)}
                        aria-label={`Color ${hex}`}
                        className={swatchClass(sameRgb(hex, value), isDarkMode)}
                        style={{ backgroundColor: hex }}
                    />
                ))}
            </div>
            {/* Hue grid */}
            <div className="grid grid-cols-10 gap-1">
                {STYLE_HUES.map(col =>
                    col.map(hex => (
                        <button
                            key={hex}
                            onClick={() => pickSwatch(hex)}
                            aria-label={`Color ${hex}`}
                            className={swatchClass(sameRgb(hex, value), isDarkMode)}
                            style={{ backgroundColor: hex }}
                        />
                    ))
                )}
            </div>
            {/* Custom color */}
            <div className="flex items-center gap-2 mt-3">
                <button
                    onClick={() => nativePickerRef.current?.click()}
                    aria-label="Custom color"
                    className="w-9 h-9 rounded-[7px] ring-1 ring-white/20 touch-manipulation active:scale-90 transition-transform"
                    style={{ backgroundColor: custom }}
                />
                <button
                    onClick={() => nativePickerRef.current?.click()}
                    aria-label="Pick a custom color"
                    className={`w-9 h-9 rounded-[7px] grid place-items-center touch-manipulation active:scale-95 ${isDarkMode ? 'bg-white/[0.06] text-zinc-200' : 'bg-slate-100 text-slate-700'}`}
                >
                    <Plus size={18} />
                </button>
                <input
                    ref={nativePickerRef}
                    type="color"
                    value={rgbOf(custom)}
                    onChange={(e) => onCustom(e.target.value)}
                    className="sr-only"
                    aria-hidden
                    tabIndex={-1}
                />
            </div>
            {/* Opacity */}
            <p className={`mt-3 mb-1 text-[11px] font-bold ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Opacity</p>
            <div className="flex items-center gap-3 min-h-[44px]">
                <input
                    type="range"
                    min={0}
                    max={100}
                    value={alphaPct}
                    onChange={(e) => onSlider(Number(e.target.value))}
                    aria-label="Opacity"
                    className="flex-1 accent-[#2962FF] touch-manipulation"
                />
                <span className={`min-w-[64px] text-center text-sm font-black tabular-nums px-2 py-1.5 rounded-xl border ${isDarkMode ? 'border-white/10 text-white' : 'border-slate-200 text-slate-900'}`}>
                    {alphaPct}%
                </span>
            </div>
        </Drawer>
    );
};

// ── Width ──────────────────────────────────────────────────────────────────

interface WidthDrawerProps extends StyleDrawerShell {
    value: number;
    /** Apply + caller closes the drawer (single-tap action). */
    onPick: (width: number) => void;
}

export const WidthDrawer: React.FC<WidthDrawerProps> = ({ open, onClose, isDarkMode, subtitle, value, onPick }) => (
    <Drawer open={open} onClose={onClose} title="Line width" subtitle={subtitle} isDarkMode={isDarkMode} maxHeight="max-h-[60dvh]">
        <div className="flex flex-col gap-1.5">
            {WIDTH_OPTIONS.map(w => {
                const active = value === w;
                return (
                    <button
                        key={w}
                        onClick={() => onPick(w)}
                        aria-label={`${w}px line width`}
                        className={`min-h-[52px] rounded-2xl flex items-center gap-3 px-4 touch-manipulation active:scale-[0.98] transition-colors ${active ? 'bg-[#2962FF] text-white' : (isDarkMode ? 'bg-white/[0.06] text-zinc-200' : 'bg-slate-100 text-slate-700')}`}
                    >
                        <span className="w-8 rounded-full bg-current shrink-0" style={{ height: Math.max(1, w) }} />
                        <span className="text-sm font-black">{w}px</span>
                        {active && <Check size={16} className="ml-auto" />}
                    </button>
                );
            })}
        </div>
    </Drawer>
);

// ── Line style ─────────────────────────────────────────────────────────────

interface LineStyleDrawerProps extends StyleDrawerShell {
    value: LineStyleKey;
    /** Apply + caller closes the drawer (single-tap action). */
    onPick: (style: LineStyleKey) => void;
}

const STYLE_BORDER_CLS: Record<LineStyleKey, string> = {
    solid: 'border-solid',
    dashed: 'border-dashed',
    dotted: 'border-dotted',
};

export const LineStyleDrawer: React.FC<LineStyleDrawerProps> = ({ open, onClose, isDarkMode, subtitle, value, onPick }) => (
    <Drawer open={open} onClose={onClose} title="Line style" subtitle={subtitle} isDarkMode={isDarkMode} maxHeight="max-h-[60dvh]">
        <div className="flex flex-col gap-1.5">
            {STYLE_OPTIONS.map(st => {
                const active = value === st.key;
                return (
                    <button
                        key={st.key}
                        onClick={() => onPick(st.key)}
                        aria-label={`${st.label} line style`}
                        className={`min-h-[52px] rounded-2xl flex items-center gap-3 px-4 touch-manipulation active:scale-[0.98] transition-colors ${active ? 'bg-[#2962FF] text-white' : (isDarkMode ? 'bg-white/[0.06] text-zinc-200' : 'bg-slate-100 text-slate-700')}`}
                    >
                        <span className={`w-8 border-t-[3px] border-current shrink-0 ${STYLE_BORDER_CLS[st.key]}`} />
                        <span className="text-sm font-black">{st.label}</span>
                        {active && <Check size={16} className="ml-auto" />}
                    </button>
                );
            })}
        </div>
    </Drawer>
);
