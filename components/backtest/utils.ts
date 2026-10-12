import { Point } from './types';

// TradingView-style time anchoring: map a wall-clock timestamp to a fractional
// bar index ("logical") on the loaded series via binary search. When the
// timeframe changes, drawings keep their original timestamps; interpolating
// between the *neighbouring* bars keeps them pinned in place even across
// weekend/session gaps, where naive extrapolation from the last bar drifts
// them off-screen (they appear to vanish).
export const timeToLogicalIndex = (candles: { time: number }[], time: number): number => {
    if (!candles || candles.length === 0) return 0;
    if (candles.length === 1) return 0;

    const last = candles.length - 1;

    // Outside the series: extrapolate using the local interval at that edge.
    if (time <= candles[0].time) {
        const step = Math.max(1, candles[1].time - candles[0].time);
        return (time - candles[0].time) / step;
    }
    if (time >= candles[last].time) {
        const step = Math.max(1, candles[last].time - candles[last - 1].time);
        return last + (time - candles[last].time) / step;
    }

    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (candles[mid].time <= time) lo = mid;
        else hi = mid;
    }
    const span = Math.max(1, candles[hi].time - candles[lo].time);
    return lo + (time - candles[lo].time) / span;
};

// Nearest existing bar for a timestamp (used to move the replay cursor to the
// same market moment after a timeframe/symbol data load).
export const timeToNearestBarIndex = (candles: { time: number }[], time?: number | null): number | null => {
    if (!candles || candles.length === 0 || time === undefined || time === null || !isFinite(time)) return null;
    const logical = timeToLogicalIndex(candles, time);
    return Math.max(0, Math.min(candles.length - 1, Math.round(logical)));
};

export const getRayCoordinates = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    containerWidth: number,
    containerHeight: number
) => {
    // TradingView-style ray: starts at p1 and extends infinitely in the
    // direction of p1 -> p2 at the drag angle (not forced horizontal).
    // We intersect the ray with the canvas bounds and clamp there.
    let dx = x2 - x1;
    let dy = y2 - y1;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
        return { x1, y1, x2: containerWidth, y2: y1 };
    }
    const len = Math.hypot(dx, dy);
    dx /= len;
    dy /= len;
    let t = Infinity;
    if (dx > 1e-9) t = Math.min(t, (containerWidth - x1) / dx);
    else if (dx < -1e-9) t = Math.min(t, (0 - x1) / dx);
    if (dy > 1e-9) t = Math.min(t, (containerHeight - y1) / dy);
    else if (dy < -1e-9) t = Math.min(t, (0 - y1) / dy);
    if (!isFinite(t) || t < 0) t = Math.max(containerWidth, containerHeight);
    return { x1, y1, x2: x1 + dx * t, y2: y1 + dy * t };
};

// Extend a finite segment (trendline) past its endpoints when extendLeft /
// extendRight are set — TradingView "Extend line" behaviour. Returns the
// (possibly extended) endpoints clipped to the canvas bounds.
export const extendSegmentToBounds = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    containerWidth: number,
    containerHeight: number,
    extendLeft: boolean,
    extendRight: boolean
) => {
    if (!extendLeft && !extendRight) return { x1, y1, x2, y2 };
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return { x1, y1, x2, y2 };
    const clip = (px: number, py: number, vx: number, vy: number): number => {
        let t = Infinity;
        if (vx > 1e-9) t = Math.min(t, (containerWidth - px) / vx);
        else if (vx < -1e-9) t = Math.min(t, (0 - px) / vx);
        if (vy > 1e-9) t = Math.min(t, (containerHeight - py) / vy);
        else if (vy < -1e-9) t = Math.min(t, (0 - py) / vy);
        return isFinite(t) && t > 0 ? t : 0;
    };
    let nx1 = x1, ny1 = y1, nx2 = x2, ny2 = y2;
    // "Right" = direction p1 -> p2, "left" = opposite.
    if (extendRight) {
        const t = clip(x1, y1, dx, dy);
        if (t > 0) { nx2 = x1 + dx * t; ny2 = y1 + dy * t; }
    }
    if (extendLeft) {
        const t = clip(x2, y2, -dx, -dy);
        if (t > 0) { nx1 = x2 - dx * t; ny1 = y2 - dy * t; }
    }
    return { x1: nx1, y1: ny1, x2: nx2, y2: ny2 };
};

// Live measurement readout while drawing (TradingView-style floating tag).
// Returns price-point delta, percent move off p1, and bar count between points.
export const getDrawingMeasure = (
    p1Price: number,
    p2Price: number,
    p1Logical?: number,
    p2Logical?: number
): { points: number; pct: number; bars: number } => {
    const points = p2Price - p1Price;
    const pct = p1Price !== 0 ? (points / Math.abs(p1Price)) * 100 : 0;
    const bars = (p1Logical !== undefined && p2Logical !== undefined)
        ? Math.abs(Math.round(p2Logical) - Math.round(p1Logical))
        : 0;
    return { points, pct, bars };
};

export const formatMeasureLabel = (m: { points: number; pct: number; bars: number }): string => {
    const sign = m.points > 0 ? '+' : '';
    const pts = `${sign}${m.points.toFixed(5).replace(/\.?0+$/, '')}`;
    const pct = `(${sign}${m.pct.toFixed(2)}%)`;
    return `${pts} ${pct} · ${m.bars} bars`;
};

export const calculateFibLevels = (y1: number, y2: number) => {
    const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    const diff = y2 - y1;
    return levels.map(level => ({
        level,
        y: y1 + diff * level
    }));
};

// Minimum box width for the Long/Short position tool: just wide enough that
// the 3 entry-line dots (left edge, center entry, right edge) touch each
// other. The dots sit w/2 apart with radius r, so they touch at w = 4r
// (r = 6 mouse, 8.5 touch).
export const positionToolMinWidth = (isCoarse: boolean): number =>
    isCoarse ? 34 : 24;
