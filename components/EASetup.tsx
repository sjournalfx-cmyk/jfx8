import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
    Download, Copy, Check, Info, AlertCircle,
    Terminal, Shield, Cpu, ArrowRight, Loader2,
    Play, Command, Code, Zap, Globe, X,
    Power, ExternalLink, Activity, Clock, PlusCircle, CheckCircle2,
    ChevronDown, Wifi, WifiOff,
    TrendingUp, TrendingDown, DollarSign, BarChart3,
    RefreshCw, Trash2, Edit3, Eye, EyeOff, LogOut, Monitor, Layers
} from 'lucide-react';
import { dataService, isTradeInPortfolio } from '../services/dataService';
import { supabase } from '../lib/supabase';
import { UserProfile, Trade, EASession, EADeal, EAPosition, Portfolio } from '../types';
import OpenPositions from './OpenPositions';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useConnectionMode } from '../hooks/useConnectionMode';
import { EA_BRIDGE_URL } from '../lib/constants';
import { getSASTDateTime } from '../lib/timeUtils';
import { normalizeTrade } from '../lib/trade-normalization';
import { parseMTTradeCSV } from '../lib/trade-import';
import { hasActiveSession as hasCtraderSession } from '../services/ctraderService';
import { persistentGetSync, persistentSet } from '../lib/persistentStore';

interface BridgeProps {
    isDarkMode: boolean;
    userProfile: UserProfile;
    onUpdateProfile: (profile: UserProfile) => Promise<void>;
    eaSession?: EASession | null;
    isDemoMode?: boolean;
    onTradeAdded?: (trade: Trade) => void;
    onEditTrade?: (trade: Trade) => void;
    onAddOffline?: (trade: Trade) => void;
    onImportTrades?: (trades: Trade[]) => Promise<void>;
    /** Bulk state sync: called ONCE per import with all saved rows (avoids N re-renders). */
    onTradesAddedBatch?: (trades: Trade[]) => void;
    /** Bulk state sync after bulk delete (single filter + overlay cleanup in App). */
    onTradesDeletedBatch?: (tradeIds: string[]) => void;
    trades: Trade[];
    userId: string;
    onNavigateToJournal?: () => void;
    /** When a non-manual portfolio was just created, link it in-place. */
    linkPortfolio?: Portfolio | null;
    onLinkAccount?: (portfolioId: string, account: { provider: string; externalAccountId?: string }) => Promise<void> | void;
    linkCollisionCheck?: (provider: string, externalAccountId: string, excludeId?: string) => Portfolio | null;
    onDoneLink?: () => void;
    /** Active/default portfolio ids so broker imports land in the visible portfolio. */
    activePortfolioId?: string | null;
    defaultPortfolioId?: string | null;
    activePortfolioName?: string;
}

