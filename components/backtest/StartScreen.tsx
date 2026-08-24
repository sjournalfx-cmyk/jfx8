import React, { useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
    Play, Search, ChevronDown, Zap, Monitor, FileUp, Database,
    Loader2, Star, History
} from 'lucide-react';
import { BacktestSession } from '../../types';
import { CachedSeriesInfo } from '../../lib/candleStore';

// TradingView-style watchlist (kept in sync with BacktestLab's sidebar list)
const WATCHLISTS: Record<string, string[]> = {
    'Forex': [
        'FX:EURUSD', 'FX:GBPUSD', 'FX:USDJPY', 'FX:AUDUSD', 'FX:USDCAD', 'FX:USDCHF', 'FX:NZDUSD',
        'FX:EURGBP', 'FX:EURJPY', 'FX:GBPJPY', 'FX:CADJPY', 'FX:AUDJPY', 'FX:CHFJPY',
        'FX:EURAUD', 'FX:GBPAUD', 'FX:EURCAD', 'FX:GBPCAD', 'FX:AUDNZD', 'FX:NZDJPY'
    ],
    'Commodities': [
        'OANDA:XAUUSD', 'OANDA:XAGUSD', 'TVC:PLATINUM', 'TVC:PALLADIUM',
        'TVC:USOIL', 'TVC:UKOIL', 'TVC:NG1!', 'TVC:HG1!', 'TVC:ZC1!', 'TVC:ZW1!'
    ],
    'Indices': [
        'OANDA:SPX500USD', 'OANDA:NAS100USD', 'TVC:US30', 'TVC:RUT',
        'TVC:DE40', 'TVC:UK100', 'TVC:FR40', 'TVC:EU50',
        'TVC:JP225', 'TVC:HSI', 'OANDA:AU200AUD', 'TVC:CN50'
    ],
    'Crypto': [
        'BINANCE:BTCUSD', 'BINANCE:ETHUSD', 'BINANCE:SOLUSD', 'BINANCE:XRPUSD', 'BINANCE:BNBUSD',
        'BINANCE:ADAUSD', 'BINANCE:DOGEUSD', 'BINANCE:AVAXUSD', 'BINANCE:DOTUSD',
        'BINANCE:MATICUSD', 'BINANCE:LINKUSD', 'BINANCE:LTCUSD', 'BINANCE:SHIBUSD', 'BINANCE:UNIUSD'
    ]
};

const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
const POPULAR_SYMBOLS = ['EURUSD', 'GBPUSD', 'XAUUSD', 'USDJPY', 'NAS100', 'BTCUSD'];

type Source = 'mt5' | 'ctrader';

interface ResumeItem {
    key: string;
    kind: 'cloud' | 'local';
    symbol: string;
    timeframe: string;
    ts: number;
    session?: BacktestSession;
    barCount?: number;
}

export interface StartScreenProps {
    isDarkMode: boolean;
    bridgeStatus: 'online' | 'offline' | 'checking' | 'error';
    bridgeError: string | null;
    ctraderConnected: boolean;
    cloudSessions: BacktestSession[];
    isLoadingSessions: boolean;
    cachedSeries: CachedSeriesInfo[];
    starredSymbols: string[];
    onToggleStar: (fullSymbol: string) => void;
    onResumeCache: (symbol: string, timeframe: string) => void;
    onResumeSession: (session: BacktestSession) => void;
    onStart: (symbol: string, timeframe: string, source: Source) => void;
    onConnectCtrader: () => void;
    onImportJson: (file: File) => void;
    defaultSymbol: string;
    defaultTimeframe: string;
}

const timeAgo = (ts: number): string => {
    if (!ts) return '';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    return new Date(ts).toLocaleDateString();
};

