import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  Copy,
  LocateFixed,
  Lock,
  Maximize2,
  Menu,
  Minimize2,
  Minus,
  Palette,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import CustomChart, { PADDING_BOTTOM, PADDING_RIGHT } from '../CustomChart';
import { DrawingLayer } from '../backtest/DrawingLayer';
import { DrawingToolbarV2 } from '../backtest/DrawingToolbarV2';
import {
  ColorDrawer,
  WidthDrawer,
  LineStyleDrawer,
  LineStyleKey,
} from '../backtest/DrawingStyleDrawers';
import { haptic } from '../../lib/haptics';
import { useLiveCandles } from '../../hooks/useLiveCandles';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import type { CtraderQuoteSymbol } from '../../hooks/useCtraderSymbols';
import type { Drawing, Point, ToolType } from '../../types';

interface CtraderChartViewProps {
  ctidAccountId?: string | null;
  isDemo?: boolean;
  symbolId: number;
  symbolName: string;
  /** Broker digits for exact price scaling (falls back to JPY heuristic). */
  digits?: number;
  onClose: () => void;
  /** All watchlist quotes for the hamburger switcher drawer. */
  symbols?: CtraderQuoteSymbol[];
  /** Switch the chart to another quote (parent swaps symbolId/symbolName). */
  onSymbolChange?: (symbolId: number) => void;
  /** Desktop: expose a fullscreen toggle for the chart surface. */
  enableFullscreen?: boolean;
}

const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'] as const;

const TOOL_LABELS: Record<string, string> = {
  cursor: 'Cursor',
  trendline: 'Trend Line',
  ray: 'Ray',
  arrow: 'Arrow',
  horizontal: 'Horizontal Line',
  vertical: 'Vertical Line',
  rect: 'Rectangle',
  channel: 'Channel',
  long: 'Long Position',
  short: 'Short Position',
  fib: 'Fib Retracement',
  text: 'Text',
  measure: 'Measure',
};

const LIVE_DRAWINGS_KEY = 'jfx_live_drawings_v1';
const LIVE_HISTORY_LIMIT = 50;

const cloneDrawing = (d: Drawing): Drawing => ({
  ...d,
  p1: { ...d.p1 },
  p2: d.p2 ? { ...d.p2 } : undefined,
});
const cloneDrawings = (arr: Drawing[]): Drawing[] => arr.map(cloneDrawing);

const digitsFor = (symbolName: string, digits?: number): number => {
  const d = Number(digits);
  if (Number.isFinite(d) && d >= 0 && d <= 8) return d;
  const name = (symbolName || '').toUpperCase().replace('/', '');
  if (name.endsWith('JPY')) return 3;
  if (name.includes('XAU') || name.includes('GOLD')) return 2;
  return 5;
};

