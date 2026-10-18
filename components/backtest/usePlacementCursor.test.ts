// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import { usePlacementCursor, AIM_TAP_SLOP_PX, AIM_TOUCH_OFFSET_PX, computeAimOffset, computeAimGap, PlacementCursorPoint } from './usePlacementCursor';

// Identity resolver: screen px pass straight through as data coords.
const resolver = (x: number, y: number): PlacementCursorPoint => ({
    x, y, time: x, price: y, logical: x, snapped: false,
});

function harness() {
    let api: ReturnType<typeof usePlacementCursor> | null = null;
    const Probe = () => {
        api = usePlacementCursor(resolver);
        return null;
    };
    render(React.createElement(Probe));
    if (!api) throw new Error('hook did not mount');
    const get = () => api as NonNullable<typeof api>;
    return get;
}

describe('usePlacementCursor (TV aim model)', () => {
    it(`resolves the cursor ${AIM_TOUCH_OFFSET_PX}px above the finger (no thumb occlusion)`, () => {
        const get = harness();
        let c: PlacementCursorPoint | null = null;
        act(() => { c = get().beginAim(7, 100, 200); });
        // Dot renders above the finger, but carries the offset position's data.
        expect(c).toMatchObject({ x: 100, y: 200 - AIM_TOUCH_OFFSET_PX, time: 100, price: 200 - AIM_TOUCH_OFFSET_PX });
        expect(get().phase).toBe('aim-p1');
    });

    it('tap commits exactly what was shown (no lift re-resolve)', () => {
        const get = harness();
        act(() => { get().beginAim(7, 100, 200); });

        let kind: unknown = null;
        act(() => { kind = get().endAim(7, 103, 204); }); // ~5px drift
        expect(kind).toBe('tap');
        // Cursor stays at the touch-down position — the drawing pastes
        // exactly where the dot was, it never shifts on lift.
        expect(get().cursorRef.current).toMatchObject({ x: 100, y: 200 - AIM_TOUCH_OFFSET_PX });
    });

    it('drag beyond slop classifies as drag and keeps tracking', () => {
        const get = harness();
        act(() => { get().beginAim(3, 50, 50); });
        let c: PlacementCursorPoint | null = null;
        act(() => { c = get().moveAim(3, 50 + AIM_TAP_SLOP_PX + 5, 50); });
        expect(c).toMatchObject({ x: 50 + AIM_TAP_SLOP_PX + 5, y: 12 }); // clamped to top floor

        let kind: unknown = null;
        act(() => { kind = get().endAim(3, 50 + AIM_TAP_SLOP_PX + 5, 50); });
        expect(kind).toBe('drag');
    });

    it('clamps the aim point so the dot never leaves the top edge', () => {
        const get = harness();
        let c: PlacementCursorPoint | null = null;
        act(() => { c = get().beginAim(1, 100, 20); }); // finger near top
        expect(c).toMatchObject({ x: 100, y: 12 });
    });

    it('ignores touches from a foreign identifier', () => {
        const get = harness();
        act(() => { get().beginAim(1, 10, 60); });
        let moved: PlacementCursorPoint | null = null;
        let ended: unknown = 'unset';
        act(() => {
            moved = get().moveAim(2, 999, 999);
            ended = get().endAim(2, 999, 999);
        });
        expect(moved).toBeNull();
        expect(ended).toBeNull();
        // Original gesture still tracked; tap commits the shown position.
        let kind: unknown = null;
        act(() => { kind = get().endAim(1, 11, 61); });
        expect(kind).toBe('tap');
        expect(get().cursorRef.current).toMatchObject({ x: 10, y: 60 - AIM_TOUCH_OFFSET_PX });
    });

    it('phase transitions and reset behave', () => {
        const get = harness();
        act(() => { get().beginAim(9, 0, 200); });
        expect(get().phaseRef.current).toBe('aim-p1');
        act(() => { get().setPhase('aim-p2'); });
        expect(get().phase).toBe('aim-p2');
        // beginAim never demotes an armed phase.
        act(() => { get().beginAim(9, 5, 200); });
        expect(get().phaseRef.current).toBe('aim-p2');
        act(() => { get().reset(); });
        expect(get().phase).toBe('idle');
        expect(get().cursor).toBeNull();
        expect(get().cursorRef.current).toBeNull();
    });

    it('endAim with unknown id returns null and clears nothing tracked', () => {
        const get = harness();
        let kind: unknown = 'unset';
        act(() => { kind = get().endAim(4242, 0, 0); });
        expect(kind).toBeNull();
    });
});

describe('computeAimOffset (proportional thumb gap)', () => {
    it('tracks ~18% of the chart height within clamps', () => {
        expect(computeAimOffset(700)).toBe(126); // typical portrait phone plot
        expect(computeAimOffset(350)).toBe(80); // short landscape plot, floored
        expect(computeAimOffset(1000)).toBe(180); // large plot
        expect(computeAimOffset(200)).toBe(80); // tiny plot, floored
    });

    it('falls back to the fixed offset for unknown height', () => {
        expect(computeAimOffset(0)).toBe(AIM_TOUCH_OFFSET_PX);
        expect(computeAimOffset(-10)).toBe(AIM_TOUCH_OFFSET_PX);
        expect(computeAimOffset(NaN)).toBe(AIM_TOUCH_OFFSET_PX);
    });

    it('honors a host-supplied offset override', () => {
        let api: ReturnType<typeof usePlacementCursor> | null = null;
        const Probe = () => {
            api = usePlacementCursor(resolver, () => 150);
            return null;
        };
        render(React.createElement(Probe));
        if (!api) throw new Error('hook did not mount');
        let c: PlacementCursorPoint | null = null;
        const get = () => api as NonNullable<typeof api>;
        act(() => { c = get().beginAim(1, 100, 400); });
        expect(c).toMatchObject({ x: 100, y: 250 });
    });
});

describe('computeAimGap (adaptive thumb gap)', () => {
    it('gives the full proportional gap mid-chart', () => {
        // Finger at 62% of a 700px plot (like the TV reference): plenty of
        // space below, so the full max gap applies.
        expect(computeAimGap(434, 700)).toBe(126);
    });

    it('shrinks the gap as the finger nears the bottom edge', () => {
        expect(computeAimGap(630, 700)).toBe(70); // 70px of space below
        expect(computeAimGap(670, 700)).toBe(48); // floored at thumb clearance
        expect(computeAimGap(695, 700)).toBe(48); // bottom edge: minimum gap
    });

    it('falls back safely for invalid inputs', () => {
        expect(computeAimGap(NaN, 700)).toBe(126);
        expect(computeAimGap(100, 0)).toBe(AIM_TOUCH_OFFSET_PX);
        expect(computeAimGap(100, NaN)).toBe(AIM_TOUCH_OFFSET_PX);
    });
});
