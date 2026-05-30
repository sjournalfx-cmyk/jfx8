import React, { useState, useEffect, useMemo } from 'react';
import {
    Download, Copy, Check, Info, AlertCircle,
    Terminal, Shield, Cpu, ArrowRight, Loader2,
    Play, Command, Code, Zap, Globe, Link, X,
    Power, ExternalLink, Activity, Clock, PlusCircle, CheckCircle2,
    Settings, LayoutDashboard, ChevronDown, Wifi, WifiOff,
    TrendingUp, TrendingDown, DollarSign, BarChart3,
    RefreshCw, Trash2, Edit3, Eye, EyeOff
} from 'lucide-react';
import { dataService } from '../services/dataService';
import { supabase } from '../lib/supabase';
import { UserProfile, Trade, EASession, EADeal, EAPosition } from '../types';
import OpenPositions from './OpenPositions';
import BrokerConnect from './BrokerConnect';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { getSASTDateTime } from '../lib/timeUtils';
import { normalizeTrade } from '../lib/trade-normalization';

interface BridgeProps {
    isDarkMode: boolean;
    userProfile: UserProfile;
    onUpdateProfile: (profile: UserProfile) => Promise<void>;
    eaSession?: EASession | null;
    onTradeAdded?: (trade: Trade) => void;
    onEditTrade?: (trade: Trade) => void;
    onAddOffline?: (trade: Trade) => void;
    trades: Trade[];
    userId: string;
}

const Bridge: React.FC<BridgeProps> = ({ isDarkMode, userProfile, onUpdateProfile, eaSession, onTradeAdded, onEditTrade, onAddOffline, trades, userId }) => {
    const [isInternalConnected, setIsInternalConnected] = useState(userProfile.eaConnected);
    const [syncKey, setSyncKey] = useState(userProfile.syncKey || '');
    const [connectionMode, setConnectionMode] = useState<'bridge' | 'broker' | null>(null);
    
    // Persistent cache for bridge data
    const [liveData, setLiveData] = useLocalStorage<any>(`jfx_bridge_live_data_${userId}`, eaSession?.data || null);
    const [cachedHeartbeat, setCachedHeartbeat] = useLocalStorage<string | null>(`jfx_bridge_heartbeat_${userId}`, eaSession?.last_updated || null);
    const [lastHeartbeat, setLastHeartbeat] = useState<Date | null>(() => {
        if (eaSession?.last_updated) return new Date(eaSession.last_updated);
        if (cachedHeartbeat) return new Date(cachedHeartbeat);
        return null;
    });
    const [syncLog, setSyncLog] = useLocalStorage<{ time: string; message: string; type: 'success' | 'info' | 'error' }[]>(`jfx_bridge_log_${userId}`, []);

    // Sync internal connection state with profile
    useEffect(() => {
        setIsInternalConnected(userProfile.eaConnected);
    }, [userProfile.eaConnected]);

    // Update live data from prop
    useEffect(() => {
        if (eaSession?.data) {
            // Only update main trading data if it's a valid data heartbeat
            if (eaSession.data.isHeartbeat !== false) {
                setLiveData(eaSession.data);
            }
            
            if (eaSession.last_updated) {
                const date = new Date(eaSession.last_updated);
                setLastHeartbeat(date);
                setCachedHeartbeat(eaSession.last_updated);
            }

            // Only log and update heartbeats if it's a real sync or explicit heartbeat
            if (eaSession.data.isHeartbeat !== false) {
                const isHeartbeat = eaSession.data.isHeartbeat;
                const tradeCount = eaSession.data.trades?.length || 0;
                const msg = isHeartbeat ? 'Heartbeat received' : `Synced ${tradeCount} trades from terminal`;

                setSyncLog(prev => [
                    { time: new Date().toISOString(), message: msg, type: 'success' } as const,
                    ...prev
                ].slice(0, 10));
            } else {
                // If it's an explicit offline signal, log it
                setSyncLog(prev => [
                    { time: new Date().toISOString(), message: 'Bridge manually stopped', type: 'info' } as const,
                    ...prev
                ].slice(0, 10));
            }
        }
    }, [eaSession]);

    if (connectionMode === 'broker') {
        return (
            <>
                <div className="relative mb-6 flex items-center gap-3">
                    <button
                        onClick={() => setConnectionMode(null)}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-white/10 text-zinc-400 hover:text-white hover:border-white/20 transition-all flex items-center gap-1.5"
                    >
                        <ArrowRight size={12} className="rotate-180" />
                        Back to methods
                    </button>
                </div>
                <BrokerConnect
                    isDarkMode={isDarkMode}
                    userProfile={userProfile}
                    onUpdateProfile={onUpdateProfile}
                    embedded
                />
            </>
        );
    }

    if (!connectionMode) {
        return <MethodChoice onSelect={setConnectionMode} isDarkMode={isDarkMode} />;
    }

    if (isInternalConnected) {
        return (
            <BridgeMonitor
                isDarkMode={isDarkMode}
                userProfile={userProfile}
                liveData={liveData}
                lastHeartbeat={lastHeartbeat}
                isHeartbeat={eaSession?.data?.isHeartbeat !== false}
                syncKey={syncKey}
                syncLog={syncLog}
                onDisconnect={async () => {
                    const updated = { ...userProfile, eaConnected: false };
                    await onUpdateProfile(updated);
                    setIsInternalConnected(false);
                }}
                onTradeAdded={onTradeAdded}
                onEditTrade={onEditTrade}
                onAddOffline={onAddOffline}
                trades={trades}
                userId={userId}
            />
        );
    }

    return (
        <BridgeWizard
            isDarkMode={isDarkMode}
            userProfile={userProfile}
            onUpdateProfile={onUpdateProfile}
            onBack={() => setConnectionMode(null)}
            onComplete={async (key) => {
                const updated = { ...userProfile, syncKey: key, eaConnected: true };
                await onUpdateProfile(updated);
                setSyncKey(key);
                setIsInternalConnected(true);
            }}
        />
    );
};

/* --- SUB-COMPONENT: METHOD CHOICE SCREEN --- */
interface MethodChoiceProps {
    onSelect: (mode: 'bridge' | 'broker') => void;
    isDarkMode: boolean;
}

