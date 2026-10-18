import { describe, it, expect } from 'vitest';
import { rgbOf, alphaOf, withAlpha, sameRgb, STYLE_GRAYSCALE, STYLE_HUES, WIDTH_OPTIONS, STYLE_OPTIONS } from './DrawingStyleDrawers';

describe('DrawingStyleDrawers hex/alpha helpers', () => {
    it('rgbOf strips alpha and normalizes case', () => {
        expect(rgbOf('#2962ff')).toBe('#2962FF');
        expect(rgbOf('#2962ff80')).toBe('#2962FF');
        expect(rgbOf('#fff')).toBe('#FFFFFF');
        expect(rgbOf('#ffffffff')).toBe('#FFFFFF');
    });

    it('rgbOf falls back for garbage', () => {
        expect(rgbOf('not-a-color')).toBe('#2962FF');
        expect(rgbOf('')).toBe('#2962FF');
    });

    it('alphaOf reads the alpha channel, defaulting to opaque', () => {
        expect(alphaOf('#2962ff')).toBe(1);
        expect(alphaOf('#2962FF80')).toBeCloseTo(0x80 / 255, 5);
        expect(alphaOf('#2962FF00')).toBe(0);
        expect(alphaOf('garbage')).toBe(1);
    });

    it('withAlpha combines rgb + alpha without touching rgb', () => {
        expect(withAlpha('#2962FF', 1)).toBe('#2962FFFF');
        expect(withAlpha('#2962FF', 0.5)).toBe('#2962FF80');
        // Re-alphaing an already-alpha color replaces (never stacks).
        expect(withAlpha('#2962FF80', 1)).toBe('#2962FFFF');
        expect(withAlpha('#2962FF80', 0)).toBe('#2962FF00');
    });

    it('slider round-trips: rgb preserved, alpha exact at 0/50/100', () => {
        expect(withAlpha('#FF4F01', 0)).toBe('#FF4F0100');
        expect(withAlpha('#FF4F01', 1)).toBe('#FF4F01FF');
        const half = withAlpha('#10B981', 0.5);
        expect(rgbOf(half)).toBe('#10B981');
        expect(alphaOf(half)).toBeCloseTo(0.5, 2);
    });

    it('sameRgb ignores alpha and case', () => {
        expect(sameRgb('#2962ff', '#2962FFFF')).toBe(true);
        expect(sameRgb('#2962ff40', '#2962FF')).toBe(true);
        expect(sameRgb('#2962ff', '#FF4F01')).toBe(false);
    });

    it('palette data matches the reference picker shape', () => {
        expect(STYLE_GRAYSCALE).toHaveLength(10);
        expect(STYLE_HUES).toHaveLength(10);
        for (const col of STYLE_HUES) expect(col).toHaveLength(7);
        // Every entry is a valid 6-digit hex.
        for (const hex of [...STYLE_GRAYSCALE, ...STYLE_HUES.flat()]) {
            expect(hex).toMatch(/^#[0-9A-F]{6}$/);
        }
    });

    it('width/style options match the supported model', () => {
        expect(WIDTH_OPTIONS).toEqual([1, 2, 3, 4]);
        expect(STYLE_OPTIONS.map(o => o.key)).toEqual(['solid', 'dashed', 'dotted']);
    });
});
