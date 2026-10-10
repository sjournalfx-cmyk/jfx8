
import React, { useEffect, useRef, useLayoutEffect, useCallback, useState, useMemo } from 'react';
import { Candle, Trade, Drawing, Point } from '../types';
import { getRayCoordinates, timeToLogicalIndex } from './backtest/utils';

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
  disablePan?: boolean;
  // When true (Trade History chart), the viewport auto-fits once per
  // dataset so entry/exit markers start on-screen instead of clipped left.
  autoFitTrades?: boolean;
  children?: React.ReactNode;
}

const PADDING_RIGHT = 60;
const PADDING_BOTTOM = 26;

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
        // Try as-is first (ISO with millis, e.g. cTrader toISOString()).
        // Fall back to MT4/MT5 "2026.01.05 09:15:00" dot format.
        let ms = Date.parse(trimmed);
        if (!Number.isFinite(ms)) ms = Date.parse(trimmed.replace(/\./g, '/'));
        if (!Number.isFinite(ms)) return null;
        return Math.floor(ms / 1000);
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
    return best;
};

const clampY = (y: number, chartHeight: number): number => {
    if (!Number.isFinite(y)) return chartHeight / 2;
    return Math.max(4, Math.min(chartHeight - 4, y));
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
  disablePan,
  autoFitTrades = false,
  children
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

  // Trade History auto-fit: fit the entry→exit window once per dataset so
  // markers start on-screen. Reset whenever the dataset signature changes;
  // any manual pan/zoom disables it until the next dataset.
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
    if (isNaN(minPrice) || isNaN(maxPrice) || minPrice === maxPrice) return 0;
    const chartHeight = height - PADDING_BOTTOM;
    const priceRange = maxPrice - minPrice || 1;
    return chartHeight - ((price - minPrice) / priceRange) * chartHeight;
  }, [chartRevision]);

  const getPriceFromY = useCallback((y: number) => {
    const { height, minPrice, maxPrice } = viewState.current;
    if (isNaN(minPrice) || isNaN(maxPrice) || minPrice === maxPrice) return 0;
    const chartHeight = height - PADDING_BOTTOM;
    const priceRange = maxPrice - minPrice || 1;
    return minPrice + ((chartHeight - y) / chartHeight) * priceRange;
  }, [chartRevision]);

  const getIndexFromX = useCallback((x: number) => {
    const { width, offsetX, scaleX } = viewState.current;
    if (isNaN(scaleX) || scaleX === 0) return 0;
    const chartWidth = width - PADDING_RIGHT;
    return (x - (chartWidth - offsetX)) / scaleX + (data.length - 1);
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
          },
          scrollToRealtime: () => {
            viewState.current.offsetX = 0;
            setChartRevision(r => r + 1);
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

  // Auto-fit the trade window once per dataset (Trade History only). Fits
  // entry→exit plus context so markers are on-screen on first paint without
  // fighting manual pan/zoom afterwards. Runs inside draw() so container
  // width is always known (effects can fire before ResizeObserver sets it).
  const maybeAutoFitTradeWindow = useCallback(() => {
    if (!autoFitTrades || data.length < 2 || !trades || trades.length === 0) return;
    if (viewState.current.width <= 0) return;
    const sigParts: string[] = [String(data.length), String(data[0]?.time ?? ''), String(data[data.length - 1]?.time ?? '')];
    for (const t of trades) {
      sigParts.push(`${(t as any)?.id ?? ''}:${(t as any)?.openTime ?? ''}:${(t as any)?.closeTime ?? ''}`);
    }
    const sig = sigParts.join('|');
    if (autoFitSigRef.current === sig) return;
    if (userInteractedRef.current && autoFitSigRef.current !== null) return;

    let minIdx = Infinity;
    let maxIdx = -Infinity;
    for (const t of trades) {
      if (!t) continue;
      const eSec = parseTradeTimeSec((t as any).openTime ?? (t as any).open_time ?? (t as any).time);
      const xSec = parseTradeTimeSec((t as any).closeTime ?? (t as any).close_time);
      const ei = findClosestCandleIndex(data, eSec);
      const xi = findClosestCandleIndex(data, xSec);
      if (ei >= 0) { minIdx = Math.min(minIdx, ei); maxIdx = Math.max(maxIdx, ei); }
      if (xi >= 0) { minIdx = Math.min(minIdx, xi); maxIdx = Math.max(maxIdx, xi); }
    }
    if (!Number.isFinite(minIdx) || !Number.isFinite(maxIdx)) return;

    const chartWidth = viewState.current.width - PADDING_RIGHT;
    if (chartWidth <= 0) return;
    const CONTEXT = 8;
    const fromIdx = Math.max(0, Math.floor(minIdx) - CONTEXT);
    const toIdx = Math.min(data.length - 1, Math.ceil(maxIdx) + CONTEXT);
    const span = Math.max(1, toIdx - fromIdx + 1);
    // Fit the window, keeping bars readable (same 0.5–200 bounds as zoom).
    const fittedScaleX = Math.max(0.5, Math.min(200, chartWidth / span));
    viewState.current.scaleX = fittedScaleX;
    // Anchor so toIdx sits at the right edge: getX(toIdx) = chartWidth.
    viewState.current.offsetX = (data.length - 1 - toIdx) * fittedScaleX * -1;
    autoFitSigRef.current = sig;
    userInteractedRef.current = false;
  }, [autoFitTrades, data, trades]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    maybeAutoFitTradeWindow();

    const { width, height, scaleX, offsetX, isManualPriceRange, manualMinPrice, manualMaxPrice } = viewState.current;
    const chartWidth = width - PADDING_RIGHT;
    const chartHeight = height - PADDING_BOTTOM;
    const dpr = width > 0 ? (canvas.width / width) : (window.devicePixelRatio || 1);
    const intervalSec = getInterval();

    // TradingView-style crosshair (hover state), only active when enabled.
    const crossPos = crosshairRef.current;
    const isDragging = mouse.current.isDown;
    const showCross = tradingView && crossPos !== null && !isDragging &&
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

    // Keep trade entry/exit prices inside the auto range so marker tips are
    // never projected outside the plot and clipped away. Manual ranges are
    // left alone (user explicitly zoomed the price scale).
    if (!isManualPriceRange && trades && trades.length > 0) {
      for (const t of trades) {
        if (!t) continue;
        const ep = Number((t as any).entryPrice ?? (t as any).entry ?? (t as any).price);
        const xp = Number((t as any).exitPrice ?? (t as any).exit);
        if (Number.isFinite(ep) && ep > 0) {
          if (ep < dataMin) dataMin = ep;
          if (ep > dataMax) dataMax = ep;
        }
        if (Number.isFinite(xp) && xp > 0) {
          if (xp < dataMin) dataMin = xp;
          if (xp > dataMax) dataMax = xp;
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
    if (isNaN(minPrice) || isNaN(maxPrice)) return;

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

    // 4b. Crosshair bar highlight (drawn behind drawings, like TradingView)
    if (showCross && crossPos) {
      const hoverIdx = Math.round(getIndexFromX(crossPos.x));
      if (hoverIdx >= 0 && hoverIdx < data.length) {
        const barX = getX(hoverIdx);
        const barW = Math.max(scaleX * 0.85, 1);
        ctx.fillStyle = isDarkMode ? 'rgba(148, 163, 184, 0.10)' : 'rgba(51, 65, 85, 0.08)';
        ctx.fillRect(barX - barW / 2, 0, barW, chartHeight);
      }
    }

    // 5. Drawings (Canvas Layer) — Full visual rendering (SVG is hit-area only).
    // Clipped to the plot (full height, chart width): no drawing — lines,
    // boxes, fills — may ever paint over the price scale.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, chartWidth, height);
    ctx.clip();
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

      const drawColor = d.color || (isDarkMode ? '#2962ff' : '#475569');
      ctx.strokeStyle = drawColor;
      ctx.lineWidth = d.strokeWidth || 2;

      // Line Styles
      ctx.setLineDash([]);
      if (d.strokeStyle === 'dashed') ctx.setLineDash([6, 6]);
      if (d.strokeStyle === 'dotted') ctx.setLineDash([2, 4]);

      ctx.beginPath();

      if (d.type === 'trendline' || d.type === 'arrow') {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        if (d.type === 'arrow') {
          ctx.setLineDash([]);
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const headLen = 12;
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
          ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
          ctx.closePath();
          ctx.fillStyle = drawColor;
          ctx.fill();
        }
      }
      else if (d.type === 'ray') {
        const ray = getRayCoordinates(x1, y1, x2, y2, width, height);
        ctx.moveTo(ray.x1, ray.y1);
        ctx.lineTo(ray.x2, ray.y2);
        ctx.stroke();
      }
      else if (d.type === 'rect') {
        ctx.fillStyle = drawColor;
        ctx.globalAlpha = 0.12;
        ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        ctx.globalAlpha = 1.0;
        ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      }
      else if (d.type === 'horizontal') {
        ctx.moveTo(0, y1);
        ctx.lineTo(chartWidth, y1);
        ctx.stroke();

        // Price label badge
        ctx.setLineDash([]);
        ctx.fillStyle = drawColor;
        ctx.fillRect(chartWidth - 68, y1 - 10, 64, 20);
        ctx.fillStyle = "#ffffff";
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(d.p1.price.toFixed(5), chartWidth - 36, y1);
      }
      else if (d.type === 'vertical') {
        ctx.moveTo(x1, 0);
        ctx.lineTo(x1, chartHeight);
        ctx.stroke();
      }
      else if (d.type === 'fib') {
        ctx.setLineDash([]);
        const fibLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
        const fibColors = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444'];
        const fMinX = Math.min(x1, x2);
        const fMaxX = Math.max(x1, x2);
        const fMinY = Math.min(y1, y2);
        const fMaxY = Math.max(y1, y2);
        const fDiff = fMaxY - fMinY;

        fibLevels.forEach((level, i) => {
          const fy = fMinY + fDiff * level;
          ctx.strokeStyle = fibColors[i];
          ctx.lineWidth = d.strokeWidth || 1;
          ctx.beginPath();
          ctx.moveTo(fMinX, fy);
          ctx.lineTo(fMaxX, fy);
          ctx.stroke();
          // Level label
          ctx.fillStyle = fibColors[i];
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

        const w = Math.max(Math.abs(x2 - x1), 80);
        const left = Math.min(x1, x2 || x1 + 80);
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
        const rrText = rr.toFixed(2);
        ctx.font = 'bold 9px sans-serif';
        const txtWidth = ctx.measureText(rrText).width;
        // Background for text
        ctx.fillStyle = isDarkMode ? 'rgba(0, 0, 0, 0.2)' : 'rgba(255, 255, 255, 0.4)';
        // Center text on the entry line
        ctx.fillRect(centerX - (txtWidth / 2) - 3, entryY - 7, txtWidth + 6, 14);
        
        ctx.fillStyle = isDarkMode ? 'rgba(226, 232, 240, 0.9)' : 'rgba(30, 41, 59, 0.9)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(rrText, centerX, entryY);
      }
    });
    ctx.setLineDash([]); // Reset

    // 5. Trade Entry & Exit Markers — MT5-style solid arrows + dashed entry→exit connector
    if (trades && trades.length > 0) {
      const MT5_BUY = '#2E9BFF';
      const MT5_SELL = '#F23645';
      // MT5-style solid arrow pointing UP: tip at (centerX, tipY), body below it.
      const drawUpArrow = (centerX: number, tipY: number, color: string) => {
        const arrowW = 11;
        const arrowH = 9;
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
        const arrowW = 11;
        const arrowH = 9;
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
        const isBuy = (trade.direction === 'Long' || (trade as any).type === 'BUY' || (trade as any).tradeSide === 'buy');
        const entryPrice = trade.entryPrice ?? (trade as any).entry ?? (trade as any).price;
        const exitPrice = trade.exitPrice ?? (trade as any).exit;

        // Resolve entry/exit times in seconds. Invalid dates yield null so a
        // bad closeTime can't erase a good entry arrow (and vice versa).
        const entrySec = parseTradeTimeSec(
          (trade as any).openTime ?? (trade as any).open_time ?? (trade as any).time ?? (trade as any).entry_time
        );
        const exitSec = parseTradeTimeSec(
          (trade as any).closeTime ?? (trade as any).close_time ?? (trade as any).exit_time
        );

        // Closest candle index for entry / exit.
        const entryIdx = findClosestCandleIndex(data, entrySec);
        const exitIdx = findClosestCandleIndex(data, exitSec);

        const hasEntryPrice = Number.isFinite(Number(entryPrice)) && Number(entryPrice) > 0;
        const hasExitPrice = Number.isFinite(Number(exitPrice)) && Number(exitPrice) > 0;

        // MT5 entry arrow, tipped at the fill price when known, otherwise just
        // outside the wick so it never hides inside the candle body.
        let entryTip: { x: number; y: number; up: boolean; color: string } | null = null;
        if (entryIdx >= 0) {
          const candle = data[entryIdx];
          const sameBar = entryIdx === exitIdx && exitIdx >= 0;
          const candleX = getX(entryIdx) + (sameBar ? -7 : 0);

          if (isBuy) {
            // Long entry (buy) -> blue arrow pointing UP
            const rawY = hasEntryPrice ? getY(Number(entryPrice)) : getY(candle.low) + 10;
            const tipY = clampY(rawY, chartHeight);
            entryTip = { x: candleX, y: tipY, up: true, color: MT5_BUY };
          } else {
            // Short entry (sell) -> red arrow pointing DOWN
            const rawY = hasEntryPrice ? getY(Number(entryPrice)) : getY(candle.high) - 10;
            const tipY = clampY(rawY, chartHeight);
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
            const rawY = hasExitPrice ? getY(Number(exitPrice)) : getY(candle.high) - 10;
            const tipY = clampY(rawY, chartHeight);
            exitTip = { x: exitX, y: tipY, up: false, color: MT5_SELL };
          } else {
            // Short exit (buy) -> blue arrow pointing UP
            const rawY = hasExitPrice ? getY(Number(exitPrice)) : getY(candle.low) + 10;
            const tipY = clampY(rawY, chartHeight);
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
        if (entryTip) {
          if (entryTip.up) drawUpArrow(entryTip.x, entryTip.y, entryTip.color);
          else drawDownArrow(entryTip.x, entryTip.y, entryTip.color);
        }
        if (exitTip) {
          if (exitTip.up) drawUpArrow(exitTip.x, exitTip.y, exitTip.color);
          else drawDownArrow(exitTip.x, exitTip.y, exitTip.color);
        }
      });
    }
    ctx.restore(); // End plot clip — axes/scale paint after this.

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
          const lastX = getX(data.length - 1);
          const isUp = lastCandle.close >= prevCandle.close;
          const tagColor = isUp ? '#10b981' : '#ef4444';

          ctx.save();
          ctx.strokeStyle = tagColor;
          ctx.globalAlpha = 0.8;
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(lastX, lastPriceY);
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
  }, [data, isDarkMode, getX, getY, getPriceFromY, getIndexFromX, getInterval, drawings, trades, tradingView, symbol, timeframe, maybeAutoFitTradeWindow]);

  // Sync API with parent whenever mockApi changes or onCoordinatesChange updates
  useEffect(() => {
    if (onCoordinatesChange && mockApi) {
      onCoordinatesChange(mockApi.chart, mockApi.series);
    }
  }, [mockApi, onCoordinatesChange]);

  // Interaction Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const { width, height } = viewState.current;
    const chartWidth = width - PADDING_RIGHT;
    const chartHeight = height - PADDING_BOTTOM;

    if (isSelectBarMode && onSelectBar) {
      const idx = Math.round(getIndexFromX(x));
      if (idx >= 0 && idx < data.length) onSelectBar(idx);
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

    const rect = canvasRef.current?.getBoundingClientRect();

    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    crosshairRef.current = { x, y };

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

  const handleMouseUp = () => {
    mouse.current.isDown = false;
    if (containerRef.current) containerRef.current.style.cursor = 'crosshair';
  };

  const handleMouseLeave = () => {
    crosshairRef.current = null;
    mouse.current.isDown = false;
    if (containerRef.current) containerRef.current.style.cursor = 'crosshair';
    draw();
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

  useEffect(() => { draw(); }, [draw, data, trades, drawings]);

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-black cursor-crosshair">
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        className="w-full h-full block touch-none"
      />
      {children}
    </div>
  );
};

export default CustomChart;