const readLiveDrawings = (): Drawing[] => {
  try {
    const raw = localStorage.getItem(LIVE_DRAWINGS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.filter((d: any) => d && typeof d.id === 'string' && d.p1 && Number.isFinite(Number(d.p1.time)));
  } catch {
    return [];
  }
};

interface TapPoint {
  x: number;
  y: number;
  time: number;
  price: number;
}

interface DragState {
  id: string;
  handle: 'p1' | 'p2' | 'move' | 'target' | 'stop' | 'entry';
  startTime: number;
  startPrice: number;
  p1: Point;
  p2?: Point;
  initialEntry?: number;
  initialTarget?: number;
  initialStop?: number;
  startX: number;
  startY: number;
  moved: boolean;
}

/**
 * Full-screen live chart for a Quotes symbol (opened from the quote drawer).
 * Trendbar history over the connected browser WS + a spot-driven live tail
 * (mid price, reference-counted bus feed) folded in by useLiveCandles,
 * rendered on the shared CustomChart canvas.
 *
 * MT5 behavior: follows live until the user scrolls back (tap the target
 * button to resume), timeframe switches preserve the visible window.
 * Drawing tools: Backtest Lab vertical rail (DrawingToolbarV2) — same tools,
 * icons and behavior as Backtest Lab (tap 1-2 points, magnet/lock/sticky,
 * undo/redo, persisted per symbol+timeframe).
 */
export const CtraderChartView: React.FC<CtraderChartViewProps> = ({
  ctidAccountId,
  isDemo = true,
  symbolId,
  symbolName,
  digits,
  onClose,
  symbols = [],
  onSymbolChange,
  enableFullscreen = false,
}) => {
  const [timeframe, setTimeframe] = useState<string>('M1');
  const [follow, setFollow] = useState(true);
  const [tfOpen, setTfOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      haptic.selection();
    } catch {}
    try {
      if (document.fullscreenElement === containerRef.current) {
        await document.exitFullscreen?.();
      } else {
        await containerRef.current?.requestFullscreen?.();
      }
    } catch {
      /* fullscreen may be blocked by the browser */
    }
  }, []);
  const { bars, isLoading, error, isStale, reload } = useLiveCandles(
    ctidAccountId,
    isDemo,
    symbolId,
    symbolName,
    digitsFor(symbolName, digits),
    timeframe
  );

  // Chart API + time-scroll tracking (for follow mode).
  const apiRef = useRef<any>(null);
  const [api, setApi] = useState<{ chart: any; series: any }>({ chart: null, series: null });
  const followRef = useRef(true);
  const offsetXRef = useRef(0);
  const setFollowBoth = (v: boolean) => {
    followRef.current = v;
    setFollow(v);
  };

  // --- Drawings ------------------------------------------------------------
  const originKey = `${symbolName}_${timeframe}`;
  const [drawings, setDrawings] = useState<Drawing[]>(() => readLiveDrawings());
  const drawingsRef = useRef(drawings);
  drawingsRef.current = drawings;
  const [activeTool, setActiveTool] = useState<ToolType>('cursor');
  const [pendingTap, setPendingTap] = useState<TapPoint | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);

  // Backtest Lab parity state (live-namespaced keys so backtest prefs don't clash).
  const [magnetMode, setMagnetMode] = useLocalStorage<boolean>('jfx_live_magnet', false);
  const [isLocked, setIsLocked] = useLocalStorage<boolean>('jfx_live_locked', false);
  const [stickyMode, setStickyMode] = useLocalStorage<boolean>('jfx_live_tool_sticky', false);
  const [currentColor, setCurrentColor] = useLocalStorage<string>('jfx_live_color', '#2962ff');
  const [toolDefaults, setToolDefaults] = useLocalStorage<Record<string, any>>('jfx_live_tool_defaults', {
    trendline: { color: '#2962ff', strokeWidth: 2, strokeStyle: 'solid' },
    ray: { color: '#2962ff', strokeWidth: 2, strokeStyle: 'solid' },
    arrow: { color: '#2962ff', strokeWidth: 2, strokeStyle: 'solid' },
    rect: { color: '#2962ff', strokeWidth: 2, strokeStyle: 'solid' },
    vertical: { color: '#2962ff', strokeWidth: 2, strokeStyle: 'solid' },
    horizontal: { color: '#2962ff', strokeWidth: 2, strokeStyle: 'solid' },
    long: { color: '#10b981', strokeWidth: 2, strokeStyle: 'solid' },
    short: { color: '#ef4444', strokeWidth: 2, strokeStyle: 'solid' },
    fib: { color: '#2962ff', strokeWidth: 2, strokeStyle: 'solid' },
    channel: { color: '#2962ff', strokeWidth: 2, strokeStyle: 'solid' },
    text: { color: '#2962ff', fontSize: 14 },
    measure: { color: '#2962ff', strokeWidth: 2, strokeStyle: 'solid' },
  });
  const [toolbarOrientation, setToolbarOrientation] = useLocalStorage<'horizontal' | 'vertical'>(
    'jfx_live_toolbar_orientation_v2',
    'vertical'
  );
  // Selection edit menu (Backtest Lab parity): which style bottom-sheet is open.
  const [styleDrawer, setStyleDrawer] = useState<'color' | 'width' | 'style' | null>(null);

  // Undo/redo history (in-memory snapshots, same pattern as Backtest Lab).
  const [historyStates, setHistoryStates] = useState<Drawing[][]>([]);
  const [historyPointer, setHistoryPointer] = useState(-1);
  const historyStatesRef = useRef<Drawing[][]>([]);
  const historyPointerRef = useRef(-1);
  historyStatesRef.current = historyStates;
  historyPointerRef.current = historyPointer;

  const visibleDrawings = drawings.filter((d) => d.originKey === originKey || (!d.originKey && d.syncAllTimeframes));

  const persistOnly = useCallback((next: Drawing[]) => {
    setDrawings(next);
    try {
      localStorage.setItem(LIVE_DRAWINGS_KEY, JSON.stringify(next.slice(-200)));
    } catch {
      /* storage blocked */
    }
  }, []);

  const pushToHistory = useCallback((snapshot: Drawing[]) => {
    const cloned = cloneDrawings(snapshot);
    const nextHistory = [...historyStatesRef.current.slice(0, historyPointerRef.current + 1), cloned];
    const trimmed =
      nextHistory.length > LIVE_HISTORY_LIMIT
        ? nextHistory.slice(nextHistory.length - LIVE_HISTORY_LIMIT)
        : nextHistory;
    const nextPointer = trimmed.length - 1;
    historyStatesRef.current = trimmed;
    historyPointerRef.current = nextPointer;
    setHistoryStates(trimmed);
    setHistoryPointer(nextPointer);
  }, []);

  const applyDrawings = useCallback(
    (next: Drawing[]) => {
      persistOnly(next);
      pushToHistory(next);
      setTick((t) => t + 1);
    },
    [persistOnly, pushToHistory]
  );

  const selectedDrawing = useMemo(
    () => visibleDrawings.find((d) => d.id === selectedId) || null,
    [visibleDrawings, selectedId]
  );
  const currentStrokeWidth =
    (selectedDrawing as any)?.strokeWidth || (toolDefaults as any)[activeTool]?.strokeWidth || 2;
  const currentStrokeStyle =
    (selectedDrawing as any)?.strokeStyle || (toolDefaults as any)[activeTool]?.strokeStyle || 'solid';
  const currentToolbarColor =
    (selectedDrawing as any)?.color || currentColor || (toolDefaults as any)[activeTool]?.color || '#2962ff';

  const toolbarLocked = isLocked || visibleDrawings.some((d) => d.isLocked);

  // Locked drawings are click-through: drop them from selection.
  useEffect(() => {
    if (!selectedId) return;
    if (isLocked) {
      setSelectedId(null);
      return;
    }
    const d = drawingsRef.current.find((x) => x.id === selectedId);
    if (d?.isLocked) setSelectedId(null);
  }, [isLocked, drawings, selectedId]);

  // Measured plot size for the DrawingLayer overlay.
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [plotSize, setPlotSize] = useState({ w: 320, h: 480 });
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const update = () =>
      setPlotSize({
        w: Math.max(200, el.clientWidth - PADDING_RIGHT),
        h: Math.max(200, el.clientHeight),
      });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep hit-testing glued on live ticks + pan/zoom.
  useEffect(() => {
    setTick((t) => t + 1);
  }, [bars]);

  /** Magnet snap: nearest bar by time, then closest OHLC level (Backtest parity). */
  const snapPoint = useCallback(
    (time: number, price: number): { time: number; price: number } => {
      if (!magnetMode || bars.length === 0) return { time, price };
      let best = bars[0];
      let bestDist = Math.abs((best as any).time - time);
      for (const b of bars) {
        const dist = Math.abs((b as any).time - time);
        if (dist < bestDist) {
          bestDist = dist;
          best = b;
        }
      }
      const levels = [best.open, best.high, best.low, best.close].filter((v) => Number.isFinite(v));
      if (!levels.length) return { time: (best as any).time ?? time, price };
      const closest = levels.reduce((p, c) => (Math.abs(c - price) < Math.abs(p - price) ? c : p));
      return { time: (best as any).time ?? time, price: closest };
    },
    [magnetMode, bars]
  );

  const coordsAt = useCallback(
    (clientX: number, clientY: number): TapPoint | null => {
      const el = surfaceRef.current;
      const { chart, series } = api;
      if (!el || !chart || !series) return null;
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width - PADDING_RIGHT || y > rect.height - PADDING_BOTTOM) return null;
      let time: number;
      let price: number;
      try {
        time = chart.coordinateToTime(x);
        price = series.coordinateToPrice(y);
      } catch {
        return null;
      }
      if (!Number.isFinite(time) || !Number.isFinite(price)) return null;
      return { x, y, time, price };
    },
    [api]
  );

  const disarm = useCallback(() => {
    setActiveTool('cursor');
    setPendingTap(null);
  }, []);

  const finishToolAfterDraw = useCallback(() => {
    if (!stickyMode) {
      setActiveTool('cursor');
    }
    setPendingTap(null);
  }, [stickyMode]);

  const avgBarRange = useCallback(() => {
    if (!bars.length) return 0;
    const recent = bars.slice(Math.max(0, bars.length - 20));
    const avg = recent.reduce((s, c) => s + (c.high - c.low), 0) / Math.max(1, recent.length);
    return Number.isFinite(avg) && avg > 0 ? avg : 0;
  }, [bars]);

  const createDrawing = useCallback(
    (a: TapPoint, b: TapPoint) => {
      const type = activeTool;
      if (type === 'cursor') return;
      if (isLocked) return;
      const toolStyle = (toolDefaults as any)[type] || {};
      const sa = snapPoint(a.time, a.price);
      const sb = snapPoint(b.time, b.price);
      const p1: Point = { time: sa.time, price: sa.price };
      let p2: Point = { time: sb.time, price: sb.price };
      // Axis locks (TradingView parity): horizontals span time at one
      // price, verticals span price at one time.
      if (type === 'horizontal') p2 = { time: sb.time, price: sa.price };
      else if (type === 'vertical') p2 = { time: sa.time, price: sb.price };
      const drawing: Drawing = {
        id: `live_${Date.now()}`,
        type,
        p1,
        p2,
        color: toolStyle.color || currentColor || '#2962ff',
        strokeWidth: toolStyle.strokeWidth ?? 2,
        strokeStyle: toolStyle.strokeStyle || 'solid',
        originKey,
      } as Drawing;
      if (type === 'long' || type === 'short') {
        const isLong = type === 'long';
        const entryPrice = sa.price;
        const risk = avgBarRange() || Math.abs(entryPrice) * 0.005 || 1;
        (drawing as any).entry = entryPrice;
        (drawing as any).target = isLong ? entryPrice + risk * 2 : entryPrice - risk * 2;
        (drawing as any).stop = isLong ? entryPrice - risk : entryPrice + risk;
      }
      if (type === 'text') {
        (drawing as any).text = (drawing as any).text || 'Text';
        (drawing as any).fontSize = toolStyle.fontSize || 14;
      }
      const next = [...drawingsRef.current, drawing];
      applyDrawings(next);
      setSelectedId(drawing.id);
      finishToolAfterDraw();
    },
    [activeTool, isLocked, toolDefaults, currentColor, originKey, snapPoint, avgBarRange, applyDrawings, finishToolAfterDraw]
  );

  /** Single-tap tools (Backtest parity): horizontal / vertical / text place immediately. */
  const createSingleTapDrawing = useCallback(
    (c: TapPoint) => {
      const type = activeTool;
      if (type !== 'horizontal' && type !== 'vertical' && type !== 'text') return false;
      createDrawing(c, c);
      return true;
    },
    [activeTool, createDrawing]
  );

  const handleSurfaceTap = useCallback(
    (e: React.MouseEvent) => {
      if (activeTool === 'cursor') return;
      if (isLocked) return;
      const c = coordsAt(e.clientX, e.clientY);
      if (!c) return;
      try {
        haptic.selection();
      } catch {}
      if (createSingleTapDrawing(c)) return;
      if (!pendingTap) setPendingTap(c);
      else createDrawing(pendingTap, c);
    },
    [activeTool, isLocked, coordsAt, pendingTap, createDrawing, createSingleTapDrawing]
  );

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    const next = drawingsRef.current.filter((d) => d.id !== selectedId);
    applyDrawings(next);
    setSelectedId(null);
  }, [selectedId, applyDrawings]);

  const clearDrawings = useCallback(() => {
    const ids = new Set(visibleDrawings.map((d) => d.id));
    if (!ids.size) return;
    const next = drawingsRef.current.filter((d) => !ids.has(d.id));
    applyDrawings(next);
    setSelectedId(null);
  }, [visibleDrawings, applyDrawings]);

  const handleUndo = useCallback(() => {
    if (historyPointerRef.current > 0) {
      const nextStep = historyPointerRef.current - 1;
      historyPointerRef.current = nextStep;
      setHistoryPointer(nextStep);
      persistOnly(cloneDrawings(historyStatesRef.current[nextStep]));
      setTick((t) => t + 1);
    } else if (historyPointerRef.current === 0) {
      historyPointerRef.current = -1;
      setHistoryPointer(-1);
      persistOnly([]);
      setSelectedId(null);
      setTick((t) => t + 1);
    }
  }, [persistOnly]);

  const handleRedo = useCallback(() => {
    if (historyPointerRef.current < historyStatesRef.current.length - 1) {
      const nextStep = historyPointerRef.current + 1;
      historyPointerRef.current = nextStep;
      setHistoryPointer(nextStep);
      persistOnly(cloneDrawings(historyStatesRef.current[nextStep]));
      setTick((t) => t + 1);
    }
  }, [persistOnly]);

  const updateDrawingProperty = useCallback(
    (id: string, updates: Partial<Drawing>) => {
      let drawingType: string | undefined;
      const next = drawingsRef.current.map((d) => {
        if (d.id === id) {
          drawingType = d.type;
          return { ...d, ...updates };
        }
        return d;
      });
      applyDrawings(next);
      if (drawingType && ((updates as any).color || (updates as any).strokeWidth || (updates as any).strokeStyle)) {
        setToolDefaults((prev: any) => ({
          ...prev,
          [drawingType as string]: {
            ...(prev?.[drawingType as string] || {}),
            ...(updates as any).color !== undefined ? { color: (updates as any).color } : {},
            ...(updates as any).strokeWidth !== undefined ? { strokeWidth: (updates as any).strokeWidth } : {},
            ...(updates as any).strokeStyle !== undefined ? { strokeStyle: (updates as any).strokeStyle } : {},
          },
        }));
      }
      if ((updates as any).color) setCurrentColor((updates as any).color);
    },
    [applyDrawings, setToolDefaults, setCurrentColor]
  );

  const handleToolbarColorChange = useCallback(
    (color: string) => {
      if (selectedId) {
        updateDrawingProperty(selectedId, { color } as Partial<Drawing>);
        return;
      }
      setCurrentColor(color);
      if (activeTool !== 'cursor') {
        setToolDefaults((prev: any) => ({
          ...prev,
          [activeTool]: { ...(prev?.[activeTool] || {}), color },
        }));
      }
    },
    [selectedId, updateDrawingProperty, setCurrentColor, setToolDefaults, activeTool]
  );

  const handleToolbarStrokeWidthChange = useCallback(
    (strokeWidth: number) => {
      if (selectedId) {
        updateDrawingProperty(selectedId, { strokeWidth } as Partial<Drawing>);
        return;
      }
      if (activeTool === 'cursor') return;
      setToolDefaults((prev: any) => ({
        ...prev,
        [activeTool]: { ...(prev?.[activeTool] || {}), strokeWidth },
      }));
    },
    [selectedId, updateDrawingProperty, setToolDefaults, activeTool]
  );

  const handleToolbarStrokeStyleChange = useCallback(
    (strokeStyle: 'solid' | 'dashed' | 'dotted') => {
      if (selectedId) {
        updateDrawingProperty(selectedId, { strokeStyle } as Partial<Drawing>);
        return;
      }
      if (activeTool === 'cursor') return;
      setToolDefaults((prev: any) => ({
        ...prev,
        [activeTool]: { ...(prev?.[activeTool] || {}), strokeStyle },
      }));
    },
    [selectedId, updateDrawingProperty, setToolDefaults, activeTool]
  );

  // Batch style edit for the style drawers: applies to the selection with a
  // SINGLE history entry (Backtest Lab parity). Mirrors toolDefaults fan-out.
  const applyStyleToSelection = useCallback(
    (updates: { color?: string; strokeWidth?: number; strokeStyle?: LineStyleKey }) => {
      if (!selectedId) return;
      const target = drawingsRef.current.find((d) => d.id === selectedId);
      if (!target) return;
      const next = drawingsRef.current.map((d) => (d.id === selectedId ? { ...d, ...updates } : d));
      applyDrawings(next);
      if (updates.color || updates.strokeWidth || updates.strokeStyle) {
        setToolDefaults((prev: any) => ({
          ...prev,
          [target.type]: { ...(prev?.[target.type] || {}), ...updates },
        }));
      }
      if (typeof updates.color === 'string') setCurrentColor(updates.color);
    },
    [selectedId, applyDrawings, setToolDefaults, setCurrentColor]
  );

  const duplicateSelected = useCallback(() => {
    if (!selectedId) return;
    const src = drawingsRef.current.find((d) => d.id === selectedId);
    if (!src) return;
    const copy: Drawing = {
      ...cloneDrawing(src),
      id: `live_${Date.now()}`,
      isLocked: false,
    };
    const next = [...drawingsRef.current, copy];
    applyDrawings(next);
    setSelectedId(copy.id);
  }, [selectedId, applyDrawings]);

  // Double-tap a drawing selects it (Backtest Lab parity; touch double-tap
  // detector in DrawingLayer forwards here since dblclick is unreliable).
  const handleDoubleClickDrawing = useCallback((_e: React.MouseEvent, drawing: Drawing) => {
    setSelectedId(drawing.id);
  }, []);

  // Close the style drawer when the selection becomes invalid / locked.
  useEffect(() => {
    if (!styleDrawer) return;
    if (isLocked || !selectedId) {
      setStyleDrawer(null);
      return;
    }
    const d = drawingsRef.current.find((x) => x.id === selectedId);
    if (!d || d.isLocked) setStyleDrawer(null);
  }, [isLocked, drawings, selectedId, styleDrawer]);

  const toggleMagnetModeCb = useCallback(() => setMagnetMode((v: boolean) => !v), [setMagnetMode]);
  const toggleLockedCb = useCallback(() => {
    if (isLocked) {
      const next = drawingsRef.current.map((d) => (d.isLocked ? { ...d, isLocked: false } : d));
      persistOnly(next);
      pushToHistory(next);
      setSelectedId(null);
      setIsLocked(false);
    } else if (drawingsRef.current.some((d) => d.isLocked)) {
      const next = drawingsRef.current.map((d) => (d.isLocked ? { ...d, isLocked: false } : d));
      persistOnly(next);
      pushToHistory(next);
      setSelectedId(null);
    } else {
      setSelectedId(null);
      setIsLocked(true);
    }
  }, [isLocked, persistOnly, pushToHistory, setIsLocked]);
  const toggleToolbarOrientationCb = useCallback(
    () => setToolbarOrientation((prev) => (prev === 'horizontal' ? 'vertical' : 'horizontal')),
    [setToolbarOrientation]
  );

  const handleSelectDrawing = useCallback((id: string, additive?: boolean) => {
    if (!id) {
      setSelectedId(null);
      return;
    }
    if (additive) {
      setSelectedId((prev) => (prev === id ? null : id));
    } else {
      setSelectedId(id);
    }
  }, []);

  // Endpoint / body dragging (mouse + touch via synthesized events).
  const handleMouseDownHandle = useCallback(
    (e: React.MouseEvent, id: string, handle: 'p1' | 'p2' | 'move' | 'target' | 'stop' | 'entry') => {
      if (isLocked) return;
      // Creation wins over dragging: while a tool is armed, presses fall
      // through to the chart so the NEW drawing starts (Backtest parity).
      if (activeTool !== 'cursor') return;
      const d = drawingsRef.current.find((x) => x.id === id);
      const c = coordsAt(e.clientX, e.clientY);
      if (!d || !c) return;
      if (d.isLocked) return;
      setSelectedId(id);
      const st: DragState = {
        id,
        handle,
        startTime: c.time,
        startPrice: c.price,
        p1: { ...d.p1 },
        p2: d.p2 ? { ...d.p2 } : undefined,
        initialEntry: (d as any).entry,
        initialTarget: (d as any).target,
        initialStop: (d as any).stop,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
      };
      dragRef.current = st;
      setDrag(st);
    },
    [coordsAt, isLocked, activeTool]
  );

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const st = dragRef.current;
      if (!st) return;
      const el = surfaceRef.current;
      const { chart, series } = api;
      if (!el || !chart || !series) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width - PADDING_RIGHT || y > rect.height - PADDING_BOTTOM) return;
      let time: number;
      let price: number;
      try {
        time = chart.coordinateToTime(x);
        price = series.coordinateToPrice(y);
      } catch {
        return;
      }
      if (!Number.isFinite(time) || !Number.isFinite(price)) return;
      if (!st.moved && Math.hypot(e.clientX - st.startX, e.clientY - st.startY) < 4) return;
      st.moved = true;
      if (magnetMode) {
        const sn = snapPoint(time, price);
        time = sn.time;
        price = sn.price;
      }
      const dTime = time - st.startTime;
      const dPrice = price - st.startPrice;
      const next = drawingsRef.current.map((d) => {
        if (d.id !== st.id) return d;
        const out = { ...d } as any;
        if (st.handle === 'move') {
          const lockTime = d.type === 'horizontal';
          const lockPrice = d.type === 'vertical';
          out.p1 = {
            time: lockTime ? st.p1.time : st.p1.time + dTime,
            price: lockPrice ? st.p1.price : st.p1.price + dPrice,
          };
          if (st.p2) {
            out.p2 = {
              time: lockTime ? st.p2.time : st.p2.time + dTime,
              price: lockPrice ? st.p2.price : st.p2.price + dPrice,
            };
          }
          if (d.type === 'long' || d.type === 'short') {
            if (typeof st.initialEntry === 'number') out.entry = st.initialEntry + dPrice;
            if (typeof st.initialTarget === 'number') out.target = st.initialTarget + dPrice;
            if (typeof st.initialStop === 'number') out.stop = st.initialStop + dPrice;
          }
        } else if (st.handle === 'p1') {
          if (d.type === 'horizontal') out.p1 = { ...st.p1, price };
          else if (d.type === 'vertical') out.p1 = { time, price: st.p1.price };
          else out.p1 = { time, price };
          if ((d.type === 'long' || d.type === 'short') && typeof st.initialEntry === 'number') {
            out.entry = price;
          }
        } else if (st.handle === 'target') {
          out.target = price;
        } else if (st.handle === 'stop') {
          out.stop = price;
        } else if (st.handle === 'entry') {
          out.entry = price;
        } else {
          if (d.type === 'horizontal') out.p2 = st.p2 ? { ...st.p2, price } : { time, price };
          else out.p2 = { time, price };
        }
        return out;
      });
      persistOnly(next);
      setTick((t) => t + 1);
    };
    const onUp = () => {
      // Only snapshot undo history when the drawing actually moved — a plain
      // tap on a selected drawing leaves history untouched (Backtest parity).
      if (dragRef.current?.moved) {
        pushToHistory(drawingsRef.current);
      }
      dragRef.current = null;
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null, api, magnetMode, snapPoint, persistOnly, pushToHistory]);

  // Preserve the visible time window across timeframe switches.
  const pendingRange = useRef<{ from: number; to: number } | null>(null);
  const prevTimeframe = useRef(timeframe);
  useEffect(() => {
    if (prevTimeframe.current !== timeframe) {
      prevTimeframe.current = timeframe;
      try {
        pendingRange.current = apiRef.current?.getVisibleRange?.() ?? null;
      } catch {
        pendingRange.current = null;
      }
    }
  }, [timeframe]);
  useEffect(() => {
    if (!isLoading && bars.length > 0 && pendingRange.current) {
      try {
        apiRef.current?.setVisibleRange?.(pendingRange.current);
      } catch {
        /* new series too short — keep default view */
      }
      pendingRange.current = null;
    }
  }, [isLoading, bars]);

  // Follow mode: while ON and the user drifted back in time, pin back to
  // the live edge as new bars arrive. Never touches the view otherwise,
  // so manual price zoom is preserved.
  useEffect(() => {
    if (followRef.current && bars.length > 0 && offsetXRef.current < -20) {
      try {
        apiRef.current?.scrollToRealtime?.();
      } catch {
        /* chart not ready */
      }
    }
  }, [bars]);

  const goLive = () => {
    try {
      haptic.selection();
    } catch {}
    setFollowBoth(true);
    try {
      apiRef.current?.scrollToRealtime?.();
    } catch {
      /* chart not ready */
    }
  };

  const tap = (fn: () => void) => () => {
    try {
      haptic.selection();
    } catch {}
    fn();
  };

  const toolLabel = TOOL_LABELS[activeTool] ?? activeTool;

  return (
    <div ref={containerRef} className="flex-1 min-h-0 flex flex-col bg-[#000000]">
      {/* Top bar: back + symbol + live state ... follow + fullscreen + TF + menu */}
      <div className="shrink-0 flex items-center gap-1.5 px-2 pt-2">
        <button
          type="button"
          onClick={() => {
            try {
              haptic.selection();
            } catch {}
            onClose();
          }}
          aria-label="Back to quotes"
          className="h-11 min-w-[44px] px-1 rounded-lg flex items-center gap-0.5 text-[15px] font-bold text-zinc-200 active:scale-95 shrink-0"
        >
          <ChevronLeft size={22} />
          <span className="truncate max-w-[64px]">{symbolName}</span>
        </button>
        <span
          title={isStale ? 'No ticks recently — delayed' : 'Live ticks'}
          className={`w-2 h-2 rounded-full shrink-0 ${
            isStale ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'
          }`}
        />

        <div className="flex-1" />

        {/* Follow (target): orange while pinning to live */}
        <button
          type="button"
          onClick={() => (follow ? setFollowBoth(false) : goLive())}
          aria-label={follow ? 'Stop following live' : 'Follow live'}
          title={follow ? 'Following live (tap to lock view)' : 'View locked (tap to follow live)'}
          className={`flex items-center justify-center w-11 h-11 min-w-[44px] rounded-lg border transition-all shrink-0 active:scale-95 ${
            follow
              ? 'bg-[#FF4F01]/15 text-[#FF4F01] border-[#FF4F01]/40'
              : 'bg-white/[0.06] text-zinc-500 border-transparent'
          }`}
        >
          <LocateFixed size={17} />
        </button>

        {enableFullscreen && (
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            aria-label={isFullscreen ? 'Exit fullscreen chart' : 'Open chart in fullscreen'}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            className="flex items-center justify-center w-11 h-11 min-w-[44px] rounded-lg border border-transparent bg-white/[0.06] text-zinc-400 hover:text-white hover:bg-white/10 transition-all shrink-0 active:scale-95"
          >
            {isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
        )}

        {/* Timeframe dropdown */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={tap(() => {
              setQuoteOpen(false);
              setTfOpen((v) => !v);
            })}
            aria-haspopup="menu"
            aria-expanded={tfOpen}
            className="flex items-center gap-1 h-11 px-3 rounded-lg text-[12px] font-black uppercase tracking-widest bg-white/[0.06] text-zinc-200 active:scale-95 transition-all"
          >
            {timeframe}
            <ChevronDown size={14} className="text-zinc-500" />
          </button>
          {tfOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setTfOpen(false)} aria-hidden />
              <div
                role="menu"
                aria-label="Switch timeframe"
                className="absolute right-0 top-12 z-50 rounded-xl border border-white/10 bg-zinc-950/95 shadow-2xl overflow-hidden min-w-[120px] animate-sheet-fade"
              >
                {TIMEFRAMES.map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    role="menuitem"
                    onClick={tap(() => {
                      setTfOpen(false);
                      if (tf !== timeframe) setTimeframe(tf);
                    })}
                    className={`flex w-full items-center px-4 min-h-[44px] text-[12px] font-black uppercase tracking-widest transition-colors ${
                      tf === timeframe ? 'bg-[#FF4F01]/15 text-[#FF4F01]' : 'text-zinc-400 active:bg-white/10'
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Quotes switcher: opens a drawer to switch between quotes */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={tap(() => {
              setTfOpen(false);
              setQuoteOpen(true);
            })}
            aria-haspopup="dialog"
            aria-expanded={quoteOpen}
            aria-label="Switch quote"
            title="Switch quote"
            className="flex items-center justify-center w-11 h-11 min-w-[44px] rounded-lg bg-white/[0.06] text-zinc-300 active:scale-95 transition-all"
          >
            <Menu size={17} />
          </button>
        </div>
      </div>

      {/* Chart surface */}
      <div ref={surfaceRef} className="flex-1 min-h-0 relative">
        {bars.length > 0 && (
          <>
            <DrawingToolbarV2
              activeTool={activeTool}
              setActiveTool={(t) => {
                if (t === 'cursor') setSelectedId(null);
                setActiveTool(t);
                setPendingTap(null);
              }}
              clearDrawings={clearDrawings}
              magnetMode={magnetMode}
              toggleMagnetMode={toggleMagnetModeCb}
              isLocked={toolbarLocked}
              toggleLocked={toggleLockedCb}
              orientation={toolbarOrientation}
              toggleOrientation={toggleToolbarOrientationCb}
              isDarkMode
              onUndo={handleUndo}
              onRedo={handleRedo}
              canUndo={historyPointer > 0}
              canRedo={historyPointer < historyStates.length - 1}
              currentColor={currentToolbarColor}
              setCurrentColor={handleToolbarColorChange}
              currentStrokeWidth={currentStrokeWidth}
              currentStrokeStyle={currentStrokeStyle}
              setStrokeWidth={handleToolbarStrokeWidthChange}
              setStrokeStyle={handleToolbarStrokeStyleChange}
              selectedDrawingId={selectedId}
              selectedIds={selectedId ? [selectedId] : []}
              onDeleteSelected={deleteSelected}
              drawingsCount={visibleDrawings.length}
              stickyMode={stickyMode}
              toggleStickyMode={() => setStickyMode((v: boolean) => !v)}
            />
            {/* Armed-tool chip (Backtest Lab parity) */}
            {activeTool !== 'cursor' && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 pl-3 pr-1.5 py-1 rounded-full bg-[#2962ff] text-white shadow-lg shadow-black/40 max-w-[calc(100%-120px)]">
                <span className="text-[11px] font-bold whitespace-nowrap overflow-hidden text-ellipsis">
                  {toolLabel} —{' '}
                  {activeTool === 'horizontal' || activeTool === 'vertical' || activeTool === 'text'
                    ? 'tap to place'
                    : pendingTap
                      ? 'tap to set point 2/2'
                      : 'tap to set point 1/2'}
                </span>
                <button
                  type="button"
                  onClick={tap(disarm)}
                  aria-label="Cancel drawing tool"
                  className="w-7 h-7 grid place-items-center rounded-full bg-white/20 hover:bg-white/30 active:scale-95 touch-manipulation shrink-0"
                >
                  <X size={13} strokeWidth={2.5} />
                </button>
              </div>
            )}
            {/* Selection quick-actions edit menu (Backtest Lab parity) */}
            {selectedDrawing && activeTool === 'cursor' && !styleDrawer && (
              <div
                data-drawing-toolbar
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute top-2 left-1/2 -translate-x-1/2 z-40 flex items-center gap-0.5 p-1 rounded-2xl border shadow-xl backdrop-blur-xl overflow-x-auto no-scrollbar bg-black/85 border-white/10"
              >
                <button
                  type="button"
                  onClick={tap(() => setStyleDrawer('color'))}
                  title="Line color"
                  aria-label="Line color"
                  className="min-w-[44px] min-h-[44px] px-2 shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-xl active:scale-95 touch-manipulation text-zinc-300 hover:bg-white/10"
                >
                  <Palette size={16} />
                  <span className="text-[8px] font-bold leading-none">Color</span>
                </button>
                {selectedDrawing.type !== 'text' && (
                  <button
                    type="button"
                    onClick={tap(() => setStyleDrawer('width'))}
                    title="Line width"
                    aria-label="Line width"
                    className="min-w-[44px] min-h-[44px] px-2 shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-xl active:scale-95 touch-manipulation text-zinc-300 hover:bg-white/10"
                  >
                    <Minus
                      size={16}
                      strokeWidth={Math.min(4, Math.max(1.5, (selectedDrawing as any).strokeWidth || 1))}
                    />
                    <span className="text-[8px] font-bold leading-none">Width</span>
                  </button>
                )}
                {selectedDrawing.type !== 'text' && (
                  <button
                    type="button"
                    onClick={tap(() => setStyleDrawer('style'))}
                    title="Line style"
                    aria-label="Line style"
                    className="min-w-[44px] min-h-[44px] px-2 shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-xl active:scale-95 touch-manipulation text-zinc-300 hover:bg-white/10"
                  >
                    <span
                      className={`w-4 border-t-[3px] border-current ${
                        (selectedDrawing as any).strokeStyle === 'dashed'
                          ? 'border-dashed'
                          : (selectedDrawing as any).strokeStyle === 'dotted'
                            ? 'border-dotted'
                            : 'border-solid'
                      }`}
                    />
                    <span className="text-[8px] font-bold leading-none">Line</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={tap(() =>
                    updateDrawingProperty(selectedDrawing.id, {
                      isLocked: !selectedDrawing.isLocked,
                    } as Partial<Drawing>)
                  )}
                  title={selectedDrawing.isLocked ? 'Unlock' : 'Lock'}
                  aria-label={selectedDrawing.isLocked ? 'Unlock' : 'Lock'}
                  className="min-w-[44px] min-h-[44px] px-2 shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-xl active:scale-95 touch-manipulation text-zinc-300 hover:bg-white/10"
                >
                  {selectedDrawing.isLocked ? <Lock size={16} /> : <Unlock size={16} />}
                  <span className="text-[8px] font-bold leading-none">
                    {selectedDrawing.isLocked ? 'Locked' : 'Lock'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={tap(duplicateSelected)}
                  title="Duplicate"
                  aria-label="Duplicate drawing"
                  className="min-w-[44px] min-h-[44px] px-2 shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-xl active:scale-95 touch-manipulation text-zinc-300 hover:bg-white/10"
                >
                  <Copy size={16} />
                  <span className="text-[8px] font-bold leading-none">Copy</span>
                </button>
                <button
                  type="button"
                  onClick={tap(() => {
                    deleteSelected();
                    setStyleDrawer(null);
                  })}
                  title="Delete"
                  aria-label="Delete drawing"
                  className="min-w-[44px] min-h-[44px] px-2 shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-xl text-rose-500 hover:bg-rose-500/10 active:scale-95 touch-manipulation"
                >
                  <Trash2 size={16} />
                  <span className="text-[8px] font-bold leading-none">Delete</span>
                </button>
                <button
                  type="button"
                  onClick={tap(() => {
                    setSelectedId(null);
                    setStyleDrawer(null);
                  })}
                  title="Deselect"
                  aria-label="Deselect drawing"
                  className="min-w-[40px] min-h-[44px] px-1 shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-xl active:scale-95 touch-manipulation text-zinc-500 hover:bg-white/10"
                >
                  <X size={16} />
                  <span className="text-[8px] font-bold leading-none">Close</span>
                </button>
              </div>
            )}
          </>
        )}
        {bars.length > 0 && (
          <CustomChart
            data={bars}
            trades={[]}
            drawings={visibleDrawings}
            isDarkMode
            showGrid
            disablePan={activeTool !== 'cursor'}
            tradingView
            showScrollToRealtime
            symbol={symbolName}
            timeframe={timeframe}
            selectedIds={selectedId ? [selectedId] : []}
            selectedDrawingId={selectedId}
            hoveredDrawingId={hoveredId}
            onCoordinatesChange={(chart, series) => {
              apiRef.current = chart;
              setApi((prev) => (prev.chart === chart ? prev : { chart, series }));
            }}
            onViewStateChange={(vs) => {
              if (vs && typeof vs.offsetX === 'number') {
                offsetXRef.current = vs.offsetX;
                // User dragged back in time: tap-to-lock, like replay.
                if (vs.offsetX < -20 && followRef.current) setFollowBoth(false);
              }
              setTick((t) => t + 1);
            }}
          >
            <DrawingLayer
              drawings={visibleDrawings}
              currentDrawing={null}
              selectedDrawingId={selectedId}
              selectedIds={selectedId ? [selectedId] : []}
              mousePos={null}
              chart={null}
              series={null}
              containerWidth={plotSize.w}
              containerHeight={plotSize.h}
              activeTool={activeTool}
              hoveredDrawingId={hoveredId}
              isSelectBarMode={false}
              onMouseDownHandle={handleMouseDownHandle}
              onSelectDrawing={handleSelectDrawing}
              onHoverDrawing={setHoveredId}
              onDoubleClickDrawing={handleDoubleClickDrawing}
              tick={tick}
              isLocked={toolbarLocked}
              isDarkMode
            />
          </CustomChart>
        )}
        {/* Tap catcher while a tool is armed (creation wins over pan/select) */}
        {bars.length > 0 && activeTool !== 'cursor' && (
          <div
            className="absolute inset-0 z-20 touch-none"
            onClick={handleSurfaceTap}
            aria-label={`Tap chart to place ${toolLabel}`}
          />
        )}
        {/* Pending first-tap marker */}
        {bars.length > 0 && pendingTap && activeTool !== 'cursor' && (
          <div
            className="absolute z-20 w-3 h-3 -ml-1.5 -mt-1.5 rounded-full bg-[#2962ff] pointer-events-none"
            style={{ left: pendingTap.x, top: pendingTap.y }}
          />
        )}
        {(isLoading || (error && bars.length === 0)) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 bg-[#000000]/60">
            <p className={`text-[13px] font-medium ${error ? 'text-rose-400' : 'text-zinc-500'}`}>
              {isLoading ? `Loading ${symbolName} · ${timeframe}…` : error}
            </p>
            {!isLoading && error && (
              <button
                type="button"
                onClick={() => void reload()}
                className="h-11 px-5 rounded-xl bg-[#FF4F01] text-white text-xs font-bold active:scale-95 transition-all"
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>

      {/* Selection-pill style drawers (Backtest Lab parity) */}
      <ColorDrawer
        open={styleDrawer === 'color'}
        onClose={() => setStyleDrawer(null)}
        isDarkMode
        subtitle={selectedDrawing ? TOOL_LABELS[selectedDrawing.type] || selectedDrawing.type : undefined}
        value={(selectedDrawing as any)?.color || '#2962ff'}
        onPick={(color) => applyStyleToSelection({ color })}
        buzz={() => {
          try {
            haptic.selection();
          } catch {}
        }}
      />
      <WidthDrawer
        open={styleDrawer === 'width'}
        onClose={() => setStyleDrawer(null)}
        isDarkMode
        subtitle={selectedDrawing ? TOOL_LABELS[selectedDrawing.type] || selectedDrawing.type : undefined}
        value={(selectedDrawing as any)?.strokeWidth || 2}
        onPick={(strokeWidth) => {
          applyStyleToSelection({ strokeWidth });
          setStyleDrawer(null);
          try {
            haptic.selection();
          } catch {}
        }}
      />
      <LineStyleDrawer
        open={styleDrawer === 'style'}
        onClose={() => setStyleDrawer(null)}
        isDarkMode
        subtitle={selectedDrawing ? TOOL_LABELS[selectedDrawing.type] || selectedDrawing.type : undefined}
        value={(selectedDrawing as any)?.strokeStyle || 'solid'}
        onPick={(strokeStyle) => {
          applyStyleToSelection({ strokeStyle });
          setStyleDrawer(null);
          try {
            haptic.selection();
          } catch {}
        }}
      />

      {/* Quote switcher drawer (opened from the hamburger button) */}
      {quoteOpen && (
        <div className="fixed inset-0 z-[240]">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-sheet-fade"
            onClick={() => setQuoteOpen(false)}
            aria-label="Close quote switcher"
          />
          <div className="absolute bottom-0 left-0 right-0 bg-[#1a1a1a] rounded-t-[20px] pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))] animate-sheet-up max-h-[70dvh] flex flex-col">
            <div className="mx-auto my-1 h-1 w-10 rounded-full bg-white/15 shrink-0" />
            <div className="flex items-center justify-between px-5 pt-2 pb-3 shrink-0">
              <p className="text-[15px] font-bold text-zinc-300">Switch quote</p>
              <button
                type="button"
                onClick={tap(() => setQuoteOpen(false))}
                aria-label="Close quote switcher"
                className="w-9 h-9 grid place-items-center rounded-lg text-zinc-400 active:scale-95 active:bg-white/10"
              >
                <X size={17} />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-4 pb-2">
              {symbols.length === 0 ? (
                <p className="px-1 py-6 text-center text-[12px] font-bold text-zinc-500">
                  No quotes available
                </p>
              ) : (
                symbols.map((s) => {
                  const id = Number(s.symbolId);
                  const active = id === Number(symbolId);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={tap(() => {
                        setQuoteOpen(false);
                        if (!active) onSymbolChange?.(id);
                      })}
                      aria-label={`Switch to ${s.symbolName}`}
                      className={`flex w-full items-center gap-3 px-4 min-h-[52px] py-2 rounded-xl text-left transition-all active:scale-[0.99] mb-1 ${
                        active
                          ? 'bg-[#FF4F01]/15 text-[#FF4F01]'
                          : 'bg-white/[0.05] text-zinc-200 active:bg-white/10'
                      }`}
                    >
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] font-black truncate">{s.symbolName}</span>
                      </span>
                      {active && <Check size={16} className="shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
