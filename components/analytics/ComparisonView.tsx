import React, { useMemo, useState, useEffect } from 'react';
import { Trade } from '../../types';
import { getSASTDateTime } from '../../lib/timeUtils';
import { calculateStats } from '../../lib/statsUtils';
import { Select } from '../Select';
import { Card } from '../ui/Card';
import {
    Coins, Target, Clock, HelpCircle
} from 'lucide-react';
import {
    Area, AreaChart, CartesianGrid, ResponsiveContainer,
    Tooltip as RechartsTooltip, XAxis, YAxis
} from 'recharts';
import { Tooltip as InfoTooltip } from '../ui/Tooltip';

interface ComparisonViewProps {
    trades: Trade[];
    isDarkMode: boolean;
    currencySymbol: string;
    onInfoClick?: () => void;
}

export const ComparisonView: React.FC<ComparisonViewProps> = ({ trades = [], isDarkMode, currencySymbol = '$', onInfoClick }) => {
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

    // Align both curves by trade sequence so Recharts can overlay them.
    const compareChartData = useMemo(() => {
        const len = Math.max(equityA.length, equityB.length, 2);
        return Array.from({ length: len }, (_, i) => ({
            i: i + 1,
            A: i < equityA.length ? Math.round(equityA[i] * 100) / 100 : null,
            B: i < equityB.length ? Math.round(equityB[i] * 100) / 100 : null,
        }));
    }, [equityA, equityB]);

    const compareTooltip = ({ active, payload, label }: any) => {
        if (!active || !payload?.length) return null;
        return (
            <div className="rounded-xl border border-zinc-800 bg-black px-3 py-2 shadow-2xl">
                <p className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1">Trade {label}</p>
                {payload.map((p: any) => (
                    <div key={p.dataKey} className="flex items-center justify-between gap-6 text-xs font-bold">
                        <span style={{ color: p.color }}>{p.dataKey === 'A' ? (symbolA || 'A') : (symbolB || 'B')}</span>
                        <span className="font-mono">{currencySymbol}{Number(p.value).toLocaleString()}</span>
                    </div>
                ))}
            </div>
        );
    };

    const formatAxis = (val: number) => {
        const abs = Math.abs(val);
        if (abs >= 1000) return `${val < 0 ? '-' : ''}${currencySymbol}${(abs / 1000).toFixed(1)}K`;
        return `${val < 0 ? '-' : ''}${currencySymbol}${abs}`;
    };

    const panels = [
        {
            label: symbolA,
            stats: statsA,
            range: rangeA,
            accent: 'text-indigo-500',
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
            range: rangeB,
            accent: 'text-amber-500',
            isWinner: {
                netProfit: statsB.netProfit > statsA.netProfit,
                winRate: statsB.winRate > statsA.winRate,
                profitFactor: statsB.profitFactor > statsA.profitFactor,
                total: statsB.total > statsA.total
            }
        }
    ];

    const fallbackLabel = compareMode === 'symbol' ? 'Select Symbol' : compareMode === 'strategy' ? 'Select Strategy' : 'Select Session';

    return (
        <div className="space-y-4 pb-20">
            {/* Comparison Mode Switcher */}
            <div className="p-1 rounded-2xl border-0 flex items-center gap-1 w-full md:w-fit md:mx-auto bg-[#0a0a0a] text-white">
                {(['symbol', 'strategy', 'session'] as const).map((mode) => (
                    <button
                        key={mode}
                        onClick={() => setCompareMode(mode)}
                        className={`flex-1 md:flex-none px-4 py-3 min-h-[48px] rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-[0.98] ${compareMode === mode
                            ? 'bg-[#FF4F00] text-white shadow-lg'
                            : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                        {mode}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="grid grid-cols-2 gap-3">
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
                <div className="grid grid-cols-2 gap-3">
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

            <Card isDarkMode={isDarkMode} padding="lg" className="relative rounded-3xl !bg-[#0a0a0a] !border-0 text-white">
                <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 mb-2">
                    <div className="min-w-0">
                        <h3 className="text-[15px] font-semibold tracking-tight text-indigo-500 truncate">{panels[0].label || fallbackLabel}</h3>
                        <p className="text-[10px] uppercase font-bold tracking-widest opacity-40">{dateRanges.find(r => r.value === panels[0].range)?.label}</p>
                    </div>
                    <span className="mt-1 px-2.5 py-1 rounded-full bg-white/5 border border-zinc-800 text-[10px] font-black uppercase tracking-widest opacity-50">vs</span>
                    <div className="min-w-0 text-right">
                        <h3 className="text-[15px] font-semibold tracking-tight text-amber-500 truncate">{panels[1].label || fallbackLabel}</h3>
                        <p className="text-[10px] uppercase font-bold tracking-widest opacity-40">{dateRanges.find(r => r.value === panels[1].range)?.label}</p>
                    </div>
                </div>
                <div className="divide-y divide-white/5">
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-4">
                        <div className={`flex items-center justify-end gap-1.5 text-xl font-black ${statsA.netProfit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            <span className="truncate">{statsA.netProfit >= 0 ? '+' : ''}{currencySymbol}{statsA.netProfit.toLocaleString()}</span>
                        </div>
                        <span className="w-[72px] text-center text-[10px] font-bold uppercase tracking-widest opacity-40">Net Profit</span>
                        <div className={`flex items-center gap-1.5 text-xl font-black ${statsB.netProfit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            <span className="truncate">{statsB.netProfit >= 0 ? '+' : ''}{currencySymbol}{statsB.netProfit.toLocaleString()}</span>
                        </div>
                    </div>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-4">
                        <div className="flex items-center justify-end gap-1.5 text-xl font-black">
                            <span>{statsA.winRate.toFixed(1)}%</span>
                        </div>
                        <span className="w-[72px] text-center text-[10px] font-bold uppercase tracking-widest opacity-40">Win Rate</span>
                        <div className="flex items-center gap-1.5 text-xl font-black">
                            <span>{statsB.winRate.toFixed(1)}%</span>
                        </div>
                    </div>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-4">
                        <div className="flex items-center justify-end gap-1.5 text-xl font-black">
                            <span>{Number.isFinite(statsA.profitFactor) ? statsA.profitFactor.toFixed(1) : '∞'}</span>
                        </div>
                        <span className="w-[72px] text-center text-[10px] font-bold uppercase tracking-widest opacity-40">Profit Factor</span>
                        <div className="flex items-center gap-1.5 text-xl font-black">
                            <span>{Number.isFinite(statsB.profitFactor) ? statsB.profitFactor.toFixed(1) : '∞'}</span>
                        </div>
                    </div>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-4">
                        <div className="flex items-center justify-end gap-1.5 text-xl font-black">
                            <span>{statsA.total}</span>
                        </div>
                        <span className="w-[72px] text-center text-[10px] font-bold uppercase tracking-widest opacity-40">Trades</span>
                        <div className="flex items-center gap-1.5 text-xl font-black">
                            <span>{statsB.total}</span>
                        </div>
                    </div>
                </div>
            </Card>

            <Card isDarkMode={isDarkMode} padding="lg" className="rounded-3xl !bg-[#0a0a0a] !border-0 text-white">
                <div className="flex items-center justify-between gap-3 mb-6">
                    <div className="flex items-center gap-2 min-w-0">
                        <h3 className="text-[15px] font-semibold tracking-tight text-left truncate">Equity race</h3>
                        <InfoTooltip content="Cumulative profit/loss per trade for both sides — whoever stays on top is winning." isDarkMode={isDarkMode} onInfoClick={onInfoClick}>
                            <HelpCircle size={14} className="opacity-40 cursor-help hover:opacity-100 shrink-0" />
                        </InfoTooltip>
                    </div>
                    <div className="flex gap-2 shrink-0">
                        <div className="flex items-center gap-1.5 py-1.5">
                            <div className="w-2 h-2 rounded-full bg-indigo-500" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400 max-w-[80px] truncate">{symbolA || '—'}</span>
                        </div>
                        <div className="flex items-center gap-1.5 py-1.5">
                            <div className="w-2 h-2 rounded-full bg-amber-500" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-amber-400 max-w-[80px] truncate">{symbolB || '—'}</span>
                        </div>
                    </div>
                </div>
                <div className="h-[260px] md:h-[320px] w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                        <AreaChart data={compareChartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                            <defs>
                                <linearGradient id="cmpA" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
                                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="cmpB" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35} />
                                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                            <XAxis dataKey="i" hide />
                            <YAxis
                                width={52}
                                tickLine={false}
                                axisLine={false}
                                tick={{ fill: '#71717a', fontSize: 10 }}
                                tickFormatter={formatAxis}
                            />
                            <RechartsTooltip content={compareTooltip} cursor={{ stroke: 'rgba(255,255,255,0.15)', strokeWidth: 1 }} />
                            <Area type="monotone" dataKey="A" stroke="#6366f1" strokeWidth={2.5} fill="url(#cmpA)" connectNulls dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
                            <Area type="monotone" dataKey="B" stroke="#f59e0b" strokeWidth={2.5} fill="url(#cmpB)" connectNulls dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </Card>
        </div>
    );
};
