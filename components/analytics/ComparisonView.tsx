import React, { useMemo, useState, useEffect } from 'react';
import { Trade } from '../../types';
import { getSASTDateTime } from '../../lib/timeUtils';
import { calculateStats } from '../../lib/statsUtils';
import { Select } from '../Select';
import { Card } from '../ui/Card';
import { 
    Coins, Target, Clock, BarChart3, Crown, 
    ArrowUpRight, ArrowDownRight 
} from 'lucide-react';

interface ComparisonViewProps {
    trades: Trade[];
    isDarkMode: boolean;
    currencySymbol: string;
}

export const ComparisonView: React.FC<ComparisonViewProps> = ({ trades = [], isDarkMode, currencySymbol = '$' }) => {
    const [compareMode, setCompareMode] = useState<'symbol' | 'strategy' | 'session'>('symbol');

    const getTradeSession = (t: Trade) => {
        const s = t.session && t.session !== 'Session' ? t.session : '';
        if (s.includes('Asia') || s.includes('Tokyo') || s.includes('Sydney')) return 'Asian';
        if (s.includes('London') && !s.includes('York')) return 'London';
        if (s.includes('Overlap') || (s.includes('London') && s.includes('York'))) return 'Overlap';
        if (s.includes('York')) return 'New York';
        
        if (!t.time) return 'Unknown';
        const hour = parseInt(t.time.split(':')[0], 10);
        if (hour >= 0 && hour < 9) return 'Asian';
        if (hour >= 9 && hour < 14) return 'London';
        if (hour >= 14 && hour < 18) return 'Overlap';
        if (hour >= 18) return 'New York';
        return 'Unknown';
    };

    const symbols = useMemo(() => {
        const uniqueSymbols = Array.from(new Set(trades.map(t => t.pair.toUpperCase()))).sort();
        return uniqueSymbols.map(s => ({ value: s, label: s }));
    }, [trades]);

    const strategies = useMemo(() => {
        const allTags = trades.flatMap(t => t.tags || []);
        const uniqueTags = Array.from(new Set(allTags)).sort();
        return uniqueTags.map(s => ({ value: s, label: s }));
    }, [trades]);

    const sessions = [
        { value: 'Asian', label: 'Asian Session' },
        { value: 'London', label: 'London Session' },
        { value: 'Overlap', label: 'London/NY Overlap' },
        { value: 'New York', label: 'New York Session' }
    ];

    const currentOptions = useMemo(() => {
        if (compareMode === 'symbol') return symbols;
        if (compareMode === 'strategy') return strategies;
        return sessions;
    }, [compareMode, symbols, strategies]);

    const dateRanges = [
        { value: 'all', label: 'All Time' },
        { value: 'this_month', label: 'This Month' },
        { value: 'last_month', label: 'Last Month' },
        { value: 'this_year', label: 'This Year' }
    ];

    const [symbolA, setSymbolA] = useState(symbols[0]?.value || '');
    const [symbolB, setSymbolB] = useState(symbols[1]?.value || '');
    const [rangeA, setRangeA] = useState('all');
    const [rangeB, setRangeB] = useState('all');

    useEffect(() => {
        if (compareMode === 'session') {
            setSymbolA('London');
            setSymbolB('London');
            setRangeA('this_month');
            setRangeB('last_month');
        } else {
            setSymbolA(currentOptions[0]?.value || '');
            setSymbolB(currentOptions[1]?.value || '');
        }
    }, [compareMode, currentOptions]);

    const filterByRange = (tradeList: Trade[], range: string) => {
        const sastNow = getSASTDateTime();
        const [year, month] = sastNow.date.split('-').map(Number);
        
        const startOfMonth = new Date(year, month - 1, 1);
        const startOfLastMonth = new Date(year, month - 2, 1);
        const endOfLastMonth = new Date(year, month - 1, 0);
        const startOfYear = new Date(year, 0, 1);

        return tradeList.filter(t => {
            const tradeDate = new Date(t.date);
            if (range === 'this_month') return tradeDate >= startOfMonth;
            if (range === 'last_month') return tradeDate >= startOfLastMonth && tradeDate <= endOfLastMonth;
            if (range === 'this_year') return tradeDate >= startOfYear;
            return true;
        });
    };

    const getPreviousTrades = (tradeList: Trade[], range: string) => {
        const sastNow = getSASTDateTime();
        const [year, month] = sastNow.date.split('-').map(Number);
        
        if (range === 'all') return [];

        if (range === 'this_month') {
            const startOfLastMonth = new Date(year, month - 2, 1);
            const endOfLastMonth = new Date(year, month - 1, 0);
            return tradeList.filter(t => {
                const d = new Date(t.date);
                return d >= startOfLastMonth && d <= endOfLastMonth;
            });
        }

        if (range === 'last_month') {
            const startOfPrevMonth = new Date(year, month - 3, 1);
            const endOfPrevMonth = new Date(year, month - 2, 0);
            return tradeList.filter(t => {
                const d = new Date(t.date);
                return d >= startOfPrevMonth && d <= endOfPrevMonth;
            });
        }

        if (range === 'this_year') {
            const startOfPrevYear = new Date(year - 1, 0, 1);
            const endOfPrevYear = new Date(year - 1, 11, 31);
            return tradeList.filter(t => {
                const d = new Date(t.date);
                return d >= startOfPrevYear && d <= endOfPrevYear;
            });
        }

        return [];
    };

    const tradesA = useMemo(() => {
        const filtered = trades.filter(t => {
            if (compareMode === 'symbol') return t.pair.toUpperCase() === symbolA;
            if (compareMode === 'strategy') return (t.tags || []).includes(symbolA);
            if (compareMode === 'session') return getTradeSession(t) === symbolA;
            return false;
        });
        return filterByRange(filtered, rangeA);
    }, [trades, symbolA, rangeA, compareMode]);

    const tradesB = useMemo(() => {
        const filtered = trades.filter(t => {
            if (compareMode === 'symbol') return t.pair.toUpperCase() === symbolB;
            if (compareMode === 'strategy') return (t.tags || []).includes(symbolB);
            if (compareMode === 'session') return getTradeSession(t) === symbolB;
            return false;
        });
        return filterByRange(filtered, rangeB);
    }, [trades, symbolB, rangeB, compareMode]);

    const prevTradesA = useMemo(() => {
        const filtered = trades.filter(t => {
            if (compareMode === 'symbol') return t.pair.toUpperCase() === symbolA;
            if (compareMode === 'strategy') return (t.tags || []).includes(symbolA);
            if (compareMode === 'session') return getTradeSession(t) === symbolA;
            return false;
        });
        return getPreviousTrades(filtered, rangeA);
    }, [trades, symbolA, rangeA, compareMode]);

    const prevTradesB = useMemo(() => {
        const filtered = trades.filter(t => {
            if (compareMode === 'symbol') return t.pair.toUpperCase() === symbolB;
            if (compareMode === 'strategy') return (t.tags || []).includes(symbolB);
            if (compareMode === 'session') return getTradeSession(t) === symbolB;
            return false;
        });
        return getPreviousTrades(filtered, rangeB);
    }, [trades, symbolB, rangeB, compareMode]);


    const getStats = (tradesList: Trade[]) => {
        const stats = calculateStats(tradesList);
        return {
            netProfit: stats.netProfit,
            winRate: stats.winRate,
            profitFactor: stats.profitFactor,
            total: stats.totalTrades
        };
    };

    const statsA = useMemo(() => getStats(tradesA), [tradesA]);
    const statsB = useMemo(() => getStats(tradesB), [tradesB]);
    const prevStatsA = useMemo(() => getStats(prevTradesA), [prevTradesA]);
    const prevStatsB = useMemo(() => getStats(prevTradesB), [prevTradesB]);

    const getTrendData = (current: number, previous: number) => {
        if (previous === 0) return { direction: null, percent: null };
        const diff = current - previous;
        const percent = (diff / Math.abs(previous)) * 100;
        return {
            direction: diff >= 0 ? 'up' : 'down',
            percent: Math.abs(percent).toFixed(1)
        };
    };

    const trendA = useMemo(() => getTrendData(statsA.netProfit, prevStatsA.netProfit), [statsA.netProfit, prevStatsA.netProfit]);
    const trendB = useMemo(() => getTrendData(statsB.netProfit, prevStatsB.netProfit), [statsB.netProfit, prevStatsB.netProfit]);

    const getDelta = (valA: number, valB: number) => {
        if (valB === 0) return null;
        const diff = valA - valB;
        const percent = (diff / Math.abs(valB)) * 100;
        return {
            value: diff,
            percent: percent.toFixed(1),
            isPositive: diff >= 0
        };
    };

    const deltas = useMemo(() => ({
        netProfit: getDelta(statsA.netProfit, statsB.netProfit),
        winRate: getDelta(statsA.winRate, statsB.winRate),
        profitFactor: getDelta(statsA.profitFactor, statsB.profitFactor),
        total: getDelta(statsA.total, statsB.total)
    }), [statsA, statsB]);

    const getEquityData = (tradesList: Trade[]) => {
        let cumulative = 0;
        const data = [0];
        const sorted = [...tradesList].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        sorted.forEach(t => {
            cumulative += t.pnl;
            data.push(cumulative);
        });
        return data;
    };

    const equityA = useMemo(() => getEquityData(tradesA), [tradesA]);
    const equityB = useMemo(() => getEquityData(tradesB), [tradesB]);

    const maxVal = Math.max(...equityA, ...equityB, 100);
    const minVal = Math.min(...equityA, ...equityB, -100);
    const range = maxVal - minVal || 1;

    const generatePath = (data: number[], width: number, height: number) => {
        if (!data || data.length < 2) return "";
        const points = data.map((val, i) => {
            const x = (i / (data.length - 1)) * width;
            const y = height - ((val - minVal) / range) * height;
            return `${x},${y}`;
        });
        return `M ${points.join(' L ')}`;
    };

    return (
        <div className="space-y-8 pb-20">            {/* Comparison Mode Switcher */}
            <div className={`p-1.5 rounded-2xl border flex items-center w-fit gap-1 mx-auto ${isDarkMode ? 'bg-[#111] border-zinc-800' : 'bg-zinc-100 border-slate-200'}`}>
                {(['symbol', 'strategy', 'session'] as const).map((mode) => (
                    <button
                        key={mode}
                        onClick={() => setCompareMode(mode)}
                        className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${compareMode === mode 
                            ? (isDarkMode ? 'bg-zinc-800 text-white shadow-lg' : 'bg-white text-black shadow-sm') 
                            : 'text-zinc-500 hover:text-zinc-700'}`}
                    >
                        {mode}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="grid grid-cols-2 gap-4">
                    <Select
                        label={compareMode === 'symbol' ? "Symbol A" : compareMode === 'strategy' ? "Strategy A" : "Session A"}
                        value={symbolA}
                        onChange={setSymbolA}
                        options={currentOptions}
                        isDarkMode={isDarkMode}
                        icon={compareMode === 'symbol' ? Coins : compareMode === 'strategy' ? Target : Clock}
                    />
                    <Select
                        label="Period A"
                        value={rangeA}
                        onChange={setRangeA}
                        options={dateRanges}
                        isDarkMode={isDarkMode}
                    />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <Select
                        label={compareMode === 'symbol' ? "Symbol B" : compareMode === 'strategy' ? "Strategy B" : "Session B"}
                        value={symbolB}
                        onChange={setSymbolB}
                        options={currentOptions}
                        isDarkMode={isDarkMode}
                        icon={compareMode === 'symbol' ? Coins : compareMode === 'strategy' ? Target : Clock}
                    />
                    <Select
                        label="Period B"
                        value={rangeB}
                        onChange={setRangeB}
                        options={dateRanges}
                        isDarkMode={isDarkMode}
                    />
                </div>
            </div>

            <div className="relative">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {[
                        {
                            label: symbolA,
                            stats: statsA,
                            trend: trendA,
                            color: 'text-indigo-500',
                            bg: 'bg-indigo-500/10',
                            range: rangeA,
                            isWinner: {
                                netProfit: statsA.netProfit > statsB.netProfit,
                                winRate: statsA.winRate > statsB.winRate,
                                profitFactor: statsA.profitFactor > statsB.profitFactor,
                                total: statsA.total > statsB.total
                            }
                        },
                        {
                            label: symbolB,
                            stats: statsB,
                            trend: trendB,
                            color: 'text-amber-500',
                            bg: 'bg-amber-500/10',
                            range: rangeB,
                            isWinner: {
                                netProfit: statsB.netProfit > statsA.netProfit,
                                winRate: statsB.winRate > statsA.winRate,
                                profitFactor: statsB.profitFactor > statsA.profitFactor,
                                total: statsB.total > statsA.total
                            }
                        }
                    ].map((panel, idx) => (
                        <Card key={idx} isDarkMode={isDarkMode} padding="lg" className={`relative rounded-[32px] !bg-[#000000] ${isDarkMode ? '!border-zinc-800' : '!border-slate-200'}`}>
                            <div className="flex items-center justify-between mb-8">
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-xl ${panel.bg} ${panel.color}`}>
                                        {compareMode === 'symbol' ? <BarChart3 size={20} /> : compareMode === 'strategy' ? <Target size={20} /> : <Clock size={20} />}
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-bold">{panel.label || (compareMode === 'symbol' ? 'Select Symbol' : compareMode === 'strategy' ? 'Select Strategy' : 'Select Session')}</h3>
                                        <p className="text-[10px] uppercase font-bold tracking-widest opacity-40">{dateRanges.find(r => r.value === panel.range)?.label}</p>
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-1 relative">
                                    <span className="text-[10px] font-bold uppercase tracking-widest opacity-40 flex items-center gap-1">
                                        Net Profit
                                        {panel.isWinner.netProfit ? <Crown size={10} className="text-amber-500" /> : null}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <div className={`text-2xl font-black ${panel.stats.netProfit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                            {panel.stats.netProfit >= 0 ? '+' : ''}{currencySymbol}{panel.stats.netProfit.toLocaleString()}
                                        </div>
                                        {panel.trend.direction ? (
                                            <div className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${panel.trend.direction === 'up' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                                                {panel.trend.direction === 'up' ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                                                {panel.trend.percent}%
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                                <div className="space-y-1 relative">
                                    <span className="text-[10px] font-bold uppercase tracking-widest opacity-40 flex items-center gap-1">
                                        Win Rate
                                        {panel.isWinner.winRate ? <Crown size={10} className="text-amber-500" /> : null}
                                    </span>
                                    <div className="text-2xl font-black">{panel.stats.winRate.toFixed(1)}%</div>
                                </div>
                                <div className="space-y-1 relative">
                                    <span className="text-[10px] font-bold uppercase tracking-widest opacity-40 flex items-center gap-1">
                                        Profit Factor
                                        {panel.isWinner.profitFactor ? <Crown size={10} className="text-amber-500" /> : null}
                                    </span>
                                    <div className="text-2xl font-black">
                                        {Number.isFinite(panel.stats.profitFactor) ? panel.stats.profitFactor.toFixed(1) : 'Infinity'}
                                    </div>
                                </div>
                                <div className="space-y-1 relative">
                                    <span className="text-[10px] font-bold uppercase tracking-widest opacity-40 flex items-center gap-1">
                                        Total Trades
                                        {panel.isWinner.total ? <Crown size={10} className="text-amber-500" /> : null}
                                    </span>
                                    <div className="text-2xl font-black">{panel.stats.total}</div>
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>

                {/* Delta Indicators overlay for MD+ screens */}
                <div className="hidden md:flex absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex-col gap-6 z-10 items-center pointer-events-none">
                    {deltas.netProfit ? (
                        <div className={`px-3 py-1.5 rounded-full text-[10px] font-black border backdrop-blur-md shadow-xl ${deltas.netProfit.isPositive ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-500' : 'bg-rose-500/20 border-rose-500/30 text-rose-500'}`}>
                            {deltas.netProfit.isPositive ? '+' : ''}{deltas.netProfit.percent}%
                        </div>
                    ) : null}
                    {deltas.winRate ? (
                         <div className={`px-3 py-1.5 rounded-full text-[10px] font-black border backdrop-blur-md shadow-xl ${deltas.winRate.isPositive ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-500' : 'bg-rose-500/20 border-rose-500/30 text-rose-500'}`}>
                            {deltas.winRate.isPositive ? '+' : ''}{deltas.winRate.percent}%
                        </div>
                    ) : null}
                </div>
            </div>


            <Card isDarkMode={isDarkMode} padding="lg" className={`rounded-[32px] !bg-[#000000] ${isDarkMode ? '!border-zinc-800' : '!border-slate-200'}`}>
                <div className="flex items-center justify-between mb-8">
                    <h3 className="text-xl font-bold tracking-tight">Comparative Equity Curve</h3>
                    <div className="flex gap-3">
                        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl ${isDarkMode ? 'bg-zinc-800/50 border border-zinc-700' : 'bg-slate-100 border border-slate-200'} ${isDarkMode ? 'shadow-zinc-900/50' : ''}`}>
                            <div className={`w-2 h-2 rounded-full ${isDarkMode ? 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]' : 'bg-indigo-600'}`} />
                            <span className={`text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>{symbolA || '---'}</span>
                        </div>
                        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl ${isDarkMode ? 'bg-zinc-800/50 border border-zinc-700' : 'bg-slate-100 border border-slate-200'} ${isDarkMode ? 'shadow-zinc-900/50' : ''}`}>
                            <div className={`w-2 h-2 rounded-full ${isDarkMode ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]' : 'bg-amber-600'}`} />
                            <span className={`text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'text-amber-400' : 'text-amber-600'}`}>{symbolB || '---'}</span>
                        </div>
                    </div>
                </div>
                <div className="h-[300px] w-full relative">
                    <svg viewBox="0 0 800 300" className="w-full h-full overflow-visible" preserveAspectRatio="none">
                        {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
                            <line key={i} x1="0" y1={p * 300} x2="800" y2={p * 300} stroke="currentColor" strokeOpacity="0.05" />
                        ))}
                        <path d={generatePath(equityA, 800, 300)} fill="none" stroke="#6366f1" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="drop-shadow-lg" />
                        <path d={generatePath(equityB, 800, 300)} fill="none" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="drop-shadow-lg" />
                    </svg>
                </div>
            </Card>
        </div>
    );
};
