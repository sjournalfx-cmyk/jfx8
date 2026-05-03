
import React, { useEffect, useRef, useLayoutEffect, useCallback, useState, useMemo } from 'react';
import { Candle, Trade, Drawing, Point } from '../types';
import { getRayCoordinates } from './backtest/utils';

interface CustomChartProps {
  data: Candle[];
  trades: Trade[];
  drawings: Drawing[];
  isDarkMode: boolean;
  onCoordinatesChange?: (chart: any, series: any) => void;
  onMouseUpdate?: (x: number, y: number, coords: { time: number, price: number, logical: number } | null) => void;
  onSelectBar?: (index: number) => void;
  onViewStateChange?: (viewState: any) => void;
  initialViewState?: any;
  isSelectBarMode?: boolean;
  disablePan?: boolean;
  children?: React.ReactNode;
}

const PADDING_RIGHT = 60;
const PADDING_BOTTOM = 26;

const CustomChart: React.FC<CustomChartProps> = ({
  data,
  trades,
  drawings,
  isDarkMode,
  onCoordinatesChange,
  onMouseUpdate,
  onSelectBar,
  onViewStateChange,
  initialViewState,
  isSelectBarMode,
  disablePan,
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

  const [chartRevision, setChartRevision] = useState(0);

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
            const idx = data.findIndex(d => d.time === time);
            if (idx !== -1) return getX(idx);

            // If not found, estimate based on last known interval
            if (data.length < 2) return null;

            // Use the last interval for extrapolation (more stable than average)
            const lastTime = data[data.length - 1].time;
            const prevTime = data[data.length - 2].time;
            const interval = lastTime - prevTime;

            if (interval <= 0) return null; // Should not happen on valid data

            const logicalOffset = (time - lastTime) / interval;
            return getX(data.length - 1 + logicalOffset);
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

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const { width, height, scaleX, offsetX, isManualPriceRange, manualMinPrice, manualMaxPrice } = viewState.current;
    const chartWidth = width - PADDING_RIGHT;
    const chartHeight = height - PADDING_BOTTOM;
    const dpr = width > 0 ? (canvas.width / width) : (window.devicePixelRatio || 1);

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

    // 3. Grid
    ctx.strokeStyle = isDarkMode ? '#0a0a0a' : '#f8fafc';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const y = (chartHeight / 10) * i;
      ctx.moveTo(0, y); ctx.lineTo(chartWidth, y);
    }
    const timeStep = Math.max(1, Math.ceil(100 / scaleX));
    for (let i = start - (start % timeStep); i <= end; i += timeStep) {
      const x = getX(i);
      ctx.moveTo(x, 0); ctx.lineTo(x, chartHeight);
    }
    ctx.stroke();

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

    // 5. Drawings (Canvas Layer) — Full visual rendering (SVG is hit-area only)
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
        // Border
        ctx.strokeStyle = '#26a69a';
        ctx.lineWidth = 1;
        ctx.strokeRect(left, profitTop, w, Math.max(profitH, 1));

        // --- Loss zone ---
        // Fill
        ctx.fillStyle = isDarkMode ? 'rgba(239, 83, 80, 0.25)' : 'rgba(239, 83, 80, 0.15)';
        ctx.fillRect(left, lossTop, w, Math.max(lossH, 1));
        // Border
        ctx.strokeStyle = '#ef5350';
        ctx.lineWidth = 1;
        ctx.strokeRect(left, lossTop, w, Math.max(lossH, 1));

        // --- Entry line ---
        ctx.strokeStyle = isDarkMode ? '#b2b5be' : '#555555';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left, entryY);
        ctx.lineTo(right, entryY);
        ctx.stroke();

        // --- Center RR Text Tag (TradingView Style) ---
        const rrText = `Risk/Reward Ratio: ${rr.toFixed(2)}`;
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

    // 5. Axes Rendering
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
      ctx.fillText(p.toFixed(5), chartWidth + 5, getY(p));
    }

    // Time Labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = start - (start % timeStep); i <= end; i += timeStep) {
      const x = getX(i);
      if (x < 0 || x > chartWidth) continue;
      const date = new Date(data[i].time * 1000);
      const txt = `${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
      ctx.fillText(txt, x, chartHeight + 5);
    }
  }, [data, isDarkMode, getX, getY, getIndexFromX, drawings]);

  // Sync API with parent only when necessary
  useEffect(() => {
    if (onCoordinatesChange) {
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

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
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
        onMouseLeave={handleMouseUp}
        className="w-full h-full block touch-none"
      />
      {children}
    </div>
  );
};

export default CustomChart;
