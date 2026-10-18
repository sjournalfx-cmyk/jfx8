import React from 'react';
import { Play, History } from 'lucide-react';
import type { CachedSeriesInfo } from '../../lib/candleStore';

interface StartScreenProps {
    isDarkMode: boolean;
    defaultSymbol: string;
    defaultTimeframe: string;
    onOpenWatchlist: () => void;
    cachedSeries?: CachedSeriesInfo[];
    onResume?: (symbol: string, timeframe: string) => void;
    onStartFresh?: (symbol: string, timeframe: string) => void;
}

const formatWhen = (ts: number): string => {
    if (!ts) return '';
    const d = new Date(ts > 1e12 ? ts : ts * 1000);
    const now = Date.now();
    const diffMin = Math.max(0, Math.round((now - d.getTime()) / 60000));
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.round(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    return d.toLocaleDateString();
};

const StartScreen: React.FC<StartScreenProps> = ({
    isDarkMode,
    defaultSymbol,
    defaultTimeframe,
    onOpenWatchlist,
    cachedSeries = [],
    onResume,
    onStartFresh,
}) => {
    const sub = isDarkMode ? 'text-zinc-500' : 'text-slate-400';
    const card = isDarkMode ? 'bg-white/[0.04] hover:bg-white/[0.08]' : 'bg-white hover:bg-slate-50';
    const recent = [...cachedSeries].sort((a, b) => (b.lastAccess || 0) - (a.lastAccess || 0)).slice(0, 4);

    return (
        <div className={`absolute inset-0 z-[60] overflow-y-auto ${isDarkMode ? 'bg-black' : 'bg-slate-50'}`}>
            <div className="min-h-full flex items-center justify-center p-6 sm:p-10">
                <div className="w-full max-w-2xl space-y-6">

                    {/* Header */}
                    <div className="text-center space-y-2">
                        <h1 className={`text-3xl font-black uppercase tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                            Replay real market history
                        </h1>
                        <p className={`text-xs font-bold uppercase tracking-widest ${sub}`}>
                            Start a backtest — pick a pair from the watchlist
                        </p>
                    </div>

                    {/* Start button */}
                    <button
                        onClick={onOpenWatchlist}
                        className="w-full py-4 rounded-2xl text-xs font-black uppercase tracking-[0.15em] flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-xl bg-[#FF4F01] text-white shadow-[#FF4F01]/30 hover:bg-[#e64700]"
                    >
                        <Play size={15} fill="currentColor" />
                        Start Backtest
                    </button>

                    {/* Continue where you left off — resumes cached series instantly */}
                    {recent.length > 0 && (
                        <div className="space-y-2">
                            <p className={`text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-1.5 ${sub}`}>
                                <History size={12} /> Continue where you left off
                            </p>
                            <div className="grid grid-cols-1 gap-2">
                                {recent.slice(0, 1).map(s => (
                                    <button
                                        key={`${s.symbol}_${s.timeframe}`}
                                        onClick={() => onResume?.(s.symbol, s.timeframe)}
                                        className={`flex items-center justify-between gap-2 px-4 py-3 rounded-2xl text-left transition-all active:scale-[0.98] touch-manipulation ${card}`}
                                    >
                                        <span>
                                            <span className={`block text-sm font-black ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                                                {s.symbol} <span className="text-[#FF4F01]">· {s.timeframe}</span>
                                            </span>
                                            <span className={`block text-[10px] font-bold mt-0.5 ${sub}`}>
                                                {s.barCount.toLocaleString()} bars{formatWhen(s.lastAccess) ? ` · ${formatWhen(s.lastAccess)}` : ''}
                                            </span>
                                        </span>
                                        <Play size={14} className="shrink-0 text-[#FF4F01]" fill="currentColor" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default StartScreen;
