import React, { useMemo, useState } from 'react';
import { Trade } from '../../types';
import { Brain, Activity, HelpCircle } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip';

interface PsychologicalSlipProps {
    trades: Trade[];
    isDarkMode: boolean;
    currencySymbol: string;
    onInfoClick?: () => void;
}

export const PsychologicalSlipWidget: React.FC<PsychologicalSlipProps> = ({ trades, isDarkMode, currencySymbol, onInfoClick }) => {
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);

    const data = useMemo(() => {
        const sortedTrades = [...trades].sort((a, b) => new Date(`${a.date}T${a.time || '00:00'}`).getTime() - new Date(`${b.date}T${b.time || '00:00'}`).getTime());
        
        let cumulativePnl = 0;
        return sortedTrades.map((t, i) => {
            cumulativePnl += t.pnl;
            const disciplineScore = t.planAdherence === 'Followed Exactly' ? 100 : t.planAdherence === 'Minor Deviation' ? 60 : t.planAdherence === 'Major Deviation' ? 20 : 0;
            return {
                pnl: cumulativePnl,
                discipline: disciplineScore,
                pair: t.pair,
                adherence: t.planAdherence
            };
        });
    }, [trades]);

    const maxPnl = Math.max(...data.map(d => d.pnl), 100);
    const minPnl = Math.min(...data.map(d => d.pnl), 0);
    const pnlRange = maxPnl - minPnl || 1;

    const getX = (i: number) => (i / (data.length - 1 || 1)) * 800;
    const getPnlY = (val: number) => 200 - ((val - minPnl) / pnlRange) * 200;
    const getDiscY = (val: number) => 200 - (val / 100) * 200;

    const pnlPath = useMemo(() => {
        if (data.length < 2) return "";
        return `M ${data.map((d, i) => `${getX(i)},${getPnlY(d.pnl)}`).join(' L ')}`;
    }, [data, minPnl, pnlRange]);

    const discPath = useMemo(() => {
        if (data.length < 2) return "";
        return `M ${data.map((d, i) => `${getX(i)},${getDiscY(d.discipline)}`).join(' L ')}`;
    }, [data]);

    return (
        <div className={`p-8 rounded-[32px] border flex flex-col h-full min-h-[400px] ${isDarkMode ? 'bg-black border-zinc-800 shadow-2xl' : 'bg-white border-slate-200 shadow-md'}`}>
            <div className="flex justify-between items-start mb-8">
                <div>
                    <h3 className="text-xl font-bold tracking-tight flex items-center gap-2">
                        <Brain size={20} className="text-violet-500" />
                        Psychological Slip
                        <Tooltip content="Overlays your equity growth line against your discipline/plan-adherence score to reveal where emotional slippage hurt performance." isDarkMode={isDarkMode}>
                            <HelpCircle size={14} className="opacity-40 cursor-help hover:opacity-100" />
                        </Tooltip>
                    </h3>
                    <p className="text-[10px] uppercase font-bold tracking-widest opacity-40 mt-1">Equity Growth vs Rule Adherence</p>
                </div>
                <div className="flex gap-4">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-indigo-500" />
                        <span className="text-[9px] font-black uppercase opacity-60">Equity</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-violet-500 opacity-40" />
                        <span className="text-[9px] font-black uppercase opacity-60">Discipline</span>
                    </div>
                </div>
            </div>

            <div className="flex-1 relative mt-4">
                {data.length > 1 ? (
                    <svg viewBox="0 0 800 200" className="w-full h-full overflow-visible">
                        {/* Discipline Area (Subtle) */}
                        <path 
                            d={`${discPath} L 800,200 L 0,200 Z`} 
                            fill="url(#discGradient)" 
                            className="opacity-30"
                        />
                        <defs>
                            <linearGradient id="discGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.2" />
                                <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
                            </linearGradient>
                        </defs>

                        {/* Equity Line */}
                        <path 
                            d={pnlPath} 
                            fill="none" 
                            stroke="#6366f1" 
                            strokeWidth="3" 
                            strokeLinecap="round" 
                            strokeLinejoin="round"
                        />

                        {/* Discipline Line */}
                        <path 
                            d={discPath} 
                            fill="none" 
                            stroke="#8b5cf6" 
                            strokeWidth="1.5" 
                            strokeDasharray="4 4" 
                            className="opacity-50"
                        />

                        {/* Hover elements */}
                        {hoverIndex !== null && (
                            <g>
                                <line x1={getX(hoverIndex)} y1="0" x2={getX(hoverIndex)} y2="200" stroke="currentColor" strokeOpacity="0.1" strokeWidth="1" />
                                <circle cx={getX(hoverIndex)} cy={getPnlY(data[hoverIndex].pnl)} r="5" fill="#6366f1" />
                                <circle cx={getX(hoverIndex)} cy={getDiscY(data[hoverIndex].discipline)} r="4" fill="#8b5cf6" />
                            </g>
                        )}

                        {/* Transparent catch layer */}
                        <rect 
                            width="800" 
                            height="200" 
                            fill="transparent" 
                            onMouseMove={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                const x = ((e.clientX - rect.left) / rect.width) * 800;
                                const idx = Math.round((x / 800) * (data.length - 1));
                                setHoverIndex(idx);
                            }}
                            onMouseLeave={() => setHoverIndex(null)}
                            className="cursor-crosshair"
                        />
                    </svg>
                ) : (
                    <div className="h-full flex items-center justify-center opacity-10 text-sm font-black uppercase tracking-widest">Insufficient Data</div>
                )}

                {/* Hover Tooltip */}
                {hoverIndex !== null && data[hoverIndex] && (
                    <div 
                        className={`absolute z-50 pointer-events-none p-3 rounded-2xl border shadow-xl ${isDarkMode ? 'bg-black border-zinc-700' : 'bg-white border-slate-200'}`}
                        style={{ 
                            left: `${(hoverIndex / (data.length - 1)) * 100}%`,
                            top: `${(getPnlY(data[hoverIndex].pnl) / 200) * 100}%`,
                            transform: 'translate(-50%, -120%)'
                        }}
                    >
                        <div className="space-y-1 min-w-[120px]">
                            <div className="flex justify-between items-center text-[10px] font-black uppercase">
                                <span className="opacity-40">{data[hoverIndex].pair}</span>
                                <span>Trade #{hoverIndex + 1}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-[9px] font-bold opacity-60">Equity</span>
                                <span className={`text-[10px] font-mono font-black ${data[hoverIndex].pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                    {currencySymbol}{data[hoverIndex].pnl.toLocaleString()}
                                </span>
                            </div>
                            <div className="flex justify-between items-center border-t border-current opacity-10 pt-1 mt-1" />
                            <div className="flex justify-between items-center">
                                <span className="text-[9px] font-bold opacity-60 text-violet-500">Adherence</span>
                                <span className="text-[9px] font-black uppercase">{data[hoverIndex].adherence}</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