const MethodChoice: React.FC<MethodChoiceProps> = ({ onSelect, isDarkMode }) => {
    const options = [
        {
            id: 'bridge' as const,
            title: 'Desktop Bridge',
            subtitle: 'EA Terminal Bridge',
            icon: (
                <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                    <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01" strokeWidth="2" />
                    <path d="M4 11h16" />
                    <path d="M4 14h16" />
                </svg>
            ),
            features: [
                'Windows EXE bridge client',
                'Auto-sync via Supabase Realtime',
                'Full monitor dashboard',
                'One-click setup'
            ],
            accent: '#FF4F01',
            gradient: 'from-[#FF4F01]/20 via-transparent to-transparent',
            description: 'Install the JournalFX Bridge application on your Windows desktop for automated, real-time trade synchronization via the EA.'
        },
        {
            id: 'broker' as const,
            title: 'Broker Direct',
            subtitle: 'MT5 API Connection',
            icon: (
                <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    <path d="M5 5a18.8 18.8 0 0 1 14 0" />
                    <path d="M5 19a18.8 18.8 0 0 1 14 0" />
                </svg>
            ),
            features: [
                'Direct MT5 terminal connection',
                'Python/MetaTrader5 backend',
                'Open & close positions',
                'Manual trade sync'
            ],
            accent: '#22C55E',
            gradient: 'from-[#22C55E]/20 via-transparent to-transparent',
            description: 'Connect directly to your MetaTrader 5 terminal using the MT5 API. Requires Python and the MetaTrader5 library installed.'
        }
    ];

    return (
        <div className="w-full h-full overflow-y-auto custom-scrollbar bg-black">
            <div className="max-w-5xl w-full mx-auto pt-12 pb-8 px-8">
                {/* Header */}
                <div className="mb-12 text-center">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/10 bg-white/5 text-zinc-400 text-xs font-medium mb-4 tracking-wider uppercase">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#FF4F01] animate-pulse" />
                        Connection Setup
                    </div>
                    <h1 className="text-4xl font-black tracking-tight text-white mb-3">
                        Choose Your Connection
                    </h1>
                    <p className="text-zinc-500 text-sm leading-relaxed max-w-2xl mx-auto whitespace-normal break-normal">
                        Select how you want to connect your trading terminal to JournalFX. 
                        You can switch between methods at any time.
                    </p>
                </div>

                {/* Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {options.map((opt, idx) => (
                        <button
                            key={opt.id}
                            onClick={() => onSelect(opt.id)}
                            style={{
                                animationDelay: `${idx * 150}ms`,
                                animationFillMode: 'both'
                            } as React.CSSProperties}
                            className={`group relative text-left w-full rounded-3xl border bg-black/60 backdrop-blur-xl p-8 transition-all duration-500 animate-in fade-in slide-in-from-bottom-4 ${
                                opt.id === 'bridge'
                                    ? 'border-white/10 hover:border-[#FF4F01]/40'
                                    : 'border-white/10 hover:border-[#22C55E]/40'
                            }`}
                        >
                            {/* Content */}
                            <div className="relative z-10">
                                {/* Icon */}
                                <div
                                    className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6"
                                    style={{
                                        backgroundColor: `${opt.accent}15`,
                                        color: opt.accent,
                                        boxShadow: `0 0 30px -10px ${opt.accent}40`
                                    }}
                                >
                                    {opt.icon}
                                </div>

                                {/* Title */}
                                <h2 className="text-2xl font-black tracking-tight text-white mb-1">
                                    {opt.title}
                                </h2>
                                <p className="text-xs font-medium uppercase tracking-widest mb-4" style={{ color: opt.accent }}>
                                    {opt.subtitle}
                                </p>
                                <p className="text-zinc-400 text-sm leading-relaxed mb-6">
                                    {opt.description}
                                </p>

                                {/* Features */}
                                <ul className="space-y-2 mb-8">
                                    {opt.features.map((f, i) => (
                                        <li key={i} className="flex items-center gap-2.5 text-zinc-500 text-xs">
                                            <svg className="w-3.5 h-3.5 flex-shrink-0" style={{ color: opt.accent }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="20 6 9 17 4 12" />
                                            </svg>
                                            {f}
                                        </li>
                                    ))}
                                </ul>

                                {/* CTA */}
                                <div
                                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all duration-300 group-hover:gap-3"
                                    style={{ backgroundColor: opt.accent }}
                                >
                                    Get Started
                                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="5" y1="12" x2="19" y2="12" />
                                        <polyline points="12 5 19 12 12 19" />
                                    </svg>
                                </div>
                            </div>
                        </button>
                    ))}
                </div>

                {/* Bottom note */}
                <p className="text-center text-zinc-600 text-xs mt-10">
                    Both methods require an active MetaTrader 5 terminal running on your computer.
                </p>
            </div>
        </div>
    );
};

/* --- SUB-COMPONENT: BRIDGE MONITOR (The "Connected" Page) --- */
interface BridgeMonitorProps {
    isDarkMode: boolean;
    userProfile: UserProfile;
    liveData: any;
    lastHeartbeat: Date | null;
    isHeartbeat: boolean;
    syncKey: string;
    syncLog: { time: string; message: string; type: 'success' | 'info' | 'error' }[];
    onDisconnect: () => Promise<void>;
    onTradeAdded?: (trade: Trade) => void;
    onEditTrade?: (trade: Trade) => void;
    onAddOffline?: (trade: Trade) => void;
    trades: Trade[];
    userId: string;
}

