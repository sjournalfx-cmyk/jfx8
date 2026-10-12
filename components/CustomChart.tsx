
import React, { useEffect, useRef, useLayoutEffect, useCallback, useState, useMemo } from 'react';
import { ArrowRightToLine } from 'lucide-react';
import { Candle, Trade, Drawing, Point } from '../types';
import { getRayCoordinates, extendSegmentToBounds, timeToLogicalIndex, positionToolMinWidth } from './backtest/utils';

interface CustomChartProps {
  data: Candle[];
  trades: Trade[];
  drawings: Drawing[];
  isDarkMode: boolean;
  showGrid?: boolean;
  symbol?: string;
  timeframe?: string;
  // TradingView-style overlays: crosshair, OHLC legend, last-price line, watermark.
  tradingView?: boolean;
  onCoordinatesChange?: (chart: any, series: any) => void;
  onMouseUpdate?: (x: number, y: number, coords: { time: number, price: number, logical: number } | null) => void;
  onSelectBar?: (index: number) => void;
  onViewStateChange?: (viewState: any) => void;
  initialViewState?: any;
  isSelectBarMode?: boolean;
  selectBarIndex?: number | null;
  onSelectBarMove?: (index: number) => void;
  disablePan?: boolean;
  children?: React.ReactNode;
  autoFitTrades?: boolean;
  // Drawing-tool overlays (TradingView parity): selection + hover highlight,
  // live-measure preview while drawing, and magnet snap indicator.
  selectedIds?: string[];
  selectedDrawingId?: string | null;
  hoveredDrawingId?: string | null;
  previewDrawing?: Drawing | null;
  previewMouse?: { x: number; y: number } | null;
  snapIndicator?: { x: number; y: number } | null;
  // Placement cursor (TradingView-mobile aim model): blue dot + full crosshair
  // following the finger while a drawing tool is armed on touch.  Hosts only
  // set this on the touch aim path, so desktop hover is unaffected.
  placementCursor?: { x: number; y: number; snapped?: boolean } | null;
  showScrollToRealtime?: boolean;
  onScrollToRealtime?: () => void;
  // Extra prices that must stay inside the auto y-domain even while their
  // markers are still hidden.  Lets a progressive surface (replay) reserve the
  // vertical range up front so nothing shifts when a marker appears.
  priceAnchors?: number[];
}

export const PADDING_RIGHT = 60;
// Lifted so the bottom date axis + lower price-scale labels sit a little
// higher with breathing room above the mobile replay dock.
export const PADDING_BOTTOM = 30;

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const roundRectPath = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, w, h, r);
    } else {
        ctx.rect(x, y, w, h);
    }
};

const formatPrice = (p: number): string => {
    if (!isFinite(p)) return '\u2014';
    if (p === 0) return '0';
    return p.toFixed(5).replace(/\.?0+$/, '') || '0';
};

const formatAxisTime = (time: number, intervalSec: number): string => {
    const d = new Date(time * 1000);
    const mo = MONTHS_SHORT[d.getMonth()];
    if (intervalSec >= 86400) {
        return `${mo} ${d.getDate()}, ${d.getFullYear()}`;
    }
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${mo} ${d.getDate()}, ${hh}:${mm}`;
};

const formatTimeLabel = (time: number, intervalSec: number, prevTime?: number): string => {
    const d = new Date(time * 1000);
    if (intervalSec >= 86400) {
        const sameYear = d.getFullYear() === new Date().getFullYear();
        return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}${sameYear ? '' : ` '${String(d.getFullYear()).slice(2)}`}`;
    }
    if (prevTime !== undefined) {
        const prev = new Date(prevTime * 1000);
        const isNewDay = prev.getFullYear() !== d.getFullYear() || prev.getMonth() !== d.getMonth() || prev.getDate() !== d.getDate();
        if (isNewDay) return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
    }
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
};

/** Parse trade timestamps (ISO strings, epoch seconds/ms, Date) to seconds. Null when missing/invalid. */
const parseTradeTimeSec = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value <= 0) return null;
        return value > 1e11 ? Math.floor(value / 1000) : Math.floor(value);
    }
    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const ms = Date.parse(trimmed);
        if (Number.isFinite(ms)) return Math.floor(ms / 1000);
        const alt = Date.parse(trimmed.replace(/\./g, '/'));
        if (!Number.isFinite(alt)) return null;
        return Math.floor(alt / 1000);
    }
    return null;
};

const findClosestCandleIndex = (candles: { time: number }[], targetSec: number | null): number => {
    if (targetSec === null || candles.length === 0) return -1;
    let best = -1;
    let minDiff = Infinity;
    for (let i = 0; i < candles.length; i++) {
        const t = candles[i].time;
        if (!Number.isFinite(t)) continue;
        const diff = Math.abs(t - targetSec);
        if (diff < minDiff) {
            minDiff = diff;
            best = i;
        }
    }
    // Guard: if the closest candle is too far from the target time, the trade
    // probably falls outside the loaded data range.  Use 50× the average bar
    // interval as the tolerance so we don't place an arrow on a wrong bar.
    if (best >= 0 && candles.length >= 2) {
        const avgInterval = Math.abs(candles[candles.length - 1].time - candles[0].time) / (candles.length - 1);
        if (avgInterval > 0 && minDiff > avgInterval * 50) return -1;
    }
    return best;
};

const clampY = (y: number, chartHeight: number): number => {
    if (!Number.isFinite(y)) return chartHeight / 2;
    return Math.max(18, Math.min(chartHeight - 22, y));
};