const StartScreen: React.FC<StartScreenProps> = ({
    isDarkMode, bridgeStatus, bridgeError, ctraderConnected,
    cloudSessions, isLoadingSessions, cachedSeries,
    starredSymbols, onToggleStar,
    onResumeCache, onResumeSession, onStart, onConnectCtrader, onImportJson,
    defaultSymbol, defaultTimeframe
}) => {
    const [query, setQuery] = useState('');
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    const [pickerCategory, setPickerCategory] = useState('Forex');
    const [selectedSymbol, setSelectedSymbol] = useState(defaultSymbol);
    const [selectedTf, setSelectedTf] = useState(defaultTimeframe);
    const [preferredSource, setPreferredSource] = useState<'auto' | Source>('auto');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const bridgeOnline = bridgeStatus === 'online';
    const hasAnySource = ctraderConnected || bridgeOnline;
    const effectiveSource: Source | null =
        preferredSource === 'mt5' ? (bridgeOnline ? 'mt5' : null)
        : preferredSource === 'ctrader' ? (ctraderConnected ? 'ctrader' : null)
        : (ctraderConnected ? 'ctrader' : bridgeOnline ? 'mt5' : null);

    // "Continue where you left off": cloud sessions and local cache merged,
    // deduped per symbol_tf (cloud wins — it also carries drawings/trades).
    const resumeItems = useMemo<ResumeItem[]>(() => {
        const items: ResumeItem[] = [];
        const seen = new Set<string>();
        for (const s of cloudSessions) {
            const key = `${s.symbol}_${s.timeframe}`;
            seen.add(key);
            items.push({ key, kind: 'cloud', symbol: s.symbol, timeframe: s.timeframe, ts: new Date(s.updated_at).getTime() || 0, session: s });
        }
        for (const c of cachedSeries) {
            const key = `${c.symbol}_${c.timeframe}`;
            if (seen.has(key)) continue;
            seen.add(key);
            items.push({ key, kind: 'local', symbol: c.symbol, timeframe: c.timeframe, ts: c.lastAccess, barCount: c.barCount });
        }
        return items.sort((a, b) => b.ts - a.ts).slice(0, 3);
    }, [cloudSessions, cachedSeries]);

    const hasHistory = resumeItems.length > 0;

    const flatSymbols = useMemo(() =>
        Object.entries(WATCHLISTS).flatMap(([cat, list]) => list.map(full => ({ cat, full, bare: full.split(':')[1] || full })))
    , []);

    const pickerResults = useMemo(() => {
        const q = query.trim().toUpperCase();
        const source = q
            ? flatSymbols.filter(s => s.bare.toUpperCase().includes(q))
            : (WATCHLISTS[pickerCategory] || []).map(full => ({ cat: pickerCategory, full, bare: full.split(':')[1] || full }));
        return [...source].sort((a, b) => {
            const aStar = starredSymbols.includes(a.full) ? -1 : 0;
            const bStar = starredSymbols.includes(b.full) ? -1 : 0;
            return aStar - bStar || a.bare.localeCompare(b.bare);
        }).slice(0, 30);
    }, [query, pickerCategory, flatSymbols, starredSymbols]);

    const quickPicks = useMemo(() =>
        POPULAR_SYMBOLS.filter(p => p !== selectedSymbol).slice(0, 5)
    , [selectedSymbol]);

    const card = isDarkMode ? 'bg-zinc-900/80 border-zinc-800' : 'bg-white border-slate-200';
    const sub = isDarkMode ? 'text-zinc-500' : 'text-slate-400';
    const muted = isDarkMode ? 'text-zinc-400' : 'text-slate-500';

    const sourceLabel = effectiveSource === 'ctrader' ? 'cTrader' : effectiveSource === 'mt5' ? 'MT5 Bridge' : null;
    const sourceDot = effectiveSource === 'ctrader' ? 'bg-[#1689ff]' : effectiveSource === 'mt5' ? 'bg-emerald-500' : 'bg-rose-500';

    const handleStart = () => {
        if (effectiveSource) onStart(selectedSymbol, selectedTf, effectiveSource);
        else onConnectCtrader();
    };

    return (
        <div className={`absolute inset-0 z-[60] overflow-y-auto ${isDarkMode ? 'bg-black' : 'bg-slate-50'}`}>
            <div className="min-h-full flex items-center justify-center p-6 sm:p-10">
                <div className="w-full max-w-2xl space-y-6">

                    {/* Header */}
                    <div className="text-center space-y-2">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#FF4F01]/30 bg-[#FF4F01]/10 text-[#FF4F01] text-[9px] font-black uppercase tracking-[0.2em]">
                            <Zap size={11} fill="currentColor" /> Backtest Lab
                        </div>
                        <h1 className={`text-3xl font-black uppercase tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                            {hasHistory ? 'Continue where you left off' : hasAnySource ? 'Start a backtest' : 'Replay real market history'}
                        </h1>
                        <p className={`text-xs font-bold uppercase tracking-widest ${sub}`}>
                            {hasHistory
                                ? 'Resume a saved chart or start fresh below'
                                : hasAnySource
                                    ? 'Pick a pair and timeframe — data loads automatically'
                                    : 'Practice your strategy on historical candles. Connect a data source to begin.'}
                        </p>
                    </div>

                    {/* State A: resume cards */}
                    {hasHistory && (
                        <div className={`rounded-3xl border p-4 ${card}`}>
                            {isLoadingSessions && resumeItems.length === 0 ? (
                                <div className="flex items-center justify-center py-8">
                                    <Loader2 size={20} className="animate-spin text-[#FF4F01]" />
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <AnimatePresence initial={false}>
                                        {resumeItems.map(item => (
                                            <motion.button
                                                key={item.key}
                                                initial={{ opacity: 0, y: 6 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0 }}
                                                onClick={() => item.kind === 'cloud' && item.session ? onResumeSession(item.session) : onResumeCache(item.symbol, item.timeframe)}
                                                className={`group p-4 rounded-2xl border text-left transition-all hover:scale-[1.02] active:scale-[0.98] ${isDarkMode ? 'bg-black/60 border-zinc-800 hover:border-[#FF4F01]/50' : 'bg-slate-50 border-slate-200 hover:border-[#FF4F01]/50'}`}
                                            >
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${item.kind === 'cloud' ? 'bg-purple-500/10 text-purple-400' : 'bg-zinc-500/10 text-zinc-500'}`}>
                                                        {item.kind === 'cloud' ? 'Cloud' : 'Local'}
                                                    </span>
                                                    <History size={12} className={sub} />
                                                </div>
                                                <p className={`text-base font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{item.symbol}</p>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${isDarkMode ? 'bg-zinc-800 text-zinc-400' : 'bg-slate-200 text-slate-500'}`}>{item.timeframe}</span>
                                                    <span className={`text-[9px] font-bold uppercase tracking-widest ${sub}`}>
                                                        {item.kind === 'cloud' ? timeAgo(item.ts) : `${item.barCount ?? 0} bars · ${timeAgo(item.ts)}`}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5 mt-3 text-[#FF4F01] text-[9px] font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <Play size={10} fill="currentColor" /> Resume
                                                </div>
                                            </motion.button>
                                        ))}
                                    </AnimatePresence>
                                </div>
                            )}
                        </div>
                    )}

                    {/* State C: connect cards */}
                    {!hasAnySource && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className={`rounded-3xl border-2 p-6 flex flex-col items-center text-center gap-3 ${isDarkMode ? 'bg-zinc-900/80 border-[#0061FF]/40' : 'bg-white border-[#0061FF]/40'}`}>
                                <div className="p-3 rounded-2xl bg-[#0061FF]/10 text-[#1689ff]"><Zap size={26} /></div>
                                <div>
                                    <div className="flex items-center justify-center gap-2">
                                        <h3 className={`text-base font-black uppercase tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>cTrader</h3>
                                        <span className="px-1.5 py-0.5 rounded bg-[#0061FF]/15 text-[#1689ff] text-[8px] font-black uppercase tracking-widest">Recommended</span>
                                    </div>
                                    <p className={`text-[10px] font-bold uppercase tracking-widest mt-1 leading-relaxed ${sub}`}>Cloud historical candles<br />Works anywhere · No desktop app</p>
                                </div>
                                <button
                                    onClick={onConnectCtrader}
                                    className="mt-auto w-full py-2.5 rounded-xl bg-[#0061FF] text-white text-[10px] font-black uppercase tracking-widest shadow-lg shadow-[#0061FF]/25 hover:bg-[#0052d4] transition-all active:scale-95 flex items-center justify-center gap-1.5"
                                >
                                    <Zap size={12} /> Connect cTrader
                                </button>
                            </div>
                            <div className={`rounded-3xl border-2 border-dashed p-6 flex flex-col items-center text-center gap-3 ${isDarkMode ? 'bg-zinc-900/60 border-zinc-800' : 'bg-white border-slate-200'}`}>
                                <div className={`p-3 rounded-2xl ${isDarkMode ? 'bg-zinc-800 text-zinc-400' : 'bg-slate-100 text-slate-500'}`}><Monitor size={26} /></div>
                                <div>
                                    <h3 className={`text-base font-black uppercase tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>MT5 Bridge</h3>
                                    <p className={`text-[10px] font-bold uppercase tracking-widest mt-1 leading-relaxed ${sub}`}>Live data from your terminal<br />Requires the JournalFX Bridge app</p>
                                </div>
                                <div className={`mt-auto w-full py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5 ${bridgeStatus === 'checking' ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' : 'border-rose-500/30 bg-rose-500/10 text-rose-400'}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${bridgeStatus === 'checking' ? 'bg-amber-400 animate-pulse' : 'bg-rose-500'}`} />
                                    {bridgeStatus === 'checking' ? 'Checking Bridge…' : bridgeError || 'Bridge Offline'}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Start fresh (States A & B; hidden while unconnected) */}
                    {hasAnySource && (
                        <div className={`rounded-3xl border p-5 space-y-4 ${card}`}>
                            {/* Pair picker */}
                            <div className="relative">
                                <label className={`text-[8px] font-black uppercase tracking-widest ${sub} block mb-1.5`}>Pair</label>
                                <button
                                    onClick={() => setIsPickerOpen(o => !o)}
                                    className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl border transition-all ${isDarkMode ? 'bg-black border-zinc-800 hover:border-zinc-600' : 'bg-white border-slate-200 hover:border-slate-400'}`}
                                >
                                    <span className="flex items-center gap-2.5">
                                        <Search size={15} className={sub} />
                                        <span className={`text-sm font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{selectedSymbol}</span>
                                    </span>
                                    <ChevronDown size={14} className={`${sub} transition-transform ${isPickerOpen ? 'rotate-180' : ''}`} />
                                </button>

                                {isPickerOpen && (
                                    <>
                                        <div className="fixed inset-0 z-40" onClick={() => setIsPickerOpen(false)} />
                                        <div className={`absolute top-full left-0 right-0 mt-2 z-50 rounded-2xl border shadow-2xl overflow-hidden ${isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-slate-200'}`}>
                                            <div className={`p-3 space-y-2 border-b ${isDarkMode ? 'border-zinc-800' : 'border-slate-200'}`}>
                                                <input
                                                    autoFocus
                                                    value={query}
                                                    onChange={e => setQuery(e.target.value)}
                                                    placeholder="Search pairs…"
                                                    className={`w-full px-3 py-2 rounded-xl text-xs font-bold outline-none border ${isDarkMode ? 'bg-black border-zinc-800 text-white placeholder-zinc-600 focus:border-[#FF4F01]/50' : 'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400 focus:border-[#FF4F01]'}`}
                                                />
                                                {!query && (
                                                    <div className="flex items-center gap-1 overflow-x-auto">
                                                        {Object.keys(WATCHLISTS).map(cat => (
                                                            <button key={cat} onClick={() => setPickerCategory(cat)} className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest whitespace-nowrap transition-all ${pickerCategory === cat ? 'bg-[#FF4F01] text-white' : isDarkMode ? 'text-zinc-400 hover:bg-white/5' : 'text-slate-500 hover:bg-slate-100'}`}>
                                                                {cat}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="max-h-64 overflow-y-auto custom-scrollbar p-2">
                                                {pickerResults.map(({ full, bare }) => {
                                                    const starred = starredSymbols.includes(full);
                                                    const active = bare === selectedSymbol;
                                                    return (
                                                        <div key={full} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all ${active ? 'bg-[#FF4F01]/10 text-[#FF4F01]' : isDarkMode ? 'hover:bg-white/5 text-zinc-300' : 'hover:bg-slate-50 text-slate-700'}`}>
                                                            <button onClick={() => { setSelectedSymbol(bare); setIsPickerOpen(false); setQuery(''); }} className="flex-1 text-left text-xs font-black tracking-tight">
                                                                {bare}
                                                            </button>
                                                            <button onClick={(e) => { e.stopPropagation(); onToggleStar(full); }} className={`p-1 rounded transition-all ${starred ? 'text-amber-400' : `${sub} opacity-0 hover:opacity-100`}`}>
                                                                <Star size={13} fill={starred ? 'currentColor' : 'none'} />
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                                {pickerResults.length === 0 && (
                                                    <p className={`text-center text-[10px] font-bold uppercase tracking-widest py-6 ${sub}`}>No pairs match "{query}"</p>
                                                )}
                                            </div>
                                        </div>
                                    </>
                                )}
                                {/* Quick picks */}
                                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                                    <span className={`text-[8px] font-black uppercase tracking-widest ${sub}`}>Popular:</span>
                                    {quickPicks.map(p => (
                                        <button key={p} onClick={() => setSelectedSymbol(p)} className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all ${selectedSymbol === p ? 'bg-[#FF4F01]/15 text-[#FF4F01]' : isDarkMode ? 'bg-black/40 text-zinc-400 hover:text-white border border-zinc-800' : 'bg-slate-100 text-slate-500 hover:text-slate-900 border border-slate-200'}`}>
                                            {p}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Timeframe chips */}
                            <div>
                                <label className={`text-[8px] font-black uppercase tracking-widest ${sub} block mb-1.5`}>Timeframe</label>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    {TIMEFRAMES.map(tf => (
                                        <button key={tf} onClick={() => setSelectedTf(tf)} className={`px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 ${selectedTf === tf ? 'bg-[#FF4F01] text-white shadow-lg shadow-[#FF4F01]/25' : isDarkMode ? 'bg-black/40 text-zinc-400 hover:text-white border border-zinc-800' : 'bg-slate-100 text-slate-500 hover:text-slate-900 border border-slate-200'}`}>
                                            {tf}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Start button */}
                            <div className="space-y-2 pt-1">
                                <button
                                    onClick={handleStart}
                                    disabled={bridgeStatus === 'checking' && !ctraderConnected}
                                    className={`w-full py-4 rounded-2xl text-xs font-black uppercase tracking-[0.15em] flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-xl ${
                                        effectiveSource
                                            ? 'bg-[#FF4F01] text-white shadow-[#FF4F01]/30 hover:bg-[#e64700]'
                                            : 'bg-[#0061FF] text-white shadow-[#0061FF]/30 hover:bg-[#0052d4]'
                                    }`}
                                >
                                    <Play size={15} fill="currentColor" />
                                    {effectiveSource ? `Start Backtest — ${selectedSymbol} · ${selectedTf}` : 'Connect cTrader to Start'}
                                </button>
                                <div className="flex items-center justify-center gap-1.5 text-[9px] font-black uppercase tracking-widest">
                                    <span className={`w-1.5 h-1.5 rounded-full ${sourceDot} ${effectiveSource ? 'animate-pulse' : ''}`} />
                                    <span className={muted}>
                                        {sourceLabel ? `Data source: ${sourceLabel}` : 'No data source connected'}
                                    </span>
                                    {ctraderConnected && bridgeOnline && (
                                        <button onClick={() => setPreferredSource(p => p === 'ctrader' ? 'mt5' : 'ctrader')} className="text-[#FF4F01] hover:underline">
                                            switch to {preferredSource !== 'ctrader' ? 'MT5' : 'cTrader'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Advanced */}
                    <div className="flex items-center justify-center gap-4 text-[9px] font-black uppercase tracking-widest">
                        <button onClick={() => fileInputRef.current?.click()} className={`${muted} hover:text-[#FF4F01] transition-colors flex items-center gap-1`}>
                            <FileUp size={11} /> Import JSON file
                        </button>
                        {hasAnySource && effectiveSource !== 'mt5' && bridgeOnline && (
                            <button onClick={() => setPreferredSource('mt5')} className={`${muted} hover:text-emerald-500 transition-colors flex items-center gap-1`}>
                                <Monitor size={11} /> Use MT5 Bridge
                            </button>
                        )}
                        {hasAnySource && effectiveSource !== 'ctrader' && ctraderConnected && (
                            <button onClick={() => setPreferredSource('ctrader')} className={`${muted} hover:text-[#1689ff] transition-colors flex items-center gap-1`}>
                                <Zap size={11} /> Use cTrader
                            </button>
                        )}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".json"
                            className="hidden"
                            onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) onImportJson(f);
                                e.target.value = '';
                            }}
                        />
                    </div>

                    {/* Cloud sessions loading hint */}
                    {isLoadingSessions && hasHistory && (
                        <p className={`text-center text-[9px] font-bold uppercase tracking-widest ${sub} flex items-center justify-center gap-1.5`}>
                            <Database size={10} /> Syncing cloud sessions…
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default StartScreen;
