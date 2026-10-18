import React, { useMemo, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { Trade, UserProfile } from '../../types';
import { Tooltip } from '../ui/Tooltip';
import { EmptyState } from '../ui/Skeleton';
import { sortTradesChronologically } from '../../lib/analyticsUtils';

interface DrawdownOverTimeWidgetProps {
    trades: Trade[];
    isDarkMode: boolean;
    userProfile: UserProfile;
    startingBalance?: number;
    onInfoClick?: () => void;
    onCta?: () => void;
}

export const DrawdownOverTimeWidget: React.FC<DrawdownOverTimeWidgetProps> = ({ trades = [], isDarkMode, userProfile, startingBalance, onInfoClick, onCta }) => {
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

    const drawdownData = useMemo(() => {
        if (!trades.length) return [];
        
        const sortedTrades = sortTradesChronologically(trades);
        let currentBalance = startingBalance || userProfile?.initialBalance || 0;
        let peak = currentBalance;
        
        return sortedTrades.map(t => {
            currentBalance += Number.isFinite(Number(t.pnl)) ? Number(t.pnl) : 0;
            if (currentBalance > peak) peak = currentBalance;
            const drawdown = peak > 0 ? ((peak - currentBalance) / peak) * 100 : 0;
            return { balance: currentBalance, drawdown };
        });
    }, [trades, userProfile?.initialBalance, startingBalance]);

    const maxDrawdown = drawdownData.length > 0 ? Math.max(...drawdownData.map(d => d.drawdown)) : 0;
    const maxY = Math.max(maxDrawdown * 1.2, 1);

    const indexFromClientX = (clientX: number, rect: DOMRect) => {
        const x = clientX - rect.left;
        const width = Math.max(rect.width, 1);
        const index = Math.min(
            drawdownData.length - 1,
            Math.max(0, Math.floor((x / width) * drawdownData.length))
        );
        setHoverIndex(index);
        setMousePos({ x: (drawdownData.length > 1 ? index / (drawdownData.length - 1) : 0) * 700, y: 0 });
    };

    const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
        indexFromClientX(e.clientX, e.currentTarget.getBoundingClientRect());
    };

    const handleTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
        const touch = e.touches[0];
        if (!touch) return;
        indexFromClientX(touch.clientX, e.currentTarget.getBoundingClientRect());
    };

    const generateAreaPath = (data: any[], width: number, height: number) => {
        if (data.length < 2) return { area: '', line: '' };
        
        const points = data.map((d, i) => {
            const x = (i / (data.length - 1)) * width;
            const y = (d.drawdown / maxY) * height;
            return { x, y };
        });

        const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
        const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;
        
        return { area: areaPath, line: linePath };
    };

    const paths = generateAreaPath(drawdownData, 700, 200);
    const hoverY = hoverIndex !== null ? (drawdownData[hoverIndex].drawdown / maxY) * 200 : 0;

    return (
        <div className="p-4 sm:p-6 rounded-2xl sm:rounded-[24px] border-0 flex flex-col min-h-[350px] relative h-full bg-[#0a0a0a] text-white">
            <div className="flex justify-between items-start gap-3 mb-4 sm:mb-6">
                <div className="flex items-center gap-2">
                    <h3 className="text-[15px] font-semibold tracking-tight text-left">Drawdown Over Time</h3>
                    <Tooltip content="Visualizes the percentage drop from your peak equity over the course of your trading history." isDarkMode={isDarkMode}>
                        <HelpCircle 
                            size={14}
                            onClick={onInfoClick}
                            className="opacity-40 cursor-help hover:opacity-100" 
                        />
                    </Tooltip>
                </div>

                <div className="text-right shrink-0">
                    <div className="text-xl font-black font-mono text-rose-500 leading-none">
                        -{(hoverIndex !== null ? drawdownData[hoverIndex].drawdown : maxDrawdown).toFixed(2)}%
                    </div>
                    <div className="text-[10px] font-bold opacity-40 uppercase tracking-widest mt-1">
                        {hoverIndex !== null ? `${userProfile.currencySymbol}${drawdownData[hoverIndex].balance.toLocaleString()}` : 'Max DD'}
                    </div>
                </div>
            </div>
            {drawdownData.length < 2 ? (
                <div className="flex-1 flex flex-col justify-center min-h-0">
                    <EmptyState
                        isDarkMode={isDarkMode}
                        type="analytics"
                        title="Not enough data yet"
                        description="Log at least two trades to visualize your drawdown over time."
                        action={onCta ? { label: 'Log a Trade', onClick: onCta } : undefined}
                    />
                </div>
            ) : (
                <div className="flex-1 min-h-0 flex items-center sm:items-stretch">
                  <div className="relative w-full sm:flex-1 sm:flex sm:flex-col">
                    <div className="absolute left-0 top-0 bottom-8 w-10 sm:w-12 flex flex-col justify-between text-[10px] font-mono opacity-40">
                        <span>0%</span>
                        <span>{(maxY / 2).toFixed(2)}%</span>
                        <span>{maxY.toFixed(2)}%</span>
                    </div>
                    {/* Fixed height on mobile so the chart always renders full;
                        flex-fill on larger screens. */}
                    <div className="ml-10 sm:ml-12 h-56 sm:h-auto sm:flex-1 pb-8 touch-none select-none">
                        <svg 
                            viewBox="0 0 700 200" 
                            className="block w-full h-full overflow-visible cursor-crosshair" 
                            preserveAspectRatio="none"
                            onMouseMove={handleMouseMove}
                            onMouseLeave={() => setHoverIndex(null)}
                            onTouchStart={handleTouchMove}
                            onTouchMove={handleTouchMove}
                            onTouchEnd={() => setHoverIndex(null)}
                        >
                            <defs>
                                <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.4" />
                                    <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.05" />
                                </linearGradient>
                            </defs>
                            <path d={paths.area} fill="url(#drawdownGradient)" />
                            <path d={paths.line} fill="none" stroke="#f43f5e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                            
                            {hoverIndex !== null && (
                                <>
                                    <line x1={mousePos.x} y1="0" x2={mousePos.x} y2="200" stroke="#f43f5e" strokeWidth="1" strokeDasharray="4 4" opacity="0.5" />
                                    <circle cx={mousePos.x} cy={hoverY} r="5" fill="#f43f5e" stroke={isDarkMode ? "#000000" : "white"} strokeWidth="2" />
                                </>
                            )}
                        </svg>
                    </div>
                  </div>
                </div>
            )}
        </div>
    );
};
