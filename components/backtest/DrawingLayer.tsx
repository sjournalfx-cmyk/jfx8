import React, { useMemo, useCallback } from 'react';
import { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import { Drawing, Point } from './types';
import { getRayCoordinates, positionToolMinWidth } from './utils';

interface DrawingLayerProps {
    drawings: Drawing[];
    currentDrawing: Drawing | null;
    selectedDrawingId: string | null;
    selectedIds?: string[];
    mousePos: { x: number, y: number } | null;
    chart: IChartApi | null;
    series: ISeriesApi<"Candlestick"> | null;
    containerWidth: number;
    containerHeight: number;
    activeTool: string;
    hoveredDrawingId: string | null;
    isSelectBarMode: boolean;
    onMouseDownHandle: (e: React.MouseEvent, drawingId: string, handle: 'p1' | 'p2' | 'move' | 'target' | 'stop' | 'entry') => void;
    onSelectDrawing: (id: string, additive?: boolean) => void;
    onHoverDrawing: (id: string | null) => void;
    onDoubleClickDrawing?: (e: React.MouseEvent, drawing: Drawing) => void;
    tick: number;
    isLocked: boolean;
    isDarkMode: boolean;
}

// Memoized coordinate converter - stable across renders
const useCoordinateConverter = (
    chart: IChartApi | null,
    series: ISeriesApi<"Candlestick"> | null
) => {
    return useCallback((point: Point): { x: number; y: number } | null => {
        if (!chart || !series) return null;
        const timeScale = chart.timeScale();

        let x: number | null = null;

        // Try logical coordinate first for highest stability during pan/zoom
        if (point.logical !== undefined && point.logical !== null && typeof point.logical === 'number') {
            x = timeScale.logicalToCoordinate(point.logical as any);
        }

        // Fallback to time-based coordinate if logical conversion fails or isn't present
        if (x === null) {
            x = timeScale.timeToCoordinate(point.time as Time);
        }

        const y = series.priceToCoordinate(point.price);

        // We allow x/y to be outside the container range, but not null (undefined behavior)
        if (x === null || y === null) return null;
        return { x, y };
    }, [chart, series]);
};

// Individual drawing renderer component - memoized
// SVG is now HIT-AREA ONLY. All visual rendering is done by the Canvas in CustomChart.
interface DrawingItemProps {
    drawing: Drawing;
    isPreview: boolean;
    mousePos: { x: number; y: number } | null;
    selectedDrawingId: string | null;
    selectedIds?: string[];
    hoveredDrawingId: string | null;
    containerWidth: number;
    containerHeight: number;
    isDarkMode?: boolean;
    isLocked?: boolean;
    convertCoordinate: (point: Point) => { x: number; y: number } | null;
    series: ISeriesApi<"Candlestick"> | null;
    onSelectDrawing: (id: string, additive?: boolean) => void;
    onHoverDrawing: (id: string | null) => void;
    onMouseDownHandle: (e: React.MouseEvent, drawingId: string, handle: 'p1' | 'p2' | 'move' | 'target' | 'stop' | 'entry') => void;
    onDoubleClickDrawing?: (e: React.MouseEvent, drawing: Drawing) => void;
    tick?: number;
}

const DrawingItem = React.memo<DrawingItemProps>(({
    drawing: d,
    isPreview,
    mousePos,
    selectedDrawingId,
    selectedIds,
    hoveredDrawingId,
    containerWidth,
    containerHeight,
    isDarkMode,
    isLocked,
    convertCoordinate,
    series,
    onSelectDrawing,
    onHoverDrawing,
    onMouseDownHandle,
    onDoubleClickDrawing,
    tick
}) => {
    // Touch double-tap detector (TV parity): two taps <300ms & <24px apart on
    // the same drawing open its settings. Native dblclick never fires reliably
    // on mobile (touch preventDefault suppresses compat mouse events).
    // Keyed per drawing id, so it survives re-renders of the same drawing.
    const lastTapRef = React.useRef<{ t: number; x: number; y: number } | null>(null);
    // Coarse pointers (phones) get bigger visual handles.
    const isCoarse = React.useMemo(
        () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches,
        []
    );
    // Calculate coordinates
    const p1Coords = useMemo(() => convertCoordinate(d.p1), [d.p1, convertCoordinate, tick]);

    const p2Coords = useMemo(() => {
        if (d.p2) {
            const converted = convertCoordinate(d.p2);
            if (converted) return converted;
        }
        if (isPreview && mousePos) {
            return mousePos;
        }
        return null;
    }, [d.p2, isPreview, mousePos, convertCoordinate, tick]);

    // Locked drawings are fully click-through (TradingView parity): the SVG
    // layer is hit-area only (canvas owns visuals), so render nothing and let
    // pan/zoom gestures fall through to the chart canvas underneath.
    if (!isPreview && (isLocked || d.isLocked)) return null;

    // Early return if coordinates are invalid
    if (!p1Coords) return null;
    if (!p2Coords && d.type !== 'vertical' && d.type !== 'horizontal') return null;

    const x1 = p1Coords.x;
    const y1 = p1Coords.y;
    const x2 = p2Coords?.x ?? 0;
    const y2 = p2Coords?.y ?? 0;

    const isSelected = isPreview ? false : (selectedIds ? selectedIds.includes(d.id) : d.id === selectedDrawingId);

    const commonEvents = {
        cursor: 'pointer' as const,
        'data-drawing-hit': true,
        'data-drawing-id': d.id,
        onClick: (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            // Shift-click = toggle multi-select (TradingView parity).
            if (!isPreview) onSelectDrawing(d.id, e.shiftKey);
        },
        onDoubleClick: (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (!isPreview && onDoubleClickDrawing) onDoubleClickDrawing(e, d);
        },
        onMouseDown: (e: React.MouseEvent) => {
            if (!isPreview && !d.isLocked) {
                e.preventDefault();
                e.stopPropagation();
                if (!isSelected) onSelectDrawing(d.id, e.shiftKey);
                onMouseDownHandle(e, d.id, 'move');
            }
        },
        onTouchStart: (e: React.TouchEvent) => {
            if (!isPreview && !d.isLocked) {
                const touch = e.touches[0];
                if (!touch) return;
                const now = Date.now();
                const prev = lastTapRef.current;
                lastTapRef.current = { t: now, x: touch.clientX, y: touch.clientY };
                // Double-tap an existing drawing = open its settings (TV parity).
                if (prev && onDoubleClickDrawing && now - prev.t < 300 &&
                    Math.hypot(touch.clientX - prev.x, touch.clientY - prev.y) < 24) {
                    e.preventDefault();
                    e.stopPropagation();
                    lastTapRef.current = null;
                    const synthetic = {
                        clientX: touch.clientX,
                        clientY: touch.clientY,
                        preventDefault: () => e.preventDefault(),
                        stopPropagation: () => e.stopPropagation(),
                    } as unknown as React.MouseEvent;
                    onDoubleClickDrawing(synthetic, d);
                    try { (navigator as any)?.vibrate?.(10); } catch { /* no-op */ }
                    return;
                }
                // TradingView mobile model: press selects AND begins a potential
                // drag in the same gesture (no lift required). A 4px movement
                // threshold in the host keeps plain taps from nudging drawings.
                if (!isSelected) onSelectDrawing(d.id, false);
                // Suppress the synthetic mouse sequence so a compat mousedown
                // can't land on empty canvas and instantly deselect this tap.
                e.preventDefault();
                e.stopPropagation();
                // Convert touch to mouse-event shape for shared drag handler
                const synthetic = {
                    ...e,
                    clientX: touch.clientX,
                    clientY: touch.clientY,
                    preventDefault: () => e.preventDefault(),
                    stopPropagation: () => e.stopPropagation(),
                } as unknown as React.MouseEvent;
                onMouseDownHandle(synthetic, d.id, 'move');
            }
        },
        onMouseEnter: () => !isPreview && onHoverDrawing(d.id),
        onMouseLeave: () => !isPreview && onHoverDrawing(null),
    };

    // Hit areas use generous transparent stroke (TradingView-easy grab).
    // Preview drawings render dashed. The grab width NEVER shrinks on select
    // (selection is shown by the canvas glow + endpoint handles) — shrinking
    // it is what let a compat mouse event miss and instantly deselect a tap.
    const previewProps = isPreview ? {
        stroke: d.color || '#2962ff',
        strokeWidth: d.strokeWidth || 1,
        strokeDasharray: '5,5',
        opacity: 0.7,
    } : {};

    const hitProps = {
        'data-drawing-hit': true,
        'data-drawing-id': d.id,
        stroke: 'transparent',
        fill: 'transparent',
        strokeWidth: isSelected ? 20 : 16,
        style: { cursor: isSelected ? 'move' : 'pointer', touchAction: 'none' } as React.CSSProperties,
        ...commonEvents,
    };

    const renderHandles = () => {
        if (!isSelected || isPreview || isLocked || d.isLocked) return null;
        const handleStyle = {
            filter: 'drop-shadow(0 0 2px rgba(41, 128, 255, 0.4))'
        };

        const handleTouchStart = (e: React.TouchEvent, handle: 'p1' | 'p2') => {
            e.stopPropagation();
            const touch = e.touches[0];
            if (!touch) return;
            const synthetic = {
                ...e,
                clientX: touch.clientX,
                clientY: touch.clientY,
                preventDefault: () => e.preventDefault(),
                stopPropagation: () => e.stopPropagation(),
            } as unknown as React.MouseEvent;
            onMouseDownHandle(synthetic, d.id, handle);
        };

        const renderHandle = (hx: number, hy: number, handle: 'p1' | 'p2') => (
            <g
                key={handle}
                onMouseDown={(e) => { e.stopPropagation(); onMouseDownHandle(e, d.id, handle); }}
                onTouchStart={(e) => handleTouchStart(e, handle)}
                style={{ touchAction: 'none' } as React.CSSProperties}
            >
                {/* Larger hit-area for touch (r=22, invisible) - keeps finger target 44px */}
                <circle cx={hx} cy={hy} r={24} fill="transparent" style={{ cursor: 'grab', touchAction: 'none' } as React.CSSProperties} />
                {/* Visual handle — bigger on coarse pointers so fingers can see the grab */}
                <circle
                    cx={hx} cy={hy} r={isCoarse ? 8.5 : 6}
                    fill="white" stroke="#2962ff" strokeWidth={2.5}
                    style={handleStyle}
                />
            </g>
        );

        return (
            <>
                {renderHandle(x1, y1, 'p1')}
                {(d.type === 'ray' ? true : (d.type !== 'vertical' && d.type !== 'horizontal' && d.type !== 'long' && d.type !== 'short')) && 
                 renderHandle(x2, y2, 'p2')}
            </>
        );
    };

    let shape = null;

    switch (d.type) {
        case 'trendline':
        case 'measure':
            shape = (
                <line x1={x1} y1={y1} x2={x2} y2={y2} {...hitProps} {...previewProps} />
            );
            break;

        case 'ray':
            const ray = getRayCoordinates(x1, y1, x2, y2, containerWidth, containerHeight);
            shape = (
                <line x1={ray.x1} y1={ray.y1} x2={ray.x2} y2={ray.y2} {...hitProps} {...previewProps} />
            );
            break;

        case 'arrow':
            shape = (
                <line x1={x1} y1={y1} x2={x2} y2={y2} {...hitProps} {...previewProps} />
            );
            break;

        case 'rect':
            const rx = Math.min(x1, x2);
            const ry = Math.min(y1, y2);
            const rw = Math.max(1, Math.abs(x2 - x1));
            const rh = Math.max(1, Math.abs(y2 - y1));
            shape = (
                <rect x={rx} y={ry} width={rw} height={rh} {...hitProps} {...previewProps} />
            );
            break;

        case 'vertical':
            shape = (
                <line x1={x1} y1={0} x2={x1} y2={containerHeight} {...hitProps} />
            );
            break;

        case 'horizontal':
            shape = (
                <line x1={0} y1={y1} x2={containerWidth} y2={y1} {...hitProps} />
            );
            break;

        case 'fib': {
            const fibY1 = Math.min(y1, y2);
            const fibY2 = Math.max(y1, y2);
            const fibDiff = fibY2 - fibY1;
            const fibLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
            shape = (
                <g {...commonEvents} style={{ cursor: 'pointer', touchAction: 'none' } as React.CSSProperties}>
                    {fibLevels.map((level) => {
                        const y = fibY1 + fibDiff * level;
                        return (
                            <line key={level} x1={Math.min(x1, x2)} y1={y} x2={Math.max(x1, x2)} y2={y} stroke="transparent" strokeWidth={12} />
                        );
                    })}
                    <rect x={Math.min(x1, x2)} y={fibY1} width={Math.abs(x2 - x1)} height={fibDiff} fill="transparent" stroke="transparent" strokeWidth={1} />
                </g>
            );
            break;
        }

        case 'channel': {
            const channelDx = x2 - x1;
            const channelDy = y2 - y1;
            const channelAngle = Math.atan2(channelDy, channelDx);
            const perpAngle = channelAngle + Math.PI / 2;
            const channelOffset = 50;

            const cx1 = x1;
            const cy1 = y1;
            const cx2 = x2;
            const cy2 = y2;
            const cx3 = x2 + Math.cos(perpAngle) * channelOffset;
            const cy3 = y2 + Math.sin(perpAngle) * channelOffset;
            const cx4 = x1 + Math.cos(perpAngle) * channelOffset;
            const cy4 = y1 + Math.sin(perpAngle) * channelOffset;

            shape = (
                <polygon
                    points={`${cx1},${cy1} ${cx2},${cy2} ${cx3},${cy3} ${cx4},${cy4}`}
                    {...hitProps}
                />
            );
            break;
        }

        case 'text': {
            const textContent = d.text || 'Text';
            // Invisible hit area rect around text
            shape = (
                <g {...commonEvents} style={{ cursor: 'pointer', touchAction: 'none' } as React.CSSProperties}>
                    <rect x={x1 - 5} y={y1 - (d.fontSize || 14)} width={textContent.length * ((d.fontSize || 14) * 0.65)} height={(d.fontSize || 14) + 6} fill="transparent" stroke="transparent" />
                </g>
            );
            break;
        }

        case 'long':
        case 'short': {
            const isLong = d.type === 'long';
            const entryPrice = d.entry ?? d.p1.price;
            const targetPrice = d.target ?? (isLong ? entryPrice * 1.02 : entryPrice * 0.98);
            const stopPrice = d.stop ?? (isLong ? entryPrice * 0.99 : entryPrice * 1.01);

            const entryY = series?.priceToCoordinate(entryPrice) ?? y1;
            const targetY = series?.priceToCoordinate(targetPrice) ?? y1;
            const stopY = series?.priceToCoordinate(stopPrice) ?? y1;

            const p1x = x1;
            const minW = positionToolMinWidth(isCoarse);
            const p2x = x2 || x1 + minW;
            const rectWidth = Math.max(Math.abs(p2x - p1x), minW);
            const rectLeft = Math.min(p1x, p2x);

            const targetColor = '#10b981';
            const stopColor = '#ef4444';

            const targetBoxY = Math.min(entryY, targetY);
            const targetBoxHeight = Math.abs(targetY - entryY);
            const stopBoxY = Math.min(entryY, stopY);
            const stopBoxHeight = Math.abs(stopY - entryY);

            shape = (
                <g {...commonEvents} style={{ cursor: 'pointer', touchAction: 'none' } as React.CSSProperties}>
                    {/* Target area hit zone */}
                    <rect
                        x={rectLeft} y={targetBoxY}
                        width={rectWidth} height={Math.max(targetBoxHeight, 5)}
                        fill="transparent" stroke="none"
                    />
                    {/* Stop area hit zone */}
                    <rect
                        x={rectLeft} y={stopBoxY}
                        width={rectWidth} height={Math.max(stopBoxHeight, 5)}
                        fill="transparent" stroke="none"
                    />

                    {/* Draggable handles when selected — touch-capable with 44px hit area */}
                    {isSelected && !isLocked && !d.isLocked && (
                        <>
                            {/* Target handle */}
                            <g
                                onMouseDown={(e) => { e.stopPropagation(); onMouseDownHandle(e, d.id, 'target'); }}
                                onTouchStart={(e) => { e.stopPropagation(); const t=e.touches[0]; if(!t) return; const s={ ...e, clientX:t.clientX, clientY:t.clientY, preventDefault:()=>e.preventDefault(), stopPropagation:()=>e.stopPropagation()} as unknown as React.MouseEvent; onMouseDownHandle(s,d.id,'target'); }}
                                style={{ touchAction: 'none' } as React.CSSProperties}
                            >
                                <circle cx={rectLeft + rectWidth / 2} cy={targetY} r={24} fill="transparent" style={{ cursor: 'grab', touchAction: 'none' } as React.CSSProperties} />
                                <circle cx={rectLeft + rectWidth / 2} cy={targetY} r={isCoarse ? 8.5 : 6} fill={targetColor} stroke="none"
                                    style={{ cursor: 'grab', opacity: 0.6, filter: 'drop-shadow(0 0 2px rgba(16, 185, 129, 0.3))' }}
                                />
                            </g>
                            {/* Stop handle */}
                            <g
                                onMouseDown={(e) => { e.stopPropagation(); onMouseDownHandle(e, d.id, 'stop'); }}
                                onTouchStart={(e) => { e.stopPropagation(); const t=e.touches[0]; if(!t) return; const s={ ...e, clientX:t.clientX, clientY:t.clientY, preventDefault:()=>e.preventDefault(), stopPropagation:()=>e.stopPropagation()} as unknown as React.MouseEvent; onMouseDownHandle(s,d.id,'stop'); }}
                                style={{ touchAction: 'none' } as React.CSSProperties}
                            >
                                <circle cx={rectLeft + rectWidth / 2} cy={stopY} r={24} fill="transparent" style={{ cursor: 'grab', touchAction: 'none' } as React.CSSProperties} />
                                <circle cx={rectLeft + rectWidth / 2} cy={stopY} r={isCoarse ? 8.5 : 6} fill={stopColor} stroke="none"
                                    style={{ cursor: 'grab', opacity: 0.6, filter: 'drop-shadow(0 0 2px rgba(239, 68, 68, 0.3))' }}
                                />
                            </g>
                            {/* Entry handle (drag entry line independently - TV parity) */}
                            <g
                                onMouseDown={(e) => { e.stopPropagation(); onMouseDownHandle(e, d.id, 'entry'); }}
                                onTouchStart={(e) => { e.stopPropagation(); const t=e.touches[0]; if(!t) return; const s={ ...e, clientX:t.clientX, clientY:t.clientY, preventDefault:()=>e.preventDefault(), stopPropagation:()=>e.stopPropagation()} as unknown as React.MouseEvent; onMouseDownHandle(s,d.id,'entry'); }}
                                style={{ touchAction: 'none' } as React.CSSProperties}
                            >
                                <circle cx={rectLeft + rectWidth / 2} cy={entryY} r={24} fill="transparent" style={{ cursor: 'ns-resize', touchAction: 'none' } as React.CSSProperties} />
                                <circle cx={rectLeft + rectWidth / 2} cy={entryY} r={isCoarse ? 8.5 : 6} fill="#2962ff" stroke="#fff" strokeWidth={1.5}
                                    style={{ cursor: 'ns-resize' }}
                                />
                            </g>
                            {/* P1 (left edge) */}
                            <g
                                onMouseDown={(e) => { e.stopPropagation(); onMouseDownHandle(e, d.id, 'p1'); }}
                                onTouchStart={(e) => { e.stopPropagation(); const t=e.touches[0]; if(!t) return; const s={ ...e, clientX:t.clientX, clientY:t.clientY, preventDefault:()=>e.preventDefault(), stopPropagation:()=>e.stopPropagation()} as unknown as React.MouseEvent; onMouseDownHandle(s,d.id,'p1'); }}
                                style={{ touchAction: 'none' } as React.CSSProperties}
                            >
                                <circle cx={rectLeft} cy={entryY} r={24} fill="transparent" style={{ cursor: 'grab', touchAction: 'none' } as React.CSSProperties} />
                                <circle cx={rectLeft} cy={entryY} r={isCoarse ? 8.5 : 6} fill="rgba(255,255,255,0.6)" stroke="none"
                                    style={{ cursor: 'grab', filter: 'drop-shadow(0 0 2px rgba(41, 98, 255, 0.3))' }}
                                />
                            </g>
                            {/* P2 (right edge) */}
                            <g
                                onMouseDown={(e) => { e.stopPropagation(); onMouseDownHandle(e, d.id, 'p2'); }}
                                onTouchStart={(e) => { e.stopPropagation(); const t=e.touches[0]; if(!t) return; const s={ ...e, clientX:t.clientX, clientY:t.clientY, preventDefault:()=>e.preventDefault(), stopPropagation:()=>e.stopPropagation()} as unknown as React.MouseEvent; onMouseDownHandle(s,d.id,'p2'); }}
                                style={{ touchAction: 'none' } as React.CSSProperties}
                            >
                                <circle cx={rectLeft + rectWidth} cy={entryY} r={24} fill="transparent" style={{ cursor: 'grab', touchAction: 'none' } as React.CSSProperties} />
                                <circle cx={rectLeft + rectWidth} cy={entryY} r={isCoarse ? 8.5 : 6} fill="rgba(255,255,255,0.6)" stroke="none"
                                    style={{ cursor: 'grab', filter: 'drop-shadow(0 0 2px rgba(41, 98, 255, 0.3))' }}
                                />
                            </g>
                        </>
                    )}
                </g>
            );
            break;
        }
    }

    return (
        <g key={d.id}>
            {shape}
            {renderHandles()}
        </g>
    );
});

DrawingItem.displayName = 'DrawingItem';

export const DrawingLayer = React.memo<DrawingLayerProps>(({
    drawings,
    currentDrawing,
    selectedDrawingId,
    selectedIds,
    mousePos,
    chart,
    series,
    containerWidth,
    containerHeight,
    activeTool,
    hoveredDrawingId,
    isSelectBarMode,
    onMouseDownHandle,
    onSelectDrawing,
    onHoverDrawing,
    onDoubleClickDrawing,
    tick,
    isLocked,
    isDarkMode
}) => {
    // Use stable container dimensions - prevent layout thrashing.
    // containerWidth already excludes the price scale (parent passes
    // width - PRICE_SCALE_WIDTH); plotHeight additionally excludes the
    // bottom date axis so verticals/previews stop at the plot edge.
    const stableContainerWidth = useMemo(() => Math.max(containerWidth, 100), [containerWidth]);
    const stableContainerHeight = useMemo(() => Math.max(containerHeight, 100), [containerHeight]);
    const plotHeight = useMemo(() => Math.max(stableContainerHeight - 30, 50), [stableContainerHeight]);

    // Memoized coordinate converter
    const convertCoordinate = useCoordinateConverter(chart, series);
    const allowHitTesting = !isSelectBarMode; // TV parity: click-select works in any tool mode
    // Creation wins over grabbing: while a drawing tool is armed the whole
    // overlay goes pointer-transparent, so presses fall straight through to
    // the chart and new drawings start on top of old ones (mouse + touch).
    const creationArmed = activeTool !== 'cursor';

    // Render active tool preview (follows mouse before click)
    const renderActiveToolPreview = useCallback(() => {
        if (!mousePos) return null;

        // Select Bar is rendered by CustomChart canvas (draggable TradingView-style line + shading).
        // Suppress the old SVG preview to avoid a duplicate line.
        if (isSelectBarMode) {
            return null;
        }

        // Block previews only while a drawing gesture is in progress (sticky mode keeps selection + preview).
        if (currentDrawing) return null;

        const color = "#2962ff";
        // Clamped to the plot: previews must never spill onto the price scale.
        const previewX = Math.max(0, Math.min(mousePos.x, stableContainerWidth));
        if (activeTool === 'vertical') {
            return <line x1={previewX} y1={0} x2={previewX} y2={plotHeight} stroke={color} strokeWidth={1} strokeDasharray="5,5" opacity={0.5} />;
        }
        if (activeTool === 'horizontal') {
            return <line x1={0} y1={mousePos.y} x2={stableContainerWidth} y2={mousePos.y} stroke={color} strokeWidth={1} strokeDasharray="5,5" opacity={0.5} />;
        }
        return null;
    }, [mousePos, currentDrawing, isSelectBarMode, activeTool, stableContainerWidth, plotHeight]);

    // Memoize common props for DrawingItem to prevent unnecessary re-renders.
    // NOTE: containerHeight is the plot height (date axis excluded) so
    // vertical lines and ray bounds stop at the plot edge, never on an axis.
    const itemProps = useMemo(() => ({
        selectedDrawingId,
        selectedIds,
        hoveredDrawingId,
        containerWidth: stableContainerWidth,
        containerHeight: plotHeight,
        isDarkMode,
        isLocked,
        convertCoordinate,
        series,
        onSelectDrawing,
        onHoverDrawing,
        onMouseDownHandle,
        onDoubleClickDrawing,
        tick
    }), [
        selectedDrawingId,
        selectedIds,
        hoveredDrawingId,
        stableContainerWidth,
        plotHeight,
        isDarkMode,
        isLocked,
        convertCoordinate,
        series,
        onSelectDrawing,
        onHoverDrawing,
        onMouseDownHandle,
        onDoubleClickDrawing,
        tick
    ]);

    // Early return if no chart/series
    if (!chart || !series) return null;

    return (
        <svg
            className="absolute inset-0 z-10 touch-manipulation"
            width="100%"
            height="100%"
            style={{ pointerEvents: 'none', touchAction: 'none' } as React.CSSProperties}
        >
            <defs>
                <clipPath id="jfx-mobile-plot-clip">
                    <rect x={0} y={0} width={stableContainerWidth} height={plotHeight} />
                </clipPath>
            </defs>
            <g clipPath="url(#jfx-mobile-plot-clip)" style={{ pointerEvents: allowHitTesting && !creationArmed ? 'auto' : 'none', touchAction: 'none' } as React.CSSProperties}>
                {drawings.map(d => (
                    <DrawingItem
                        key={d.id}
                        drawing={d}
                        isPreview={false}
                        mousePos={null}
                        {...itemProps}
                    />
                ))}
                {currentDrawing && (
                    <DrawingItem
                        key={`preview-${currentDrawing.id}`}
                        drawing={currentDrawing}
                        isPreview={true}
                        mousePos={mousePos}
                        {...itemProps}
                    />
                )}
                {renderActiveToolPreview()}
            </g>
        </svg>
    );
}, (prevProps, nextProps) => {
    // Always re-render when tick changes - this is critical for updating drawing positions
    if (prevProps.tick !== nextProps.tick) return false;

    // Always re-render for these changes
    if (prevProps.drawings !== nextProps.drawings) return false;
    if (prevProps.currentDrawing !== nextProps.currentDrawing) return false;
    if (prevProps.selectedDrawingId !== nextProps.selectedDrawingId) return false;
    if (prevProps.selectedIds !== nextProps.selectedIds) return false;
    if (prevProps.hoveredDrawingId !== nextProps.hoveredDrawingId) return false;
    if (prevProps.isSelectBarMode !== nextProps.isSelectBarMode) return false;
    if (prevProps.activeTool !== nextProps.activeTool) return false;
    if (prevProps.isLocked !== nextProps.isLocked) return false;
    if (prevProps.isDarkMode !== nextProps.isDarkMode) return false;
    if (prevProps.containerWidth !== nextProps.containerWidth) return false;
    if (prevProps.containerHeight !== nextProps.containerHeight) return false;
    if (prevProps.chart !== nextProps.chart) return false;
    if (prevProps.series !== nextProps.series) return false;
    if (prevProps.mousePos !== nextProps.mousePos) return false;

    return true;
});

DrawingLayer.displayName = 'DrawingLayer';