const BridgeMonitor: React.FC<BridgeMonitorProps> = ({ isDarkMode, userProfile, liveData, lastHeartbeat, isHeartbeat, syncKey, syncLog, onDisconnect, onTradeAdded, onEditTrade, onAddOffline, trades, userId }) => {
    const [activeTab, setActiveTab] = useState<'monitor' | 'settings'>('monitor');
    const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
    const [autoLog, setAutoLog] = useLocalStorage('bridge_auto_log', false);
    const [activeSetup, setActiveSetup] = useState<{ id: string, name: string } | null>(null);
    const [now, setNow] = useState(new Date());
    const [isSavingTrade, setIsSavingTrade] = useState<string | null>(null); // Track specific trade being saved
    const [copied, setCopied] = useState(false);

    // Headless local proxy state
    const [localHeadlessData, setLocalHeadlessData] = useState<any>(null);
    const [localLastHeartbeat, setLocalLastHeartbeat] = useState<Date | null>(null);

    // Ã¢Å“â€¦ SUGGESTION 3: Equity Sparkline History (last 20 points)
    const [equityHistory, setEquityHistory] = useState<number[]>([]);

    // Derive unique setups for the selector
    const recentSetups = useMemo(() => {
        const setups: { id: string, pair: string, name: string }[] = [];
        const seenIds = new Set();
        [...trades].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).forEach(t => {
            if (t.setupId && !seenIds.has(t.setupId)) {
                setups.push({
                    id: t.setupId,
                    pair: t.pair,
                    name: t.setupName || `${t.pair} Cluster`
                });
                seenIds.add(t.setupId);
            }
        });
        return setups.slice(0, 8);
    }, [trades]);

    // Ã¢Å“â€¦ FIX: cardStyle defined here Ã¢â‚¬â€ used throughout the component
    // Obsidian Black theme: deeper blacks and subtle borders
    const cardStyle = 'bg-[#000000]/80 border border-white/5 backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.4)]';

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // Update 'now' every second to make the timeAgo counter live
    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    // Local Headless MT5 Polling directly from Docker instance 
    useEffect(() => {
        let isActive = true;
        const fetchHeadlessData = async () => {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2000); // Fast timeout
                
                const [accountRes, positionsRes, historyRes] = await Promise.all([
                    fetch('http://localhost:8888/api/account', { signal: controller.signal }),
                    fetch('http://localhost:8888/api/positions', { signal: controller.signal }),
                    fetch('http://localhost:8888/api/history', { signal: controller.signal })
                ]);
                clearTimeout(timeoutId);

                if (accountRes.ok && positionsRes.ok && historyRes.ok) {
                    const accData = await accountRes.json();
                    const posData = await positionsRes.json();
                    const histData = await historyRes.json();
                    
                    if (isActive) {
                        setLocalHeadlessData({
                           isHeartbeat: true,
                           account: accData.account,
                           openPositions: posData.openPositions,
                           trades: histData.trades
                        });
                        setLocalLastHeartbeat(new Date());
                    }
                }
            } catch (e) {
                // Ignore, fallback to standard stream if offline or not using local headless mode
            }
        };

        const interval = setInterval(fetchHeadlessData, 2000);
        fetchHeadlessData(); // Fire immediately
        return () => {
            isActive = false;
            clearInterval(interval);
        };
    }, []);

    // Master Display Logic (Prefer local 8888 if active, fallback to remote Supabase event push)
    const effectiveLiveData = localHeadlessData || liveData;
    const effectiveLastHeartbeat = localLastHeartbeat || lastHeartbeat;
    const effectiveIsHeartbeat = localHeadlessData ? true : isHeartbeat;

    const timeAgo = effectiveLastHeartbeat ? Math.floor((now.getTime() - effectiveLastHeartbeat.getTime()) / 1000) : null;
    const isOnline = effectiveIsHeartbeat && timeAgo !== null && timeAgo < 15; // 15s threshold for 'offline'

    // Filter "Pending" trades (from bridge but not in DB)
    // Only show "Exit" deals (entry=1 or 2) as candidates for Journal
    const incomingTrades = (effectiveLiveData?.trades || []).filter((t: EADeal) => t.entry === 1 || t.entry === 2);
    const pendingTrades = incomingTrades.filter((t: EADeal) => !trades.some(st => st.ticketId === String(t.ticket)));

    // Auto-Log Logic
    useEffect(() => {
        if (autoLog && pendingTrades.length > 0 && isSavingTrade === null) {
            const autoSave = async () => {
                for (const trade of pendingTrades) {
                    await handleAddTrade(trade);
                }
            };
            autoSave();
        }
    }, [pendingTrades, autoLog]);

    // Ã¢Å“â€¦ Capture Equity history for sparkline
    useEffect(() => {
        const currentEquity = effectiveLiveData?.account?.equity;
        if (currentEquity !== undefined && currentEquity !== null) {
            setEquityHistory(prev => {
                const next = [...prev, currentEquity];
                return next.slice(-20); // Keep last 20 points
            });
        }
    }, [effectiveLiveData?.account?.equity]);

    // Ã¢Å“â€¦ SUGGESTION 2: High-Performance Sparkline Calculation
    const sparklineData = useMemo(() => {
        if (equityHistory.length < 2) return { path: '', points: [] };
        const min = Math.min(...equityHistory);
        const max = Math.max(...equityHistory);
        const range = max - min || 1;
        const width = 140;
        const height = 40;
        const points = equityHistory.map((v, i) => ({
            x: (i / (equityHistory.length - 1)) * width,
            y: height - ((v - min) / range) * height
        }));
        const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
        return { path, points };
    }, [equityHistory]);


    const handleAddTrade = async (mt5Trade: EADeal) => {
        setIsSavingTrade(String(mt5Trade.ticket));
        try {
            // MT5 deal.profit does NOT include swap or commission. 
            // For a perfect journal, we need the Net PnL.
            const netPnL = Number((mt5Trade.profit + (mt5Trade.swap || 0) + (mt5Trade.commission || 0)).toFixed(2));

            // Validate timestamps before creating Date objects
            const tradeTimestamp = mt5Trade.time && !isNaN(mt5Trade.time) ? mt5Trade.time * 1000 : Date.now();
            const entryTimestamp = mt5Trade.entry_time && !isNaN(mt5Trade.entry_time) ? mt5Trade.entry_time * 1000 : Date.now();
            
            const tradeDate = new Date(tradeTimestamp);
            const entryDate = new Date(entryTimestamp);
            
            // Additional validation - ensure dates are valid
            if (isNaN(tradeDate.getTime()) || isNaN(entryDate.getTime())) {
                throw new Error('Invalid date values in trade data');
            }
            
            const sast = getSASTDateTime(tradeDate);
            const sastEntry = getSASTDateTime(entryDate);

            const newTrade = normalizeTrade({
                id: '', // Generated by DB
                ticketId: String(mt5Trade.ticket),
                pair: mt5Trade.symbol,
                assetType: 'Forex',
                date: sast.date,
                time: sast.fullTime, // Use full time for accuracy
                openTime: entryDate.toISOString(),
                closeTime: tradeDate.toISOString(),
                direction: mt5Trade.type === 'BUY' ? 'Long' : 'Short',
                entryPrice: mt5Trade.entry_price || mt5Trade.price,
                exitPrice: mt5Trade.price,
                stopLoss: mt5Trade.sl || 0,
                takeProfit: mt5Trade.tp || 0,
                lots: mt5Trade.volume,
                result: netPnL > 0 ? 'Win' : netPnL < 0 ? 'Loss' : 'BE',
                pnl: netPnL,
                rr: 0,
                rating: 0,
                tags: ['Others'],
                notes: `Synced from MT5. Deal #${mt5Trade.ticket} | Order #${mt5Trade.order}`,
                planAdherence: 'No Plan',
                tradingMistake: 'None',
                mindset: 'Neutral',
                setupId: activeSetup?.id
            });

            if (!autoLog && onEditTrade) {
                onEditTrade(newTrade);
                return;
            }

            try {
                const saved = await dataService.addTrade(newTrade);
                // Notify global state
                if (onTradeAdded) {
                    onTradeAdded(saved);
                }
            } catch (syncError) {
                console.warn("Sync failed, queuing offline:", syncError);
                if (onAddOffline) {
                    onAddOffline(newTrade);
                }
            }
        } catch (error) {
            console.error("Failed to process trade:", error);
        } finally {
            setIsSavingTrade(null);
        }
    };

    // Derived account values for bento cells
    const equity      = effectiveLiveData?.account?.equity   || 0;
    const balance     = effectiveLiveData?.account?.balance  || 0;
    const profit      = effectiveLiveData?.account?.profit   || 0;
    const margin      = effectiveLiveData?.account?.margin   || 0;
    const openCount   = effectiveLiveData?.openPositions?.length || 0;
    const freeMargin  = equity - margin;
    const marginLevelPct = margin > 0 ? ((equity / margin) * 100).toFixed(0) : 'âˆž';

    return (
        <div className="w-full h-full overflow-y-auto custom-scrollbar" style={{ background: `linear-gradient(135deg,#000000 0%,#000000 60%,#000000 100%)` }}>
            <div className="w-full p-4 lg:p-5 flex flex-col gap-4">

        {/* TOP NAV */}
      <div className="flex items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center relative shrink-0 overflow-hidden bg-slate-800/50">
            <img src="/mt5-logo.png" alt="MetaTrader 5" className="w-9 h-9 object-contain" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-black tracking-tight text-white">Desktop Bridge</h1>
              {localHeadlessData && (
                <span className="px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-400 text-[9px] font-black tracking-widest uppercase border border-indigo-500/20">Headless</span>
              )}
              <div className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 border ${isOnline ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                {isOnline ? `Live Â· ${timeAgo}s ago` : 'Offline'}
              </div>
            </div>
            <p className="text-[10px] text-slate-500 font-medium mt-0.5">{effectiveLiveData?.account?.server || 'MetaTrader 5 Terminal'}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
                        <div className="p-1 rounded-xl flex items-center border border-white/5 bg-slate-900/40 backdrop-blur-md">
                            <button onClick={() => setActiveTab('monitor')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 ${activeTab === 'monitor' ? 'bg-amber-500 text-slate-900 shadow-lg shadow-amber-500/20' : 'text-slate-500 hover:text-slate-300'}`}>
                                <LayoutDashboard size={12} strokeWidth={2.5} /> Monitor
                            </button>
                            <button onClick={() => setActiveTab('settings')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 ${activeTab === 'settings' ? 'bg-amber-500 text-slate-900 shadow-lg shadow-amber-500/20' : 'text-slate-500 hover:text-slate-300'}`}>
                                <Settings size={12} strokeWidth={2.5} /> Settings
                            </button>
                        </div>
                        <button onClick={onDisconnect} className="h-10 px-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] font-black uppercase tracking-widest hover:bg-rose-500 hover:text-white transition-all flex items-center gap-2">
                            <Power size={12} strokeWidth={3} /> Disconnect
                        </button>
                    </div>
                </div>

                {activeTab === 'monitor' ? (
                    <div className="grid grid-cols-12 gap-4">

                        {/* Ã¢â€¢ÂÃ¢â€¢Â ROW 1 Ã¢â‚¬â€ Hero Metric Bento Cells Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â Ã¢â€¢Â */}

                        {/* Equity Ã¢â‚¬â€ wide hero cell */}
                        <div className={`col-span-12 lg:col-span-5 ${cardStyle} rounded-3xl p-6 relative overflow-hidden`}>
                            <div className="absolute top-0 right-0 w-56 h-56 bg-amber-500/5 blur-[70px] -mr-28 -mt-28 rounded-full pointer-events-none" />
                            

                            {/* Ã¢Å“â€¦ SUGGESTION 1: Pulse Animated Sparkline */}
                            <div className="absolute bottom-6 right-6 opacity-40">
                                <svg width="140" height="40" viewBox="0 0 140 40" className="overflow-visible">
                                    <path 
                                        d={sparklineData.path} 
                                        fill="none" 
                                        stroke="url(#sparkline-grad)" 
                                        strokeWidth="2.5" 
                                        strokeLinecap="round" 
                                        strokeLinejoin="round" 
                                    />
                                    <defs>
                                        <linearGradient id="sparkline-grad" x1="0" y1="0" x2="1" y2="0">
                                            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.2" />
                                            <stop offset="100%" stopColor="#f59e0b" />
                                        </linearGradient>
                                    </defs>
                                    {sparklineData.points.length > 0 && (
                                        <g>
                                            <circle 
                                                cx={sparklineData.points[sparklineData.points.length - 1].x} 
                                                cy={sparklineData.points[sparklineData.points.length - 1].y} 
                                                r="4" 
                                                fill="#f59e0b" 
                                                className="animate-pulse"
                                            />
                                            <circle 
                                                cx={sparklineData.points[sparklineData.points.length - 1].x} 
                                                cy={sparklineData.points[sparklineData.points.length - 1].y} 
                                                r="8" 
                                                fill="none"
                                                stroke="#f59e0b"
                                                strokeWidth="1"
                                                className="animate-ping opacity-40"
                                            />
                                        </g>
                                    )}
                                </svg>
                            </div>

                            <div className="relative z-10">
                                <div className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-1">Portfolio Net Equity</div>
                                <div className="text-4xl font-mono font-black tracking-tighter text-white flex items-baseline gap-1 mb-3">
                                    <span className="text-amber-500 text-2xl font-sans mr-1">{userProfile.currencySymbol}</span>
                                    {equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${profit >= 0 ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]' : 'bg-rose-500 shadow-[0_0_8px_rgba(251,113,133,0.8)]'}`} />
                                    <span className={`text-sm font-mono font-black ${profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {profit >= 0 ? '+' : ''}{userProfile.currencySymbol}{profit.toLocaleString(undefined, { minimumFractionDigits: 2 })} Live P&amp;L
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Balance */}
                        <div className={`col-span-6 lg:col-span-2 ${cardStyle} rounded-3xl p-5 group transition-all duration-200`}>
                            <div className="p-2 rounded-xl bg-slate-800/70 w-fit mb-3"><DollarSign size={15} className="text-slate-400" /></div>
                            <div className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500 mb-1">Balance</div>
                            <div className="text-lg font-mono font-black text-white">{userProfile.currencySymbol}{balance.toLocaleString()}</div>
                        </div>

                        {/* Used Margin */}
                        <div className={`col-span-6 lg:col-span-2 ${cardStyle} rounded-3xl p-5 group transition-all duration-200`}>
                            <div className="p-2 rounded-xl bg-amber-500/10 w-fit mb-3"><BarChart3 size={15} className="text-amber-500" /></div>
                            <div className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500 mb-1">Used Margin</div>
                            <div className="text-lg font-mono font-black text-amber-400">{userProfile.currencySymbol}{margin.toLocaleString()}</div>
                        </div>

                        {/* Free Margin */}
                        <div className={`col-span-6 lg:col-span-2 ${cardStyle} rounded-3xl p-5 group transition-all duration-200`}>
                            <div className="p-2 rounded-xl bg-indigo-500/10 w-fit mb-3"><Activity size={15} className="text-indigo-400" /></div>
                            <div className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500 mb-1">Free Margin</div>
                            <div className="text-lg font-mono font-black text-indigo-400">{userProfile.currencySymbol}{freeMargin.toLocaleString()}</div>
                        </div>

                        {/* Open Trades + Leverage stacked */}
                        <div className="col-span-6 lg:col-span-1 flex flex-col gap-4">
                            <div className={`${cardStyle} rounded-3xl p-4 flex flex-col items-center justify-center text-center group transition-all duration-200 flex-1`}>
                                <div className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500 mb-1">Active</div>
                                <div className="text-2xl font-mono font-black text-indigo-400">{openCount}</div>
                                <div className="text-[8px] font-black text-slate-600 uppercase tracking-wider mt-0.5">Trades</div>
                            </div>
                            <div className={`${cardStyle} rounded-3xl p-4 flex flex-col items-center justify-center text-center group transition-all duration-200 flex-1`}>
                                <div className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-500 mb-1">Leverage</div>
                                <div className="text-lg font-mono font-black text-violet-400">1:{effectiveLiveData?.account?.leverage || 'â€”'}</div>
                            </div>
                        </div>

                        {/* Ã¢â€¢ÂÃ¢â€¢Â ROW 2 Ã¢â‚¬â€ Main Dashboard Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â */}

                        {/* Live Positions Ã¢â‚¬â€ large bento cell */}
                        <div className={`col-span-12 lg:col-span-8 ${cardStyle} rounded-3xl p-6 flex flex-col`} style={{ minHeight: '340px' }}>
                            <div className="flex items-center justify-between mb-5">
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                                        <Activity size={17} className="text-emerald-400" />
                                    </div>
                                    <div>
                                        <h3 className="font-black text-sm text-white uppercase tracking-wider leading-none">Terminal Pipeline</h3>
                                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">Real-time Â· MetaTrader 5</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-[9px] font-black uppercase tracking-widest text-slate-500">MT5 CORE</div>
                                    {isOnline && <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse" />}
                                </div>
                            </div>
                            <div className="flex-1 -mx-2 overflow-auto custom-scrollbar">
                                <OpenPositions
                                    positions={(effectiveLiveData?.openPositions || []).map((p: any) => ({
                                        ...p,
                                        lots: p.volume,
                                        openTime: p.time ? new Date(p.time * 1000).toISOString() : '',
                                        openPrice: p.open_price,
                                        currentPrice: p.current_price,
                                        profit: p.profit
                                    }))}
                                    isDarkMode={isDarkMode}
                                    currencySymbol={userProfile.currencySymbol}
                                    lastUpdated={lastHeartbeat?.toISOString()}
                                />
                            </div>
                        </div>

                        {/* Right column Ã¢â‚¬â€ Setup Linker + Journal Queue */}
                        <div className="col-span-12 lg:col-span-4 flex flex-col gap-4">

                            {/* Setup Intelligence */}
                            <div className={`${cardStyle} rounded-3xl p-5`}>
                                <div className="flex items-center gap-3 mb-4">
                                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${activeSetup ? 'bg-amber-500 text-slate-900' : 'bg-slate-800 text-slate-500'}`}>
                                        <Link size={17} strokeWidth={2.5} />
                                    </div>
                                    <div>
                                        <h3 className="text-[11px] font-black uppercase tracking-widest text-white leading-none">Setup Linker</h3>
                                        <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">Cluster Engine</p>
                                    </div>
                                </div>
                                <div className="relative">
                                    <select
                                        id="setup-linker"
                                        className="w-full pl-4 pr-9 py-3 rounded-2xl border border-slate-800 text-[10px] font-black uppercase tracking-wider outline-none appearance-none cursor-pointer transition-all bg-slate-900 text-slate-300 focus:border-amber-500/50"
                                        value={activeSetup?.id || ''}
                                        onChange={(e) => {
                                            const id = e.target.value;
                                            if (!id) setActiveSetup(null);
                                            else {
                                                const s = recentSetups.find(rs => rs.id === id);
                                                if (s) setActiveSetup({ id: s.id, name: s.name || `Setup Cluster (${s.pair})` });
                                            }
                                        }}
                                    >
                                        <option value="">Standalone Mode</option>
                                        {recentSetups.map(s => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                    </select>
                                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                                </div>
                                {recentSetups.length === 0 && (
                                    <p className="mt-3 text-[10px] font-medium text-slate-500 leading-relaxed">
                                        Link trades in Trade History to create reusable setup clusters here.
                                    </p>
                                )}
                                {activeSetup && (
                                    <button onClick={() => setActiveSetup(null)} className="mt-3 w-full py-2.5 rounded-2xl bg-rose-500/10 text-rose-400 text-[10px] font-black uppercase tracking-widest hover:bg-rose-500 hover:text-white transition-all flex items-center justify-center gap-2 border border-rose-500/20">
                                        <X size={12} strokeWidth={3} /> Clear Link
                                    </button>
                                )}
                            </div>

                            {/* Journal Queue */}
                            <div className={`${cardStyle} rounded-3xl p-5 flex-1 flex flex-col`} style={{ minHeight: '220px' }}>
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-14 h-14 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                                            <Download size={15} strokeWidth={2.5} />
                                        </div>
                                        <div>
                                            <h3 className="font-black text-[11px] uppercase tracking-widest text-white leading-none">Journal Queue</h3>
                                            {pendingTrades.length > 0 && (
                                                <p className="text-[9px] text-amber-400 font-bold mt-0.5">{pendingTrades.length} pending</p>
                                            )}
                                        </div>
                                    </div>
                                    {pendingTrades.length > 0 && (
                                        <button
                                            onClick={async () => {
                                                setIsSavingTrade('bulk_all');
                                                try { for (const t of pendingTrades) await handleAddTrade(t); }
                                                finally { setIsSavingTrade(null); }
                                            }}
                                            disabled={isSavingTrade !== null}
                                            className="px-3 py-1.5 rounded-lg bg-indigo-500 text-white text-[9px] font-black uppercase tracking-widest hover:bg-indigo-600 transition-all disabled:opacity-50 shadow-lg shadow-indigo-500/20"
                                        >
                                            {isSavingTrade === 'bulk_all' ? '...' : 'Sync All'}
                                        </button>
                                    )}
                                </div>

                                <div className="space-y-2 overflow-y-auto custom-scrollbar flex-1 pr-1 -mr-1">
                                    {pendingTrades.length > 0 ? (
                                        pendingTrades.map((trade: any) => {
                                            const pipSize = trade.symbol?.includes('JPY') ? 0.01 : 0.0001;
                                            const pipMov = trade.entry_price ? (trade.type === 'BUY' ? trade.price - trade.entry_price : trade.entry_price - trade.price) / pipSize : 0;
                                            return (
                                                <div key={trade.ticket} className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800/80 hover:border-amber-500/30 transition-all group">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-black text-xs text-white">{trade.symbol}</span>
                                                            <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider ${trade.type === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>{trade.type}</span>
                                                        </div>
                                                        <span className={`text-xs font-mono font-black ${trade.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{trade.profit >= 0 ? '+' : ''}{trade.profit?.toFixed(2)}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[9px] font-mono text-slate-500">#{trade.ticket} Â· {trade.volume}L Â· {pipMov >= 0 ? '+' : ''}{pipMov.toFixed(1)}p</span>
                                                        {trades.some(st => st.ticketId === String(trade.ticket)) ? (
                                                            <div className="flex items-center gap-1 text-[8px] font-black text-emerald-500 uppercase tracking-widest"><CheckCircle2 size={10} strokeWidth={3} /> Logged</div>
                                                        ) : (
                                                            <button onClick={() => handleAddTrade(trade)} disabled={isSavingTrade !== null} className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-[9px] font-black uppercase tracking-widest hover:bg-amber-500 hover:text-slate-900 transition-all border border-slate-700 disabled:opacity-50">
                                                                {isSavingTrade === String(trade.ticket) ? '...' : 'Log'}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })
                                    ) : (
                                        <div className="flex flex-col items-center justify-center py-10 text-center">
                                            <div className="w-10 h-10 rounded-full bg-slate-800/60 flex items-center justify-center mb-3">
                                                <RefreshCw size={18} className="text-slate-600" />
                                            </div>
                                            <div className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-600">Awaiting Activity</div>
                                            <p className="text-[9px] text-slate-700 font-bold mt-1 uppercase tracking-wider">Bridge active. Listening...</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Ã¢â€¢ÂÃ¢â€¢Â ROW 3 Ã¢â‚¬â€ Telemetry + Margin Level Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â */}

                    </div>
                ) : (
                    /* Ã¢â€â‚¬Ã¢â€â‚¬ SETTINGS TAB Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */
                    <div className="grid grid-cols-12 gap-4">

                        {/* Connection Diagnostics */}
                        <div className={`col-span-12 ${cardStyle} rounded-3xl p-6 relative overflow-hidden`}>
                            <div className="flex flex-col md:flex-row items-start justify-between gap-6 relative z-10">
                                <div className="space-y-4 flex-1">
                                    <div>
                                        <h3 className="text-lg font-black mb-1 text-white uppercase tracking-wider">Connection Diagnostics</h3>
                                        <p className="text-sm text-slate-400 max-w-2xl whitespace-normal break-normal">Technical details about your current bridge session. Ensure the JournalFX Bridge app is running.</p>
                                    </div>
                                    <div className="flex flex-wrap gap-3">
                                        <div className="px-4 py-3 rounded-2xl bg-slate-900 border border-slate-800">
                                            <div className="text-[9px] font-black uppercase tracking-tighter text-slate-500 mb-1">Last Heartbeat</div>
                                            <div className="text-sm font-mono font-bold text-white">
                                                {effectiveLastHeartbeat ? effectiveLastHeartbeat.toLocaleTimeString() : 'Never'}
                                                <span className="ml-2 text-[10px] text-slate-500">({timeAgo !== null ? `${timeAgo}s ago` : 'â€”'})</span>
                                            </div>
                                        </div>
                                        <div className="px-4 py-3 rounded-2xl bg-slate-900 border border-slate-800">
                                            <div className="text-[9px] font-black uppercase tracking-tighter text-slate-500 mb-1">Session ID</div>
                                        <div className="text-sm font-mono font-bold text-slate-300">{(syncKey || 'real-sync-key').substring(0, 8)}...</div>
                                        </div>
                                        <div className="px-4 py-3 rounded-2xl bg-slate-900 border border-slate-800">
                                            <div className="text-[9px] font-black uppercase tracking-tighter text-slate-500 mb-1">Stream Source</div>
                                            <div className="text-sm font-mono font-bold text-indigo-400">{localHeadlessData ? 'Local :8888' : 'Supabase Cloud'}</div>
                                        </div>
                                    </div>
                                </div>
                                <div className={`hidden md:flex w-24 h-24 rounded-full border-8 items-center justify-center shrink-0 transition-colors duration-500 ${isOnline ? 'border-emerald-500/30' : 'border-rose-500/30'}`}>
                                    <Activity size={36} className={isOnline ? 'text-emerald-500 animate-pulse' : 'text-rose-500'} />
                                </div>
                            </div>
                        </div>

                        {/* Automation */}
                        <div className={`col-span-12 md:col-span-4 ${cardStyle} rounded-3xl p-6`}>
                            <h3 className="font-black mb-5 flex items-center gap-2 text-white uppercase tracking-widest text-sm"><Zap size={16} className="text-amber-500" /> Automation</h3>
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <div className="font-bold text-sm text-slate-200">Auto-Log Trades</div>
                                    <div className="text-[10px] text-slate-500 max-w-[200px] leading-tight mt-1">Automatically add closed trades without manual confirmation.</div>
                                </div>
                                <button onClick={() => setAutoLog(!autoLog)} className={`w-12 h-6 rounded-full transition-all relative shrink-0 ${autoLog ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]' : 'bg-slate-800'}`}>
                                    <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${autoLog ? 'left-7' : 'left-1'}`} />
                                </button>
                            </div>
                        </div>

                        {/* Bridge Security */}
                        <div className={`col-span-12 md:col-span-4 ${cardStyle} rounded-3xl p-6`}>
                            <h3 className="font-black mb-5 flex items-center gap-2 text-white uppercase tracking-widest text-sm"><Shield size={16} className="text-indigo-400" /> Bridge Security</h3>
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">Active Sync Key</label>
                            <div className="flex items-center gap-2">
                                <div className="flex-1 p-3 rounded-xl bg-slate-900 border border-slate-800 font-mono text-sm font-bold text-amber-500 truncate">{syncKey || 'real-sync-key'}</div>
                                <button onClick={() => handleCopy(syncKey || 'real-sync-key')} className={`p-3 rounded-xl transition-all shrink-0 ${copied ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'}`}>
                                    {copied ? <Check size={16} strokeWidth={3} /> : <Copy size={16} />}
                                </button>
                            </div>
                        </div>

                        {/* Danger Zone */}
                        <div className="col-span-12 md:col-span-4 p-6 rounded-3xl border border-rose-500/20 bg-rose-500/5">
                            <h3 className="font-black mb-3 flex items-center gap-2 text-rose-400 uppercase tracking-widest text-sm"><AlertCircle size={16} /> Danger Zone</h3>
                            <p className="text-sm text-slate-400 mb-5 leading-relaxed">Disconnecting stops all real-time streaming. You'll need the setup wizard to reconnect.</p>
                            <button onClick={onDisconnect} className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 font-black uppercase tracking-widest text-xs hover:bg-rose-500 hover:text-white transition-all">
          <Power size={16} strokeWidth={3} /> Disconnect System
        </button>
      </div>
    </div>
  )}
</div>
);
};

/* --- SUB-COMPONENT: BRIDGE WIZARD --- */
interface BridgeWizardProps {
    isDarkMode: boolean;
    onComplete: (syncKey: string) => void;
    onBack: () => void;
    userProfile: UserProfile;
    onUpdateProfile: (profile: UserProfile) => Promise<void>;
}

const BridgeWizard: React.FC<BridgeWizardProps> = ({ isDarkMode, onComplete, onBack, userProfile, onUpdateProfile }) => {
    const [step, setStep] = useState(0);
    const [syncKey, setSyncKey] = useState(userProfile.syncKey || '');
    const [connectionStatus, setConnectionStatus] = useState<'waiting' | 'success' | 'error'>('waiting');

    const bridgeSteps = useMemo(() => [
        {
            id: 0,
            title: 'Download the bridge',
            subtitle: 'Get the Windows app that connects MT5 to JournalFX.',
            icon: Download,
            panelIcon: WindowsLogoIcon,
            requirements: [
                'Windows 10 or 11',
                'Internet connection',
                'Browser downloads allowed',
            ],
            actions: [
                'Download the .exe file',
                'Save it somewhere easy to find',
                'Keep the file ready for the next step',
            ],
            note: 'No Python setup. No manual install.',
            ctaLabel: 'Download JournalFX_Bridge.exe',
        },
        {
            id: 1,
            title: 'Open and sign in',
            subtitle: 'Launch the app, then sign in with your JournalFX account.',
            icon: Play,
            requirements: [
                'JournalFX email and password',
                'MetaTrader 5 open and logged in',
                'The bridge file downloaded',
            ],
            actions: [
                'Run JournalFX_Bridge.exe',
                'Sign in to your JournalFX account',
                'Click Start Bridge in the app',
            ],
            note: 'The app prepares your sync key automatically.',
        },
        {
            id: 2,
            title: 'Wait for connection',
            subtitle: 'Keep the page open until the bridge turns active.',
            icon: Cpu,
            requirements: [
                'MT5 stays logged in',
                'Bridge app stays open',
                'This page stays open while connecting',
            ],
            actions: [
                'Watch for the status to turn green',
                'Do not close the bridge window',
                'Open the command monitor once connected',
            ],
            note: 'When the bridge connects, your trade data starts streaming automatically.',
        },
    ], []);

    const globalRequirements = [
        'Windows device',
        'JournalFX account',
        'MetaTrader 5 terminal',
        'Internet connection',
    ];

    useEffect(() => {
        if (!syncKey) {
            const newKey = `JFX-${Math.floor(1000 + Math.random() * 9000)}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
            setSyncKey(newKey);
            if (onUpdateProfile) {
                onUpdateProfile({ ...userProfile, syncKey: newKey });
            }
        }
    }, []);

    useEffect(() => {
        if (step === 2 && connectionStatus === 'waiting' && syncKey) {
            const channel = supabase
                .channel('ea_session_changes')
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'ea_sessions',
                    filter: `sync_key=eq.${syncKey}`
                }, (payload) => {
                    setConnectionStatus('success');
                })
                .subscribe();
            return () => { supabase.removeChannel(channel); };
        }
    }, [step, connectionStatus, syncKey]);

    const cardBg = isDarkMode ? 'bg-[#0f0f0f] border-zinc-800/80' : 'bg-white border-slate-200 shadow-sm';
    const textPrimary = isDarkMode ? 'text-white' : 'text-slate-900';
    const textSecondary = isDarkMode ? 'text-zinc-300' : 'text-slate-700';
    const subTextColor = isDarkMode ? 'text-zinc-500' : 'text-slate-500';
    const insetPanel = isDarkMode ? 'border-zinc-800 bg-black/30' : 'border-slate-200 bg-white';
    const activeStep = bridgeSteps[step];
    const ActiveIcon = activeStep.panelIcon ?? activeStep.icon;

    return (
        <div className="w-full h-full overflow-y-auto custom-scrollbar bg-black">
            <div className="max-w-6xl w-full mx-auto px-6 py-8 md:px-8 md:py-10">
                <div className="mb-8 md:mb-10">
                    <button
                        onClick={onBack}
                        className="mb-4 px-3 py-1.5 text-xs font-medium rounded-lg border border-white/10 text-zinc-400 hover:text-white hover:border-white/20 transition-all flex items-center gap-1.5"
                    >
                        <ArrowRight size={12} className="rotate-180" />
                        Back to methods
                    </button>
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#FF4F01]/20 bg-[#FF4F01]/8 text-[10px] font-black uppercase tracking-[0.28em] text-[#FF4F01]">
                        Desktop Bridge Setup
                    </div>
                    <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                        <div>
                            <h1 className={`text-4xl md:text-5xl font-black tracking-tight ${textPrimary}`}>Bridge onboarding</h1>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                    <aside className="lg:col-span-4 space-y-3">
                        {bridgeSteps.map((s) => {
                            const StepIcon = s.icon;
                            const isCurrent = step === s.id;
                            const isDone = step > s.id || (step === 2 && connectionStatus === 'success' && s.id < 2);
                            return (
                                <button
                                    key={s.id}
                                    onClick={() => step >= s.id && setStep(s.id)}
                                    className={`w-full text-left rounded-2xl border p-4 transition-all ${isCurrent
                                        ? 'border-[#FF4F01]/40 bg-[#FF4F01]/8'
                                        : isDone
                                            ? 'border-emerald-500/20 bg-emerald-500/6'
                                            : `${cardBg} opacity-75 hover:border-zinc-700`
                                        } ${step >= s.id ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                                >
                                    <div className="flex items-start gap-4">
                                        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${isCurrent
                                            ? 'bg-[#FF4F01] text-white'
                                            : isDone
                                                ? 'bg-emerald-500 text-white'
                                                : 'bg-black text-zinc-400'
                                            }`}>
                                            {isDone ? <Check size={16} strokeWidth={3} /> : <StepIcon size={16} />}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Step {s.id + 1}</p>
                                            <h3 className={`mt-1 text-sm font-bold ${textPrimary}`}>{s.title}</h3>
                                            <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">{s.subtitle}</p>
                                        </div>
                                    </div>
                                </button>
                            );
                        })}

                        <div className={`rounded-2xl border p-4 ${cardBg}`}>
                            <div className="flex items-center gap-2">
                                <Info size={14} className="text-[#FF4F01]" />
                                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-400">What to expect</p>
                            </div>
                            <ul className="mt-3 space-y-2 text-sm text-zinc-400">
                                <li>1. Download the app.</li>
                                <li>2. Sign in and start the bridge.</li>
                                <li>3. Wait for the connection to turn green.</li>
                            </ul>
                        </div>
                    </aside>

                    <main className="lg:col-span-8">
                        <div className={`rounded-[28px] border p-6 md:p-8 ${cardBg} min-h-[560px] flex flex-col`}>
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-[0.28em] text-zinc-500">Step {activeStep.id + 1} of 3</p>
                                    <h2 className={`mt-2 text-2xl md:text-3xl font-black tracking-tight ${textPrimary}`}>{activeStep.title}</h2>
                                    <p className={`mt-3 max-w-2xl text-sm md:text-base ${subTextColor}`}>{activeStep.subtitle}</p>
                                </div>
                                <div className="flex items-center justify-center text-[#FF4F01]">
                                    <ActiveIcon size={40} className="w-10 h-10 md:w-12 md:h-12" />
                                </div>
                            </div>

                            <div className="mt-6 grid gap-4 xl:grid-cols-2">
                                <div className={`rounded-2xl border p-5 ${insetPanel}`}>
                                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Requirements</p>
                                    <ul className={`mt-3 space-y-2 text-sm ${textSecondary}`}>
                                        {activeStep.requirements.map((item) => (
                                            <li key={item} className="flex items-start gap-3">
                                                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-500" />
                                                <span>{item}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>

                                <div className={`rounded-2xl border p-5 ${insetPanel}`}>
                                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Simple steps</p>
                                    <ol className={`mt-3 space-y-3 text-sm ${textSecondary}`}>
                                        {activeStep.actions.map((item, index) => (
                                            <li key={item} className="flex items-start gap-3">
                                                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#FF4F01] text-[10px] font-black text-white">
                                                    {index + 1}
                                                </span>
                                                <span>{item}</span>
                                            </li>
                                        ))}
                                    </ol>
                                </div>
                            </div>

                            <div className="mt-5 rounded-2xl border border-white/5 bg-white/5 p-4 md:p-5">
                                {step === 0 && (
                                    <div className="space-y-4">
                                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                            <div>
                                                <p className={`text-sm font-bold ${textPrimary}`}>Download the standalone app</p>
                                                <p className={`mt-1 text-sm ${subTextColor}`}>{bridgeSteps[0].note}</p>
                                            </div>
                                            <a
                                                href="/JournalFX_Bridge.exe"
                                                download="JournalFX_Bridge.exe"
                                                className="inline-flex items-center justify-center gap-3 rounded-2xl bg-[#FF4F01] px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-white transition-transform hover:scale-[1.01]"
                                            >
                                                <WindowsLogoIcon className="w-7 h-7 md:w-8 md:h-8" />
                                                {bridgeSteps[0].ctaLabel}
                                            </a>
                                        </div>
                                        <div className="rounded-2xl border border-[#FF4F01]/10 bg-[#FF4F01]/6 p-4">
                                            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#FF4F01]">Why this version</p>
                                            <p className={`mt-2 text-sm ${subTextColor}`}>
                                                It is a single Windows executable, so you do not need Python or any extra installer steps.
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {step === 1 && (
                                    <div className="space-y-4">
                                        <div>
                                            <p className={`text-sm font-bold ${textPrimary}`}>Open the app and start the bridge</p>
                                            <p className={`mt-1 text-sm ${subTextColor}`}>{bridgeSteps[1].note}</p>
                                        </div>
                                        <div className="grid gap-3 sm:grid-cols-3">
                                            {[
                                                'Run the app',
                                                'Sign in',
                                                'Start Bridge',
                                            ].map((item, index) => (
                                                <div key={item} className={`min-h-[92px] rounded-2xl border p-4 ${insetPanel}`}>
                                                    <div className="flex h-full items-center gap-3">
                                                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#FF4F01] text-[10px] font-black text-white">
                                                            {index + 1}
                                                        </div>
                                                        <p className={`text-sm font-bold leading-tight ${textPrimary}`}>{item}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {step === 2 && (
                                    <div className="space-y-4">
                                        {connectionStatus === 'waiting' ? (
                                            <>
                                                <div className="flex flex-col items-center text-center">
                                                    <div className="relative mb-5">
                                                        <div className="h-20 w-20 rounded-full border-4 border-[#FF4F01]/20 border-t-[#FF4F01] animate-spin" />
                                                        <div className="absolute inset-0 flex items-center justify-center text-[#FF4F01]">
                                                            <Cpu size={26} />
                                                        </div>
                                                    </div>
                                                    <h3 className={`text-xl font-black ${textPrimary}`}>Waiting for connection</h3>
                                                    <p className={`mt-2 max-w-2xl whitespace-normal break-normal text-sm ${subTextColor}`}>
                                                        Keep the bridge app open. Once you start it, this screen will switch automatically.
                                                    </p>
                                                </div>
                                                <div className={`rounded-2xl border p-4 ${insetPanel}`}>
                                                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Keep in mind</p>
                                                    <ul className={`mt-3 space-y-2 text-sm ${textSecondary}`}>
                                                        <li>MT5 must stay logged in.</li>
                                                        <li>The bridge app must stay open.</li>
                                                        <li>Leave this page open while connecting.</li>
                                                    </ul>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="flex flex-col items-center text-center py-2">
                                                <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 text-slate-900">
                                                    <Check size={40} strokeWidth={4} />
                                                </div>
                                                <h3 className={`text-2xl font-black ${textPrimary}`}>Bridge connected</h3>
                                                <p className={`mt-2 max-w-2xl whitespace-normal break-normal text-sm ${subTextColor}`}>
                                                    Your terminal data is now streaming to JournalFX.
                                                </p>
                                                <button
                                                    onClick={() => onComplete(syncKey)}
                                                    className="mt-6 inline-flex items-center gap-3 rounded-2xl bg-emerald-500 px-6 py-4 text-sm font-black uppercase tracking-[0.18em] text-slate-950 transition-transform hover:scale-[1.01]"
                                                >
                                                    Open Command Monitor
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="mt-auto pt-6 flex items-center justify-between gap-4">
                                <button
                                    onClick={() => setStep(s => Math.max(0, s - 1))}
                                    disabled={step === 0}
                                    className={`text-[10px] font-black uppercase tracking-[0.28em] ${step === 0 ? 'opacity-0 pointer-events-none' : 'text-zinc-500 hover:text-white'}`}
                                >
                                    Previous
                                </button>
                                {step < 2 ? (
                                    <button
                                        onClick={() => setStep(s => Math.min(2, s + 1))}
                                        className="inline-flex items-center gap-2 rounded-2xl bg-[#FF4F01] px-6 py-4 text-xs font-black uppercase tracking-[0.2em] text-white transition-transform hover:translate-x-0.5"
                                    >
                                        Continue
                                        <ArrowRight size={16} />
                                    </button>
                                ) : (
                                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                                        Final step
                                    </div>
                                )}
                            </div>
                        </div>
                    </main>
                </div>
            </div>
        </div>
    );
};

const WindowsLogoIcon: React.FC<{ className?: string; size?: number }> = ({ className = 'w-5 h-5 md:w-6 md:h-6', size }) => (
    <svg
        viewBox="0 0 64 64"
        className={className}
        width={size}
        height={size}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
    >
        <path d="M6 12.5L28 9v21.5H6V12.5Z" fill="#00ADEF" />
        <path d="M30 8.5 58 4v26H30V8.5Z" fill="#1B9AF7" />
        <path d="M6 34h22.5v21.5L6 52V34Z" fill="#0089D6" />
        <path d="M30 36h28v24L30 56V36Z" fill="#0078D4" />
    </svg>
);

export default Bridge;


