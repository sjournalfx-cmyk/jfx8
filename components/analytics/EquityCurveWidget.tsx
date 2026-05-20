import React, { useState, useRef } from 'react';
import { Trade } from '../../types';
import { Tooltip } from '../ui/Tooltip';
import { TrendingUp, Activity, HelpCircle } from 'lucide-react';

interface EquityCurveWidgetProps {
    trades: Trade[];
    equityData: number[];
    isDarkMode: boolean;
    currencySymbol: string;
    currentBalanceOverride?: number;
    onInfoClick?: () => void;
    isLoading?: boolean;
}

export const EquityCurveWidget: React.FC<EquityCurveWidgetProps> = ({ trades = [], equityData = [], isDarkMode, currencySymbol = '$', currentBalanceOverride, onInfoClick, isLoading = false }) => {
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);
    const svgRef = useRef<SVGSVGElement>(null);

    if (isLoading) {
        return (
            <div className="relative overflow-hidden rounded-2xl border h-full min-h-[320px] bg-[#000000] border-zinc-800/80">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent" />
                <div className="p-5">
                    <div className="flex items-center gap-3 mb-5">
                        <div className="w-9 h-9 rounded-lg bg-zinc-800" />
                        <div className="space-y-2">
                            <div className="w-28 h-4 bg-zinc-800 rounded" />
                            <div className="w-36 h-2 bg-zinc-800 rounded" />
                        </div>
                    </div>
                    <div className="h-[200px] flex items-end gap-1 px-2">
                        {[...Array(24)].map((_, i) => (
                            <div key={i} className="flex-1 bg-zinc-800 rounded-t" style={{ height: `${15 + Math.random() * 70}%` }} />
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    const min = Math.min(...equityData);
    const max = Math.max(...equityData);
    const dataRange = max - min;
    
    const padding = dataRange === 0 ? 100 : dataRange * 0.1;
    const chartMin = min - padding;
    const chartMax = max + padding;
    const chartRange = chartMax - chartMin || 1;

    const generatePath = (data: number[], width: number, height: number, closePath = false) => {
        if (!data || data.length < 2) return "";
        const points = data.map((val, i) => {
            const x = (i / (data.length - 1)) * width;
            const y = height - ((val - chartMin) / chartRange) * height;
            return `${x},${y}`;
        });
        let path = `M ${points.join(' L ')}`;
        if (closePath) {
            path += ` L ${width},${height} L 0,${height} Z`;
        }
        return path;
    };

    const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
        const svg = e.currentTarget;
        const rect = svg.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const width = rect.width;
        
        const index = Math.round((x / width) * (equityData.length - 1));
        if (index >= 0 && index < equityData.length) {
            setHoverIndex(index);
        }
    };

    const points = equityData.map((val, i) => {
        const x = (i / (equityData.length - 1 || 1)) * 800;
        const y = 200 - ((val - chartMin) / chartRange) * 200;
        return { x, y, val };
    });

    const hoverY = hoverIndex !== null ? 200 - ((equityData[hoverIndex] - chartMin) / chartRange) * 200 : 0;
    const hoverX = hoverIndex !== null ? (hoverIndex / (equityData.length - 1 || 1)) * 800 : 0;

    const yAxisLabels = Array.from({ length: 5 }, (_, index) => {
        const ratio = index / 4;
        return chartMax - (chartMax - chartMin) * ratio;
    });

    const xAxisLabels = equityData.length > 10 
        ? [0, 0.25, 0.5, 0.75, 1].map(p => Math.round(p * (equityData.length - 1)))
        : Array.from({ length: equityData.length }, (_, i) => i);

    const isPositive = equityData[equityData.length - 1] >= equityData[0];
    const accentColor = isPositive ? '#22c55e' : '#ef4444';
    const glowColor = isPositive ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)';

    return (
        <div className="relative overflow-hidden rounded-2xl border h-full min-h-[320px] bg-[#000000] border-zinc-800/80">
            <div className="relative z-10 p-5">
                <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-zinc-900' : 'bg-slate-100'}`}>
                            <TrendingUp size={18} style={{ color: accentColor }} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="font-bold text-base tracking-tight text-white">Equity Curve</h3>
                                <Tooltip content="Visual representation of your account balance growth over time." isDarkMode={isDarkMode}>
                                    <HelpCircle 
                                        size={13}
                                        onClick={onInfoClick}
                                        className={`cursor-help ${isDarkMode ? 'text-zinc-500 hover:text-zinc-300' : 'text-slate-400 hover:text-slate-600'}`}
                                    />
                                </Tooltip>
                            </div>
                            <p className={`text-[10px] font-medium tracking-wider mt-0.5 ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
                                Account Value Over Time
                            </p>
                        </div>
                    </div>

                    {hoverIndex !== null && (
                        <div className="text-right">
                            <div className="text-lg font-bold font-mono tracking-tight" style={{ color: equityData[hoverIndex] >= 0 ? '#22c55e' : '#ef4444' }}>
                                {equityData[hoverIndex] >= 0 ? '+' : ''}{currencySymbol}{equityData[hoverIndex].toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                            </div>
                            <div className={`text-[9px] font-semibold uppercase tracking-wider mt-0.5 ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
                                Trade #{hoverIndex}
                            </div>
                        </div>
                    )}
                    
                    {hoverIndex === null && (
                        <div className="text-right">
                            <div className="text-lg font-bold font-mono tracking-tight" style={{ color: accentColor }}>
                                {equityData[equityData.length - 1] >= 0 ? '+' : ''}{currencySymbol}{equityData[equityData.length - 1]?.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                            </div>
                            <div className={`text-[9px] font-semibold uppercase tracking-wider mt-0.5 ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
                                Current
                            </div>
                        </div>
                    )}
                </div>

                {equityData && equityData.length > 1 ? (
                    <div className="relative h-[200px] mt-2 pl-16">
                        <div className={`absolute left-0 top-0 bottom-4 flex w-14 flex-col justify-between pr-2 text-right text-[9px] font-mono leading-none ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
                            {yAxisLabels.map((val, i) => (
                                <div key={i}>{currencySymbol}{Math.round(val).toLocaleString()}</div>
                            ))}
                        </div>

                        <div className={`absolute -bottom-1 left-0 right-0 flex justify-between text-[9px] font-mono ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
                            {xAxisLabels.map((val, i) => (
                                <div key={i}>#{val}</div>
                            ))}
                        </div>

                        <svg 
                            ref={svgRef}
                            viewBox="0 0 800 200" 
                            className="w-full h-full overflow-visible cursor-crosshair outline-none"
                            onMouseMove={handleMouseMove}
                            onMouseLeave={() => setHoverIndex(null)}
                        >
                            <defs>
                                <linearGradient id="equityAreaGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={accentColor} stopOpacity="0.25" />
                                    <stop offset="50%" stopColor={accentColor} stopOpacity="0.08" />
                                    <stop offset="100%" stopColor={accentColor} stopOpacity="0" />
                                </linearGradient>
                                <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                                    <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                                    <feMerge>
                                        <feMergeNode in="coloredBlur" />
                                        <feMergeNode in="SourceGraphic" />
                                    </feMerge>
                                </filter>
                                <filter id="lineGlow" x="-50%" y="-50%" width="200%" height="200%">
                                    <feGaussianBlur stdDeviation="2" result="blur" />
                                    <feMerge>
                                        <feMergeNode in="blur" />
                                        <feMergeNode in="SourceGraphic" />
                                    </feMerge>
                                </filter>
                            </defs>
                            
                            <path 
                                d={generatePath(equityData, 800, 200, true)} 
                                fill="url(#equityAreaGradient)" 
                            />

                            <path 
                                d={generatePath(equityData, 800, 200, false)} 
                                fill="none" 
                                stroke={accentColor}
                                strokeWidth="2.5"
                                strokeLinecap="round" 
                                strokeLinejoin="round"
                                filter="url(#lineGlow)"
                            />
                            
                            {points.map((p, i) => {
                                const isWin = i === 0 ? p.val >= 0 : p.val > points[i-1]?.val;
                                const dotColor = isWin ? '#22c55e' : '#ef4444';
                                
                                return (
                                    <circle 
                                        key={i} 
                                        cx={p.x} 
                                        cy={p.y} 
                                        r={hoverIndex === i ? 5 : 3} 
                                        fill={dotColor}
                                        stroke={isDarkMode ? '#000000' : 'white'} 
                                        strokeWidth="1.5"
                                        style={{ 
                                            filter: (hoverIndex === i) ? `drop-shadow(0 0 6px ${dotColor})` : 'none'
                                        }}
                                    />
                                );
                            })}

                            {hoverIndex !== null && (
                                <>
                                    <line 
                                        x1={hoverX} 
                                        y1="0" 
                                        x2={hoverX} 
                                        y2="200" 
                                        stroke={accentColor} 
                                        strokeWidth="1" 
                                        strokeDasharray="4 4" 
                                        opacity="0.4" 
                                    />
                                    <circle 
                                        cx={hoverX} 
                                        cy={hoverY} 
                                        r="6" 
                                        fill={accentColor} 
                                        stroke={isDarkMode ? '#000000' : 'white'} 
                                        strokeWidth="2"
                                        filter="url(#glow)"
                                    />
                                </>
                            )}
                        </svg>

                        {hoverIndex !== null && (
                            <div 
                                className={`absolute z-50 pointer-events-none p-3 rounded-xl border shadow-xl backdrop-blur-sm`}
                                style={{ 
                                    backgroundColor: isDarkMode ? 'rgba(0, 0, 0, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                                    borderColor: isDarkMode ? '#27272a' : '#e2e8f0',
                                    left: `${Math.max(10, Math.min(90, (hoverIndex / (equityData.length - 1 || 1)) * 100))}%`,
                                    top: `${Math.max(5, (hoverY / 200) * 100)}%`,
                                    transform: 'translate(-50%, calc(-100% - 20px))'
                                }}
                            >
                                <div className="space-y-1.5 min-w-[120px]">
                                    <div className="flex justify-between items-center gap-4">
                                        <span className={`text-[8px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
                                            {hoverIndex > 0 ? (trades[hoverIndex - 1]?.pair || 'Trade') : 'Start'}
                                        </span>
                                        <span className="text-[9px] font-bold" style={{ color: isDarkMode ? '#d4d4d8' : '#64748b' }}>#{hoverIndex}</span>
                                    </div>
                                    <div className="flex justify-between items-center gap-4">
                                        <span className={`text-[8px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Balance</span>
                                        <span className="text-xs font-bold font-mono" style={{ color: accentColor }}>
                                            {currencySymbol}{equityData[hoverIndex].toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                        </span>
                                    </div>
                                    {hoverIndex > 0 && (
                                        <div className="flex justify-between items-center gap-4">
                                            <span className={`text-[8px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>P/L</span>
                                            <div className="flex flex-col items-end">
                                                <span className={`text-[10px] font-bold ${equityData[hoverIndex] - equityData[hoverIndex-1] >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                    {equityData[hoverIndex] - equityData[hoverIndex-1] >= 0 ? '+' : ''}
                                                    {currencySymbol}{Math.abs(equityData[hoverIndex] - equityData[hoverIndex-1]).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                                </span>
                                                {equityData[hoverIndex-1] !== 0 && (
                                                    <span className={`text-[8px] font-medium ${equityData[hoverIndex] - equityData[hoverIndex-1] >= 0 ? 'text-emerald-500/80' : 'text-rose-500/80'}`}>
                                                        {equityData[hoverIndex] - equityData[hoverIndex-1] >= 0 ? '+' : ''}
                                                        {((equityData[hoverIndex] - equityData[hoverIndex-1]) / Math.abs(equityData[hoverIndex-1]) * 100).toFixed(2)}%
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div 
                                    className="absolute w-2 h-2 rotate-45 border-r border-b"
                                    style={{ 
                                        backgroundColor: isDarkMode ? 'rgba(0, 0, 0, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                                        borderColor: isDarkMode ? '#27272a' : '#e2e8f0',
                                        bottom: '-5px',
                                        left: '50%',
                                        transform: 'translateX(-50%)'
                                    }} 
                                />
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="h-[200px] flex flex-col items-center justify-center text-center gap-3">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isDarkMode ? 'bg-zinc-900' : 'bg-slate-100'}`}>
                            <Activity size={24} strokeWidth={1.5} className={isDarkMode ? 'text-zinc-600' : 'text-slate-300'} />
                        </div>
                        <div className="space-y-1">
                            <p className={`text-sm font-semibold ${isDarkMode ? 'text-zinc-300' : 'text-slate-600'}`}>Insufficient Data</p>
                            <p className={`text-[10px] leading-relaxed max-w-[180px] ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>
                                Log trades to see your equity curve visualization
                            </p>
                        </div>
                    </div>
                )}
            </div>
            
            <div className={`absolute bottom-0 left-0 right-0 h-[1px] ${isDarkMode ? 'bg-gradient-to-r from-transparent via-zinc-800 to-transparent' : 'bg-gradient-to-r from-transparent via-slate-200 to-transparent'}`} />
        </div>
    );
};
