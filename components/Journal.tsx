import React, { useState, useMemo, useEffect } from 'react';
import { 
  Search, List, X, Upload, Image as ImageIcon, TrendingUp, TrendingDown, 
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, Activity, 
  Brain, ShieldCheck, ArrowUpRight, ArrowDownRight, Edit3,
  ChevronDown, Clock, CheckCircle2, Trash2, CheckSquare, Square, 
  Trophy, CheckCircle, LayoutPanelTop, Target, Star, Eye, Layers, Link, Unlink, RefreshCw, Mic
} from 'lucide-react';
import { Trade, UserProfile } from '../types';
import { getSASTDateTime } from '../lib/timeUtils';
import { JournalSkeleton, EmptyState } from './ui/Skeleton';

interface JournalProps {
  isDarkMode: boolean;
  trades: Trade[];
  onUpdateTrade: (trade: Trade) => void;
  onBatchUpdateTrades: (trades: Trade[]) => Promise<boolean>;
  onDeleteTrades: (tradeIds: string[]) => void;
  onEditTrade: (trade: Trade) => void;
  userProfile: UserProfile;
  isLoading?: boolean;
  offlineQueue?: Trade[];
  isDemoMode?: boolean;
}

interface GroupedTrade {
    type: 'standalone' | 'setup' | 'pending';
    setupId?: string;
    setupName?: string;
    trades: Trade[];
    date: string; // Latest trade date
    id: string; // for React key
}

const formatDuration = (openTime?: string, closeTime?: string) => {
    if (!openTime || !closeTime) return null;
    try {
        const startStr = openTime.includes(' ') && !openTime.includes('T') ? openTime.replace(' ', 'T') : openTime;
        const endStr = closeTime.includes(' ') && !closeTime.includes('T') ? closeTime.replace(' ', 'T') : closeTime;
        
        const start = new Date(startStr);
        const end = new Date(endStr);
        
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
        
        const diff = end.getTime() - start.getTime();
        if (diff < 0) return '0s';
        
        const totalSeconds = Math.floor(diff / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        
        let parts = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (seconds > 0 || (hours === 0 && minutes === 0)) parts.push(`${seconds}s`);
        
        return parts.join(' ');
    } catch (e) {
        return null;
    }
};

const safePnL = (value: unknown): number => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
};

const buildSetupName = (trades: Trade[]) => {
    const uniquePairs = Array.from(new Set(trades.map(trade => trade.pair).filter(Boolean)));
    const pairLabel = uniquePairs.length === 0
        ? 'Linked'
        : uniquePairs.length === 1
            ? uniquePairs[0]
            : uniquePairs.length === 2
                ? `${uniquePairs[0]} + ${uniquePairs[1]}`
                : `${uniquePairs[0]} + ${uniquePairs[1]} +${uniquePairs.length - 2}`;

    return `${pairLabel} ${trades.length}-Trade Setup`;
};

