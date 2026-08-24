import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Trade } from '../../types';
import { Tooltip } from '../ui/Tooltip';
import { LayoutGrid, HelpCircle } from 'lucide-react';

interface BoxData {
    pair: string;
    tradeCount: number;
    pnl: number;
    volume: number;
}

interface BoxRect extends BoxData {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface P { trades: Trade[]; isDarkMode: boolean; currencySymbol: string; onInfoClick?: () => void; }

const calculateTreemap = (items: BoxData[], width: number, height: number): BoxRect[] => {
    if (!items?.length) return [];
    const totalSize = items.reduce((sum, i) => sum + i.volume, 0);
    if (!totalSize) return [];
    const rects: BoxRect[] = [];
    const sorted = [...items].sort((a, b) => b.volume - a.volume);

    const layout = (list: BoxData[], x: number, y: number, w: number, h: number, horizontal: boolean) => {
        if (!list.length) return;
        if (list.length === 1) {
            rects.push({ ...list[0], x, y, width: w, height: h });
            return;
        }

        const total = list.reduce((sum, item) => sum + item.volume, 0);
        let splitIndex = 1;
        let bestDiff = Infinity;
        let running = 0;

        for (let i = 0; i < list.length - 1; i++) {
            running += list[i].volume;
            const diff = Math.abs(total / 2 - running);
            if (diff < bestDiff) {
                bestDiff = diff;
                splitIndex = i + 1;
            }
        }

        const left = list.slice(0, splitIndex);
        const right = list.slice(splitIndex);
        const leftTotal = left.reduce((sum, item) => sum + item.volume, 0);
        const ratio = leftTotal / total;

        if (horizontal) {
            const leftWidth = splitIndex === list.length ? w : w * ratio;
            layout(left, x, y, leftWidth, h, !horizontal);
            layout(right, x + leftWidth, y, w - leftWidth, h, !horizontal);
        } else {
            const leftHeight = splitIndex === list.length ? h : h * ratio;
            layout(left, x, y, w, leftHeight, !horizontal);
            layout(right, x, y + leftHeight, w, h - leftHeight, !horizontal);
        }
    };

    layout(sorted, 0, 0, width, height, width >= height);
    return rects;
};

export const PairDistributionTreemapWidget: React.FC<P> = ({ trades = [], isDarkMode, currencySymbol = '$', onInfoClick }) => {
    const plotRef = useRef<HTMLDivElement | null>(null);
    const [plotSize, setPlotSize] = useState({ width: 1000, height: 400 });

    useEffect(() => {
        const updateSize = () => {
            const el = plotRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const width = Math.max(Math.floor(rect.width), 1);
            const height = Math.max(Math.floor(rect.height), 1);
            setPlotSize(prev => (prev.width === width && prev.height === height ? prev : { width, height }));
        };

        updateSize();

        if (typeof ResizeObserver === 'undefined') return;

        const observer = new ResizeObserver(updateSize);
        if (plotRef.current) {
            observer.observe(plotRef.current);
        }

        return () => observer.disconnect();
    }, []);

    const boxes = useMemo(() => {
        if (!trades?.length) return [];
        const pairData: Record<string, BoxData> = {};
        trades.forEach(t => {
            if (!t.pair) return;
            const key = t.pair.toUpperCase();
            if (!pairData[key]) {
                pairData[key] = { pair: key, tradeCount: 0, pnl: 0, volume: 0 };
            }
            pairData[key].tradeCount++;
            pairData[key].pnl += t.pnl || 0;
            pairData[key].volume += Math.abs(t.pnl || 0);
        });
        const items = Object.values(pairData).filter(i => i.volume > 0);
        return calculateTreemap(items, plotSize.width, plotSize.height);
    }, [trades, plotSize.width, plotSize.height]);

const getColor = (pnl: number) => {
    const maxPnl = Math.max(...boxes.map(b => Math.abs(b.pnl)), 1);
    const intensity = Math.min(0.27 + (Math.abs(pnl) / maxPnl) * 0.63, 0.9);
    return pnl >= 0 ? `rgba(5, 150, 105, ${intensity})` : `rgba(220, 38, 38, ${intensity})`;
  };

    if (!boxes.length) {
        return (
            <div className={`py-4 px-0 sm:p-8 rounded-none sm:rounded-[32px] border flex flex-col items-center min-h-[400px] h-full bg-[#000000] border-zinc-800 shadow-2xl`}>
                <div className="flex items-center gap-3 mb-4">
                    <div className={`p-2 rounded-xl ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-100'} text-emerald-500`}><LayoutGrid size={20} /></div>
                    <h3 className="text-xl font-bold tracking-tight">Pair Distribution</h3>
                    <Tooltip content="Portfolio composition by total P/L" isDarkMode={isDarkMode} onInfoClick={onInfoClick}><HelpCircle size={14} className="opacity-40 cursor-help hover:opacity-100" /></Tooltip>
                </div>
                <div className="flex-1 flex items-center justify-center text-xs opacity-40 w-full h-full">No trade data</div>
            </div>
        );
    }

    return (
        <div className={`py-4 px-0 sm:p-8 rounded-none sm:rounded-[32px] border flex flex-col min-h-[400px] h-full bg-[#000000] border-zinc-800 shadow-2xl`}>
            <div className="flex items-center gap-3 mb-4">
                <div className={`p-2 rounded-xl ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-100'} text-emerald-500`}><LayoutGrid size={20} /></div>
                <h3 className="text-xl font-bold tracking-tight">Pair Distribution</h3>
                <Tooltip content="Portfolio composition by total P/L" isDarkMode={isDarkMode} onInfoClick={onInfoClick}><HelpCircle size={14} className="opacity-40 cursor-help hover:opacity-100" /></Tooltip>
            </div>
            <div className="flex-1 flex flex-col w-full">
                <div ref={plotRef} className="flex-1 flex items-stretch relative w-full h-full min-h-[320px]">
                    <svg viewBox={`0 0 ${plotSize.width} ${plotSize.height}`} className="w-full h-full block" preserveAspectRatio="none">
                        {boxes.map((box, i) => (
                            <g key={i}>
                                <rect
                                    x={box.x}
                                    y={box.y}
                                    width={box.width}
                                    height={box.height}
                                    fill={getColor(box.pnl)}
                                    stroke="#000000"
                                    strokeWidth="2"
                                    className="transition-opacity hover:opacity-80 cursor-pointer"
                                />
                                {box.width > 60 && box.height > 40 && (
                                    <>
                                        <text
                                            x={box.x + box.width / 2}
                                            y={box.y + box.height / 2 - 8}
                                            textAnchor="middle"
                                            fill="#ffffff"
                                            fontSize="15"
                                            fontWeight="700"
                                            style={{ pointerEvents: 'none', filter: 'drop-shadow(0px 1px 2px rgba(0,0,0,0.5))' }}
                                        >
                                            {box.pair}
                                        </text>
                                        <text
                                            x={box.x + box.width / 2}
                                            y={box.y + box.height / 2 + 8}
                                            textAnchor="middle"
                                            fill="#f4f4f5"
                                            fontSize="12"
                                            style={{ pointerEvents: 'none', filter: 'drop-shadow(0px 1px 1px rgba(0,0,0,0.5))' }}
                                        >
                                            {box.tradeCount} trades
                                        </text>
                                        <text
                                            x={box.x + box.width / 2}
                                            y={box.y + box.height / 2 + 22}
                                            textAnchor="middle"
                                            fill="#ffffff"
                                            fontSize="11"
                                            fontWeight="700"
                                            style={{ pointerEvents: 'none', filter: 'drop-shadow(0px 1px 1px rgba(0,0,0,0.5))' }}
                                        >
                                            {currencySymbol}{box.pnl.toFixed(2)}
                                        </text>
                                    </>
                                )}
                                {box.width > 40 && box.height > 25 && box.width <= 60 && (
                                    <text
                                        x={box.x + box.width / 2}
                                        y={box.y + box.height / 2}
                                        textAnchor="middle"
                                        fill="#ffffff"
                                        fontSize="12"
                                        fontWeight="700"
                                        style={{ pointerEvents: 'none', filter: 'drop-shadow(0px 1px 1px rgba(0,0,0,0.5))' }}
                                    >
                                        {box.pair}
                                    </text>
                                )}
                            </g>
                        ))}
                    </svg>
                </div>
                <div className="flex flex-row items-center gap-6 mt-4 pt-4 border-t border-zinc-800/50">
                    <div className="flex items-center gap-2 text-xs">
                        <div className="w-4 h-4 rounded-sm" style={{ background: 'rgba(5, 150, 105, 0.8)' }}></div>
                        <span className={isDarkMode ? 'text-zinc-400' : 'text-slate-600'}>Profitable</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                        <div className="w-4 h-4 rounded-sm" style={{ background: 'rgba(220, 38, 38, 0.8)' }}></div>
                        <span className={isDarkMode ? 'text-zinc-400' : 'text-slate-600'}>Loss-Making</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                        <span className={isDarkMode ? 'text-zinc-500' : 'text-slate-500'}>Box size = Total P/L</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