const CustomChart: React.FC<CustomChartProps> = ({
  data,
  trades,
  drawings,
  isDarkMode,
  showGrid = false,
  symbol = '',
  timeframe = '',
  tradingView = false,
  onCoordinatesChange,
  onMouseUpdate,
  onSelectBar,
  onViewStateChange,
  initialViewState,
  isSelectBarMode,
  selectBarIndex,
  onSelectBarMove,
  disablePan,
  children,
  selectedIds,
  selectedDrawingId,
  hoveredDrawingId,
  previewDrawing,
  previewMouse,
  snapIndicator,
  placementCursor,
  showScrollToRealtime = true,
  onScrollToRealtime,
  autoFitTrades = false,
  priceAnchors,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Viewport State
  const viewState = useRef({
    scaleX: initialViewState?.scaleX ?? 10,
    offsetX: initialViewState?.offsetX ?? 0,
    width: 0,
    height: 0,
    minPrice: initialViewState?.minPrice ?? 0,
    maxPrice: initialViewState?.maxPrice ?? 0,
    isManualPriceRange: initialViewState?.isManualPriceRange ?? false,
    manualMinPrice: initialViewState?.manualMinPrice ?? 0,
    manualMaxPrice: initialViewState?.manualMaxPrice ?? 0
  });

  const mouse = useRef({
    isDown: false,
    lastX: 0,
    lastY: 0,
    dragType: 'NONE' as 'NONE' | 'PAN' | 'PRICE_SCALE' | 'TIME_SCALE'
  });

  // TradingView-style crosshair position (screen coords inside the canvas).
  const crosshairRef = useRef<{ x: number; y: number } | null>(null);
  // True when the crosshair was last set by a touch contact. Touch uses the
  // aim cursor + drawing preview instead — rendering the hover crosshair too
  // would paint a second, stale set of dashed lines at the finger (it never
  // receives a mouse-leave to clear it). Mouse (desktop) is unaffected.
  const crosshairTouchRef = useRef(false);

  const autoFitSigRef = useRef<string | null>(null);
  const userInteractedRef = useRef(false);

  const [chartRevision, setChartRevision] = useState(0);
  // Stable ref so onCoordinatesChange never depends on mockApi identity
  const mockApiRef = useRef<any>(null);

  // Notify parent of view state changes
  const notifyViewStateChange = useCallback(() => {
    if (onViewStateChange) {
      onViewStateChange({
        scaleX: viewState.current.scaleX,
        offsetX: viewState.current.offsetX,
        isManualPriceRange: viewState.current.isManualPriceRange,
        manualMinPrice: viewState.current.manualMinPrice,
        manualMaxPrice: viewState.current.manualMaxPrice,
        minPrice: viewState.current.minPrice,
        maxPrice: viewState.current.maxPrice
      });
    }
  }, [onViewStateChange]);

  const getInterval = useCallback(() => {
    if (data.length < 2) return 60;
    return data[data.length - 1].time - data[data.length - 2].time;
  }, [data]);

  const getX = useCallback((index: number) => {
    const { width, offsetX, scaleX } = viewState.current;
    const chartWidth = width - PADDING_RIGHT;
    return chartWidth - offsetX - (data.length - 1 - index) * scaleX;
  }, [data.length, chartRevision]); // Depend on chartRevision

  const getY = useCallback((price: number) => {
    const { height, minPrice, maxPrice } = viewState.current;
    const chartHeight = height - PADDING_BOTTOM;
    // A collapsed / non-finite range has no meaningful mapping.  Centre the
    // result instead of returning 0, which used to slam geometry into the top
    // edge for a frame and read as a corrupted chart.
    if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || maxPrice === minPrice) {
      return Math.max(0, chartHeight / 2);
    }
    if (!Number.isFinite(price) || !Number.isFinite(chartHeight) || chartHeight <= 0) {
      return Math.max(0, chartHeight / 2);
    }
    const priceRange = maxPrice - minPrice || 1;
    return chartHeight - ((price - minPrice) / priceRange) * chartHeight;
  }, [chartRevision]);

  const getPriceFromY = useCallback((y: number) => {
    const { height, minPrice, maxPrice } = viewState.current;
    if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || maxPrice === minPrice) return 0;
    const chartHeight = height - PADDING_BOTTOM;
    if (!Number.isFinite(chartHeight) || chartHeight <= 0) return minPrice;
    const priceRange = maxPrice - minPrice || 1;
    return minPrice + ((chartHeight - y) / chartHeight) * priceRange;
  }, [chartRevision]);

  const getIndexFromX = useCallback((x: number) => {
    const { width, offsetX, scaleX } = viewState.current;
    if (!Number.isFinite(scaleX) || scaleX === 0) return 0;
    const chartWidth = width - PADDING_RIGHT;
    const out = (x - (chartWidth - offsetX)) / scaleX + (data.length - 1);
    return Number.isFinite(out) ? out : 0;
  }, [data.length, chartRevision]);

  // Mock "Chart/Series" objects for compatibility with existing DrawingLayer
  const mockApi = useMemo(() => {
    return {
      chart: {
        timeScale: () => ({
          timeToCoordinate: (time: number) => {
            if (data.length === 0) return null;
            // TradingView-style anchoring: binary-search the bar timeline and
            // interpolate fractionally between neighbouring bars. Exact-match
            // findIndex is unnecessary and naive extrapolation from the last
            // bar drifts across weekend/session gaps, which pushed drawings
            // off-screen after timeframe switches.
            return getX(timeToLogicalIndex(data, time));
          },
          logicalToCoordinate: (logical: number) => getX(logical),
          coordinateToLogical: (x: number) => getIndexFromX(x),
          coordinateToTime: (x: number) => {
            const logical = getIndexFromX(x);
            const idx = Math.round(logical);
            if (idx >= 0 && idx < data.length) return data[idx].time;

            // Estimate future/past time
            if (data.length < 2) return null;
            const lastTime = data[data.length - 1].time;
            const prevTime = data[data.length - 2].time;
            const interval = lastTime - prevTime;

            return lastTime + (logical - (data.length - 1)) * interval;
          },
          // TradingView-style visible range helpers: the host captures the
          // currently visible time window before a timeframe switch and
          // restores it after the new data loads, so drawings stay on screen.
          getVisibleRange: () => {
            const chartWidth = viewState.current.width - PADDING_RIGHT;
            const toTime = (logical: number) => {
              const idx = Math.round(logical);
              if (idx >= 0 && idx < data.length) return data[idx].time;
              if (data.length < 2) return null;
              const interval = data[data.length - 1].time - data[data.length - 2].time;
              return data[data.length - 1].time + (logical - (data.length - 1)) * interval;
            };
            const from = toTime(getIndexFromX(0));
            const to = toTime(getIndexFromX(chartWidth));
            if (from === null || to === null) return null;
            return { from, to };
          },
          setVisibleRange: (range: { from: number; to: number }) => {
            if (!range || data.length < 2) return;
            const interval = data[data.length - 1].time - data[data.length - 2].time;
            if (interval <= 0) return;
            const chartWidth = viewState.current.width - PADDING_RIGHT;
            if (chartWidth <= 0) return;
            const lastTime = data[data.length - 1].time;
            const logicalFrom = (range.from - lastTime) / interval + (data.length - 1);
            const logicalTo = (range.to - lastTime) / interval + (data.length - 1);
            const span = logicalTo - logicalFrom;
            if (span <= 0) return;
            const newScaleX = Math.max(0.5, Math.min(200, chartWidth / span));
            viewState.current.scaleX = newScaleX;
            viewState.current.offsetX = chartWidth - (data.length - 1 - logicalFrom) * newScaleX;
            setChartRevision(r => r + 1);
            draw();
            notifyViewStateChange();
          },
          fitContent: () => {
            viewState.current.offsetX = 0;
            viewState.current.scaleX = (viewState.current.width - PADDING_RIGHT) / Math.max(data.length, 1);
            viewState.current.isManualPriceRange = false;
            setChartRevision(r => r + 1);
            draw();
            notifyViewStateChange();
          },
          scrollToRealtime: () => {
            viewState.current.offsetX = 0;
            viewState.current.isManualPriceRange = false;
            setChartRevision(r => r + 1);
            draw();
            notifyViewStateChange();
          },
          applyOptions: (options: any) => {
            if (options.barSpacing !== undefined) {
              const oldScaleX = viewState.current.scaleX;
              const newScaleX = Math.max(0.5, Math.min(200, options.barSpacing));
              
              // Zoom around the center of the chart if no specific point is provided
              const centerX = (viewState.current.width - PADDING_RIGHT) / 2;
              const logicalAtCenter = getIndexFromX(centerX);
              
              viewState.current.scaleX = newScaleX;
              const chartWidth = viewState.current.width - PADDING_RIGHT;
              viewState.current.offsetX = chartWidth - centerX - (data.length - 1 - logicalAtCenter) * newScaleX;
              
              setChartRevision(r => r + 1);
              draw();
              notifyViewStateChange();
            }
            if (options.rightBarSpacing !== undefined) {
                // Map rightBarSpacing to some offset adjustment if needed, 
                // but usually barSpacing is what controls zoom.
                // For compatibility with the current BacktestLab zoom buttons:
                const zoomFactor = options.rightBarSpacing > 100 ? 1.1 : 0.9;
                const oldScaleX = viewState.current.scaleX;
                const newScaleX = Math.max(0.5, Math.min(200, oldScaleX * zoomFactor));
                
                const centerX = (viewState.current.width - PADDING_RIGHT) / 2;
                const logicalAtCenter = getIndexFromX(centerX);
                
                viewState.current.scaleX = newScaleX;
                const chartWidth = viewState.current.width - PADDING_RIGHT;
                viewState.current.offsetX = chartWidth - centerX - (data.length - 1 - logicalAtCenter) * newScaleX;
                
                setChartRevision(r => r + 1);
                draw();
                notifyViewStateChange();
            }
          },
          updateOffsetForNewBar: (isFollowing: boolean) => {
            // If following is true, we do nothing to offsetX. 
            // getX is relative to (data.length - 1), so offsetX=constant means latest bar stays at fixed X.

            // If following is false, we want historical bars to stay at fixed X.
            // As data.length increases, we must decrease offsetX by scaleX to counteract the shift.
            if (!isFollowing) {
              viewState.current.offsetX -= viewState.current.scaleX;
            }
            setChartRevision(r => r + 1);
          }
        })
      },
      series: {
        priceToCoordinate: (price: number) => getY(price),
        coordinateToPrice: (y: number) => getPriceFromY(y)
      }
    };
  }, [data, getX, getY, getIndexFromX, getPriceFromY]); // Implicitly depends on chartRevision via getX/getY

  // Keep the ref in sync without causing re-renders
  useEffect(() => { mockApiRef.current = mockApi; }, [mockApi]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    if (autoFitTrades && viewState.current.width > 0 && trades && trades.length > 0) {
      const sigParts: string[] = [String(data.length), String(data[0]?.time ?? ''), String(data[data.length - 1]?.time ?? '')];
      for (const t of trades) {
        sigParts.push(`${(t as any)?.id ?? ''}:${(t as any)?.openTime ?? ''}:${(t as any)?.closeTime ?? ''}`);
      }
      const sig = sigParts.join('|');
      if (autoFitSigRef.current !== sig && !(userInteractedRef.current && autoFitSigRef.current !== null)) {
        let minIdx = Infinity;
        let maxIdx = -Infinity;
        for (const t of trades) {
          if (!t) continue;
          const ei = findClosestCandleIndex(data, parseTradeTimeSec((t as any).openTime ?? (t as any).open_time ?? (t as any).time ?? (t as any).entry_time));
          const xi = findClosestCandleIndex(data, parseTradeTimeSec((t as any).closeTime ?? (t as any).close_time ?? (t as any).exit_time));
          if (ei >= 0) { minIdx = Math.min(minIdx, ei); maxIdx = Math.max(maxIdx, ei); }
          if (xi >= 0) { minIdx = Math.min(minIdx, xi); maxIdx = Math.max(maxIdx, xi); }
        }
        if (Number.isFinite(minIdx) && Number.isFinite(maxIdx)) {
          const fitWidth = viewState.current.width - PADDING_RIGHT;
          if (fitWidth > 0) {
            const CONTEXT = 8;
            const fromIdx = Math.max(0, Math.floor(minIdx) - CONTEXT);
            const toIdx = Math.min(data.length - 1, Math.ceil(maxIdx) + CONTEXT);
            const span = Math.max(1, toIdx - fromIdx + 1);
            viewState.current.scaleX = Math.max(0.5, Math.min(200, fitWidth / span));
            viewState.current.offsetX = (data.length - 1 - toIdx) * viewState.current.scaleX * -1;
            autoFitSigRef.current = sig;
            userInteractedRef.current = false;
          }
        }
      }
    }

    const { width, height, scaleX, offsetX, isManualPriceRange, manualMinPrice, manualMaxPrice } = viewState.current;
    const chartWidth = width - PADDING_RIGHT;
    const chartHeight = height - PADDING_BOTTOM;
    const dpr = width > 0 ? (canvas.width / width) : (window.devicePixelRatio || 1);
    const intervalSec = getInterval();

    // TradingView-style crosshair (hover state), only active when enabled.
    // Never touch-driven: fingers use the aim cursor + preview instead.
    const crossPos = crosshairRef.current;
    const isDragging = mouse.current.isDown;
    const showCross = tradingView && crossPos !== null && !isDragging && !crosshairTouchRef.current &&
      crossPos.x >= 0 && crossPos.x <= chartWidth && crossPos.y >= 0 && crossPos.y <= chartHeight;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 1. Calculate Scales
    const leftIdx = Math.floor(getIndexFromX(0));
    const rightIdx = Math.ceil(getIndexFromX(chartWidth));
    const start = Math.max(0, leftIdx);
    const end = Math.min(data.length - 1, rightIdx);

    // Auto-calculate range from visible data for validation
    let dataMin = Infinity;
    let dataMax = -Infinity;
    let hasValidData = false;

    for (let i = start; i <= end; i++) {
      if (data[i].low > 0 && data[i].low < Infinity) {
        if (data[i].low < dataMin) dataMin = data[i].low;
        hasValidData = true;
      }
      if (data[i].high > 0 && data[i].high < Infinity) {
        if (data[i].high > dataMax) dataMax = data[i].high;
        hasValidData = true;
      }
    }

    if (!hasValidData) {
      // Fallback if no valid data in view
      dataMin = 0;
      dataMax = 100;
    }

    // Prices that must be inside the y-domain regardless of marker visibility.
    // `priceAnchors` lets a progressive surface (replay) reserve the range from
    // the first frame so the chart never rescales when a marker appears.
    if (!isManualPriceRange) {
      const candleSpan = dataMax - dataMin || 1;
      const isOnScale = (p: number) =>
        Number.isFinite(p) && p > 0 &&
        p >= dataMin - candleSpan * 0.5 &&
        p <= dataMax + candleSpan * 0.5;

      const expand = (p: number) => {
        if (!isOnScale(p)) return;
        if (p < dataMin) dataMin = p;
        if (p > dataMax) dataMax = p;
      };

      if (priceAnchors) for (const p of priceAnchors) expand(Number(p));

      if (trades && trades.length > 0) {
        // Only expand for trade prices that are reasonably close to the candle
        // data.  Off-scale prices (e.g. lot size stored in entryPrice by
        // mistake, or a different symbol's scale) would otherwise compress the
        // entire chart into a tiny band.
        for (const t of trades) {
          if (!t) continue;
          expand(Number((t as any).entryPrice ?? (t as any).entry ?? (t as any).price));
          expand(Number((t as any).exitPrice ?? (t as any).exit));
        }
      }
    }

    if (!isManualPriceRange) {
      const padding = (dataMax - dataMin) * 0.1 || 0.0001;
      viewState.current.minPrice = dataMin - padding;
      viewState.current.maxPrice = dataMax + padding;
    } else {
      // Validation: If manual range is completely disjoint from data, reset it
      // This handles the case where user switches symbols but state persisted (though we fixed keys, this is extra safety)
      if (dataMax < manualMinPrice || dataMin > manualMaxPrice) {
        const padding = (dataMax - dataMin) * 0.1 || 0.0001;
        viewState.current.minPrice = dataMin - padding;
        viewState.current.maxPrice = dataMax + padding;
        viewState.current.isManualPriceRange = false;
        // We don't update manualMin/Max here to avoid loop, just the effective min/max
      } else {
        viewState.current.minPrice = manualMinPrice;
        viewState.current.maxPrice = manualMaxPrice;
      }
    }

    const { minPrice, maxPrice } = viewState.current;
    if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice)) return;

    // 2. Clear
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    // 3. Grid — timeStep declared here so time labels can use it below
    const timeStep = Math.max(1, Math.ceil(100 / scaleX));
    if (showGrid) {
      ctx.strokeStyle = isDarkMode ? '#0a0a0a' : '#f8fafc';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const y = (chartHeight / 10) * i;
        ctx.moveTo(0, y); ctx.lineTo(chartWidth, y);
      }
      for (let i = start - (start % timeStep); i <= end; i += timeStep) {
        const x = getX(i);
        ctx.moveTo(x, 0); ctx.lineTo(x, chartHeight);
      }
      ctx.stroke();
    }

    // 4. Candles
    const candleWidth = Math.max(1, Math.min(scaleX * 0.72, scaleX - 1));
    const wickWidth = Math.max(1, Math.round(Math.min(scaleX * 0.12, 2)));

    data.slice(start, end + 1).forEach((candle, i) => {
      const idx = start + i;
      // Skip malformed bars instead of painting NaN/Inf geometry, which
      // silently corrupts the canvas for the rest of the frame.
      if (!Number.isFinite(candle.open) || !Number.isFinite(candle.close) ||
        !Number.isFinite(candle.high) || !Number.isFinite(candle.low)) return;
      const x = getX(idx);
      const yOpen = getY(candle.open);
      const yClose = getY(candle.close);
      const yHigh = getY(candle.high);
      const yLow = getY(candle.low);

      const isUp = candle.close >= candle.open;
      const bodyColor = isUp ? '#10b981' : '#ef4444';
      const wickX = Math.round(x) + 0.5;
      const bodyX = Math.round(x - candleWidth / 2) + 0.5;
      const bodyTop = Math.min(yOpen, yClose);
      const bodyHeight = Math.max(1, Math.abs(yOpen - yClose));
      const wickTop = Math.min(yHigh, yLow);
      const wickHeight = Math.max(1, Math.abs(yLow - yHigh));

      ctx.fillStyle = bodyColor;
      ctx.strokeStyle = bodyColor;

      ctx.fillRect(wickX - wickWidth / 2, wickTop, wickWidth, wickHeight);
      ctx.fillRect(bodyX, bodyTop, candleWidth, bodyHeight);
      ctx.lineWidth = 1;
      ctx.strokeRect(bodyX, bodyTop, candleWidth, bodyHeight);
    });

    // 4a. Select-Bar cut preview — TradingView-style draggable vertical line (move left/right then click to cut)
    if (isSelectBarMode && selectBarIndex !== null && selectBarIndex >= 0 && selectBarIndex < data.length) {
      const sx = getX(selectBarIndex);
      if (sx >= 0 && sx <= chartWidth) {
        // Shade the future (to be hidden) to the right of the cut
        ctx.fillStyle = isDarkMode ? 'rgba(0,0,0,0.42)' : 'rgba(148,163,184,0.16)';
        ctx.fillRect(sx + 1, 0, Math.max(0, chartWidth - sx - 1), chartHeight);
        // Dashed vertical cut line
        ctx.save();
        ctx.strokeStyle = '#2962ff';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(Math.round(sx) + 0.5, 0);
        ctx.lineTo(Math.round(sx) + 0.5, chartHeight);
        ctx.stroke();
        ctx.restore();
        // Top "Cut here" badge
        const label = 'Cut here';
        ctx.font = 'bold 10px sans-serif';
        const tw = ctx.measureText(label).width;
        const badgeW = tw + 18;
        const badgeH = 18;
        const bx = Math.min(Math.max(sx - badgeW / 2, 2), chartWidth - badgeW - 2);
        ctx.fillStyle = '#2962ff';
        roundRectPath(ctx, bx, 5, badgeW, badgeH, 9);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, bx + badgeW / 2, 5 + badgeH / 2);
        // Center grip
        ctx.beginPath();
        ctx.fillStyle = '#2962ff';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.arc(sx, chartHeight / 2, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // Bottom time label at axis
        const t = data[selectBarIndex].time;
        const tLabel = formatAxisTime(t, intervalSec);
        ctx.font = 'bold 10px monospace';
        const tW = ctx.measureText(tLabel).width + 14;
        const tx = Math.min(Math.max(sx - tW / 2, 2), chartWidth - tW - 2);
        ctx.fillStyle = '#2962ff';
        roundRectPath(ctx, tx, chartHeight + 4, tW, 16, 4);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tLabel, tx + tW / 2, chartHeight + 13);
      }
    }

    // 4b. Crosshair bar highlight (drawn behind drawings, like TradingView)
    if (showCross && crossPos && !(isSelectBarMode && selectBarIndex !== null)) {
      const hoverIdx = Math.round(getIndexFromX(crossPos.x));
      if (hoverIdx >= 0 && hoverIdx < data.length) {
        const barX = getX(hoverIdx);
        const barW = Math.max(scaleX * 0.85, 1);
        ctx.fillStyle = isDarkMode ? 'rgba(148, 163, 184, 0.10)' : 'rgba(51, 65, 85, 0.08)';
        ctx.fillRect(barX - barW / 2, 0, barW, chartHeight);
      }
    }

    // 5. Drawings (Canvas Layer) — Full visual rendering (SVG is hit-area only)
    // Clipped to the plot (full height, chart width): no drawing — lines,
    // boxes, fills, ghosts, snap dots — may ever paint over the price scale.
    // (The selected-vertical time badge lives in the bottom date strip, so
    // the clip keeps full height and only cuts the right scale region.)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, chartWidth, height);
    ctx.clip();
    const selectedSet: Set<string> = new Set(selectedIds ?? (selectedDrawingId ? [selectedDrawingId] : []));
    // NOTE: price-tip badges on drawings are intentionally disabled — drawings
    // render as bare lines/shapes with no axis price tags (all tools).
    drawings.forEach(d => {
      // Calculate coords
      let x1: number, x2: number;

      // Use logical mapping for stability
      if (d.p1.logical !== undefined) x1 = getX(d.p1.logical);
      else x1 = mockApi.chart.timeScale().timeToCoordinate(d.p1.time) ?? -1000;

      const y1 = getY(d.p1.price);

      if (d.p2) {
        if (d.p2.logical !== undefined) x2 = getX(d.p2.logical);
        else x2 = mockApi.chart.timeScale().timeToCoordinate(d.p2.time) ?? -1000;
      } else {
        x2 = x1;
      }

      const y2 = d.p2 ? getY(d.p2.price) : y1;

      const isSelected = selectedSet.has(d.id);
      const isHovered = hoveredDrawingId === d.id;
      const baseWidth = d.strokeWidth || 2;
      const drawColor = d.color || (isDarkMode ? '#2962ff' : '#475569');
      // Selection glow (under-stroke) + hover emphasis — TradingView blue pick.
      if (isSelected) {
        ctx.save();
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(41, 98, 255, 0.35)';
        ctx.lineWidth = baseWidth + 6;
        ctx.lineCap = 'round';
      } else {
        ctx.strokeStyle = drawColor;
        ctx.lineWidth = isHovered ? baseWidth + 1 : baseWidth;
      }

      // Line Styles
      ctx.setLineDash([]);
      if (!isSelected) {
        if (d.strokeStyle === 'dashed') ctx.setLineDash([6, 6]);
        if (d.strokeStyle === 'dotted') ctx.setLineDash([2, 4]);
      }

      ctx.beginPath();

      if (d.type === 'trendline' || d.type === 'arrow') {
        const seg = extendSegmentToBounds(x1, y1, x2, y2, chartWidth, chartHeight, !!d.extendLeft, !!d.extendRight);
        if (isSelected) {
          ctx.moveTo(seg.x1, seg.y1);
          ctx.lineTo(seg.x2, seg.y2);
          ctx.stroke();
          ctx.restore();
          ctx.strokeStyle = drawColor;
          ctx.lineWidth = baseWidth;
          ctx.setLineDash([]);
          if (d.strokeStyle === 'dashed') ctx.setLineDash([6, 6]);
          if (d.strokeStyle === 'dotted') ctx.setLineDash([2, 4]);
          ctx.beginPath();
        }
        ctx.moveTo(seg.x1, seg.y1);
        ctx.lineTo(seg.x2, seg.y2);
        ctx.stroke();

        if (d.type === 'arrow') {
          ctx.setLineDash([]);
          const angle = Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1);
          // Arrowhead scales with stroke width (TradingView parity).
          const headLen = 8 + baseWidth * 3;
          const headW = Math.PI / 6;
          ctx.beginPath();
          ctx.moveTo(seg.x2, seg.y2);
          ctx.lineTo(seg.x2 - headLen * Math.cos(angle - headW), seg.y2 - headLen * Math.sin(angle - headW));
          ctx.lineTo(seg.x2 - headLen * Math.cos(angle + headW), seg.y2 - headLen * Math.sin(angle + headW));
          ctx.closePath();
          ctx.fillStyle = drawColor;
          ctx.fill();
        }
        if (isSelected) {
          // Endpoint handles (canvas mirror of SVG handles).
          ctx.setLineDash([]);
          for (const [hx, hy] of [[seg.x1, seg.y1], [seg.x2, seg.y2]] as const) {
            ctx.beginPath();
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#2962ff';
            ctx.lineWidth = 2;
            ctx.rect(hx - 4, hy - 4, 8, 8);
            ctx.fill();
            ctx.stroke();
          }
        }
      }
      else if (d.type === 'measure') {
        // Measure tool (TV range tool): dashed line + floating measure label.
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = drawColor;
        ctx.lineWidth = baseWidth;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.restore();
        const mP1 = (d.p1.logical !== undefined ? data[Math.round(d.p1.logical)] : null) || null;
        void mP1;
        const priceA = d.p1.price;
        const priceB = d.p2 ? d.p2.price : d.p1.price;
        const pts = priceB - priceA;
        const pct = priceA !== 0 ? (pts / Math.abs(priceA)) * 100 : 0;
        const bars = d.p2 && d.p1.logical !== undefined && d.p2.logical !== undefined
          ? Math.abs(Math.round(d.p2.logical) - Math.round(d.p1.logical)) : 0;
        const sign = pts > 0 ? '+' : '';
        const mLabel = `${sign}${Number(pts.toFixed(5))} (${sign}${pct.toFixed(2)}%) · ${bars} bars`;
        ctx.font = 'bold 10px sans-serif';
        const mW = ctx.measureText(mLabel).width + 14;
        const mX = Math.min(Math.max((x1 + x2) / 2 - mW / 2, 2), Math.max(2, chartWidth - mW - 2));
        const mY = Math.min(Math.max((y1 + y2) / 2 - 11, 2), Math.max(2, chartHeight - 24));
        ctx.fillStyle = isDarkMode ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.92)';
        roundRectPath(ctx, mX, mY, mW, 20, 6);
        ctx.fill();
        ctx.fillStyle = drawColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(mLabel, mX + mW / 2, mY + 10);
        if (isSelected) {
          ctx.setLineDash([]);
          ctx.beginPath(); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2962ff'; ctx.lineWidth = 2;
          ctx.rect(x1 - 4, y1 - 4, 8, 8); ctx.fill(); ctx.stroke();
          ctx.beginPath();
          ctx.rect(x2 - 4, y2 - 4, 8, 8); ctx.fill(); ctx.stroke();
        }
      }
      else if (d.type === 'ray') {
        const ray = getRayCoordinates(x1, y1, x2, y2, chartWidth, chartHeight);
        if (isSelected) { ctx.moveTo(ray.x1, ray.y1); ctx.lineTo(ray.x2, ray.y2); ctx.stroke(); ctx.restore(); ctx.strokeStyle = drawColor; ctx.lineWidth = baseWidth; ctx.setLineDash([]); ctx.beginPath(); }
        ctx.moveTo(ray.x1, ray.y1);
        ctx.lineTo(ray.x2, ray.y2);
        ctx.stroke();
        if (isSelected) {
          ctx.setLineDash([]);
          ctx.beginPath(); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2962ff'; ctx.lineWidth = 2;
          ctx.rect(ray.x1 - 4, ray.y1 - 4, 8, 8); ctx.fill(); ctx.stroke();
        }
      }
      else if (d.type === 'rect') {
        const rx = Math.min(x1, x2), ry = Math.min(y1, y2);
        const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);
        if (d.fillVisible !== false) {
          ctx.fillStyle = drawColor;
          ctx.globalAlpha = isSelected ? 0.18 : 0.12;
          ctx.fillRect(rx, ry, rw, rh);
          ctx.globalAlpha = 1.0;
        }
        if (isSelected) { ctx.stroke(); ctx.restore(); ctx.strokeStyle = drawColor; ctx.lineWidth = baseWidth; ctx.setLineDash([]); ctx.beginPath(); }
        ctx.strokeRect(rx, ry, rw, rh);
        if (isSelected) {
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = '#2962ff';
          ctx.lineWidth = 1;
          ctx.strokeRect(rx - 4, ry - 4, rw + 8, rh + 8);
          ctx.setLineDash([]);
        }
      }
      else if (d.type === 'horizontal') {
        if (isSelected) { ctx.moveTo(0, y1); ctx.lineTo(chartWidth, y1); ctx.stroke(); ctx.restore(); ctx.strokeStyle = drawColor; ctx.lineWidth = baseWidth; ctx.setLineDash([]); ctx.beginPath(); }
        ctx.moveTo(0, y1);
        ctx.lineTo(chartWidth, y1);
        ctx.stroke();
      }
      else if (d.type === 'vertical') {
        if (isSelected) { ctx.moveTo(x1, 0); ctx.lineTo(x1, chartHeight); ctx.stroke(); ctx.restore(); ctx.strokeStyle = drawColor; ctx.lineWidth = baseWidth; ctx.setLineDash([]); ctx.beginPath(); }
        ctx.moveTo(x1, 0);
        ctx.lineTo(x1, chartHeight);
        ctx.stroke();
        if (isSelected) {
          // Time badge on the bottom axis for the selected vertical line.
          const t = d.p1.time;
          const label = formatAxisTime(t, intervalSec);
          ctx.font = 'bold 10px sans-serif';
          const tw = ctx.measureText(label).width + 12;
          const bx = Math.min(Math.max(x1 - tw / 2, 0), chartWidth - tw);
          ctx.fillStyle = '#2962ff';
          ctx.fillRect(bx, chartHeight, tw, 20);
          ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(label, bx + tw / 2, chartHeight + 10);
        }
      }
      else if (d.type === 'fib') {
        ctx.setLineDash([]);
        const defaultFib = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
        const fibLevels: number[] = Array.isArray((d as any).fibLevels) && (d as any).fibLevels.length > 0
          ? (d as any).fibLevels
          : defaultFib;
        const fibColors = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444'];
        const fMinX = Math.min(x1, x2);
        const fMaxX = Math.max(x1, x2);
        const fMinY = Math.min(y1, y2);
        const fMaxY = Math.max(y1, y2);
        const fDiff = fMaxY - fMinY;

        fibLevels.forEach((level, i) => {
          const fy = fMinY + fDiff * level;
          ctx.strokeStyle = fibColors[i % fibColors.length];
          ctx.lineWidth = d.strokeWidth || 1;
          ctx.beginPath();
          ctx.moveTo(fMinX, fy);
          ctx.lineTo(fMaxX, fy);
          ctx.stroke();
          // Level label
          ctx.fillStyle = fibColors[i % fibColors.length];
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${(level * 100).toFixed(1)}%`, fMaxX + 5, fy);
        });
        // Background tint
        ctx.fillStyle = drawColor;
        ctx.globalAlpha = 0.04;
        ctx.fillRect(fMinX, fMinY, fMaxX - fMinX, fDiff);
        ctx.globalAlpha = 1.0;
        if (isSelected) {
          ctx.save();
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = '#2962ff';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(fMinX - 3, fMinY - 3, (fMaxX - fMinX) + 6, fDiff + 6);
          ctx.restore();
        }
      }
      else if (d.type === 'channel') {
        const channelDx = x2 - x1;
        const channelDy = y2 - y1;
        const channelAngle = Math.atan2(channelDy, channelDx);
        const perpAngle = channelAngle + Math.PI / 2;
        const channelOffset = 50;
        const cx3 = x2 + Math.cos(perpAngle) * channelOffset;
        const cy3 = y2 + Math.sin(perpAngle) * channelOffset;
        const cx4 = x1 + Math.cos(perpAngle) * channelOffset;
        const cy4 = y1 + Math.sin(perpAngle) * channelOffset;
        // Fill
        ctx.fillStyle = drawColor;
        ctx.globalAlpha = 0.08;
        ctx.beginPath();
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(cx3, cy3); ctx.lineTo(cx4, cy4);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1.0;
        // Lines
        ctx.beginPath();
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx4, cy4); ctx.lineTo(cx3, cy3);
        ctx.stroke();
        // Side lines
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x1, y1); ctx.lineTo(cx4, cy4);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x2, y2); ctx.lineTo(cx3, cy3);
        ctx.stroke();
        ctx.setLineDash([]);
        if (isSelected) {
          ctx.save();
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = '#2962ff';
          ctx.lineWidth = 1.5;
          const chMinX = Math.min(x1, x2, cx3, cx4) - 3;
          const chMaxX = Math.max(x1, x2, cx3, cx4) + 3;
          const chMinY = Math.min(y1, y2, cy3, cy4) - 3;
          const chMaxY = Math.max(y1, y2, cy3, cy4) + 3;
          ctx.strokeRect(chMinX, chMinY, chMaxX - chMinX, chMaxY - chMinY);
          ctx.restore();
        }
      }
      else if (d.type === 'text') {
        ctx.setLineDash([]);
        ctx.fillStyle = drawColor;
        ctx.font = `bold ${d.fontSize || 14}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(d.text || 'Text', x1, y1);
      }
      else if (d.type === 'long' || d.type === 'short') {
        ctx.setLineDash([]);
        const isLong = d.type === 'long';
        const entryPrice = d.entry ?? d.p1.price;
        const targetPrice = d.target ?? (isLong ? entryPrice * 1.02 : entryPrice * 0.98);
        const stopPrice = d.stop ?? (isLong ? entryPrice * 0.99 : entryPrice * 1.01);

        const entryY = getY(entryPrice);
        const targetY = getY(targetPrice);
        const stopY = getY(stopPrice);

        const w = Math.max(Math.abs(x2 - x1), positionToolMinWidth(typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches));
        const left = Math.min(x1, x2 || x1 + w);
        const right = left + w;
        const centerX = left + (w / 2);

        // Calculate R:R
        const risk = Math.abs(entryPrice - stopPrice);
        const reward = Math.abs(targetPrice - entryPrice);
        const rr = risk > 0 ? (reward / risk) : 0;

        const profitTop = Math.min(entryY, targetY);
        const profitH = Math.abs(targetY - entryY);
        const lossTop = Math.min(entryY, stopY);
        const lossH = Math.abs(stopY - entryY);

        // --- Profit zone ---
        // Fill
        ctx.fillStyle = isDarkMode ? 'rgba(38, 166, 154, 0.25)' : 'rgba(38, 166, 154, 0.15)';
        ctx.fillRect(left, profitTop, w, Math.max(profitH, 1));
        // --- Loss zone ---
        // Fill
        ctx.fillStyle = isDarkMode ? 'rgba(239, 83, 80, 0.25)' : 'rgba(239, 83, 80, 0.15)';
        ctx.fillRect(left, lossTop, w, Math.max(lossH, 1));

        // --- Entry line ---
        ctx.strokeStyle = isDarkMode ? '#b2b5be' : '#555555';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left, entryY);
        ctx.lineTo(right, entryY);
        ctx.stroke();

        // --- Center RR Text Tag (TradingView Style) ---
        const rrText = `R:R ${rr.toFixed(2)}`;
        ctx.font = 'bold 9px sans-serif';
        const txtWidth = ctx.measureText(rrText).width;
        if (isSelected) {
          ctx.save();
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = '#2962ff';
          ctx.lineWidth = 1.5;
          const top = Math.min(profitTop, lossTop);
          const h = Math.max(profitTop + Math.max(profitH, 1), lossTop + Math.max(lossH, 1)) - top;
          ctx.strokeRect(left - 3, top - 3, w + 6, h + 6);
          ctx.restore();
        }
        ctx.font = 'bold 9px sans-serif';
        // Background for text
        ctx.fillStyle = isDarkMode ? 'rgba(0, 0, 0, 0.55)' : 'rgba(255, 255, 255, 0.85)';
        // Center text on the entry line
        ctx.fillRect(centerX - (txtWidth / 2) - 5, entryY - 7, txtWidth + 10, 14);
        ctx.fillStyle = isDarkMode ? 'rgba(226, 232, 240, 0.95)' : 'rgba(30, 41, 59, 0.95)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(rrText, centerX, entryY);
        if (isSelected) { ctx.setLineDash([]); }
      }
    });
    ctx.setLineDash([]); // Reset

    // 5c. Magnet snap indicator (TradingView snap dot + price bubble).
    if (snapIndicator) {
      const coarseSnap = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
      ctx.beginPath();
      ctx.fillStyle = '#2962ff';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.arc(snapIndicator.x, snapIndicator.y, coarseSnap ? 7 : 5, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      // Price bubble so you can see WHAT you snapped to (TV-style).
      const snapPriceText = formatPrice(getPriceFromY(snapIndicator.y));
      ctx.font = 'bold 10px monospace';
      const snapW = ctx.measureText(snapPriceText).width + 14;
      const snapX = Math.min(Math.max(snapIndicator.x + 12, 2), Math.max(2, chartWidth - snapW - 2));
      const snapYc = Math.min(Math.max(snapIndicator.y - 11, 2), Math.max(2, chartHeight - 24));
      ctx.fillStyle = '#2962ff';
      roundRectPath(ctx, snapX, snapYc, snapW, 20, 6);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(snapPriceText, snapX + snapW / 2, snapYc + 10);
    }

    // 5d. Live drawing preview (TV ghost): dashed line from the placed anchor
    // to the finger/mouse while a 2-step tool is armed.
    if (previewDrawing && previewMouse) {
      const pv = previewDrawing as Drawing;
      const pvP1 = pv.p1.logical !== undefined ? getX(pv.p1.logical) : (mockApi.chart.timeScale().timeToCoordinate(pv.p1.time) ?? previewMouse.x);
      const pvY1 = getY(pv.p1.price);
      const pvX2 = previewMouse.x;
      const pvY2 = previewMouse.y;
      const pvColor = pv.color || '#2962ff';
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = pvColor;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = Math.max(1, pv.strokeWidth || 1);
      ctx.beginPath();
      if (pv.type === 'horizontal') { ctx.moveTo(0, pvY2); ctx.lineTo(chartWidth, pvY2); }
      else if (pv.type === 'vertical') { ctx.moveTo(pvX2, 0); ctx.lineTo(pvX2, chartHeight); }
      else if (pv.type === 'rect') {
        ctx.strokeRect(Math.min(pvP1, pvX2), Math.min(pvY1, pvY2), Math.abs(pvX2 - pvP1), Math.abs(pvY2 - pvY1));
      } else {
        ctx.moveTo(pvP1, pvY1);
        ctx.lineTo(pvX2, pvY2);
      }
      ctx.stroke();
      ctx.restore();
      // Anchor dot at the placed point + finger dot while armed.
      const coarsePv = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
      if (coarsePv && pv.type !== 'horizontal' && pv.type !== 'vertical') {
        ctx.beginPath();
        ctx.fillStyle = pvColor;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.arc(pvP1, pvY1, 6, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.globalAlpha = 0.6;
        ctx.arc(pvX2, pvY2, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.stroke();
      }
    }

    // 5e. Placement cursor (TradingView-mobile aim model): blue dot with
    // intersecting crosshair lines that follows the finger while a drawing
    // tool is armed on touch — set BEFORE the first point exists, so the
    // user aims without their finger covering the target.  A tap commits the
    // point at this dot (handled by the host, not here).
    if (placementCursor) {
      const pcx = placementCursor.x;
      const pcy = placementCursor.y;
      ctx.save();
      // Full-plot crosshair lines, dashed like TradingView (the arm ghost
      // stays solid-dashed [5,4], so the two remain distinguishable).
      ctx.strokeStyle = '#2962ff';
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(0, pcy); ctx.lineTo(chartWidth, pcy);
      ctx.moveTo(pcx, 0); ctx.lineTo(pcx, chartHeight);
      ctx.stroke();
      ctx.restore();
      // Blue dot with white ring (TradingView size).
      ctx.beginPath();
      ctx.fillStyle = '#2962ff';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.arc(pcx, pcy, 4, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
    ctx.restore(); // End plot clip — axes/scale paint after this.

    // 5. Trade Entry & Exit Markers — MT5-style solid arrows + dashed
    // entry→exit connector, clipped to the plot so markers never spill
    // onto the price scale.
    if (trades && trades.length > 0) {
      const MT5_BUY = '#2E9BFF';
      const MT5_SELL = '#F23645';
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, chartWidth, height);
      ctx.clip();
      // MT5-style solid arrow pointing UP: tip at (centerX, tipY), body below it.
      const drawUpArrow = (centerX: number, tipY: number, color: string) => {
        const arrowW = 14;
        const arrowH = 11;
        ctx.save();
        ctx.fillStyle = color;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(centerX, tipY);
        ctx.lineTo(centerX - arrowW / 2, tipY + arrowH);
        ctx.lineTo(centerX + arrowW / 2, tipY + arrowH);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      };

      // MT5-style solid arrow pointing DOWN: tip at (centerX, tipY), body above it.
      const drawDownArrow = (centerX: number, tipY: number, color: string) => {
        const arrowW = 14;
        const arrowH = 11;
        ctx.save();
        ctx.fillStyle = color;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(centerX, tipY);
        ctx.lineTo(centerX - arrowW / 2, tipY - arrowH);
        ctx.lineTo(centerX + arrowW / 2, tipY - arrowH);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      };

      trades.forEach(trade => {
        if (!trade) return;
        const isBuy = trade.direction
          ? trade.direction === 'Long'
          : ((trade as any).type === 'BUY' || (trade as any).tradeSide === 'buy');
        const entryPrice = trade.entryPrice ?? (trade as any).entry ?? (trade as any).price;
        const exitPrice = trade.exitPrice ?? (trade as any).exit;

        const entrySec = parseTradeTimeSec(
          (trade as any).openTime ?? (trade as any).open_time ?? (trade as any).time ?? (trade as any).entry_time
        );
        const exitSec = parseTradeTimeSec(
          (trade as any).closeTime ?? (trade as any).close_time ?? (trade as any).exit_time
        );

        const entryIdx = findClosestCandleIndex(data, entrySec);
        const exitIdx = findClosestCandleIndex(data, exitSec);

        const hasEntryPrice = Number.isFinite(Number(entryPrice)) && Number(entryPrice) > 0;
        const hasExitPrice = Number.isFinite(Number(exitPrice)) && Number(exitPrice) > 0;

        // Detect prices that are wildly off-scale from the visible candle
        // range — e.g. lot-size stored as entryPrice, or a different
        // symbol's scale. Fall back to candle wick when off-scale.
        const { minPrice: visMin, maxPrice: visMax } = viewState.current;
        const visSpan = visMax - visMin || 1;
        const priceOnScale = (p: number) =>
          p >= visMin - visSpan * 0.5 && p <= visMax + visSpan * 0.5;
        const useEntryPrice = hasEntryPrice && priceOnScale(Number(entryPrice));
        const useExitPrice  = hasExitPrice  && priceOnScale(Number(exitPrice));

        // MT5 entry arrow, tipped at the fill price when known, otherwise just
        // outside the wick so it never hides inside the candle body.
        let entryTip: { x: number; y: number; up: boolean; color: string } | null = null;
        if (entryIdx >= 0) {
          const candle = data[entryIdx];
          const sameBar = entryIdx === exitIdx && exitIdx >= 0;
          const candleX = getX(entryIdx) + (sameBar ? -7 : 0);

          if (isBuy) {
            // Long entry (buy) -> blue arrow pointing UP
            const tipY = clampY(useEntryPrice ? getY(Number(entryPrice)) : getY(candle.low) + 10, chartHeight);
            entryTip = { x: candleX, y: tipY, up: true, color: MT5_BUY };
          } else {
            // Short entry (sell) -> red arrow pointing DOWN
            const tipY = clampY(useEntryPrice ? getY(Number(entryPrice)) : getY(candle.high) - 10, chartHeight);
            entryTip = { x: candleX, y: tipY, up: false, color: MT5_SELL };
          }
        }

        // MT5 exit arrow + dashed entry→exit connector (connector under the arrows).
        let exitTip: { x: number; y: number; up: boolean; color: string } | null = null;
        if (exitIdx >= 0) {
          const candle = data[exitIdx];
          const sameBar = entryIdx === exitIdx && entryIdx >= 0;
          const exitX = getX(exitIdx) + (sameBar ? 7 : 0);

          if (isBuy) {
            // Long exit (sell) -> red arrow pointing DOWN
            const tipY = clampY(useExitPrice ? getY(Number(exitPrice)) : getY(candle.high) - 10, chartHeight);
            exitTip = { x: exitX, y: tipY, up: false, color: MT5_SELL };
          } else {
            // Short exit (buy) -> blue arrow pointing UP
            const tipY = clampY(useExitPrice ? getY(Number(exitPrice)) : getY(candle.low) + 10, chartHeight);
            exitTip = { x: exitX, y: tipY, up: true, color: MT5_BUY };
          }
        }

        if (entryTip && exitTip) {
          ctx.save();
          ctx.strokeStyle = isDarkMode ? 'rgba(129,140,248,0.7)' : 'rgba(71,85,171,0.6)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(entryTip.x, entryTip.y);
          ctx.lineTo(exitTip.x, exitTip.y);
          ctx.stroke();
          ctx.restore();
        }
        const drawMarkerLabel = (text: string, x: number, tipY: number, isUp: boolean, color: string) => {
          ctx.save();
          ctx.font = 'bold 9px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
          ctx.textAlign = 'center';
          // Up-pointing arrow: tip is at tipY, base extends down to tipY + 11. Text goes below base.
          // Down-pointing arrow: tip is at tipY, base extends up to tipY - 11. Text goes above base.
          const textY = isUp ? tipY + 14 : tipY - 14;
          ctx.textBaseline = isUp ? 'top' : 'bottom';

          // Crisp stroke outline so text is legible across candlesticks and grid lines
          ctx.strokeStyle = isDarkMode ? 'rgba(0, 0, 0, 0.85)' : 'rgba(255, 255, 255, 0.9)';
          ctx.lineWidth = 2.5;
          ctx.lineJoin = 'round';
          ctx.strokeText(text, x, textY);

          ctx.fillStyle = color;
          ctx.fillText(text, x, textY);
          ctx.restore();
        };

        if (entryTip) {
          if (entryTip.up) drawUpArrow(entryTip.x, entryTip.y, entryTip.color);
          else drawDownArrow(entryTip.x, entryTip.y, entryTip.color);
          drawMarkerLabel('Entry', entryTip.x, entryTip.y, entryTip.up, entryTip.color);
        }
        if (exitTip) {
          if (exitTip.up) drawUpArrow(exitTip.x, exitTip.y, exitTip.color);
          else drawDownArrow(exitTip.x, exitTip.y, exitTip.color);
          drawMarkerLabel('Exit', exitTip.x, exitTip.y, exitTip.up, exitTip.color);
        }
      });
      ctx.restore(); // End trade-marker plot clip.
    }

    // 5b. TradingView-style symbol + timeframe watermark
    if (tradingView && symbol) {
      ctx.save();
      ctx.globalAlpha = isDarkMode ? 0.05 : 0.04;
      ctx.fillStyle = isDarkMode ? '#ffffff' : '#0f172a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 52px sans-serif';
      const watermarkText = timeframe ? `${symbol} \u00b7 ${timeframe}` : symbol;
      ctx.fillText(watermarkText, chartWidth / 2, chartHeight / 2);
      ctx.restore();
    }

    // 5c. TradingView-style OHLC legend (top-left) — shows the hovered bar,
    // or the latest bar when not hovering.
    if (tradingView) {
      const hoverBar = showCross && crossPos
        ? data[Math.round(getIndexFromX(crossPos.x))]
        : data[data.length - 1];
      if (hoverBar) {
        const prevBar = data[data.length - 2];
        const prevClose = prevBar ? prevBar.close : hoverBar.open;
        const changePct = prevClose !== 0 ? ((hoverBar.close - prevClose) / prevClose) * 100 : 0;
        const isUp = hoverBar.close >= hoverBar.open;
        const accent = isUp ? '#10b981' : '#ef4444';

        const legendX = 8;
        const legendY = 8;

        ctx.font = 'bold 10px sans-serif';
        const titleText = [symbol, timeframe].filter(Boolean).join(' \u00b7 ');
        const titleW = ctx.measureText(titleText).width;

        ctx.font = 'bold 8px monospace';
        const cVal = formatPrice(hoverBar.close);
        const ohlcPrefix = `O ${formatPrice(hoverBar.open)}  H ${formatPrice(hoverBar.high)}  L ${formatPrice(hoverBar.low)}  C `;
        const ohlcW = ctx.measureText(ohlcPrefix + cVal).width;

        const changeText = `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`;
        ctx.font = 'bold 8px sans-serif';
        const changeW = ctx.measureText(changeText).width;

        const boxW = Math.max(titleW + changeW + 28, ohlcW + 16);
        const boxH = 32;

        ctx.fillStyle = isDarkMode ? 'rgba(10, 12, 18, 0.62)' : 'rgba(255, 255, 255, 0.85)';
        roundRectPath(ctx, legendX, legendY, boxW, boxH, 6);
        ctx.fill();

        // Title row
        ctx.fillStyle = isDarkMode ? '#d1d5db' : '#334155';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(titleText, legendX + 8, legendY + 11);

        // Change % badge
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.18;
        roundRectPath(ctx, legendX + 10 + titleW, legendY + 4, changeW + 10, 14, 4);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = accent;
        ctx.font = 'bold 8px sans-serif';
        ctx.fillText(changeText, legendX + 15 + titleW, legendY + 11);

        // OHLC row (close value colored by direction)
        ctx.fillStyle = isDarkMode ? '#a1a1aa' : '#64748b';
        ctx.font = 'bold 8px monospace';
        const ohlcPrefixW = ctx.measureText(ohlcPrefix).width;
        ctx.fillText(ohlcPrefix, legendX + 8, legendY + 24);
        ctx.fillStyle = accent;
        ctx.fillText(cVal, legendX + 8 + ohlcPrefixW, legendY + 24);
      }
    }

    // 6. Axes Rendering
    ctx.fillStyle = '#000000';
    ctx.fillRect(chartWidth, 0, PADDING_RIGHT, height);
    ctx.fillRect(0, chartHeight, width, PADDING_BOTTOM);

    ctx.strokeStyle = isDarkMode ? '#18181b' : '#f1f5f9';
    ctx.beginPath();
    ctx.moveTo(chartWidth, 0); ctx.lineTo(chartWidth, chartHeight);
    ctx.moveTo(0, chartHeight); ctx.lineTo(chartWidth, chartHeight);
    ctx.stroke();

    // Price Labels
    ctx.fillStyle = isDarkMode ? '#a1a1aa' : '#64748b';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const priceRange = maxPrice - minPrice;
    for (let i = 0; i <= 8; i++) {
      const p = minPrice + (priceRange * (i / 8));
      ctx.fillText(formatPrice(p), chartWidth + 5, getY(p));
    }

    // Time Labels (date-aware: intraday shows day boundaries, D1+ shows month/day)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = start - (start % timeStep); i <= end; i += timeStep) {
      const x = getX(i);
      if (x < 0 || x > chartWidth) continue;
      const prevTime = i > 0 ? data[i - 1].time : undefined;
      ctx.fillText(formatTimeLabel(data[i].time, intervalSec, prevTime), x, chartHeight + 5);
    }

    // 7. TradingView extras: last-price line and crosshair axis labels
    if (tradingView) {
      // Last price line + colored price tag on the right scale
      if (data.length >= 2) {
        const lastCandle = data[data.length - 1];
        const prevCandle = data[data.length - 2];
        const lastPriceY = getY(lastCandle.close);
        if (lastPriceY >= 0 && lastPriceY <= chartHeight) {
          const isUp = lastCandle.close >= prevCandle.close;
          const tagColor = isUp ? '#10b981' : '#ef4444';

          ctx.save();
          ctx.strokeStyle = tagColor;
          ctx.globalAlpha = 0.8;
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          // Full-width like TradingView: edge to edge, joined to the price tag.
          ctx.moveTo(0, lastPriceY);
          ctx.lineTo(chartWidth, lastPriceY);
          ctx.stroke();
          ctx.restore();

          const tagText = formatPrice(lastCandle.close);
          ctx.font = 'bold 10px monospace';
          const tagW = ctx.measureText(tagText).width + 14;
          ctx.fillStyle = tagColor;
          roundRectPath(ctx, chartWidth + 1, lastPriceY - 9, tagW, 18, 4);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(tagText, chartWidth + 8, lastPriceY);
        }
      }

      // Crosshair: dashed lines + price badge (right) + date/time badge (bottom)
      if (showCross && crossPos) {
        const cx = crossPos.x;
        const cy = crossPos.y;

        ctx.save();
        ctx.strokeStyle = isDarkMode ? 'rgba(148, 163, 184, 0.65)' : 'rgba(100, 116, 139, 0.6)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(cx, 0); ctx.lineTo(cx, chartHeight);
        ctx.moveTo(0, cy); ctx.lineTo(chartWidth, cy);
        ctx.stroke();
        ctx.restore();

        // Price badge on the right axis
        const priceText = formatPrice(getPriceFromY(cy));
        ctx.font = 'bold 10px monospace';
        const pw = ctx.measureText(priceText).width + 14;
        const py = Math.max(9, Math.min(chartHeight - 9, cy));
        ctx.fillStyle = '#787b86';
        roundRectPath(ctx, chartWidth + 1, py - 9, pw, 18, 4);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(priceText, chartWidth + 8, py);

        // Date/time badge on the bottom axis (the TradingView "horizontal line" readout)
        const hoverIdx = Math.round(getIndexFromX(cx));
        if (hoverIdx >= 0 && hoverIdx < data.length) {
          const tText = formatAxisTime(data[hoverIdx].time, intervalSec);
          ctx.font = 'bold 10px monospace';
          const tw = ctx.measureText(tText).width + 14;
          const tx = Math.max(tw / 2 + 2, Math.min(chartWidth - tw / 2 - 2, cx));
          ctx.fillStyle = '#787b86';
          roundRectPath(ctx, tx - tw / 2, chartHeight + 4, tw, 18, 4);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(tText, tx, chartHeight + 14);
        }
      }
    }
  }, [data, isDarkMode, getX, getY, getPriceFromY, getIndexFromX, getInterval, drawings, trades, tradingView, symbol, timeframe, selectedIds, selectedDrawingId, hoveredDrawingId, previewDrawing, previewMouse, snapIndicator, placementCursor, isSelectBarMode, selectBarIndex, autoFitTrades, priceAnchors]);

  // Sync API with parent whenever mockApi changes or onCoordinatesChange updates
  useEffect(() => {
    if (onCoordinatesChange && mockApi) {
      onCoordinatesChange(mockApi.chart, mockApi.series);
    }
  }, [mockApi, onCoordinatesChange]);

  // Interaction Handlers — Select-Bar has its own drag type so the line can be dragged left/right (TradingView parity) then click to cut
  const handleMouseDown = (e: React.MouseEvent) => {
    crosshairTouchRef.current = false;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const { width, height } = viewState.current;
    const chartWidth = width - PADDING_RIGHT;
    const chartHeight = height - PADDING_BOTTOM;

    if (isSelectBarMode) {
      // Start a SELECT_BAR drag — line will follow cursor, click (mouseUp without much drag) will still cut via handleMouseUp
      if (x >= 0 && x <= chartWidth && y >= 0 && y <= chartHeight) {
        const idx = Math.max(0, Math.min(data.length - 1, Math.round(getIndexFromX(x))));
        onSelectBarMove?.(idx);
        mouse.current = { isDown: true, lastX: x, lastY: y, dragType: 'PAN' as any };
        // Mark as select drag so mouseMove routes to selector instead of pan
        (mouse.current as any)._selectDrag = true;
        if (containerRef.current) containerRef.current.style.cursor = 'ew-resize';
        e.preventDefault();
        return;
      }
      if (onSelectBar) {
        const idx = Math.round(getIndexFromX(x));
        if (idx >= 0 && idx < data.length) onSelectBar(idx);
      }
      return;
    }

    let dragType: 'NONE' | 'PAN' | 'PRICE_SCALE' | 'TIME_SCALE' = 'NONE';
    if (x > chartWidth) dragType = 'PRICE_SCALE';
    else if (y > chartHeight) dragType = 'TIME_SCALE';
    else if (!disablePan) dragType = 'PAN';

    mouse.current = { ...mouse.current, isDown: true, lastX: x, lastY: y, dragType };
    if (dragType !== 'NONE') userInteractedRef.current = true;

    if (containerRef.current) {
      if (dragType === 'PRICE_SCALE') containerRef.current.style.cursor = 'ns-resize';
      else if (dragType === 'TIME_SCALE') containerRef.current.style.cursor = 'ew-resize';
      else if (dragType === 'PAN') containerRef.current.style.cursor = 'grabbing';
      else containerRef.current.style.cursor = 'crosshair';
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    crosshairTouchRef.current = false;
    const rect = canvasRef.current?.getBoundingClientRect();

    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    crosshairRef.current = { x, y };

    // Hover preview for Select-Bar (move line left/right without holding) — TradingView parity
    if (isSelectBarMode && !mouse.current.isDown && onSelectBarMove) {
      const idx = Math.max(0, Math.min(data.length - 1, Math.round(getIndexFromX(x))));
      if (x >= 0 && x <= viewState.current.width - PADDING_RIGHT) onSelectBarMove(idx);
      draw();
    }

    if ((mouse.current as any)._selectDrag && isSelectBarMode) {
      const idx = Math.max(0, Math.min(data.length - 1, Math.round(getIndexFromX(x))));
      onSelectBarMove?.(idx);
      crosshairRef.current = { x, y };
      draw();
      mouse.current.lastX = x;
      mouse.current.lastY = y;
      return;
    }

    if (mouse.current.isDown) {

      const dx = x - mouse.current.lastX;

      const dy = y - mouse.current.lastY;



      if (mouse.current.dragType === 'PAN') {

        viewState.current.offsetX -= dx;



        // Vertical Panning Implemented

        const { height, minPrice, maxPrice } = viewState.current;

        const chartHeight = height - PADDING_BOTTOM;

        if (chartHeight > 0) {

          const priceRange = maxPrice - minPrice;

          const pricePerPixel = priceRange / chartHeight;

          const dPrice = dy * pricePerPixel;



          viewState.current.isManualPriceRange = true;

          viewState.current.manualMinPrice = minPrice + dPrice;

          viewState.current.manualMaxPrice = maxPrice + dPrice;

        }

      } else if (mouse.current.dragType === 'PRICE_SCALE') {
        const { minPrice, maxPrice, height } = viewState.current;
        const chartHeight = height - PADDING_BOTTOM;
        const priceRange = maxPrice - minPrice;

        // Use a non-linear scaling for better control
        const stretchFactor = Math.pow(1.1, dy / 20);
        const midPrice = (maxPrice + minPrice) / 2;
        const newHalfRange = (priceRange * stretchFactor) / 2;

        viewState.current.isManualPriceRange = true;
        viewState.current.manualMinPrice = midPrice - newHalfRange;
        viewState.current.manualMaxPrice = midPrice + newHalfRange;
      } else if (mouse.current.dragType === 'TIME_SCALE') {
        // Zoom around the center or start of dragging? 
        // For Time Scale dragging, usually it's a zoom factor
        const zoomFactor = Math.pow(0.99, dx);
        const oldScaleX = viewState.current.scaleX;
        const newScaleX = Math.max(0.5, Math.min(200, oldScaleX * zoomFactor));

        // To keep it smooth, we adjust offsetX so the right-side doesn't jump too much
        // Or better yet, zoom around the mouse.current.lastX
        const logicalAtMouse = getIndexFromX(x);
        viewState.current.scaleX = newScaleX;

        const { width, scaleX } = viewState.current;
        const chartWidth = width - PADDING_RIGHT;
        viewState.current.offsetX = chartWidth - x - (data.length - 1 - logicalAtMouse) * scaleX;
      }

      mouse.current.lastX = x;
      mouse.current.lastY = y;

      // Force drawing layer update
      setChartRevision(r => r + 1);
      draw();
      notifyViewStateChange();
    } else {
      // Redraw for the TradingView-style crosshair on plain hover.
      draw();
    }

    if (onMouseUpdate) {
      const logical = getIndexFromX(x);
      const price = getPriceFromY(y);
      const time = data[Math.round(logical)]?.time || 0;
      onMouseUpdate(x, y, { time, price, logical });
    }
  };

  const handleMouseUp = (e?: React.MouseEvent) => {
    const wasSelectDrag = (mouse.current as any)._selectDrag;
    // Click-to-cut: if this was a select-bar drag/tap, cut at the current hover index
    if (isSelectBarMode && (wasSelectDrag || !mouse.current.isDown)) {
      // If mouse was down as select drag, onSelectBarMove already positioned the line — now cut only on a tap/click (small movement)
      if (e && onSelectBar && selectBarIndex !== null && selectBarIndex !== undefined) {
        const moved = Math.abs((e.clientX ?? 0) - (mouse.current.lastX ?? e.clientX)) < 8;
        if (moved) onSelectBar(selectBarIndex);
      }
    }
    mouse.current.isDown = false;
    (mouse.current as any)._selectDrag = false;
    if (containerRef.current) containerRef.current.style.cursor = isSelectBarMode ? 'ew-resize' : 'crosshair';
    if (isSelectBarMode) draw();
  };

  const handleMouseLeave = () => {
    crosshairRef.current = null;
    mouse.current.isDown = false;
    if (containerRef.current) containerRef.current.style.cursor = 'crosshair';
    draw();
  };

  // ── Touch handlers for mobile: single-finger pan (left/right to view previous candles) + vertical pan, two-finger pinch zoom ──
  const lastTouchRef = useRef<{ x: number; y: number; dist?: number } | null>(null);

  const getTouchPos = (t: Touch | React.Touch) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    crosshairTouchRef.current = true;
    if (e.touches.length === 1) {
      const p = getTouchPos(e.touches[0]);
      if (!p) return;
      const { width, height } = viewState.current;
      const chartWidth = width - PADDING_RIGHT;
      const chartHeight = height - PADDING_BOTTOM;
      let dragType: 'NONE' | 'PAN' | 'PRICE_SCALE' | 'TIME_SCALE' = 'NONE';
      if (p.x > chartWidth) dragType = 'PRICE_SCALE';
      else if (p.y > chartHeight) dragType = 'TIME_SCALE';
      else if (!disablePan) dragType = 'PAN';
      // isSelectBarMode on touch: drag line left/right then tap to cut (TradingView parity)
      if (isSelectBarMode) {
        const idx = Math.max(0, Math.min(data.length - 1, Math.round(getIndexFromX(p.x))));
        onSelectBarMove?.(idx);
        // On touch, a quick tap cuts; a drag moves the line (handled in touchMove + touchEnd)
        lastTouchRef.current = { x: p.x, y: p.y, dist: undefined };
        (mouse.current as any)._selectDrag = true;
        mouse.current = { isDown: true, lastX: p.x, lastY: p.y, dragType: 'PAN' as any };
        (mouse.current as any)._selectDrag = true;
        return;
      }
      mouse.current = { isDown: true, lastX: p.x, lastY: p.y, dragType };
      lastTouchRef.current = { x: p.x, y: p.y };
      crosshairRef.current = { x: p.x, y: p.y };
      if (containerRef.current) {
        if (dragType === 'PAN') containerRef.current.style.cursor = 'grabbing';
      }
      e.preventDefault();
    } else if (e.touches.length === 2) {
      const p0 = getTouchPos(e.touches[0]);
      const p1 = getTouchPos(e.touches[1]);
      if (!p0 || !p1) return;
      const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      lastTouchRef.current = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2, dist };
      mouse.current.isDown = false; // pinch takes over
      e.preventDefault();
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    crosshairTouchRef.current = true;
    if (isSelectBarMode && e.touches.length === 1) {
      const p = getTouchPos(e.touches[0]);
      if (p) {
        const idx = Math.max(0, Math.min(data.length - 1, Math.round(getIndexFromX(p.x))));
        onSelectBarMove?.(idx);
        crosshairRef.current = { x: p.x, y: p.y };
        if (lastTouchRef.current) lastTouchRef.current = { x: p.x, y: p.y };
        mouse.current.lastX = p.x;
        mouse.current.lastY = p.y;
        draw();
        e.preventDefault();
        return;
      }
    }
    if (e.touches.length === 1 && lastTouchRef.current && mouse.current.isDown) {
      const p = getTouchPos(e.touches[0]);
      if (!p) return;
      crosshairRef.current = { x: p.x, y: p.y };
      const dx = p.x - mouse.current.lastX;
      const dy = p.y - mouse.current.lastY;
      if (mouse.current.dragType === 'PAN') {
        viewState.current.offsetX -= dx;
        const { height, minPrice, maxPrice } = viewState.current;
        const chartHeight = height - PADDING_BOTTOM;
        if (chartHeight > 0) {
          const priceRange = maxPrice - minPrice;
          const pricePerPixel = priceRange / chartHeight;
          const dPrice = dy * pricePerPixel;
          viewState.current.isManualPriceRange = true;
          viewState.current.manualMinPrice = minPrice + dPrice;
          viewState.current.manualMaxPrice = maxPrice + dPrice;
        }
      } else if (mouse.current.dragType === 'PRICE_SCALE') {
        const { minPrice, maxPrice } = viewState.current;
        const stretchFactor = Math.pow(1.1, dy / 20);
        const midPrice = (maxPrice + minPrice) / 2;
        const priceRange = maxPrice - minPrice;
        const newHalfRange = (priceRange * stretchFactor) / 2;
        viewState.current.isManualPriceRange = true;
        viewState.current.manualMinPrice = midPrice - newHalfRange;
        viewState.current.manualMaxPrice = midPrice + newHalfRange;
      } else if (mouse.current.dragType === 'TIME_SCALE') {
        const zoomFactor = Math.pow(0.99, dx);
        const oldScaleX = viewState.current.scaleX;
        const newScaleX = Math.max(0.5, Math.min(200, oldScaleX * zoomFactor));
        const logicalAtMouse = getIndexFromX(p.x);
        viewState.current.scaleX = newScaleX;
        const { width, scaleX } = viewState.current;
        const chartWidth = width - PADDING_RIGHT;
        viewState.current.offsetX = chartWidth - p.x - (data.length - 1 - logicalAtMouse) * scaleX;
      }
      mouse.current.lastX = p.x;
      mouse.current.lastY = p.y;
      lastTouchRef.current = { x: p.x, y: p.y };
      setChartRevision(r => r + 1);
      draw();
      notifyViewStateChange();
      if (onMouseUpdate) {
        const logical = getIndexFromX(p.x);
        const price = getPriceFromY(p.y);
        const time = data[Math.round(logical)]?.time || 0;
        onMouseUpdate(p.x, p.y, { time, price, logical });
      }
      e.preventDefault();
    } else if (e.touches.length === 2 && lastTouchRef.current?.dist) {
      const p0 = getTouchPos(e.touches[0]);
      const p1 = getTouchPos(e.touches[1]);
      if (!p0 || !p1) return;
      const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const centerX = (p0.x + p1.x) / 2;
      const prevDist = lastTouchRef.current.dist as number;
      if (prevDist > 0) {
        const zoomFactor = dist / prevDist;
        const logicalBefore = getIndexFromX(centerX);
        viewState.current.scaleX = Math.max(0.5, Math.min(200, viewState.current.scaleX * zoomFactor));
        const { width, scaleX } = viewState.current;
        const chartWidth = width - PADDING_RIGHT;
        viewState.current.offsetX = chartWidth - centerX - (data.length - 1 - logicalBefore) * scaleX;
        setChartRevision(r => r + 1);
        draw();
        notifyViewStateChange();
      }
      lastTouchRef.current.dist = dist;
      e.preventDefault();
    } else if (e.touches.length === 1) {
      const p = getTouchPos(e.touches[0]);
      if (!p) return;
      crosshairRef.current = { x: p.x, y: p.y };
      draw();
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    // Select-bar cutting is owned by the host (tap-without-drag confirms on
    // touch-end there). The canvas only parks the line while dragging, so a
    // drag-and-release never cuts by accident (TV confirm model).
    mouse.current.isDown = false;
    (mouse.current as any)._selectDrag = false;
    if (containerRef.current) containerRef.current.style.cursor = isSelectBarMode ? 'ew-resize' : 'crosshair';
    if (isSelectBarMode) draw();
    if (e.touches.length === 0) {
      lastTouchRef.current = null;
      // Touch never leaves a hover crosshair behind: without this the last
      // finger position keeps a stale set of dashed lines on screen (there
      // is no mouse-leave on touch to clear it).
      if (crosshairRef.current !== null) {
        crosshairRef.current = null;
        draw();
      }
    } else if (e.touches.length === 1) {
      const p = getTouchPos(e.touches[0]);
      if (p) {
        mouse.current = { isDown: true, lastX: p.x, lastY: p.y, dragType: disablePan ? 'NONE' : 'PAN' };
        lastTouchRef.current = { x: p.x, y: p.y };
      }
    }
    e.preventDefault();
  };

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    userInteractedRef.current = true;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;

    const logicalBefore = getIndexFromX(x);
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    viewState.current.scaleX = Math.max(0.5, Math.min(200, viewState.current.scaleX * zoomFactor));

    const { width, scaleX } = viewState.current;
    const chartWidth = width - PADDING_RIGHT;
    viewState.current.offsetX = chartWidth - x - (data.length - 1 - logicalBefore) * scaleX;

    // Force drawing layer update
    setChartRevision(r => r + 1);
    draw();
    notifyViewStateChange();
  }, [draw, data.length, getIndexFromX, notifyViewStateChange]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
    }

    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;

      if (containerRef.current && canvasRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        const dpr = window.devicePixelRatio || 1;

        // Only update if dimensions actually changed to avoid loop
        if (canvasRef.current.width !== clientWidth * dpr || canvasRef.current.height !== clientHeight * dpr) {
          canvasRef.current.width = clientWidth * dpr;
          canvasRef.current.height = clientHeight * dpr;
          canvasRef.current.style.width = `${clientWidth}px`;
          canvasRef.current.style.height = `${clientHeight}px`;
          viewState.current.width = clientWidth;
          viewState.current.height = clientHeight;
          draw();
        }
      }
    });

    if (container) {
      resizeObserver.observe(container);
    }

    return () => {
      if (container) {
        container.removeEventListener('wheel', handleWheel);
        resizeObserver.unobserve(container);
      }
      resizeObserver.disconnect();
    };
  }, [draw, handleWheel]);

  useEffect(() => { draw(); }, [draw, data, trades, drawings, selectedIds, selectedDrawingId, hoveredDrawingId, previewDrawing, previewMouse, snapIndicator, placementCursor]);

  // Live overlay bindings: DrawingLayer positions its SVG handles through the
  // chart/series converters it receives as props. Those props are set from
  // refs in the parent, which do NOT re-render the parent on pan / zoom /
  // replay — so without this, the canvas (fresh getY per draw) moves while
  // the SVG circles stay frozen on stale coordinates. Cloning here with the
  // current revision's converters keeps every tool's handles glued to its art.
  const liveChildren = React.useMemo(() => {
    return React.Children.map(children, child => {
      if (!React.isValidElement(child)) return child;
      return React.cloneElement(child as React.ReactElement<any>, {
        chart: mockApi.chart,
        series: mockApi.series,
      });
    });
  }, [children, mockApi, chartRevision]);

  // Scroll to Most Recent Bar (Real-Time Bar) handler
  const handleScrollToRealtime = useCallback((e?: React.MouseEvent | React.TouchEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    viewState.current.offsetX = 0;
    viewState.current.isManualPriceRange = false;
    setChartRevision(r => r + 1);
    draw();
    notifyViewStateChange();
    if (onScrollToRealtime) {
      onScrollToRealtime();
    }
  }, [draw, notifyViewStateChange, onScrollToRealtime]);

  // User has manually scrolled back to inspect historical chart data:
  // When scrolled back, latest bar (index = data.length - 1) moves rightward past the chart edge.
  // getX(data.length - 1) = chartWidth - offsetX. When offsetX < -20, latest bar is scrolled off/away from right edge.
  const isScrolledBack = data.length > 0 && viewState.current.offsetX < -20;

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-black cursor-crosshair">
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="w-full h-full block touch-none"
      />
      {liveChildren}
      {showScrollToRealtime && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleScrollToRealtime}
          title="Scroll to Most Recent Bar"
          aria-label="Scroll to Most Recent Bar"
          className={`absolute z-20 flex items-center justify-center w-8 h-8 bg-transparent border-0 shadow-none cursor-pointer transition-all duration-200 active:scale-90 [filter:drop-shadow(0_1px_4px_rgba(0,0,0,0.6))] ${
            isScrolledBack ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-75 pointer-events-none'
          } ${
            isDarkMode
              ? 'text-zinc-300 hover:text-white'
              : 'text-slate-600 hover:text-slate-900'
          }`}
          style={{
            right: PADDING_RIGHT + 8,
            bottom: PADDING_BOTTOM + 8,
            background: 'transparent',
            border: 'none',
            boxShadow: 'none',
            backdropFilter: 'none',
            WebkitBackdropFilter: 'none',
          }}
        >
          <ArrowRightToLine size={20} strokeWidth={2.2} />
        </button>
      )}
    </div>
  );
};

export default CustomChart;
