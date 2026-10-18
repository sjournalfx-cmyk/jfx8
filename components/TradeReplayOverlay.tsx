import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  FlaskConical,
  Play,
  Pause,
  StepBack,
  StepForward,
  ArrowLeftToLine,
  Zap,
  LocateFixed,
  Maximize,
  Minimize,
  ChevronDown,
  Loader2,
  Copy,
  Trash2,
  Lock,
  Unlock,
  Check,
  Palette,
  Minus,
} from 'lucide-react';
import { Trade, Candle } from '../types';
import { Drawing, ToolType } from './backtest/types';
import { ColorDrawer, WidthDrawer, LineStyleDrawer, LineStyleKey } from './backtest/DrawingStyleDrawers';
import { usePlacementCursor, PlacementCursorPoint, computeAimGap } from './backtest/usePlacementCursor';
import CustomChart, { PADDING_RIGHT } from './CustomChart';
import Drawer from './ui/Drawer';
import { DrawingToolbarV2 } from './backtest/DrawingToolbarV2';
import { DrawingLayer } from './backtest/DrawingLayer';

// ─── Props ────────────────────────────────────────────────────────────────────

interface TradeReplayOverlayProps {
  trade: Trade;
  candles: Candle[];
  timeframe: string;
  isDarkMode: boolean;
  onClose: () => void;
  onTimeframeChange?: (tf: string) => void;
  isFetchingTimeframe?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getDrawingsKey = (tradeId: string) => `jfx_trade_replay_drawings_${tradeId}`;

const loadDrawings = (tradeId: string): Drawing[] => {
  try {
    const raw = localStorage.getItem(getDrawingsKey(tradeId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveDrawings = (tradeId: string, drawings: Drawing[]) => {
  try {
    localStorage.setItem(getDrawingsKey(tradeId), JSON.stringify(drawings));
  } catch (e) {
    console.warn('Failed to persist replay drawings:', e);
  }
};

const cloneDrawing = (d: Drawing): Drawing => ({
  ...d,
  p1: { ...d.p1 },
  p2: d.p2 ? { ...d.p2 } : undefined,
});

// When the timeframe (candles array) changes, bar-index (logical) anchors go
// stale. Keep every drawing pinned to its timestamp/price and drop the stale
// index so it re-anchors correctly on the newly loaded bars.
const stripLogicalAnchors = (drawings: Drawing[]): Drawing[] =>
  drawings.map(d => ({
    ...d,
    p1: { time: d.p1.time, price: d.p1.price },
    p2: d.p2 ? { time: d.p2.time, price: d.p2.price } : undefined,
  }));

const parseTradeTimeSec = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return value > 1e11 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return null;
    const ms = Date.parse(t);
    if (Number.isFinite(ms)) return Math.floor(ms / 1000);
    const alt = Date.parse(t.replace(/\./g, '/'));
    return Number.isFinite(alt) ? Math.floor(alt / 1000) : null;
  }
  return null;
};

const findClosestCandleIndex = (candles: Candle[], targetSec: number | null, toleranceMultiple: number | null = null): number => {
  if (targetSec === null || candles.length === 0) return -1;
  let best = -1;
  let minDiff = Infinity;
  for (let i = 0; i < candles.length; i++) {
    const t = candles[i].time;
    if (!Number.isFinite(t)) continue;
    const diff = Math.abs(t - targetSec);
    if (diff < minDiff) { minDiff = diff; best = i; }
  }
  // Optional tolerance: reject a match that is implausibly far away (trade
  // outside the loaded range) so a marker is never pinned to a wrong bar.
  // Mirrors the guard CustomChart uses when it places the arrows, which keeps
  // reveal and marker placement on the same bar.
  if (toleranceMultiple !== null && best >= 0 && candles.length >= 2) {
    const avgInterval = Math.abs(candles[candles.length - 1].time - candles[0].time) / (candles.length - 1);
    if (avgInterval > 0 && minDiff > avgInterval * toleranceMultiple) return -1;
  }
  return best;
};

// Start the replay with context before the entry so the user actually has
// bars to step through (starting at the last bar makes Play/Step dead).
const getReplayStartIndex = (candles: Candle[], trade: Trade): number => {
  if (!candles || candles.length === 0) return 0;
  const entrySec = parseTradeTimeSec((trade as any).openTime ?? (trade as any).open_time);
  const entryIdx = findClosestCandleIndex(candles, entrySec);
  if (entryIdx >= 0) {
    // ~50 bars of context before entry, clamped. If the entry is near the
    // start, begin at 0 so the full run-up is visible.
    return Math.max(0, Math.min(candles.length - 1, entryIdx - 50));
  }
  // No usable entry time: mirror BacktestLab and start near the beginning.
  return Math.min(candles.length - 1, 50);
};

const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

const TOOL_LABELS: Record<string, string> = {
  cursor: 'Cursor', trendline: 'Trend Line', ray: 'Ray', arrow: 'Arrow',
  horizontal: 'Horizontal Line', vertical: 'Vertical Line', rect: 'Rectangle',
  channel: 'Channel', long: 'Long Position', short: 'Short Position',
  fib: 'Fib Retracement', text: 'Text', measure: 'Measure',
};

// ─── Component ────────────────────────────────────────────────────────────────

const TradeReplayOverlay: React.FC<TradeReplayOverlayProps> = ({
  trade,
  candles,
  timeframe,
  isDarkMode,
  onClose,
  onTimeframeChange,
  isFetchingTimeframe,
}) => {
  // ── Replay bar state ─────────────────────────────────────────────────────
  const [currentIndex, setCurrentIndex] = useState<number>(() => getReplayStartIndex(candles, trade));
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playSpeed, setPlaySpeed] = useState<number>(500); // 1.0x
  const [isAutoFollow, setIsAutoFollow] = useState<boolean>(true);
  const [isSelectBarMode, setIsSelectBarMode] = useState<boolean>(false);
  const [selectBarIndex, setSelectBarIndex] = useState<number | null>(null);

  // Timeframe menu state (portaled so overflow ancestors can't clip it)
  const [isTFMenuOpen, setIsTFMenuOpen] = useState<boolean>(false);
  const tfButtonRef = useRef<HTMLButtonElement>(null);
  const [tfMenuPos, setTfMenuPos] = useState<{ top: number; right: number } | null>(null);
  const updateTfMenuPos = useCallback(() => {
    const el = tfButtonRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setTfMenuPos({
      top: r.bottom + 6,
      right: Math.max(8, window.innerWidth - r.right),
    });
  }, []);
  useEffect(() => {
    if (!isTFMenuOpen) return;
    updateTfMenuPos();
    const onReposition = () => updateTfMenuPos();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsTFMenuOpen(false);
    };
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [isTFMenuOpen, updateTfMenuPos]);

  // Fullscreen in landscape
  const [isFullscreenCanvas, setIsFullscreenCanvas] = useState<boolean>(false);

  // Mobile sheets + dock fade (BacktestLab parity: Zap opens a bottom sheet,
  // dock auto-dims in fullscreen after 3s idle, Back long-press = restart).
  const [isSpeedSheetOpen, setIsSpeedSheetOpen] = useState(false);
  // Selection-pill style drawers: which one is open (null = none).
  const [styleDrawer, setStyleDrawer] = useState<'color' | 'width' | 'style' | null>(null);
  const [dockFaded, setDockFaded] = useState(false);
  const dockIdleTimer = useRef<number | null>(null);
  const pokeDock = useCallback(() => {
    setDockFaded(false);
    if (dockIdleTimer.current) window.clearTimeout(dockIdleTimer.current);
    if (isFullscreenCanvas) {
      dockIdleTimer.current = window.setTimeout(() => setDockFaded(true), 3000);
    }
  }, [isFullscreenCanvas]);
  useEffect(() => {
    pokeDock();
    return () => { if (dockIdleTimer.current) window.clearTimeout(dockIdleTimer.current); };
  }, [pokeDock, currentIndex, isPlaying, isFullscreenCanvas]);
  const dockLpTimer = useRef<number | null>(null);
  const dockLpFired = useRef(false);
  const clearDockLp = useCallback(() => {
    if (dockLpTimer.current !== null) { window.clearTimeout(dockLpTimer.current); dockLpTimer.current = null; }
  }, []);
  useEffect(() => () => { clearDockLp(); }, [clearDockLp]);

  // ── Drawing state ────────────────────────────────────────────────────────
  const [drawings, setDrawings] = useState<Drawing[]>(() => loadDrawings(trade.id));
  const [activeTool, setActiveTool] = useState<ToolType>('cursor');
  const [currentDrawing, setCurrentDrawing] = useState<Drawing | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [magnetMode, setMagnetMode] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [hoveredDrawingId, setHoveredDrawingId] = useState<string | null>(null);
  const [stickyMode, setStickyMode] = useState(false);
  const [currentColor, setCurrentColor] = useState('#2962ff');
  const [currentStrokeWidth, setCurrentStrokeWidth] = useState(1);
  const [currentStrokeStyle, setCurrentStrokeStyle] = useState<'solid' | 'dashed' | 'dotted'>('solid');
  const [toolbarOrientation, setToolbarOrientation] = useState<'horizontal' | 'vertical'>('vertical');
  const [snapIndicator, setSnapIndicator] = useState<{ x: number; y: number } | null>(null);
  const [clipboard, setClipboard] = useState<Drawing | null>(null);

  // Tool defaults per tool (so colour/width persist per tool like BacktestLab).
  const [toolDefaults, setToolDefaults] = useState<Record<string, any>>({
    trendline: { color: '#2962ff', strokeWidth: 1, strokeStyle: 'solid' },
    ray: { color: '#2962ff', strokeWidth: 1, strokeStyle: 'solid' },
    arrow: { color: '#2962ff', strokeWidth: 1, strokeStyle: 'solid' },
    rect: { color: '#2962ff', strokeWidth: 1, strokeStyle: 'solid' },
    vertical: { color: '#2962ff', strokeWidth: 1, strokeStyle: 'solid' },
    horizontal: { color: '#2962ff', strokeWidth: 1, strokeStyle: 'solid' },
    long: { color: '#10b981', strokeWidth: 1, strokeStyle: 'solid', rr2: 2 },
    short: { color: '#ef4444', strokeWidth: 1, strokeStyle: 'solid', rr2: 2 },
    fib: { color: '#2962ff', strokeWidth: 1, strokeStyle: 'solid' },
    channel: { color: '#2962ff', strokeWidth: 1, strokeStyle: 'solid' },
    text: { color: '#2962ff', fontSize: 14 },
    measure: { color: '#2962ff', strokeWidth: 1, strokeStyle: 'solid' },
  });

  // Undo/redo stacks
  const [undoStack, setUndoStack] = useState<Drawing[][]>([]);
  const [redoStack, setRedoStack] = useState<Drawing[][]>([]);

  // Drag state (moving / resizing existing drawings)
  const [dragState, setDragState] = useState<{ drawingId: string, handle: 'p1' | 'p2' | 'move' | 'target' | 'stop' | 'entry' } | null>(null);
  const [dragStartPos, setDragStartPos] = useState<any | null>(null);
  const dragMovedRef = useRef(false);

  // Chart + series refs from CustomChart's onCoordinatesChange
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const [tick, setTick] = useState(0);

  const selectedDrawingId = selectedIds.length ? selectedIds[selectedIds.length - 1] : null;
  const selectedDrawing = useMemo(() => drawings.find(d => d.id === selectedDrawingId) || null, [drawings, selectedDrawingId]);

  const isCoarsePointer = useMemo(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches,
    []
  );
  const SNAP_PX = isCoarsePointer ? 24 : 12;

  const hapticTick = useCallback((ms: number = 8) => {
    try { (navigator as any)?.vibrate?.(ms); } catch { /* no-op */ }
  }, []);

  const rafTickRef = useRef<number | null>(null);
  const queueTick = useCallback(() => {
    if (rafTickRef.current !== null) return;
    rafTickRef.current = requestAnimationFrame(() => {
      rafTickRef.current = null;
      setTick(t => t + 1);
    });
  }, []);
  useEffect(() => () => {
    if (rafTickRef.current !== null) cancelAnimationFrame(rafTickRef.current);
  }, []);

  // Track the candles identity we initialised from so a timeframe switch
  // re-anchors drawings and re-seeds the replay cursor (but plain re-renders
  // with a new array identity don't nuke the user's position).
  const candlesKeyRef = useRef<string>(`${trade.id}:${timeframe}:${candles.length}:${candles[0]?.time ?? ''}:${candles[candles.length - 1]?.time ?? ''}`);
  useEffect(() => {
    const key = `${trade.id}:${timeframe}:${candles.length}:${candles[0]?.time ?? ''}:${candles[candles.length - 1]?.time ?? ''}`;
    if (candlesKeyRef.current === key) return;
    candlesKeyRef.current = key;
    if (candles.length > 0) {
      setCurrentIndex(getReplayStartIndex(candles, trade));
      setIsPlaying(false);
      setIsSelectBarMode(false);
      setSelectBarIndex(null);
      setCurrentDrawing(null);
      setDragState(null);
      setDragStartPos(null);
      setStyleDrawer(null);
      setSelectedIds([]);
      // Re-anchor time-pinned drawings onto the new timeframe's bars.
      setDrawings(prev => {
        const stripped = stripLogicalAnchors(prev);
        saveDrawings(trade.id, stripped);
        return stripped;
      });
      setTick(t => t + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, timeframe, trade.id]);

  // Keep selector anchored when entering select-bar mode (do NOT overwrite
  // the drag preview on every currentIndex change).
  useEffect(() => {
    if (isSelectBarMode) {
      setSelectBarIndex(currentIndex);
    } else {
      setSelectBarIndex(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSelectBarMode]);
  // Keep selector clamped when data length changes
  useEffect(() => {
    if (isSelectBarMode && selectBarIndex !== null && candles.length > 0) {
      if (selectBarIndex < 0) setSelectBarIndex(0);
      if (selectBarIndex >= candles.length) setSelectBarIndex(candles.length - 1);
    }
  }, [candles.length, isSelectBarMode, selectBarIndex]);

  // Sliced candles for current replay position (prefix slice so logical
  // indices match the full array).
  const visibleCandles = useMemo(() => {
    if (candles.length === 0) return [];
    const validIdx = Math.min(Math.max(0, currentIndex), candles.length - 1);
    return candles.slice(0, validIdx + 1);
  }, [candles, currentIndex]);

  // Bar indices for entry/exit, resolved once against the FULL candle set with
  // the same parser + tolerance CustomChart uses to place its arrows.  Gating
  // on indices (not on wall-clock time) is what keeps the reveal and the marker
  // on the same bar — the old `new Date(openTime)` compare silently NaN'd on
  // SAST/epoch timestamps and flipped one or more bars off.
  const { entryBarIdx, exitBarIdx } = useMemo(() => {
    if (!trade || candles.length === 0) return { entryBarIdx: -1, exitBarIdx: -1 };
    return {
      entryBarIdx: findClosestCandleIndex(
        candles,
        parseTradeTimeSec((trade as any).openTime ?? (trade as any).open_time),
        50
      ),
      exitBarIdx: findClosestCandleIndex(
        candles,
        parseTradeTimeSec((trade as any).closeTime ?? (trade as any).close_time),
        50
      ),
    };
  }, [trade, candles]);

  // Trade with entry/exit markers appearing realistically as replay advances.
  // Depends on the bar index, not on the (newly allocated) visible slice, so
  // this stops recomputing an object identity on every single tick.
  const activeTradeForReplay = useMemo(() => {
    if (!trade || candles.length === 0) return null;
    // Entry time not resolvable within the loaded range: CustomChart cannot
    // place a trustworthy arrow either (it would pin one to the newest bar and
    // drag it along the edge), so show nothing rather than a wrong marker.
    if (entryBarIdx < 0) return null;
    const currentBar = Math.min(Math.max(0, currentIndex), candles.length - 1);
    // Before entry: hide arrows
    if (currentBar < entryBarIdx) return null;
    // Exit time unresolvable (open trade, or outside the range): never invent an
    // exit marker, so the entry-only form is the truthful state.
    if (exitBarIdx >= 0 && currentBar >= exitBarIdx) return trade;
    // After entry, before exit: show entry arrow only
    return {
      ...trade,
      closeTime: undefined,
      exitPrice: undefined,
    };
  }, [trade, candles.length, currentIndex, entryBarIdx, exitBarIdx]);

  // Y-domain anchors: reserve the entry/exit price range from the very first
  // frame so the vertical scale never rescales at the entry/exit bars.
  const replayPriceAnchors = useMemo(() => {
    if (!trade) return undefined;
    const out: number[] = [];
    for (const p of [trade.entryPrice, trade.exitPrice]) {
      const n = Number(p);
      if (Number.isFinite(n) && n > 0) out.push(n);
    }
    return out.length > 0 ? out : undefined;
  }, [trade]);

  // ── Stepper and Autoplay logic ──────────────────────────────────────────
  const stepForward = useCallback(() => {
    if (candles.length === 0) return;
    if (currentIndex < candles.length - 1) {
      setCurrentIndex(prev => Math.min(candles.length - 1, prev + 1));
      setTick(t => t + 1);
      if (chartRef.current) {
        chartRef.current.timeScale().updateOffsetForNewBar(isAutoFollow);
      }
    } else {
      setIsPlaying(false);
    }
  }, [currentIndex, candles.length, isAutoFollow]);

  const stepBack = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => Math.max(0, prev - 1));
      setTick(t => t + 1);
      if (chartRef.current) {
        chartRef.current.timeScale().updateOffsetForNewBar(isAutoFollow);
      }
    }
  }, [currentIndex, isAutoFollow]);

  const resetReplay = useCallback(() => {
    setIsPlaying(false);
    setCurrentIndex(0);
    setTick(t => t + 1);
    if (chartRef.current) {
      chartRef.current.timeScale().scrollToRealtime();
    }
  }, []);

  const jumpLive = useCallback(() => {
    if (candles.length === 0) return;
    setIsPlaying(false);
    setCurrentIndex(candles.length - 1);
    setTick(t => t + 1);
    if (chartRef.current) chartRef.current.timeScale().scrollToRealtime();
  }, [candles.length]);

  const stepForwardRef = useRef(stepForward);
  stepForwardRef.current = stepForward;

  useEffect(() => {
    let interval: any;
    if (isPlaying) {
      interval = setInterval(() => {
        stepForwardRef.current();
      }, playSpeed);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlaying, playSpeed]);

  // Persist drawings on every change
  const updateDrawings = useCallback((next: Drawing[] | ((prev: Drawing[]) => Drawing[])) => {
    setDrawings(prev => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      saveDrawings(trade.id, resolved);
      return resolved;
    });
    setTick(t => t + 1);
  }, [trade.id]);

  // ── Undo / Redo ──────────────────────────────────────────────────────────
  const pushUndo = useCallback((current: Drawing[]) => {
    setUndoStack(prev => [...prev.slice(-29), current.map(cloneDrawing)]);
    setRedoStack([]);
  }, []);

  const handleUndo = useCallback(() => {
    setUndoStack(prev => {
      if (prev.length === 0) return prev;
      const snapshot = prev[prev.length - 1];
      setRedoStack(r => [...r, drawings.map(cloneDrawing)]);
      updateDrawings(snapshot);
      return prev.slice(0, -1);
    });
  }, [drawings, updateDrawings]);

  const handleRedo = useCallback(() => {
    setRedoStack(prev => {
      if (prev.length === 0) return prev;
      const snapshot = prev[prev.length - 1];
      setUndoStack(u => [...u, drawings.map(cloneDrawing)]);
      updateDrawings(snapshot);
      return prev.slice(0, -1);
    });
  }, [drawings, updateDrawings]);

  // ── Coordinate helpers ───────────────────────────────────────────────────
  const handleCoordinatesChange = useCallback((chart: any, series: any) => {
    const isInitial = !chartRef.current || !seriesRef.current;
    chartRef.current = chart;
    seriesRef.current = series;
    if (isInitial) setTick(t => t + 1);
  }, []);

  const getChartCoordinates = useCallback((x: number, y: number) => {
    if (!chartRef.current || !seriesRef.current) return null;
    const price = seriesRef.current.coordinateToPrice(y);
    const logical = chartRef.current.timeScale().coordinateToLogical(x);
    const time = chartRef.current.timeScale().coordinateToTime(x);
    if (price === null || price === undefined || logical === null || logical === undefined) return null;
    return { time, price, logical };
  }, []);

  // Magnet with pixel snap radius (TradingView): only snaps within SNAP_PX.
  const snapPoint = useCallback((sx: number, sy: number, time: number, price: number, logical?: number): { point: { time: number; price: number; logical?: number }, snapped: boolean, snapY?: number } => {
    if (!magnetMode || !visibleCandles.length) return { point: { time, price, logical }, snapped: false };
    const idx = Math.max(0, Math.min(visibleCandles.length - 1, Math.round(logical ?? 0)));
    const candle = visibleCandles[idx] ?? candles[idx];
    const series = seriesRef.current;
    if (!candle || !series) return { point: { time, price, logical }, snapped: false };
    const levels = [candle.open, candle.high, candle.low, candle.close];
    let best = price; let bestDist = SNAP_PX; let snapY: number | undefined;
    for (const lv of levels) {
      const ly = series.priceToCoordinate(lv);
      if (ly === null || ly === undefined) continue;
      const dist = Math.abs(ly - sy);
      if (dist < bestDist) { bestDist = dist; best = lv; snapY = ly; }
    }
    const snapped = snapY !== undefined;
    return { point: { time: candle.time, price: best, logical: idx }, snapped, snapY };
  }, [magnetMode, visibleCandles, candles, SNAP_PX]);

  const snapToOHLC = useCallback((coords: { time: number; price: number; logical: number }, data: Candle[]) => {
    const idx = Math.round(coords.logical);
    if (idx < 0 || idx >= data.length) return coords;
    const bar = data[idx];
    const prices = [bar.open, bar.high, bar.low, bar.close];
    let nearest = prices[0];
    let minDist = Math.abs(coords.price - nearest);
    for (const p of prices) {
      const d = Math.abs(coords.price - p);
      if (d < minDist) { minDist = d; nearest = p; }
    }
    return { time: bar.time, price: nearest, logical: idx };
  }, []);

  const finishToolAfterDraw = useCallback(() => { if (!stickyMode) setActiveTool('cursor'); }, [stickyMode]);

  const updateDrawingProperty = useCallback((id: string, updates: Partial<Drawing>) => {
    let drawingType: string | undefined;
    setDrawings(prev => {
      const next = prev.map(d => {
        if (d.id === id) { drawingType = d.type; return { ...d, ...updates }; }
        return d;
      });
      saveDrawings(trade.id, next);
      return next;
    });
    setTick(t => t + 1);
    if (drawingType && ((updates as any).color || (updates as any).strokeWidth || (updates as any).strokeStyle)) {
      setToolDefaults(prev => ({
        ...prev,
        [drawingType!]: { ...(prev[drawingType!] || {}), ...updates },
      }));
    }
    if (typeof (updates as any).color === 'string') setCurrentColor((updates as any).color);
  }, [trade.id]);

  // Batch style edit for the style drawers: applies to EVERY selected
  // drawing with a SINGLE history entry (per-id updateDrawingProperty calls
  // would spam undo). Mirrors its toolDefaults + currentColor fan-out.
  const applyStyleToSelection = useCallback((updates: { color?: string; strokeWidth?: number; strokeStyle?: LineStyleKey }) => {
    const ids = selectedIds.length ? selectedIds : (selectedDrawingId ? [selectedDrawingId] : []);
    if (ids.length === 0) return;
    const types = new Set<string>();
    drawings.filter(d => ids.includes(d.id)).forEach(d => types.add(d.type));
    pushUndo(drawings);
    updateDrawings(prev => prev.map(d => (ids.includes(d.id) ? { ...d, ...updates } : d)));
    if ((updates as any).color || (updates as any).strokeWidth || (updates as any).strokeStyle) {
      setToolDefaults(prev => {
        const next = { ...prev };
        types.forEach(t => { next[t] = { ...(next[t] || {}), ...updates }; });
        return next;
      });
    }
    if (typeof (updates as any).color === 'string') setCurrentColor((updates as any).color);
  }, [selectedIds, selectedDrawingId, drawings, pushUndo, updateDrawings, setToolDefaults, setCurrentColor]);

  const handleToolbarColorChange = useCallback((color: string) => {
    if (selectedDrawingId) {
      updateDrawingProperty(selectedDrawingId, { color } as any);
      return;
    }
    setCurrentColor(color);
    if (activeTool !== 'cursor') {
      setToolDefaults(prev => ({
        ...prev,
        [activeTool]: { ...(prev[activeTool] || {}), color },
      }));
    }
  }, [activeTool, selectedDrawingId, updateDrawingProperty]);

  const handleToolbarStrokeWidthChange = useCallback((w: number) => {
    if (selectedDrawingId) { updateDrawingProperty(selectedDrawingId, { strokeWidth: w } as any); return; }
    if (activeTool === 'cursor') return;
    setToolDefaults(prev => ({ ...prev, [activeTool]: { ...(prev[activeTool] || {}), strokeWidth: w } }));
  }, [activeTool, selectedDrawingId, updateDrawingProperty]);

  const handleToolbarStrokeStyleChange = useCallback((s: 'solid' | 'dashed' | 'dotted') => {
    if (selectedDrawingId) { updateDrawingProperty(selectedDrawingId, { strokeStyle: s } as any); return; }
    if (activeTool === 'cursor') return;
    setToolDefaults(prev => ({ ...prev, [activeTool]: { ...(prev[activeTool] || {}), strokeStyle: s } }));
  }, [activeTool, selectedDrawingId, updateDrawingProperty]);

  // ── Drawing interaction handlers (mouse) ─────────────────────────────────
  const placingOneClickRef = useRef<'horizontal' | 'vertical' | null>(null);
  const selectBarMouseDownRef = useRef<{ x: number; y: number } | null>(null);

  const handleMouseUpdate = useCallback((x: number, y: number, coords: { time: number; price: number; logical: number } | null) => {
    setMousePos({ x, y });
    if (!coords) { setSnapIndicator(null); return; }

    if (magnetMode && visibleCandles.length > 0) {
      const res = snapPoint(x, y, coords.time, coords.price, coords.logical);
      if (res.snapped && res.snapY !== undefined) {
        setSnapIndicator({ x, y: res.snapY });
      } else {
        setSnapIndicator(null);
      }
    } else {
      setSnapIndicator(null);
    }

    if (placingOneClickRef.current && coords) {
      // one-click ghost follows the release point; finalised on mouse-up
      return;
    }

    if (currentDrawing && coords) {
      const res = snapPoint(x, y, coords.time, coords.price, coords.logical);
      const snp = res.point;
      if (currentDrawing.type === 'long' || currentDrawing.type === 'short') {
        const isLong = currentDrawing.type === 'long';
        const entryPrice = (currentDrawing as any).entry ?? currentDrawing.p1.price;
        const mousePriceDist = Math.abs(snp.price - entryPrice);
        const defaults = (toolDefaults as any)[currentDrawing.type] || {};
        const rrRatio = defaults.rr2 || 2;
        const vis = visibleCandles.slice(Math.max(0, visibleCandles.length - 20));
        const avgRange = vis.length > 0 ? vis.reduce((s, c) => s + (c.high - c.low), 0) / vis.length : entryPrice * 0.005;
        const risk = mousePriceDist > 0 ? mousePriceDist : (avgRange || entryPrice * 0.005);
        setCurrentDrawing(prev => prev ? {
          ...prev, p2: snp as any,
          target: isLong ? entryPrice + (risk * rrRatio) : entryPrice - (risk * rrRatio),
          stop: isLong ? entryPrice - risk : entryPrice + risk,
        } as any : null);
      } else {
        const nextP2 = currentDrawing.type === 'horizontal'
          ? { ...snp, time: currentDrawing.p1.time, logical: currentDrawing.p1.logical }
          : currentDrawing.type === 'vertical'
            ? { ...snp, price: currentDrawing.p1.price }
            : snp;
        setCurrentDrawing(prev => prev ? { ...prev, p2: nextP2 as any } : null);
      }
    }
  }, [magnetMode, visibleCandles, currentDrawing, snapPoint, toolDefaults]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as Element)?.closest?.('[data-drawing-toolbar]')) return;
    if (!chartRef.current || !seriesRef.current) return;
    if (e.button !== 0) return;
    const rect = chartContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const coords = getChartCoordinates(x, y);
    if (!coords) return;

    if (isSelectBarMode) {
      const foundIdx = Math.max(0, Math.min(candles.length - 1, Math.round(coords.logical as number)));
      if (selectBarIndex !== foundIdx) setSelectBarIndex(foundIdx);
      selectBarMouseDownRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    // Second click finalises a tap-tap drawing at THIS click.
    if (currentDrawing && (currentDrawing.type !== 'horizontal' && currentDrawing.type !== 'vertical')) {
      const res = snapPoint(x, y, coords.time as number, coords.price as number, coords.logical);
      const snapEnd = res.point;
      const fdx = (snapEnd.logical ?? coords.logical ?? 0) - (currentDrawing.p1.logical ?? 0);
      const fdy = (snapEnd.price ?? 0) - (currentDrawing.p1.price ?? 0);
      if (Math.abs(fdx) < 0.5 && Math.abs(fdy) < 1e-9) return;
      const finalized: any = { ...currentDrawing, p2: snapEnd };
      pushUndo(drawings);
      updateDrawings(prev => [...prev, finalized]);
      setSelectedIds([currentDrawing.id]);
      setCurrentDrawing(null);
      hapticTick(8);
      finishToolAfterDraw();
      return;
    }

    if (activeTool === 'cursor') {
      const startedOnDrawing = (e.target as Element)?.closest?.('[data-drawing-hit]');
      const startedOnToolbar = (e.target as Element)?.closest?.('[data-drawing-toolbar]');
      if (startedOnToolbar || startedOnDrawing) return;
      if (selectedDrawingId) setSelectedIds([]);
      return;
    }
    if (isLocked) return;

    const snapRes = snapPoint(x, y, coords.time as number, coords.price as number, coords.logical);
    const snapped = snapRes.point;
    setSnapIndicator(snapRes.snapped && snapRes.snapY !== undefined ? { x, y: snapRes.snapY } : null);
    const toolStyle = (toolDefaults as any)[activeTool] || {};
    let drawingProps: any = {
      id: Date.now().toString(),
      type: activeTool,
      p1: snapped,
      p2: snapped,
      ...toolStyle,
      color: toolStyle.color || currentColor || '#2962ff',
    };
    setIsPlaying(false);

    if (activeTool === 'long' || activeTool === 'short') {
      const isLong = activeTool === 'long';
      const entryPrice = (snapped as any).price;
      const rrRatio = toolStyle.rr2 || 2;
      const vis = visibleCandles.slice(Math.max(0, visibleCandles.length - 20));
      const avgRange = vis.length > 0 ? vis.reduce((s, c) => s + (c.high - c.low), 0) / vis.length : entryPrice * 0.005;
      const defaultRisk = avgRange || entryPrice * 0.005;
      drawingProps.entry = entryPrice;
      drawingProps.target = isLong ? entryPrice + (defaultRisk * rrRatio) : entryPrice - (defaultRisk * rrRatio);
      drawingProps.stop = isLong ? entryPrice - defaultRisk : entryPrice + defaultRisk;
    }

    if (activeTool === 'text') {
      drawingProps.text = drawingProps.text || 'Text';
      pushUndo(drawings);
      updateDrawings(prev => [...prev, drawingProps]);
      setSelectedIds([drawingProps.id]);
      finishToolAfterDraw();
      return;
    }

    setCurrentDrawing(drawingProps);
    placingOneClickRef.current = (activeTool === 'horizontal' || activeTool === 'vertical') ? activeTool : null;
  }, [activeTool, currentDrawing, drawings, isSelectBarMode, selectBarIndex, isLocked, selectedDrawingId, candles.length, getChartCoordinates, snapPoint, toolDefaults, currentColor, visibleCandles, pushUndo, updateDrawings, finishToolAfterDraw, hapticTick]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = chartContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setMousePos({ x, y });
    const coords = getChartCoordinates(x, y);
    if (!coords) return;

    if (isSelectBarMode) {
      const idx = Math.max(0, Math.min(candles.length - 1, Math.round((coords.logical as number) ?? 0)));
      if (selectBarIndex !== idx) setSelectBarIndex(idx);
      return;
    }

    if (dragState && dragStartPos) {
      const startDrag = dragStartPos as any;
      if (typeof startDrag.startClientX === 'number') {
        const movedPx = Math.hypot(e.clientX - startDrag.startClientX, (e.clientY ?? 0) - (startDrag.startClientY ?? 0));
        if (movedPx < 4 && !dragMovedRef.current) return;
        dragMovedRef.current = true;
      } else {
        dragMovedRef.current = true;
      }
      const dPrice = (coords.price as number) - dragStartPos.price;
      const dTime = (coords.time as number) - dragStartPos.time;
      const dLog = ((coords.logical as number) ?? 0) - (dragStartPos.logical ?? 0);
      const initialData = dragStartPos as any;
      setDrawings(prev => prev.map(d => {
        if (d.id !== dragState.drawingId) return d;
        const newD: any = { ...d };
        if (dragState.handle === 'move') {
          const p1Base = initialData.initialP1;
          const p2Base = initialData.initialP2;
          const lockTime = d.type === 'horizontal';
          const lockPrice = d.type === 'vertical';
          const getRebasedPoint = (base: any) => {
            const newLog = base.logical !== undefined ? Math.round(base.logical + (lockTime ? 0 : dLog)) : undefined;
            let newTime = lockTime ? base.time : base.time + dTime;
            if (!lockTime && newLog !== undefined && newLog >= 0 && newLog < candles.length) newTime = candles[newLog].time;
            return { time: newTime, price: base.price + (lockPrice ? 0 : dPrice), logical: newLog };
          };
          newD.p1 = getRebasedPoint(p1Base);
          if (p2Base) newD.p2 = getRebasedPoint(p2Base);
          if (d.type === 'long' || d.type === 'short') {
            newD.entry = (initialData.initialEntry || 0) + dPrice;
            newD.target = (initialData.initialTarget || 0) + dPrice;
            newD.stop = (initialData.initialStop || 0) + dPrice;
          }
        } else if (dragState.handle === 'target') {
          newD.target = coords.price;
        } else if (dragState.handle === 'stop') {
          newD.stop = coords.price;
        } else if (dragState.handle === 'entry') {
          newD.entry = coords.price;
          newD.p1 = { ...newD.p1, price: coords.price };
        } else {
          const snp = snapPoint(x, y, coords.time as number, coords.price as number, coords.logical).point;
          if (dragState.handle === 'p1') {
            if (d.type === 'horizontal') newD.p1 = { ...newD.p1, price: (snp as any).price };
            else if (d.type === 'vertical') newD.p1 = { ...(snp as any), price: newD.p1.price };
            else newD.p1 = snp;
            if (d.type === 'long' || d.type === 'short') newD.entry = (snp as any).price;
          } else if (dragState.handle === 'p2') {
            if (d.type === 'horizontal') newD.p2 = newD.p2 ? { ...newD.p2, price: (snp as any).price } : { ...(snp as any) };
            else newD.p2 = snp;
          }
        }
        return newD;
      }));
      saveDrawings(trade.id, drawings);
      queueTick();
    }
    if (currentDrawing) {
      const snapLive = snapPoint(x, y, coords.time as number, coords.price as number, coords.logical);
      const snp = snapLive.point;
      setSnapIndicator(snapLive.snapped && snapLive.snapY !== undefined ? { x, y: snapLive.snapY } : null);
      if (currentDrawing.type === 'long' || currentDrawing.type === 'short') {
        const isLong = currentDrawing.type === 'long';
        const entryPrice = (currentDrawing as any).entry ?? currentDrawing.p1.price;
        const mousePriceDist = Math.abs((snp as any).price - entryPrice);
        const defaults = (toolDefaults as any)[currentDrawing.type] || {};
        const rrRatio = defaults.rr2 || 2;
        const vis = visibleCandles.slice(Math.max(0, visibleCandles.length - 20));
        const avgRange = vis.length > 0 ? vis.reduce((s, c) => s + (c.high - c.low), 0) / vis.length : entryPrice * 0.005;
        const risk = mousePriceDist > 0 ? mousePriceDist : (avgRange || entryPrice * 0.005);
        setCurrentDrawing(prev => prev ? {
          ...prev, p2: snp as any,
          target: isLong ? entryPrice + (risk * rrRatio) : entryPrice - (risk * rrRatio),
          stop: isLong ? entryPrice - risk : entryPrice + risk,
        } as any : null);
      } else {
        const nextP2 = currentDrawing.type === 'horizontal'
          ? { ...(snp as any), time: currentDrawing.p1.time, logical: currentDrawing.p1.logical }
          : currentDrawing.type === 'vertical'
            ? { ...(snp as any), price: currentDrawing.p1.price }
            : snp;
        setCurrentDrawing(prev => prev ? { ...prev, p2: nextP2 as any } : null);
      }
      queueTick();
    }
  }, [getChartCoordinates, isSelectBarMode, candles, selectBarIndex, dragState, dragStartPos, currentDrawing, snapPoint, toolDefaults, visibleCandles, trade.id, drawings, queueTick]);

  const handleMouseUp = useCallback((e?: React.MouseEvent) => {
    if (isSelectBarMode) {
      const down = selectBarMouseDownRef.current;
      selectBarMouseDownRef.current = null;
      const upX = e?.clientX ?? down?.x ?? null;
      const upY = e?.clientY ?? down?.y ?? null;
      const moved = down && upX !== null && upY !== null ? Math.hypot(upX - down.x, upY - down.y) : 0;
      if (down && moved !== null && moved < 8 && selectBarIndex !== null) {
        setCurrentIndex(selectBarIndex);
        setTick(t => t + 1);
        if (chartRef.current) chartRef.current.timeScale().updateOffsetForNewBar(isAutoFollow);
        setIsSelectBarMode(false);
        setSelectBarIndex(null);
        return;
      }
      if (!down) return;
      return;
    }
    if (dragState && dragMovedRef.current) {
      saveDrawings(trade.id, drawings);
      pushUndo(drawings);
    }
    dragMovedRef.current = false;

    if (currentDrawing) {
      const isOneClickTool = currentDrawing.type === 'horizontal' || currentDrawing.type === 'vertical';
      // Drag-draw (mouseDown-move-up) finalises when the drag exceeded 5px;
      // otherwise keep the tap-tap preview armed for the second click.
      if (chartRef.current && seriesRef.current && mousePos) {
        const p1x = chartRef.current.timeScale().logicalToCoordinate((currentDrawing as any).p1.logical ?? 0) ?? 0;
        const p1y = seriesRef.current.priceToCoordinate((currentDrawing as any).p1.price);
        const dist = Math.sqrt(Math.pow((mousePos.x ?? p1x) - p1x, 2) + Math.pow((mousePos.y ?? p1y) - (p1y ?? 0), 2));
        if (isOneClickTool || dist > 5) {
          pushUndo(drawings);
          updateDrawings(prev => [...prev, currentDrawing as any]);
          setSelectedIds([currentDrawing.id]);
          setCurrentDrawing(null);
          placingOneClickRef.current = null;
          finishToolAfterDraw();
        }
      } else if (isOneClickTool) {
        pushUndo(drawings);
        updateDrawings(prev => [...prev, currentDrawing as any]);
        setSelectedIds([currentDrawing.id]);
        setCurrentDrawing(null);
        placingOneClickRef.current = null;
        finishToolAfterDraw();
      }
    }
    setDragState(null);
    setDragStartPos(null);
    setSnapIndicator(null);
  }, [dragState, drawings, currentDrawing, mousePos, pushUndo, updateDrawings, finishToolAfterDraw, trade.id, isSelectBarMode, selectBarIndex, isAutoFollow]);

  const handleMouseDownHandle = useCallback((e: React.MouseEvent, drawingId: string, handle: 'p1' | 'p2' | 'move' | 'target' | 'stop' | 'entry') => {
    if (isLocked) return;
    if (activeTool !== 'cursor') return;
    const rect = chartContainerRef.current?.getBoundingClientRect();
    let px: number | null = null;
    let py: number | null = null;
    if (rect && typeof e.clientX === 'number' && typeof e.clientY === 'number') {
      px = e.clientX - rect.left;
      py = e.clientY - rect.top;
    } else if (mousePos) {
      px = mousePos.x;
      py = mousePos.y;
    }
    if (px === null || py === null) return;
    setMousePos({ x: px, y: py });
    const coords = getChartCoordinates(px, py);
    if (coords) {
      const drawing = drawings.find(d => d.id === drawingId);
      if (drawing) {
        if (drawing.isLocked) return;
        dragMovedRef.current = false;
        setDragStartPos({
          ...coords,
          startClientX: typeof e.clientX === 'number' ? e.clientX : undefined,
          startClientY: typeof e.clientY === 'number' ? e.clientY : undefined,
          initialP1: { ...drawing.p1 },
          initialP2: drawing.p2 ? { ...drawing.p2 } : undefined,
          initialEntry: (drawing as any).entry,
          initialTarget: (drawing as any).target,
          initialStop: (drawing as any).stop,
        } as any);
        setDragState({ drawingId, handle });
      }
    }
  }, [mousePos, isLocked, activeTool, getChartCoordinates, drawings]);

  const handleDoubleClickDrawing = useCallback((e: React.MouseEvent, drawing: Drawing) => {
    e.stopPropagation();
    setSelectedIds([drawing.id]);
  }, []);

  // ── Touch handling (mirror BacktestLab: tap-tap create, drag move, select-bar) ──
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const touchStartClientRef = useRef<{ x: number; y: number } | null>(null);
  const touchStartTimeRef = useRef(0);
  const touchMovedRef = useRef(false);
  const touchStartDrawingRef = useRef<{ id: string; wasSelected: boolean } | null>(null);
  const lastEmptyTapRef = useRef<{ t: number; x: number; y: number } | null>(null);
  const snapHapticOnRef = useRef(false);

  const getTouchCoords = useCallback((touch: Touch | React.Touch) => {
    const rect = chartContainerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    return { x, y, clientX: touch.clientX, clientY: touch.clientY };
  }, []);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);
  useEffect(() => () => { clearLongPress(); }, [clearLongPress]);

  // ── Placement cursor (TradingView aim model, touch only) ─────────────
  // While a drawing tool is armed on a coarse pointer, single-finger drags
  // move a decoupled cursor (blue dot + crosshair, rendered by CustomChart)
  // and taps commit AT THE CURSOR — the finger never covers the target.
  // Desktop mouse flow below is untouched (aimPlacement is false there).
  // Pause replay the moment a drawing tool is armed: the chart must not
  // scroll new bars under the aiming finger, or the cursor and in-progress
  // drawings visibly drift mid-gesture.
  useEffect(() => {
    if (activeTool !== 'cursor') setIsPlaying(false);
  }, [activeTool]);

  const resolvePlacementCursor = useCallback((x: number, y: number): PlacementCursorPoint | null => {
    if (!chartRef.current || !seriesRef.current) return null;
    const c = getChartCoordinates(x, y);
    if (!c) return null;
    const r = snapPoint(x, y, c.time as number, c.price as number, c.logical);
    // WYSIWYG dot: when magnet snaps, the dot must sit ON the snapped
    // bar — not at the finger's x — or the drawing visibly shifts
    // horizontally the moment it commits.
    let cx = x;
    if (r.snapped) {
      const idx = Math.round((r.point as any).logical ?? (c.logical as number) ?? 0);
      const bx = chartRef.current.timeScale().logicalToCoordinate(idx);
      if (typeof bx === 'number' && Number.isFinite(bx)) cx = bx;
    }
    return {
      x: cx,
      y: r.snapped && r.snapY !== undefined ? r.snapY : y,
      time: (r.point as any).time,
      price: (r.point as any).price,
      logical: (r.point as any).logical ?? (c.logical as number) ?? 0,
      snapped: r.snapped,
    };
  }, [getChartCoordinates, snapPoint]);

  const {
    cursor: aimCursor, phase: aimPhase, cursorRef: aimCursorRef, phaseRef: aimPhaseRef,
    beginAim, moveAim, endAim, setPhase: setAimPhase, reset: resetAim,
  } = usePlacementCursor(
    resolvePlacementCursor,
    // Adaptive thumb gap: ~18% of chart height mid-chart, shrinking
    // toward thumb clearance near the bottom edge. containerSize is
    // declared below, so read it lazily at event time (see hook docs).
    (fingerYPx: number) => computeAimGap(fingerYPx, containerSize.height),
  );

  const aimPlacement = activeTool !== 'cursor' && isCoarsePointer && !isSelectBarMode && !isLocked;

  // Shared first-point assembly (tap-tap path below AND aim taps): tool
  // style + long/short entry/target/stop defaults from the trailing
  // 20-bar average range.
  const makeDrawingProps = useCallback((point: any): any => {
    const toolStyle = (toolDefaults as any)[activeTool] || {};
    const props: any = {
      id: Date.now().toString(),
      type: activeTool,
      p1: point,
      p2: point,
      ...toolStyle,
      color: toolStyle.color || currentColor || '#2962ff',
    };
    if (activeTool === 'long' || activeTool === 'short') {
      const isLong = activeTool === 'long';
      const entryPrice = point.price;
      const rrRatio = toolStyle.rr2 || 2;
      const vis = visibleCandles.slice(Math.max(0, visibleCandles.length - 20));
      const avgRange = vis.length > 0 ? vis.reduce((s, cc) => s + (cc.high - cc.low), 0) / vis.length : entryPrice * 0.005;
      const defaultRisk = avgRange || entryPrice * 0.005;
      props.entry = entryPrice;
      props.target = isLong ? entryPrice + (defaultRisk * rrRatio) : entryPrice - (defaultRisk * rrRatio);
      props.stop = isLong ? entryPrice - defaultRisk : entryPrice + defaultRisk;
    }
    return props;
  }, [activeTool, toolDefaults, currentColor, visibleCandles]);

  // Snap-enter haptic for the aim cursor (mirrors the drag-path feedback).
  const noteAimSnap = useCallback((c: PlacementCursorPoint | null) => {
    if (!c) return;
    if (c.snapped && !snapHapticOnRef.current) { snapHapticOnRef.current = true; hapticTick(5); }
    if (!c.snapped) snapHapticOnRef.current = false;
  }, [hapticTick]);

  // Arm a two-point stub at the aim cursor (tap-tap model): called from
  // commitAimTap when the first tap lifts in phase aim-p1.
  // One-click/text tools never enter this path.
  const armAimStub = useCallback((): boolean => {
    if (aimPhaseRef.current !== 'aim-p1') return false;
    const tool = activeTool;
    if (tool === 'horizontal' || tool === 'vertical' || tool === 'text') return false;
    const c = aimCursorRef.current;
    if (!c) return false;
    const pt = { time: c.time, price: c.price, logical: c.logical };
    const props = makeDrawingProps(pt);
    // Pause autoplay the moment a drawing starts (TV parity).
    setIsPlaying(false);
    hapticTick(8);
    setCurrentDrawing(props);
    setMousePos({ x: c.x, y: c.y });
    setAimPhase('aim-p2');
    return true;
  }, [aimPhaseRef, aimCursorRef, setAimPhase, activeTool, makeDrawingProps, setIsPlaying, hapticTick, setCurrentDrawing]);

  // Commit a tap at the aim cursor: p1 for one-click/text/two-point tools,
  // p2 finalize when a stub is armed. Aim drags commit nothing.
  const commitAimTap = useCallback(() => {
    const c = aimCursorRef.current;
    if (!c || aimPhaseRef.current === 'idle') return;
    const pt = { time: c.time, price: c.price, logical: c.logical };
    const tool = activeTool;
    const afterCommit = () => {
      if (stickyMode) setAimPhase('aim-p1');
      else resetAim();
    };
    if (aimPhaseRef.current === 'aim-p1') {
      if (tool === 'horizontal' || tool === 'vertical') {
        const props = makeDrawingProps(pt);
        const final: any = tool === 'horizontal'
          ? { ...props, p1: { ...props.p1, price: pt.price }, p2: { ...props.p2, price: pt.price } }
          : { ...props, p1: { ...props.p1, time: pt.time, logical: pt.logical }, p2: { ...props.p2, time: pt.time, logical: pt.logical } };
        pushUndo(drawings);
        updateDrawings(prev => [...prev, final]);
        setSelectedIds([props.id]);
        setSnapIndicator(null);
        snapHapticOnRef.current = false;
        hapticTick(8);
        finishToolAfterDraw();
        afterCommit();
        return;
      }
      if (tool === 'text') {
        const props = makeDrawingProps(pt);
        props.text = props.text || 'Text';
        pushUndo(drawings);
        updateDrawings(prev => [...prev, props]);
        setSelectedIds([props.id]);
        finishToolAfterDraw();
        afterCommit();
        return;
      }
      // Two-point tools: the first tap arms the stub at the cursor
      // (tap-tap p1); the second tap finalizes via the aim-p2 path below.
      armAimStub();
      return;
    }
    const cur = currentDrawing;
    if (!cur) { setAimPhase('aim-p1'); return; }
    // Screen-space minimum extent: a second point landing within 6px of the
    // anchor (finger jitter, not intent) keeps the preview armed instead of
    // committing a dot-sized drawing.
    try {
      const p1 = (cur as any).p1;
      const p1x = chartRef.current?.timeScale()?.logicalToCoordinate?.(p1.logical ?? 0);
      const p1y = seriesRef.current?.priceToCoordinate?.(p1.price);
      if (typeof p1x === 'number' && typeof p1y === 'number' && Number.isFinite(p1x) && Number.isFinite(p1y)) {
        if (Math.hypot(c.x - p1x, c.y - p1y) < 6) return;
      }
    } catch { /* fall through to the data guard below */ }
    const tdx = (pt.logical ?? 0) - ((cur as any).p1.logical ?? 0);
    const tdy = (pt.price ?? 0) - ((cur as any).p1.price ?? 0);
    // Tap on the anchor keeps the preview armed (same guard as tap-tap).
    if (Math.abs(tdx) < 0.5 && Math.abs(tdy) < 1e-9) return;
    let finalized: any;
    if (cur.type === 'long' || cur.type === 'short') {
      const isLong = cur.type === 'long';
      const entryPrice = (cur as any).entry ?? (cur as any).p1.price;
      const mousePriceDist = Math.abs(pt.price - entryPrice);
      const defaults = (toolDefaults as any)[cur.type] || {};
      const rrRatio = defaults.rr2 || 2;
      const vis = visibleCandles.slice(Math.max(0, visibleCandles.length - 20));
      const avgRange = vis.length > 0 ? vis.reduce((s, cc) => s + (cc.high - cc.low), 0) / vis.length : entryPrice * 0.005;
      const risk = mousePriceDist > 0 ? mousePriceDist : (avgRange || entryPrice * 0.005);
      finalized = { ...cur, p2: pt, target: isLong ? entryPrice + (risk * rrRatio) : entryPrice - (risk * rrRatio), stop: isLong ? entryPrice - risk : entryPrice + risk };
    } else {
      finalized = { ...cur, p2: pt };
    }
    pushUndo(drawings);
    updateDrawings(prev => [...prev, finalized]);
    setSelectedIds([cur.id]);
    setCurrentDrawing(null);
    setSnapIndicator(null);
    snapHapticOnRef.current = false;
    hapticTick(8);
    finishToolAfterDraw();
    afterCommit();
    }, [aimCursorRef, aimPhaseRef, setAimPhase, resetAim, activeTool, makeDrawingProps, drawings, pushUndo, updateDrawings, setSelectedIds, setCurrentDrawing, finishToolAfterDraw, setIsPlaying, hapticTick, toolDefaults, visibleCandles, stickyMode, currentDrawing, armAimStub]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if ((e.target as Element)?.closest?.('[data-drawing-toolbar]')) return;
    if (e.touches.length === 2 && (currentDrawing || aimPhaseRef.current !== 'idle')) {
      setCurrentDrawing(null);
      placingOneClickRef.current = null;
      setSnapIndicator(null);
      resetAim();
      clearLongPress();
      setDragState(null);
      setDragStartPos(null);
      hapticTick(10);
      return;
    }
    if (e.touches.length !== 1) { clearLongPress(); setDragState(null); setDragStartPos(null); return; }
    const touch = e.touches[0];
    const coords = getTouchCoords(touch);
    if (!coords) return;
    if (activeTool !== 'cursor' || isSelectBarMode) e.preventDefault();
    touchStartClientRef.current = { x: touch.clientX, y: touch.clientY };
    touchStartTimeRef.current = Date.now();
    touchMovedRef.current = false;
    touchStartDrawingRef.current = null;
    longPressTriggeredRef.current = false;
    clearLongPress();
    const hitEl = (e.target as Element)?.closest?.('[data-drawing-hit]');
    const hitId = (hitEl as Element)?.getAttribute?.('data-drawing-id') || null;
    const hitDrawing = hitId ? drawings.find(d => d.id === hitId) || null : null;
    if (hitDrawing) {
      touchStartDrawingRef.current = { id: hitDrawing.id, wasSelected: selectedIds.includes(hitDrawing.id) };
    } else if (activeTool === 'cursor' && !currentDrawing && !isSelectBarMode) {
      const prevEmpty = lastEmptyTapRef.current;
      const nowEmpty = Date.now();
      if (prevEmpty && nowEmpty - prevEmpty.t < 300 &&
        Math.hypot(touch.clientX - prevEmpty.x, touch.clientY - prevEmpty.y) < 24) {
        lastEmptyTapRef.current = null;
        setSelectedIds([]);
        setCurrentDrawing(null);
        return;
      }
      lastEmptyTapRef.current = { t: nowEmpty, x: touch.clientX, y: touch.clientY };
    }
    // While aiming, press-hold-drag IS the gesture (no hold-to-cancel);
    // two-finger tap and the chip X remain the touch cancels.
    if (!aimPlacement) longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      if (placingOneClickRef.current) { hapticTick(30); return; }
      if (activeTool !== 'cursor' || currentDrawing) {
        setActiveTool('cursor');
        setCurrentDrawing(null);
        placingOneClickRef.current = null;
        return;
      }
      if (hitDrawing) setSelectedIds([hitDrawing.id]);
      hapticTick(30);
    }, 500);

    if (!chartRef.current || !seriesRef.current) return;
    const chartCoords = getChartCoordinates(coords.x, coords.y);
    if (!chartCoords) return;
    if (isSelectBarMode) {
      const foundIdx = Math.max(0, Math.min(candles.length - 1, Math.round((chartCoords.logical as number) ?? 0)));
      if (selectBarIndex !== foundIdx) setSelectBarIndex(foundIdx);
      return;
    }
    if (aimPlacement && !dragState) {
      // Tap-tap model (touch): touch-down only seeds the aim cursor. The
      // first tap arms p1 on lift (commitAimTap), the second tap finalizes
      // p2; drags only move the cursor, nothing arms here. One-click/text
      // tools only seed the cursor here — their tap commits on lift via
      // commitAimTap.
      snapHapticOnRef.current = false;
      const ac = beginAim(touch.identifier, coords.x, coords.y);
      if (ac) {
        setMousePos({ x: ac.x, y: ac.y });
        noteAimSnap(ac);
      }
      return;
    }
    if (currentDrawing && (currentDrawing.type !== 'horizontal' && currentDrawing.type !== 'vertical')) {
      const res = snapPoint(coords.x, coords.y, chartCoords.time as number, chartCoords.price as number, chartCoords.logical);
      const snapEndT = res.point;
      const tdx = ((snapEndT as any).logical ?? 0) - ((currentDrawing as any).p1.logical ?? 0);
      const tdy = ((snapEndT as any).price ?? 0) - ((currentDrawing as any).p1.price ?? 0);
      if (Math.abs(tdx) < 0.5 && Math.abs(tdy) < 1e-9) return;
      const finalizedT: any = { ...currentDrawing, p2: snapEndT };
      pushUndo(drawings);
      updateDrawings(prev => [...prev, finalizedT]);
      setSelectedIds([currentDrawing.id]);
      setCurrentDrawing(null);
      hapticTick(8);
      finishToolAfterDraw();
      return;
    }
    if (activeTool === 'cursor') {
      const startedOnDrawing = (e.target as Element)?.closest?.('[data-drawing-hit]');
      const startedOnToolbar = (e.target as Element)?.closest?.('[data-drawing-toolbar]');
      if (selectedDrawingId && !startedOnDrawing && !startedOnToolbar) setSelectedIds([]);
      return;
    }
    if (isLocked) return;
    const snapResT = snapPoint(coords.x, coords.y, chartCoords.time as number, chartCoords.price as number, chartCoords.logical);
    const snapped = snapResT.point;
    setSnapIndicator(snapResT.snapped && snapResT.snapY !== undefined ? { x: coords.x, y: snapResT.snapY } : null);
    if (snapResT.snapped && !snapHapticOnRef.current) { snapHapticOnRef.current = true; hapticTick(5); }
    if (!snapResT.snapped) snapHapticOnRef.current = false;
    let drawingProps: any = makeDrawingProps(snapped);
    setIsPlaying(false);
    hapticTick(8);
    if (activeTool === 'text') {
      drawingProps.text = drawingProps.text || 'Text';
      pushUndo(drawings);
      updateDrawings(prev => [...prev, drawingProps]);
      setSelectedIds([drawingProps.id]);
      finishToolAfterDraw();
      return;
    }
    setCurrentDrawing(drawingProps);
    placingOneClickRef.current = (activeTool === 'horizontal' || activeTool === 'vertical') ? activeTool : null;
    setMousePos({ x: coords.x, y: coords.y });
  }, [getTouchCoords, getChartCoordinates, snapPoint, activeTool, currentDrawing, drawings, isSelectBarMode, candles.length, isLocked, selectedDrawingId, selectedIds, selectBarIndex, toolDefaults, currentColor, visibleCandles, pushUndo, updateDrawings, clearLongPress, finishToolAfterDraw, hapticTick, aimPlacement, dragState, beginAim, noteAimSnap, makeDrawingProps, aimPhaseRef, resetAim]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) { setDragState(null); setDragStartPos(null); return; }
    const touch = e.touches[0];
    const coords = getTouchCoords(touch);
    if (!coords) return;
    if (touchStartClientRef.current) {
      const dx = touch.clientX - touchStartClientRef.current.x;
      const dy = touch.clientY - touchStartClientRef.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > 10) clearLongPress();
      if (Math.sqrt(dx * dx + dy * dy) > 10) touchMovedRef.current = true;
    }
    if (activeTool !== 'cursor' || dragState || currentDrawing || isSelectBarMode) e.preventDefault();
    setMousePos({ x: coords.x, y: coords.y });
    const chartCoords = getChartCoordinates(coords.x, coords.y);
    if (!chartCoords) return;
    if (isSelectBarMode) {
      const idx = Math.max(0, Math.min(candles.length - 1, Math.round((chartCoords.logical as number) ?? 0)));
      if (selectBarIndex !== idx) setSelectBarIndex(idx);
      return;
    }
    if (aimPlacement && !dragState) {
      // Aim drag: move the decoupled cursor (magnet applied inside the
      // resolver). Tap-tap model: nothing arms or commits on move; the
      // first tap's lift arms p1 and the ghost follows after that.
      const mc = moveAim(touch.identifier, coords.x, coords.y);
      if (mc) {
        setMousePos({ x: mc.x, y: mc.y });
        noteAimSnap(mc);
      }
      queueTick();
      return;
    }
    if (dragState && dragStartPos) {
      const startDragT = dragStartPos as any;
      if (typeof startDragT.startClientX === 'number') {
        const movedPxT = Math.hypot(touch.clientX - startDragT.startClientX, touch.clientY - (startDragT.startClientY ?? touch.clientY));
        if (movedPxT < 4 && !dragMovedRef.current) return;
        dragMovedRef.current = true;
      } else {
        dragMovedRef.current = true;
      }
      const dPrice = (chartCoords.price as number) - dragStartPos.price;
      const dTime = (chartCoords.time as number) - dragStartPos.time;
      const dLog = ((chartCoords.logical as number) ?? 0) - (dragStartPos.logical ?? 0);
      const initialData = dragStartPos as any;
      setDrawings(prev => prev.map(d => {
        if (d.id !== dragState.drawingId) return d;
        const newD: any = { ...d };
        if (dragState.handle === 'move') {
          const p1Base = initialData.initialP1;
          const p2Base = initialData.initialP2;
          const lockTime = d.type === 'horizontal';
          const lockPrice = d.type === 'vertical';
          const getRebasedPoint = (base: any) => {
            const newLog = base.logical !== undefined ? Math.round(base.logical + (lockTime ? 0 : dLog)) : undefined;
            let newTime = lockTime ? base.time : base.time + dTime;
            if (!lockTime && newLog !== undefined && newLog >= 0 && newLog < candles.length) newTime = candles[newLog].time;
            return { time: newTime, price: base.price + (lockPrice ? 0 : dPrice), logical: newLog };
          };
          newD.p1 = getRebasedPoint(p1Base);
          if (p2Base) newD.p2 = getRebasedPoint(p2Base);
          if (d.type === 'long' || d.type === 'short') {
            newD.entry = (initialData.initialEntry || 0) + dPrice;
            newD.target = (initialData.initialTarget || 0) + dPrice;
            newD.stop = (initialData.initialStop || 0) + dPrice;
          }
        } else if (dragState.handle === 'target') {
          newD.target = chartCoords.price;
        } else if (dragState.handle === 'stop') {
          newD.stop = chartCoords.price;
        } else if (dragState.handle === 'entry') {
          newD.entry = chartCoords.price;
          newD.p1 = { ...newD.p1, price: chartCoords.price };
        } else {
          const snp = snapPoint(coords.x, coords.y, chartCoords.time as number, chartCoords.price as number, chartCoords.logical).point;
          if (dragState.handle === 'p1') { newD.p1 = snp; if (d.type === 'long' || d.type === 'short') newD.entry = (snp as any).price; }
          else if (dragState.handle === 'p2') newD.p2 = snp;
        }
        return newD;
      }));
      queueTick();
    }
    if (currentDrawing) {
      const snapLive = snapPoint(coords.x, coords.y, chartCoords.time as number, chartCoords.price as number, chartCoords.logical);
      const snp = snapLive.point;
      setSnapIndicator(snapLive.snapped && snapLive.snapY !== undefined ? { x: coords.x, y: snapLive.snapY } : null);
      if (snapLive.snapped && !snapHapticOnRef.current) { snapHapticOnRef.current = true; hapticTick(5); }
      if (!snapLive.snapped) snapHapticOnRef.current = false;
      if (currentDrawing.type === 'long' || currentDrawing.type === 'short') {
        const isLong = currentDrawing.type === 'long';
        const entryPrice = (currentDrawing as any).entry ?? currentDrawing.p1.price;
        const mousePriceDist = Math.abs((snp as any).price - entryPrice);
        const defaults = (toolDefaults as any)[currentDrawing.type] || {};
        const rrRatio = defaults.rr2 || 2;
        const vis = visibleCandles.slice(Math.max(0, visibleCandles.length - 20));
        const avgRange = vis.length > 0 ? vis.reduce((s, c) => s + (c.high - c.low), 0) / vis.length : entryPrice * 0.005;
        const risk = mousePriceDist > 0 ? mousePriceDist : (avgRange || entryPrice * 0.005);
        setCurrentDrawing(prev => prev ? { ...prev, p2: snp as any, target: isLong ? entryPrice + (risk * rrRatio) : entryPrice - (risk * rrRatio), stop: isLong ? entryPrice - risk : entryPrice + risk } as any : null);
      } else {
        const nextP2 = (currentDrawing as any).type === 'horizontal'
          ? { ...(snp as any), time: (currentDrawing as any).p1.time, logical: (currentDrawing as any).p1.logical }
          : (currentDrawing as any).type === 'vertical'
            ? { ...(snp as any), price: (currentDrawing as any).p1.price }
            : snp;
        setCurrentDrawing(prev => prev ? { ...prev, p2: nextP2 as any } : null);
      }
      queueTick();
    }
  }, [getTouchCoords, getChartCoordinates, snapPoint, activeTool, dragState, dragStartPos, currentDrawing, candles, selectBarIndex, toolDefaults, visibleCandles, clearLongPress, queueTick, hapticTick, aimPlacement, moveAim, noteAimSnap, aimPhaseRef]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    clearLongPress();
    const wasTap = !touchMovedRef.current;
    const tapDuration = Date.now() - touchStartTimeRef.current;
    touchStartClientRef.current = null;
    touchMovedRef.current = false;
    if (isSelectBarMode) {
      if (wasTap && !longPressTriggeredRef.current) {
        const cutIdx = selectBarIndex ?? null;
        if (cutIdx !== null) {
          setCurrentIndex(cutIdx);
          setTick(t => t + 1);
          if (chartRef.current) chartRef.current.timeScale().updateOffsetForNewBar(isAutoFollow);
          hapticTick(8);
        }
        setIsSelectBarMode(false);
        setSelectBarIndex(null);
      }
      longPressTriggeredRef.current = false;
      setDragState(null);
      setDragStartPos(null);
      return;
    }
    // Tap-tap model (touch): taps commit at the cursor — the first tap
    // arms p1, the second tap finalizes p2. Drags only moved the cursor,
    // so a drag-lift arms p1 at the lift point. Skip when another finger
    // is still down — pinch/multi-touch contaminates the gesture.
    if (aimPlacement && !dragState) {
      const lift = e.changedTouches[0];
      const liftCoords = lift ? getTouchCoords(lift) : null;
      const kind = lift && liftCoords ? endAim(lift.identifier, liftCoords.x, liftCoords.y) : null;
      if (kind && e.touches.length === 0) commitAimTap();
      longPressTriggeredRef.current = false;
      setDragState(null);
      setDragStartPos(null);
      return;
    }
    if (placingOneClickRef.current && currentDrawing &&
      (currentDrawing.type === 'horizontal' || currentDrawing.type === 'vertical')) {
      const release = e.changedTouches[0];
      let finalDrawing: any = { ...currentDrawing };
      const rel = release ? getTouchCoords(release) : null;
      const rc = rel ? getChartCoordinates(rel.x, rel.y) : null;
      if (rel && rc) {
        const snp = snapPoint(rel.x, rel.y, rc.time as number, rc.price as number, rc.logical).point;
        if (currentDrawing.type === 'horizontal') {
          finalDrawing.p1 = { ...currentDrawing.p1, price: (snp as any).price };
          finalDrawing.p2 = { ...((currentDrawing as any).p2 || currentDrawing.p1), price: (snp as any).price };
        } else {
          finalDrawing.p1 = { ...currentDrawing.p1, time: (snp as any).time, logical: (snp as any).logical };
          finalDrawing.p2 = { ...((currentDrawing as any).p2 || currentDrawing.p1), time: (snp as any).time, logical: (snp as any).logical };
        }
      }
      pushUndo(drawings);
      updateDrawings(prev => [...prev, finalDrawing]);
      setSelectedIds([currentDrawing.id]);
      setCurrentDrawing(null);
      hapticTick(8);
      finishToolAfterDraw();
      placingOneClickRef.current = null;
      longPressTriggeredRef.current = false;
      touchStartDrawingRef.current = null;
      setDragState(null);
      setDragStartPos(null);
      setSnapIndicator(null);
      snapHapticOnRef.current = false;
      return;
    }
    placingOneClickRef.current = null;
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      setDragState(null);
      setDragStartPos(null);
      touchStartDrawingRef.current = null;
      return;
    }
    const tapInfo = touchStartDrawingRef.current;
    touchStartDrawingRef.current = null;
    if (wasTap && tapDuration < 500 && tapInfo?.wasSelected && activeTool === 'cursor' && !currentDrawing) {
      setSelectedIds([tapInfo.id]);
      setDragState(null);
      setDragStartPos(null);
      dragMovedRef.current = false;
      return;
    }
    if (dragState && dragMovedRef.current) {
      saveDrawings(trade.id, drawings);
      pushUndo(drawings);
    }
    dragMovedRef.current = false;
    if (currentDrawing) {
      const isOneClickTool = currentDrawing.type === 'horizontal' || currentDrawing.type === 'vertical';
      if (chartRef.current && seriesRef.current) {
        const p1x = chartRef.current.timeScale().logicalToCoordinate((currentDrawing as any).p1.logical ?? 0) ?? 0;
        const p1y = seriesRef.current.priceToCoordinate((currentDrawing as any).p1.price);
        const p2x = mousePos?.x ?? p1x;
        const p2y = mousePos?.y ?? p1y;
        const dist = Math.sqrt(Math.pow(p2x - p1x, 2) + Math.pow(p2y - (p1y ?? 0), 2));
        if (isOneClickTool || dist > 5) {
          pushUndo(drawings);
          updateDrawings(prev => [...prev, currentDrawing as any]);
          setSelectedIds([currentDrawing.id]);
          setCurrentDrawing(null);
          hapticTick(8);
          finishToolAfterDraw();
        } else if (!isOneClickTool) {
          setCurrentDrawing(null);
        }
      }
    }
    setDragState(null);
    setDragStartPos(null);
    setSnapIndicator(null);
    snapHapticOnRef.current = false;
  }, [clearLongPress, dragState, drawings, currentDrawing, mousePos, pushUndo, updateDrawings, finishToolAfterDraw, isSelectBarMode, selectBarIndex, isAutoFollow, activeTool, hapticTick, getTouchCoords, getChartCoordinates, snapPoint, trade.id, aimPlacement, endAim, commitAimTap]);

  // ── Drawing CRUD ─────────────────────────────────────────────────────────
  const clearDrawings = useCallback(() => {
    if (drawings.length === 0) return;
    pushUndo(drawings);
    updateDrawings([]);
    setSelectedIds([]);
    setHoveredDrawingId(null);
    setCurrentDrawing(null);
  }, [drawings, pushUndo, updateDrawings]);

  const handleSelectDrawing = useCallback((id: string, additive?: boolean) => {
    if (additive) {
      setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    } else {
      setSelectedIds([id]);
    }
  }, []);

  const handleHoverDrawing = useCallback((id: string | null) => {
    setHoveredDrawingId(id);
  }, []);

  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    pushUndo(drawings);
    updateDrawings(prev => prev.filter(d => !selectedIds.includes(d.id)));
    setSelectedIds([]);
    setStyleDrawer(null);
  }, [selectedIds, drawings, pushUndo, updateDrawings]);

  const duplicateSelected = useCallback(() => {
    const ids = selectedIds.length ? selectedIds : (selectedDrawingId ? [selectedDrawingId] : []);
    if (!ids.length) return;
    const now = Date.now();
    const copies: Drawing[] = drawings.filter(d => ids.includes(d.id)).map((d, i) => ({ ...cloneDrawing(d), id: `${now}_${i}`, isLocked: false }));
    if (!copies.length) return;
    pushUndo(drawings);
    updateDrawings(prev => [...prev, ...copies]);
    setSelectedIds(copies.map(c => c.id));
  }, [drawings, selectedIds, selectedDrawingId, pushUndo, updateDrawings]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    if (e.key === 'Escape') {
      if (styleDrawer) { setStyleDrawer(null); return; }
      if (isSelectBarMode) {
        setIsSelectBarMode(false);
        setSelectBarIndex(null);
        return;
      }
      if (currentDrawing || aimPhaseRef.current !== 'idle') {
        setCurrentDrawing(null);
        placingOneClickRef.current = null;
        resetAim();
        return;
      }
      if (selectedIds.length) {
        setSelectedIds([]);
        return;
      }
      if (isFullscreenCanvas) {
        setIsFullscreenCanvas(false);
        return;
      }
      onClose();
      return;
    }
    if (e.key === ' ' && !currentDrawing) {
      e.preventDefault();
      setIsPlaying(v => !v);
      return;
    }
    if (e.key === 'ArrowRight') {
      stepForward();
      return;
    }
    if (e.key === 'ArrowLeft') {
      stepBack();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      handleDeleteSelected();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault();
      if (e.shiftKey) handleRedo();
      else handleUndo();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
      e.preventDefault();
      duplicateSelected();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
      const sel = drawings.filter(d => selectedIds.includes(d.id));
      if (sel.length) { e.preventDefault(); setClipboard(sel[0]); }
      return;
    }
  }, [isSelectBarMode, currentDrawing, selectedIds, isFullscreenCanvas, onClose, stepForward, stepBack, handleDeleteSelected, handleUndo, handleRedo, duplicateSelected, drawings, aimPhaseRef, resetAim, styleDrawer]);

  // ── Toolbar callbacks (stable refs for React.memo) ───────────────────────
  const toggleMagnetMode = useCallback(() => setMagnetMode(v => !v), []);
  // Toolbar lock = Unlock-all (TradingView parity): locked drawings are
  // click-through so canvas pan works starting on top of them. Pressing the
  // button while anything is locked clears ALL locks (global + per-drawing).
  const toggleLocked = useCallback(() => {
    if (isLocked) {
      setDrawings(prev => {
        const next = prev.map(d => (d.isLocked ? { ...d, isLocked: false } : d));
        saveDrawings(trade.id, next);
        return next;
      });
      setSelectedIds([]);
      setHoveredDrawingId(null);
      setIsLocked(false);
    } else if (drawings.some(d => d.isLocked)) {
      setDrawings(prev => {
        const next = prev.map(d => (d.isLocked ? { ...d, isLocked: false } : d));
        saveDrawings(trade.id, next);
        return next;
      });
      setSelectedIds([]);
      setHoveredDrawingId(null);
    } else {
      setSelectedIds([]);
      setHoveredDrawingId(null);
      setIsLocked(true);
    }
  }, [isLocked, drawings, trade.id]);
  // Show the toolbar as locked when global lock OR any single drawing is
  // locked, so users can discover the unlock-all action.
  const toolbarLocked = isLocked || drawings.some(d => d.isLocked);
  // Locked drawings are click-through: drop them from selection (and close
  // their settings) so no selection glow gets stuck and pan stays free.
  useEffect(() => {
    setSelectedIds(prev => {
      if (prev.length === 0) return prev;
      if (isLocked) return [];
      const next = prev.filter(id => {
        const d = drawings.find(x => x.id === id);
        return d && !d.isLocked;
      });
      return next.length === prev.length ? prev : next;
    });
    if (hoveredDrawingId) {
      const hd = drawings.find(x => x.id === hoveredDrawingId);
      if (!hd || hd.isLocked || isLocked) setHoveredDrawingId(null);
    }
    if (styleDrawer) {
      const ids = selectedIds.length ? selectedIds : [];
      const anyValid = ids.some(id => {
        const d = drawings.find(x => x.id === id);
        return d && !d.isLocked;
      });
      if (!anyValid || isLocked) setStyleDrawer(null);
    }
  }, [isLocked, drawings, hoveredDrawingId, selectedIds, styleDrawer]);
  const toggleOrientation = useCallback(() => setToolbarOrientation(v => v === 'horizontal' ? 'vertical' : 'horizontal'), []);
  const toggleStickyMode = useCallback(() => setStickyMode(v => !v), []);

  // Container dimensions for DrawingLayer (exclude the price scale like BacktestLab).
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const chartAreaRef = useCallback((node: HTMLDivElement | null) => {
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }
    if (node) {
      const observer = new ResizeObserver(entries => {
        for (const entry of entries) {
          setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
        }
      });
      observer.observe(node);
      resizeObserverRef.current = observer;
      setContainerSize({ width: node.clientWidth, height: node.clientHeight });
    }
  }, []);

  const setChartAreaRefs = useCallback((node: HTMLDivElement | null) => {
    (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    (chartContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    chartAreaRef(node);
  }, [chartAreaRef]);

  const plotWidth = Math.max(0, containerSize.width - PADDING_RIGHT);

  // ── Render ──────────────────────────────────────────────────────────────

  const replayPct = candles.length > 0 ? Math.min(100, ((currentIndex + 1) / candles.length) * 100) : 0;

  return (
    <div
      className="fixed inset-0 z-[400] flex flex-col bg-black select-none"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      onMouseUp={handleMouseUp}
    >
      {/* ── Top Header (hidden in landscape fullscreen mode) ── */}
      {!isFullscreenCanvas && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-black/90 shrink-0 gap-2 overflow-visible relative z-30">
          {/* Left: Close button + Pair + Direction */}
          <div className="flex items-center gap-2 shrink-0 min-w-0">
            <button
              onClick={onClose}
              className="flex items-center justify-center w-11 h-11 min-w-[44px] min-h-[44px] rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-all active:scale-95 shrink-0"
              aria-label="Close replay"
            >
              <X size={18} />
            </button>
            <div className="flex items-center gap-1.5 min-w-0">
              <FlaskConical size={18} className="text-indigo-400 shrink-0" />
              <span className="text-[11px] font-black uppercase tracking-widest text-zinc-200 leading-none truncate">
                {trade.pair}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest shrink-0 ${
                trade.direction === 'Long'
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-rose-500/20 text-rose-400'
              }`}>
                {trade.direction}
              </span>
            </div>
          </div>

          {/* Right: Timeframe Switcher + Follow Button + Bars count */}
          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            {/* Timeframe Switcher Button — menu portaled so header overflow can't clip it */}
            <div className="relative shrink-0">
              <button
                ref={tfButtonRef}
                type="button"
                onClick={() => {
                  if (!isTFMenuOpen) requestAnimationFrame(() => updateTfMenuPos());
                  setIsTFMenuOpen(v => !v);
                }}
                aria-haspopup="menu"
                aria-expanded={isTFMenuOpen}
                className="flex items-center gap-1 px-3 min-h-[44px] rounded-lg text-[11px] font-black uppercase tracking-widest bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 transition-all"
                title="Switch timeframe"
              >
                <span>{timeframe}</span>
                {isFetchingTimeframe ? (
                  <Loader2 size={12} className="animate-spin text-indigo-400 ml-0.5" />
                ) : (
                  <ChevronDown size={12} className="text-zinc-400" />
                )}
              </button>

              {isTFMenuOpen && typeof document !== 'undefined' && createPortal(
                <>
                  <div className="fixed inset-0 z-[490]" onClick={() => setIsTFMenuOpen(false)} aria-hidden />
                  <div
                    role="menu"
                    aria-label="Switch timeframe"
                    style={tfMenuPos ? { top: tfMenuPos.top, right: tfMenuPos.right } : undefined}
                    className="fixed z-[500] rounded-xl border bg-zinc-950/95 backdrop-blur-xl border-white/10 shadow-2xl overflow-hidden min-w-[148px] animate-sheet-fade origin-top"
                  >
                    {TIMEFRAMES.map((tf) => (
                      <button
                        key={tf}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setIsTFMenuOpen(false);
                          if (tf !== timeframe) {
                            onTimeframeChange?.(tf);
                          }
                        }}
                        className={`flex w-full items-center justify-between text-left px-4 min-h-[44px] text-[11px] font-black uppercase tracking-widest transition-colors ${
                          tf === timeframe
                            ? 'bg-zinc-800 text-white'
                            : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                        }`}
                      >
                        {tf}
                      </button>
                    ))}
                  </div>
                </>,
                document.body
              )}
            </div>

            {/* Follow Button (LocateFixed) */}
            <button
              onClick={() => {
                setIsAutoFollow(v => !v);
              }}
              className={`flex items-center justify-center min-w-[44px] min-h-[44px] p-1.5 rounded-lg border transition-all shrink-0 ${
                isAutoFollow
                  ? 'bg-[#FF4F01]/15 text-[#FF4F01] border-[#FF4F01]/40'
                  : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300 border-zinc-800'
              }`}
              title={isAutoFollow ? 'Auto-follow ON: Chart follows replay (tap to lock)' : 'Auto-follow OFF: View locked (tap to follow)'}
              aria-label="Auto-follow replay cursor"
            >
              <LocateFixed size={15} />
            </button>

            {/* Bar counter (tap = jump live) */}
            <button
              onClick={jumpLive}
              title="Jump to latest bar"
              className="flex items-center min-h-[44px] px-1 text-[9px] font-mono font-bold text-zinc-500 tracking-wider uppercase ml-1 hover:text-zinc-200 shrink-0"
            >
              {currentIndex + 1}/{candles.length}
            </button>
          </div>
        </div>
      )}

      {/* Replay progress (thin bar under header) */}
      {!isFullscreenCanvas && candles.length > 0 && (
        <div
          className="h-1 shrink-0 bg-zinc-900 cursor-pointer"
          title="Replay progress — click to jump"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const idx = Math.round(ratio * (candles.length - 1));
            setIsPlaying(false);
            setCurrentIndex(idx);
            setTick(t => t + 1);
            if (chartRef.current) chartRef.current.timeScale().updateOffsetForNewBar(isAutoFollow);
          }}
        >
          <div className="h-full bg-emerald-500 transition-all duration-150" style={{ width: `${replayPct}%` }} />
        </div>
      )}

      {/* ── Body: Drawing Toolbar + Chart ── */}
      <div className="flex flex-1 min-h-0 relative">
        {/* Drawing Toolbar — vertical left rail */}
        {toolbarOrientation === 'vertical' && !isFullscreenCanvas && (
          <div className="shrink-0 border-r border-zinc-800 z-10">
            <DrawingToolbarV2
              activeTool={activeTool}
              setActiveTool={setActiveTool}
              clearDrawings={clearDrawings}
              magnetMode={magnetMode}
              toggleMagnetMode={toggleMagnetMode}
              isLocked={toolbarLocked}
              toggleLocked={toggleLocked}
              orientation={toolbarOrientation}
              toggleOrientation={toggleOrientation}
              isDarkMode={isDarkMode}
              onUndo={handleUndo}
              onRedo={handleRedo}
              canUndo={undoStack.length > 0}
              canRedo={redoStack.length > 0}
              currentColor={selectedDrawing?.color || currentColor}
              setCurrentColor={handleToolbarColorChange}
              currentStrokeWidth={selectedDrawing?.strokeWidth || currentStrokeWidth}
              currentStrokeStyle={selectedDrawing?.strokeStyle || currentStrokeStyle}
              setStrokeWidth={handleToolbarStrokeWidthChange}
              setStrokeStyle={handleToolbarStrokeStyleChange}
              selectedDrawingId={selectedDrawingId}
              selectedIds={selectedIds}
              onDeleteSelected={handleDeleteSelected}
              drawingsCount={drawings.length}
              stickyMode={stickyMode}
              toggleStickyMode={toggleStickyMode}
            />
          </div>
        )}

        {/* Chart canvas */}
        <div
          ref={setChartAreaRefs}
          className="relative flex-1 min-h-0 outline-none"
          style={{ touchAction: (activeTool !== 'cursor' || isSelectBarMode) ? 'none' : 'pan-y' }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={handleMouseUp}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <CustomChart
            data={visibleCandles}
            trades={activeTradeForReplay ? [activeTradeForReplay] : []}
            drawings={drawings}
            isDarkMode={isDarkMode}
            showGrid={true}
            disablePan={activeTool !== 'cursor' || isSelectBarMode}
            tradingView
            // autoFitTrades is deliberately OFF in replay: its signature keys
            // off data.length + closeTime, so it rewrote scaleX/offsetX on the
            // exact entry and exit bars — a visible zoom snap that also fought
            // updateOffsetForNewBar.  updateOffsetForNewBar already follows the
            // replay cursor, and the y-domain is pre-stabilised by
            // `priceAnchors` below.
            priceAnchors={replayPriceAnchors}
            symbol={trade.pair}
            timeframe={timeframe}
            onCoordinatesChange={handleCoordinatesChange}
            onMouseUpdate={handleMouseUpdate}
            onViewStateChange={() => setTick(t => t + 1)}
            isSelectBarMode={isSelectBarMode}
            selectBarIndex={selectBarIndex}
            onSelectBarMove={(idx) => setSelectBarIndex(idx)}
            onSelectBar={(idx) => {
              setCurrentIndex(idx);
              setIsSelectBarMode(false);
              setSelectBarIndex(null);
              setTick(t => t + 1);
              if (chartRef.current) {
                chartRef.current.timeScale().updateOffsetForNewBar(isAutoFollow);
              }
            }}
            selectedIds={selectedIds}
            selectedDrawingId={selectedDrawingId}
            hoveredDrawingId={hoveredDrawingId}
            previewDrawing={currentDrawing}
            previewMouse={mousePos}
            snapIndicator={snapIndicator}
            placementCursor={aimCursor ? { x: aimCursor.x, y: aimCursor.y, snapped: aimCursor.snapped } : null}
          >
            {chartRef.current && seriesRef.current && containerSize.width > 0 && (
              <DrawingLayer
                drawings={drawings}
                currentDrawing={currentDrawing}
                selectedDrawingId={selectedDrawingId}
                selectedIds={selectedIds}
                mousePos={mousePos}
                chart={chartRef.current}
                series={seriesRef.current}
                containerWidth={plotWidth}
                containerHeight={containerSize.height}
                activeTool={activeTool}
                hoveredDrawingId={hoveredDrawingId}
                isSelectBarMode={isSelectBarMode}
                onMouseDownHandle={handleMouseDownHandle}
                onSelectDrawing={handleSelectDrawing}
                onHoverDrawing={handleHoverDrawing}
                onDoubleClickDrawing={handleDoubleClickDrawing}
                tick={tick}
                isLocked={isLocked}
                isDarkMode={isDarkMode}
              />
            )}
          </CustomChart>

          {/* Armed-tool chip (TradingView): obvious draw mode + cancel */}
          {activeTool !== 'cursor' && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 pl-3 pr-1.5 py-1 rounded-full bg-[#2962ff] text-white shadow-lg shadow-black/40 max-w-[calc(100%-120px)]">
              <span className="text-[11px] font-bold whitespace-nowrap overflow-hidden text-ellipsis">
                {TOOL_LABELS[activeTool] || activeTool} — {isCoarsePointer ? (
                  activeTool === 'horizontal' || activeTool === 'vertical' || activeTool === 'text'
                    ? 'tap to place'
                    : (aimPhase === 'aim-p2' ? 'tap to set point 2/2' : 'tap to set point 1/2')
                ) : (
                  <>tap {activeTool === 'horizontal' || activeTool === 'vertical' || activeTool === 'text' ? 'once' : 'two points'}</>
                )}
              </span>
              <button
                onClick={() => { setActiveTool('cursor'); setCurrentDrawing(null); placingOneClickRef.current = null; resetAim(); }}
                aria-label="Cancel drawing tool"
                className="w-7 h-7 grid place-items-center rounded-full bg-white/20 hover:bg-white/30 active:scale-95 touch-manipulation shrink-0"
              >
                <X size={13} strokeWidth={2.5} />
              </button>
            </div>
          )}

          {/* Selection quick-actions (TradingView edit flyout) */}
          {selectedDrawing && activeTool === 'cursor' && !isSelectBarMode && !styleDrawer && (
            <div
              data-drawing-toolbar
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className={`absolute top-2 left-1/2 -translate-x-1/2 z-40 flex items-center gap-0.5 p-1 rounded-2xl border shadow-xl backdrop-blur-xl overflow-x-auto no-scrollbar ${isDarkMode ? 'bg-black/85 border-white/10' : 'bg-white/90 border-slate-200'}`}
            >
              <button
                onClick={() => { setStyleDrawer('color'); hapticTick(8); }}
                title="Line color"
                aria-label="Line color"
                className={`min-w-[44px] min-h-[44px] px-2 shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-xl active:scale-95 touch-manipulation ${isDarkMode ? 'text-zinc-300 hover:bg-white/10' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                <Palette size={16} />
                <span className="text-[8px] font-bold leading-none">Color</span>
              </button>
              {selectedDrawing.type !== 'text' && (
                <button
                  onClick={() => { setStyleDrawer('width'); hapticTick(8); }}
                  title="Line width"
                  aria-label="Line width"
                  className={`min-w-[44px] min-h-[44px] px-2 shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-xl active:scale-95 touch-manipulation ${isDarkMode ? 'text-zinc-300 hover:bg-white/10' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  <Minus size={16} strokeWidth={Math.min(4, Math.max(1.5, selectedDrawing.strokeWidth || 1))} />
                  <span className="text-[8px] font-bold leading-none">Width</span>
                </button>
              )}
              {selectedDrawing.type !== 'text' && (
                <button
                  onClick={() => { setStyleDrawer('style'); hapticTick(8); }}
                  title="Line style"
                  aria-label="Line style"
                  className={`min-w-[44px] min-h-[44px] px-2 shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-xl active:scale-95 touch-manipulation ${isDarkMode ? 'text-zinc-300 hover:bg-white/10' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  <span className={`w-4 border-t-[3px] border-current ${selectedDrawing.strokeStyle === 'dashed' ? 'border-dashed' : selectedDrawing.strokeStyle === 'dotted' ? 'border-dotted' : 'border-solid'}`} />
                  <span className="text-[8px] font-bold leading-none">Line</span>
                </button>
              )}
              <button
                onClick={() => { updateDrawingProperty(selectedDrawing.id, { isLocked: !selectedDrawing.isLocked } as any); hapticTick(8); }}
                title={selectedDrawing.isLocked ? 'Unlock' : 'Lock'}
                aria-label={selectedDrawing.isLocked ? 'Unlock' : 'Lock'}
                className={`min-w-[44px] min-h-[44px] px-2 shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-xl active:scale-95 touch-manipulation ${isDarkMode ? 'text-zinc-300 hover:bg-white/10' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {selectedDrawing.isLocked ? <Lock size={16} /> : <Unlock size={16} />}
                <span className="text-[8px] font-bold leading-none">{selectedDrawing.isLocked ? 'Locked' : 'Lock'}</span>
              </button>
              <button
                onClick={() => { duplicateSelected(); hapticTick(8); }}
                title="Duplicate"
                aria-label="Duplicate drawing"
                className={`min-w-[44px] min-h-[44px] px-2 shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-xl active:scale-95 touch-manipulation ${isDarkMode ? 'text-zinc-300 hover:bg-white/10' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                <Copy size={16} />
                <span className="text-[8px] font-bold leading-none">Copy</span>
              </button>
              <button
                onClick={() => { handleDeleteSelected(); setStyleDrawer(null); hapticTick(8); }}
                title="Delete"
                aria-label="Delete drawing"
                className="min-w-[44px] min-h-[44px] px-2 shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-xl text-rose-500 hover:bg-rose-500/10 active:scale-95 touch-manipulation"
              >
                <Trash2 size={16} />
                <span className="text-[8px] font-bold leading-none">Delete</span>
              </button>
              <button
                onClick={() => { setSelectedIds([]); setStyleDrawer(null); }}
                title="Deselect"
                aria-label="Deselect drawing"
                className={`min-w-[44px] min-h-[44px] px-1 shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-xl active:scale-95 touch-manipulation ${isDarkMode ? 'text-zinc-500 hover:bg-white/10' : 'text-slate-400 hover:bg-slate-100'}`}
              >
                <X size={16} />
                <span className="text-[8px] font-bold leading-none">Close</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Horizontal drawing toolbar at bottom (when orientation is horizontal) */}
      {toolbarOrientation === 'horizontal' && !isFullscreenCanvas && (
        <div className="shrink-0 border-t border-zinc-800 z-10">
          <DrawingToolbarV2
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            clearDrawings={clearDrawings}
            magnetMode={magnetMode}
            toggleMagnetMode={toggleMagnetMode}
            isLocked={isLocked}
            toggleLocked={toggleLocked}
            orientation={toolbarOrientation}
            toggleOrientation={toggleOrientation}
            isDarkMode={isDarkMode}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={undoStack.length > 0}
            canRedo={redoStack.length > 0}
            currentColor={selectedDrawing?.color || currentColor}
            setCurrentColor={handleToolbarColorChange}
            currentStrokeWidth={selectedDrawing?.strokeWidth || currentStrokeWidth}
            currentStrokeStyle={selectedDrawing?.strokeStyle || currentStrokeStyle}
            setStrokeWidth={handleToolbarStrokeWidthChange}
            setStrokeStyle={handleToolbarStrokeStyleChange}
            selectedDrawingId={selectedDrawingId}
            selectedIds={selectedIds}
            onDeleteSelected={handleDeleteSelected}
            drawingsCount={drawings.length}
            stickyMode={stickyMode}
            toggleStickyMode={toggleStickyMode}
          />
        </div>
      )}

      {/* In-flow spacer reserves layout space so the fixed dock below never
          covers the chart's time axis or price scale (BacktestLab parity). */}
      {!isFullscreenCanvas && (
        <div className="h-[60px] [@media(orientation:landscape)]:h-[48px] shrink-0" aria-hidden />
      )}
      {/* ── Bar Replay Dock (BacktestLab parity: liquid-glass island, same
          sizes, same Bar/Back/Play/Step/Speed order, same time-axis gap) ── */}
      <div className={isFullscreenCanvas
        ? "fixed z-[100] pointer-events-none select-none bottom-2 left-1/2 -translate-x-1/2 w-[440px] max-w-[94vw]"
        : "fixed bottom-0 left-0 right-0 z-[100] pointer-events-none select-none safe-area-inset-bottom pb-3 [@media(orientation:landscape)]:pb-2"}>
        <nav
          className="mx-3.5 [@media(orientation:landscape)]:mx-auto [@media(orientation:landscape)]:max-w-[440px] pointer-events-auto"
          onPointerDown={pokeDock}
          onTouchStart={pokeDock}
        >
          <div className={`flex items-center justify-between px-2 py-1 rounded-[28px] bg-white/[0.08] backdrop-blur-2xl border border-white/[0.10] shadow-[0_12px_40px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.08)] transition-opacity duration-500 ${dockFaded ? 'opacity-40' : 'opacity-100'}`}>
            <button
              onClick={() => setIsSelectBarMode(v => !v)}
              aria-label="Select bar"
              className={`flex flex-col items-center justify-center gap-1 flex-1 py-1.5 px-1 rounded-[20px] transition-all min-h-[44px] touch-manipulation ${isSelectBarMode ? 'bg-[#FF4F01] text-white shadow-[0_2px_12px_rgba(255,79,1,0.35)] font-bold' : 'text-zinc-400'}`}
            >
              <ArrowLeftToLine size={17} strokeWidth={isSelectBarMode ? 2.5 : 2} />
              <span className="text-[10px] tracking-tight leading-none font-medium">Bar</span>
            </button>
            <button
              onClick={() => { if (!dockLpFired.current) stepBack(); dockLpFired.current = false; }}
              onTouchStart={() => {
                dockLpFired.current = false;
                clearDockLp();
                dockLpTimer.current = window.setTimeout(() => {
                  dockLpFired.current = true;
                  resetReplay();
                  hapticTick(15);
                }, 600);
              }}
              onTouchEnd={clearDockLp}
              onTouchMove={clearDockLp}
              disabled={currentIndex <= 0}
              aria-label="Step back (long-press = restart)"
              className="flex flex-col items-center justify-center gap-1 flex-1 py-1.5 px-1 rounded-[20px] transition-all min-h-[44px] touch-manipulation text-zinc-400 disabled:opacity-40"
            >
              <StepBack size={17} strokeWidth={2} />
              <span className="text-[10px] tracking-tight leading-none font-medium">Back</span>
            </button>
            <button
              onClick={() => setIsPlaying(v => !v)}
              disabled={candles.length === 0}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="flex flex-col items-center justify-center gap-1 flex-1 py-1.5 px-1 rounded-[20px] transition-all min-h-[44px] touch-manipulation bg-[#FF4F01] text-white shadow-[0_2px_12px_rgba(255,79,1,0.35)] font-bold disabled:opacity-50"
            >
              {isPlaying ? <Pause size={17} strokeWidth={2.5} fill="currentColor" /> : <Play size={17} strokeWidth={2.5} fill="currentColor" />}
              <span className="text-[10px] tracking-tight leading-none font-bold">{isPlaying ? 'Pause' : 'Play'}</span>
            </button>
            <button
              onClick={stepForward}
              disabled={candles.length === 0 || currentIndex >= candles.length - 1}
              aria-label="Step forward"
              className="flex flex-col items-center justify-center gap-1 flex-1 py-1.5 px-1 rounded-[20px] transition-all min-h-[44px] touch-manipulation text-zinc-400 disabled:opacity-50"
            >
              <StepForward size={17} strokeWidth={2} />
              <span className="text-[10px] tracking-tight leading-none font-medium">Step</span>
            </button>
            <button
              onClick={() => setIsSpeedSheetOpen(true)}
              aria-label="Replay speed"
              className="flex flex-col items-center justify-center gap-1 flex-1 py-1.5 px-1 rounded-[20px] transition-all min-h-[44px] touch-manipulation text-zinc-400"
            >
              <Zap size={17} strokeWidth={2} />
              <span className="text-[10px] tracking-tight leading-none font-medium">{playSpeed === 1000 ? '0.5x' : playSpeed === 500 ? '1.0x' : playSpeed === 200 ? '2.5x' : '10x'}</span>
            </button>
          </div>
        </nav>
      </div>

      {/* Selection-pill style drawers: color stays open for live-trying,
          width/style close on pick (single-tap actions). */}
      <ColorDrawer
        open={styleDrawer === 'color'}
        onClose={() => setStyleDrawer(null)}
        isDarkMode={isDarkMode}
        subtitle={selectedIds.length > 1 ? `${selectedIds.length} drawings` : (selectedDrawing ? (TOOL_LABELS[selectedDrawing.type] || selectedDrawing.type) : undefined)}
        value={selectedDrawing?.color || '#2962ff'}
        onPick={(color) => applyStyleToSelection({ color })}
        buzz={hapticTick}
      />
      <WidthDrawer
        open={styleDrawer === 'width'}
        onClose={() => setStyleDrawer(null)}
        isDarkMode={isDarkMode}
        subtitle={selectedIds.length > 1 ? `${selectedIds.length} drawings` : (selectedDrawing ? (TOOL_LABELS[selectedDrawing.type] || selectedDrawing.type) : undefined)}
        value={selectedDrawing?.strokeWidth || 1}
        onPick={(strokeWidth) => { applyStyleToSelection({ strokeWidth }); setStyleDrawer(null); hapticTick(8); }}
      />
      <LineStyleDrawer
        open={styleDrawer === 'style'}
        onClose={() => setStyleDrawer(null)}
        isDarkMode={isDarkMode}
        subtitle={selectedIds.length > 1 ? `${selectedIds.length} drawings` : (selectedDrawing ? (TOOL_LABELS[selectedDrawing.type] || selectedDrawing.type) : undefined)}
        value={selectedDrawing?.strokeStyle || 'solid'}
        onPick={(strokeStyle) => { applyStyleToSelection({ strokeStyle }); setStyleDrawer(null); hapticTick(8); }}
      />
      {/* Mobile speed picker sheet (tap Zap) — shared Drawer shell */}
      <Drawer open={isSpeedSheetOpen} onClose={() => setIsSpeedSheetOpen(false)} title="Replay speed" isDarkMode={isDarkMode} maxHeight="max-h-[60dvh]">
        <div className="grid grid-cols-4 gap-2">
          {[{ l: '0.5x', v: 1000 }, { l: '1.0x', v: 500 }, { l: '2.5x', v: 200 }, { l: '10x', v: 50 }].map(opt => (
            <button
              key={opt.v}
              onClick={() => { setPlaySpeed(opt.v); setIsSpeedSheetOpen(false); hapticTick(8); }}
              className={`min-h-[52px] rounded-2xl text-sm font-black flex items-center justify-center gap-1.5 touch-manipulation active:scale-95 transition-colors ${playSpeed === opt.v ? 'bg-[#FF4F01] text-white' : (isDarkMode ? 'bg-white/[0.06] text-zinc-200' : 'bg-slate-100 text-slate-700')}`}
            >
              {opt.l}{playSpeed === opt.v && <Check size={14} />}
            </button>
          ))}
        </div>
      </Drawer>

      {/* ── Floating Landscape Controls: Fullscreen Button ── */}
      <div className="hidden [@media(orientation:landscape)]:flex fixed right-3 bottom-3 z-[120] items-center gap-2">
        <button
          onClick={() => setIsFullscreenCanvas(v => !v)}
          aria-label={isFullscreenCanvas ? 'Exit fullscreen chart' : 'Fullscreen chart'}
          title={isFullscreenCanvas ? 'Exit fullscreen chart' : 'Fullscreen chart'}
          className="w-11 h-11 rounded-full flex items-center justify-center backdrop-blur-xl border border-white/10 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-200 hover:text-white transition-all active:scale-95 shadow-[0_4px_16px_rgba(0,0,0,0.5)] touch-manipulation"
        >
          {isFullscreenCanvas ? <Minimize size={18} strokeWidth={2.5} /> : <Maximize size={18} strokeWidth={2} />}
        </button>
      </div>

      {/* When in landscape fullscreen: floating exit / back button */}
      {isFullscreenCanvas && (
        <button
          onClick={() => setIsFullscreenCanvas(false)}
          aria-label="Exit fullscreen"
          className="hidden [@media(orientation:landscape)]:flex fixed top-3 left-3 z-[120] w-9 h-9 rounded-full items-center justify-center backdrop-blur-xl border border-white/10 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white transition-all active:scale-95 shadow-[0_4px_16px_rgba(0,0,0,0.5)] touch-manipulation"
          title="Exit fullscreen"
        >
          <Minimize size={16} />
        </button>
      )}
    </div>
  );
};

export default TradeReplayOverlay;
