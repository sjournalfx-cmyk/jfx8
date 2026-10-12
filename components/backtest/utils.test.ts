import { describe, it, expect } from 'vitest';
import { getRayCoordinates, extendSegmentToBounds, getDrawingMeasure, formatMeasureLabel, calculateFibLevels } from './utils';

describe('Backtest Drawing Utils', () => {
    describe('getRayCoordinates', () => {
        it('extends at the drag angle (TradingView parity), not horizontal', () => {
            // p1=(100,100) -> p2=(200,250): direction (100,150) hits bottom (y=500) first.
            const result = getRayCoordinates(100, 100, 200, 250, 1000, 500);
            expect(result.x1).toBe(100);
            expect(result.y1).toBe(100);
            expect(result.y2).toBe(500);
            expect(result.x2).toBeGreaterThan(100);
            expect(result.x2).toBeLessThan(1000);
        });

        it('extends backwards-angled rays to the left edge', () => {
            // p1=(300,150) -> p2=(200,250): direction (-100,100) hits x=0 first.
            const result = getRayCoordinates(300, 150, 200, 250, 1000, 500);
            expect(result.x2).toBe(0);
            expect(result.y2).toBeGreaterThan(150);
        });

        it('falls back to horizontal for a zero-length drag', () => {
            const result = getRayCoordinates(100, 100, 100, 100, 1000, 500);
            expect(result.x2).toBe(1000);
            expect(result.y2).toBe(100);
        });
    });

    describe('extendSegmentToBounds', () => {
        it('returns the segment unchanged without extend flags', () => {
            expect(extendSegmentToBounds(10, 10, 50, 50, 500, 500, false, false))
                .toEqual({ x1: 10, y1: 10, x2: 50, y2: 50 });
        });

        it('extends right to the canvas edge', () => {
            const r = extendSegmentToBounds(10, 250, 100, 250, 500, 500, false, true);
            expect(r.x1).toBe(10);
            expect(r.x2).toBe(500);
            expect(r.y2).toBe(250);
        });
    });

    describe('getDrawingMeasure / formatMeasureLabel', () => {
        it('computes points, percent and bar count', () => {
            const m = getDrawingMeasure(100, 101, 5, 15);
            expect(m.points).toBeCloseTo(1);
            expect(m.pct).toBeCloseTo(1);
            expect(m.bars).toBe(10);
            expect(formatMeasureLabel(m)).toContain('bars');
        });
    });

    describe('calculateFibLevels', () => {
        it('returns correct 50% level', () => {
            const levels = calculateFibLevels(100, 200);
            const level50 = levels.find(l => l.level === 0.5);
            expect(level50?.y).toBe(150);
        });
    });
});
