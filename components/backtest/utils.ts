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
    // Rays in Backtest Lab are intentionally locked to a horizontal line.
    // The second point only controls placement; it does not change angle.
    const horizontalEndX = x2 >= x1 ? containerWidth : 0;
    return { x1, y1, x2: horizontalEndX, y2: y1 };
};

export const calculateFibLevels = (y1: number, y2: number) => {
    const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    const diff = y2 - y1;
    return levels.map(level => ({
        level,
        y: y1 + diff * level
    }));
};
