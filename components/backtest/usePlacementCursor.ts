import { useCallback, useRef, useState } from 'react';

// ── Placement cursor (TradingView-mobile aim model) ─────────────────────────
// Shared state machine for drawing-tool point placement on touch.
//
// Model: while a tool is armed, a single-finger drag moves a decoupled cursor
// (blue dot + crosshair, rendered by CustomChart via the `placementCursor`
// prop).  A tap — lift within TAP SLOP of touch-down — commits the point AT
// THE CURSOR, so the finger never covers the target.  Drags only aim.
//
// Hosts inject `resolveCursor` (screen px -> snapped time/price) so this hook
// stays agnostic of each surface's candle source (replay prefix vs full
// series) and magnet implementation.  All callbacks are referentially stable;
// live values are mirrored in refs so host gesture handlers can depend on
// them without re-subscribing every render.

export interface PlacementCursorPoint {
  /** Plot-area px, same coordinate space as CustomChart previewMouse. */
  x: number;
  y: number;
  time: number;
  price: number;
  logical: number;
  snapped: boolean;
}

export type PlacementPhase = 'idle' | 'aim-p1' | 'aim-p2';

export type ResolvePlacementCursor = (x: number, y: number) => PlacementCursorPoint | null;

interface AimGesture {
  touchId: number;
  startX: number;
  startY: number;
  moved: boolean;
}

/** Lifts within this radius of touch-down count as taps (commit at cursor). */
export const AIM_TAP_SLOP_PX = 12;

/**
 * Vertical touch offset (px): the aim point is resolved ABOVE the finger so
 * the blue dot + crosshair are never occluded by the thumb ("fat finger"
 * problem — same convention as TradingView/Figma mobile). This fixed value
 * is the fallback; hosts normally supply an adaptive gap (proportional to
 * chart height, shrinking near the bottom edge) via getOffsetPx. Because the data point is resolved from the
 * offset position too, the rendered dot always shows exactly what a tap
 * commits — what you see is what you get. Tap-vs-drag classification still
 * uses the raw finger travel, so it is unaffected.
 */
export const AIM_TOUCH_OFFSET_PX = 48;

/** Floor for the offset aim point so the dot never leaves the top edge. */
const MIN_AIM_Y_PX = 12;

/**
 * Proportional gap (TradingView parity): the dot floats ~18% of the chart
 * height above the thumb — clearly visible without feeling detached —
 * clamped so it stays sensible on very short (landscape) or very tall
 * (tablet) plots. Unknown height falls back to the fixed ergonomic offset.
 */
export function computeAimOffset(viewHeightPx: number): number {
  if (!Number.isFinite(viewHeightPx) || viewHeightPx <= 0) return AIM_TOUCH_OFFSET_PX;
  return Math.round(Math.min(220, Math.max(80, viewHeightPx * 0.18)));
}

/**
 * Adaptive gap (TradingView behavior): the gap shrinks as the finger nears
 * the bottom edge — gap equals the space below the finger, capped at the
 * proportional max and floored at thumb clearance — so the dot drops closer
 * to the thumb where there is no room for the full gap, instead of
 * detaching. Mid-chart the full proportional gap applies.
 */
export function computeAimGap(fingerYPx: number, viewHeightPx: number): number {
  const max = computeAimOffset(viewHeightPx);
  if (!Number.isFinite(fingerYPx) || !Number.isFinite(viewHeightPx) || viewHeightPx <= 0) return max;
  return Math.round(Math.min(max, Math.max(AIM_TOUCH_OFFSET_PX, viewHeightPx - fingerYPx)));
}

/** Shift a raw touch y into the visible aim position above the finger. */
function aimY(y: number, offsetPx: number): number {
  return Math.max(y - offsetPx, MIN_AIM_Y_PX);
}

export function usePlacementCursor(
  resolveCursor: ResolvePlacementCursor,
  // Gap provider as a callback receiving the finger y: hosts declare their
  // measured chart height AFTER this hook runs, so the value must be read
  // at event time (a plain number captured here would hit TDZ / go stale
  // on rotation).
  getOffsetPx: (fingerYPx: number) => number = () => AIM_TOUCH_OFFSET_PX,
) {
  const [cursor, setCursor] = useState<PlacementCursorPoint | null>(null);
  const [phase, setPhase] = useState<PlacementPhase>('idle');

  const cursorRef = useRef<PlacementCursorPoint | null>(null);
  const phaseRef = useRef<PlacementPhase>('idle');
  const gestureRef = useRef<AimGesture | null>(null);
  const resolverRef = useRef(resolveCursor);
  resolverRef.current = resolveCursor;
  const offsetRef = useRef(getOffsetPx);
  offsetRef.current = getOffsetPx;

  const setPhaseBoth = useCallback((p: PlacementPhase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const setCursorBoth = useCallback((c: PlacementCursorPoint | null) => {
    cursorRef.current = c;
    setCursor(c);
  }, []);

  /** Touch-down while a tool is armed: seed the cursor, start tracking. */
  const beginAim = useCallback((touchId: number, x: number, y: number): PlacementCursorPoint | null => {
    gestureRef.current = { touchId, startX: x, startY: y, moved: false };
    const c = resolverRef.current(x, aimY(y, offsetRef.current(y)));
    if (c) {
      cursorRef.current = c;
      setCursor(c);
    }
    if (phaseRef.current === 'idle') {
      phaseRef.current = 'aim-p1';
      setPhase('aim-p1');
    }
    return cursorRef.current;
  }, []);

  /** Drag: move the cursor (magnet applied by the host resolver). */
  const moveAim = useCallback((touchId: number, x: number, y: number): PlacementCursorPoint | null => {
    const g = gestureRef.current;
    if (!g || g.touchId !== touchId) return null;
    if (Math.hypot(x - g.startX, y - g.startY) > AIM_TAP_SLOP_PX) g.moved = true;
    const c = resolverRef.current(x, aimY(y, offsetRef.current(y)));
    if (c) {
      cursorRef.current = c;
      setCursor(c);
    }
    return cursorRef.current;
  }, []);

  /**
   * Lift: classify without moving the point.  Returns 'tap' when the finger
   * never left the slop radius, 'drag' when it was an aim-drag, or null
   * when the lift doesn't belong to a tracked aim gesture.
   *
   * Taps deliberately do NOT re-resolve at the lift position: the commit
   * uses exactly what was shown (touch-down / last move tracking), so the
   * drawing never visibly shifts on paste. Drags re-resolve once to park
   * the cursor where the finger lifted.
   */
  const endAim = useCallback((touchId: number, x: number, y: number): 'tap' | 'drag' | null => {
    const g = gestureRef.current;
    if (!g || g.touchId !== touchId) return null;
    gestureRef.current = null;
    if (!g.moved) return 'tap';
    const c = resolverRef.current(x, aimY(y, offsetRef.current(y)));
    if (c) {
      cursorRef.current = c;
      setCursor(c);
    }
    return 'drag';
  }, []);

  /** Disarm: clear cursor, phase and any tracked gesture. */
  const reset = useCallback(() => {
    gestureRef.current = null;
    cursorRef.current = null;
    phaseRef.current = 'idle';
    setCursor(null);
    setPhase('idle');
  }, []);

  return {
    cursor,
    phase,
    cursorRef,
    phaseRef,
    beginAim,
    moveAim,
    endAim,
    setPhase: setPhaseBoth,
    setCursor: setCursorBoth,
    reset,
  };
}