const Bridge: React.FC<BridgeProps> = ({ isDarkMode, userProfile, onUpdateProfile, eaSession, isDemoMode = false, onTradeAdded, onEditTrade, onAddOffline, onImportTrades, onTradesAddedBatch, onTradesDeletedBatch, trades, userId, onNavigateToJournal, linkPortfolio, onLinkAccount, linkCollisionCheck, onDoneLink, activePortfolioId, defaultPortfolioId, activePortfolioName }) => {
    const [isInternalConnected, setIsInternalConnected] = useState(userProfile.eaConnected);
    const [syncKey, setSyncKey] = useState(userProfile.syncKey || '');
    const { connectionMode, updateConnectionMode } = useConnectionMode(userId, userProfile);

    // Auto-open the right connector when we arrived from "New portfolio → Create"
    // so users never sit on an unlinked portfolio wondering what to do next.
    const linkSource = linkPortfolio?.source;
    useEffect(() => {
        if (!linkPortfolio || isDemoMode) return;
        if (linkSource === 'ctrader' && connectionMode !== 'ctrader') updateConnectionMode('ctrader');
        if (linkSource === 'bridge' && connectionMode !== 'bridge') updateConnectionMode('bridge');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [linkPortfolio?.id, linkSource]);

    // In demo mode there is nothing to connect — always show the method
    // choice (with Desktop Bridge hidden) and never resume a saved bridge.
    useEffect(() => {
        if (isDemoMode && connectionMode === 'bridge') {
            updateConnectionMode(null);
        }
    }, [isDemoMode, connectionMode, updateConnectionMode]);

    // Clear the OAuth redirect flag AFTER the initial render, so it survives
    // React 18 StrictMode's mount → unmount → remount cycle.
    useEffect(() => {
        try { localStorage.removeItem('ctrader_just_authorized'); } catch { /* blocked */ }
        try { sessionStorage.removeItem('ctrader_just_authorized'); } catch { /* blocked */ }
    }, []);
    
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

    if (connectionMode === 'ctrader') {
        return <CtraderConnect
            isDarkMode={isDarkMode}
            onBack={() => updateConnectionMode(null)}
            userProfile={userProfile}
            userId={userId}
            onTradeAdded={onTradeAdded}
            onAddOffline={onAddOffline}
            trades={trades}
            onNavigateToJournal={onNavigateToJournal}
            linkPortfolio={linkPortfolio}
            onLinkAccount={onLinkAccount}
            linkCollisionCheck={linkCollisionCheck}
            onDoneLink={onDoneLink}
            activePortfolioId={activePortfolioId}
            defaultPortfolioId={defaultPortfolioId}
            activePortfolioName={activePortfolioName || linkPortfolio?.name}
            onTradesAddedBatch={onTradesAddedBatch}
            onTradesDeletedBatch={onTradesDeletedBatch}
        />;
    }

    if (!connectionMode || isDemoMode) {
        return <MethodChoice onSelect={updateConnectionMode} onImportTrades={onImportTrades} isDarkMode={isDarkMode} isDemoMode={isDemoMode} />;
    }

    if (isInternalConnected && !isDemoMode) {
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
                linkPortfolioId={linkPortfolio?.id}
                activePortfolioId={activePortfolioId}
                defaultPortfolioId={defaultPortfolioId}
            />
        );
    }

    return (
        <BridgeWizard
            isDarkMode={isDarkMode}
            userProfile={userProfile}
            onUpdateProfile={onUpdateProfile}
            onBack={() => updateConnectionMode(null)}
            onComplete={async (key) => {
                if (isDemoMode) return;
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
    onSelect: (mode: 'bridge' | 'ctrader') => void;
    onImportTrades?: (trades: Trade[]) => Promise<void>;
    isDarkMode: boolean;
    isDemoMode?: boolean;
}

const CTRADER_BROKERS: { name: string; logo: string; minDeposit: string; maxLeverage: string; rating?: string; reviews?: string; tags: string[] }[] = [
    { name: 'FxPro', logo: '/brokers/ctrader/fxpro.png', minDeposit: '$100', maxLeverage: '1:30', rating: 'Excellent', reviews: '771', tags: ['Local choice', 'Copy available', 'Cloud cBots', 'Branded apps', 'Crypto deposits'] },
    { name: 'Pepperstone', logo: '/brokers/ctrader/pepperstone.png', minDeposit: '$0', maxLeverage: '1:30', rating: 'Excellent', reviews: '3282', tags: ['Copy available', 'Cloud cBots', 'Branded apps', 'Crypto deposits'] },
    { name: 'Fusion Markets', logo: '/brokers/ctrader/fusionmarkets.png', minDeposit: '$0', maxLeverage: '1:500', rating: 'Excellent', reviews: '6559', tags: ['Local choice', 'Copy unavailable', 'Cloud cBots', 'Branded apps', 'Crypto deposits'] },
    { name: 'IC Markets', logo: '/brokers/ctrader/icmarkets.png', minDeposit: '$200', maxLeverage: '1:1000', rating: 'Excellent', reviews: '52175', tags: ['Copy available', 'Cloud cBots', 'Branded apps', 'Widgets', 'Crypto deposits'] },
    { name: 'BlackBull Markets', logo: '/brokers/ctrader/blackbullmarkets.png', minDeposit: '$0', maxLeverage: '1:500', rating: 'Excellent', reviews: '3195', tags: ['Copy unavailable', 'Cloud cBots', 'Branded apps', 'Crypto deposits'] },
    { name: 'Blueberry Markets', logo: '/brokers/ctrader/blueberrymarkets.png', minDeposit: '$100', maxLeverage: '1:500', rating: 'Excellent', reviews: '3193', tags: ['Copy unavailable', 'Cloud cBots', 'Crypto deposits'] },
    { name: 'FP Markets', logo: '/brokers/ctrader/fpmarkets.png', minDeposit: '$100', maxLeverage: '1:500', rating: 'Excellent', reviews: '10072', tags: ['Copy available', 'Cloud cBots', 'Branded apps', 'Crypto deposits'] },
    { name: 'Varianse', logo: '/brokers/ctrader/varianse.png', minDeposit: '$100', maxLeverage: '1:500', rating: 'Good', reviews: '30', tags: ['Copy available', 'Cloud cBots', 'Branded apps', 'Widgets', 'Crypto deposits'] },
    { name: 'AUS Group', logo: '/brokers/ctrader/ausgroup.png', minDeposit: '$100', maxLeverage: '1:500',   tags: ['Copy unavailable', 'Cloud cBots', 'Branded apps', 'Crypto deposits'] },
    { name: 'Asset Bridge', logo: '/brokers/ctrader/assetbridge.png', minDeposit: '$50', maxLeverage: '1:200', rating: 'Good', reviews: '1', tags: ['Copy unavailable', 'Cloud cBots', 'Branded apps', 'Crypto deposits'] },
    { name: 'FPM Trading', logo: '/brokers/ctrader/fpmtrading.png', minDeposit: '$200', maxLeverage: '1:500',   tags: ['Copy available', 'Cloud cBots', 'Crypto deposits'] },
    { name: 'OpoFinance', logo: '/brokers/ctrader/opofinance.png', minDeposit: '$500', maxLeverage: '1:500', rating: 'Excellent', reviews: '543', tags: ['Copy available', 'Cloud cBots', 'Crypto deposits'] },
    { name: 'Scandinavian Capital Markets', logo: '/brokers/ctrader/scm.png', minDeposit: '$25', maxLeverage: '1:100', rating: 'Excellent', reviews: '64', tags: ['Copy available', 'Cloud cBots', 'Branded apps', 'Crypto deposits'] },
    { name: 'Errante Securities', logo: '/brokers/ctrader/errantesecurities.png', minDeposit: '$50', maxLeverage: '1:1000', rating: 'Excellent', reviews: '59', tags: ['Copy unavailable', 'Cloud cBots', 'Branded apps', 'Crypto deposits'] },
    { name: 'TopFX', logo: '/brokers/ctrader/topfx.png', minDeposit: '$50', maxLeverage: '1:1000', rating: 'Excellent', reviews: '464', tags: ['Copy available', 'Cloud cBots', 'Branded apps', 'Crypto deposits'] },
    { name: 'Triumph FX', logo: '/brokers/ctrader/triumphfxcy.png', minDeposit: '$100', maxLeverage: '1:1000',   tags: ['Copy available', 'Cloud cBots', 'Crypto deposits'] },
    { name: 'CRX', logo: '/brokers/ctrader/crx.png', minDeposit: '$0', maxLeverage: '1:500',   tags: ['Copy unavailable', 'Cloud cBots', 'Crypto deposits'] },
    { name: 'Wantage Markets', logo: '/brokers/ctrader/wantagemarkets.png', minDeposit: '$500', maxLeverage: '1:500',   tags: ['Copy unavailable', 'Crypto deposits'] },
    { name: 'Traders Way', logo: '/brokers/ctrader/tradersway.png', minDeposit: '$10', maxLeverage: '1:1000', rating: 'Excellent', reviews: '66', tags: ['Copy available', 'Cloud cBots', 'Crypto deposits'] },
    { name: 'FIBO', logo: '/brokers/ctrader/fibo.png', minDeposit: '$250', maxLeverage: '1:400',   tags: ['Copy available', 'Cloud cBots', 'Branded apps', 'Crypto deposits'] },
    { name: 'Total FX', logo: '/brokers/ctrader/totalfx.png', minDeposit: '$500', maxLeverage: '1:50', rating: 'Good', reviews: '56', tags: ['Copy available', 'Cloud cBots', 'Crypto deposits'] },
    { name: 'Tradona Markets', logo: '/brokers/ctrader/tradonamarkets.png', minDeposit: '$10', maxLeverage: '1:1000', rating: 'Excellent', reviews: '18', tags: ['Copy available', 'Cloud cBots', 'Crypto deposits'] },
    { name: 'Skilling', logo: '/brokers/ctrader/skilling.png', minDeposit: '$500', maxLeverage: '1:30', rating: 'Excellent', reviews: '423', tags: ['Copy available', 'Cloud cBots', 'Branded apps', 'Crypto deposits'] },
    { name: 'GoMarkets', logo: '/brokers/ctrader/gomarkets.png', minDeposit: '$0', maxLeverage: '1:500', rating: 'Excellent', reviews: '706', tags: ['Copy available', 'Cloud cBots', 'Branded apps', 'Crypto deposits'] },
    { name: 'APFX', logo: '/brokers/ctrader/apfx.png', minDeposit: '$20', maxLeverage: '1:500',   tags: ['Copy unavailable', 'Crypto deposits'] },
    { name: 'RyoEx', logo: '/brokers/ctrader/ryoex.png', minDeposit: '$10', maxLeverage: '1:2000', rating: 'Excellent', reviews: '16', tags: ['Copy unavailable', 'Cloud cBots', 'Crypto deposits'] },
    { name: 'Dar Al Dahab', logo: '/brokers/ctrader/daraldahab.png', minDeposit: '$100', maxLeverage: '1:30',   tags: ['Copy unavailable', 'Cloud cBots', 'Crypto deposits'] },
    { name: 'M4Markets', logo: '/brokers/ctrader/m4markets.png', minDeposit: '$5', maxLeverage: '1:5000', rating: 'Excellent', reviews: '140', tags: ['Copy unavailable', 'Cloud cBots', 'Crypto deposits'] },
    { name: 'Legacy Global Bank', logo: '/brokers/ctrader/legacyglobalbank.png', minDeposit: '$10', maxLeverage: '1:500', rating: 'Excellent', reviews: '23', tags: ['Copy unavailable', 'Crypto deposits'] },
    { name: 'Dominion Markets', logo: '/brokers/ctrader/dominionmarkets.png', minDeposit: '$250', maxLeverage: '1:500',   tags: ['Copy unavailable', 'Cloud cBots', 'Branded apps', 'Crypto deposits'] },
    { name: 'Jade Forex', logo: '/brokers/ctrader/jadeforex.png', minDeposit: '$250', maxLeverage: '1:200',   tags: ['Copy available', 'Cloud cBots', 'Crypto deposits'] },
    { name: 'Qartal Markets', logo: '/brokers/ctrader/qartalmarkets.png', minDeposit: '$500', maxLeverage: '1:500', rating: 'Good', reviews: '65', tags: ['Copy unavailable', 'Cloud cBots', 'Crypto deposits'] },
    { name: 'LiteFinance', logo: '/brokers/ctrader/litefinance.png', minDeposit: '$50', maxLeverage: '1:1000', rating: 'Excellent', reviews: '612', tags: ['Copy unavailable', 'Cloud cBots', 'Branded apps', 'Crypto deposits'] },
    { name: 'Inzo', logo: '/brokers/ctrader/inzo.png', minDeposit: '$200', maxLeverage: '1:500',   tags: ['Copy available', 'Cloud cBots', 'Branded apps', 'Crypto deposits'] },
    { name: 'Niivesh', logo: '/brokers/ctrader/niivesh.png', minDeposit: '$100', maxLeverage: '1:500', rating: 'Excellent', reviews: '15', tags: ['Copy unavailable', 'Cloud cBots', 'Crypto deposits'] },
    { name: 'Front Broker', logo: '/brokers/ctrader/frontbroker.png', minDeposit: '$250', maxLeverage: '1:500', rating: 'Good', reviews: '13', tags: ['Copy unavailable', 'Cloud cBots', 'Crypto deposits'] },
    { name: 'Quantum Capital Global', logo: '/brokers/ctrader/quantumcapitalglobal.png', minDeposit: '$1', maxLeverage: '1:500',   tags: ['Copy unavailable', 'Cloud cBots', 'Crypto deposits'] },
    { name: 'TCrater', logo: '/brokers/ctrader/tcrater.png', minDeposit: '$10', maxLeverage: '1:500',   tags: ['Copy unavailable', 'Cloud cBots', 'Crypto deposits'] },
    { name: 'Ruby Star Gold', logo: '/brokers/ctrader/rubystargold.png', minDeposit: '$0', maxLeverage: '1:1',   tags: ['Copy unavailable', 'Cloud cBots', 'Branded apps', 'Crypto deposits'] },
    { name: 'Purple Trading', logo: '/brokers/ctrader/purpletrading.png', minDeposit: '$0', maxLeverage: '1:500', rating: 'Excellent', reviews: '111', tags: ['Copy available', 'Cloud cBots', 'Branded apps', 'Crypto deposits'] },
    { name: 'GCI', logo: '/brokers/ctrader/gci.png', minDeposit: '$500', maxLeverage: '1:500', rating: 'Good', reviews: '2', tags: ['Copy unavailable', 'Cloud cBots', 'Widgets', 'Crypto deposits'] },
    { name: 'Dak Markets Global', logo: '/brokers/ctrader/dakmarketsglobal.png', minDeposit: '$250', maxLeverage: '1:500', rating: 'Excellent', reviews: '7', tags: ['Copy unavailable', 'Cloud cBots', 'Widgets', 'Crypto deposits'] },
    { name: 'Virex Market', logo: '/brokers/ctrader/virexmarket.png', minDeposit: '$50', maxLeverage: '1:400',   tags: ['Copy unavailable', 'Cloud cBots', 'Crypto deposits'] },
    { name: 'FX Oak', logo: '/brokers/ctrader/fxoak.png', minDeposit: '$250', maxLeverage: '1:500',   tags: ['Copy unavailable', 'Cloud cBots', 'Crypto deposits'] },
    { name: 'Axiory', logo: '/brokers/ctrader/axiory.png', minDeposit: '$10', maxLeverage: '1:2000', rating: 'Good', reviews: '63', tags: ['Copy unavailable', 'Cloud cBots', 'Branded apps', 'Crypto deposits'] },
    { name: 'AUTU', logo: '/brokers/ctrader/autu.png', minDeposit: '$100', maxLeverage: '1:500', rating: 'Excellent', reviews: '5', tags: ['Copy available', 'Cloud cBots', 'Crypto deposits'] },
    { name: 'FX Pig', logo: '/brokers/ctrader/fxpig.png', minDeposit: '$200', maxLeverage: '1:500',   tags: ['Copy available', 'Cloud cBots', 'Branded apps', 'Crypto deposits'] },
    { name: 'TRDP', logo: '/brokers/ctrader/trdp.png', minDeposit: '$10', maxLeverage: '1:200',   tags: ['Copy unavailable', 'Cloud cBots', 'Crypto deposits'] },
    { name: 'Tradeview Markets', logo: '/brokers/ctrader/tradeviewmarkets.png', minDeposit: '$100', maxLeverage: '1:500', rating: 'Excellent', reviews: '437', tags: ['Copy available', 'Cloud cBots', 'Branded apps', 'Crypto deposits'] },
    { name: 'Vittaverse', logo: '/brokers/ctrader/vittaverse.png', minDeposit: '$15', maxLeverage: '1:2000', rating: 'Good', reviews: '70', tags: ['Copy available', 'Cloud cBots', 'Crypto deposits'] },
    { name: 'Geldbeat', logo: '/brokers/ctrader/geldbeat.png', minDeposit: '$10', maxLeverage: '1:1000',   tags: ['Copy unavailable', 'Cloud cBots', 'Branded apps', 'Crypto deposits'] },
    { name: 'EPlanet Brokers', logo: '/brokers/ctrader/eplanetbrokers.png', minDeposit: '$100', maxLeverage: '1:30',   tags: ['Copy unavailable', 'Cloud cBots', 'Widgets', 'Crypto deposits'] },
    { name: 'Klas Trading', logo: '/brokers/ctrader/klastrading.png', minDeposit: '$100', maxLeverage: '1:200',   tags: ['Copy unavailable', 'Cloud cBots', 'Branded apps', 'Crypto deposits'] },
];

const BrokerLogo: React.FC<{ broker: typeof CTRADER_BROKERS[number] }> = ({ broker }) => {
    const [failed, setFailed] = useState(false);
    if (failed) {
        return <span className="text-[11px] font-black text-[#FF4F00]">{broker.name.slice(0, 2).toUpperCase()}</span>;
    }
    return (
        <img
            src={broker.logo}
            alt={broker.name}
            loading="lazy"
            className="w-full h-full object-contain"
            onError={() => setFailed(true)}
        />
    );
};

const normalizeBrokerKey = (s: string | null | undefined): string =>
    (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Logo path for a connected broker name (e.g. "Fusion Markets" → its brand mark). Null when unknown. */
const findBrokerLogo = (brokerName: string | null | undefined): string | null => {
    const needle = normalizeBrokerKey(brokerName);
    if (!needle) return null;
    const exact = CTRADER_BROKERS.find(b => normalizeBrokerKey(b.name) === needle);
    if (exact) return exact.logo;
    const partial = CTRADER_BROKERS.find(b => {
        const key = normalizeBrokerKey(b.name);
        return key.length >= 4 && (needle.includes(key) || key.includes(needle));
    });
    return partial ? partial.logo : null;
};

/** Account-card logo: connected broker's brand mark, cTrader mark as fallback. */
const AccountBrokerLogo: React.FC<{ brokerName: string | null | undefined }> = ({ brokerName }) => {
    const logo = findBrokerLogo(brokerName);
    const [src, setSrc] = useState(logo || '/icon3.jpeg');
    useEffect(() => { setSrc(logo || '/icon3.jpeg'); }, [logo]);
    const label = (brokerName || 'cTrader').slice(0, 2).toUpperCase();
    if (src === 'initials') {
        return <span className="w-9 h-9 flex items-center justify-center text-[11px] font-black text-[#FF4F00]">{label}</span>;
    }
    return (
        <img
            src={src}
            alt={brokerName || 'Broker'}
            loading="lazy"
            className="w-9 h-9 object-contain rounded-md bg-white"
            onError={() => setSrc(prev => (prev === '/icon3.jpeg' ? 'initials' : '/icon3.jpeg'))}
        />
    );
};

const MethodChoice: React.FC<MethodChoiceProps> = ({ onSelect, onImportTrades, isDarkMode, isDemoMode = false }) => {
    const csvInputRef = useRef<HTMLInputElement>(null);
    const [showCtraderBrokers, setShowCtraderBrokers] = useState(false);
    const [brokerQuery, setBrokerQuery] = useState('');
    const filteredBrokers = useMemo(() => {
        const q = brokerQuery.trim().toLowerCase();
        if (!q) return CTRADER_BROKERS;
        return CTRADER_BROKERS.filter(b => b.name.toLowerCase().includes(q));
    }, [brokerQuery]);
    const options = [
        // Desktop Bridge omitted in demo mode — demo needs no terminal connection.
        ...(!isDemoMode ? [{
            id: 'bridge' as const,
            title: 'Desktop Bridge',
            subtitle: 'EA Terminal Bridge',
            icon: (
                <img src="/icon2.png" alt="Desktop Bridge" className="w-10 h-10 lg:w-11 lg:h-11 object-contain" />
            ),
            features: [
                'Windows EXE bridge client',
                'Auto-sync via Supabase Realtime',
                'Full monitor dashboard',
                'One-click setup'
            ],
            accent: '#FF4F01',
            gradient: 'from-[#FF4F01]/20 via-transparent to-transparent',
            description: 'Install the JFX-JOURNAL Bridge application on your Windows desktop for automated, real-time trade synchronization via the EA.'
        }] : []),
        {
            id: 'ctrader' as const,
            title: 'cTrader',
            subtitle: 'Open API Sync',
            icon: (
                <img src="/icon3.jpeg" alt="cTrader" className="w-10 h-10 lg:w-11 lg:h-11 object-contain" />
            ),
            features: [
                'Direct cTrader ID OAuth login',
                'Real-time account & position data',
                'Closed trade history via WebSocket',
                'No VPS or bridge required'
            ],
            accent: '#FF4F00',
            gradient: 'from-[#FF4F00]/20 via-transparent to-transparent',
            description: 'Connect your cTrader account directly using cTrader Open API. Securely access account details, open positions, and closed deals via OAuth authentication.'
        },
        {
            id: 'csv' as const,
            title: 'Import CSV',
            subtitle: 'Trade Journal File',
            icon: (
                <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 3h8l4 4v14H4V3h4z" />
                    <path d="M8 3v4h8" />
                    <path d="M8 11h8" />
                    <path d="M8 15h8" />
                </svg>
            ),
            features: [
                'CSV or TXT trade export',
                'Same MT4/MT5 parser as trade entry',
                'Bulk import to your journal',
                'Quick file picker'
            ],
            accent: '#8B5CF6',
            gradient: 'from-[#8B5CF6]/20 via-transparent to-transparent',
            description: 'Import a CSV export directly into your journal without leaving the connection setup flow.'
        }
    ];

    const handleCardClick = async (opt: typeof options[number]) => {
        if (opt.id === 'csv') {
            csvInputRef.current?.click();
            return;
        }
        onSelect(opt.id as 'bridge' | 'ctrader');
    };

    const handleCsvImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !onImportTrades) return;
        const reader = new FileReader();
        reader.onload = async (loadEvent) => {
            const text = typeof loadEvent.target?.result === 'string' ? loadEvent.target.result : '';
            if (!text) return;
            const importedTrades = parseMTTradeCSV(text);
            if (importedTrades.length > 0) {
                await onImportTrades(importedTrades);
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    };

    return (
        <div className="w-full h-full overflow-y-auto custom-scrollbar bg-black">
            <div className="max-w-5xl w-full mx-auto pt-12 pb-8 px-8">
                {/* Header */}
                <div className="mb-12 text-center">
                    <h1 className="text-4xl font-black tracking-tight text-white mb-3">
                        Choose Your Connection
                    </h1>
                    <p className="text-zinc-500 text-sm leading-relaxed max-w-2xl mx-auto whitespace-normal break-normal">
                        Select how you want to connect your trading terminal to JFX-JOURNAL.
                        You can switch between methods at any time.
                    </p>
                </div>

                {/* Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {options.map((opt, idx) => (
                        <div
                            key={opt.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => void handleCardClick(opt)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void handleCardClick(opt); } }}
                            style={{
                                animationDelay: `${idx * 150}ms`,
                                animationFillMode: 'both'
                            } as React.CSSProperties}
                            className={`group relative text-left w-full rounded-3xl border bg-[#000000] p-6 lg:p-8 transition-all duration-500 animate-in fade-in slide-in-from-bottom-4 cursor-pointer ${
                                opt.id === 'bridge'
                                    ? 'border-white/10 hover:border-[#FF4F01]/40'
                                    : opt.id === 'ctrader'
                                    ? 'border-white/10 hover:border-[#FF4F00]/40'
                                    : 'border-white/10 hover:border-[#8B5CF6]/40'
                            }`}
                        >
                            {/* Content */}
                            <div className="relative z-10 flex flex-col h-full">
                                {/* Icon */}
                                <div
                                    className="w-12 h-12 lg:w-14 lg:h-14 rounded-2xl flex items-center justify-center mb-4 lg:mb-6"
                                    style={{
                                        backgroundColor: `${opt.accent}15`,
                                        color: opt.accent,
                                        boxShadow: `0 0 30px -10px ${opt.accent}40`
                                    }}
                                >
                                    {opt.icon}
                                </div>

                                {/* Title */}
                                <h2 className="text-xl lg:text-2xl font-black tracking-tight text-white mb-1">
                                    {opt.title}
                                </h2>
                                <p className="text-xs font-medium uppercase tracking-widest mb-3 lg:mb-4" style={{ color: opt.accent }}>
                                    {opt.subtitle}
                                </p>
                                <p className="text-zinc-400 text-xs lg:text-sm leading-relaxed mb-4 lg:mb-6">
                                    {opt.description}
                                </p>

                                {/* Features */}
                                <ul className="space-y-2 mb-6 lg:mb-8">
                                    {opt.features.map((f, i) => (
                                        <li key={i} className="flex items-center gap-2.5 text-zinc-500 text-xs">
                                            <svg className="w-3.5 h-3.5 flex-shrink-0" style={{ color: opt.accent }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="20 6 9 17 4 12" />
                                            </svg>
                                            {f}
                                        </li>
                                    ))}
                                </ul>

                                {/* CTA row */}
                                <div className="mt-auto flex flex-col gap-3">
                                    <div
                                        className={`inline-flex items-center gap-2 px-4 py-2 lg:px-5 lg:py-2.5 rounded-xl text-xs lg:text-sm font-semibold transition-all duration-300 w-fit ${
                                            opt.id === 'csv'
                                                ? 'bg-[#8B5CF6] text-white border border-[#8B5CF6] group-hover:gap-3'
                                                : 'text-white group-hover:gap-3'
                                        }`}
                                        style={opt.id !== 'csv' ? { backgroundColor: opt.accent } : undefined}
                                    >
                                        Get Started
                                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <line x1="5" y1="12" x2="19" y2="12" />
                                            <polyline points="12 5 19 12 12 19" />
                                        </svg>
                                    </div>
                                    {opt.id === 'ctrader' && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setBrokerQuery(''); setShowCtraderBrokers(true); }}
                                            className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-zinc-400 hover:text-white transition-colors w-fit -ml-1 px-1 py-1 rounded-lg hover:bg-white/5"
                                        >
                                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <circle cx="12" cy="12" r="10" />
                                                <path d="M12 16v-4" />
                                                <path d="M12 8h.01" />
                                            </svg>
                                            See available brokers
                                            <svg className="w-3 h-3 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <input
                    ref={csvInputRef}
                    type="file"
                    accept=".csv,.txt"
                    className="hidden"
                    onChange={handleCsvImport}
                />
            </div>

            {/* cTrader brokers drawer */}
            {showCtraderBrokers && (
                <div className="fixed inset-0 z-[100] flex justify-end">
                    <div className="absolute inset-0 bg-black/60" onClick={() => setShowCtraderBrokers(false)} />
                    <div className="relative w-full max-w-[420px] h-full bg-[#000000] border-l border-white/10 flex flex-col shadow-2xl">
                        {/* header */}
                        <div className="p-6 border-b border-white/10 shrink-0">
                            <div className="flex items-start justify-between gap-4 mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-11 h-11 rounded-xl bg-transparent flex items-center justify-center shrink-0 overflow-hidden">
                                        <img src="/icon3.jpeg" alt="cTrader" className="w-full h-full object-contain" />
                                    </div>
                                    <div>
                                        <h3 className="text-white font-black tracking-tight leading-none">cTrader Brokers</h3>
                                        <p className="text-[11px] text-zinc-500 mt-1">Any broker below connects via cTrader ID OAuth.</p>
                                    </div>
                                </div>
                                <button onClick={() => setShowCtraderBrokers(false)} className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white shrink-0">
                                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                                </button>
                            </div>
                            <div className="relative">
                                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                                <input
                                    autoFocus
                                    value={brokerQuery}
                                    onChange={(e) => setBrokerQuery(e.target.value)}
                                    placeholder="Search broker..."
                                    className="w-full h-10 pl-10 pr-3 rounded-xl bg-white/[0.04] border border-white/10 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#FF4F00]/40 focus:bg-white/[0.06]"
                                />
                            </div>
                            <p className="text-[11px] text-zinc-500 mt-3 leading-relaxed">
                                Don&apos;t see yours? If your broker offers cTrader, it works — just hit <span className="text-zinc-300 font-semibold">Get Started → cTrader</span> and log in with cTrader ID.
                            </p>
                        </div>
                        {/* list */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1.5">
                            {filteredBrokers.length === 0 ? (
                                <div className="py-10 text-center">
                                    <p className="text-sm text-zinc-500">No brokers match “{brokerQuery}”.</p>
                                    <p className="text-xs text-zinc-600 mt-1">Try a different search or connect anyway — any cTrader broker works.</p>
                                </div>
                            ) : (
                                filteredBrokers.map((b) => (
                                    <div
                                        key={b.name}
                                        className="group flex items-center gap-3 px-3 py-3 rounded-2xl bg-[#000000] border border-white/5 hover:border-white/10"
                                    >
                                        <div className="w-11 h-11 rounded-xl bg-transparent flex items-center justify-center shrink-0 overflow-hidden">
                                            <BrokerLogo broker={b} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="text-sm font-semibold text-white leading-none truncate">{b.name}</div>
                                            <div className="text-[11px] text-zinc-500 mt-1 flex items-center gap-2 flex-wrap leading-none">
                                                <span><span className="text-white font-medium">{b.minDeposit}</span> min</span>
                                                <span className="w-1 h-1 rounded-full bg-white/20 shrink-0"></span>
                                                <span><span className="text-white font-medium">{b.maxLeverage}</span> leverage</span>
                                                {b.reviews && (
                                                    <>
                                                        <span className="w-1 h-1 rounded-full bg-white/20 shrink-0"></span>
                                                        <span className={b.rating === 'Excellent' ? 'text-emerald-400' : b.rating === 'Good' ? 'text-amber-400' : 'text-zinc-500'}>{b.rating}</span>
                                                        <span>· {b.reviews}</span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                        {/* footer cta */}
                        <div className="p-4 border-t border-white/10 shrink-0 bg-[#000000]">
                            <button
                                onClick={() => { setShowCtraderBrokers(false); onSelect('ctrader'); }}
                                className="w-full h-11 rounded-xl bg-[#FF4F00] hover:bg-[#ff5a0f] text-white text-sm font-bold tracking-wide flex items-center justify-center gap-2"
                            >
                                Connect with cTrader
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
                            </button>
                            <p className="text-[10px] text-zinc-600 text-center mt-2">Secure OAuth via Spotware cTrader ID. No password stored.</p>
                        </div>
                    </div>
                </div>
            )}
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
    /** Active/default portfolio ids so broker imports land in the visible portfolio. */
    linkPortfolioId?: string | null;
    activePortfolioId?: string | null;
    defaultPortfolioId?: string | null;
}

const BridgeMonitor: React.FC<BridgeMonitorProps> = ({ isDarkMode, userProfile, liveData, lastHeartbeat, isHeartbeat, syncKey, syncLog, onDisconnect, onTradeAdded, onEditTrade, onAddOffline, trades, userId, linkPortfolioId, activePortfolioId, defaultPortfolioId }) => {
    const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
    const [autoLog, setAutoLog] = useLocalStorage('bridge_auto_log', false);
    const [now, setNow] = useState(new Date());
    const [isSavingTrade, setIsSavingTrade] = useState<string | null>(null); // Track specific trade being saved
    const [copied, setCopied] = useState(false);

    // Headless local proxy state
    const [localHeadlessData, setLocalHeadlessData] = useState<any>(null);
    const [localLastHeartbeat, setLocalLastHeartbeat] = useState<Date | null>(null);
    const [headlessSource, setHeadlessSource] = useState<'socket' | 'python' | null>(null);

    // ✅ SUGGESTION 3: Equity Sparkline History (last 20 points)
    const [equityHistory, setEquityHistory] = useState<number[]>([]);

    
    // ✅ FIX: cardStyle defined here — used throughout the component
    // Obsidian Black theme: deeper blacks and subtle borders
    const cardStyle = 'bg-black/80 border border-white/5 backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.4)]';

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

    // Local Headless MT5 Polling:
    // Tier 1: Try MQL5 socket bridge at localhost:8888 (Docker headless mode)
    // Tier 2: Fallback to Vite dev-server /api/mt5/* routes (Python direct mode)
    useEffect(() => {
        let isActive = true;

        const fetchFromSocketBridge = async (controller: AbortController) => {
            const [accountRes, positionsRes, historyRes] = await Promise.all([
                fetch(`${EA_BRIDGE_URL}/api/account`, { signal: controller.signal }),
                fetch(`${EA_BRIDGE_URL}/api/positions`, { signal: controller.signal }),
                fetch(`${EA_BRIDGE_URL}/api/history`, { signal: controller.signal })
            ]);
            if (!accountRes.ok || !positionsRes.ok || !historyRes.ok) throw new Error('Socket bridge unavailable');
            const accData = await accountRes.json();
            const posData = await positionsRes.json();
            const histData = await historyRes.json();
            return {
                isHeartbeat: true,
                account: accData.account,
                openPositions: posData.openPositions || [],
                trades: histData.trades || [],
            };
        };

        const fetchFromViteRoutes = async (controller: AbortController) => {
            const [accountRes, positionsRes, historyRes] = await Promise.all([
                fetch('/api/mt5/account', { signal: controller.signal }),
                fetch('/api/mt5/positions', { signal: controller.signal }),
                fetch('/api/mt5/history', { signal: controller.signal })
            ]);
            if (!accountRes.ok || !positionsRes.ok || !historyRes.ok) throw new Error('Vite MT5 routes unavailable');
            const accData = await accountRes.json();
            const posData = await positionsRes.json();
            const histData = await historyRes.json();
            return {
                isHeartbeat: true,
                account: accData.account,
                openPositions: posData.openPositions || [],
                trades: histData.trades || [],
            };
        };

        const fetchHeadlessData = async () => {
            try {
                let result: any = null;
                let source: 'socket' | 'python' | null = null;

                // Try Socket Bridge (1s timeout)
                const socketController = new AbortController();
                const socketTimeout = setTimeout(() => socketController.abort(), 1000);
                try {
                    result = await fetchFromSocketBridge(socketController);
                    source = 'socket';
                } catch {
                    // Socket bridge failed, try Vite Python direct (4s timeout)
                    const viteController = new AbortController();
                    const viteTimeout = setTimeout(() => viteController.abort(), 4000);
                    try {
                        result = await fetchFromViteRoutes(viteController);
                        source = 'python';
                    } catch {
                        // Both failed
                    } finally {
                        clearTimeout(viteTimeout);
                    }
                } finally {
                    clearTimeout(socketTimeout);
                }

                if (isActive && result) {
                    setLocalHeadlessData(result);
                    setLocalLastHeartbeat(new Date());
                    setHeadlessSource(source);
                }
            } catch {
                // Suppress all errors silently
            }
        };

        const interval = setInterval(fetchHeadlessData, 5000);
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
    const isOnline = effectiveIsHeartbeat && timeAgo !== null && timeAgo < 30; // 30s threshold (Python scripts take 2-5s to run)

    // Filter "Pending" trades (from bridge but not in DB)
    // Only show "Exit" deals (entry=1 or 2) as candidates for Journal
    const incomingTrades = (effectiveLiveData?.trades || []).filter((t: EADeal) => {
        const hasExit = t.entry === 1 || t.entry === 2;
        const hasSymbol = !!(t.symbol);
        const hasProfitData = t.profit !== undefined && t.profit !== null;
        return hasExit || (hasSymbol && hasProfitData);
    });
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

            const targetPortfolioId = linkPortfolioId || activePortfolioId || defaultPortfolioId || undefined;

            const newTrade = normalizeTrade({
                id: '', // Generated by DB
                ticketId: String(mt5Trade.ticket),
                portfolio_id: targetPortfolioId,
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
            });

            if (!autoLog && onEditTrade) {
                onEditTrade(newTrade);
                return;
            }

            try {
                const saved = await dataService.addTrade(newTrade);
                if (targetPortfolioId && !(saved as Trade).portfolio_id) {
                    (saved as Trade).portfolio_id = targetPortfolioId;
                }
                // Notify global state
                if (onTradeAdded) {
                    onTradeAdded(saved);
                }
            } catch (syncError) {
                console.warn("Sync failed, queuing offline:", syncError);
                if (onAddOffline) {
                    onAddOffline({ ...newTrade, portfolio_id: targetPortfolioId });
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
                <>
                  <span className="px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-400 text-[9px] font-black tracking-widest uppercase border border-indigo-500/20">Headless</span>
                  <span className={`px-2 py-0.5 rounded-md text-[9px] font-black tracking-widest uppercase border ${
                    headlessSource === 'socket' 
                      ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' 
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  }`}>
                    {headlessSource === 'socket' ? 'Socket Bridge' : 'Python Direct'}
                  </span>
                </>
              )}

            </div>
            <p className="text-[10px] text-slate-500 font-medium mt-0.5">{effectiveLiveData?.account?.server || 'MetaTrader 5 Terminal'}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={onDisconnect} className="h-10 px-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] font-black uppercase tracking-widest hover:bg-rose-500 hover:text-white transition-all flex items-center gap-2">
                            <Power size={12} strokeWidth={3} /> Disconnect
                        </button>
                    </div>
                </div>

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
                                    <span className={`text-sm font-mono font-black ${profit >= 0 ? 'text-[#FF4F00]' : 'text-rose-400'}`}>
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
                                    <div className="w-9 h-9 rounded-xl bg-[#FF4F00]/10 flex items-center justify-center">
                                        <Activity size={17} className="text-[#FF4F00]" />
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

                        {/* Automation */}
                            <div className={`${cardStyle} rounded-3xl p-5`}>
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

                            {/* Journal Queue */}
                            <div className={`${cardStyle} rounded-3xl p-5 flex flex-col h-[220px]`}>
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
                                                            <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider ${trade.type === 'BUY' ? 'bg-[#FF4F00]/10 text-[#FF4F00]' : 'bg-rose-500/10 text-rose-400'}`}>{trade.type}</span>
                                                        </div>
                                                        <span className={`text-xs font-mono font-black ${trade.profit >= 0 ? 'text-[#FF4F00]' : 'text-rose-400'}`}>{trade.profit >= 0 ? '+' : ''}{trade.profit?.toFixed(2)}</span>
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

                    </div>
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
            subtitle: 'Get the Windows app that connects MT5 to JFX-JOURNAL.',
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
            subtitle: 'Launch the app, then sign in with your JFX-JOURNAL account.',
            icon: Play,
            requirements: [
                'JFX-JOURNAL email and password',
                'MetaTrader 5 open and logged in',
                'The bridge file downloaded',
            ],
            actions: [
                'Run JournalFX_Bridge.exe',
                'Sign in to your JFX-JOURNAL account',
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
        'JFX-JOURNAL account',
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
                                            ? 'border-[#FF4F00]/20 bg-emerald-500/6'
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
                                                    Your terminal data is now streaming to JFX-JOURNAL.
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

/* --- SUB-COMPONENT: CTRADER CONNECT --- */
interface CtraderConnectProps {
    isDarkMode: boolean;
    onBack: () => void;
    userProfile?: UserProfile;
    userId?: string;
    onTradeAdded?: (trade: Trade) => void;
    onAddOffline?: (trade: Trade) => void;
    /** Bulk state sync: called ONCE per import with all saved rows (avoids N re-renders). */
    onTradesAddedBatch?: (trades: Trade[]) => void;
    /** Bulk state sync after bulk delete (single filter + overlay cleanup in App). */
    onTradesDeletedBatch?: (tradeIds: string[]) => void;
    trades?: Trade[];
    onNavigateToJournal?: () => void;
    linkPortfolio?: Portfolio | null;
    onLinkAccount?: (portfolioId: string, account: { provider: string; externalAccountId?: string }) => Promise<void> | void;
    linkCollisionCheck?: (provider: string, externalAccountId: string, excludeId?: string) => Portfolio | null;
    onDoneLink?: () => void;
    activePortfolioId?: string | null;
    defaultPortfolioId?: string | null;
    activePortfolioName?: string;
}

const CtraderConnect: React.FC<CtraderConnectProps> = ({ isDarkMode, onBack, userProfile, userId, onTradeAdded, onAddOffline, onTradesAddedBatch, onTradesDeletedBatch, trades, onNavigateToJournal, linkPortfolio, onLinkAccount, linkCollisionCheck, onDoneLink, activePortfolioId, defaultPortfolioId, activePortfolioName }) => {
    const [linkMsg, setLinkMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [isLinking, setIsLinking] = useState(false);
    // Start from the persisted session flag so switching views (or reloading)
    // lands straight back on the authenticated terminal instead of flashing
    // the "Connect" button. Only an explicit disconnect resets this to idle.
    const [authState, setAuthState] = useState<'idle' | 'connecting' | 'connected' | 'error'>(() => (hasCtraderSession() ? 'connected' : 'idle'));
    const [accounts, setAccounts] = useState<any[]>([]);
    const [errorMsg, setErrorMsg] = useState('');
    const [isFetchingAccounts, setIsFetchingAccounts] = useState(false);

    // Prevents StrictMode from double-invoking handleFetchAccounts
    // (useRef persists across React 18's mount → unmount → remount cycle)
    const fetchCalledRef = useRef(false);

    // --- State variables for 2,3,4,5,6,7,8 ---
    const [profile, setProfile] = useState<any>(null);
    const [selectedAccountId, _setSelectedAccountId] = useState<number | null>(null);
    const mountedRef = useRef(false);

    const setSelectedAccountId = (id: number | null) => {
        _setSelectedAccountId(id);
        // Persist selection to localStorage so it survives OAuth redirects.
        // Only write after first mount (mountedRef) so the initial null state
        // doesn't clobber the saved preference before handleFetchAccounts reads it.
        if (!mountedRef.current) return;
        if (id !== null) {
            import('../services/ctraderService').then(m => m.setSelectedAccountId(id)).catch(() => {});
        }
        // Don't clear on null (back-to-list) — only logout() clears it.
    };

    useEffect(() => { mountedRef.current = true; }, []);
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);
    const [accountPositions, setAccountPositions] = useState<any[]>([]);
    const [accountDeals, setAccountDeals] = useState<any[]>([]);
    const [pendingOrders, setPendingOrders] = useState<any[]>([]);
    const [traderDetails, setTraderDetails] = useState<any>(null);
    const [symbolsList, setSymbolsList] = useState<any[]>([]);
    const [detailsError, setDetailsError] = useState('');
    
    // Tab state
    const [activeTab, setActiveTab] = useState<'overview' | 'positions' | 'history' | 'market' | 'logs'>('overview');

    // --- Guided first-import (empty journal) + auto-sync new closes ---
    const [showImportPrompt, setShowImportPrompt] = useState(false);
    const [importRange, setImportRange] = useState<'30d' | 'all'>('30d');
    const [bannerDismissals, setBannerDismissals] = useState<Record<string, boolean>>({});
    const [autoSync, setAutoSync] = useState<boolean>(() => {
        try { return localStorage.getItem('jfx_ctrader_autosync') !== 'off'; } catch { return true; }
    });
    const promptShownForRef = useRef<number | null>(null);
    const guidedCancelRef = useRef(false);
    const knownDealIdsRef = useRef<Set<number>>(new Set());
    const knownSeededForRef = useRef<number | null>(null);
    const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;
    const targetPortfolioId = activePortfolioId || linkPortfolio?.id || defaultPortfolioId || undefined;

    // Dual-write (sync mirror + durable native copy) so import bookkeeping
    // survives APK restarts that clear the WebView's localStorage.
    // Keys are scoped to both the account ID and target portfolio so importing
    // deals into a new portfolio is never blocked by deals in an older portfolio.
    const ctraderStoreGet = (k: string): string | null => { try { return persistentGetSync(k); } catch { return null; } };
    const ctraderStoreSet = (k: string, v: string) => { try { persistentSet(k, v); } catch { /* blocked */ } };
    const scopeKey = (ctid: number | string) => `${ctid}_${targetPortfolioId || 'default'}`;
    const importedKey = (ctid: number | string) => `jfx_ctrader_imported_${scopeKey(ctid)}`;
    const dismissedKey = (ctid: number | string) => `jfx_ctrader_import_dismissed_${scopeKey(ctid)}`;
    const savedDealsKey = (ctid: number | string) => `jfx_ctrader_saved_deals_${scopeKey(ctid)}`;
    const pendingDealsKey = (ctid: number | string) => `jfx_ctrader_pending_deals_${scopeKey(ctid)}`;

    const getPersistedImportedDealIds = (accountId: number | string): Set<number> => {
        try {
            const raw = ctraderStoreGet(savedDealsKey(accountId));
            if (!raw) return new Set();
            const parsed = JSON.parse(raw);
            return new Set(Array.isArray(parsed) ? parsed.map(Number) : []);
        } catch {
            return new Set();
        }
    };

    const persistImportedDealIds = (accountId: number | string, dealIds: (number | string)[]) => {
        try {
            const existing = getPersistedImportedDealIds(accountId);
            dealIds.forEach(id => existing.add(Number(id)));
            const capped = Array.from(existing).slice(-5000);
            ctraderStoreSet(savedDealsKey(accountId), JSON.stringify(capped));
        } catch { /* ignore */ }
    };

    // Deals that FAILED to persist (offline / throw mid-chunk). Stashed
    // durably so the next session offers a one-tap retry instead of
    // silently losing them.
    const getPendingDeals = (accountId: number | string): any[] => {
        try {
            const raw = ctraderStoreGet(pendingDealsKey(accountId));
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    };
    const stashPendingDeals = (accountId: number | string, deals: any[]) => {
        try {
            const existing = getPendingDeals(accountId);
            const seen = new Set(existing.map(d => String(d?.dealId)));
            for (const d of deals) {
                if (d && !seen.has(String(d.dealId))) {
                    seen.add(String(d.dealId));
                    existing.push(d);
                }
            }
            ctraderStoreSet(pendingDealsKey(accountId), JSON.stringify(existing.slice(-500)));
        } catch { /* ignore */ }
    };
    const clearPendingDeals = (accountId: number | string, dealIds: (number | string)[]) => {
        try {
            const done = new Set(dealIds.map(String));
            const rest = getPendingDeals(accountId).filter(d => !done.has(String(d?.dealId)));
            ctraderStoreSet(pendingDealsKey(accountId), JSON.stringify(rest));
        } catch { /* ignore */ }
    };

    // Set when user taps "All accounts" — stops the single-account
    // auto-select below from instantly bouncing them back into details.
    const manualBackToListRef = useRef(false);

    // Trading inputs
    const [tradingSymbolId, setTradingSymbolId] = useState<string>('');
    const [tradingSide, setTradingSide] = useState<'buy' | 'sell'>('buy');
    const [tradingVolume, setTradingVolume] = useState<number>(0.01);
    const [tradingLimitPrice, setTradingLimitPrice] = useState<string>('');
    const [tradingStopPrice, setTradingStopPrice] = useState<string>('');
    const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
    const [tradeResultMsg, setTradeResultMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    // Spot Price and Subscriptions inputs
    const [subSymbolId, setSubSymbolId] = useState<string>('');
    const [liveTicks, setLiveTicks] = useState<Record<string, { bid?: number; ask?: number; time: number }>>({});

    // Margin calculations inputs
    const [marginCalcSymbolId, setMarginCalcSymbolId] = useState<string>('');
    const [marginCalcVolume, setMarginCalcVolume] = useState<number>(0.01);
    const [calculatedMargin, setCalculatedMargin] = useState<number | null>(null);
    const [isCalculatingMargin, setIsCalculatingMargin] = useState(false);

    // Realtime logs
    const [eventLogs, setEventLogs] = useState<{ time: string; msg: string }[]>([]);

    const [savingDealId, setSavingDealId] = useState<number | null>(null);
    const [savedDealIds, setSavedDealIds] = useState<Set<number>>(new Set());
    const [isBulkAdding, setIsBulkAdding] = useState(false);
    const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
    const [bulkResult, setBulkResult] = useState<string | null>(null);

    // Sync persisted deal IDs whenever selected account or target portfolio changes
    useEffect(() => {
        if (selectedAccountId != null) {
            const persisted = getPersistedImportedDealIds(selectedAccountId);
            setSavedDealIds(persisted);
        } else {
            setSavedDealIds(new Set());
        }
    }, [selectedAccountId, targetPortfolioId]);

    const getSymbolName = (d: any) => {
        if (d.symbol && isNaN(Number(d.symbol))) {
            return d.symbol;
        }
        const targetId = d.symbolId !== undefined ? d.symbolId : d.symbol;
        if (targetId !== undefined && targetId !== null) {
            const found = symbolsList.find(s => s.symbolId.toString() === targetId.toString());
            if (found && found.symbolName) {
                return found.symbolName;
            }
        }
        return d.symbol || 'EURUSD';
    };

    const isDealInJournal = useCallback((deal: any): boolean => {
        if (!deal) return false;
        const dealIdNum = Number(deal.dealId);
        const dealIdStr = String(deal.dealId || '').trim();
        if (savedDealIds.has(dealIdNum)) return true;
        if (selectedAccountId != null && getPersistedImportedDealIds(selectedAccountId).has(dealIdNum)) return true;
        if (trades && trades.length > 0) {
            return trades.some(t => {
                const matchesTicket = (t.ticketId && String(t.ticketId).trim() === dealIdStr) ||
                                      (t.notes && t.notes.includes(`Deal #${dealIdStr}`));
                if (!matchesTicket) return false;
                return isTradeInPortfolio(t.portfolio_id, targetPortfolioId, defaultPortfolioId);
            });
        }
        return false;
    }, [savedDealIds, selectedAccountId, trades, targetPortfolioId, defaultPortfolioId]);

    const buildDealTrade = (deal: any): Trade => {
        const pairName = getSymbolName(deal);
        const netPnL = Number(((deal.profit ?? 0) + (deal.swap || 0) + (deal.commission || 0)).toFixed(2));
        const closeDate = deal.closeTimestamp ? new Date(deal.closeTimestamp) : new Date();
        const openDate = deal.openTimestamp ? new Date(deal.openTimestamp) : closeDate;

        const sastClose = getSASTDateTime(closeDate);

        return normalizeTrade({
            id: '',
            ticketId: String(deal.dealId || deal.orderId || Date.now()),
            portfolio_id: targetPortfolioId,
            pair: pairName,
            assetType: 'Forex',
            date: sastClose.date,
            time: sastClose.fullTime,
            openTime: openDate.toISOString(),
            closeTime: closeDate.toISOString(),
            direction: deal.tradeSide === 'buy' ? 'Long' : 'Short',
            entryPrice: deal.entryPrice || deal.price || 0,
            exitPrice: deal.price || 0,
            stopLoss: deal.stopLoss || 0,
            takeProfit: deal.takeProfit || 0,
            lots: deal.volume || 0.01,
            result: netPnL > 0 ? 'Win' : netPnL < 0 ? 'Loss' : 'BE',
            pnl: netPnL,
            rr: 0,
            rating: 0,
            tags: ['cTrader'],
            notes: `Synced from cTrader. Deal #${deal.dealId} | Order #${deal.orderId}`,
            planAdherence: 'No Plan',
            tradingMistake: 'None',
            mindset: 'Neutral',
        });
    };

    const persistDealTrade = async (newTrade: Trade) => {
        const stamped: Trade = targetPortfolioId && !(newTrade as Trade).portfolio_id
            ? { ...newTrade, portfolio_id: targetPortfolioId }
            : newTrade;
        const saved = await dataService.addTrade(stamped);
        // dataService preserves portfolio_id on the return, but re-attach as a
        // safety net so the row lands in the visible (active) portfolio.
        if (targetPortfolioId && !(saved as Trade).portfolio_id) {
            (saved as Trade).portfolio_id = targetPortfolioId;
        }
        if (onTradeAdded) {
            onTradeAdded(saved);
        }
        return saved;
    };

    const markDealSaved = (dealId: number | string) => {
        const num = Number(dealId);
        setSavedDealIds(prev => new Set(prev).add(num));
        if (selectedAccountId != null) {
            persistImportedDealIds(selectedAccountId, [num]);
        }
    };

    // --- Shared bulk import engine -------------------------------------------
    // One batchAddTrades call per ≤200 chunk (1 SELECT + 1 INSERT per chunk
    // instead of 2+ round trips per deal), ONE parent state sync at the end
    // (instead of N re-renders), per-deal fallback only for failed chunks.
    const bulkInFlightRef = useRef(false);
    const bulkMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const flashBulkResult = (msg: string | null, ms = 5000) => {
        if (bulkMsgTimerRef.current) {
            clearTimeout(bulkMsgTimerRef.current);
            bulkMsgTimerRef.current = null;
        }
        setBulkResult(msg);
        if (msg != null) {
            bulkMsgTimerRef.current = setTimeout(() => setBulkResult(null), ms);
        }
    };

    const importDealBatch = async (
        pending: any[],
        opts?: { isCancelled?: () => boolean },
    ): Promise<{ added: number; skipped: number; failed: number; firstError: string | null }> => {
        let added = 0;
        let skipped = 0;
        let failed = 0;
        let firstError: string | null = null;
        let done = 0;
        const savedAll: Trade[] = [];
        const okDealIds: number[] = [];
        // chunks are only progress granularity — one parent sync at the end
        const CHUNK = 200;
        for (let i = 0; i < pending.length; i += CHUNK) {
            if (opts?.isCancelled?.()) break;
            const chunk = pending.slice(i, i + CHUNK);
            try {
                const built = chunk.map(d => {
                    const t = buildDealTrade(d);
                    return targetPortfolioId && !(t as Trade).portfolio_id
                        ? { ...t, portfolio_id: targetPortfolioId }
                        : t;
                });
                const result = await dataService.batchAddTrades(built as Trade[]);
                // Web batchAddTrades resolves to the saved rows only — it
                // filters pre-existing tickets before insert, so anything it did
                // not confirm was already in the journal (counted as skipped).
                const confirmed: Trade[] = Array.isArray(result) ? result : [];
                const confirmedTickets = new Set<string>();
                for (const s of confirmed) {
                    const ticket = String((s as Trade).ticketId || '').trim();
                    if (ticket) confirmedTickets.add(ticket);
                    savedAll.push(targetPortfolioId && !(s as Trade).portfolio_id
                        ? { ...s, portfolio_id: targetPortfolioId }
                        : s);
                    added++;
                }
                skipped += Math.max(0, chunk.length - confirmed.length);
                for (const d of chunk) {
                    if (confirmedTickets.has(String(d.dealId).trim())) {
                        const num = Number(d.dealId);
                        if (Number.isFinite(num)) okDealIds.push(num);
                    }
                }
            } catch (err) {
                // Total chunk failure (offline, auth, RLS…): every deal in
                // this chunk failed — stash all for retry, say so loudly.
                console.error('Deal import chunk failed:', err);
                failed += chunk.length;
                if (!firstError) firstError = String((err as any)?.message || err || 'unknown error').slice(0, 220);
                if (selectedAccountId != null) {
                    stashPendingDeals(selectedAccountId, chunk);
                }
            }
            done += chunk.length;
            setBulkProgress({ done, total: pending.length });
        }
        // Tail is exception-safe: a bookkeeping throw must never surface as
        // "spinner stopped, nothing happened".
        try {
            if (okDealIds.length > 0) {
                setSavedDealIds(prev => {
                    const next = new Set(prev);
                    okDealIds.forEach(id => next.add(id));
                    return next;
                });
                if (selectedAccountId != null) {
                    persistImportedDealIds(selectedAccountId, okDealIds);
                    clearPendingDeals(selectedAccountId, okDealIds);
                }
            }
            // Single parent sync for the whole import — not one re-render per row.
            if (savedAll.length > 0) {
                if (onTradesAddedBatch) onTradesAddedBatch(savedAll);
                else if (onTradeAdded) savedAll.forEach(s => onTradeAdded(s));
            }
        } catch (tailErr) {
            console.error('Deal import bookkeeping failed:', tailErr);
            if (!firstError) firstError = `Saved ${added}, but the journal view may need a refresh.`;
        }
        return { added, skipped, failed, firstError };
    };

    // Trade rows already in the journal that came from this account's deals.
    const importedTradeIds = useMemo(() => {
        const tickets = new Set(
            accountDeals.map(d => String(d?.dealId ?? '').trim()).filter(Boolean)
        );
        if (tickets.size === 0) return [];
        return (trades || [])
            .filter(t => t.ticketId && tickets.has(String(t.ticketId).trim()))
            .map(t => t.id);
    }, [accountDeals, trades]);

    const handleRemoveImportedDeals = async () => {
        if (isBulkAdding || bulkInFlightRef.current) return;
        if (importedTradeIds.length === 0) {
            flashBulkResult('No imported trades to remove.');
            return;
        }
        if (typeof window !== 'undefined' && !window.confirm(
            `Remove ${importedTradeIds.length} imported trade${importedTradeIds.length === 1 ? '' : 's'} from your journal? They move to trash and can be restored within 30 days.`
        )) return;
        bulkInFlightRef.current = true;
        try {
            await dataService.deleteTrades(importedTradeIds);
            if (onTradesDeletedBatch) onTradesDeletedBatch(importedTradeIds);
            flashBulkResult(`Removed ${importedTradeIds.length} imported trade${importedTradeIds.length === 1 ? '' : 's'}.`);
        } catch (err) {
            console.error('Failed to remove imported trades:', err);
            flashBulkResult('Failed to remove imported trades. Please try again.');
        } finally {
            bulkInFlightRef.current = false;
        }
    };

    const handleAddDealToJournal = async (deal: any) => {
        try {
            setSavingDealId(deal.dealId);
            await persistDealTrade(buildDealTrade(deal));
            markDealSaved(deal.dealId);
        } catch (err) {
            console.error('Failed to add deal to journal:', err);
            // Stash durably so a retry is one tap away (see retry banner).
            if (selectedAccountId != null && deal) {
                stashPendingDeals(selectedAccountId, [deal]);
            }
            flashBulkResult(`Failed to add deal #${deal?.dealId}: ${(err as any)?.message || 'unknown error'}`, 6000);
        } finally {
            setSavingDealId(null);
        }
    };

    const handleAddAllDealsToJournal = async () => {
        if (isBulkAdding || bulkInFlightRef.current) {
            flashBulkResult('An import is already running — please wait for it to finish.', 4000);
            return;
        }
        if (accountDeals.length === 0) {
            flashBulkResult('No closed deals found on this cTrader account yet.', 4000);
            return;
        }
        const pendingDeals = accountDeals.filter(d => !isDealInJournal(d));
        if (pendingDeals.length === 0) {
            flashBulkResult(`All ${accountDeals.length} trade${accountDeals.length === 1 ? '' : 's'} already in journal — nothing to import.`, 5000);
            return;
        }
        bulkInFlightRef.current = true;
        setIsBulkAdding(true);
        setBulkProgress({ done: 0, total: pendingDeals.length });
        setBulkResult(null);
        try {
            const { added, skipped, failed, firstError } = await importDealBatch(pendingDeals);
            const dest = activePortfolioName || linkPortfolio?.name || 'portfolio';
            if (failed === 0) {
                if (selectedAccountId != null) {
                    ctraderStoreSet(importedKey(selectedAccountId), '1');
                }
                if (added === 0) {
                    flashBulkResult(`Nothing new — all ${pendingDeals.length} already in journal.`, 5000);
                } else {
                    flashBulkResult(
                        skipped > 0
                            ? `Imported ${added} into ${dest} (${skipped} already in journal)`
                            : `Imported ${added} trade${added === 1 ? '' : 's'} into ${dest}`,
                        5000
                    );
                    if (onNavigateToJournal) {
                        setTimeout(() => {
                            setBulkResult(null);
                            onNavigateToJournal();
                        }, 800);
                        return;
                    }
                }
            } else {
                // NEVER navigate if there are failed trades!
                flashBulkResult(
                    `Imported ${added} (${failed} failed, ${skipped} already in journal).${firstError ? ` First error: ${firstError}` : ' Please retry remaining deals.'}`,
                    8000
                );
            }
        } catch (err) {
            console.error('Add-all import failed:', err);
            flashBulkResult(`Import failed: ${String((err as any)?.message || err || 'unknown error').slice(0, 160)}`, 8000);
        } finally {
            bulkInFlightRef.current = false;
            setIsBulkAdding(false);
        }
    };

    const pendingDealsCount = accountDeals.filter(d => !isDealInJournal(d)).length;

    // Deals that failed to persist in a previous session (stashed durably).
    // Offered as a one-tap retry so an APK kill mid-import never loses them.
    const stashedPendingDeals = useMemo(() => {
        if (selectedAccountId == null) return [];
        const stashed = getPendingDeals(selectedAccountId);
        return stashed.filter(d => d && !isDealInJournal(d));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedAccountId, accountDeals, savedDealIds, trades]);

    const handleRetryStashedDeals = async () => {
        if (isBulkAdding || bulkInFlightRef.current) {
            flashBulkResult('An import is already running — please wait for it to finish.', 4000);
            return;
        }
        if (stashedPendingDeals.length === 0) return;
        bulkInFlightRef.current = true;
        setIsBulkAdding(true);
        setBulkProgress({ done: 0, total: stashedPendingDeals.length });
        setBulkResult(null);
        try {
            const { added, skipped, failed, firstError } = await importDealBatch(stashedPendingDeals);
            if (failed === 0) {
                flashBulkResult(`Retried ${stashedPendingDeals.length} deal${stashedPendingDeals.length === 1 ? '' : 's'} — ${added} added${skipped > 0 ? `, ${skipped} already in journal` : ''}.`, 5000);
            } else {
                flashBulkResult(`Retry: ${added} added, ${failed} still failing.${firstError ? ` First error: ${firstError}` : ' Check connection and retry.'}`, 8000);
            }
        } catch (err) {
            console.error('Stashed retry failed:', err);
            flashBulkResult(`Retry failed: ${String((err as any)?.message || err || 'unknown error').slice(0, 160)}`, 8000);
        } finally {
            bulkInFlightRef.current = false;
            setIsBulkAdding(false);
        }
    };

    // --- Guided import helpers (30d default, batch, cancellable) ---
    const dealCloseMs = (d: any): number => {
        if (!d?.closeTimestamp) return 0;
        const t = Date.parse(d.closeTimestamp);
        return Number.isFinite(t) ? t : 0;
    };
    const dealsInLast30d = useMemo(
        () => accountDeals.filter(d => dealCloseMs(d) >= Date.now() - THIRTY_DAYS_MS),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [accountDeals]
    );
    const fmtShortDate = (ms: number) => {
        if (!ms) return '';
        try { return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); } catch { return ''; }
    };
    const rangeBoundsLabel = (deals: any[]): string => {
        if (deals.length === 0) return '';
        let min = Infinity, max = 0;
        for (const d of deals) {
            const t = dealCloseMs(d);
            if (!t) continue;
            if (t < min) min = t;
            if (t > max) max = t;
        }
        if (!Number.isFinite(min) || max === 0) return '';
        return `${fmtShortDate(min)} → ${fmtShortDate(max)}`;
    };
    const destPortfolioName = activePortfolioName || linkPortfolio?.name || 'portfolio';

    const handleGuidedImport = async (range: '30d' | 'all', opts?: { navigate?: boolean }) => {
        if (isBulkAdding || bulkInFlightRef.current) {
            flashBulkResult('An import is already running — please wait for it to finish.', 4000);
            return;
        }
        const candidates = range === '30d' ? dealsInLast30d : accountDeals;
        if (candidates.length === 0) {
            flashBulkResult('No closed deals found in that range yet.', 4000);
            return;
        }
        if (symbolsList.length === 0 && selectedAccountId != null) {
            try {
                const { getSymbolsList } = await import('../services/ctraderService');
                const fetched = await getSymbolsList(selectedAccountId, selectedAccount?.isDemo).catch(() => []);
                if (fetched && fetched.length > 0) setSymbolsList(fetched);
            } catch { /* ignore */ }
        }
        const pending = candidates.filter(d => !isDealInJournal(d));
        if (pending.length === 0) {
            if (selectedAccountId != null) ctraderStoreSet(importedKey(selectedAccountId), '1');
            setShowImportPrompt(false);
            flashBulkResult(`All ${candidates.length} closed deal${candidates.length === 1 ? '' : 's'} already in journal — nothing to import.`, 5000);
            return;
        }
        guidedCancelRef.current = false;
        bulkInFlightRef.current = true;
        setIsBulkAdding(true);
        setBulkProgress({ done: 0, total: pending.length });
        setBulkResult(null);
        let added = 0;
        let failed = 0;
        let done = 0;
        let firstError: string | null = null;
        try {
            const result = await importDealBatch(pending, { isCancelled: () => guidedCancelRef.current });
            added = result.added;
            failed = result.failed;
            firstError = result.firstError;
            done = result.added + result.skipped + result.failed;
        } catch (err) {
            console.error('Guided import failed:', err);
            failed = pending.length - added;
            firstError = String((err as any)?.message || err || 'unknown error').slice(0, 220);
        } finally {
            bulkInFlightRef.current = false;
            setIsBulkAdding(false);
        }
        const cancelled = guidedCancelRef.current;
        const allSucceeded = !cancelled && failed === 0 && done >= pending.length;

        if (allSucceeded && selectedAccountId != null) {
            ctraderStoreSet(importedKey(selectedAccountId), '1');
            setShowImportPrompt(false);
        }

        if (cancelled) {
            flashBulkResult(`Import paused — ${added} closed deal${added === 1 ? '' : 's'} added (${pending.length - done} remaining).`, 5000);
        } else if (failed > 0) {
            // NEVER navigate if there are failed deals! Keep user on import card to retry!
            flashBulkResult(`Imported ${added} closed deal${added === 1 ? '' : 's'} (${failed} failed).${firstError ? ` First error: ${firstError}` : ' Please retry the remaining deals.'}`, 8000);
        } else if (allSucceeded) {
            if (added === 0) {
                flashBulkResult(`Nothing new — all ${pending.length} already in journal.`, 5000);
            } else {
                flashBulkResult(`✓ Successfully imported all ${added} closed deal${added === 1 ? '' : 's'} into ${destPortfolioName}!`, 5000);
                if (opts?.navigate !== false && onNavigateToJournal) {
                    setTimeout(() => {
                        setBulkResult(null);
                        onNavigateToJournal();
                    }, 800);
                    return;
                }
            }
        } else {
            flashBulkResult(`All closed deals already in journal.`, 5000);
            setShowImportPrompt(false);
        }
    };

    // Show guided prompt when there are unimported closed deals on this account
    useEffect(() => {
        if (authState !== 'connected' || selectedAccountId == null || isLoadingDetails || !!detailsError) return;
        if (accountDeals.length === 0) return;
        const ctid = selectedAccountId;
        if (promptShownForRef.current === ctid) return;
        const unimported = accountDeals.filter(d => !isDealInJournal(d));
        if (unimported.length === 0) return;
        promptShownForRef.current = ctid;
        setImportRange(dealsInLast30d.length > 0 ? '30d' : 'all');
        setShowImportPrompt(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authState, selectedAccountId, isLoadingDetails, detailsError, accountDeals, trades]);

    // Auto-sync: append only brand-new closes (never backfill).
    useEffect(() => {
        if (!autoSync || selectedAccountId == null || isLoadingDetails || !!detailsError) return;
        if (isBulkAdding) return;
        if (accountDeals.length === 0) return;
        const ctid = selectedAccountId;
        if (knownSeededForRef.current !== ctid) {
            knownSeededForRef.current = ctid;
            knownDealIdsRef.current = new Set(accountDeals.map(d => Number(d.dealId)));
            return;
        }
        const known = knownDealIdsRef.current;
        const fresh = accountDeals.filter(d => !known.has(Number(d.dealId)) && !isDealInJournal(d));
        accountDeals.forEach(d => known.add(Number(d.dealId)));
        if (fresh.length === 0) return;
        // Only closes from the last 24h — older unseen rows are backfill,
        // left for the guided import / History tab on purpose.
        const cutoff = Date.now() - 24 * 3600 * 1000;
        const recent = fresh.filter(d => dealCloseMs(d) >= cutoff).slice(0, 10);
        if (recent.length === 0) return;
        (async () => {
            let added = 0;
            for (const deal of recent) {
                try {
                    await persistDealTrade(buildDealTrade(deal));
                    markDealSaved(deal.dealId);
                    added++;
                } catch (e) {
                    console.error('Auto-sync failed for deal:', deal.dealId, e);
                }
            }
            if (added > 0) {
                flashBulkResult(`Synced ${added} new close${added === 1 ? '' : 's'} into ${destPortfolioName}.`, 4000);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accountDeals, selectedAccountId, isLoadingDetails, detailsError, autoSync, isBulkAdding]);

    const handleRefreshDetails = async (acc: any) => {
        const id = acc.ctidTraderAccountId;
        setIsLoadingDetails(true);
        setDetailsError('');
        try {
            const { getPositions, getClosedDeals, getPendingOrders, getTrader, getSymbolsList } = await import('../services/ctraderService');
            const isDemo = !!acc.isDemo;
            // Symbols must resolve before deals so absolute prices can be
            // digit-normalized (raw ProtoOA prices are scaled integers).
            const symbols = await getSymbolsList(id, isDemo).catch(() => []);
            const { buildDigitsMap } = await import('../services/ctraderService');
            const digitsById = buildDigitsMap(symbols);
            const [positions, deals, orders, trader] = await Promise.all([
                getPositions(id, isDemo),
                getClosedDeals(id, undefined, undefined, isDemo, digitsById),
                getPendingOrders(id, isDemo),
                getTrader(id, isDemo),
            ]);
            setAccountPositions(positions);
            setAccountDeals(deals);
            setPendingOrders(orders);
            setTraderDetails(trader);

            const uniqueSymbols = symbols.reduce((accList: any[], currentSym: any) => {
                if (!accList.some((item: any) => item.symbolId === currentSym.symbolId)) {
                    accList.push(currentSym);
                }
                return accList;
            }, []);
            const sortedSymbols = uniqueSymbols.sort((a: any, b: any) => (a.symbolName || '').localeCompare(b.symbolName || ''));
            setSymbolsList(sortedSymbols);
            if (sortedSymbols.length > 0) {
                setTradingSymbolId(prev => prev || sortedSymbols[0].symbolId.toString());
                setSubSymbolId(prev => prev || sortedSymbols[0].symbolId.toString());
                setMarginCalcSymbolId(prev => prev || sortedSymbols[0].symbolId.toString());
            }
        } catch (e: any) {
            setDetailsError(e.message || 'Failed to load account details');
        } finally {
            setIsLoadingDetails(false);
        }
    };

    const handleSelectAccount = async (acc: any) => {
        const id = acc.ctidTraderAccountId;
        if (selectedAccountId === id) {
            setSelectedAccountId(null);
            setAccountPositions([]);
            setAccountDeals([]);
            setPendingOrders([]);
            setTraderDetails(null);
            setDetailsError('');
            return;
        }

        setSelectedAccountId(id);
        await handleRefreshDetails(acc);

        // If we arrived from "New cTrader portfolio", link this account to it
        // so the portfolio stops showing "Not linked" and future syncs scope here.
        if (linkPortfolio && onLinkAccount) {
            const extId = String(id);
            const collision = linkCollisionCheck?.('ctrader', extId, linkPortfolio.id);
            if (collision) {
                setLinkMsg({ type: 'error', text: `That account is already linked to “${collision.name}”. Pick another account.` });
            } else {
                setIsLinking(true);
                setLinkMsg(null);
                try {
                    await onLinkAccount(linkPortfolio.id, { provider: 'ctrader', externalAccountId: extId });
                    setLinkMsg({ type: 'success', text: `Linked to “${linkPortfolio.name}” ✓ No PC needed — you’re good to go.` });
                } catch (e: any) {
                    setLinkMsg({ type: 'error', text: e?.message || 'Could not link this portfolio.' });
                } finally {
                    setIsLinking(false);
                }
            }
        }
    };

    // Auto-select when the cTrader ID exposes exactly one account so
    // first-timers don't stall on the picker right after OAuth.
    // Skipped after a manual "All accounts" tap so the button actually sticks.
    useEffect(() => {
        if (manualBackToListRef.current) return;
        if (authState === 'connected' && !isFetchingAccounts && accounts.length === 1 && selectedAccountId === null) {
            void handleSelectAccount(accounts[0]);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authState, isFetchingAccounts, accounts, selectedAccountId]);

    const handlePlaceOrder = async (isDemo: boolean) => {
        if (!selectedAccountId || !tradingSymbolId) return;
        setIsSubmittingOrder(true);
        setTradeResultMsg(null);
        try {
            const { createNewOrder } = await import('../services/ctraderService');
            const limit = tradingLimitPrice ? Number(tradingLimitPrice) : undefined;
            const stop = tradingStopPrice ? Number(tradingStopPrice) : undefined;
            const volumeUnits = tradingVolume * 100000;
            
            await createNewOrder(
                selectedAccountId,
                Number(tradingSymbolId),
                tradingSide,
                volumeUnits,
                limit,
                stop,
                isDemo
            );

            setTradeResultMsg({ type: 'success', text: `Order submitted successfully` });
            setTradingLimitPrice('');
            setTradingStopPrice('');
            
            const acc = accounts.find(a => a.ctidTraderAccountId === selectedAccountId);
            if (acc) await handleRefreshDetails(acc);
        } catch (e: any) {
            setTradeResultMsg({ type: 'error', text: e.message || 'Order submission failed' });
        } finally {
            setIsSubmittingOrder(false);
        }
    };

    const handleClosePosition = async (posId: number, vol: number, isDemo: boolean) => {
        try {
            const { closePosition } = await import('../services/ctraderService');
            await closePosition(selectedAccountId!, posId, vol * 100000, isDemo);
            
            const acc = accounts.find(a => a.ctidTraderAccountId === selectedAccountId);
            if (acc) await handleRefreshDetails(acc);
        } catch (e: any) {
            alert(e.message || 'Failed to close position');
        }
    };

    const handleCancelOrder = async (orderId: number, isDemo: boolean) => {
        try {
            const { cancelOrder } = await import('../services/ctraderService');
            await cancelOrder(selectedAccountId!, orderId, isDemo);
            
            const acc = accounts.find(a => a.ctidTraderAccountId === selectedAccountId);
            if (acc) await handleRefreshDetails(acc);
        } catch (e: any) {
            alert(e.message || 'Failed to cancel order');
        }
    };

    const handleSubscribeToSpots = async (isDemo: boolean) => {
        if (!selectedAccountId || !subSymbolId) return;
        try {
            const { subscribeToSpots } = await import('../services/ctraderService');
            await subscribeToSpots(selectedAccountId, Number(subSymbolId), isDemo);
            
            const sym = symbolsList.find(s => s.symbolId.toString() === subSymbolId);
            const name = sym?.symbolName || `ID ${subSymbolId}`;
            setEventLogs(prev => [
                { time: new Date().toLocaleTimeString(), msg: `Subscribed to live spots for ${name}` },
                ...prev
            ]);
        } catch (e: any) {
            alert(e.message || 'Failed to subscribe to spots');
        }
    };

    const handleCalculateMargin = async (isDemo: boolean) => {
        if (!selectedAccountId || !marginCalcSymbolId) return;
        setIsCalculatingMargin(true);
        setCalculatedMargin(null);
        try {
            const { getExpectedMargin } = await import('../services/ctraderService');
            const volUnits = marginCalcVolume * 100000;
            const res = await getExpectedMargin(selectedAccountId, Number(marginCalcSymbolId), volUnits, isDemo);
            setCalculatedMargin(Number(res.margin ?? 0) / 100);
        } catch (e: any) {
            alert(e.message || 'Failed to calculate margin');
        } finally {
            setIsCalculatingMargin(false);
        }
    };

    const handleDisconnect = async () => {
        try {
            const { logout } = await import('../services/ctraderService');
            logout();
            try { if (userId) localStorage.removeItem(`jfx_connection_mode_${userId}`); } catch { /* blocked */ }
            manualBackToListRef.current = false;
            promptShownForRef.current = null;
            knownSeededForRef.current = null;
            setShowImportPrompt(false);
            setLinkMsg(null);
            setAuthState('idle');
            setAccounts([]);
            setSelectedAccountId(null);
            setAccountPositions([]);
            setAccountDeals([]);
            setPendingOrders([]);
            setTraderDetails(null);
            setSymbolsList([]);
            setProfile(null);
            fetchCalledRef.current = false;
        } catch (e: any) {
            console.error('Failed to log out from cTrader', e);
        }
    };

    const handleFetchAccounts = async () => {
        setIsFetchingAccounts(true);
        setErrorMsg('');
        try {
            const { getAccounts, getTrader } = await import('../services/ctraderService');
            const accs = await getAccounts();
            setAccounts(accs);

            // Auto-select the previously saved account (survives OAuth redirect)
            const { getSelectedAccountId } = await import('../services/ctraderService');
            const savedId = getSelectedAccountId();
            if (savedId !== null && accs.some((a: any) => a.ctidTraderAccountId === savedId)) {
                const savedAcc = accs.find((a: any) => a.ctidTraderAccountId === savedId)!;
                _setSelectedAccountId(savedId);
                // Load details in background (don't await — UI shows list until ready)
                handleRefreshDetails(savedAcc).catch(() => {});
            }

            // Background-fetch live balance/equity for each account individually
            // Each resolves on its own so the list populates progressively
            accs.forEach(async (acc: any) => {
                try {
                    const trader = await getTrader(acc.ctidTraderAccountId, !!acc.isDemo);
                    setAccounts(prev => prev.map((a: any) =>
                        a.ctidTraderAccountId === acc.ctidTraderAccountId
                            ? { ...a, balance: trader.balance, equity: trader.equity }
                            : a
                    ));
                } catch {
                    // Individual account balance load failed — leave as undefined (shows '—')
                }
            });
        } catch (e: any) {
            setErrorMsg(e.message || 'Failed to fetch accounts');
        } finally {
            setIsFetchingAccounts(false);
        }
    };

    useEffect(() => {
        let cancelled = false;
        import('../services/ctraderService').then(async ({ isAuthenticated, refreshToken, getCtidProfile, clearStaleCtraderFlags }) => {
            // Memory tokens are lost on page reloads — silently re-mint them
            // from the server-side session (httpOnly refresh cookie) first.
            if (!isAuthenticated()) {
                await refreshToken().catch(() => false);
            }
            if (cancelled) return;
            // Verify before claiming "connected": a stale local flag must not
            // mask a dead server grant (that dead-end broke agent trading
            // while the UI kept saying "Successfully authenticated").
            if (!isAuthenticated()) {
                try { clearStaleCtraderFlags(); } catch { /* ignore */ }
                setAuthState('idle');
                setErrorMsg('Your cTrader session has expired. Reconnect below — agent API keys start working again right after.');
                setIsFetchingAccounts(false);
                return;
            }
            setAuthState('connected');
            if (isAuthenticated() && !fetchCalledRef.current) {
                fetchCalledRef.current = true;
                handleFetchAccounts();
                getCtidProfile().then(p => setProfile(p)).catch(() => {});
            }
        });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Real-time OAuth resolution listener:
    // When returning from OAuth, App.tsx or ctraderService exchanges the code
    // and fires 'ctrader_auth_success'. We catch it immediately so the UI
    // transitions from 'connecting' to 'connected' in place.
    useEffect(() => {
        let isMounted = true;
        const checkAndTransition = async () => {
            try {
                const { isAuthenticated, getCtidProfile } = await import('../services/ctraderService');
                if (isAuthenticated() && isMounted) {
                    setAuthState('connected');
                    setErrorMsg('');
                    handleFetchAccounts();
                    getCtidProfile().then(p => { if (isMounted) setProfile(p); }).catch(() => {});
                }
            } catch {}
        };

        const onAuthSuccess = () => {
            void checkAndTransition();
        };

        window.addEventListener('ctrader_auth_success', onAuthSuccess);

        // While in 'connecting' state, poll every 800ms so even if an event was missed
        // the screen transitions within <1 second of the token exchange completing.
        let interval: any = null;
        if (authState === 'connecting') {
            interval = setInterval(checkAndTransition, 800);
        }

        // When user switches back from external browser to the app:
        const onVisibilityOrFocus = () => {
            if (document.visibilityState === 'visible' || !document.hidden) {
                void checkAndTransition();
            }
        };
        window.addEventListener('focus', onVisibilityOrFocus);
        document.addEventListener('visibilitychange', onVisibilityOrFocus);

        // Native Capacitor app resume — OPTIONAL and resolved at runtime only.
        // The web bundle has zero @capacitor dependencies, so the specifier is
        // indirect: TypeScript and Vite must not try to resolve it, and the
        // resulting rejection is swallowed by the catch below.
        let capListener: any = null;
        (async () => {
            try {
                const nativeAppModule: string = '@capacitor/app';
                const { App: CapApp } = await import(/* @vite-ignore */ nativeAppModule);
                capListener = await CapApp.addListener('appStateChange', (state: any) => {
                    if (state.isActive) {
                        void checkAndTransition();
                    }
                });
            } catch {}
        })();

        return () => {
            isMounted = false;
            window.removeEventListener('ctrader_auth_success', onAuthSuccess);
            window.removeEventListener('focus', onVisibilityOrFocus);
            document.removeEventListener('visibilitychange', onVisibilityOrFocus);
            if (interval) clearInterval(interval);
            try { capListener?.remove?.(); } catch {}
        };
    }, [authState]);

    // Real-time Event Listener Setup
    useEffect(() => {
        if (!selectedAccountId) return;
        
        let unsub: (() => void) | null = null;
        const currentAcc = accounts.find(a => a.ctidTraderAccountId === selectedAccountId);
        const isDemo = currentAcc ? !!currentAcc.isDemo : true;

        import('../services/ctraderService').then(({ addCtraderListener, PT }) => {
            unsub = addCtraderListener((payloadType, payload, wsIsDemo) => {
                if (wsIsDemo !== isDemo) return;

                if (payloadType === PT.SPOT_EVENT) {
                    if (payload.symbolId) {
                        setLiveTicks(prev => ({
                            ...prev,
                            [payload.symbolId.toString()]: {
                                bid: payload.bid ? Number(payload.bid) : undefined,
                                ask: payload.ask ? Number(payload.ask) : undefined,
                                time: Date.now()
                            }
                        }));
                    }
                } else if (payloadType === PT.EXECUTION_EVENT) {
                    const time = new Date().toLocaleTimeString();
                    const desc = payload.executionType === 1 ? 'Order Filled' : payload.executionType === 2 ? 'Order Cancelled' : 'Execution Update';
                    const symbolId = payload.order?.symbolId;
                    const sym = symbolsList.find(s => s.symbolId === symbolId);
                    const symName = sym?.symbolName || `ID ${symbolId}`;
                    const volLots = payload.order?.volume ? Number(payload.order.volume) / 100000 : 0;
                    
                    setEventLogs(prev => [
                        { time, msg: `🔥 ${desc} - Symbol: ${symName}, Vol: ${volLots.toFixed(2)} lots` },
                        ...prev.slice(0, 19)
                    ]);
                    
                    if (currentAcc) {
                        handleRefreshDetails(currentAcc);
                    }
                } else if (payloadType === PT.TRADER_UPDATE_EVENT) {
                    if (payload.trader) {
                        // Raw WS payload — monetary fields in cents, ÷100 to match
                        // getTrader's normalized output.
                        setTraderDetails(prev => prev ? {
                            ...prev,
                            balance: payload.trader.balance !== undefined ? Number(payload.trader.balance) / 100 : prev.balance,
                            equity: payload.trader.equity !== undefined ? Number(payload.trader.equity) / 100 : prev.equity,
                        } : null);
                    }
                }
            });
        });

        return () => {
            if (unsub) unsub();
        };
    }, [selectedAccountId, accounts, symbolsList]);


    const handleConnect = async () => {
        setAuthState('connecting');
        setErrorMsg('');
        try {
            const { getAuthorizeUrl } = await import('../services/ctraderService');
            window.location.href = getAuthorizeUrl();
        } catch (e: any) {
            setErrorMsg(e.message || 'Failed to initiate cTrader connection');
            setAuthState('error');
        }
    };

    const [manualCode, setManualCode] = useState('');
    const [isExchangingManual, setIsExchangingManual] = useState(false);

    // Manual code paste: on web the OAuth hop is a full page redirect, so this
    // is the escape hatch when the browser never comes back (popup/redirect
    // blocked, wrong tab). Accepts a bare code or a whole redirect URL.
    const handleManualCodeSubmit = async () => {
        const raw = manualCode.trim();
        if (!raw) return;
        setIsExchangingManual(true);
        setErrorMsg('');
        try {
            let extractedCode = raw;
            if (raw.includes('code=')) {
                try {
                    const query = raw.includes('?') ? raw.split('?').slice(1).join('?') : raw;
                    extractedCode = new URLSearchParams(query).get('code') || raw;
                } catch {}
            }
            const { exchangeCode } = await import('../services/ctraderService');
            const res = await exchangeCode(extractedCode, null);
            if (res && res.ok) {
                try { localStorage.setItem('ctrader_just_authorized', 'true'); } catch {}
                setAuthState('connected');
                setManualCode('');
                handleFetchAccounts();
            } else {
                setErrorMsg(res?.error || 'Failed to exchange authorization code. Make sure the code is fresh and valid.');
            }
        } catch (e: any) {
            setErrorMsg(e?.message || 'Error exchanging authorization code');
        } finally {
            setIsExchangingManual(false);
        }
    };

    const linkedAccountId = linkPortfolio?.accounts?.find(a => a.provider === 'ctrader')?.externalAccountId;
    const selectedAccount = accounts.find((a: any) => a.ctidTraderAccountId === selectedAccountId);
    const isAlreadyLinked = !!linkedAccountId && selectedAccountId !== null && String(selectedAccountId) === String(linkedAccountId);
    const isScopeLinked = isAlreadyLinked || linkMsg?.type === 'success' || !!linkedAccountId;

    return (
        <div className="space-y-6">
            <div className="relative mb-6 flex items-center gap-3">
                <button
                    onClick={onBack}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-white/10 text-zinc-400 hover:text-white hover:border-white/20 transition-all flex items-center gap-1.5"
                >
                    <ArrowRight size={12} className="rotate-180" />
                    Back to methods
                </button>
            </div>

            {linkPortfolio && linkPortfolio.source === 'ctrader' && (isScopeLinked ? (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    <p className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-200">“{linkPortfolio.name}” → {linkedAccountId || selectedAccountId || ''}</p>
                    {onDoneLink && !showImportPrompt && (
                        <button onClick={onDoneLink} className="shrink-0 px-2.5 py-1 rounded-lg bg-[#FF4F00] text-white text-[10px] font-bold">Done</button>
                    )}
                </div>
            ) : (
                <div className="rounded-xl border border-[#FF4F00]/20 bg-[#FF4F00]/[0.05] px-3 py-2 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#FF4F00] shrink-0" />
                    <p className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-200">Link “{linkPortfolio.name}” · pick an account below{linkMsg?.type === 'error' ? <span className="text-rose-400"> · {linkMsg.text}</span> : isLinking ? <span className="text-zinc-500"> · linking…</span> : null}</p>
                </div>
            ))}

            <div className="rounded-2xl border border-white/5 bg-black overflow-hidden">
                <div className="px-5 py-4 border-b border-white/5 flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-[#FF4F00]/10">
                        <img src="/icon3.jpeg" alt="cTrader" className="w-10 h-10 object-contain" />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-white">cTrader Open API</h3>
                        <p className="text-[10px] text-zinc-500">Connect via cTrader ID OAuth</p>
                    </div>
                </div>

                <div className="p-5 space-y-5">
                    {authState === 'idle' && (
                        <div className="space-y-4">
                            <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-white/5 bg-white/[0.02]">
                                <svg className="w-4 h-4 text-zinc-500 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                </svg>
                                <p className="text-xs text-zinc-500 leading-relaxed">
                                    You will be redirected to cTrader ID to authorize access to your trading accounts.
                                    Only view permissions are requested — no trading will be performed.
                                </p>
                            </div>
                            <button
                                onClick={handleConnect}
                                className="w-full py-2.5 rounded-xl bg-[#FF4F00] text-white text-sm font-medium hover:bg-[#FF4F00]/90 flex items-center justify-center gap-2 transition-all"
                            >
                                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                                    <polyline points="10 17 15 12 10 7" />
                                    <line x1="15" y1="12" x2="3" y2="12" />
                                </svg>
                                Connect with cTrader ID
                            </button>

                            <div className="p-3 rounded-xl border border-white/10 bg-white/[0.02] space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-medium text-zinc-300">Browser never came back?</span>
                                    <button
                                        type="button"
                                        onClick={handleConnect}
                                        className="text-[11px] text-[#FF4F00] hover:underline flex items-center gap-1"
                                    >
                                        Reopen login
                                    </button>
                                </div>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={manualCode}
                                        onChange={(e) => setManualCode(e.target.value)}
                                        placeholder="Paste code or redirect URL…"
                                        className="flex-1 min-w-0 px-2.5 py-1.5 text-xs rounded-lg border border-white/10 bg-black text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#FF4F00]"
                                    />
                                    <button
                                        type="button"
                                        disabled={!manualCode.trim() || isExchangingManual}
                                        onClick={() => handleManualCodeSubmit()}
                                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#FF4F00] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#FF4F00]/90 transition-all flex items-center gap-1.5 shrink-0"
                                    >
                                        {isExchangingManual ? <Loader2 size={12} className="animate-spin" /> : null}
                                        Connect
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {authState === 'connecting' && (
                        <div className="flex items-center justify-center py-8">
                            <div className="flex flex-col items-center gap-3">
                                <Loader2 size={24} className="animate-spin text-[#FF4F00]" />
                                <p className="text-xs text-zinc-400">Redirecting to cTrader ID...</p>
                            </div>
                        </div>
                    )}

                    {authState === 'connected' && (
                        <div className="space-y-4">
                            {/* Auth success banner with Log Out button */}
                            <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-[#FF4F00]/10 border border-[#FF4F00]/20">
                                <div className="flex items-center gap-2 text-[#FF4F00] text-xs">
                                    <CheckCircle2 size={14} />
                                    <span>Successfully authenticated with cTrader</span>
                                </div>
                                <button
                                    onClick={handleDisconnect}
                                    className="p-1.5 rounded-lg hover:bg-rose-500/10 text-zinc-500 hover:text-rose-500 transition-colors"
                                    title="Disconnect from cTrader"
                                >
                                    <LogOut size={14} />
                                </button>
                            </div>

                            {/* Guided first-import prompt — unimported closed deals */}
                            {showImportPrompt && selectedAccount && (() => {
                                const rangeDeals = importRange === '30d' ? dealsInLast30d : accountDeals;
                                const rangePending = rangeDeals.filter(d => !isDealInJournal(d));
                                const bounds = rangeBoundsLabel(rangeDeals);
                                const pct = bulkProgress.total > 0 ? Math.min(100, Math.round((bulkProgress.done / bulkProgress.total) * 100)) : 0;
                                const pendingAll = accountDeals.filter(d => !isDealInJournal(d)).length;
                                const pending30 = dealsInLast30d.filter(d => !isDealInJournal(d)).length;
                                const accountLabel = selectedAccount.name || `Account #${selectedAccount.login}`;
                                const rangeLabel = importRange === '30d' ? 'Last 30 days' : 'All history';
                                const dismissPrompt = () => {
                                    if (selectedAccountId != null) ctraderStoreSet(dismissedKey(selectedAccountId), '1');
                                    setShowImportPrompt(false);
                                };
                                const handleSwitchAccount = () => {
                                    if (selectedAccountId != null) ctraderStoreSet(dismissedKey(selectedAccountId), '1');
                                    manualBackToListRef.current = true;
                                    promptShownForRef.current = null;
                                    setShowImportPrompt(false);
                                    setSelectedAccountId(null);
                                    try { import('../services/ctraderService').then(m => m.clearSelectedAccountId()).catch(() => {}); } catch { /* noop */ }
                                    setAccountPositions([]);
                                    setAccountDeals([]);
                                    setPendingOrders([]);
                                    setTraderDetails(null);
                                    setDetailsError('');
                                    setActiveTab('positions');
                                };
                                const toggleAutoSync = () => {
                                    const next = !autoSync;
                                    setAutoSync(next);
                                    try { localStorage.setItem('jfx_ctrader_autosync', next ? 'on' : 'off'); } catch { /* blocked */ }
                                };

                                // Done — collapse to a single success row. Only when nothing is
                                // pending in EITHER range, so users can't get stuck.
                                if (!isBulkAdding && rangePending.length === 0) {
                                    const otherPending = importRange === '30d' ? pendingAll - pending30 : 0;
                                    return (
                                        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2.5 flex items-center gap-2.5">
                                            <span className="shrink-0 w-6 h-6 rounded-full bg-emerald-500/15 flex items-center justify-center">
                                                <Check size={14} className="text-emerald-400" />
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-xs font-semibold text-white leading-tight">All caught up</p>
                                                <p className="text-[11px] text-zinc-400 leading-tight mt-0.5 truncate">
                                                    {rangeDeals.length} deal{rangeDeals.length === 1 ? '' : 's'} in journal · {rangeLabel}
                                                    {otherPending > 0 ? ` · ${otherPending} older not imported` : ''}
                                                </p>
                                            </div>
                                            {otherPending > 0 ? (
                                                <button
                                                    type="button"
                                                    onClick={() => setImportRange('all')}
                                                    className="shrink-0 text-[11px] font-semibold text-emerald-300 hover:text-emerald-200 transition-colors"
                                                >
                                                    View {otherPending}
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (selectedAccountId != null) ctraderStoreSet(importedKey(selectedAccountId), '1');
                                                        setShowImportPrompt(false);
                                                    }}
                                                    className="shrink-0 text-[11px] font-semibold text-emerald-300 hover:text-emerald-200 transition-colors"
                                                >
                                                    View details
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={dismissPrompt}
                                                className="shrink-0 text-zinc-500 hover:text-white transition-colors p-1 -m-1"
                                                title="Dismiss"
                                            >
                                                <X size={15} />
                                            </button>
                                        </div>
                                    );
                                }

                                return (
                                    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="w-2 h-2 rounded-full bg-[#FF4F00] animate-pulse shrink-0" />
                                                    <p className="text-xs font-bold text-white leading-tight">
                                                        Import {rangePending.length} deal{rangePending.length === 1 ? '' : 's'}
                                                    </p>
                                                </div>
                                                <p className="text-[11px] text-zinc-400 mt-1 leading-snug truncate" title={`${accountLabel} · ${rangeLabel}${bounds ? ` · ${bounds}` : ''}`}>
                                                    {accountLabel} · {rangeLabel}{bounds ? ` · ${bounds}` : ''}
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={dismissPrompt}
                                                className="text-zinc-500 hover:text-white transition-colors p-1 -m-1"
                                                title="Dismiss prompt and view account details"
                                            >
                                                <X size={15} />
                                            </button>
                                        </div>

                                        {/* Range selector — counts only, bounds merged into subtitle above */}
                                        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-white/[0.06]">
                                            {(([{ id: '30d', label: `Last 30 days · ${dealsInLast30d.length}` }, { id: 'all', label: `All · ${accountDeals.length}` }] as const)).map(r => (
                                                <button
                                                    key={r.id}
                                                    type="button"
                                                    onClick={() => setImportRange(r.id)}
                                                    className={`flex-1 py-1.5 rounded-md text-[11px] font-semibold transition-all ${importRange === r.id ? 'bg-[#FF4F00] text-white shadow-sm' : 'text-zinc-400 hover:text-white'}`}
                                                >
                                                    {r.label}
                                                </button>
                                            ))}
                                        </div>

                                        {/* Action / In-flight progress */}
                                        {isBulkAdding ? (
                                            <div className="p-3 rounded-lg bg-white/[0.06] space-y-2.5">
                                                <div className="flex items-center justify-between text-[11px]">
                                                    <span className="flex items-center gap-1.5 text-white font-medium">
                                                        <Loader2 size={13} className="animate-spin text-[#FF4F00] shrink-0" />
                                                        Importing {bulkProgress.done} of {bulkProgress.total} deals…
                                                    </span>
                                                    <span className="text-[#FF4F00] font-bold tabular-nums">{pct}%</span>
                                                </div>
                                                <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                                                    <div
                                                        className="bg-[#FF4F00] h-full transition-all duration-200 ease-out"
                                                        style={{ width: `${pct}%` }}
                                                    />
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => { guidedCancelRef.current = true; }}
                                                    className="w-full py-1.5 rounded-md bg-white/[0.06] text-[11px] font-semibold text-zinc-400 hover:text-white transition-all"
                                                >
                                                    Pause / Cancel
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => handleGuidedImport(importRange)}
                                                disabled={isBulkAdding}
                                                className="w-full py-2.5 rounded-lg bg-[#FF4F00] hover:bg-[#FF4F00]/90 disabled:opacity-60 disabled:cursor-wait text-white text-xs font-bold shadow-lg shadow-[#FF4F00]/25 flex items-center justify-center gap-2 transition-all active:scale-[0.99]"
                                            >
                                                <Download size={14} />
                                                Import {rangePending.length} closed deal{rangePending.length === 1 ? '' : 's'}
                                            </button>
                                        )}

                                        {/* Status message or error banner */}
                                        {bulkResult && (
                                            <div className={`p-2.5 rounded-lg text-[11px] leading-snug ${
                                                bulkResult.includes('✓')
                                                    ? 'bg-emerald-500/10 text-emerald-300'
                                                    : bulkResult.includes('failed') || bulkResult.includes('Failed')
                                                    ? 'bg-rose-500/10 text-rose-300'
                                                    : 'bg-white/[0.06] text-zinc-300'
                                            }`}>
                                                <p>{bulkResult}</p>
                                            </div>
                                        )}

                                        <details className="group rounded-lg bg-white/[0.06]">
                                            <summary className="px-2.5 py-2 text-[11px] font-semibold text-zinc-400 hover:text-zinc-200 cursor-pointer list-none flex items-center justify-between transition-colors">
                                                <span>Details · {rangeDeals.length} found, {pendingAll} to import</span>
                                                <ChevronDown size={13} className="transition-transform group-open:rotate-180 shrink-0" />
                                            </summary>
                                            <div className="px-2.5 pb-2.5 pt-1 space-y-2">
                                                <p className="text-[10px] text-zinc-500 leading-snug pt-1.5">
                                                    Into {destPortfolioName} · Only closed deals import · Open positions track in real-time
                                                </p>
                                                <div className="flex items-center justify-between gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            if (selectedAccountId != null) ctraderStoreSet(dismissedKey(selectedAccountId), '1');
                                                            setShowImportPrompt(false);
                                                            setActiveTab('history');
                                                        }}
                                                        className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
                                                    >
                                                        Pick manually in History
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={toggleAutoSync}
                                                        className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
                                                        title="New closes sync automatically when open"
                                                    >
                                                        Auto-sync: <span className={autoSync ? 'text-emerald-400 font-semibold' : 'font-semibold'}>{autoSync ? 'On' : 'Off'}</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={handleSwitchAccount}
                                                        className="text-[11px] font-semibold text-[#FF4F00] hover:underline"
                                                    >
                                                        Switch
                                                    </button>
                                                </div>
                                            </div>
                                        </details>
                                    </div>
                                );
                            })()}

                            {/* Loading state while fetching accounts */}
                            {isFetchingAccounts && (
                                <div className="flex items-center justify-center py-6">
                                    <div className="flex flex-col items-center gap-3">
                                        <Loader2 size={20} className="animate-spin text-[#FF4F00]" />
                                        <p className="text-xs text-zinc-400">Loading your trading accounts...</p>
                                    </div>
                                </div>
                            )}

                            {/* Account list — shown as soon as fetched */}
                            {!isFetchingAccounts && accounts.length > 0 && selectedAccountId === null && (
                                <div className="space-y-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 px-1">
                                        Select a connected account ({accounts.length})
                                    </p>
                                    <div className="divide-y divide-white/[0.03] border border-white/5 rounded-xl overflow-hidden">
                                        {accounts.map((acc, i) => (
                                            <button
                                                key={acc.ctidTraderAccountId || i}
                                                onClick={() => handleSelectAccount(acc)}
                                                className={`w-full px-4 py-3.5 flex items-center justify-between hover:bg-white/[0.02] transition-all text-left ${
                                                    selectedAccountId === acc.ctidTraderAccountId
                                                        ? 'ring-1 ring-[#FF4F00]/40 bg-[#FF4F00]/[0.04]'
                                                        : ''
                                                }`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-2 h-2 rounded-full shrink-0 ${acc.isDemo ? 'bg-amber-400' : 'bg-[#FF4F00]'}`} />
                                                    <div>
                                                        <p className="text-xs font-bold text-white">{acc.name || `Account #${acc.login}`}</p>
                                                        <p className="text-[10px] text-zinc-500 mt-0.5">
                                                            {acc.isDemo ? 'Demo' : 'Live'} · {acc.currency}
                                                            {acc.server ? ` · ${acc.server}` : ''}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    {(() => {
                                                        const clash = linkCollisionCheck?.('ctrader', String(acc.ctidTraderAccountId), linkPortfolio?.id);
                                                        return clash ? (
                                                            <span className="block text-[9px] font-semibold text-zinc-500">In “{clash.name}”</span>
                                                        ) : (linkedAccountId && String(acc.ctidTraderAccountId) === String(linkedAccountId)) ? (
                                                            <span className="block text-[9px] font-semibold text-emerald-300">Linked</span>
                                                        ) : null;
                                                    })()}
                                                    <p className="text-xs font-bold text-white tabular-nums">
                                                        {acc.balance !== undefined
                                                            ? `${acc.currency === 'USD' ? '$' : ''}${Number(acc.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                                            : <span className="text-zinc-600 text-[10px]">Loading…</span>
                                                        }
                                                    </p>
                                                    {acc.equity !== undefined && (
                                                        <p className="text-[10px] text-zinc-500 mt-0.5 tabular-nums">
                                                            Eq {Number(acc.equity).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                        </p>
                                                    )}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                    <button
                                        onClick={handleFetchAccounts}
                                        disabled={isFetchingAccounts}
                                        className="w-full py-2 rounded-xl border border-white/10 text-zinc-400 text-xs font-medium hover:text-white hover:border-white/20 flex items-center justify-center gap-2 transition-all disabled:opacity-40 mt-3"
                                    >
                                        <RefreshCw size={12} className={isFetchingAccounts ? 'animate-spin' : ''} />
                                        Refresh Accounts
                                    </button>
                                </div>
                            )}

                            {/* --- Account details sub-panel --- */}
                            {selectedAccountId != null && (
                                        <div className="mt-4 rounded-xl border border-white/5 bg-black overflow-hidden">
                                            {/* Header */}
                                            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between bg-black">
                                                <div className="flex items-center gap-2">
                                                    <Activity size={14} className="text-[#FF4F00]" />
                                                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                                                        Trading Terminal
                                                    </span>
                                                    {profile && (
                                                        <span className="text-[10px] text-zinc-500 bg-white/5 px-2 py-0.5 rounded-full">
                                                            {profile.nickname || profile.email}
                                                        </span>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={() => {
                                                        manualBackToListRef.current = true;
                                                        promptShownForRef.current = null;
                                                        setShowImportPrompt(false);
                                                        setSelectedAccountId(null);
                                                        setAccountPositions([]);
                                                        setAccountDeals([]);
                                                        setPendingOrders([]);
                                                        setTraderDetails(null);
                                                        setDetailsError('');
                                                    }}
                                                    className="p-1 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-all"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>

                                            {/* Broker detection — brand mark for the connected account */}
                                            {selectedAccount && (
                                                <div className="px-4 py-3 border-b border-white/5 flex items-center gap-3">
                                                    <AccountBrokerLogo brokerName={traderDetails?.brokerName || (selectedAccount as any)?.server} />
                                                    <div className="min-w-0">
                                                        <p className="text-[10px] text-zinc-500">Connected broker</p>
                                                        <p className="text-xs font-semibold text-white truncate">{traderDetails?.brokerName || (selectedAccount as any)?.server || 'cTrader Server'}</p>
                                                    </div>
                                                    <span className={`ml-auto text-[9px] font-bold uppercase tracking-wider ${selectedAccount.isDemo ? 'text-amber-400' : 'text-emerald-400'}`}>
                                                        {selectedAccount.isDemo ? 'Demo' : 'Live'}
                                                    </span>
                                                </div>
                                            )}

                                            {/* Backfill nudge — non-empty journal, quiet banner (no modal) */}
                                            {selectedAccount && !isLoadingDetails && !detailsError && !showImportPrompt
                                                && trades && trades.length > 0 && pendingDealsCount > 0
                                                && !ctraderStoreGet(importedKey(selectedAccount.ctidTraderAccountId))
                                                && !(selectedAccount.ctidTraderAccountId in bannerDismissals ? bannerDismissals[selectedAccount.ctidTraderAccountId] : !!ctraderStoreGet(dismissedKey(selectedAccount.ctidTraderAccountId)))
                                                && (
                                                <div className="m-4 mb-0 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 flex items-center gap-2">
                                                    <p className="min-w-0 flex-1 text-[11px] text-zinc-300 leading-snug">
                                                        {pendingDealsCount} unjournaled closed deal{pendingDealsCount === 1 ? '' : 's'} on this account
                                                    </p>
                                                    <button
                                                        type="button"
                                                        disabled={isBulkAdding}
                                                        onClick={() => handleGuidedImport('30d', { navigate: false })}
                                                        className="shrink-0 text-[11px] font-semibold text-[#FF4F00] hover:underline disabled:opacity-40"
                                                    >
                                                        {isBulkAdding ? `${bulkProgress.done}/${bulkProgress.total}` : 'Import 30d'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setActiveTab('history')}
                                                        className="shrink-0 text-[11px] font-semibold text-zinc-400 hover:text-white transition-colors"
                                                    >
                                                        History
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const ctid = selectedAccount.ctidTraderAccountId;
                                                            ctraderStoreSet(dismissedKey(ctid), '1');
                                                            setBannerDismissals(prev => ({ ...prev, [ctid]: true }));
                                                        }}
                                                        className="shrink-0 text-zinc-600 hover:text-white transition-colors p-0.5"
                                                        title="Dismiss"
                                                    >
                                                        <X size={13} />
                                                    </button>
                                                </div>
                                            )}

                                            {/* Stashed retry — deals that failed in a previous session */}
                                            {selectedAccount && stashedPendingDeals.length > 0 && (
                                                <div className="m-4 mb-0 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 flex items-center gap-2">
                                                    <p className="min-w-0 flex-1 text-[11px] text-amber-200/90 leading-snug">
                                                        {stashedPendingDeals.length} deal{stashedPendingDeals.length === 1 ? '' : 's'} failed to save last time
                                                    </p>
                                                    <button
                                                        type="button"
                                                        disabled={isBulkAdding}
                                                        onClick={() => { void handleRetryStashedDeals(); }}
                                                        className="shrink-0 text-[11px] font-semibold text-[#FF4F00] hover:underline disabled:opacity-40"
                                                    >
                                                        {isBulkAdding ? `${bulkProgress.done}/${bulkProgress.total}` : 'Retry now'}
                                                    </button>
                                                </div>
                                            )}

                                            {isLoadingDetails && (
                                                <div className="flex items-center justify-center py-8">
                                                    <Loader2 size={20} className="animate-spin text-[#FF4F00]" />
                                                    <span className="ml-2.5 text-xs text-zinc-400">Synchronizing with cTrader Server…</span>
                                                </div>
                                            )}

                                            {detailsError && (
                                                <div className="flex items-start gap-2.5 px-4 py-4 bg-rose-500/5 text-rose-400 text-xs border-b border-white/5">
                                                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                                                    <span>{detailsError}</span>
                                                </div>
                                            )}

                                            {!isLoadingDetails && !detailsError && (
                                                <div>
                                                    {/* Account Summary Cards */}
                                                    <div className="grid grid-cols-2 md:grid-cols-4 divide-x md:divide-x divide-y md:divide-y-0 divide-white/5 border-b border-white/5 bg-black">
                                                        <div className="p-3">
                                                            <span className="text-[9px] uppercase tracking-wider text-zinc-500">Balance</span>
                                                            <p className="text-sm font-bold text-white mt-0.5 tabular-nums">
                                                                {Number(traderDetails?.balance ?? accounts.find(a => a.ctidTraderAccountId === selectedAccountId)?.balance ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                            </p>
                                                        </div>
                                                        <div className="p-3">
                                                            <span className="text-[9px] uppercase tracking-wider text-zinc-500">Equity</span>
                                                            <p className="text-sm font-bold text-[#FF4F00] mt-0.5 tabular-nums">
                                                                {Number(traderDetails?.equity ?? accounts.find(a => a.ctidTraderAccountId === selectedAccountId)?.equity ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                            </p>
                                                        </div>
                                                        <div className="p-3">
                                                            <span className="text-[9px] uppercase tracking-wider text-zinc-500">Used Margin</span>
                                                            <p className="text-sm font-bold text-white mt-0.5 tabular-nums">
                                                                {Number((traderDetails?.margin ?? 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                            </p>
                                                        </div>
                                                        <div className="p-3">
                                                            <span className="text-[9px] uppercase tracking-wider text-zinc-500">Margin Level</span>
                                                            <p className="text-sm font-bold text-white mt-0.5 tabular-nums">
                                                                {traderDetails?.margin > 0
                                                                    ? `${Number((traderDetails.equity / (traderDetails.margin / 100)) * 100).toFixed(0)}%`
                                                                    : '100%'}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    {/* Tabs Selectors */}
                                                    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/5 bg-black">
                                                        {(['overview', 'positions', 'history', 'market', 'logs'] as const).map((t) => (
                                                            <button
                                                                key={t}
                                                                onClick={() => setActiveTab(t)}
                                                                className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                                                                    activeTab === t
                                                                        ? 'bg-[#FF4F00]/10 text-[#FF4F00]'
                                                                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
                                                                }`}
                                                            >
                                                                {t === 'logs' ? 'Events' : t}
                                                            </button>
                                                        ))}
                                                    </div>

                                                    <div className="p-4">
                                                        {/* Tab Content: OVERVIEW & TRADE PANEL */}
                                                        {activeTab === 'overview' && (
                                                            <div className="space-y-4">
                                                                {/* Account parameters */}
                                                                <div className="grid grid-cols-2 gap-3 text-xs border border-white/5 rounded-xl p-3 bg-black">
                                                                    <div>
                                                                        <span className="text-zinc-500 text-[10px]">Broker Server</span>
                                                                        <p className="font-medium text-white mt-0.5">{traderDetails?.brokerName || 'cTrader Server'}</p>
                                                                    </div>
                                                                    <div>
                                                                        <span className="text-zinc-500 text-[10px]">Leverage</span>
                                                                        <p className="font-medium text-white mt-0.5">1:{traderDetails?.leverageInCents ? traderDetails.leverageInCents / 100 : 100}</p>
                                                                    </div>
                                                                    <div>
                                                                        <span className="text-zinc-500 text-[10px]">Deposit Currency</span>
                                                                        <p className="font-medium text-white mt-0.5">{traderDetails?.depositAsset || 'USD'}</p>
                                                                    </div>
                                                                    <div>
                                                                        <span className="text-zinc-500 text-[10px]">Hedging Enabled</span>
                                                                        <p className="font-medium text-white mt-0.5">{traderDetails?.isHedgingEnabled ? 'Yes' : 'No'}</p>
                                                                    </div>
                                                                </div>

                                                                {/* Manual Order Entry */}
                                                                <div className="border border-white/5 rounded-xl p-4 bg-black space-y-3">
                                                                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Manual Order Desk</p>
                                                                    <div className="grid grid-cols-2 gap-2.5">
                                                                        <div>
                                                                            <label className="text-[10px] text-zinc-500 block mb-1">Select Symbol</label>
                                                                            <select
                                                                                value={tradingSymbolId}
                                                                                onChange={(e) => setTradingSymbolId(e.target.value)}
                                                                                className="w-full text-xs bg-black border border-white/10 rounded-lg py-1.5 px-2 text-white outline-none focus:border-[#FF4F00]/50"
                                                                            >
                                                                                {symbolsList.map((s) => (
                                                                                    <option key={s.symbolId} value={s.symbolId}>{s.symbolName}</option>
                                                                                ))}
                                                                            </select>
                                                                        </div>
                                                                        <div>
                                                                            <label className="text-[10px] text-zinc-500 block mb-1">Lot Volume</label>
                                                                            <input
                                                                                type="number"
                                                                                step="0.01"
                                                                                min="0.01"
                                                                                value={tradingVolume}
                                                                                onChange={(e) => setTradingVolume(Number(e.target.value))}
                                                                                className="w-full text-xs bg-black border border-white/10 rounded-lg py-1.5 px-2 text-white outline-none focus:border-[#FF4F00]/50"
                                                                            />
                                                                        </div>
                                                                        <div>
                                                                            <label className="text-[10px] text-zinc-500 block mb-1">Limit Price (Optional)</label>
                                                                            <input
                                                                                type="number"
                                                                                placeholder="Market Price"
                                                                                value={tradingLimitPrice}
                                                                                onChange={(e) => setTradingLimitPrice(e.target.value)}
                                                                                className="w-full text-xs bg-black border border-white/10 rounded-lg py-1.5 px-2 text-white outline-none focus:border-[#FF4F00]/50"
                                                                            />
                                                                        </div>
                                                                        <div>
                                                                            <label className="text-[10px] text-zinc-500 block mb-1">Stop Price (Optional)</label>
                                                                            <input
                                                                                type="number"
                                                                                placeholder="Market Price"
                                                                                value={tradingStopPrice}
                                                                                onChange={(e) => setTradingStopPrice(e.target.value)}
                                                                                className="w-full text-xs bg-black border border-white/10 rounded-lg py-1.5 px-2 text-white outline-none focus:border-[#FF4F00]/50"
                                                                            />
                                                                        </div>
                                                                    </div>

                                                                    <button
                                                                        type="button"
                                                                        disabled={true}
                                                                        onClick={() => handlePlaceOrder(!!accounts.find(a => a.ctidTraderAccountId === selectedAccountId)?.isDemo)}
                                                                        className="w-full py-2 bg-[#FF4F00]/50 text-white/50 text-xs font-bold uppercase rounded-lg cursor-not-allowed flex items-center justify-center gap-1.5"
                                                                    >
                                                                        {isSubmittingOrder && <Loader2 size={12} className="animate-spin" />}
                                                                        Place Order
                                                                    </button>

                                                                    {tradeResultMsg && (
                                                                        <div className={`p-2 rounded-lg text-[10px] font-bold ${
                                                                            tradeResultMsg.type === 'success'
                                                                                ? 'bg-[#FF4F00]/10 text-[#FF4F00] border border-[#FF4F00]/20'
                                                                                : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                                                        }`}>
                                                                            {tradeResultMsg.text}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Tab Content: POSITIONS & PENDING ORDERS */}
                                                        {activeTab === 'positions' && (
                                                            <div className="space-y-4">
                                                                <div className="rounded-xl border border-white/5 bg-black px-4 py-5 text-center">
                                                                    <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">Open Positions</p>
                                                                    <p className="mt-2 text-sm text-zinc-400">Under development</p>
                                                                </div>

                                                                <div className="rounded-xl border border-white/5 bg-black px-4 py-5 text-center">
                                                                    <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">Pending Orders</p>
                                                                    <p className="mt-2 text-sm text-zinc-400">Under development</p>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Tab Content: HISTORY / CLOSED DEALS */}
                                                        {activeTab === 'history' && (
                                                            <div>
                                                                <div className="flex items-center justify-between mb-2">
                                                                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Deal Execution History</p>
                                                                    <div className="flex items-center gap-2">
                                                                        {bulkResult && <span className="text-[10px] font-bold text-emerald-400">{bulkResult}</span>}
                                                                        {importedTradeIds.length > 0 && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={handleRemoveImportedDeals}
                                                                                disabled={isBulkAdding}
                                                                                className="flex items-center gap-0.5 text-[9px] font-semibold text-zinc-500 hover:text-rose-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                                                                title="Move all trades imported from this account to trash"
                                                                            >
                                                                                Remove imported ({importedTradeIds.length})
                                                                            </button>
                                                                        )}
                                                                        <button
                                                                            type="button"
                                                                            onClick={handleAddAllDealsToJournal}
                                                                            disabled={pendingDealsCount === 0 || isBulkAdding}
                                                                            className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md bg-[#FF4F00]/10 text-[#FF4F00] hover:bg-[#FF4F00]/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                                                            title="Add all deals that are not yet in the journal"
                                                                        >
                                                                            {isBulkAdding ? <Loader2 size={12} className="animate-spin" /> : <PlusCircle size={12} />}
                                                                            {isBulkAdding ? `Adding ${bulkProgress.done}/${bulkProgress.total}` : pendingDealsCount > 0 ? `Add all (${pendingDealsCount})` : 'All in journal'}
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                                {accountDeals.length === 0 ? (
                                                                    <div className="text-center py-6 border border-dashed border-white/5 rounded-xl">
                                                                        <p className="text-xs text-zinc-600">No closed deal logs found</p>
                                                                    </div>
                                                                ) : (
                                                                    <div className="border border-white/10 rounded-lg max-h-[420px] overflow-y-auto overflow-x-auto custom-scrollbar bg-black">
                                                                        <table className="w-full text-left text-xs text-zinc-300 border-collapse">
                                                                            <thead>
                                                                                <tr className="border-b border-white/10 text-[11px] font-medium text-zinc-400">
                                                                                    <th className="py-2.5 px-3 font-normal sticky top-0 z-10 bg-[#18181b] shadow-[inset_0_-1px_0_rgba(255,255,255,0.1)]">Symbol</th>
                                                                                    <th className="py-2.5 px-3 font-normal sticky top-0 z-10 bg-[#18181b] shadow-[inset_0_-1px_0_rgba(255,255,255,0.1)]">Opening direction</th>
                                                                                    <th className="py-2.5 px-3 font-normal sticky top-0 z-10 bg-[#18181b] shadow-[inset_0_-1px_0_rgba(255,255,255,0.1)]">Closing time</th>
                                                                                    <th className="py-2.5 px-3 font-normal sticky top-0 z-10 bg-[#18181b] shadow-[inset_0_-1px_0_rgba(255,255,255,0.1)]">Entry price</th>
                                                                                    <th className="py-2.5 px-3 font-normal sticky top-0 z-10 bg-[#18181b] shadow-[inset_0_-1px_0_rgba(255,255,255,0.1)]">Closing price</th>
                                                                                    <th className="py-2.5 px-3 font-normal sticky top-0 z-10 bg-[#18181b] shadow-[inset_0_-1px_0_rgba(255,255,255,0.1)]">Closing Quantity</th>
                                                                                    <th className="py-2.5 px-3 font-normal sticky top-0 z-10 bg-[#18181b] shadow-[inset_0_-1px_0_rgba(255,255,255,0.1)]">Closing volume</th>
                                                                                    <th className="py-2.5 px-3 font-normal sticky top-0 z-10 bg-[#18181b] shadow-[inset_0_-1px_0_rgba(255,255,255,0.1)]">Net $</th>
                                                                                    <th className="py-2.5 px-3 font-normal text-right sticky top-0 z-10 bg-[#18181b] shadow-[inset_0_-1px_0_rgba(255,255,255,0.1)]">Add to journal</th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody className="divide-y divide-white/5 font-sans">
                                                                                {accountDeals.map((d, idx) => {
                                                                                    const formattedTime = d.closeTimestamp ? (() => {
                                                                                        const dt = new Date(d.closeTimestamp);
                                                                                        if (isNaN(dt.getTime())) return d.closeTimestamp;
                                                                                        const day = String(dt.getDate()).padStart(2, '0');
                                                                                        const month = String(dt.getMonth() + 1).padStart(2, '0');
                                                                                        const year = dt.getFullYear();
                                                                                        const hours = String(dt.getHours()).padStart(2, '0');
                                                                                        const mins = String(dt.getMinutes()).padStart(2, '0');
                                                                                        const secs = String(dt.getSeconds()).padStart(2, '0');
                                                                                        const ms = String(dt.getMilliseconds()).padStart(3, '0');
                                                                                        return `${day}/${month}/${year} ${hours}:${mins}:${secs}.${ms}`;
                                                                                    })() : '-';

                                                                                    const closingVolNum = Number(d.volume || 0) * 100000;
                                                                                    const formattedVol = `$ ${closingVolNum.toLocaleString('en-US').replace(/,/g, ' ')}`;
                                                                                    const netProfit = Number(((d.profit ?? 0) + (d.swap || 0) + (d.commission || 0)).toFixed(2));
                                                                                    const isAlreadyInJournal = isDealInJournal(d);

                                                                                    return (
                                                                                        <tr key={`${d.dealId}_${idx}`} className="hover:bg-white/[0.02] transition-colors">
                                                                                            <td className="py-2.5 px-3 font-bold text-white">{getSymbolName(d)}</td>
                                                                                            <td className="py-2.5 px-3 font-bold text-white capitalize">{d.tradeSide === 'sell' ? 'Long' : 'Short'}</td>
                                                                                            <td className="py-2.5 px-3 font-bold text-white tabular-nums">{formattedTime}</td>
                                                                                            <td className="py-2.5 px-3 font-bold text-white tabular-nums">{d.entryPrice !== undefined ? d.entryPrice : (d.price || '-')}</td>
                                                                                            <td className="py-2.5 px-3 font-bold text-white tabular-nums">{d.price || '-'}</td>
                                                                                            <td className="py-2.5 px-3 font-bold text-white tabular-nums">{Number(d.volume || 0).toFixed(2)} Lots</td>
                                                                                            <td className="py-2.5 px-3 font-bold text-white tabular-nums">{formattedVol}</td>
                                                                                            <td className={`py-2.5 px-3 font-bold tabular-nums ${netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                                                                {netProfit.toFixed(2)}
                                                                                            </td>
                                                                                            <td className="py-2.5 px-3 text-right">
                                                                                                <button
                                                                                                    type="button"
                                                                                                    disabled={savingDealId === d.dealId || isBulkAdding || isAlreadyInJournal}
                                                                                                    onClick={() => handleAddDealToJournal(d)}
                                                                                                    className="p-1 text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
                                                                                                    title={isAlreadyInJournal ? "Already in journal" : "Add to journal"}
                                                                                                >
                                                                                                    {savingDealId === d.dealId ? (
                                                                                                        <Loader2 size={16} className="animate-spin text-[#FF4F00]" />
                                                                                                    ) : isAlreadyInJournal ? (
                                                                                                        <Check size={16} className="text-[#FF4F00]" />
                                                                                                    ) : (
                                                                                                        <PlusCircle size={16} />
                                                                                                    )}
                                                                                                </button>
                                                                                            </td>
                                                                                        </tr>
                                                                                    );
                                                                                })}
                                                                            </tbody>
                                                                        </table>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}

                                                        {/* Tab Content: MARKET TICKERS & MARGIN */}
                                                        {activeTab === 'market' && (
                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                                {/* Live Ticker Subscriptions */}
                                                                <div className="border border-white/5 rounded-xl p-3 bg-white/[0.01] space-y-3">
                                                                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Live Quote Monitor</p>
                                                                    <div className="flex gap-2">
                                                                        <select
                                                                            value={subSymbolId}
                                                                            onChange={(e) => setSubSymbolId(e.target.value)}
                                                                            className="flex-1 text-xs bg-[#0f0f0f] border border-white/10 rounded-lg py-1.5 px-2 text-white outline-none"
                                                                        >
                                                                            {symbolsList.map((s) => (
                                                                                <option key={s.symbolId} value={s.symbolId}>{s.symbolName}</option>
                                                                            ))}
                                                                        </select>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleSubscribeToSpots(!!accounts.find(a => a.ctidTraderAccountId === selectedAccountId)?.isDemo)}
                                                                            className="px-3 bg-white/5 border border-white/10 hover:border-white/20 text-xs font-bold uppercase text-white rounded-lg transition-all"
                                                                        >
                                                                            Subscribe
                                                                        </button>
                                                                    </div>

                                                                    <div className="space-y-1.5 pt-1">
                                                                        {Object.keys(liveTicks).length === 0 ? (
                                                                            <p className="text-[10px] text-zinc-600">No active live subscriptions</p>
                                                                        ) : (
                                                                            Object.entries(liveTicks).map(([symId, tick]) => {
                                                                                const sym = symbolsList.find(s => s.symbolId.toString() === symId);
                                                                                return (
                                                                                    <div key={symId} className="flex items-center justify-between text-xs bg-white/[0.005] p-2 border border-white/5 rounded-lg">
                                                                                        <span className="font-bold text-white">{sym?.symbolName || `ID ${symId}`}</span>
                                                                                        <div className="flex gap-3 text-right text-[11px] tabular-nums">
                                                                                            <div>
                                                                                                <span className="text-[9px] text-zinc-500 block">BID</span>
                                                                                                <span className="text-[#FF4F00] font-medium">{tick.bid || '-'}</span>
                                                                                            </div>
                                                                                            <div>
                                                                                                <span className="text-[9px] text-zinc-500 block">ASK</span>
                                                                                                <span className="text-rose-400 font-medium">{tick.ask || '-'}</span>
                                                                                            </div>
                                                                                        </div>
                                                                                    </div>
                                                                                );
                                                                            })
                                                                        )}
                                                                    </div>
                                                                </div>

                                                                {/* Margin Calculator */}
                                                                <div className="border border-white/5 rounded-xl p-3 bg-white/[0.01] space-y-3">
                                                                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Margin Estimator</p>
                                                                    <div className="space-y-2.5">
                                                                        <div>
                                                                            <label className="text-[10px] text-zinc-500 block mb-1">Select Symbol</label>
                                                                            <select
                                                                                value={marginCalcSymbolId}
                                                                                onChange={(e) => setMarginCalcSymbolId(e.target.value)}
                                                                                className="w-full text-xs bg-[#0f0f0f] border border-white/10 rounded-lg py-1.5 px-2 text-white outline-none"
                                                                            >
                                                                                {symbolsList.map((s) => (
                                                                                    <option key={s.symbolId} value={s.symbolId}>{s.symbolName}</option>
                                                                                ))}
                                                                            </select>
                                                                        </div>
                                                                        <div>
                                                                            <label className="text-[10px] text-zinc-500 block mb-1">Lot Size</label>
                                                                            <input
                                                                                type="number"
                                                                                step="0.01"
                                                                                min="0.01"
                                                                                value={marginCalcVolume}
                                                                                onChange={(e) => setMarginCalcVolume(Number(e.target.value))}
                                                                                className="w-full text-xs bg-[#0f0f0f] border border-white/10 rounded-lg py-1.5 px-2 text-white outline-none"
                                                                            />
                                                                        </div>

                                                                        <button
                                                                            type="button"
                                                                            disabled={isCalculatingMargin || !marginCalcSymbolId}
                                                                            onClick={() => handleCalculateMargin(!!accounts.find(a => a.ctidTraderAccountId === selectedAccountId)?.isDemo)}
                                                                            className="w-full py-1.5 bg-[#FF4F00]/10 border border-[#FF4F00]/20 text-[#FF4F00] text-xs font-bold uppercase rounded-lg hover:bg-[#FF4F00]/20 transition-all flex items-center justify-center gap-1.5"
                                                                        >
                                                                            {isCalculatingMargin && <Loader2 size={12} className="animate-spin" />}
                                                                            Calculate Expected Margin
                                                                        </button>

                                                                        {calculatedMargin !== null && (
                                                                            <div className="p-2 border border-white/5 bg-white/[0.005] rounded-lg text-center">
                                                                                <span className="text-[9px] text-zinc-500 uppercase block">Required Margin</span>
                                                                                <span className="text-sm font-bold text-white tabular-nums">
                                                                                    {traderDetails?.depositAsset || 'USD'} {calculatedMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                                                </span>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Tab Content: EVENT LOGS */}
                                                        {activeTab === 'logs' && (
                                                            <div>
                                                                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-2">Real-time Terminal Logs</p>
                                                                {eventLogs.length === 0 ? (
                                                                    <div className="text-center py-6 border border-dashed border-white/5 rounded-xl">
                                                                        <p className="text-xs text-zinc-600">No events logged yet. Trigger executions or subscribe to spots to generate logs.</p>
                                                                    </div>
                                                                ) : (
                                                                    <div className="border border-white/5 bg-black/20 rounded-xl p-3 max-h-60 overflow-y-auto space-y-1.5 font-mono text-[10px] text-zinc-400">
                                                                        {eventLogs.map((l, idx) => (
                                                                            <div key={idx} className="flex gap-2">
                                                                                <span className="text-zinc-600 shrink-0">[{l.time}]</span>
                                                                                <span className="text-zinc-300 select-all">{l.msg}</span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                            {/* Empty state — fetch completed but no accounts returned */}
                            {!isFetchingAccounts && accounts.length === 0 && !errorMsg && (
                                <div className="text-center py-6 space-y-3">
                                    <p className="text-xs text-zinc-500">No accounts found. Make sure your cTrader ID has linked trading accounts.</p>
                                    <button
                                        onClick={handleFetchAccounts}
                                        className="w-full py-2.5 rounded-xl bg-[#FF4F00] text-white text-sm font-medium hover:bg-[#FF4F00]/90 flex items-center justify-center gap-2 transition-all"
                                    >
                                        <RefreshCw size={14} />
                                        Retry
                                    </button>
                                </div>
                            )}

                            {/* Account fetch error */}
                            {!isFetchingAccounts && errorMsg && (
                                <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-rose-500/10 text-rose-400 text-xs">
                                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                                    <div>
                                        <p className="font-semibold">Could not load accounts</p>
                                        <p className="mt-0.5 text-rose-400/70">{errorMsg}</p>
                                        <button onClick={handleFetchAccounts} className="mt-2 underline text-rose-400 hover:text-rose-300">
                                            Try again
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {authState === 'error' && errorMsg && (
                        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-rose-500/10 text-rose-500 text-xs">
                            <AlertCircle size={14} />
                            {errorMsg}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Bridge;