const buildSetupId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `setup-${crypto.randomUUID()}`;
    }

    return `setup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const ReadOnlyStarRating = ({ rating, isDarkMode }: { rating: number, isDarkMode: boolean }) => (
  <div className="flex items-center gap-0.5">
    {[1, 2, 3, 4, 5].map((star) => (
      <Star 
        key={star} 
        size={12} 
        className={`${
          star <= rating 
            ? 'text-amber-400 fill-amber-400' 
            : isDarkMode ? 'text-zinc-700' : 'text-slate-200'
        }`} 
      />
    ))}
  </div>
);

const MiniCalendar = ({ year, month, trades, isDarkMode, onClick }: any) => {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();
    const blanks = Array.from({ length: firstDay }, (_, i) => i);
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    const monthTrades = trades.filter((t: Trade) => {
        return t.date.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`);
    });

    const getDayStyle = (day: number) => {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayTrades = monthTrades.filter((t: Trade) => t.date === dateStr);
        if (dayTrades.length === 0) return { bg: isDarkMode ? 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600', text: '' };
        
        const pnl = dayTrades.reduce((acc: number, t: Trade) => acc + safePnL(t.pnl), 0);
        
        // Match main calendar logic
        if (Math.abs(pnl) < 5) return { bg: 'bg-zinc-400/80 shadow-sm shadow-zinc-400/10', text: 'text-white font-bold' };
        if (pnl > 0) return { bg: 'bg-emerald-700/65 shadow-sm shadow-emerald-900/10', text: 'text-white font-bold' };
        if (pnl < 0) return { bg: 'bg-rose-700/65 shadow-sm shadow-rose-900/10', text: 'text-white font-bold' };
        
        return { bg: 'bg-zinc-400', text: 'text-white font-bold' };
    };

    return (
        <div onClick={onClick} className={`p-5 rounded-2xl border cursor-pointer transition-all hover:scale-[1.02] hover:shadow-xl ${isDarkMode ? 'bg-[#121215] border-[#27272a]' : 'bg-white border-slate-100 shadow-md'}`}>
            <div className="flex justify-between items-center mb-4">
                <h4 className={`text-sm font-bold ${isDarkMode ? 'text-zinc-200' : 'text-slate-700'}`}>{new Date(year, month).toLocaleString('default', { month: 'long' })}</h4>
                {monthTrades.length > 0 && (<span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isDarkMode ? 'bg-zinc-800 text-zinc-400' : 'bg-slate-100 text-slate-500'}`}>{monthTrades.length} Trades</span>)}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
                {['S','M','T','W','T','F','S'].map(d => (<div key={d} className="text-[9px] font-bold opacity-30 text-center">{d}</div>))}
                {blanks.map(b => <div key={`b-${b}`} />)}
                {days.map(d => { 
                    const style = getDayStyle(d); 
                    return (<div key={d} className={`aspect-square rounded-md flex items-center justify-center text-[10px] transition-colors ${style.bg} ${style.text}`}>{d}</div>) 
                })}
            </div>
        </div>
    );
};

const CalendarView = ({ isDarkMode, trades, userProfile }: { isDarkMode: boolean, trades: Trade[], userProfile: UserProfile }) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [mode, setMode] = useState<'month' | 'year'>('month');
    const [isSummaryOpen, setIsSummaryOpen] = useState(false);
    
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfMonth = new Date(year, month, 1).getDay(); 
    const blanks = Array.from({ length: firstDayOfMonth }, (_, i) => i);
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    
    const prev = () => { if (mode === 'month') setCurrentDate(new Date(year, month - 1, 1)); else setCurrentDate(new Date(year - 1, month, 1)); };
    const next = () => { if (mode === 'month') setCurrentDate(new Date(year, month + 1, 1)); else setCurrentDate(new Date(year + 1, month, 1)); };
    const getTradesForDay = (day: number) => { const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; return trades.filter(t => t.date === dateStr); };

    const { monthlyStats, weekdayStats } = useMemo(() => {
        const currentMonthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
        const monthTrades = trades.filter(t => t.date.startsWith(currentMonthStr));
        const totalPnL = monthTrades.reduce((acc, t) => acc + safePnL(t.pnl), 0);
        const winTrades = monthTrades.filter(t => t.result === 'Win').length;
        const totalCount = monthTrades.length;
        const winRateTotal = totalCount > 0 ? (winTrades / totalCount) * 100 : 0;
        
        const dayMap: Record<string, number> = {};
        monthTrades.forEach(t => { dayMap[t.date] = (dayMap[t.date] || 0) + safePnL(t.pnl); });
        const winDays = Object.values(dayMap).filter(p => p > 0).length;
        const lossDays = Object.values(dayMap).filter(p => p < 0).length;

        const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const wdStats = weekdayNames.map((name, index) => {
            const dayTrades = monthTrades.filter(t => new Date(t.date).getDay() === index);
            const netProfits = dayTrades.reduce((acc, t) => acc + safePnL(t.pnl), 0);
            const totalProfits = dayTrades.reduce((acc, t) => safePnL(t.pnl) > 0 ? acc + safePnL(t.pnl) : acc, 0);
            const totalLoss = dayTrades.reduce((acc, t) => safePnL(t.pnl) < 0 ? acc + safePnL(t.pnl) : acc, 0);
            const wCount = dayTrades.filter(t => t.result === 'Win').length;
            const lCount = dayTrades.filter(t => t.result === 'Loss').length;
            const tCount = dayTrades.length;
            const wRate = tCount > 0 ? (wCount / tCount) * 100 : 0;
            const lRate = tCount > 0 ? (lCount / tCount) * 100 : 0;

            return { name, netProfits, totalProfits, totalLoss, wRate, lRate, tCount };
        });

        return { 
            monthlyStats: { totalPnL, winRate: winRateTotal, totalCount, winTrades, winDays, lossDays },
            weekdayStats: wdStats
        };
    }, [trades, year, month]);

    const isToday = (day: number) => { 
        const currentSASTDate = getSASTDateTime().date;
        const targetDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        return currentSASTDate === targetDate;
    };

    return (
        <div className="h-full flex flex-col">
            <div className={`flex flex-col md:flex-row md:items-center justify-between p-6 gap-4 border-b shrink-0 ${isDarkMode ? 'border-[#27272a] bg-[#121215]' : 'border-slate-100 bg-white'}`}>
                <div className="flex items-center gap-4">
                    <div className={`flex items-center p-1 rounded-xl border ${isDarkMode ? 'bg-[#09090b] border-[#27272a]' : 'bg-slate-50 border-slate-200'}`}>
                        <button onClick={prev} className={`p-2 rounded-lg hover:bg-opacity-10 ${isDarkMode ? 'hover:bg-white text-zinc-400' : 'hover:bg-black text-slate-500'}`}><ChevronLeft size={18} /></button>
                        <span className={`w-40 text-center font-bold text-sm ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{mode === 'month' ? currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : year}</span>
                        <button onClick={next} className={`p-2 rounded-lg hover:bg-opacity-10 ${isDarkMode ? 'hover:bg-white text-zinc-400' : 'hover:bg-black text-slate-500'}`}><ChevronRight size={18} /></button>
                    </div>
                    <div className={`flex rounded-lg border overflow-hidden p-1 gap-1 ${isDarkMode ? 'border-[#27272a] bg-[#09090b]' : 'border-slate-200 bg-slate-50'}`}>
                         <button onClick={() => setMode('month')} className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${mode === 'month' ? (isDarkMode ? 'bg-zinc-800 text-white shadow' : 'bg-white text-slate-900 shadow') : 'text-zinc-500'}`}>Month</button>
                         <button onClick={() => setMode('year')} className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${mode === 'year' ? (isDarkMode ? 'bg-zinc-800 text-white shadow' : 'bg-white text-slate-900 shadow') : 'text-zinc-500'}`}>Year</button>
                    </div>
                </div>
                {mode === 'month' && (
                    <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-4 animate-in fade-in slide-in-from-right-4">
                        <div className="flex flex-col items-end">
                            <span className="text-[10px] uppercase font-bold opacity-50 tracking-wider">Winning Days</span>
                            <div className="flex items-center gap-1.5">
                                <Trophy size={14} className="text-amber-500" />
                                <span className={`font-bold ${isDarkMode ? 'text-zinc-200' : 'text-slate-700'}`}>{monthlyStats.winDays}</span>
                            </div>
                        </div>
                        <div className="flex flex-col items-end">
                            <span className="text-[10px] uppercase font-bold opacity-50 tracking-wider">Losing Days</span>
                            <div className="flex items-center gap-1.5">
                                <TrendingDown size={14} className="text-rose-500" />
                                <span className={`font-bold ${isDarkMode ? 'text-zinc-200' : 'text-slate-700'}`}>{monthlyStats.lossDays}</span>
                            </div>
                        </div>
                        <div className="flex flex-col items-end">
                            <span className="text-[10px] uppercase font-bold opacity-50 tracking-wider">Winning Trades</span>
                            <div className="flex items-center gap-1.5">
                                <CheckCircle size={14} className="text-emerald-500" />
                                <span className={`font-bold ${isDarkMode ? 'text-zinc-200' : 'text-slate-700'}`}>{monthlyStats.winTrades}</span>
                            </div>
                        </div>
                        <div className={`w-px h-8 hidden lg:block ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-200'}`} />
                        <div className="flex flex-col items-end">
                            <span className="text-[10px] uppercase font-bold opacity-50 tracking-wider">Net P&L</span>
                            <span className={`font-mono font-bold text-lg ${monthlyStats.totalPnL > 0 ? 'text-teal-500' : monthlyStats.totalPnL < 0 ? 'text-rose-500' : isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>
                                {monthlyStats.totalPnL > 0 ? '+' : ''}{userProfile.currencySymbol}{Math.abs(monthlyStats.totalPnL).toLocaleString()}
                            </span>
                        </div>
                        <div className={`w-px h-8 hidden lg:block ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-200'}`} />
                        <div className="flex flex-col items-end">
                            <span className="text-[10px] uppercase font-bold opacity-50 tracking-wider">Win Rate</span>
                            <div className="flex items-center gap-1.5"><Activity size={14} className="text-purple-500" /><span className={`font-bold ${isDarkMode ? 'text-zinc-200' : 'text-slate-700'}`}>{monthlyStats.winRate.toFixed(0)}%</span></div>
                        </div>
                    </div>
                )}
            </div>

            <div className={`flex-1 overflow-y-auto custom-scrollbar p-6 pb-0 ${isDarkMode ? 'bg-[#09090b]' : 'bg-slate-50/50'}`}>
                {mode === 'month' && (
                    <div className={`mb-8 border-t border-l border-r rounded-t-2xl overflow-hidden transition-all duration-300 ${isDarkMode ? 'bg-[#18181b] border-[#27272a]' : 'bg-white border-slate-200 shadow-sm'}`}>
                        <button 
                            onClick={() => setIsSummaryOpen(!isSummaryOpen)}
                            className={`w-full flex items-center justify-between p-4 px-6 hover:bg-black/5 dark:hover:bg-white/5 transition-colors`}
                        >
                            <div className="flex items-center gap-3">
                                <LayoutPanelTop size={18} className="text-indigo-500" />
                                <span className={`text-sm font-bold uppercase tracking-widest ${isDarkMode ? 'text-zinc-200' : 'text-slate-700'}`}>Performance Summary</span>
                            </div>
                            <ChevronDown size={20} className={`transition-transform duration-300 ${isSummaryOpen ? 'rotate-180' : ''} ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`} />
                        </button>
                        
                        <div className={`transition-all duration-300 overflow-hidden ${isSummaryOpen ? 'max-h-[1000px] border-t dark:border-zinc-800 border-slate-100' : 'max-h-0'}`}>
                            <div className="p-6 overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead>
                                        <tr className={`text-[10px] font-black uppercase tracking-widest border-b dark:border-zinc-800 border-slate-100 ${isDarkMode ? 'text-zinc-200 opacity-40' : 'text-slate-500 opacity-70'}`}>
                                            <th className="pb-4 font-bold">Day</th>
                                            <th className="pb-4 font-bold">Net Profits</th>
                                            <th className="pb-4 font-bold text-center">Winning %</th>
                                            <th className="pb-4 font-bold text-right">Total Profits</th>
                                            <th className="pb-4 font-bold text-right pr-4">Total Loss</th>
                                        </tr>
                                    </thead>
                                    <tbody className={`text-xs font-bold divide-y dark:divide-zinc-800/50 divide-slate-100 ${isDarkMode ? 'text-zinc-300' : 'text-slate-700'}`}>
                                        {weekdayStats.map((wd) => (
                                            <tr key={wd.name} className="group">
                                                <td className="py-4 opacity-80">{wd.name}</td>
                                                <td className={`py-4 font-mono font-black ${wd.netProfits > 0 ? 'text-emerald-500' : wd.netProfits < 0 ? 'text-rose-500' : (isDarkMode ? 'opacity-40' : 'text-slate-400')}`}>
                                                    {wd.netProfits === 0 ? userProfile.currencySymbol + '0.00' : (wd.netProfits > 0 ? '+' : '-') + userProfile.currencySymbol + Math.abs(wd.netProfits).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </td>
                                                <td className="py-4">
                                                    <div className="flex items-center justify-center">
                                                        {wd.tCount > 0 ? (
                                                            <div className={`relative w-32 h-2.5 rounded-full overflow-hidden flex ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-100'}`}>
                                                                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-zinc-400/30 z-10" />
                                                                <div className="h-full bg-rose-500/80 ml-auto transition-all" style={{ width: `${wd.lRate / 2}%` }} />
                                                                <div className="h-full bg-emerald-500/80 transition-all" style={{ width: `${wd.wRate / 2}%` }} />
                                                            </div>
                                                        ) : (
                                                            <span className="opacity-30">--</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="py-4 text-right font-mono text-emerald-500">
                                                    {userProfile.currencySymbol}{wd.totalProfits.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </td>
                                                <td className="py-4 text-right pr-4 font-mono text-rose-500">
                                                    -{userProfile.currencySymbol}{Math.abs(wd.totalLoss).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {mode === 'month' ? (
                    <>
                        <div className="grid grid-cols-7 gap-4 text-center mb-4">
                            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                                <div key={d} className="text-xs font-bold uppercase opacity-30">{d}</div>
                            ))}
                        </div>
                        <div className="grid grid-cols-7 gap-4 auto-rows-fr">
                            {blanks.map(b => <div key={`blank-${b}`} className="min-h-[115px]" />)}
                            {days.map(day => { 
                                const dayTrades = getTradesForDay(day); 
                                const hasTrades = dayTrades.length > 0; 
                                const dayPnL = dayTrades.reduce((acc, t) => acc + safePnL(t.pnl), 0); 
                                
                                // TradeZella style logic: BE/Grey if P&L is very small (e.g. < $5 absolute)
                                const isBE = hasTrades && Math.abs(dayPnL) < 5;
                                const isPositive = dayPnL >= 5; 
                                const isNegative = dayPnL <= -5;
                                
                                const isCurrentDay = isToday(day); 
                                
                                const getBgColor = () => {
                                    if (!hasTrades) return isDarkMode ? 'bg-[#18181b] border-[#27272a]' : 'bg-white border-slate-200';
                                    if (isBE) return isDarkMode ? 'bg-zinc-500/20 border-zinc-500/30' : 'bg-slate-200 border-slate-300';
                                    if (isPositive) return isDarkMode ? 'bg-emerald-500/20 border-emerald-500/30' : 'bg-emerald-50 border-emerald-200';
                                    if (isNegative) return isDarkMode ? 'bg-rose-500/20 border-rose-500/30' : 'bg-rose-50 border-rose-200';
                                    return '';
                                };

                                return (
                                    <div key={day} className={`relative rounded-xl border p-2.5 flex flex-col items-center justify-center min-h-[115px] transition-all duration-200 overflow-hidden group ${getBgColor()} ${isDarkMode ? 'hover:border-zinc-600' : 'hover:shadow-md hover:-translate-y-0.5'} ${isCurrentDay ? 'ring-2 ring-indigo-500 ring-offset-2 ring-offset-[#09090b]' : ''}`}>
                                        <div className="absolute top-2 right-3 z-10">
                                            <span className={`text-[10px] font-bold ${isCurrentDay ? 'text-indigo-500' : isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>{day}</span>
                                        </div>
                                        
                                        {hasTrades ? (
                                            <div className="flex flex-col items-center justify-center gap-0.5 relative z-10">
                                                <div className={`text-base font-mono font-black tracking-tight ${isPositive ? 'text-emerald-500' : isNegative ? 'text-rose-500' : (isDarkMode ? 'text-zinc-400' : 'text-slate-600')}`}>
                                                    {dayPnL >= 0 ? '+' : '-'}{userProfile.currencySymbol}{Math.abs(dayPnL).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </div>
                                                <div className={`text-[10px] font-bold uppercase tracking-widest opacity-40 ${isDarkMode ? 'text-white' : 'text-black'}`}>
                                                    {dayTrades.length} {dayTrades.length === 1 ? 'Trade' : 'Trades'}
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>
                                )
                            })}
                        </div>
                    </>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 animate-in fade-in zoom-in-95">
                        {Array.from({length: 12}).map((_, i) => (
                            <MiniCalendar key={i} year={year} month={i} trades={trades} isDarkMode={isDarkMode} onClick={() => { setCurrentDate(new Date(year, i, 1)); setMode('month'); }} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

const Journal: React.FC<JournalProps> = ({ isDarkMode, trades, onUpdateTrade, onBatchUpdateTrades, onDeleteTrades, onEditTrade, userProfile, isLoading = false, offlineQueue = [], isDemoMode = false }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
    const [expandedTradeId, setExpandedTradeId] = useState<string | null>(null);
    const [expandedSetupIds, setExpandedSetupIds] = useState<string[]>([]);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
    const [draftSetupName, setDraftSetupName] = useState('');
    const [dateRange, setDateRange] = useState<{ start: string; end: string } | null>(null);
    const [draftDateRange, setDraftDateRange] = useState<{ start: string; end: string } | null>(null);
    const [showDateFilter, setShowDateFilter] = useState(false);
    
    // Quick date range presets
    const quickRanges = [
        { label: 'Today', days: 0 },
        { label: 'Last 7 days', days: 7 },
        { label: 'Last 30 days', days: 30 },
        { label: 'This Month', days: -1 },
        { label: 'Last Month', days: -2 },
        { label: 'All Time', days: -99 },
    ];

    const getRangeForDays = (days: number) => {
        const today = new Date();
        if (days === -99) {
            return null;
        }
        if (days === -1) {
            // This month
            const start = new Date(today.getFullYear(), today.getMonth(), 1);
            return {
                start: start.toISOString().split('T')[0],
                end: today.toISOString().split('T')[0]
            };
        }
        if (days === -2) {
            // Last month
            const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            const end = new Date(today.getFullYear(), today.getMonth(), 0);
            return {
                start: start.toISOString().split('T')[0],
                end: end.toISOString().split('T')[0]
            };
        }
        const start = new Date(today);
        start.setDate(start.getDate() - days);
        return {
            start: start.toISOString().split('T')[0],
            end: today.toISOString().split('T')[0]
        };
    };

    const applyQuickRange = (days: number) => {
        setDateRange(getRangeForDays(days));
    };

    const getCurrentMonthRange = () => {
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        return {
            start: start.toISOString().split('T')[0],
            end: today.toISOString().split('T')[0]
        };
    };

    useEffect(() => {
        if (!showDateFilter) return;
        setDraftDateRange(dateRange ?? getCurrentMonthRange());
    }, [showDateFilter, dateRange]);

    const selectedTrades = useMemo(() => trades.filter(t => selectedIds.includes(t.id)), [trades, selectedIds]);
    const areAllLinkedToSameSetup = useMemo(() => {
        if (selectedTrades.length < 1) return false;
        const firstSetupId = selectedTrades[0].setupId;
        if (!firstSetupId) return false;
        return selectedTrades.every(t => t.setupId === firstSetupId);
    }, [selectedTrades]);

    useEffect(() => {
        if (!isLinkModalOpen) return;
        const nextDraftName = buildSetupName(selectedTrades);
        setDraftSetupName(nextDraftName);
    }, [isLinkModalOpen, selectedTrades]);

    const selectedSetupSummary = useMemo(() => {
        if (selectedTrades.length < 2) return null;

        const setupIds = new Set(selectedTrades.map(trade => trade.setupId).filter(Boolean));
        const hasExistingSetup = setupIds.size > 0;
        const mixedSetupState = hasExistingSetup && !areAllLinkedToSameSetup;
        const setupName = buildSetupName(selectedTrades);

        return {
            setupName,
            hasExistingSetup,
            mixedSetupState,
            tradeCount: selectedTrades.length,
            pairCount: new Set(selectedTrades.map(trade => trade.pair)).size
        };
    }, [areAllLinkedToSameSetup, selectedTrades]);

    const filteredTrades = useMemo(() => {
        return trades.filter(t => {
            // Search filter
            const matchesSearch = !searchTerm || 
                t.pair.toLowerCase().includes(searchTerm.toLowerCase()) || 
                t.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase())) ||
                t.assetType.toLowerCase().includes(searchTerm.toLowerCase());
            
            // Date range filter
            const matchesDateRange = !dateRange || (
                t.date >= dateRange.start && t.date <= dateRange.end
            );
            
            return matchesSearch && matchesDateRange;
        });
    }, [trades, searchTerm, dateRange]);

    const groupedTrades = useMemo(() => {
        const groups: Record<string, GroupedTrade> = {};
        const result: GroupedTrade[] = [];
        const standaloneTradeCounts: Record<string, number> = {};

        // Add pending trades at the very top
        offlineQueue.forEach((trade, index) => {
            result.push({
                type: 'pending',
                trades: [trade],
                date: trade.date,
                id: `pending-${trade.ticketId || trade.id || index}`
            });
        });

        filteredTrades.forEach(trade => {
            if (trade.setupId) {
                if (!groups[trade.setupId]) {
                    groups[trade.setupId] = {
                        type: 'setup',
                        setupId: trade.setupId,
                        setupName: trade.setupName,
                        trades: [],
                        date: trade.date,
                        id: `setup-${trade.setupId}`
                    };
                    result.push(groups[trade.setupId]);
                }
                if (!groups[trade.setupId].setupName && trade.setupName) {
                    groups[trade.setupId].setupName = trade.setupName;
                }
                groups[trade.setupId].trades.push(trade);
                if (new Date(trade.date) > new Date(groups[trade.setupId].date)) {
                    groups[trade.setupId].date = trade.date;
                }
            } else {
                const seenCount = standaloneTradeCounts[trade.id] || 0;
                standaloneTradeCounts[trade.id] = seenCount + 1;
                result.push({
                    type: 'standalone',
                    trades: [trade],
                    date: trade.date,
                    id: `standalone-${trade.id}-${seenCount}`
                });
            }
        });

        return result.sort((a, b) => {
            const dateTimeA = new Date(`${a.date}T${a.trades[0].time}`);
            const dateTimeB = new Date(`${b.date}T${b.trades[0].time}`);
            return dateTimeB.getTime() - dateTimeA.getTime();
        });
    }, [filteredTrades, offlineQueue]);

    const toggleExpand = (id: string) => { setExpandedTradeId(expandedTradeId === id ? null : id); };
    const toggleSetupExpand = (id: string) => {
        if (expandedSetupIds.includes(id)) {
            setExpandedSetupIds(prev => prev.filter(sid => sid !== id));
        } else {
            setExpandedSetupIds(prev => [...prev, id]);
        }
    };

    const handleSelectAll = () => { 
        const allTradeIds = filteredTrades.map(t => t.id);
        if (selectedIds.length === allTradeIds.length) setSelectedIds([]); 
        else setSelectedIds(allTradeIds); 
    };

    const handleSelectOne = (id: string) => { if (selectedIds.includes(id)) setSelectedIds(prev => prev.filter(item => item !== id)); else setSelectedIds(prev => [...prev, id]); };
    const handleSelectSetup = (setupId: string, tradeIds: string[]) => {
        const allSelected = tradeIds.every(id => selectedIds.includes(id));
        if (allSelected) {
            setSelectedIds(prev => prev.filter(id => !tradeIds.includes(id)));
        } else {
            setSelectedIds(prev => Array.from(new Set([...prev, ...tradeIds])));
        }
    };

    const handleBulkDelete = () => { if (selectedIds.length === 0) return; onDeleteTrades(selectedIds); setSelectedIds([]); };

    const handleLinkSelected = async () => {
        if (selectedIds.length < 2) return;

        const cleanSetupName = draftSetupName.trim() || buildSetupName(selectedTrades);
        const setupId = buildSetupId();
        const tradesToUpdate = selectedTrades
            .filter(t => selectedIds.includes(t.id))
            .map(t => ({
                ...t,
                setupId,
                setupName: cleanSetupName
            }));

        const updated = await onBatchUpdateTrades(tradesToUpdate);
        if (updated) {
            setSelectedIds([]);
            setIsLinkModalOpen(false);
            setDraftSetupName('');
        }
    };

    const handleDetachSelected = async () => {
        if (selectedIds.length === 0) return;
        const tradesToUpdate = selectedTrades
            .filter(t => selectedIds.includes(t.id))
            .map(t => ({
                ...t,
                setupId: undefined,
                setupName: undefined
            }));

        const updated = await onBatchUpdateTrades(tradesToUpdate);
        if (updated) {
            setSelectedIds([]);
        }
    };

    const handleBreakCluster = async (setupId: string) => {
        const tradesToUpdate = trades
            .filter(t => t.setupId === setupId)
            .map(t => ({
                ...t,
                setupId: undefined,
                setupName: undefined
            }));

        const updated = await onBatchUpdateTrades(tradesToUpdate);
        if (updated) {
            setExpandedSetupIds(prev => prev.filter(id => id !== setupId));
        }
    };

    const handleUpload = (trade: Trade, type: 'before' | 'after', e: React.ChangeEvent<HTMLInputElement>) => { if (!e.target.files || !e.target.files[0]) return; const file = e.target.files[0]; const reader = new FileReader(); reader.onloadend = () => { onUpdateTrade({ ...trade, [type === 'before' ? 'beforeScreenshot' : 'afterScreenshot']: reader.result as string }); }; reader.readAsDataURL(file); };
    const handleDeleteImage = (trade: Trade, type: 'before' | 'after') => {
        onUpdateTrade({
            ...trade,
            [type === 'before' ? 'beforeScreenshot' : 'afterScreenshot']: undefined
        });
    };

    const [previewImage, setPreviewImage] = useState<{ url: string, title: string } | null>(null);
    const [editingComment, setEditingComment] = useState<{ tradeId: string; field: 'notes' | 'exitComment'; value: string } | null>(null);

    const beginCommentEdit = (trade: Trade, field: 'notes' | 'exitComment') => {
        setEditingComment({
            tradeId: trade.id,
            field,
            value: field === 'notes' ? (trade.notes || '') : (trade.exitComment || '')
        });
    };

    const saveCommentEdit = (trade: Trade) => {
        if (!editingComment || editingComment.tradeId !== trade.id) return;
        onUpdateTrade({
            ...trade,
            [editingComment.field]: editingComment.value
        });
        setEditingComment(null);
    };

    const renderTradeDetails = (trade: Trade) => (
        <div key={`details-${trade.id}`} className={`col-span-11 mx-6 mt-1 mb-6 rounded-2xl overflow-hidden border shadow-xl relative ${isDarkMode ? 'bg-[#09090b] border-[#27272a] shadow-black' : 'bg-white border-slate-200'}`}>
            <div className={`relative px-6 py-4 border-b flex flex-wrap items-center justify-between gap-4 ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-slate-50/50 border-slate-100'}`}>
                <div className="flex items-center gap-6">
                    <div>
                        <div className={`text-4xl font-mono font-black tracking-tighter leading-none ${safePnL(trade.pnl) > 0 ? 'text-emerald-400' : safePnL(trade.pnl) < 0 ? 'text-rose-500' : 'text-zinc-500'}`}>
                            {safePnL(trade.pnl) > 0 ? '+' : safePnL(trade.pnl) < 0 ? '-' : ''}{userProfile.currencySymbol}{Math.abs(safePnL(trade.pnl)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div className="text-[9px] font-black uppercase tracking-[0.2em] opacity-40 mt-1">Net P&L</div>
                    </div>
                    <div className={`w-px h-10 ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-200'}`} />
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-2xl font-black tracking-tight">{trade.pair}</h2>
                            <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${trade.direction === 'Long' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>{trade.direction}</span>
                            <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-indigo-500 text-white`}>{trade.assetType}</span>
                        </div>
                        <div className="flex items-center gap-3 opacity-50 text-xs font-medium mt-0.5">
                            <span className="flex items-center gap-1">{trade.date}</span>
                            <span className="w-1 h-1 rounded-full bg-current opacity-50"></span>
                            <span className="flex items-center gap-1">{trade.time}</span>
                            <span className="w-1 h-1 rounded-full bg-current opacity-50"></span>
                            <span className="flex items-center gap-1">{trade.session}</span>
                            {trade.openTime && trade.closeTime && (
                                <>
                                    <span className="w-1 h-1 rounded-full bg-current opacity-50"></span>
                                    <span className="flex items-center gap-1 text-indigo-400 font-bold">
                                        <Clock size={12} /> {formatDuration(trade.openTime, trade.closeTime)}
                                    </span>
                                </>
                            )}
                            <span className="w-1 h-1 rounded-full bg-current opacity-50"></span>
                            <div className="flex items-center gap-1" title={`Rating: ${trade.rating || 0}/5`}>
                                <ReadOnlyStarRating rating={trade.rating || 0} isDarkMode={isDarkMode} />
                            </div>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button 
                        onClick={() => onEditTrade(trade)}
                        className={`p-2 rounded-lg transition-all ${isDarkMode ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-white text-slate-500 shadow-sm border border-slate-200'}`} 
                        title="Edit Entry"
                    >
                        <Edit3 size={16} />
                    </button>
                    <button onClick={() => setExpandedTradeId(null)} className={`p-2 rounded-lg transition-all bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white`}><X size={18} /></button>
                </div>
            </div>
            <div className="relative p-6">
                <div className="grid grid-cols-12 gap-6 items-stretch">
                    <div className="col-span-12 md:col-span-4 lg:col-span-3 space-y-4 pr-1">
                        <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-zinc-900/30 border-zinc-800' : 'bg-slate-50/50 border-slate-200'}`}>
                            <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-3">Execution</h4>
                             <div className="space-y-3 text-sm">
                                 <div className="flex justify-between"><span className="opacity-50">Entry</span><span className="font-mono font-bold">{trade.entryPrice.toFixed(2)}</span></div>
                                 <div className="flex justify-between"><span className="opacity-50">Exit</span><span className="font-mono font-bold">{trade.exitPrice?.toFixed(2)}</span></div>
                                 <div className="flex justify-between"><span className="opacity-50">Stop Loss</span><span className="font-mono font-bold text-rose-500">{trade.stopLoss.toFixed(2)}</span></div>
                                 <div className="flex justify-between"><span className="opacity-50">Take Profit</span><span className="font-mono font-bold text-emerald-500">{trade.takeProfit.toFixed(2)}</span></div>
                                 <div className="h-px bg-current opacity-10 my-2" />
                                 {(() => {
                                     const pipSize = trade.pair.includes('JPY') ? 0.01 : 0.0001;
                                     const pipMovement = trade.exitPrice ? (trade.direction === 'Long' ? trade.exitPrice - trade.entryPrice : trade.entryPrice - trade.exitPrice) / pipSize : 0;
                                     return (
                                          <div className="flex justify-between"><span className="opacity-50">Pip Movement</span><span className={`font-bold ${pipMovement >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{pipMovement >= 0 ? '+' : ''}{pipMovement.toFixed(2)} pip</span></div>
                                     );
                                 })()}
                                {trade.openTime && (
                                    <div className="flex justify-between text-[10px]"><span className="opacity-50 uppercase font-bold">Opened</span><span className="font-mono opacity-80">{new Date(trade.openTime).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}</span></div>
                                )}
                                {trade.closeTime && (
                                    <div className="flex justify-between text-[10px]"><span className="opacity-50 uppercase font-bold">Closed</span><span className="font-mono opacity-80">{new Date(trade.closeTime).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}</span></div>
                                )}
                                <div className="flex justify-between"><span className="opacity-50">Volume</span><span className="font-bold">{trade.lots} Lots</span></div>
                                <div className="flex justify-between"><span className="opacity-50">R:R Ratio</span><span className="font-bold text-indigo-500">1 : {trade.rr}</span></div>
                            </div>
                        </div>
                        <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-zinc-900/30 border-zinc-800' : 'bg-slate-50/50 border-slate-200'}`}>
                            <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-3">Psychology</h4>
                            <div className="space-y-3 text-sm">
                                <div className="flex justify-between"><span className="opacity-50">Mindset</span><span className="font-bold">{trade.mindset || 'Neutral'}</span></div>
                                <div className="flex justify-between"><span className="opacity-50">Plan</span><span className="font-bold">{trade.planAdherence || 'N/A'}</span></div>
                                <div className="flex justify-between"><span className="opacity-50">Mistake</span><span className="font-bold text-rose-500">{trade.tradingMistake || 'None'}</span></div>
                            </div>
                        </div>
                        <div className={`p-3 rounded-xl border ${isDarkMode ? 'bg-zinc-900/30 border-zinc-800 text-zinc-300' : 'bg-white border-slate-200 text-slate-700'}`}>
                            <div className="flex items-center justify-between mb-2">
                                <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40">Voice Note</h4>
                                <Mic size={12} className="opacity-40" />
                            </div>
                            {trade.voiceNote ? (
                                <p className="text-[11px] leading-relaxed whitespace-pre-wrap max-h-24 overflow-auto pr-1">
                                    {trade.voiceNote}
                                </p>
                            ) : (
                                <div className="flex items-center gap-2 opacity-40 text-[10px] font-bold uppercase tracking-widest">
                                    <Mic size={11} />
                                    No Voice Note
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="col-span-12 lg:col-span-9 grid grid-cols-1 md:grid-cols-2 gap-4 md:h-full md:grid-rows-[308px_minmax(0,1fr)] items-stretch content-start pr-1">
                        {[{ id: 'before', label: 'Before Canvas', data: trade.beforeScreenshot }, { id: 'after', label: 'After Canvas', data: trade.afterScreenshot }].map((slot) => (
                            <div key={slot.id} className="group h-[308px] min-h-[308px] rounded-xl border overflow-hidden bg-black/5 dark:bg-white/5 border-dashed border-zinc-300 dark:border-zinc-700 flex flex-col">
                                <div className="px-3 py-2 border-b border-white/5 dark:border-zinc-700/70 bg-black/5 dark:bg-white/5 flex items-center justify-between">
                                    <div className="text-[9px] font-bold text-white uppercase tracking-wider px-2 py-0.5 bg-black/60 rounded">{slot.label}</div>
                                    {slot.data && (
                                        <div className="flex items-center gap-2">
                                            <button 
                                                onClick={() => setPreviewImage({ url: slot.data!, title: `${trade.pair} - ${slot.label} Screenshot` })}
                                                className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-all"
                                                title="View Full Size"
                                            >
                                                <Eye size={16} />
                                            </button>
                                            <button 
                                                onClick={() => handleDeleteImage(trade, slot.id as any)}
                                                className="p-2 bg-rose-500/80 hover:bg-rose-500 text-white rounded-lg transition-all"
                                                title="Delete Image"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <div className="relative flex-1 min-h-0 overflow-hidden">
                                    {slot.data ? (
                                        <img src={slot.data} alt={slot.label} className="absolute inset-0 w-full h-full object-cover" />
                                    ) : (
                                        <label className="absolute inset-0 cursor-pointer flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors">
                                            <div className="flex flex-col items-center justify-center opacity-35 text-center">
                                                <ImageIcon size={20} className="mb-2" />
                                                <span className="text-[9px] font-bold uppercase tracking-wider">No Image</span>
                                            </div>
                                            <input 
                                                type="file" 
                                                accept="image/*" 
                                                className="hidden" 
                                                aria-label={`Upload ${slot.label} screenshot`}
                                                onChange={(e) => handleUpload(trade, slot.id as any, e)} 
                                            />
                                        </label>
                                    )}
                                </div>
                            </div>
                        ))}
                        <div className={`h-full p-5 rounded-xl border flex flex-col ${isDarkMode ? 'bg-zinc-900/20 border-zinc-800 text-zinc-300' : 'bg-white border-slate-200 text-slate-700'}`}>
                            <div className="flex items-center justify-between mb-2">
                                <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40">Entry Note</h4>
                                {!(editingComment?.tradeId === trade.id && editingComment.field === 'notes') && (
                                    <button
                                        onClick={() => beginCommentEdit(trade, 'notes')}
                                        className={`p-1.5 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-zinc-800 text-zinc-500' : 'hover:bg-slate-100 text-slate-400'}`}
                                        title="Edit Entry Comment"
                                    >
                                        <Edit3 size={12} />
                                    </button>
                                )}
                            </div>
                            <div className="flex-1 min-h-0 overflow-auto pr-1">
                                {editingComment?.tradeId === trade.id && editingComment.field === 'notes' ? (
                                    <div className="space-y-3">
                                        <textarea
                                            value={editingComment.value}
                                            onChange={(e) => setEditingComment(prev => prev ? { ...prev, value: e.target.value } : prev)}
                                            className={`w-full min-h-28 resize-none rounded-xl border px-3 py-2 text-sm outline-none ${isDarkMode ? 'bg-zinc-950 border-zinc-800 text-zinc-100' : 'bg-slate-50 border-slate-200 text-slate-900'}`}
                                            placeholder="Edit entry comment..."
                                        />
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                onClick={() => setEditingComment(null)}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest ${isDarkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-slate-100 text-slate-600'}`}
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={() => saveCommentEdit(trade)}
                                                className="px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest bg-brand text-white"
                                            >
                                                Save
                                            </button>
                                        </div>
                                    </div>
                                ) : trade.notes ? (
                                    <div
                                        className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none"
                                        dangerouslySetInnerHTML={{ __html: trade.notes }}
                                    />
                                ) : (
                                    <p className="text-sm opacity-50 italic">No entry comments recorded.</p>
                                )}
                            </div>
                            {trade.voiceNote && (
                                <div className="mt-4 pt-4 border-t border-dashed border-current/10">
                                    <h5 className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-2">Voice Note</h5>
                                    <p className="text-sm leading-relaxed whitespace-pre-wrap opacity-90">
                                        {trade.voiceNote}
                                    </p>
                                </div>
                            )}
                        </div>
                        <div className={`h-full p-5 rounded-xl border flex flex-col ${isDarkMode ? 'bg-zinc-900/20 border-zinc-800 text-zinc-300' : 'bg-white border-slate-200 text-slate-700'}`}>
                            <div className="flex items-center justify-between mb-2">
                                <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40">Exit Note</h4>
                                {!(editingComment?.tradeId === trade.id && editingComment.field === 'exitComment') && (
                                    <button
                                        onClick={() => beginCommentEdit(trade, 'exitComment')}
                                        className={`p-1.5 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-zinc-800 text-zinc-500' : 'hover:bg-slate-100 text-slate-400'}`}
                                        title="Edit Exit Comment"
                                    >
                                        <Edit3 size={12} />
                                    </button>
                                )}
                            </div>
                            <div className="flex-1 min-h-0 overflow-auto pr-1">
                                {editingComment?.tradeId === trade.id && editingComment.field === 'exitComment' ? (
                                    <div className="space-y-3">
                                        <textarea
                                            value={editingComment.value}
                                            onChange={(e) => setEditingComment(prev => prev ? { ...prev, value: e.target.value } : prev)}
                                            className={`w-full min-h-28 resize-none rounded-xl border px-3 py-2 text-sm outline-none ${isDarkMode ? 'bg-zinc-950 border-zinc-800 text-zinc-100' : 'bg-slate-50 border-slate-200 text-slate-900'}`}
                                            placeholder="Edit exit comment..."
                                        />
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                onClick={() => setEditingComment(null)}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest ${isDarkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-slate-100 text-slate-600'}`}
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={() => saveCommentEdit(trade)}
                                                className="px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest bg-brand text-white"
                                            >
                                                Save
                                            </button>
                                        </div>
                                    </div>
                                ) : trade.exitComment ? (
                                    <div
                                        className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none"
                                        dangerouslySetInnerHTML={{ __html: trade.exitComment }}
                                    />
                                ) : (
                                    <p className="text-sm opacity-50 italic">No exit comments recorded.</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderTradeRow = (trade: Trade, isGrouped = false, isFirst = false, isLast = false, rowKey?: string) => (
        <React.Fragment key={rowKey || `${isGrouped ? 'grouped' : 'standalone'}-${trade.id}-${trade.date}-${trade.time}`}>
            <div className={`grid grid-cols-[40px_1.5fr_1fr_1fr_1.2fr_1.2fr_1fr_1.5fr_0.8fr_1.2fr_40px] px-2 py-4 border-b items-center transition-all rounded-xl ${isGrouped ? (isDarkMode ? 'bg-white/[0.02] mt-0 rounded-none first:rounded-t-xl last:rounded-b-xl last:border-b-0' : 'bg-black/[0.01] mt-0 rounded-none first:rounded-t-xl last:rounded-b-xl last:border-b-0') : 'mt-1'} ${expandedTradeId === trade.id ? (isDarkMode ? 'bg-zinc-800/50 border-indigo-500/50' : 'bg-slate-50 border-indigo-200 shadow-inner') : (isDarkMode ? 'border-[#27272a] hover:bg-zinc-800/30' : 'border-slate-100 hover:bg-slate-50')} ${selectedIds.includes(trade.id) ? (isDarkMode ? 'bg-indigo-900/10' : 'bg-indigo-50') : ''}`}>
                <div className="col-span-1 flex items-center justify-center self-stretch relative min-h-[64px]">
                    {isGrouped ? (
                        <div className="absolute inset-0 flex flex-col items-center">
                            {/* Connector Line - Full height for middle items, half for first/last */}
                            <div className={`w-0.5 flex-1 ${isFirst ? 'bg-transparent' : 'bg-violet-500/40'}`} />
                            
                            {/* Dot for First and Last */}
                            <div className="relative flex items-center justify-center h-4">
                                {(isFirst || isLast) ? (
                                    <div className="w-2.5 h-2.5 rounded-full bg-violet-500 shadow-[0_0_10px_rgba(139,92,246,0.5)] z-20" />
                                ) : (
                                    <div className="w-1.5 h-1.5 rounded-full bg-violet-500/40 z-20" />
                                )}
                            </div>
                            
                            <div className={`w-0.5 flex-1 ${isLast ? 'bg-transparent' : 'bg-violet-500/40'}`} />
                        </div>
                    ) : (
                        <button onClick={() => handleSelectOne(trade.id)} className={`${selectedIds.includes(trade.id) ? 'text-indigo-500' : 'text-zinc-500 hover:text-zinc-300'}`}>
                            {selectedIds.includes(trade.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                        </button>
                    )}
                </div>
                <div className="col-span-1 pl-2 cursor-pointer" onClick={() => toggleExpand(trade.id)}>
                    <p className="font-bold text-sm">{trade.date}</p>
                    <p className="text-xs opacity-50">{trade.time}</p>
                </div>
                <div className="col-span-1 font-bold cursor-pointer" onClick={() => toggleExpand(trade.id)}>{trade.pair}</div>
                <div className="col-span-1 text-xs opacity-70 cursor-pointer" onClick={() => toggleExpand(trade.id)}>{trade.assetType}</div>
                <div className="col-span-1 cursor-pointer" onClick={() => toggleExpand(trade.id)}>
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold ${trade.direction === 'Long' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                        {trade.direction === 'Long' ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {trade.direction}
                    </span>
                </div>
                <div className="col-span-1 text-xs opacity-80 cursor-pointer" onClick={() => toggleExpand(trade.id)}>{trade.session}</div>
                <div className="col-span-1 text-xs font-mono font-bold opacity-60 cursor-pointer" onClick={() => toggleExpand(trade.id)}>
                    {formatDuration(trade.openTime, trade.closeTime) || '---'}
                </div>
        <div className="col-span-1 flex flex-wrap gap-1 cursor-pointer" onClick={() => toggleExpand(trade.id)}>
          {(trade.tags || []).slice(0, 2).map((tag, i) => (
            <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded border ${isDarkMode ? 'border-zinc-700 bg-zinc-800' : 'border-slate-200 bg-slate-100'}`}>{tag}</span>
          ))}
          {(trade.tags || []).length > 2 && <span className="text-[10px] opacity-50">+{(trade.tags || []).length - 2}</span>}
        </div>
                <div className="col-span-1 cursor-pointer" onClick={() => toggleExpand(trade.id)}>
                    <ReadOnlyStarRating rating={trade.rating || 0} isDarkMode={isDarkMode} />
                </div>
                <div className="col-span-1 text-right cursor-pointer" onClick={() => toggleExpand(trade.id)}>
                    <p className={`font-mono font-bold ${safePnL(trade.pnl) > 0 ? 'text-emerald-500' : safePnL(trade.pnl) < 0 ? 'text-rose-500' : ''}`}>
                        {safePnL(trade.pnl) > 0 ? '+' : safePnL(trade.pnl) < 0 ? '-' : ''}{userProfile.currencySymbol}{Math.abs(safePnL(trade.pnl)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className={`text-[10px] font-bold uppercase ${trade.result === 'Win' ? 'text-emerald-500' : trade.result === 'Loss' ? 'text-rose-500' : 'text-zinc-500'}`}>
                        {trade.result} {trade.rr > 0 ? `(${trade.rr}R)` : ''}
                    </p>
                </div>
                <div className="col-span-1 flex justify-center">
                    <div onClick={() => toggleExpand(trade.id)} className={`p-1 rounded-full cursor-pointer transition-all ${expandedTradeId === trade.id ? 'rotate-180 bg-indigo-500 text-white' : isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>
                        <ChevronDown size={18} />
                    </div>
                </div>
            </div>
            {expandedTradeId === trade.id && renderTradeDetails(trade)}
        </React.Fragment>
    );

    return (
        <div className={`w-full h-full overflow-hidden flex flex-col p-8 pb-0 ${isDarkMode ? 'bg-[#09090b] text-zinc-200' : 'bg-slate-50 text-slate-900'}`}>
            {previewImage && (
                <div 
                    className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-sm flex flex-col p-4 animate-in fade-in duration-200"
                    onClick={() => setPreviewImage(null)}
                >
                    <div className="flex items-center justify-between px-6 py-4 text-white">
                        <h3 className="font-bold">{previewImage.title}</h3>
                        <button className="p-2 hover:bg-white/10 rounded-full transition-colors"><X size={24} /></button>
                    </div>
                    <div className="flex-1 flex items-center justify-center overflow-hidden">
                        <img 
                            src={previewImage.url} 
                            alt="Preview" 
                            className="max-w-full max-h-full object-contain animate-in zoom-in-95 duration-300" 
                            onClick={(e) => e.stopPropagation()}
                        />
                    </div>
                </div>
            )}
            <header className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <h1 className="text-3xl font-bold tracking-tight">Trade Journal</h1>
                        {isDemoMode && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border border-amber-500/30 bg-amber-500/10 text-amber-300">
                                Demo Mode
                            </span>
                        )}
                    </div>
                    <p className={`text-sm ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>
                        {isDemoMode ? 'Sample trades from January to March are loaded for review.' : 'Detailed history of your market execution.'}
                    </p>
                </div>
                {selectedIds.length > 0 ? (
                    <div className="flex items-center gap-3 animate-in slide-in-from-right-4">
                        <span className="text-sm font-bold opacity-60 mr-2">{selectedIds.length} Selected</span>
                        {selectedIds.length >= 2 && (
                            <button 
                                onClick={() => areAllLinkedToSameSetup ? handleDetachSelected() : setIsLinkModalOpen(true)}
                                className={`p-2 px-4 rounded flex items-center gap-2 text-xs font-bold transition-all shadow-lg ${
                                    areAllLinkedToSameSetup 
                                    ? 'bg-rose-600 text-white hover:bg-rose-700 shadow-rose-500/20' 
                                    : 'bg-violet-600 text-white hover:bg-violet-700 shadow-violet-500/20'
                                }`}
                            >
                                {areAllLinkedToSameSetup ? (
                                    <><Unlink size={16} /> Unlink Setup</>
                                ) : (
                                    <><Link size={16} /> Link to Setup</>
                                )}
                            </button>
                        )}
                        {selectedSetupSummary && (
                            <div className={`hidden lg:flex flex-col gap-0.5 px-4 py-2 rounded-xl border text-left ${selectedSetupSummary.mixedSetupState ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : isDarkMode ? 'border-[#27272a] bg-[#18181b] text-zinc-300' : 'border-slate-200 bg-white text-slate-700'}`}>
                                <span className="text-[9px] font-black uppercase tracking-widest opacity-60">Setup Preview</span>
                                <span className="text-xs font-bold leading-tight">{selectedSetupSummary.setupName}</span>
                                <span className="text-[10px] opacity-50">
                                    {selectedSetupSummary.tradeCount} trades · {selectedSetupSummary.pairCount} pair{selectedSetupSummary.pairCount === 1 ? '' : 's'}
                                </span>
                            </div>
                        )}
                        <button onClick={() => setSelectedIds([])} className={`p-2 rounded flex items-center gap-2 text-xs font-bold transition-all ${isDarkMode ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}>Cancel</button>
                        <button onClick={handleBulkDelete} className="p-2 rounded flex items-center gap-2 text-xs font-bold transition-all bg-rose-500 text-white hover:bg-rose-600 shadow-lg shadow-rose-500/20"><Trash2 size={16} /> Delete Selected</button>
                    </div>
                ) : (
                    <div className="flex gap-3">
                        <div className={`flex rounded-lg border overflow-hidden p-1 gap-1 ${isDarkMode ? 'border-[#27272a] bg-[#18181b]' : 'border-slate-200 bg-white'}`}>
                            <button 
                                onClick={() => setViewMode('list')} 
                                aria-label="Switch to List View"
                                className={`p-2 rounded flex items-center gap-2 text-xs font-bold transition-all ${viewMode === 'list' ? (isDarkMode ? 'bg-zinc-800 text-white shadow' : 'bg-slate-100 text-slate-900') : 'text-zinc-500 hover:text-zinc-300'}`}
                            >
                                <List size={16} /> List
                            </button>
                            <button 
                                onClick={() => setViewMode('calendar')} 
                                aria-label="Switch to Calendar View"
                                className={`p-2 rounded flex items-center gap-2 text-xs font-bold transition-all ${viewMode === 'calendar' ? (isDarkMode ? 'bg-zinc-800 text-white shadow' : 'bg-slate-100 text-slate-900') : 'text-zinc-500 hover:text-zinc-300'}`}
                            >
                                <CalendarIcon size={16} /> Calendar
                            </button>
                        </div>
                        <div className="relative">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                            <input 
                                id="journal-search-input"
                                name="search"
                                aria-label="Search pair, tag or asset"
                                placeholder="Search pair, tag or asset..." 
                                value={searchTerm} 
                                onChange={(e) => setSearchTerm(e.target.value)} 
                                className={`pl-10 pr-4 py-2 rounded-lg border text-sm outline-none w-64 ${isDarkMode ? 'bg-[#18181b] border-[#27272a] focus:border-blue-500' : 'bg-white border-slate-200'}`} 
                            />
                        </div>
                        <div className="relative">
                            <button
                                onClick={() => setShowDateFilter(!showDateFilter)}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all ${dateRange ? 'border-indigo-500 bg-indigo-500/10 text-indigo-500' : isDarkMode ? 'border-[#27272a] hover:border-[#3a3a3e]' : 'border-slate-200 hover:border-slate-300'}`}
                            >
                                <CalendarIcon size={16} />
                                <span className="hidden sm:inline">
                                    {dateRange ? `${dateRange.start} - ${dateRange.end}` : 'Date Range'}
                                </span>
                                {dateRange && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setDateRange(null); }}
                                        className="ml-1 p-0.5 rounded hover:bg-indigo-500/20"
                                        aria-label="Clear date range"
                                    >
                                        <X size={12} />
                                    </button>
                                )}
                            </button>
                            {showDateFilter && (
                                <div className={`absolute right-0 top-full mt-2 p-4 rounded-xl border shadow-xl z-50 min-w-[320px] ${isDarkMode ? 'bg-[#18181b] border-[#27272a]' : 'bg-white border-slate-200'}`}>
                                    <p className="text-xs font-bold mb-3 uppercase tracking-wider opacity-60">Quick Select</p>
                                    <div className="flex flex-wrap gap-2 mb-4">
                                        {quickRanges.map((range) => (
                                            <button
                                                key={range.label}
                                                onClick={() => { applyQuickRange(range.days); setShowDateFilter(false); }}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${range.days === -99 ? (!dateRange ? 'bg-indigo-500 text-white' : isDarkMode ? 'bg-zinc-800 hover:bg-zinc-700' : 'bg-slate-100 hover:bg-slate-200') : isDarkMode ? 'bg-zinc-800 hover:bg-zinc-700' : 'bg-slate-100 hover:bg-slate-200'}`}
                                                >
                                                    {range.label}
                                            </button>
                                        ))}
                                    </div>
                                    <p className="text-xs font-bold mb-3 uppercase tracking-wider opacity-60">Custom Range</p>
                                    <div className="space-y-3">
                                        <div className="flex flex-wrap gap-2">
                                            {[
                                                { label: 'Last 7', days: 7 },
                                                { label: 'Last 30', days: 30 },
                                                { label: 'This Month', days: -1 },
                                                { label: 'Last Month', days: -2 },
                                                { label: 'Clear', days: -99 },
                                            ].map((preset) => (
                                                <button
                                                    key={preset.label}
                                                    onClick={() => {
                                                        if (preset.days === -99) {
                                                            setDraftDateRange(null);
                                                            return;
                                                        }
                                                        setDraftDateRange(getRangeForDays(preset.days));
                                                    }}
                                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${isDarkMode ? 'bg-zinc-800 hover:bg-zinc-700' : 'bg-slate-100 hover:bg-slate-200'}`}
                                                >
                                                    {preset.label}
                                                </button>
                                            ))}
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold uppercase tracking-wider opacity-50 block mb-1">Start Date</label>
                                            <input
                                                type="date"
                                                value={draftDateRange?.start || ''}
                                                max={draftDateRange?.end || undefined}
                                                onChange={(e) => setDraftDateRange(prev => ({ start: e.target.value, end: prev?.end || e.target.value }))}
                                                className={`w-full px-3 py-2 rounded-lg border text-sm ${isDarkMode ? 'bg-[#09090b] border-[#27272a]' : 'bg-white border-slate-200'}`}
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold uppercase tracking-wider opacity-50 block mb-1">End Date</label>
                                            <input
                                                type="date"
                                                value={draftDateRange?.end || ''}
                                                min={draftDateRange?.start || undefined}
                                                onChange={(e) => setDraftDateRange(prev => ({ start: prev?.start || e.target.value, end: e.target.value }))}
                                                className={`w-full px-3 py-2 rounded-lg border text-sm ${isDarkMode ? 'bg-[#09090b] border-[#27272a]' : 'bg-white border-slate-200'}`}
                                            />
                                        </div>
                                        <div className="flex gap-2 pt-1">
                                            <button
                                                onClick={() => {
                                                    setDraftDateRange(dateRange ?? getCurrentMonthRange());
                                                }}
                                                className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${isDarkMode ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                                            >
                                                Reset
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setDateRange(draftDateRange);
                                                    setShowDateFilter(false);
                                                }}
                                                disabled={!draftDateRange?.start || !draftDateRange?.end}
                                                className="flex-1 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                Apply Range
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
                {dateRange && (
                    <div className="mb-4 flex items-center gap-2">
                        <span className="text-xs font-medium opacity-60">Showing {filteredTrades.length} of {trades.length} trades</span>
                        <span className="text-xs opacity-40">|</span>
                        <span className="text-xs font-medium text-indigo-500">{dateRange.start} to {dateRange.end}</span>
                    </div>
                )}
            </header>
            
            <div className={`flex-1 rounded-t-2xl border-t border-l border-r overflow-hidden flex flex-col ${isDarkMode ? 'bg-[#18181b] border-[#27272a]' : 'bg-white border-slate-200 shadow-md'}`}>
                {viewMode === 'calendar' ? (
                    <CalendarView isDarkMode={isDarkMode} trades={trades} userProfile={userProfile} />
                ) : (
                    <>
                        <div className={`grid grid-cols-[40px_1.5fr_1fr_1fr_1.2fr_1.2fr_1fr_1.5fr_0.8fr_1.2fr_40px] px-6 py-4 border-b text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'border-[#27272a] text-zinc-500' : 'border-slate-100 text-slate-400'}`}>
                            <div className="col-span-1 flex items-center justify-center">
                                <button onClick={handleSelectAll} className="opacity-50 hover:opacity-100">
                                    {selectedIds.length > 0 && selectedIds.length === filteredTrades.length ? <CheckSquare size={16} /> : <Square size={16} />}
                                </button>
                            </div>
                            <div className="col-span-1 pl-2">Date/Time</div>
                            <div className="col-span-1">Pair</div>
                            <div className="col-span-1">Type</div>
                            <div className="col-span-1">Direction</div>
                            <div className="col-span-1">Session</div>
                            <div className="col-span-1">Duration</div>
                            <div className="col-span-1">Strategy</div>
                            <div className="col-span-1">Rating</div>
                            <div className="col-span-1 text-right">PnL / Result</div>
                            <div className="col-span-1"></div>
                        </div>
                        <div className="overflow-y-auto custom-scrollbar flex-1 px-4">
                            {isLoading ? (
                                <JournalSkeleton isDarkMode={isDarkMode} />
                            ) : groupedTrades.length === 0 ? (
                                <EmptyState
                                    isDarkMode={isDarkMode}
                                    type="trades"
                                    title={searchTerm || dateRange ? "No Trades Match Your Filter" : "Your Journal is Empty"}
                                    description={searchTerm || dateRange ? "Try adjusting your search or date range to find trades." : "Start logging your trades to track your trading performance and build your trading journal."}
                                    action={!searchTerm && !dateRange ? {
                                        label: "Log Your First Trade",
                                        onClick: () => {/* Navigate to log trade - handled by parent */}
                                    } : undefined}
                                />
                            ) : (
                                groupedTrades.map(group => {
                                    if (group.type === 'pending') {
                                        const trade = group.trades[0];
                                        return (
                                            <div key={group.id} className={`grid grid-cols-[40px_1.5fr_1fr_1fr_1.2fr_1.2fr_1fr_1.5fr_0.8fr_1.2fr_40px] px-2 py-4 border-b items-center transition-all rounded-xl opacity-60 border-dashed ${isDarkMode ? 'border-indigo-500/20 bg-indigo-500/5' : 'border-indigo-200 bg-indigo-50/30'}`}>
                                                <div className="col-span-1 flex items-center justify-center">
                                                    <RefreshCw size={14} className="text-indigo-500 animate-spin" />
                                                </div>
                                                <div className="col-span-1 pl-2">
                                                    <p className="font-bold text-sm">{trade.date}</p>
                                                    <p className="text-xs opacity-50">{trade.time}</p>
                                                </div>
                                                <div className="col-span-1 font-bold">{trade.pair}</div>
                                                <div className="col-span-1 text-xs opacity-70">{trade.assetType}</div>
                                                <div className="col-span-1">
                                                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold ${trade.direction === 'Long' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                                                        {trade.direction === 'Long' ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {trade.direction}
                                                    </span>
                                                </div>
                                                <div className="col-span-1 text-xs opacity-80">{trade.session}</div>
                                                <div className="col-span-1 text-xs opacity-50">---</div>
                                                <div className="col-span-1 flex flex-wrap gap-1">
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-indigo-500/30 text-indigo-500 animate-pulse">Syncing...</span>
                                                </div>
                                                <div className="col-span-1">
                                                    <ReadOnlyStarRating rating={trade.rating || 0} isDarkMode={isDarkMode} />
                                                </div>
                                                <div className="col-span-1 text-right">
                                                    <p className={`font-mono font-bold ${safePnL(trade.pnl) > 0 ? 'text-emerald-500' : safePnL(trade.pnl) < 0 ? 'text-rose-500' : ''}`}>
                                                        {safePnL(trade.pnl) > 0 ? '+' : safePnL(trade.pnl) < 0 ? '-' : ''}{userProfile.currencySymbol}{Math.abs(safePnL(trade.pnl)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </p>
                                                </div>
                                                <div className="col-span-1"></div>
                                            </div>
                                        );
                                    }

                                    if (group.type === 'standalone') {
                                        return renderTradeRow(group.trades[0], false, false, false, group.id);
                                    }

                                    const isExpanded = expandedSetupIds.includes(group.setupId!);
                                    const totalPnL = group.trades.reduce((acc, t) => acc + safePnL(t.pnl), 0);
                                    const tradeIds = group.trades.map(t => t.id);
                                    const allSelected = tradeIds.every(id => selectedIds.includes(id));

                                    return (
                                        <div key={group.id} className="mt-1 border-b dark:border-zinc-800/50 pb-1">
                                            <div className={`grid grid-cols-[40px_1.5fr_1fr_1fr_1.2fr_1.2fr_1fr_1.5fr_0.8fr_1.2fr_40px] px-2 py-4 items-center transition-all rounded-xl bg-violet-500/5 border-2 ${isExpanded ? 'border-violet-500/30' : 'border-transparent'}`}>
                                                <div className="col-span-1 flex items-center justify-center">
                                                    <button onClick={() => handleSelectSetup(group.setupId!, tradeIds)} className={`${allSelected ? 'text-indigo-500' : 'text-zinc-500 hover:text-zinc-300'}`}>
                                                        {allSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                                                    </button>
                                                </div>
                                                <div className="col-span-1 pl-2 cursor-pointer flex flex-col justify-center" onClick={() => toggleSetupExpand(group.setupId!)}>
                                                    <p className="font-bold text-sm">{group.date}</p>
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-violet-500 leading-none mt-1 truncate">
                                                        {group.setupName || 'Linked Setup'}
                                                    </p>
                                                    <p className="text-[9px] opacity-40 leading-none mt-1">
                                                        {group.trades.length} trade{group.trades.length === 1 ? '' : 's'}
                                                    </p>
                                                </div>
                                                <div className="col-span-1 font-bold text-sm">{group.trades[0].pair}</div>
                                                <div className="col-span-1 text-xs opacity-70">{group.trades[0].assetType}</div>
                                                <div className="col-span-1">
                                                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold ${group.trades[0].direction === 'Long' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                                                        {group.trades[0].direction === 'Long' ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {group.trades[0].direction}
                                                    </span>
                                                </div>
                                                <div className="col-span-1 text-xs opacity-80">{group.trades[0].session}</div>
                                                <div className="col-span-1 text-xs opacity-50">---</div>
        <div className="col-span-1 flex flex-wrap gap-1">
          {(group.trades[0].tags || []).slice(0, 1).map((tag, i) => (
            <span key={i} className={`text-[9px] px-1.5 py-0.5 rounded border ${isDarkMode ? 'border-zinc-700 bg-zinc-800' : 'border-slate-200 bg-slate-100'}`}>{tag}</span>
          ))}
        </div>
                                                <div className="col-span-1">
                                                    <ReadOnlyStarRating rating={group.trades[0].rating || 0} isDarkMode={isDarkMode} />
                                                </div>
                                                <div className="col-span-1 text-right pr-2">
                                                    <p className={`font-mono font-black text-sm ${totalPnL >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                        {totalPnL >= 0 ? '+' : ''}{userProfile.currencySymbol}{totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </p>
                                                    <p className="text-[9px] font-black uppercase tracking-widest opacity-40">Cluster P&L</p>
                                                </div>
                                                <div className="col-span-1 flex justify-center gap-2">
                                                    <button 
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (window.confirm('Break this cluster? Individual trades will be kept but unlinked.')) {
                                                                handleBreakCluster(group.setupId!);
                                                            }
                                                        }}
                                                        className="p-1.5 rounded-full hover:bg-rose-500/10 text-rose-500 transition-all opacity-0 group-hover:opacity-100"
                                                        title="Break Cluster"
                                                    >
                                                        <Unlink size={16} />
                                                    </button>
                                                    <button onClick={() => toggleSetupExpand(group.setupId!)} className={`p-1.5 rounded-full transition-all ${isExpanded ? 'rotate-180 bg-violet-500 text-white' : 'hover:bg-violet-500/20 text-violet-500'}`}>
                                                        <ChevronDown size={18} />
                                                    </button>
                                                </div>
                                            </div>
                                            {isExpanded && (
                                                <div className="space-y-0 py-0.5">
                                                    {group.trades.map((trade, idx) => renderTradeRow(trade, true, idx === 0, idx === group.trades.length - 1, `${group.id}-trade-${trade.id}-${idx}`))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Link Setup Modal */}
            {isLinkModalOpen && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center p-6">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsLinkModalOpen(false)} />
                    <div className={`relative w-full max-w-md p-8 rounded-[32px] border shadow-2xl ${isDarkMode ? 'bg-[#0d1117] border-zinc-800' : 'bg-white border-slate-200'}`}>
                        <div className="flex items-center gap-3 mb-6">
                            <div className="p-2.5 rounded-2xl bg-violet-500/10 text-violet-500">
                                <Link size={24} />
                            </div>
                            <h3 className="text-2xl font-black tracking-tight">Link Trades</h3>
                        </div>
                        <p className={`text-sm mb-8 leading-relaxed ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
                            These {selectedIds.length} trades will be linked together into a strategic cluster in your journal.
                        </p>
                        <div className="space-y-4 mb-8">
                            <div>
                                <label className="text-[10px] font-black uppercase tracking-widest opacity-50 block mb-2">
                                    Setup Name
                                </label>
                                <input
                                    type="text"
                                    value={draftSetupName}
                                    onChange={(e) => setDraftSetupName(e.target.value)}
                                    placeholder={selectedSetupSummary?.setupName || 'EURUSD 3-Trade Setup'}
                                    maxLength={80}
                                    className={`w-full px-4 py-3 rounded-2xl border text-sm outline-none ${isDarkMode ? 'bg-[#09090b] border-[#27272a] text-zinc-100 focus:border-violet-500' : 'bg-slate-50 border-slate-200 text-slate-900 focus:border-violet-500'}`}
                                />
                                <p className={`mt-2 text-[11px] ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>
                                    A readable name makes the setup easier to find later in both Journal and Desktop Bridge.
                                </p>
                            </div>
                            {selectedSetupSummary?.mixedSetupState && (
                                <div className="p-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-100 text-sm leading-relaxed">
                                    Some selected trades are already linked to different setups. Linking will replace those existing links with this new setup name.
                                </div>
                            )}
                            {selectedSetupSummary?.hasExistingSetup && !selectedSetupSummary.mixedSetupState && (
                                <div className="p-4 rounded-2xl border border-violet-500/20 bg-violet-500/10 text-violet-100 text-sm leading-relaxed">
                                    These trades are already linked together. Linking again will create a fresh setup cluster.
                                </div>
                            )}
                        </div>
                        <div className="flex gap-3">
                            <button 
                                onClick={() => setIsLinkModalOpen(false)}
                                className={`flex-1 py-4 rounded-2xl font-black text-sm transition-all ${isDarkMode ? 'bg-zinc-800 text-white hover:bg-zinc-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={handleLinkSelected}
                                disabled={!draftSetupName.trim() || selectedIds.length < 2}
                                className="flex-1 py-4 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-2xl font-black text-sm transition-all shadow-xl shadow-violet-500/20"
                            >
                                Link Now
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Journal;
