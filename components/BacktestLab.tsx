import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
    Play, Pause, ChevronRight, ChevronLeft, RotateCcw,
    XCircle, X,
    Zap, ArrowLeftToLine, StepForward, StepBack, ChevronDown,
    Trash2, Lock, Unlock, Check, Search, Download, FileUp, RefreshCw,
    ZoomIn, ZoomOut, Calendar, List, Star, Loader2, Monitor,
    Maximize, Minimize, LocateFixed, Copy, Palette, Minus,
} from 'lucide-react';
import { useToast } from './ui/Toast';
import Drawer from './ui/Drawer';
import { DrawingToolbarV2 } from './backtest/DrawingToolbarV2';
import { DrawingLayer } from './backtest/DrawingLayer';
import { Drawing, Point, ToolType } from './backtest/types';
import { timeToNearestBarIndex } from './backtest/utils';
import { ColorDrawer, WidthDrawer, LineStyleDrawer, LineStyleKey } from './backtest/DrawingStyleDrawers';
import { usePlacementCursor, PlacementCursorPoint, computeAimGap } from './backtest/usePlacementCursor';
import { useMT5Bridge } from '../hooks/useMT5Bridge';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { MT5_BRIDGE_URL } from '../lib/constants';
import { isNative as isNativePlatform } from '../lib/capacitor';
import { ChartErrorBoundary } from './ChartErrorBoundary';
import { UserProfile, BacktestSession, Trade, BacktestTrade, Candle } from '../types';
import { loadSeries, saveSeries, mergeBars, peekMeta, listCachedSeries, CachedSeriesInfo } from '../lib/candleStore';
import { dataService } from '../services/dataService';
import { fetchCtraderCandles, isAuthenticated as isCtraderAuthenticated, getAccounts as getCtraderAccounts, refreshToken as refreshCtraderToken, getSelectedAccountId } from '../services/ctraderService';
import { fetchSharedCandlesDetailed } from '../lib/sharedCandles';
import CustomChart, { PADDING_RIGHT as PRICE_SCALE_WIDTH } from './CustomChart';
import CtraderAuthModal from './backtest/CtraderAuthModal';
import StartScreen from './backtest/StartScreen';
import { APP_CONSTANTS, normalizePlan } from '../lib/constants';
import { Waves, LayoutDashboard, Target } from 'lucide-react';

interface BacktestLabProps {
    isDarkMode: boolean;
    userProfile: UserProfile;
    onUpdateProfile: (profile: UserProfile) => Promise<void>;
    onChartOpenChange?: (isChartOpen: boolean) => void;
}

const BACKTEST_HISTORY_LIMIT = 50;

const cloneDrawing = (drawing: Drawing): Drawing => ({
    ...drawing,
    p1: { ...drawing.p1 },
    p2: drawing.p2 ? { ...drawing.p2 } : undefined
});

const cloneDrawings = (drawings: Drawing[]) => drawings.map(cloneDrawing);

// When new data is loaded (e.g. another timeframe), the bar-index (logical)
// anchors of existing drawings are stale. TradingView-style: keep every drawing
// pinned to its original timestamp/price and drop the stale index so it renders
// correctly on the newly loaded bars.
const stripLogicalAnchors = (drawings: Drawing[]): Drawing[] =>
    drawings.map(d => ({
        ...d,
        p1: { time: d.p1.time, price: d.p1.price },
        p2: d.p2 ? { time: d.p2.time, price: d.p2.price } : undefined,
    }));

const getReplayIndexKey = (symbol: string, timeframe: string) => `jfx_backtest_currentIndex_${symbol}_${timeframe}`;
const optimizeCandleData = (data: any[]) => data.map(d => ({
    time: d.time,
    open: Number(d.open.toFixed(5)),
    high: Number(d.high.toFixed(5)),
    low: Number(d.low.toFixed(5)),
    close: Number(d.close.toFixed(5))
}));

const formatStaleDate = (value: string | null): string => {
    if (!value) return 'unknown date';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'unknown date';
    return date.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
};

const BACKTEST_TF_SECONDS: Record<string, number> = {
    'M1': 60, 'M5': 300, 'M15': 900, 'M30': 1800, 'H1': 3600, 'H4': 14400, 'D1': 86400
};
const BACKTEST_TFS = Object.keys(BACKTEST_TF_SECONDS);

// Friendly labels for the armed-tool chip.
const TOOL_LABELS: Record<string, string> = {
    cursor: 'Cursor', trendline: 'Trend Line', ray: 'Ray', arrow: 'Arrow',
    horizontal: 'Horizontal Line', vertical: 'Vertical Line', rect: 'Rectangle',
    channel: 'Channel', long: 'Long Position', short: 'Short Position',
    fib: 'Fib Retracement', text: 'Text', measure: 'Measure',
};

// TradingView-style watchlist (same data as ChartGrid)
// ── Fullscreen / orientation (web-safe twin of lib/orientation.ts) ──
// lib/orientation.ts imports @capacitor/core, which this repo deliberately
// does not ship, so landscape locking uses the standard web API behind a
// try/catch. Safari iOS has no lock() at all. The lock is ALWAYS released on
// exit/unmount so the page can never be left stuck sideways.
const lockOrientation = (orientation: string) => {
    try {
        const so = typeof window !== 'undefined' ? (window.screen as any)?.orientation : null;
        if (so && typeof so.lock === 'function') so.lock(orientation);
    } catch { /* unsupported — fullscreen-less Safari / desktop */ }
};

const unlockOrientation = () => {
    try {
        const so = typeof window !== 'undefined' ? (window.screen as any)?.orientation : null;
        if (so && typeof so.unlock === 'function') so.unlock();
    } catch { /* no-op */ }
};

export const WATCHLISTS: Record<string, string[]> = {    'Forex': [
        'FX:EURUSD', 'FX:GBPUSD', 'FX:USDJPY', 'FX:AUDUSD', 'FX:USDCAD', 'FX:USDCHF', 'FX:NZDUSD',
        'FX:EURGBP', 'FX:EURJPY', 'FX:GBPJPY', 'FX:CADJPY', 'FX:AUDJPY', 'FX:CHFJPY',
        'FX:EURAUD', 'FX:GBPAUD', 'FX:EURCAD', 'FX:GBPCAD', 'FX:AUDNZD', 'FX:NZDJPY'
    ],
    'Crypto': [
        'BINANCE:BTCUSD', 'BINANCE:ETHUSD', 'BINANCE:SOLUSD', 'BINANCE:XRPUSD', 'BINANCE:BNBUSD',
        'BINANCE:ADAUSD', 'BINANCE:DOGEUSD', 'BINANCE:AVAXUSD', 'BINANCE:DOTUSD',
        'BINANCE:MATICUSD', 'BINANCE:LINKUSD', 'BINANCE:LTCUSD', 'BINANCE:SHIBUSD', 'BINANCE:UNIUSD'
    ],
    'Indices': [
        'OANDA:SPX500USD', 'OANDA:NAS100USD', 'TVC:US30', 'TVC:RUT',
        'TVC:DE40', 'TVC:UK100', 'TVC:FR40', 'TVC:EU50',
        'TVC:JP225', 'TVC:HSI', 'OANDA:AU200AUD', 'TVC:CN50'
    ],
    'Commodities': [
        'OANDA:XAUUSD', 'OANDA:XAGUSD', 'TVC:PLATINUM', 'TVC:PALLADIUM',
        'TVC:USOIL', 'TVC:UKOIL', 'TVC:NG1!',
        'TVC:HG1!', 'TVC:ZC1!', 'TVC:ZW1!'
    ]
};

const BacktestLab: React.FC<BacktestLabProps> = ({ isDarkMode, userProfile, onUpdateProfile, onChartOpenChange }) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<any>(null);
    const candlestickSeriesRef = useRef<any>(null);
    const { addToast } = useToast();

    // MT5 Bridge & Data
    const [symbol, setSymbol] = useLocalStorage<string>('jfx_backtest_symbol', 'EURUSD');
    const [timeframe, setTimeframe] = useLocalStorage<string>('jfx_backtest_tf', 'H1');
    const {
        isFetching,
        allData, setAllData, currentIndex, setCurrentIdx, fetchData
    } = useMT5Bridge(symbol, timeframe);

    // Persist currentIndex
    useEffect(() => {
        localStorage.setItem(getReplayIndexKey(symbol, timeframe), currentIndex.toString());
    }, [currentIndex, symbol, timeframe]);

    // Restore currentIndex on mount if data exists
    useEffect(() => {
        const saved = localStorage.getItem(getReplayIndexKey(symbol, timeframe));
        if (saved && allData.length > 0) {
            const idx = parseInt(saved);
            if (!isNaN(idx) && idx < allData.length) {
                setCurrentIdx(idx);
            }
        }
    }, [allData.length, symbol, timeframe, setCurrentIdx]);

    // UI State
    const [dataSource, setDataSource] = useLocalStorage<'live' | 'cache' | 'ctrader' | 'none'>('jfx_backtest_data_source', 'none');
    // Explicit user-facing data source so timeframe/symbol changes never route
    // to the wrong backend (e.g. MT5 bridge errors while connected to cTrader).
    // Shared/cTrader history is primary; MT5 localhost bridge is an explicit
    // opt-in fallback only (see handleFetchMT5Data).
    const [activeSource, setActiveSource] = useLocalStorage<'mt5' | 'ctrader'>('jfx_backtest_active_source', 'ctrader');
    const [isCtraderFetching, setIsCtraderFetching] = useState(false);
    // Chart-area loading feedback: while a pair/timeframe load is in flight,
    // dim the previous candles under a "Loading SYM · TF" overlay so users
    // always see why nothing appears to happen yet. The label only becomes
    // visible after a short delay so instant cache hits / fast MT5 responses
    // never flash the overlay.
    const [chartLoadingLabel, setChartLoadingLabel] = useState<string | null>(null);
    const chartLoadingTimerRef = useRef<number | null>(null);
    // Monotonic sequence for user-initiated data loads: a slow response from a
    // previously selected pair must never overwrite or dismiss a newer one.
    const activeFetchSeqRef = useRef(0);
    const beginChartLoading = useCallback((label: string) => {
        if (chartLoadingTimerRef.current) window.clearTimeout(chartLoadingTimerRef.current);
        chartLoadingTimerRef.current = window.setTimeout(() => setChartLoadingLabel(label), 350);
    }, []);
    const endChartLoading = useCallback(() => {
        if (chartLoadingTimerRef.current) {
            window.clearTimeout(chartLoadingTimerRef.current);
            chartLoadingTimerRef.current = null;
        }
        setChartLoadingLabel(null);
    }, []);
    useEffect(() => () => {
        if (chartLoadingTimerRef.current) window.clearTimeout(chartLoadingTimerRef.current);
    }, []);
    const [showCtraderAuthModal, setShowCtraderAuthModal] = useState(false);
    // Live cTrader auth status: re-checked on an interval and when the tab
    // regains focus, so returning from the cTrader OAuth flow (Settings or the
    // Connect modal) is picked up automatically without a manual refresh.
    const [ctraderConnected, setCtraderConnected] = useState<boolean>(() => isCtraderAuthenticated());
    // Shown when the shared store served stale bars and no live cTrader
    // fallback was available, so old data is never rendered silently.
    const [dataNotice, setDataNotice] = useState<string | null>(null);

    // TradingView-style watchlist sidebar
    const [isWatchlistOpen, setIsWatchlistOpen] = useState(false);
    const [watchlistCategory, setWatchlistCategory] = useState<string>('Forex');
    const [starredSymbols, setStarredSymbols] = useLocalStorage<string[]>('jfx_watchlist_starred', []);

    // Screen follows the device sensor: release any previously persisted
    // orientation lock on mount so portrait/landscape switch automatically.
    useEffect(() => {
        unlockOrientation();
    }, []);

    useEffect(() => {
        setDataNotice(null);
    }, [symbol, timeframe]);

    useEffect(() => {
        let mounted = true;
        const check = async () => {
            let authed = isCtraderAuthenticated();
            if (!authed) {
                // Returning from the OAuth callback may have set an httpOnly
                // cookie; try a silent refresh to re-establish the session.
                try { await refreshCtraderToken(); } catch { /* keep status */ }
                authed = isCtraderAuthenticated();
            }
            if (mounted) setCtraderConnected(authed);
        };
        check();
        const interval = window.setInterval(check, 5000);
        const onFocus = () => check();
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onFocus);
        return () => {
            mounted = false;
            window.clearInterval(interval);
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onFocus);
        };
    }, []);

    // cTrader Historical Date Configuration
    const [ctraderFetchSymbol, setCtraderFetchSymbol] = useState(symbol);
    const [ctraderFetchTimeframe, setCtraderFetchTimeframe] = useState(timeframe);
    const [ctraderFetchDate, setCtraderFetchDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        return d.toISOString().slice(0, 10);
    });
    const [ctraderFetchTime, setCtraderFetchTime] = useState('00:00');
    const [ctraderFetchCount, setCtraderFetchCount] = useState(500);
    const [ctraderStartReplayAtFirst, setCtraderStartReplayAtFirst] = useState(true);

    useEffect(() => {
        setCtraderFetchSymbol(symbol);
    }, [symbol]);

    useEffect(() => {
        setCtraderFetchTimeframe(timeframe);
    }, [timeframe]);

    // Check for cached data at initialization to prevent flash
    const hasCachedData = (() => {
        if (dataSource === 'cache') {
            const stored = localStorage.getItem('jfx_backtest_cached_chart');
            if (stored) {
                try {
                    const parsed = JSON.parse(stored);
                    return parsed && parsed.data && parsed.data.length > 0;
                } catch { return false; }
            }
        }
        return false;
    })();

    const [showWelcome, setShowWelcome] = useState(!hasCachedData);
    // Fullscreen canvas (landscape): hides the top header and floats the
    // replay dock + this toggle over the chart. Auto-exits on lab menu.
    const [isFullscreenCanvas, setIsFullscreenCanvas] = useState(false);
    useEffect(() => {
        if (showWelcome) setIsFullscreenCanvas(false);
    }, [showWelcome]);
    // Chart open = a chart is on screen (welcome/lab menu dismissed).
    // Parent (MobileLayout) uses this to hide the global MobileDock and
    // show the replay dock instead. Restored when the back button sets
    // showWelcome back to true.
    const isChartOpen = !showWelcome;
    useEffect(() => {
        onChartOpenChange?.(isChartOpen);
    }, [isChartOpen, onChartOpenChange]);
    // Load cached chart data when dataSource is cache
    useEffect(() => {
        if (dataSource === 'cache') {
            const storedData = localStorage.getItem('jfx_backtest_cached_chart');
            if (storedData) {
                try {
                    const parsed = JSON.parse(storedData);
                    if (parsed && parsed.data && parsed.data.length > 0) {
                        setAllData(parsed.data);
                        setCurrentIdx(parsed.index || 0);
                    }
                } catch (e) {
                    console.error('Failed to load cached chart data', e);
                }
            }
        }
    }, [dataSource]);

    const [bridgeStatus, setBridgeStatus] = useState<'online' | 'offline' | 'checking' | 'error'>('checking');
    const [bridgeError, setBridgeError] = useState<string | null>(null);

    // Bridge Heartbeat (web/desktop only). On the native APK localhost is the
    // phone itself, never the PC running MT5 — skip the ping and stay offline
    // so all loads serve shared/cTrader history without failing localhost calls.
    useEffect(() => {
        if (isNativePlatform) {
            setBridgeStatus('offline');
            setBridgeError('Bridge Offline');
            return;
        }
        let cancelled = false;
        const checkBridge = async () => {
            try {
                // no-cors avoids CSP blocking localhost; opaque response = server is reachable
                await fetch(`${MT5_BRIDGE_URL}/ping`, { mode: 'no-cors' });
                if (cancelled) return;
                setBridgeStatus(prev => prev !== 'online' ? 'online' : prev);
                setBridgeError(null);
            } catch {
                if (cancelled) return;
                setBridgeStatus(prev => prev !== 'offline' ? 'offline' : prev);
                setBridgeError(prev => prev !== 'Bridge Offline' ? 'Bridge Offline' : prev);
            }
        };
        checkBridge();
        const interval = setInterval(checkBridge, 10000);
        return () => { cancelled = true; clearInterval(interval); };
    }, []);

    // One-time migration: previous default was 'mt5', so browsers with no
    // explicit choice still route every symbol/TF change through the localhost
    // bridge and surface "MT5 Sync Failed". When the bridge is offline, move
    // those implicit users to the shared/cTrader path (explicit MT5 selection
    // while the bridge is online is left untouched).
    useEffect(() => {
        if (activeSource === 'mt5' && bridgeStatus === 'offline') {
            setActiveSource('ctrader');
        }
    }, [activeSource, bridgeStatus, setActiveSource]);

    // Replay State
    const [isPlaying, setIsPlaying] = useState(false);
    const [isAutoFollow, setIsAutoFollow] = useLocalStorage<boolean>('jfx_backtest_autofollow', true);
    const [history, setHistory] = useLocalStorage<BacktestTrade[]>('jfx_backtest_history', []);
    const [playSpeed, setPlaySpeed] = useLocalStorage<number>('jfx_backtest_playSpeed', 500);
    const [isSpeedMenuOpen, setIsSpeedMenuOpen] = useState(false);
    // Mobile sheets: speed picker + jump-to-bar (TV-style bottom sheets).
    const [isSpeedSheetOpen, setIsSpeedSheetOpen] = useState(false);
    const [isJumpSheetOpen, setIsJumpSheetOpen] = useState(false);
    const [jumpInput, setJumpInput] = useState('');
    // Selection-pill style drawers: which one is open (null = none).
    const [styleDrawer, setStyleDrawer] = useState<'color' | 'width' | 'style' | null>(null);
    // Fullscreen dock auto-fade (TV controls dim after 3s idle).
    const [dockFaded, setDockFaded] = useState(false);
    const dockIdleTimer = useRef<number | null>(null);
    const pokeDock = useCallback(() => {
        setDockFaded(false);
        if (dockIdleTimer.current) window.clearTimeout(dockIdleTimer.current);
        if (isFullscreenCanvas) {
            dockIdleTimer.current = window.setTimeout(() => setDockFaded(true), 3000);
        }
    }, [isFullscreenCanvas]);
    useEffect(() => {
        pokeDock();
        return () => { if (dockIdleTimer.current) window.clearTimeout(dockIdleTimer.current); };
    }, [pokeDock, currentIndex, isPlaying, isFullscreenCanvas]);
    const [zoomLevel, setZoomLevel] = useLocalStorage<number>('jfx_backtest_zoom', 100);

    // Zoom handlers
    const handleZoomIn = useCallback(() => {
        if (!chartRef.current) return;
        const currentBarSpacing = chartRef.current.timeScale().width ? (chartRef.current.timeScale().width() / 100) : 10; // Fallback or use current if possible
        // Actually we can just track zoomLevel and calculate a factor
        const newZoom = Math.min(500, zoomLevel + 10);
        setZoomLevel(newZoom);
        
        // Calculate new barSpacing based on zoomLevel (100% = 10px)
        const newBarSpacing = (newZoom / 100) * 10;
        chartRef.current.timeScale().applyOptions({ barSpacing: newBarSpacing });
    }, [zoomLevel, setZoomLevel]);

    const handleZoomOut = useCallback(() => {
        if (!chartRef.current) return;
        const newZoom = Math.max(10, zoomLevel - 10);
        setZoomLevel(newZoom);
        
        const newBarSpacing = (newZoom / 100) * 10;
        chartRef.current.timeScale().applyOptions({ barSpacing: newBarSpacing });
    }, [zoomLevel, setZoomLevel]);

    const handleResetView = useCallback(() => {
        if (!chartRef.current) return;
        setZoomLevel(100);
        chartRef.current.timeScale().applyOptions({ barSpacing: 10 });
        chartRef.current.timeScale().scrollToRealtime();
        addToast({ type: 'info', title: 'View Reset', message: 'Chart zoom and position restored.', duration: 1500 });
    }, [setZoomLevel, addToast]);


    // Tools State
    const [activeTool, setActiveTool] = useState<ToolType>('cursor');
    const [isLocked, setIsLocked] = useLocalStorage<boolean>('jfx_backtest_locked', false);
    const [drawings, setDrawings] = useLocalStorage<Drawing[]>('jfx_backtest_drawings', []);
    const [toolDefaults, setToolDefaults] = useLocalStorage<Record<string, any>>('jfx_tool_defaults', {
        trendline: { color: '#2962ff', strokeWidth: 1, strokeStyle: 'solid' },
        ray: { color: '#2962ff', strokeWidth: 1, strokeStyle: 'solid' },
        arrow: { color: '#2962ff', strokeWidth: 1, strokeStyle: 'solid' },
        rect: { color: '#2962ff', strokeWidth: 1, strokeStyle: 'solid' },
        vertical: { color: '#2962ff', strokeWidth: 1, strokeStyle: 'solid' },
        horizontal: { color: '#2962ff', strokeWidth: 1, strokeStyle: 'solid' },
        long: { color: '#10b981', strokeWidth: 1, strokeStyle: 'solid', rr2: 2, rr3: 3 },
        short: { color: '#ef4444', strokeWidth: 1, strokeStyle: 'solid', rr2: 2, rr3: 3 },
        fib: { color: '#2962ff', strokeWidth: 1, strokeStyle: 'solid' },
        channel: { color: '#2962ff', strokeWidth: 1, strokeStyle: 'solid' },
        text: { color: '#2962ff', fontSize: 14 },
    });
    const [currentDrawing, setCurrentDrawing] = useState<Drawing | null>(null);
    const [mousePos, setMousePos] = useState<{ x: number, y: number } | null>(null);
    const [magnetMode, setMagnetMode] = useLocalStorage<boolean>('jfx_backtest_magnet', false);
    const [currentColor, setCurrentColor] = useLocalStorage<string>('jfx_backtest_color', '#2962ff');
    // Selection & Edit State
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const selectedDrawingId = selectedIds.length ? selectedIds[selectedIds.length - 1] : null;
    const [stickyMode, setStickyMode] = useLocalStorage<boolean>('jfx_tool_sticky', false);
    const [snapIndicator, setSnapIndicator] = useState<{ x: number, y: number } | null>(null);


    const [hoveredDrawingId, setHoveredDrawingId] = useState<string | null>(null);
    const [dragState, setDragState] = useState<{ drawingId: string, handle: 'p1' | 'p2' | 'move' | 'target' | 'stop' | 'entry' } | null>(null);
    const [dragStartPos, setDragStartPos] = useState<{ time: number, price: number, logical?: number } | null>(null);

    const selectedDrawing = useMemo(() => drawings.find(d => d.id === selectedDrawingId) || null, [drawings, selectedDrawingId]);
    const currentStrokeWidth = selectedDrawing?.strokeWidth || toolDefaults[activeTool]?.strokeWidth || 1;
    const currentStrokeStyle = selectedDrawing?.strokeStyle || toolDefaults[activeTool]?.strokeStyle || 'solid';
    const currentToolbarColor = selectedDrawing?.color || currentColor || toolDefaults[activeTool]?.color || '#2962ff';

    const [chartViewState, setChartViewState] = useLocalStorage<any>(`jfx_backtest_viewstate_${symbol}_${timeframe}`, null);

    const handleViewStateChange = useCallback((state: any) => {
        setChartViewState(state);
        // Sync zoomLevel percentage (100% = 10px scaleX)
        if (state.scaleX !== undefined) {
            const newZoom = Math.round((state.scaleX / 10) * 100);
            if (newZoom !== zoomLevel) {
                setZoomLevel(newZoom);
            }
        }
    }, [zoomLevel, setZoomLevel, setChartViewState, symbol, timeframe]);

    // Toolbar State (docked V2: left rail or top bar — no free-floating drag).
    // V1's fixed+drag overlay forced the chart canvas to recomposite every
    // pointermove (shadow-2xl layer over a GPU-resident canvas + backdrop-blur
    // churn), which is what made dragging feel slow/laggy. V2 is a static
    // flex sibling of the chart: zero window listeners, zero transforms,
    // zero overlap — the chart lays out once beside it and never repaints
    // because of the toolbar.
    // Stable toolbar props (perf): BacktestLab re-renders on every
    // chart mousemove (mousePos) and replay tick. Fresh inline props defeated
    // the toolbar's React.memo, re-rendering 25+ buttons per mousemove and
    // saturating the main thread. These stay referentially stable, so the
    // toolbar only renders when something it displays actually changes.
    const [toolbarOrientation, setToolbarOrientation] = useLocalStorage<'horizontal' | 'vertical'>('jfx_backtest_toolbar_orientation_v2', 'vertical');
    const toggleMagnetModeCb = useCallback(() => setMagnetMode((v: boolean) => !v), [setMagnetMode]);
    // Toolbar lock = Unlock-all (TradingView parity): locked drawings are
    // click-through so canvas pan works starting on top of them. Pressing the
    // button while anything is locked clears ALL locks (global + per-drawing).
    const toggleLockedCb = useCallback(() => {
        if (isLocked) {
            setDrawings(prev => prev.map(d => (d.isLocked ? { ...d, isLocked: false } : d)));
            setSelectedIds([]);
            setIsLocked(false);
        } else if (drawings.some(d => d.isLocked)) {
            setDrawings(prev => prev.map(d => (d.isLocked ? { ...d, isLocked: false } : d)));
            setSelectedIds([]);
        } else {
            setSelectedIds([]);
            setIsLocked(true);
        }
    }, [isLocked, drawings, setDrawings, setIsLocked]);
    // Show the toolbar as locked when global lock OR any single drawing is
    // locked, so users can discover the unlock-all action.
    const toolbarLocked = isLocked || drawings.some(d => d.isLocked);
    // Locked drawings are click-through: drop them from selection (and close
    // their settings) so no selection glow gets stuck and pan stays free.
    useEffect(() => {
        setSelectedIds(prev => {
            if (prev.length === 0) return prev;
            if (isLocked) return [];
            const next = prev.filter(id => {
                const d = drawings.find(x => x.id === id);
                return d && !d.isLocked;
            });
            return next.length === prev.length ? prev : next;
        });
        if (styleDrawer) {
            const ids = selectedIds.length ? selectedIds : [];
            const anyValid = ids.some(id => {
                const d = drawings.find(x => x.id === id);
                return d && !d.isLocked;
            });
            if (!anyValid || isLocked) setStyleDrawer(null);
        }
    }, [isLocked, drawings, selectedIds, styleDrawer]);
    const toggleToolbarOrientationCb = useCallback(() => setToolbarOrientation(prev => (prev === 'horizontal' ? 'vertical' : 'horizontal')), [setToolbarOrientation]);

// Replay Modes
    const [isSelectBarMode, setIsSelectBarMode] = useState(false);
    // TradingView-style replay cut: draggable vertical selector snapped to bar index
    const [selectBarIndex, setSelectBarIndex] = useState<number | null>(null);

    // Keep selector anchored when entering select-bar mode
    useEffect(() => {
        if (isSelectBarMode) {
            setSelectBarIndex(currentIndex);
        } else {
            setSelectBarIndex(null);
        }
    }, [isSelectBarMode]);
    // Keep selector clamped when data length changes
    useEffect(() => {
        if (isSelectBarMode && selectBarIndex !== null && allData.length > 0) {
            if (selectBarIndex < 0) setSelectBarIndex(0);
            if (selectBarIndex >= allData.length) setSelectBarIndex(allData.length - 1);
        }
    }, [allData.length]);
    // First-run hint for Select-Bar mode (drag-vs-tap).
    useEffect(() => {
        if (isSelectBarMode && typeof window !== 'undefined' && !localStorage.getItem('jfx_bar_hint_seen')) {
            localStorage.setItem('jfx_bar_hint_seen', '1');
            addToast({ type: 'info', title: 'Select Bar', message: 'Drag the line to preview, then tap to cut replay there.' });
        }
    }, [isSelectBarMode, addToast]);
    const [isTFMenuOpen, setIsTFMenuOpen] = useState(false);
    const [isSourceMenuOpen, setIsSourceMenuOpen] = useState(false);
    const [isHistoryFetchOpen, setIsHistoryFetchOpen] = useState(false);
    const importFileRef = useRef<HTMLInputElement | null>(null);

    const [clipboard, setClipboard] = useState<Drawing | null>(null);

    // Latest-ref for resetAim (declared below via usePlacementCursor).
    // resetDrawingInteractionState must stay up here (earlier callbacks list
    // it in their deps), so it calls resetAim through this ref instead of
    // reading the binding directly, which would hit its TDZ on first render.
    const resetAimRef = useRef<() => void>(() => {});
    const resetDrawingInteractionState = useCallback(() => {
        setSelectedIds([]);
        setHoveredDrawingId(null);
        setCurrentDrawing(null);
        placingOneClickRef.current = null;
        setClipboard(null);
        setDragState(null);
        setDragStartPos(null);
        setStyleDrawer(null);
        resetAimRef.current();
    }, []);

// Undo/Redo State
    const [historyStates, setHistoryStates] = useLocalStorage<Drawing[][]>('jfx_backtest_drawing_states', []);
    const [historyPointer, setHistoryStep] = useLocalStorage<number>('jfx_backtest_drawing_pointer', -1);
    const historyStatesRef = useRef<Drawing[][]>([]);
    const historyPointerRef = useRef(-1);

    const [isImporting, setIsImporting] = useState(false);
    const importTimeoutRef = useRef<number | null>(null);

useEffect(() => {
        historyStatesRef.current = historyStates;
    }, [historyStates]);

    useEffect(() => {
        historyPointerRef.current = historyPointer;
    }, [historyPointer]);

    // Only persist for cache mode (import json / recent session), not for live sync
    useEffect(() => {
        if (dataSource === 'live') {
            setHistory([]);
            setHistoryStates([]);
            setHistoryStep(-1);
        }
    }, [dataSource]);

    useEffect(() => {
        return () => {
            if (importTimeoutRef.current !== null) {
                window.clearTimeout(importTimeoutRef.current);
            }
        };
    }, []);

    const centerChart = useCallback(() => {
        if (!chartRef.current) return;
        chartRef.current.timeScale().fitContent();
    }, []);

    // Persistent incremental history: fetched bars are merged into the store
    // (dedupe by bar open time) so deep history accumulates across sessions
    // instead of being replaced by each fetch window.
    const saveToLocalCache = useCallback((data: any[], overrideSymbol?: string, overrideTimeframe?: string) => {
        try {
            const activeSymbol = overrideSymbol || symbol;
            const activeTF = overrideTimeframe || timeframe;
            const merged = mergeBars(loadSeries(activeSymbol, activeTF), (Array.isArray(data) ? data : []) as Candle[]);
            if (merged.length === 0) return;
            saveSeries(activeSymbol, activeTF, merged);
            // Legacy global blob used by the welcome-screen restore.
            localStorage.setItem('jfx_backtest_cached_chart', JSON.stringify({
                data: optimizeCandleData(merged),
                index: Math.min(merged.length - 1, 50)
            }));
        } catch (e) {
            console.error('Failed to cache data', e);
        }
    }, [symbol, timeframe]);

    // Staleness never blocks display: any stored series renders instantly and
    // the network only ever tops up bars newer than the last saved one.
    const loadFromLocalCache = useCallback((overrideSymbol?: string, overrideTimeframe?: string, options?: { notify?: boolean, cursorTime?: number | null }) => {
        const activeSymbol = overrideSymbol || symbol;
        const activeTF = overrideTimeframe || timeframe;
        const data = loadSeries(activeSymbol, activeTF);
        if (!data) return false;

        setAllData(data);
        // TradingView-style: land on the same market moment the user
        // was looking at, not blindly on bar 50.
        const mappedIdx = timeToNearestBarIndex(data, options?.cursorTime) ?? Math.min(data.length - 1, 50);
        setCurrentIdx(mappedIdx);
        // Persist immediately so the restore effect cannot clobber
        // this with a stale index from a previous session.
        localStorage.setItem(getReplayIndexKey(activeSymbol, activeTF), String(mappedIdx));
        setDataSource('cache');
        localStorage.setItem('jfx_backtest_cached_chart', JSON.stringify({ data, index: Math.min(data.length - 1, 50) }));
        setDrawings(prev => stripLogicalAnchors(prev));
        setHistory([]);
        historyStatesRef.current = [];
        historyPointerRef.current = -1;
        setHistoryStates([]);
        setHistoryStep(-1);
        resetDrawingInteractionState();
        if (options?.notify !== false) {
            addToast({ type: 'info', title: 'Loaded from History', message: `Restored ${data.length} stored bars for ${activeSymbol}` });
        }
        return true;
    }, [symbol, timeframe, setAllData, setCurrentIdx, setDataSource, addToast]);

    // Incremental top-up: fetch ONLY bars at/after the last saved bar and
    // merge them into the persistent store. Returns the merged series and how
    // many bars were added, or null when nothing is stored / nothing is new /
    // the request failed — callers keep their current chart state then.
    const ctraderTopUpInFlight = useRef<Set<string>>(new Set());
    const topUpCtraderSeries = useCallback(async (activeSymbol?: string, activeTF?: string): Promise<{ merged: Candle[]; added: number } | null> => {
        const sym = activeSymbol || symbol;
        const tf = activeTF || timeframe;
        if (!sym || !tf) return null;
        const key = `${sym}_${tf}`;
        if (ctraderTopUpInFlight.current.has(key)) return null;
        const meta = peekMeta(sym, tf);
        if (!meta) return null;
        ctraderTopUpInFlight.current.add(key);
        try {
            const accounts = await getCtraderAccounts();
            const savedAccountId = getSelectedAccountId();
            const account = accounts.find(a => a.ctidTraderAccountId === savedAccountId) || accounts[0];
            if (!account) return null;
            // Inclusive fromTimestamp so the still-open live bar gets its
            // final values. 2000 bars per top-up so even a weeks-long absence
            // heals in a couple of opens and the replay count grows every
            // fetch until the 10000-bar store cap.
            const fresh = await fetchCtraderCandles(account.ctidTraderAccountId, sym, tf, 2000, account.isDemo, 2, meta.lastTime * 1000);
            const existing = loadSeries(sym, tf) || [];
            const merged = mergeBars(existing, fresh);
            if (merged.length === 0) return null;
            saveSeries(sym, tf, merged);
            return { merged, added: merged.length - existing.length };
        } catch { /* silent — background sync */ return null; }
        finally { ctraderTopUpInFlight.current.delete(key); }
    }, [symbol, timeframe]);

    // Shared-store top-up: same contract as topUpCtraderSeries but reads the
    // server-harvested candle store, so it works with NO personal cTrader
    // connection. Returns null when nothing is stored / nothing new / failed.
    const sharedTopUpInFlight = useRef<Set<string>>(new Set());
    const topUpSharedSeries = useCallback(async (activeSymbol?: string, activeTF?: string): Promise<{ merged: Candle[]; added: number } | null> => {
        const sym = activeSymbol || symbol;
        const tf = activeTF || timeframe;
        if (!sym || !tf) return null;
        const key = `shared_${sym}_${tf}`;
        if (sharedTopUpInFlight.current.has(key)) return null;
        const meta = peekMeta(sym, tf);
        if (!meta) return null;
        sharedTopUpInFlight.current.add(key);
        try {
            const result = await fetchSharedCandlesDetailed(sym, tf, meta.lastTime);
            if (result?.stale) {
                setDataNotice(`Data last updated ${formatStaleDate(result.updatedAt)}`);
            } else if (result) {
                setDataNotice(null);
            }
            const fresh = result?.candles ?? null;
            if (!fresh || fresh.length === 0) return null;
            const existing = loadSeries(sym, tf) || [];
            const merged = mergeBars(existing, fresh);
            if (merged.length === 0) return null;
            saveSeries(sym, tf, merged);
            return { merged, added: merged.length - existing.length };
        } catch { /* silent — background sync */ return null; }
        finally { sharedTopUpInFlight.current.delete(key); }
    }, [symbol, timeframe]);

    // TradingView-instant timeframe switching: after a successful cTrader load,
    // backfill every standard timeframe in the background. Series already in
    // the persistent store only receive an incremental top-up; brand-new TFs
    // are seeded with a full fetch. Subsequent switches render from the store
    // on the same tick instead of waiting on the network.
    const ctraderPrefetchInFlight = useRef<Set<string>>(new Set());
    const backfillCtraderTimeframes = useCallback((baseSymbol?: string) => {
        const sym = baseSymbol || symbol;
        if (!sym) return;
        BACKTEST_TFS.forEach((tf) => {
            const key = `${sym}_${tf}`;
            if (ctraderPrefetchInFlight.current.has(key)) return;
            const meta = peekMeta(sym, tf);
            // Fresh within ~3 intervals → nothing to do.
            if (meta && (Date.now() / 1000 - meta.lastTime) < 3 * (BACKTEST_TF_SECONDS[tf] || 3600)) return;
            ctraderPrefetchInFlight.current.add(key);
            window.setTimeout(async () => {
                try {
                    if (await topUpSharedSeries(sym, tf)) return;
                    if (await topUpCtraderSeries(sym, tf)) return;
                    // Nothing stored yet → seed this timeframe from the shared
                    // store first (no auth needed); personal cTrader only as a
                    // fallback for pairs the harvester hasn't reached.
                    if (!peekMeta(sym, tf)) {
                        const sharedResult = await fetchSharedCandlesDetailed(sym, tf);
                        if (sharedResult?.stale) setDataNotice(`Data last updated ${formatStaleDate(sharedResult.updatedAt)}`);
                        const shared = sharedResult?.candles ?? [];
                        if (shared.length > 0) { saveToLocalCache(shared, sym, tf); return; }
                        const accounts = await getCtraderAccounts();
                        const savedAccountId = getSelectedAccountId();
                        const account = accounts.find(a => a.ctidTraderAccountId === savedAccountId) || accounts[0];
                        if (!account) return;
                        const candles = await fetchCtraderCandles(account.ctidTraderAccountId, sym, tf, 2000, account.isDemo, 2);
                        if (candles && candles.length > 0) saveToLocalCache(candles, sym, tf);
                    }
                } catch { /* silent — background warm-up only */ }
                finally {
                    ctraderPrefetchInFlight.current.delete(key);
                }
            }, 400);
        });
    }, [symbol, topUpCtraderSeries, topUpSharedSeries, saveToLocalCache]);

    const handleDownloadData = () => {
        if (allData.length === 0) return;
        const blob = new Blob([JSON.stringify(allData)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `jfx_data_${symbol}_${timeframe}_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        addToast({ type: 'success', title: 'Data Exported', message: `Saved ${allData.length} bars to file.` });
    };

    const validateOHLC = (item: any): boolean => {
        return (
            item &&
            typeof item.time === 'number' &&
            typeof item.open === 'number' &&
            typeof item.high === 'number' &&
            typeof item.low === 'number' &&
            typeof item.close === 'number' &&
            item.high >= item.low &&
            item.high >= item.open &&
            item.high >= item.close &&
            item.low <= item.open &&
            item.low <= item.close
        );
    };

    const handleImportFile = (file: File) => {
        if (!file) return;
        if (importTimeoutRef.current !== null) {
            window.clearTimeout(importTimeoutRef.current);
            importTimeoutRef.current = null;
        }
        setIsImporting(true);
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target?.result as string);
                if (!Array.isArray(data)) {
                    setIsImporting(false);
                    addToast({ type: 'error', title: 'Import Failed', message: 'Data must be an array of OHLC bars.' });
                    return;
                }
                if (data.length === 0) {
                    setIsImporting(false);
                    addToast({ type: 'error', title: 'Import Failed', message: 'Array is empty.' });
                    return;
                }
                const validData = data.filter(validateOHLC);
                if (validData.length === 0) {
                    setIsImporting(false);
                    addToast({ type: 'error', title: 'Import Failed', message: 'No valid OHLC bars found. Expected: {time, open, high, low, close}' });
                    return;
                }
                if (validData.length < data.length) {
                    addToast({ type: 'warning', title: 'Skipped Invalid', message: `${data.length - validData.length} invalid bars ignored.` });
                }
                importTimeoutRef.current = window.setTimeout(() => {
                    setIsPlaying(false);
setAllData(validData);
                    setCurrentIdx(Math.min(validData.length - 1, 50));
                    setDataSource('cache');
                    localStorage.setItem('jfx_backtest_cached_chart', JSON.stringify({ data: validData, index: Math.min(validData.length - 1, 50) }));
                    setShowWelcome(false);
                    setDrawings(prev => stripLogicalAnchors(prev));
                    setHistory([]);
                    historyStatesRef.current = [];
                    historyPointerRef.current = -1;
                    setHistoryStates([]);
                    setHistoryStep(-1);
                    resetDrawingInteractionState();
                    setIsImporting(false);
                    importTimeoutRef.current = null;
                    addToast({ type: 'success', title: 'Data Imported', message: `Loaded ${validData.length} bars from file.` });
                }, 800);
            } catch (err) {
                setIsImporting(false);
                addToast({ type: 'error', title: 'Import Failed', message: 'Invalid JSON file format.' });
            }
        };
        reader.onerror = () => {
            setIsImporting(false);
            addToast({ type: 'error', title: 'Read Failed', message: 'Could not read file.' });
        };
        reader.readAsText(file);
    };

    const handleFetchMT5Data = useCallback(async (overrideSymbol?: string, overrideTimeframe?: string) => {
        setIsPlaying(false);
        const seq = ++activeFetchSeqRef.current;
        const activeSymbol = overrideSymbol || symbol;
        const activeTF = overrideTimeframe || timeframe;
        beginChartLoading(`${activeSymbol} · ${activeTF}`);

        // TradingView keeps the visible time range when switching timeframes.
        // Capture it so drawings stay on screen after the new data loads, and
        // capture the replay cursor's bar time so the cursor lands on the same
        // market moment instead of jumping to bar 50 / the last bar (which
        // orphans drawings off-screen and reveals future bars).
        const isTimeframeSwitch = Boolean(overrideTimeframe) && overrideTimeframe !== timeframe && (!overrideSymbol || overrideSymbol === symbol);
        const prevVisibleRange = isTimeframeSwitch
            ? (chartRef.current?.timeScale().getVisibleRange?.() as { from: number; to: number } | null) ?? null
            : null;
        const prevCursorTime = isTimeframeSwitch ? allData[currentIndex]?.time ?? null : null;

        try {
            const { data } = await fetchData(overrideSymbol, overrideTimeframe);
            if (seq !== activeFetchSeqRef.current) return;
            setHistory([]);
            setDrawings(prev => stripLogicalAnchors(prev));
            historyStatesRef.current = [];
            historyPointerRef.current = -1;
            setHistoryStates([]);
            setHistoryStep(-1);
            resetDrawingInteractionState();
            saveToLocalCache(data, overrideSymbol, overrideTimeframe);
            setDataSource('live');
            setActiveSource('mt5');
            setShowWelcome(false);
            if (prevVisibleRange) {
                // Keep the replay cursor pinned to the same market moment so
                // drawings around it stay exactly where the user left them.
                const mappedCursor = timeToNearestBarIndex(data, prevCursorTime) ?? data.length - 1;
                setCurrentIdx(mappedCursor);
                localStorage.setItem(getReplayIndexKey(activeSymbol, activeTF), String(mappedCursor));
                window.setTimeout(() => {
                    chartRef.current?.timeScale().setVisibleRange?.({ from: prevVisibleRange.from, to: prevVisibleRange.to });
                }, 0);
            } else if (isTimeframeSwitch && prevCursorTime !== null) {
                const mappedCursor = timeToNearestBarIndex(data, prevCursorTime);
                if (mappedCursor !== null) {
                    setCurrentIdx(mappedCursor);
                    localStorage.setItem(getReplayIndexKey(activeSymbol, activeTF), String(mappedCursor));
                }
            }
            addToast({ type: 'success', title: 'Data Synced', message: `Loaded ${data.length} bars for ${activeSymbol}` });
        } catch (err: any) {
            const cached = loadFromLocalCache(overrideSymbol, overrideTimeframe, { notify: false });
            setShowWelcome(false);
            if (cached) {
                addToast({
                    type: 'warning',
                    title: 'Bridge Offline',
                    message: `Loaded cached data for ${activeSymbol} ${activeTF}.`
                });
                return;
            }
            // Shared candle store fallback: when MT5 can't serve the chart
            // (bridge offline) and nothing is cached locally, try the
            // server-harvested store before giving up. This lets users who
            // never connected cTrader browse charts seamlessly — and silently
            // switches the active source to cTrader for subsequent loads.
            const sharedResult = seq === activeFetchSeqRef.current
                ? await fetchSharedCandlesDetailed(activeSymbol, activeTF)
                : null;
            if (seq !== activeFetchSeqRef.current) return;
            if (sharedResult?.stale) setDataNotice(`Data last updated ${formatStaleDate(sharedResult.updatedAt)}`);
            else if (sharedResult) setDataNotice(null);
            const sharedFull = sharedResult?.candles ?? null;
            if (sharedFull && sharedFull.length > 0) {
                saveToLocalCache(sharedFull, activeSymbol, activeTF);
                setCurrentIdx(Math.min(sharedFull.length - 1, 50));
                setAllData(sharedFull);
                setDataSource('ctrader');
                setActiveSource('ctrader');
                setShowWelcome(false);
                window.setTimeout(() => backfillCtraderTimeframes(activeSymbol), 1200);
                addToast({
                    type: 'info',
                    title: 'Loaded from Shared History',
                    message: `MT5 unavailable — loaded ${sharedFull.length} bars for ${activeSymbol} (${activeTF}) from the shared candle history.`
                });
            } else {
                // Both MT5 and the shared store missed — say so explicitly.
                // MT5 is only an opt-in fallback now (shared/cTrader is
                // primary), so the message must not imply MT5 is required.
                const explicitMt5 = activeSource === 'mt5';
                addToast({
                    type: 'error',
                    title: explicitMt5 ? 'MT5 Sync Failed' : 'History Unavailable',
                    message: explicitMt5
                        ? `MT5 Bridge is offline and shared history has no bars for ${activeSymbol} ${activeTF}. Start the JFX-JOURNAL Bridge app or pick another pair.`
                        : `No bars for ${activeSymbol} ${activeTF} — cache empty, shared history empty, MT5 Bridge offline.`
                });
            }
        } finally {
            if (seq === activeFetchSeqRef.current) endChartLoading();
        }
    }, [fetchData, addToast, saveToLocalCache, loadFromLocalCache, symbol, timeframe, activeSource, setActiveSource, allData, currentIndex, beginChartLoading, endChartLoading, backfillCtraderTimeframes]);

    const handleFetchCtraderData = useCallback(async (
        overrideSymbol?: string, 
        overrideTimeframe?: string,
        customOptions?: {
            fromTimestamp?: number;
            toTimestamp?: number;
            count?: number;
            startAtFirstBar?: boolean;
        }
    ) => {
        setIsPlaying(false);
        const seq = ++activeFetchSeqRef.current;
        const activeSymbol = overrideSymbol || symbol;
        const activeTF = overrideTimeframe || timeframe;
        setIsCtraderFetching(true);

        const hasCustomFilter = Boolean(customOptions?.fromTimestamp || customOptions?.toTimestamp);
        // TradingView keeps the visible time range when switching timeframes:
        // capture it so the new timeframe loads the same window and drawings
        // stay pinned on screen. Also capture the replay cursor's bar time so
        // the cursor lands on the same market moment instead of bar 50 / the
        // last bar (which pushes drawings off-screen and reveals future bars).
        const isTimeframeSwitch = !hasCustomFilter && Boolean(overrideTimeframe) && overrideTimeframe !== timeframe && (!overrideSymbol || overrideSymbol === symbol);
        const prevVisibleRange = isTimeframeSwitch
            ? (chartRef.current?.timeScale().getVisibleRange?.() as { from: number; to: number } | null) ?? null
            : null;
        const prevCursorTime = isTimeframeSwitch ? allData[currentIndex]?.time ?? null : null;
        // Check local history first: any stored series renders instantly so
        // candles flip immediately, then the network below only tops up bars
        // newer than the last saved one.
        const cached = !hasCustomFilter ? loadFromLocalCache(activeSymbol, activeTF, { notify: false, cursorTime: prevCursorTime }) : null;
        if (cached) {
            setDataSource('ctrader');
            setShowWelcome(false);
        } else if (!hasCustomFilter && !showWelcome) {
            // No stored series: the chart would otherwise keep showing stale
            // bars (or nothing) with zero feedback while cTrader responds.
            // Arm the dimmed "Loading SYM · TF" overlay (delayed so quick
            // responses never flash it).
            beginChartLoading(`${activeSymbol} · ${activeTF}`);
        }

        try {
            // -----------------------------------------------------------------
            // Shared candle store FIRST: works with no personal cTrader
            // connection at all. Only fall back to the personal cTrader flow
            // when the shared store can't serve this series.
            // -----------------------------------------------------------------
            let servedFromShared = false;
            if (!hasCustomFilter) {
                const toppedShared = await topUpSharedSeries(activeSymbol, activeTF);
                if (seq !== activeFetchSeqRef.current) return;
                // A successful top-up is authoritative: merged is the union of
                // stored + fresh bars, so the replay count can only grow (or
                // stay at the 10000-bar cap). Serve it even when added === 0
                // (live-bar-only update) instead of re-downloading the full
                // series for zero gain. Null means nothing stored / fetch
                // failed → fall through to the full load below.
                if (toppedShared) {
                    setAllData(toppedShared.merged);
                    setCurrentIdx(prev => Math.min(prev, toppedShared.merged.length - 1));
                    setDataSource('ctrader');
                    setActiveSource('ctrader');
                    setShowWelcome(false);
                    endChartLoading?.();
                    setIsCtraderFetching(false);
                    window.setTimeout(() => backfillCtraderTimeframes(activeSymbol), 1200);
                    servedFromShared = true;
                } else {
                    // Nothing stored locally yet → try a FULL shared-series load.
                    const sharedResult = await fetchSharedCandlesDetailed(activeSymbol, activeTF);
                    if (seq !== activeFetchSeqRef.current) return;
                    if (sharedResult?.stale) setDataNotice(`Data last updated ${formatStaleDate(sharedResult.updatedAt)}`);
                    else if (sharedResult) setDataNotice(null);
                    const sharedFull = sharedResult?.candles ?? null;
                    if (sharedFull && sharedFull.length > 0) {
                        saveToLocalCache(sharedFull, activeSymbol, activeTF);
                        setCurrentIdx(Math.min(sharedFull.length - 1, 50));
                        setAllData(sharedFull);
                        setDataSource('ctrader');
                        setActiveSource('ctrader');
                        setShowWelcome(false);
                        endChartLoading?.();
                        setIsCtraderFetching(false);
                        window.setTimeout(() => backfillCtraderTimeframes(activeSymbol), 1200);
                        servedFromShared = true;
                    }
                }
            }
            if (servedFromShared) return;

            if (!isCtraderAuthenticated()) {
                // Try a silent refresh first (covers returning from the OAuth
                // flow where the refresh token lives in an httpOnly cookie).
                try { await refreshCtraderToken(); } catch { /* keep status */ }
                if (!isCtraderAuthenticated()) {
                    setShowCtraderAuthModal(true);
                    addToast({
                        type: 'warning',
                    title: 'cTrader Auth Required',
                    message: 'Please connect your cTrader account first.'
                });
                return;
                }
            }

            const accounts = await getCtraderAccounts();
            if (seq !== activeFetchSeqRef.current) return; // a newer pair/TF load superseded this one
            if (!accounts || accounts.length === 0) {
                setShowCtraderAuthModal(true);
                addToast({
                    type: 'error',
                    title: 'No cTrader Accounts',
                    message: 'No active cTrader accounts found for this profile.'
                });
                return;
            }

            const savedAccountId = getSelectedAccountId();
            const account = accounts.find(a => a.ctidTraderAccountId === savedAccountId) || accounts[0];

            // Incremental fast path: a stored series only receives bars newer
            // than its last saved bar. Full fetches happen exclusively when
            // nothing is stored (or the caller asked for a specific window).
            let candles: Candle[] | null = null;
            let incremental = false;
            let addedCount = 0;
            if (!hasCustomFilter) {
                const topped = await topUpCtraderSeries(activeSymbol, activeTF);
                if (seq !== activeFetchSeqRef.current) return;
                // Same authoritative-merge contract as the shared path: the
                // merged union can only grow the replay count, so serve it
                // whenever the top-up succeeded (null = nothing stored/failed).
                if (topped) {
                    candles = topped.merged;
                    incremental = true;
                    addedCount = topped.added;
                }
            }

            if (!candles) {
                // When preserving the visible window, fetch enough bars to cover it
                // (cTrader returns bars within the from/to range, capped by count).
                const candleCount = customOptions?.count || (prevVisibleRange ? 10000 : 2000);
                const rangeFromMs = customOptions?.fromTimestamp ?? (prevVisibleRange ? prevVisibleRange.from * 1000 : undefined);
                const rangeToMs = customOptions?.toTimestamp ?? (prevVisibleRange ? prevVisibleRange.to * 1000 : undefined);
                candles = await fetchCtraderCandles(
                    account.ctidTraderAccountId,
                    activeSymbol,
                    activeTF,
                    candleCount,
                    account.isDemo,
                    3,
                    rangeFromMs,
                    rangeToMs
                );
                if (seq !== activeFetchSeqRef.current) return;
            }

            if (!candles || candles.length === 0) {
                if (!cached) {
                    addToast({
                        type: 'warning',
                        title: 'No cTrader Bars',
                        message: `No trendbars returned for ${activeSymbol} ${activeTF} for the selected period.`
                    });
                }
                return;
            }

            setAllData(candles);
            if (incremental) {
                // Tail append only: existing bar indices did not move, so the
                // replay cursor, drawings and undo history stay exactly where
                // the user left them.
                setCurrentIdx(prev => Math.min(prev, candles!.length - 1));
            } else {
                // Keep the replay cursor pinned to the same market moment so the
                // drawings around it stay exactly where the user left them.
                const mappedCursor = isTimeframeSwitch ? timeToNearestBarIndex(candles, prevCursorTime) : null;
                if (mappedCursor !== null) {
                    setCurrentIdx(mappedCursor);
                    localStorage.setItem(getReplayIndexKey(activeSymbol, activeTF), String(mappedCursor));
                } else if (prevVisibleRange) {
                    // Show every fetched bar, then restore the same visible window
                    setCurrentIdx(candles.length - 1);
                } else if (customOptions?.startAtFirstBar) {
                    setCurrentIdx(Math.min(50, candles.length - 1));
                } else if (!cached) {
                    setCurrentIdx(Math.min(candles.length - 1, 50));
                }
                if (prevVisibleRange) {
                    window.setTimeout(() => {
                        chartRef.current?.timeScale().setVisibleRange?.({ from: prevVisibleRange.from, to: prevVisibleRange.to });
                    }, 0);
                }
                setHistory([]);
                setDrawings(prev => stripLogicalAnchors(prev));
                historyStatesRef.current = [];
                historyPointerRef.current = -1;
                setHistoryStates([]);
                setHistoryStep(-1);
                resetDrawingInteractionState();
            }
            saveToLocalCache(candles, activeSymbol, activeTF);
            setDataSource('ctrader');
            setActiveSource('ctrader');
            setShowWelcome(false);
            // Backfill the other timeframes in the background so the next
            // switch is instant.
            if (!hasCustomFilter) {
                window.setTimeout(() => backfillCtraderTimeframes(activeSymbol), 1200);
            }

            if (incremental && addedCount > 0) {
                addToast({
                    type: 'info',
                    title: 'History Synced',
                    message: `Added ${addedCount} new bar${addedCount === 1 ? '' : 's'} to ${activeSymbol} ${activeTF}.`
                });
            } else if (!incremental) {
                const firstDate = candles[0]?.time ? new Date(candles[0].time * 1000).toLocaleDateString() : '';
                const lastDate = candles[candles.length - 1]?.time ? new Date(candles[candles.length - 1].time * 1000).toLocaleDateString() : '';
                const rangeStr = firstDate && lastDate ? ` (${firstDate} – ${lastDate})` : '';

                addToast({
                    type: 'success',
                    title: 'cTrader Data Loaded',
                    message: `Loaded ${candles.length} historical bars for ${activeSymbol} (${activeTF})${rangeStr}.`
                });
            }
        } catch (err: any) {
            if (!cached && seq === activeFetchSeqRef.current) {
                addToast({
                    type: 'error',
                    title: 'cTrader Fetch Failed',
                    message: err?.message || 'Could not fetch historical candles from cTrader.'
                });
            }
        } finally {
            // Only the newest request may clear the shared flags; an older
            // abandoned response must not dismiss the newer one's feedback.
            if (seq === activeFetchSeqRef.current) {
                setIsCtraderFetching(false);
                endChartLoading();
            }
        }
    }, [symbol, timeframe, allData, currentIndex, setAllData, setCurrentIdx, saveToLocalCache, loadFromLocalCache, setDataSource, setActiveSource, setShowWelcome, showWelcome, resetDrawingInteractionState, addToast, topUpCtraderSeries, topUpSharedSeries, backfillCtraderTimeframes, beginChartLoading, endChartLoading]);

    const handleApplyCtraderDatePreset = (daysAgo: number) => {
        const d = new Date();
        d.setDate(d.getDate() - daysAgo);
        setCtraderFetchDate(d.toISOString().slice(0, 10));
        setCtraderFetchTime('00:00');
    };

    const handleExecuteCtraderDateFetch = () => {
        let fromTimestamp: number | undefined;

        if (ctraderFetchDate) {
            const parsed = new Date(`${ctraderFetchDate}T${ctraderFetchTime || '00:00'}:00`);
            fromTimestamp = !isNaN(parsed.getTime()) ? parsed.getTime() : undefined;
        }

        if (ctraderFetchSymbol !== symbol) {
            setSymbol(ctraderFetchSymbol);
        }
        if (ctraderFetchTimeframe !== timeframe) {
            setTimeframe(ctraderFetchTimeframe);
        }

        handleFetchCtraderData(ctraderFetchSymbol, ctraderFetchTimeframe, {
            fromTimestamp,
            count: ctraderFetchCount,
            startAtFirstBar: ctraderStartReplayAtFirst
        });
    };

    // Switches the active data source in the top bar and syncs from it.
    const handleSourceSelect = useCallback((source: 'mt5' | 'ctrader') => {
        setActiveSource(source);
        if (source === 'mt5') {
            handleFetchMT5Data();
        } else {
            handleFetchCtraderData();
        }
    }, [setActiveSource, handleFetchMT5Data, handleFetchCtraderData]);

    const handleFetchActiveSourceData = useCallback(async (overrideSymbol?: string, overrideTimeframe?: string) => {
        if (activeSource === 'ctrader') {
            return handleFetchCtraderData(overrideSymbol, overrideTimeframe);
        }
        // MT5 is an explicit opt-in fallback only. When the bridge isn't
        // confirmed online, serve shared/cTrader history instead of failing
        // with "MT5 Sync Failed" for users who never chose MT5.
        if (bridgeStatus !== 'online') {
            return handleFetchCtraderData(overrideSymbol, overrideTimeframe);
        }
        return handleFetchMT5Data(overrideSymbol, overrideTimeframe);
    }, [activeSource, bridgeStatus, handleFetchCtraderData, handleFetchMT5Data]);

    // ---- Start Screen wiring ------------------------------------------------
    // Cached series snapshot for the "Continue where you left off" cards;
    // re-read whenever the Start Screen becomes visible.
    const [cachedSeries, setCachedSeries] = useState<CachedSeriesInfo[]>([]);
    useEffect(() => {
        if (showWelcome) setCachedSeries(listCachedSeries());
    }, [showWelcome]);

    const handleConnectCtrader = useCallback(async () => {
        try {
            const { getAuthorizeUrl } = await import('../services/ctraderService');
            const { openExternalUrl } = await import('../lib/capacitor');
            await openExternalUrl(getAuthorizeUrl());
        } catch (err: any) {
            addToast({
                type: 'error',
                title: 'cTrader Not Configured',
                message: err?.message || 'Failed to initiate cTrader connection.'
            });
        }
    }, [addToast]);

    // Resume a locally cached series instantly (no network), restoring the
    // replay cursor saved for that symbol/timeframe.
    const handleResumeFromCache = useCallback((resumeSymbol: string, resumeTf: string) => {
        const ok = loadFromLocalCache(resumeSymbol, resumeTf, { notify: false });
        if (!ok) return;
        const saved = localStorage.getItem(getReplayIndexKey(resumeSymbol, resumeTf));
        if (saved) {
            const idx = parseInt(saved);
            if (!isNaN(idx) && idx >= 0) setCurrentIdx(idx);
        }
        setSymbol(resumeSymbol);
        setTimeframe(resumeTf);
        setShowWelcome(false);
        addToast({ type: 'info', title: 'Session Resumed', message: `Restored cached ${resumeSymbol} ${resumeTf}. Use refresh to top up latest bars.` });
    }, [loadFromLocalCache, setCurrentIdx, setSymbol, setTimeframe, addToast]);

    // One-click start from the Start Screen: the shared candle store serves
    // every pair, so no explicit source choice is needed anymore.
    const handleStartFresh = useCallback((startSymbol: string, startTf: string) => {
        setSymbol(startSymbol);
        setTimeframe(startTf);
        setShowWelcome(false);
        handleFetchCtraderData(startSymbol, startTf);
    }, [setSymbol, setTimeframe, handleFetchCtraderData]);
    // --------------------------------------------------------------------------

    const handleUpdateData = useCallback(async () => {
        // Shared/cTrader is primary. MT5 refresh only runs when explicitly
        // selected AND the bridge is confirmed online; otherwise top up from
        // shared history so refresh never surfaces "MT5 Sync Failed".
        if (activeSource === 'ctrader' || bridgeStatus !== 'online') {
            return handleFetchCtraderData();
        }
        if (allData.length === 0) return handleFetchMT5Data();
        setIsPlaying(false);
        try {
            const { data } = await fetchData();
            saveToLocalCache(data);
            setDataSource('live');
            setActiveSource('mt5');
            addToast({ type: 'success', title: 'Data Updated', message: 'Latest bars synced from MT5' });
        } catch (err: any) {
            // MT5 refresh failed — try shared history before giving up so an
            // offline bridge doesn't look like a total sync failure.
            try {
                const sharedResult = await fetchSharedCandlesDetailed(symbol, timeframe);
                if (sharedResult?.stale) setDataNotice(`Data last updated ${formatStaleDate(sharedResult.updatedAt)}`);
                else if (sharedResult) setDataNotice(null);
                const shared = sharedResult?.candles ?? null;
                if (shared && shared.length > 0) {
                    saveToLocalCache(shared, symbol, timeframe);
                    setAllData(shared);
                    setDataSource('ctrader');
                    setActiveSource('ctrader');
                    addToast({ type: 'info', title: 'Loaded from Shared History', message: `MT5 unavailable — loaded ${shared.length} bars for ${symbol} (${timeframe}).` });
                    return;
                }
            } catch { /* fall through to error toast */ }
            addToast({
                type: 'error',
                title: 'Update Failed',
                message: `MT5 Bridge offline and shared history has no bars for ${symbol} ${timeframe}.`
            });
        }
    }, [activeSource, bridgeStatus, handleFetchCtraderData, allData.length, handleFetchMT5Data, fetchData, saveToLocalCache, setDataSource, setActiveSource, setAllData, symbol, timeframe, addToast]);

    const resolveTradeIsoTime = useCallback((value?: string, fallbackDate?: string, fallbackTime?: string) => {
        if (value) {
            const normalized = value.includes(' ') && !value.includes('T') ? value.replace(' ', 'T') : value;
            const parsed = new Date(normalized);
            if (!Number.isNaN(parsed.getTime())) {
                return parsed.toISOString();
            }
        }

        if (fallbackDate && fallbackTime) {
            const parsed = new Date(`${fallbackDate}T${fallbackTime}`);
            if (!Number.isNaN(parsed.getTime())) {
                return parsed.toISOString();
            }
        }

        return undefined;
    }, []);

    const pushToHistory = useCallback((newDrawings: Drawing[]) => {
        const snapshot = cloneDrawings(newDrawings);
        const nextHistory = [...historyStatesRef.current.slice(0, historyPointerRef.current + 1), snapshot];
        const trimmedHistory = nextHistory.length > BACKTEST_HISTORY_LIMIT
            ? nextHistory.slice(nextHistory.length - BACKTEST_HISTORY_LIMIT)
            : nextHistory;
        const nextPointer = trimmedHistory.length - 1;

        historyStatesRef.current = trimmedHistory;
        historyPointerRef.current = nextPointer;
        setHistoryStates(trimmedHistory);
        setHistoryStep(nextPointer);
    }, []);

    // ── TV-parity selection helpers (multi-select + sticky tools) ──
    const handleSelectDrawing = useCallback((id: string, additive?: boolean) => {
        if (additive) {
            setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
        } else {
            setSelectedIds([id]);
        }
    }, []);
    const clearSelection = useCallback(() => setSelectedIds([]), []);
    const deleteSelected = useCallback(() => {
        const ids = selectedIds.length ? selectedIds : (selectedDrawingId ? [selectedDrawingId] : []);
        if (!ids.length) return;
        setDrawings(prev => { const next = prev.filter(d => !ids.includes(d.id)); pushToHistory(next); return next; });
        setSelectedIds([]);
    }, [selectedIds, selectedDrawingId, pushToHistory]);
    const duplicateSelected = useCallback(() => {
        const ids = selectedIds.length ? selectedIds : (selectedDrawingId ? [selectedDrawingId] : []);
        const now = Date.now();
        const copies: Drawing[] = drawings.filter(d => ids.includes(d.id)).map((d, i) => ({ ...d, id: (now + i).toString(), p1: { ...d.p1 }, p2: d.p2 ? { ...d.p2 } : undefined, isLocked: false }));
        if (!copies.length) return;
        setDrawings(prev => { const next = [...prev, ...copies]; pushToHistory(next); return next; });
        setSelectedIds(copies.map(c => c.id));
    }, [drawings, selectedIds, selectedDrawingId, pushToHistory]);
    // Sticky tools (TV): when on, the tool stays armed after each drawing.
    const finishToolAfterDraw = useCallback(() => { if (!stickyMode) setActiveTool('cursor'); }, [stickyMode]);
    // Coarse pointers (phones/tablets): bigger snap radius + haptics + sheets.
    const isCoarsePointer = useMemo(
        () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches,
        []
    );
    // Magnet with pixel snap radius (TV): only snaps when the cursor is
    // within SNAP_PX of an OHLC level, and reports the snap dot position.
    // Fingers are imprecise — use a much wider radius on touch devices.
    const SNAP_PX = isCoarsePointer ? 24 : 12;
    const snapPoint = useCallback((sx: number, sy: number, time: number, price: number, logical?: number): { point: Point, snapped: boolean, snapY?: number } => {
        if (!magnetMode || !allData.length) return { point: { time, price, logical }, snapped: false };
        const idx = Math.max(0, Math.min(allData.length - 1, Math.round(logical ?? 0)));
        const candle = allData[idx];
        const series = candlestickSeriesRef.current;
        if (!candle || !series) return { point: { time, price, logical }, snapped: false };
        const levels = [candle.open, candle.high, candle.low, candle.close];
        let best = price; let bestDist = SNAP_PX; let snapY: number | undefined;
        for (const lv of levels) { const ly = series.priceToCoordinate(lv); if (ly === null) continue; const dist = Math.abs(ly - sy); if (dist < bestDist) { bestDist = dist; best = lv; snapY = ly; } }
        const snapped = snapY !== undefined;
        return { point: { time: candle.time, price: best, logical: idx }, snapped, snapY };
    }, [magnetMode, allData, SNAP_PX]);

    // Per-chart visibility (TV parity): drawings remember the symbol/timeframe
    // they were created on (originKey). When syncAllTimeframes === false the
    // drawing only renders on its home chart; default (undefined/true) shows
    // everywhere, preserving the old behaviour for existing drawings.
    const symbolTfKey = `${symbol}_${timeframe}`;
    const visibleDrawings = useMemo(
        () => drawings.filter(d => {
            const dd = d as any;
            if (dd.syncAllTimeframes === false) return (dd.originKey || symbolTfKey) === symbolTfKey;
            return true;
        }),
        [drawings, symbolTfKey]
    );
    const withOrigin = useCallback((obj: any) => ({ ...obj, originKey: (obj.originKey || symbolTfKey), syncAllTimeframes: obj.syncAllTimeframes ?? true }), [symbolTfKey]);

    const resetDrawingHistory = useCallback((snapshot: Drawing[] = []) => {
        if (snapshot.length === 0) {
            historyStatesRef.current = [];
            historyPointerRef.current = -1;
            setHistoryStates([]);
            setHistoryStep(-1);
            return;
        }

        const cloned = cloneDrawings(snapshot);
        historyStatesRef.current = [cloned];
        historyPointerRef.current = 0;
        setHistoryStates([cloned]);
        setHistoryStep(0);
    }, []);

    const clearDrawings = useCallback(() => {
        if (drawings.length === 0) return;
        // Confirm is handled inline by the rail trash two-tap (minimal UI),
        // so clear directly here — Undo toast stays as the safety net.
        setDrawings([]);
        resetDrawingInteractionState();
        pushToHistory([]);
        addToast({ type: 'info', title: 'Drawings Cleared', message: 'Tap Undo in the toolbar to restore.' });
    }, [drawings, pushToHistory, addToast, resetDrawingInteractionState]);

    const handleUndo = useCallback(() => {
        if (historyPointerRef.current > 0) {
            const nextStep = historyPointerRef.current - 1;
            setHistoryStep(nextStep);
            historyPointerRef.current = nextStep;
            setDrawings(cloneDrawings(historyStatesRef.current[nextStep]));
        } else if (historyPointerRef.current === 0) {
            setHistoryStep(-1);
            historyPointerRef.current = -1;
            setDrawings([]);
        }
    }, []);

    const handleRedo = useCallback(() => {
        if (historyPointerRef.current < historyStatesRef.current.length - 1) {
            const nextStep = historyPointerRef.current + 1;
            setHistoryStep(nextStep);
            historyPointerRef.current = nextStep;
            setDrawings(cloneDrawings(historyStatesRef.current[nextStep]));
        }
    }, []);

    const updateDrawingProperty = useCallback((id: string, updates: Partial<Drawing>) => {
        let drawingType: string | undefined;

        setDrawings(prev => {
            const next = prev.map(d => {
                if (d.id === id) {
                    drawingType = d.type;
                    return { ...d, ...updates };
                }
                return d;
            });
            pushToHistory(next);
            return next;
        });

        // Save these as defaults for future drawings of this SPECIFIC tool
        if (drawingType && (updates.color || updates.strokeWidth || updates.strokeStyle)) {
            setToolDefaults(prev => ({
                ...prev,
                [drawingType!]: {
                    ...(prev[drawingType!] || {}),
                    ...updates
                }
            }));
        }

        if (typeof updates.color === 'string') {
            setCurrentColor(updates.color);
        }

    }, [pushToHistory, setToolDefaults, setCurrentColor]);

    // Batch style edit for the style drawers: applies to EVERY selected
    // drawing with a SINGLE history entry (per-id updateDrawingProperty calls
    // would spam undo). Mirrors its toolDefaults + currentColor fan-out.
    const applyStyleToSelection = useCallback((updates: { color?: string; strokeWidth?: number; strokeStyle?: LineStyleKey }) => {
        const ids = selectedIds.length ? selectedIds : (selectedDrawingId ? [selectedDrawingId] : []);
        if (ids.length === 0) return;
        const types = new Set<string>();
        drawings.filter(d => ids.includes(d.id)).forEach(d => types.add(d.type));
        setDrawings(prev => {
            const next = prev.map(d => (ids.includes(d.id) ? { ...d, ...updates } : d));
            pushToHistory(next);
            return next;
        });
        if (updates.color || updates.strokeWidth || updates.strokeStyle) {
            setToolDefaults(prev => {
                const next = { ...prev };
                types.forEach(t => { next[t] = { ...(next[t] || {}), ...updates }; });
                return next;
            });
        }
        if (typeof updates.color === 'string') setCurrentColor(updates.color);
    }, [selectedIds, selectedDrawingId, drawings, pushToHistory, setToolDefaults, setCurrentColor]);

    const handleToolbarColorChange = useCallback((color: string) => {
        if (selectedDrawingId) {
            updateDrawingProperty(selectedDrawingId, { color });
            setCurrentColor(color);
            return;
        }

        setCurrentColor(color);
        if (activeTool !== 'cursor') {
            setToolDefaults(prev => ({
                ...prev,
                [activeTool]: {
                    ...(prev[activeTool] || {}),
                    color
                }
            }));
        }
    }, [activeTool, selectedDrawingId, updateDrawingProperty, setCurrentColor, setToolDefaults]);

    const handleToolbarStrokeWidthChange = useCallback((strokeWidth: number) => {
        if (selectedDrawingId) {
            updateDrawingProperty(selectedDrawingId, { strokeWidth });
            return;
        }
        if (activeTool === 'cursor') return;
        setToolDefaults(prev => ({
            ...prev,
            [activeTool]: {
                ...(prev[activeTool] || {}),
                strokeWidth
            }
        }));
    }, [activeTool, selectedDrawingId, updateDrawingProperty, setToolDefaults]);

    const handleToolbarStrokeStyleChange = useCallback((strokeStyle: 'solid' | 'dashed' | 'dotted') => {
        if (selectedDrawingId) {
            updateDrawingProperty(selectedDrawingId, { strokeStyle });
            return;
        }
        if (activeTool === 'cursor') return;
        setToolDefaults(prev => ({
            ...prev,
            [activeTool]: {
                ...(prev[activeTool] || {}),
                strokeStyle
            }
        }));
    }, [activeTool, selectedDrawingId, updateDrawingProperty, setToolDefaults]);

    const getChartCoordinates = useCallback((x: number, y: number) => {
        if (!chartRef.current || !candlestickSeriesRef.current) return null;
        const price = candlestickSeriesRef.current.coordinateToPrice(y);
        const logical = chartRef.current.timeScale().coordinateToLogical(x);
        const time = chartRef.current.timeScale().coordinateToTime(x);
        if (price === null || logical === null) return null;
        return { time, price, logical };
    }, []);

    const handlePasteDrawing = useCallback((x: number, y: number) => {
        if (!clipboard) return;
        const coords = getChartCoordinates(x, y);
        if (!coords) return;

        const timeOffset = coords.time - clipboard.p1.time;
        const priceOffset = coords.price - clipboard.p1.price;
        const logicalOffset = (coords.logical ?? 0) - (clipboard.p1.logical ?? 0);

        const newDrawing: Drawing = {
            ...clipboard,
            id: Date.now().toString(),
            p1: {
                time: clipboard.p1.time + timeOffset,
                price: clipboard.p1.price + priceOffset,
                logical: clipboard.p1.logical !== undefined ? clipboard.p1.logical + logicalOffset : undefined
            },
            p2: clipboard.p2 ? {
                time: clipboard.p2.time + timeOffset,
                price: clipboard.p2.price + priceOffset,
                logical: clipboard.p2.logical !== undefined ? clipboard.p2.logical + logicalOffset : undefined
            } : undefined,
            entry: clipboard.entry !== undefined ? clipboard.entry + priceOffset : undefined,
            target: clipboard.target !== undefined ? clipboard.target + priceOffset : undefined,
            stop: clipboard.stop !== undefined ? clipboard.stop + priceOffset : undefined
        };

        setDrawings(prev => {
            const next = [...prev, newDrawing];
            pushToHistory(next);
            return next;
        });

    }, [clipboard, getChartCoordinates, pushToHistory, addToast]);

    const getSnappedPoint = useCallback((time: number, price: number, logical?: number): Point => {
        if (!magnetMode || !allData.length) return { time, price, logical };
        const candle = allData[Math.round(logical ?? 0)];
        if (!candle) return { time, price, logical };
        const levels = [candle.open, candle.high, candle.low, candle.close];
        const closestLevel = levels.reduce((p, c) => Math.abs(c - price) < Math.abs(p - price) ? c : p);
        return { time: candle.time, price: closestLevel, logical: Math.round(logical ?? 0) };
    }, [magnetMode, allData]);

    const onMouseDown = (e: React.MouseEvent) => {
        if ((e.target as Element)?.closest?.('[data-drawing-toolbar]')) return;
        if (!chartRef.current || !candlestickSeriesRef.current || e.button !== 0) return;

        const rect = chartContainerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const coords = getChartCoordinates(x, y);
        if (!coords) return;

        if (isSelectBarMode) {
            // TradingView confirm model: mouse-down / hover only moves the cut
            // line (preview). The actual cut happens on mouse-up tap
            // (container + CustomChart), so drag-to-preview never cuts early.
            const foundIdx = Math.max(0, Math.min(allData.length - 1, Math.round(coords.logical as number)));
            if (selectBarIndex !== foundIdx) setSelectBarIndex(foundIdx);
            selectBarMouseDownRef.current = { x: e.clientX, y: e.clientY };
            return;
        }

        // If clicking while a drawing is already in progress, finalize it at
        // THIS click (tap-tap drawing). The preview p2 is stale between
        // clicks, so rebase it onto the click point — otherwise tap-tap
        // creates a zero-length drawing.
        if (currentDrawing && (currentDrawing.type !== 'horizontal' && currentDrawing.type !== 'vertical')) {
            const snapEnd = snapPoint(x, y, coords.time, coords.price as any, coords.logical).point;
            const finalized: any = { ...currentDrawing, p2: snapEnd };
            const fdx = (snapEnd.logical ?? coords.logical ?? 0) - (currentDrawing.p1.logical ?? 0);
            const fdy = (snapEnd.price ?? 0) - (currentDrawing.p1.price ?? 0);
            if (Math.abs(fdx) < 0.5 && Math.abs(fdy) < 1e-9) {
                // Second click landed on the anchor — keep the preview armed
                // so the user can pick a real endpoint (TV discards the tap).
                return;
            }
            const next = [...drawings, withOrigin(finalized)];
            setDrawings(next);
            pushToHistory(next);
            setSelectedIds([currentDrawing.id]);
            setCurrentDrawing(null);
            hapticTick(8);
            finishToolAfterDraw();
            return;
        }

        if (activeTool === 'cursor') {
            const startedOnDrawing = (e.target as Element)?.closest?.('[data-drawing-hit]');
            const startedOnToolbar = (e.target as Element)?.closest?.('[data-drawing-toolbar]');
            if (startedOnToolbar || startedOnDrawing) return;
            if (selectedDrawingId) setSelectedIds([]);
            return;
        }
        if (isLocked) {
            return;
        }

        const snapRes = snapPoint(x, y, coords.time, coords.price as any, coords.logical);
        const snapped = snapRes.point;
        setSnapIndicator(snapRes.snapped && snapRes.snapY !== undefined ? { x, y: snapRes.snapY } : null);
        const toolStyle = toolDefaults[activeTool] || {};

        let drawingProps: any = withOrigin({
            id: Date.now().toString(),
            type: activeTool,
            p1: snapped,
            p2: snapped, // Initialize p2 same as p1 for immediate rendering
            ...toolStyle,
            color: toolStyle.color || currentColor || '#2962ff',
        });
        // Pause autoplay the moment a drawing starts (TV parity).
        setIsPlaying(false);

        // Initialize Long/Short position tool with entry/target/stop
        if (activeTool === 'long' || activeTool === 'short') {
            const isLong = activeTool === 'long';
            const entryPrice = snapped.price;
            const defaults = toolStyle;
            const rrRatio = defaults.rr2 || 2; // Default R:R of 2
            // Adaptive risk: average bar range of recent candles, not a fixed %.
            // This makes the tool scale correctly on every timeframe.
            const visibleData = allData.slice(Math.max(0, currentIndex - 19), currentIndex + 1);
            const avgRange = visibleData.length > 0
                ? visibleData.reduce((sum, c) => sum + (c.high - c.low), 0) / visibleData.length
                : entryPrice * 0.005;
            const defaultRisk = avgRange || entryPrice * 0.005;
            drawingProps.entry = entryPrice;
            drawingProps.target = isLong ? entryPrice + (defaultRisk * rrRatio) : entryPrice - (defaultRisk * rrRatio);
            drawingProps.stop = isLong ? entryPrice - defaultRisk : entryPrice + defaultRisk;
        }

        // Text tool (TV): single click places it, selected with default text.
        if (activeTool === 'text') {
            drawingProps.text = drawingProps.text || 'Text';
            const next = [...drawings, drawingProps];
            setDrawings(next);
            pushToHistory(next);
            setSelectedIds([drawingProps.id]);
            finishToolAfterDraw();
            return;
        }

        setCurrentDrawing(drawingProps);
    };

    const onMouseMove = (e: React.MouseEvent) => {
        const rect = chartContainerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        setMousePos({ x, y });
        const coords = getChartCoordinates(x, y);
        if (!coords) return;

        // TradingView-style: selector follows cursor while in select-bar mode (move line left/right then click to cut)
        if (isSelectBarMode) {
            const idx = Math.max(0, Math.min(allData.length - 1, Math.round((coords.logical as number) ?? 0)));
            if (selectBarIndex !== idx) setSelectBarIndex(idx);
            // Don't run drawing drag logic while selecting a bar
            return;
        }

        if (dragState && dragStartPos) {
            // 4px dead-zone: plain clicks on a selected drawing must not nudge
            // it by 1–2px and pollute undo history.
            const startDrag = dragStartPos as any;
            if (typeof startDrag.startClientX === 'number' && typeof e.clientX === 'number') {
                const movedPx = Math.hypot(e.clientX - startDrag.startClientX, (e.clientY ?? 0) - (startDrag.startClientY ?? 0));
                if (movedPx < 4 && !dragMovedRef.current) return;
                dragMovedRef.current = true;
            } else {
                dragMovedRef.current = true;
            }
            const dPrice = coords.price - dragStartPos.price;
            const dTime = coords.time - dragStartPos.time;
            const dLog = (coords.logical ?? 0) - (dragStartPos.logical ?? 0);

            const initialData = dragStartPos as any;

            setDrawings(prev => prev.map(d => {
                if (d.id !== dragState.drawingId) return d;
                const newD = { ...d };

                if (dragState.handle === 'move') {
                    const p1Base = initialData.initialP1;
                    const p2Base = initialData.initialP2;
                    // Axis lock (TV): horizontal lines only move in price, vertical only in time.
                    const lockTime = d.type === 'horizontal';
                    const lockPrice = d.type === 'vertical';
                    const getRebasedPoint = (base: any) => {
                        const newLog = base.logical !== undefined ? Math.round(base.logical + (lockTime ? 0 : dLog)) : undefined;
                        let newTime = lockTime ? base.time : base.time + dTime;
                        if (!lockTime && newLog !== undefined && newLog >= 0 && newLog < allData.length) {
                             newTime = allData[newLog].time;
                        }
                        return { time: newTime, price: base.price + (lockPrice ? 0 : dPrice), logical: newLog };
                    };
                    newD.p1 = getRebasedPoint(p1Base);
                    if (p2Base) newD.p2 = getRebasedPoint(p2Base);
                    if (d.type === 'long' || d.type === 'short') {
                        newD.entry = (initialData.initialEntry || 0) + dPrice;
                        newD.target = (initialData.initialTarget || 0) + dPrice;
                        newD.stop = (initialData.initialStop || 0) + dPrice;
                    }
                } else if (dragState.handle === 'target') {
                    newD.target = coords.price;
                } else if (dragState.handle === 'stop') {
                    newD.stop = coords.price;
                } else if (dragState.handle === 'entry') {
                    newD.entry = coords.price;
                    newD.p1 = { ...newD.p1, price: coords.price };
                } else {
                    const snp = snapPoint(x, y, coords.time, coords.price as any, coords.logical).point;
                    if (dragState.handle === 'p1') {
                        // Axis lock per handle (TV): horizontal p1 moves price only, vertical time only.
                        if (d.type === 'horizontal') newD.p1 = { ...newD.p1, price: snp.price };
                        else if (d.type === 'vertical') newD.p1 = { ...snp, price: newD.p1.price };
                        else newD.p1 = snp;
                        if (d.type === 'long' || d.type === 'short') newD.entry = snp.price;
                    } else if (dragState.handle === 'p2') {
                        if (d.type === 'horizontal') newD.p2 = newD.p2 ? { ...newD.p2, price: snp.price } : { ...snp };
                        else newD.p2 = snp;
                    }
                }
                return newD;
            }));
            setTick(t => t + 1);
        }
        if (currentDrawing) {
            const snapLive = snapPoint(x, y, coords.time, coords.price as any, coords.logical);
            const snp = snapLive.point;
            setSnapIndicator(snapLive.snapped && snapLive.snapY !== undefined ? { x, y: snapLive.snapY } : null);

            // For Long/Short tools, dynamically update target/stop based on mouse position
            if (currentDrawing.type === 'long' || currentDrawing.type === 'short') {
                const isLong = currentDrawing.type === 'long';
                const entryPrice = currentDrawing.entry ?? currentDrawing.p1.price;
                const mousePriceDist = Math.abs(snp.price - entryPrice);
                const defaults = toolDefaults[currentDrawing.type] || {};
                const rrRatio = defaults.rr2 || 2;
                // Adaptive fallback: average range instead of fixed %
                const visibleData = allData.slice(Math.max(0, currentIndex - 19), currentIndex + 1);
                const avgRange = visibleData.length > 0
                    ? visibleData.reduce((sum, c) => sum + (c.high - c.low), 0) / visibleData.length
                    : entryPrice * 0.005;
                const risk = mousePriceDist > 0 ? mousePriceDist : (avgRange || entryPrice * 0.005);

                setCurrentDrawing(prev => prev ? {
                    ...prev,
                    p2: snp,
                    target: isLong ? entryPrice + (risk * rrRatio) : entryPrice - (risk * rrRatio),
                    stop: isLong ? entryPrice - risk : entryPrice + risk
                } : null);
            } else {
                // Ray keeps its drag angle (TV) - no horizontal lock.
                const nextP2 = currentDrawing.type === 'horizontal'
                    ? { ...snp, time: currentDrawing.p1.time, logical: currentDrawing.p1.logical }
                    : currentDrawing.type === 'vertical'
                        ? { ...snp, price: currentDrawing.p1.price }
                        : snp;
                setCurrentDrawing(prev => prev ? { ...prev, p2: nextP2 } : null);
            }
            setTick(t => t + 1);
        }
    };

    const handleMouseUp = (e?: React.MouseEvent) => {
        // Select-bar tap-to-cut (desktop): a press without drag commits the
        // previewed index. Works even when the press started on a drawing
        // (canvas never sees those events).
        if (isSelectBarMode) {
            const down = selectBarMouseDownRef.current;
            selectBarMouseDownRef.current = null;
            const upX = e?.clientX ?? down?.x ?? null;
            const upY = e?.clientY ?? down?.y ?? null;
            const moved = down && upX !== null && upY !== null
                ? Math.hypot(upX - down.x, upY - down.y)
                : 0;
            if (down && moved !== null && moved < 8 && selectBarIndex !== null) {
                setCurrentIdx(selectBarIndex);
                setTick(t => t + 1);
                if (chartRef.current) chartRef.current.timeScale().updateOffsetForNewBar(isAutoFollow);
                setIsSelectBarMode(false);
                setSelectBarIndex(null);
                return;
            }
            // Drag-release (or hover-click handled by CustomChart): keep the
            // preview parked, don't cut.
            if (!down) return;
            return;
        }
        // Only snapshot history when the drawing actually moved — a plain
        // click on a selected drawing leaves history untouched.
        if (dragState && dragMovedRef.current) pushToHistory(drawings);
        dragMovedRef.current = false;

        if (currentDrawing) {
            // Horizontal and vertical tools are 1-click tools, so we finalize them immediately.
            // Other tools need 2 clicks or a drag.
            const isOneClickTool = currentDrawing.type === 'horizontal' || currentDrawing.type === 'vertical';

            // Check distance between p1 and p2 in pixel coordinates or check for dragging.
            // For simplicity, we can assume if they dragged, p2 will be different.
            const rect = chartContainerRef.current?.getBoundingClientRect();
            if (rect && chartRef.current && candlestickSeriesRef.current) {
                const p1x = chartRef.current.timeScale().logicalToCoordinate(currentDrawing.p1.logical ?? 0) ?? 0;
                const p1y = candlestickSeriesRef.current.priceToCoordinate(currentDrawing.p1.price);
                const p2x = mousePos?.x ?? p1x;
                const p2y = mousePos?.y ?? p1y;
                const dist = Math.sqrt(Math.pow(p2x - p1x, 2) + Math.pow(p2y - p1y, 2));

                // If it's a one-click tool OR a significant drag (dist > 5px), finalize it.
                // Otherwise, keep it as an active preview (supporting click-move-click).
                if (isOneClickTool || dist > 5) {
                    const next = [...drawings, currentDrawing];
                    setDrawings(next);
                    pushToHistory(next);
                    setSelectedIds([currentDrawing.id]);
                    setCurrentDrawing(null);
                    finishToolAfterDraw();
                }
            }
        }
        setDragState(null);
        setDragStartPos(null);
        setSnapIndicator(null);
    };

    const handleMouseDownHandle = useCallback((e: React.MouseEvent, drawingId: string, handle: 'p1' | 'p2' | 'move' | 'target' | 'stop' | 'entry') => {
        if (isLocked) return;
        // Creation wins over dragging: with a drawing tool armed, presses that
        // land on old drawings must fall through to the container so the NEW
        // drawing starts — never grab/move the old one (body or handles).
        if (activeTool !== 'cursor') return;
        // Grab origin MUST come from the event itself. Touch paths synthesize
        // a mouse event carrying the real finger location, but the old code
        // read the cached `mousePos` state (stale on touch) — so dragStartPos
        // was captured away from the finger and every drawing jumped sideways
        // on grab. Fall back to mousePos only when the event has no coords.
        const rect = chartContainerRef.current?.getBoundingClientRect();
        let px: number | null = null;
        let py: number | null = null;
        if (rect && typeof e.clientX === 'number' && typeof e.clientY === 'number') {
            px = e.clientX - rect.left;
            py = e.clientY - rect.top;
        } else if (mousePos) {
            px = mousePos.x;
            py = mousePos.y;
        }
        if (px === null || py === null) return;
        setMousePos({ x: px, y: py });
        const coords = getChartCoordinates(px, py);
        if (coords) {
            const drawing = drawings.find(d => d.id === drawingId);
            if (drawing) {
                if (drawing.isLocked) return;
                dragMovedRef.current = false;
                setDragStartPos({
                    ...coords,
                    startClientX: typeof e.clientX === 'number' ? e.clientX : undefined,
                    startClientY: typeof e.clientY === 'number' ? e.clientY : undefined,
                    initialP1: { ...drawing.p1 },
                    initialP2: drawing.p2 ? { ...drawing.p2 } : undefined,
                    initialEntry: drawing.entry,
                    initialTarget: drawing.target,
                    initialStop: drawing.stop
                } as any);
                setDragState({ drawingId, handle });
            }
        }
    }, [mousePos, isLocked, activeTool, getChartCoordinates, drawings]);

    // Suppress the native browser menu on the chart. Selection actions live
    // in the floating pill (Lock / Copy / Delete / Close) — no popup menu.
    const handleContextMenuInternal = (e: React.MouseEvent) => {
        e.preventDefault();
        if (activeTool !== 'cursor' || currentDrawing) { setActiveTool('cursor'); setCurrentDrawing(null); }
    };

    // Double-click a drawing selects it.
    const handleDoubleClickDrawing = useCallback((e: React.MouseEvent, drawing: Drawing) => {
        e.stopPropagation();
        setSelectedIds([drawing.id]);
    }, []);

    // ── Touch handling for drawing (single-finger = draw, long-press = context menu) ──
    const longPressTimerRef = useRef<number | null>(null);
    const longPressTriggeredRef = useRef(false);
    const touchStartClientRef = useRef<{ x: number; y: number } | null>(null);
    // Tap/drag disambiguation (TV parity): a touch that barely moves is a tap
    // (select / open settings), only real movement starts a drag + history.
    const touchStartTimeRef = useRef(0);
    const touchMovedRef = useRef(false);
    const dragMovedRef = useRef(false);
    const touchStartDrawingRef = useRef<{ id: string; wasSelected: boolean } | null>(null);
    const lastEmptyTapRef = useRef<{ t: number; x: number; y: number } | null>(null);
    const snapHapticOnRef = useRef(false);
    // A touch-driven horizontal/vertical placement in progress. The 500ms
    // hold timer + touchend must not discard it: lifting the finger always
    // places the line at the release point (even after a hold-aim).
    const placingOneClickRef = useRef<'horizontal' | 'vertical' | null>(null);
    const hapticTick = useCallback((ms: number = 8) => {
        try { (navigator as any)?.vibrate?.(ms); } catch { /* no-op */ }
    }, []);
    // rAF-throttled tick: touchmove fires faster than React can re-render the
    // SVG layer — coalesce per frame so low-end phones don't lag mid-drag.
    const rafTickRef = useRef<number | null>(null);
    const queueTick = useCallback(() => {
        if (rafTickRef.current !== null) return;
        rafTickRef.current = requestAnimationFrame(() => {
            rafTickRef.current = null;
            setTick(t => t + 1);
        });
    }, []);
    useEffect(() => () => {
        if (rafTickRef.current !== null) cancelAnimationFrame(rafTickRef.current);
    }, []);
    // NOTE: long-press no longer opens a menu. Tap selects (DrawingLayer),
    // tap-again opens Style settings, and the floating pill handles the rest.

    const getTouchCoords = useCallback((touch: Touch | React.Touch) => {
        const rect = chartContainerRef.current?.getBoundingClientRect();
        if (!rect) return null;
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        return { x, y, clientX: touch.clientX, clientY: touch.clientY };
    }, []);

    const clearLongPress = useCallback(() => {
        if (longPressTimerRef.current !== null) {
            window.clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    }, []);

    useEffect(() => () => { clearLongPress(); }, [clearLongPress]);

    // ── Placement cursor (TradingView aim model, touch only) ─────────────
    // While a drawing tool is armed on a coarse pointer, single-finger drags
    // move a decoupled cursor (blue dot + crosshair, rendered by CustomChart)
    // and taps commit AT THE CURSOR — the finger never covers the target.
    // Desktop mouse flow below is untouched (aimPlacement is false there).
    // Pause replay the moment a drawing tool is armed (TV parity): the
    // chart must not scroll new bars under the aiming finger, or the
    // cursor and in-progress drawings visibly drift mid-gesture.
    useEffect(() => {
        if (activeTool !== 'cursor') setIsPlaying(false);
    }, [activeTool]);

    const resolvePlacementCursor = useCallback((x: number, y: number): PlacementCursorPoint | null => {
        if (!chartRef.current || !candlestickSeriesRef.current) return null;
        const c = getChartCoordinates(x, y);
        if (!c) return null;
        const r = snapPoint(x, y, c.time as number, c.price as number, c.logical);
        // WYSIWYG dot: when magnet snaps, the dot must sit ON the snapped
        // bar — not at the finger's x — or the drawing visibly shifts
        // horizontally the moment it commits.
        let cx = x;
        if (r.snapped) {
            const idx = Math.round((r.point as any).logical ?? (c.logical as number) ?? 0);
            const bx = chartRef.current.timeScale().logicalToCoordinate(idx);
            if (typeof bx === 'number' && Number.isFinite(bx)) cx = bx;
        }
        return {
            x: cx,
            y: r.snapped && r.snapY !== undefined ? r.snapY : y,
            time: (r.point as any).time,
            price: (r.point as any).price,
            logical: (r.point as any).logical ?? (c.logical as number) ?? 0,
            snapped: r.snapped,
        };
    }, [getChartCoordinates, snapPoint]);

    const {
        cursor: aimCursor, phase: aimPhase, cursorRef: aimCursorRef, phaseRef: aimPhaseRef,
        beginAim, moveAim, endAim, setPhase: setAimPhase, reset: resetAim,
    } = usePlacementCursor(
        resolvePlacementCursor,
        // Adaptive thumb gap: ~18% of chart height mid-chart, shrinking
        // toward thumb clearance near the bottom edge. dimensions is
        // declared below, so read it lazily at event time (see hook docs).
        (fingerYPx: number) => computeAimGap(fingerYPx, dimensions.height),
    );
    // Latest-ref: resetDrawingInteractionState is declared above this hook
    // but still needs to call resetAim. Reading resetAim directly up there
    // hits its TDZ and crashes first render, so it goes through this ref.
    useEffect(() => {
        resetAimRef.current = resetAim;
    }, [resetAim]);

    const aimPlacement = activeTool !== 'cursor' && isCoarsePointer && !isSelectBarMode && !isLocked;

    // Shared first-point assembly (tap-tap path below AND aim taps): tool
    // style + long/short entry/target/stop defaults from the trailing
    // 20-bar average range.
    const makeDrawingProps = useCallback((point: any): any => {
        const toolStyle = (toolDefaults as any)[activeTool] || {};
        const props: any = withOrigin({
            id: Date.now().toString(),
            type: activeTool,
            p1: point,
            p2: point,
            ...toolStyle,
            color: toolStyle.color || currentColor || '#2962ff',
        });
        if (activeTool === 'long' || activeTool === 'short') {
            const isLong = activeTool === 'long';
            const entryPrice = point.price;
            const rrRatio = toolStyle.rr2 || 2;
            const visibleData = allData.slice(Math.max(0, currentIndex - 19), currentIndex + 1);
            const avgRange = visibleData.length > 0
                ? visibleData.reduce((sum, cc) => sum + (cc.high - cc.low), 0) / visibleData.length
                : entryPrice * 0.005;
            const defaultRisk = avgRange || entryPrice * 0.005;
            props.entry = entryPrice;
            props.target = isLong ? entryPrice + (defaultRisk * rrRatio) : entryPrice - (defaultRisk * rrRatio);
            props.stop = isLong ? entryPrice - defaultRisk : entryPrice + defaultRisk;
        }
        return props;
    }, [activeTool, toolDefaults, currentColor, withOrigin, allData, currentIndex]);

    // Snap-enter haptic for the aim cursor (mirrors the drag-path feedback).
    const noteAimSnap = useCallback((c: PlacementCursorPoint | null) => {
        if (!c) return;
        if (c.snapped && !snapHapticOnRef.current) { snapHapticOnRef.current = true; hapticTick(5); }
        if (!c.snapped) snapHapticOnRef.current = false;
    }, [hapticTick]);

    // Arm a two-point stub at the aim cursor (tap-tap model): called from
    // commitAimTap when the first tap lifts in phase aim-p1.
    // One-click/text tools never enter this path.
    const armAimStub = useCallback((): boolean => {
        if (aimPhaseRef.current !== 'aim-p1') return false;
        const tool = activeTool;
        if (tool === 'horizontal' || tool === 'vertical' || tool === 'text') return false;
        const c = aimCursorRef.current;
        if (!c) return false;
        const pt = { time: c.time, price: c.price, logical: c.logical };
        const props = makeDrawingProps(pt);
        // Pause autoplay the moment a drawing starts (TV parity).
        setIsPlaying(false);
        hapticTick(8);
        setCurrentDrawing(props);
        setMousePos({ x: c.x, y: c.y });
        setAimPhase('aim-p2');
        return true;
    }, [aimPhaseRef, aimCursorRef, setAimPhase, activeTool, makeDrawingProps, setIsPlaying, hapticTick, setCurrentDrawing]);

    // Commit a tap at the aim cursor: p1 for one-click/text/two-point tools,
    // p2 finalize when a stub is armed.  Aim drags commit nothing.
    const commitAimTap = useCallback(() => {
        const c = aimCursorRef.current;
        if (!c || aimPhaseRef.current === 'idle') return;
        const pt = { time: c.time, price: c.price, logical: c.logical };
        const tool = activeTool;
        const afterCommit = () => {
            if (stickyMode) setAimPhase('aim-p1');
            else resetAim();
        };
        if (aimPhaseRef.current === 'aim-p1') {
            if (tool === 'horizontal' || tool === 'vertical') {
                const props = makeDrawingProps(pt);
                const final: any = tool === 'horizontal'
                    ? { ...props, p1: { ...props.p1, price: pt.price }, p2: { ...props.p2, price: pt.price } }
                    : { ...props, p1: { ...props.p1, time: pt.time, logical: pt.logical }, p2: { ...props.p2, time: pt.time, logical: pt.logical } };
                const next = [...drawings, withOrigin(final)];
                setDrawings(next);
                pushToHistory(next);
                setSelectedIds([props.id]);
                setSnapIndicator(null);
                snapHapticOnRef.current = false;
                hapticTick(8);
                finishToolAfterDraw();
                afterCommit();
                return;
            }
            if (tool === 'text') {
            const props = makeDrawingProps(pt);
            props.text = props.text || 'Text';
            const nextT = [...drawings, props];
            setDrawings(nextT);
            pushToHistory(nextT);
            setSelectedIds([props.id]);
            finishToolAfterDraw();
            afterCommit();
            return;
        }
        // Two-point tools: the first tap arms the stub at the cursor
        // (tap-tap p1); the second tap finalizes via the aim-p2 path below.
        armAimStub();
        return;
    }
        const cur = currentDrawing;
        if (!cur) { setAimPhase('aim-p1'); return; }
        // Screen-space minimum extent: a second point landing within 6px of
        // the anchor (finger jitter, not intent) keeps the preview armed
        // instead of committing a dot-sized drawing. Matches the old
        // release-distance rule, in the same screen space the dot shows in.
        try {
            const p1 = (cur as any).p1;
            const p1x = chartRef.current?.timeScale()?.logicalToCoordinate?.(p1.logical ?? 0);
            const p1y = candlestickSeriesRef.current?.priceToCoordinate?.(p1.price);
            if (typeof p1x === 'number' && typeof p1y === 'number' && Number.isFinite(p1x) && Number.isFinite(p1y)) {
                if (Math.hypot(c.x - p1x, c.y - p1y) < 6) return;
            }
        } catch { /* fall through to the data guard below */ }
        const tdx = (pt.logical ?? 0) - ((cur as any).p1.logical ?? 0);
        const tdy = (pt.price ?? 0) - ((cur as any).p1.price ?? 0);
        // Tap on the anchor keeps the preview armed (same guard as tap-tap).
        if (Math.abs(tdx) < 0.5 && Math.abs(tdy) < 1e-9) return;
        let finalized: any;
        if (cur.type === 'long' || cur.type === 'short') {
            const isLong = cur.type === 'long';
            const entryPrice = (cur as any).entry ?? (cur as any).p1.price;
            const mousePriceDist = Math.abs(pt.price - entryPrice);
            const defaults = (toolDefaults as any)[cur.type] || {};
            const rrRatio = defaults.rr2 || 2;
            const visibleData = allData.slice(Math.max(0, currentIndex - 19), currentIndex + 1);
            const avgRange = visibleData.length > 0 ? visibleData.reduce((sum, cc) => sum + (cc.high - cc.low), 0) / visibleData.length : entryPrice * 0.005;
            const risk = mousePriceDist > 0 ? mousePriceDist : (avgRange || entryPrice * 0.005);
            finalized = { ...cur, p2: pt, target: isLong ? entryPrice + (risk * rrRatio) : entryPrice - (risk * rrRatio), stop: isLong ? entryPrice - risk : entryPrice + risk };
        } else {
            finalized = { ...cur, p2: pt };
        }
        const next = [...drawings, withOrigin(finalized)];
        setDrawings(next);
        pushToHistory(next);
        setSelectedIds([cur.id]);
        setCurrentDrawing(null);
        setSnapIndicator(null);
        snapHapticOnRef.current = false;
        hapticTick(8);
        finishToolAfterDraw();
        afterCommit();
    }, [aimCursorRef, aimPhaseRef, setAimPhase, resetAim, activeTool, makeDrawingProps, drawings, withOrigin, pushToHistory, setSelectedIds, setCurrentDrawing, finishToolAfterDraw, setIsPlaying, hapticTick, toolDefaults, allData, currentIndex, stickyMode, currentDrawing, armAimStub]);

    const onTouchStart = useCallback((e: React.TouchEvent) => {
        if ((e.target as Element)?.closest?.('[data-drawing-toolbar]')) return;
        // Two-finger tap = cancel the in-progress drawing (standard TV gesture).
        if (e.touches.length === 2 && (currentDrawing || aimPhaseRef.current !== 'idle')) {
            setCurrentDrawing(null);
            placingOneClickRef.current = null;
            setSnapIndicator(null);
            resetAim();
            clearLongPress();
            setDragState(null);
            setDragStartPos(null);
            hapticTick(10);
            return;
        }
        // Multi-touch (pinch zoom) must never start — or keep alive — a drawing drag.
        if (e.touches.length !== 1) { clearLongPress(); setDragState(null); setDragStartPos(null); return; };
        const touch = e.touches[0];
        const coords = getTouchCoords(touch);
        if (!coords) return;
        // When a drawing tool is active pan is disabled (CustomChart disablePan),
        // so prevent browser scroll/zoom and treat the gesture as drawing.
        if (activeTool !== 'cursor' || isSelectBarMode) e.preventDefault();
        // Track start position for tap/drag disambiguation + long-press cancel.
        touchStartClientRef.current = { x: touch.clientX, y: touch.clientY };
        touchStartTimeRef.current = Date.now();
        touchMovedRef.current = false;
        touchStartDrawingRef.current = null;
        longPressTriggeredRef.current = false;
        clearLongPress();
        const holdX = coords.clientX;
        const holdY = coords.clientY;
        // Which drawing (if any) is under this touch? The SVG hit shapes carry
        // data-drawing-hit / data-drawing-id — hover state never exists on touch.
        const hitEl = (e.target as Element)?.closest?.('[data-drawing-hit]');
        const hitId = hitEl?.getAttribute?.('data-drawing-id') || null;
        const hitDrawing = hitId ? drawings.find(d => d.id === hitId) || null : null;
        if (hitDrawing) {
            touchStartDrawingRef.current = { id: hitDrawing.id, wasSelected: selectedIds.includes(hitDrawing.id) };
        } else if (activeTool === 'cursor' && !currentDrawing && !isSelectBarMode) {
            // Double-tap empty chart = deselect + cancel preview (TV behavior).
            const prevEmpty = lastEmptyTapRef.current;
            const nowEmpty = Date.now();
            if (prevEmpty && nowEmpty - prevEmpty.t < 300 &&
                Math.hypot(touch.clientX - prevEmpty.x, touch.clientY - prevEmpty.y) < 24) {
                lastEmptyTapRef.current = null;
                setSelectedIds([]);
                setCurrentDrawing(null);
                return;
            }
            lastEmptyTapRef.current = { t: nowEmpty, x: touch.clientX, y: touch.clientY };
        }
        // While aiming, press-hold-drag IS the gesture (no hold-to-cancel);
        // two-finger tap and the chip X remain the touch cancels. The timer
        // stays for cursor mode (select-on-hold) and desktop.
        if (!aimPlacement) longPressTimerRef.current = window.setTimeout(() => {
            longPressTriggeredRef.current = true;
            // A horizontal/vertical placement in progress survives the hold:
            // the ghost stays armed so lifting the finger still places the
            // line at the release point (touchend finalizes it).
            if (placingOneClickRef.current) {
                hapticTick(30);
                return;
            }
            // Long-press mirrors right-click: if a tool is active clear it,
            // otherwise (re)select the drawing under the finger so the
            // floating pill acts on it. No popup menu.
            if (activeTool !== 'cursor' || currentDrawing) {
                setActiveTool('cursor');
                setCurrentDrawing(null);
                placingOneClickRef.current = null;
                return;
            }
            // Hit-test the hold point directly (elementFromPoint survives SVG
            // group nesting); fall back to the tapped drawing / selection.
            let target = hitDrawing;
            if (!target) {
                const elAt = typeof document !== 'undefined'
                    ? document.elementFromPoint(holdX, holdY)?.closest?.('[data-drawing-hit]')
                    : null;
                const idAt = elAt?.getAttribute?.('data-drawing-id') || null;
                target = (idAt && drawings.find(d => d.id === idAt))
                    || hitDrawing
                    || (selectedDrawingId && drawings.find(d => d.id === selectedDrawingId))
                    || null;
            }
            if (target) {
                setSelectedIds([target.id]);
            }
            // Haptic feedback when available
            hapticTick(30);
        }, 500);

        // Reuse mouse-down drawing logic via touch coordinates
        if (!chartRef.current || !candlestickSeriesRef.current) return;
        const chartCoords = getChartCoordinates(coords.x, coords.y);
        if (!chartCoords) return;
        if (isSelectBarMode) {
            // Move the cut line only — the tap-to-cut confirm happens on
            // touch-end (tap without drag), so drag-to-preview never cuts early.
            const foundIdx = Math.max(0, Math.min(allData.length - 1, Math.round(chartCoords.logical ?? 0)));
            if (selectBarIndex !== foundIdx) setSelectBarIndex(foundIdx);
            return;
        }
        if (aimPlacement && !dragState) {
            // Tap-tap model (touch): touch-down only seeds the aim cursor.
            // The first tap arms p1 on lift (commitAimTap), the second tap
            // finalizes p2; drags only move the cursor, nothing arms here.
            // One-click/text tools only seed the cursor here — their tap
            // commits on lift via commitAimTap.
            snapHapticOnRef.current = false;
            const ac = beginAim(touch.identifier, coords.x, coords.y);
            if (ac) {
                setMousePos({ x: ac.x, y: ac.y });
                noteAimSnap(ac);
            }
            return;
        }
        if (currentDrawing && (currentDrawing.type !== 'horizontal' && currentDrawing.type !== 'vertical')) {
            // Second tap finalizes AT this tap (tap-tap drawing). Rebase p2
            // onto the tap point; a tap on the anchor keeps the preview armed.
            const snapEndT = snapPoint(coords.x, coords.y, chartCoords.time as number, chartCoords.price as number, chartCoords.logical).point;
            const tdx = (snapEndT.logical ?? 0) - ((currentDrawing as any).p1.logical ?? 0);
            const tdy = (snapEndT.price ?? 0) - ((currentDrawing as any).p1.price ?? 0);
            if (Math.abs(tdx) < 0.5 && Math.abs(tdy) < 1e-9) return;
            const finalizedT: any = { ...currentDrawing, p2: snapEndT };
            const next = [...drawings, withOrigin(finalizedT)];
            setDrawings(next);
            pushToHistory(next);
            setSelectedIds([currentDrawing.id]);
            setCurrentDrawing(null);
            hapticTick(8);
            finishToolAfterDraw();
            return;
        }
        if (activeTool === 'cursor') {
            // A tap that began on a drawing already selected it in DrawingLayer;
            // don't immediately deselect it (and let the chart pan from there).
            const startedOnDrawing = (e.target as Element)?.closest?.('[data-drawing-hit]');
            const startedOnToolbar = (e.target as Element)?.closest?.('[data-drawing-toolbar]');
            if (selectedDrawingId && !startedOnDrawing && !startedOnToolbar) setSelectedIds([]);
            return;
        }
        if (isLocked) {
            return;
        }
        const snapResT = snapPoint(coords.x, coords.y, chartCoords.time as number, chartCoords.price as number, chartCoords.logical);
        const snapped = snapResT.point;
        setSnapIndicator(snapResT.snapped && snapResT.snapY !== undefined ? { x: coords.x, y: snapResT.snapY } : null);
        if (snapResT.snapped && !snapHapticOnRef.current) { snapHapticOnRef.current = true; hapticTick(5); }
        if (!snapResT.snapped) snapHapticOnRef.current = false;
        let drawingProps: any = makeDrawingProps(snapped);
        // Pause autoplay the moment a drawing starts (TV parity) + anchor tick.
        setIsPlaying(false);
        hapticTick(8);
        if (activeTool === 'text') {
            drawingProps.text = drawingProps.text || 'Text';
            const nextT = [...drawings, drawingProps];
            setDrawings(nextT);
            pushToHistory(nextT);
            setSelectedIds([drawingProps.id]);
            finishToolAfterDraw();
            return;
        }
        setCurrentDrawing(drawingProps);
        // One-click placement tools (horizontal/vertical) are placed on lift:
        // remember the in-progress placement so a hold-aim never discards it.
        placingOneClickRef.current = (activeTool === 'horizontal' || activeTool === 'vertical') ? activeTool : null;
        setMousePos({ x: coords.x, y: coords.y });
    }, [getTouchCoords, getChartCoordinates, getSnappedPoint, snapPoint, activeTool, currentDrawing, drawings, isSelectBarMode, allData, currentIndex, isLocked, selectedDrawingId, selectedIds, selectBarIndex, toolDefaults, currentColor, hoveredDrawingId, pushToHistory, addToast, clearLongPress, finishToolAfterDraw, withOrigin, hapticTick, aimPlacement, dragState, beginAim, noteAimSnap, makeDrawingProps, aimPhaseRef, resetAim]);

    const onTouchMove = useCallback((e: React.TouchEvent) => {
        // Second finger down mid-gesture (pinch) cancels any drawing drag so
        // zooming never moves a drawing and no stale drag survives the pinch.
        if (e.touches.length !== 1) { setDragState(null); setDragStartPos(null); return; }
        const touch = e.touches[0];
        const coords = getTouchCoords(touch);
        if (!coords) return;
        // Cancel long-press if finger drifts
        if (touchStartClientRef.current) {
            const dx = touch.clientX - touchStartClientRef.current.x;
            const dy = touch.clientY - touchStartClientRef.current.y;
            if (Math.sqrt(dx * dx + dy * dy) > 10) clearLongPress();
            if (Math.sqrt(dx * dx + dy * dy) > 10) touchMovedRef.current = true;
        }
        // If we are drawing or dragging a handle, suppress native scrolling
        if (activeTool !== 'cursor' || dragState || currentDrawing || isSelectBarMode) e.preventDefault();
        setMousePos({ x: coords.x, y: coords.y });
        const chartCoords = getChartCoordinates(coords.x, coords.y);
        if (!chartCoords) return;
        if (isSelectBarMode) {
            const idx = Math.max(0, Math.min(allData.length - 1, Math.round((chartCoords.logical as number) ?? 0)));
            if (selectBarIndex !== idx) setSelectBarIndex(idx);
            return;
        }
        if (aimPlacement && !dragState) {
            // Aim drag: move the decoupled cursor (magnet applied inside the
            // resolver). Tap-tap model: nothing arms or commits on move; the
            // first tap's lift arms p1 and the ghost follows after that.
            const mc = moveAim(touch.identifier, coords.x, coords.y);
            if (mc) {
                setMousePos({ x: mc.x, y: mc.y });
                noteAimSnap(mc);
            }
            queueTick();
            return;
        }
        if (dragState && dragStartPos) {
            // 4px dead-zone shared with mouse: taps must not nudge drawings.
            const startDragT = dragStartPos as any;
            if (typeof startDragT.startClientX === 'number') {
                const movedPxT = Math.hypot(touch.clientX - startDragT.startClientX, touch.clientY - (startDragT.startClientY ?? touch.clientY));
                if (movedPxT < 4 && !dragMovedRef.current) return;
                dragMovedRef.current = true;
            } else {
                dragMovedRef.current = true;
            }
            const dPrice = (chartCoords.price as number) - dragStartPos.price;
            const dTime = (chartCoords.time as number) - dragStartPos.time;
            const dLog = (chartCoords.logical ?? 0) - (dragStartPos.logical ?? 0);
            const initialData = dragStartPos as any;
            setDrawings(prev => prev.map(d => {
                if (d.id !== dragState.drawingId) return d;
                const newD: any = { ...d };
                if (dragState.handle === 'move') {
                    const p1Base = initialData.initialP1;
                    const p2Base = initialData.initialP2;
                    // Axis lock (TV): horizontal lines only move in price,
                    // vertical only in time — same as the mouse path.
                    const lockTime = d.type === 'horizontal';
                    const lockPrice = d.type === 'vertical';
                    const getRebasedPoint = (base: any) => {
                        const newLog = base.logical !== undefined ? Math.round(base.logical + (lockTime ? 0 : dLog)) : undefined;
                        let newTime = lockTime ? base.time : base.time + dTime;
                        if (!lockTime && newLog !== undefined && newLog >= 0 && newLog < allData.length) newTime = allData[newLog].time;
                        return { time: newTime, price: base.price + (lockPrice ? 0 : dPrice), logical: newLog };
                    };
                    newD.p1 = getRebasedPoint(p1Base);
                    if (p2Base) newD.p2 = getRebasedPoint(p2Base);
                    if (d.type === 'long' || d.type === 'short') {
                        newD.entry = (initialData.initialEntry || 0) + dPrice;
                        newD.target = (initialData.initialTarget || 0) + dPrice;
                        newD.stop = (initialData.initialStop || 0) + dPrice;
                    }
                } else if (dragState.handle === 'target') {
                    newD.target = chartCoords.price;
                } else if (dragState.handle === 'stop') {
                    newD.stop = chartCoords.price;
                } else if (dragState.handle === 'entry') {
                    newD.entry = chartCoords.price;
                    newD.p1 = { ...newD.p1, price: chartCoords.price };
                } else {
                    const snp = snapPoint(coords.x, coords.y, chartCoords.time as number, chartCoords.price as number, chartCoords.logical).point;
                    if (dragState.handle === 'p1') { newD.p1 = snp; if (d.type === 'long' || d.type === 'short') newD.entry = snp.price; }
                    else if (dragState.handle === 'p2') newD.p2 = snp;
                }
                return newD;
            }));
            queueTick();
        }
        if (currentDrawing) {
            const snapLive = snapPoint(coords.x, coords.y, chartCoords.time as number, chartCoords.price as number, chartCoords.logical);
            const snp = snapLive.point;
            setSnapIndicator(snapLive.snapped && snapLive.snapY !== undefined ? { x: coords.x, y: snapLive.snapY } : null);
            if (snapLive.snapped && !snapHapticOnRef.current) { snapHapticOnRef.current = true; hapticTick(5); }
            if (!snapLive.snapped) snapHapticOnRef.current = false;
            if (currentDrawing.type === 'long' || currentDrawing.type === 'short') {
                const isLong = currentDrawing.type === 'long';
                const entryPrice = (currentDrawing as any).entry ?? currentDrawing.p1.price;
                const mousePriceDist = Math.abs(snp.price - entryPrice);
                const defaults = (toolDefaults as any)[currentDrawing.type] || {};
                const rrRatio = defaults.rr2 || 2;
                const visibleData = allData.slice(Math.max(0, currentIndex - 19), currentIndex + 1);
                const avgRange = visibleData.length > 0 ? visibleData.reduce((sum, c) => sum + (c.high - c.low), 0) / visibleData.length : entryPrice * 0.005;
                const risk = mousePriceDist > 0 ? mousePriceDist : (avgRange || entryPrice * 0.005);
                setCurrentDrawing(prev => prev ? { ...prev, p2: snp, target: isLong ? entryPrice + (risk * rrRatio) : entryPrice - (risk * rrRatio), stop: isLong ? entryPrice - risk : entryPrice + risk } as any : null);
            } else {
                const nextP2 = (currentDrawing as any).type === 'horizontal'
                    ? { ...snp, time: (currentDrawing as any).p1.time, logical: (currentDrawing as any).p1.logical }
                    : (currentDrawing as any).type === 'vertical'
                        ? { ...snp, price: (currentDrawing as any).p1.price }
                        : snp;
                setCurrentDrawing(prev => prev ? { ...prev, p2: nextP2 } as any : null);
            }
            queueTick();
        }
    }, [getTouchCoords, getChartCoordinates, getSnappedPoint, snapPoint, activeTool, dragState, dragStartPos, currentDrawing, allData, currentIndex, toolDefaults, clearLongPress, queueTick, hapticTick, aimPlacement, moveAim, noteAimSnap, aimPhaseRef]);

    const onTouchEnd = useCallback((e: React.TouchEvent) => {
        clearLongPress();
        const wasTap = !touchMovedRef.current;
        const tapDuration = Date.now() - touchStartTimeRef.current;
        touchStartClientRef.current = null;
        touchMovedRef.current = false;
        // Select-bar mode: only a clean tap cuts (drag-and-release just parks
        // the line — TV confirm model). The cut commits selectBarIndex.
        if (isSelectBarMode) {
            if (wasTap && !longPressTriggeredRef.current) {
                const cutIdx = selectBarIndex ?? null;
                if (cutIdx !== null) {
                    setCurrentIdx(cutIdx);
                    hapticTick(8);
                }
                setIsSelectBarMode(false);
                setSelectBarIndex(null);
            }
            longPressTriggeredRef.current = false;
            setDragState(null);
            setDragStartPos(null);
            return;
        }
        // Placement-cursor model (touch): taps commit at the cursor — the
        // first tap arms p1, the second tap finalizes p2 (tap-tap). Drags
        // only moved the cursor, so a drag-lift arms p1 at the lift point.
        if (aimPlacement && !dragState) {
            const lift = e.changedTouches[0];
            const liftCoords = lift ? getTouchCoords(lift) : null;
            const kind = lift && liftCoords ? endAim(lift.identifier, liftCoords.x, liftCoords.y) : null;
            // Taps route through commitAimTap (p1 arm / h-v-text / p2
            // finalize). Skip when another finger is still down —
            // pinch/multi-touch contaminates the gesture and must never
            // commit.
            if (kind && e.touches.length === 0) commitAimTap();
            longPressTriggeredRef.current = false;
            setDragState(null);
            setDragStartPos(null);
            return;
        }
        // One-click placement (horizontal/vertical): lifting the finger always
        // places the line at the exact release point — even after a hold-aim
        // (long-press must never swallow it). Same path for both tools.
        if (placingOneClickRef.current && currentDrawing &&
            (currentDrawing.type === 'horizontal' || currentDrawing.type === 'vertical')) {
            const release = e.changedTouches[0];
            let finalDrawing: any = { ...currentDrawing };
            const rel = release ? getTouchCoords(release) : null;
            const rc = rel ? getChartCoordinates(rel.x, rel.y) : null;
            if (rel && rc) {
                const snp = snapPoint(rel.x, rel.y, rc.time as number, rc.price as number, rc.logical).point;
                if (currentDrawing.type === 'horizontal') {
                    finalDrawing.p1 = { ...currentDrawing.p1, price: snp.price };
                    finalDrawing.p2 = { ...((currentDrawing as any).p2 || currentDrawing.p1), price: snp.price };
                } else {
                    finalDrawing.p1 = { ...currentDrawing.p1, time: snp.time, logical: snp.logical };
                    finalDrawing.p2 = { ...((currentDrawing as any).p2 || currentDrawing.p1), time: snp.time, logical: snp.logical };
                }
            }
            const next = [...drawings, withOrigin(finalDrawing)];
            setDrawings(next);
            pushToHistory(next);
            setSelectedIds([currentDrawing.id]);
            setCurrentDrawing(null);
            hapticTick(8);
            finishToolAfterDraw();
            placingOneClickRef.current = null;
            longPressTriggeredRef.current = false;
            touchStartDrawingRef.current = null;
            setDragState(null);
            setDragStartPos(null);
            setSnapIndicator(null);
            snapHapticOnRef.current = false;
            return;
        }
        placingOneClickRef.current = null;
        // If this was a long-press we already handled the menu – don't also finalize a drawing
        if (longPressTriggeredRef.current) {
            longPressTriggeredRef.current = false;
            setDragState(null);
            setDragStartPos(null);
            touchStartDrawingRef.current = null;
            return;
        }
        // Tap again on an already-selected drawing = re-affirm selection.
        // Drags (moved) fall through to the drag-commit path instead.
        const tapInfo = touchStartDrawingRef.current;
        touchStartDrawingRef.current = null;
        if (wasTap && tapDuration < 500 && tapInfo?.wasSelected && activeTool === 'cursor' && !currentDrawing) {
            setSelectedIds([tapInfo.id]);
            setDragState(null);
            setDragStartPos(null);
            dragMovedRef.current = false;
            return;
        }
        if (dragState && dragMovedRef.current) pushToHistory(drawings);
        dragMovedRef.current = false;
        if (currentDrawing) {
            const isOneClickTool = currentDrawing.type === 'horizontal' || currentDrawing.type === 'vertical';
            const rect = chartContainerRef.current?.getBoundingClientRect();
            if (rect && chartRef.current && candlestickSeriesRef.current) {
                const p1x = chartRef.current.timeScale().logicalToCoordinate((currentDrawing as any).p1.logical ?? 0) ?? 0;
                const p1y = candlestickSeriesRef.current.priceToCoordinate((currentDrawing as any).p1.price);
                const p2x = mousePos?.x ?? p1x;
                const p2y = mousePos?.y ?? p1y;
                const dist = Math.sqrt(Math.pow(p2x - p1x, 2) + Math.pow(p2y - p1y, 2));
                if (isOneClickTool || dist > 5) {
                    const next = [...drawings, withOrigin(currentDrawing)];
                    setDrawings(next);
                    pushToHistory(next);
                    setSelectedIds([currentDrawing.id]);
                    setCurrentDrawing(null);
                    hapticTick(8);
                    finishToolAfterDraw();
                } else if (!isOneClickTool) {
                    // Lifted finger without dragging: KEEP the stub armed so
                    // the next tap finalizes tap-tap (mirrors desktop
                    // mouse-up, which never discards). Discarding here made
                    // touch tap-tap impossible — the stub never survived to
                    // the second tap. A tap on the anchor keeps it armed.
                }
            }
        }
        setDragState(null);
        setDragStartPos(null);
        setSnapIndicator(null);
        snapHapticOnRef.current = false;
    }, [clearLongPress, dragState, drawings, currentDrawing, mousePos, pushToHistory, finishToolAfterDraw, isSelectBarMode, selectBarIndex, activeTool, withOrigin, hapticTick, getTouchCoords, getChartCoordinates, snapPoint, aimPlacement, endAim, commitAimTap]);

    const [tick, setTick] = useState(0);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    useEffect(() => {
        if (!chartContainerRef.current) return;
        const updateDimensions = () => {
            if (chartContainerRef.current) {
                setDimensions({
                    width: chartContainerRef.current.clientWidth,
                    height: chartContainerRef.current.clientHeight
                });
            }
        };
        updateDimensions();
        window.addEventListener('resize', updateDimensions);

        const observer = new ResizeObserver(updateDimensions);
        observer.observe(chartContainerRef.current);

        // Always show welcome on refresh as requested
        setShowWelcome(true);

        return () => {
            window.removeEventListener('resize', updateDimensions);
            observer.disconnect();
        };
    }, []);

    const resetReplay = () => {
        setCurrentIdx(0);
        setIsPlaying(false);
    };

    const stepForward = () => {
        stepForwardRef.current();
    };

    // Ref-stable stepper for the autoplay interval: the timer never resets
    // mid-play (no drift at slow speeds) because the effect below only
    // depends on [isPlaying, playSpeed]. Latest values flow through a mirror.
    const replayLiveRef = useRef({ currentIndex, allDataLen: allData.length, isAutoFollow });
    replayLiveRef.current = { currentIndex, allDataLen: allData.length, isAutoFollow };
    const stepForwardRef = useRef<() => void>(() => {});
    stepForwardRef.current = () => {
        const s = replayLiveRef.current;
        if (s.currentIndex < s.allDataLen - 1) {
            setCurrentIdx(s.currentIndex + 1);
            setTick(t => t + 1);
            if (chartRef.current) {
                chartRef.current.timeScale().updateOffsetForNewBar(s.isAutoFollow);
            }
        } else {
            setIsPlaying(false);
            addToast({ type: 'info', title: 'End of Data' });
        }
    };

    const stepBack = useCallback(() => {
        if (currentIndex > 0) {
            setCurrentIdx(currentIndex - 1);
            setTick(t => t + 1);
            if (chartRef.current) {
                chartRef.current.timeScale().updateOffsetForNewBar(isAutoFollow);
            }
        }
    }, [currentIndex, isAutoFollow]);

    const handleProgressBarClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (allData.length === 0) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const idx = Math.round(ratio * (allData.length - 1));
        setIsPlaying(false);
        setCurrentIdx(idx);
        setTick(t => t + 1);
        if (chartRef.current) {
            chartRef.current.timeScale().updateOffsetForNewBar(isAutoFollow);
        }
    }, [allData.length, isAutoFollow]);

    // ── Touch scrubbing (TV): drag across the progress bar to jump live ──
    const scrubbingRef = useRef(false);
    const scrubToRatio = useCallback((clientX: number, el: HTMLElement) => {
        if (allData.length === 0) return;
        const rect = el.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const idx = Math.round(ratio * (allData.length - 1));
        setIsPlaying(false);
        setCurrentIdx(idx);
        setTick(t => t + 1);
        if (chartRef.current) {
            chartRef.current.timeScale().updateOffsetForNewBar(isAutoFollow);
        }
    }, [allData.length, isAutoFollow]);

    // ── Jump-to-bar sheet helpers ──
    const jumpToBar = useCallback((n: number) => {
        if (allData.length === 0 || !isFinite(n)) return;
        const idx = Math.max(0, Math.min(allData.length - 1, Math.round(n)));
        setIsPlaying(false);
        setCurrentIdx(idx);
        setTick(t => t + 1);
        if (chartRef.current) chartRef.current.timeScale().updateOffsetForNewBar(isAutoFollow);
        setIsJumpSheetOpen(false);
        hapticTick(8);
    }, [allData.length, isAutoFollow, hapticTick]);
    const jumpLive = useCallback(() => {
        if (allData.length === 0) return;
        setIsPlaying(false);
        setCurrentIdx(allData.length - 1);
        setTick(t => t + 1);
        if (chartRef.current) chartRef.current.timeScale().scrollToRealtime();
        setIsJumpSheetOpen(false);
    }, [allData.length]);

    // Select-bar mouse tap tracking: mouse-down only previews the cut line,
    // mouse-up commits on a tap (<8px). This keeps hover-then-click working
    // on drawings (which the canvas never sees) while preserving
    // drag-to-preview without cutting early (TradingView confirm model).
    const selectBarMouseDownRef = useRef<{ x: number; y: number } | null>(null);

    // Long-press the step-back button = restart from bar 0 (saves dock space).
    const dockLpTimer = useRef<number | null>(null);
    const dockLpFired = useRef(false);
    const clearDockLp = useCallback(() => {
        if (dockLpTimer.current !== null) { window.clearTimeout(dockLpTimer.current); dockLpTimer.current = null; }
    }, []);
    useEffect(() => () => { clearDockLp(); }, [clearDockLp]);

    useEffect(() => {
        let interval: any;
        if (isPlaying) interval = setInterval(() => stepForwardRef.current(), playSpeed);
        return () => clearInterval(interval);
    }, [isPlaying, playSpeed]);

    const handleUndoTrade = useCallback(() => {
        if (history.length === 0) return;
        const lastTrade = history[history.length - 1];
        setHistory(prev => prev.slice(0, -1));
        addToast({ type: 'info', title: 'Trade Undone', message: `Removed ${lastTrade.type} at ${lastTrade.entry}` });
    }, [history, addToast]);

    const handleCoordinatesChange = useCallback((c: any, s: any) => {
        const isInitial = !chartRef.current || !candlestickSeriesRef.current;
        chartRef.current = c;
        candlestickSeriesRef.current = s;
        if (isInitial) {
            setTick(t => t + 1);
        }
    }, []);

    // Watchlist sorted: starred first, then alphabetical
    const sortedWatchlist = useMemo(() => {
        const list = WATCHLISTS[watchlistCategory] || [];
        return [...list].sort((a, b) => {
            const aStar = starredSymbols.includes(a) ? -1 : 0;
            const bStar = starredSymbols.includes(b) ? -1 : 0;
            if (aStar !== bStar) return aStar - bStar;
            return a.localeCompare(b);
        });
    }, [watchlistCategory, starredSymbols]);

    const handleWatchlistSymbolClick = useCallback(async (fullSymbol: string) => {
        // Strip prefix: 'FX:EURUSD' -> 'EURUSD'
        const bareSymbol = fullSymbol.split(':')[1] || fullSymbol;
        setSymbol(bareSymbol);
        setIsWatchlistOpen(false);
        handleFetchActiveSourceData(bareSymbol);
    }, [setSymbol, handleFetchActiveSourceData]);

    const toggleStar = useCallback((fullSymbol: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        setStarredSymbols(prev =>
            prev.includes(fullSymbol)
                ? prev.filter(s => s !== fullSymbol)
                : [...prev, fullSymbol]
        );
    }, [setStarredSymbols]);

    // Tool keyboard shortcuts mapping
    const toolShortcuts: Record<string, ToolType> = {
        'KeyV': 'cursor',
        'KeyT': 'trendline',
        'KeyR': 'ray',
        'KeyA': 'arrow',
        'KeyH': 'horizontal',
        'KeyN': 'vertical',
        'KeyB': 'rect',
        'KeyC': 'channel',
        'KeyL': 'long',
        'KeyS': 'short',
        'KeyF': 'fib',
        'KeyW': 'text',
        'KeyU': 'measure',
    };

    // Global Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if user is typing in an input
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            if (e.code === 'Space') {
                e.preventDefault(); // Prevent page scroll
                centerChart();
            }

            // Tool shortcuts (only when not pressing Ctrl/Cmd)
            if (!e.ctrlKey && !e.metaKey) {
                const tool = toolShortcuts[e.code];
                if (tool) {
                    e.preventDefault();
                    setActiveTool(tool);
                }
            }

            // Toggle magnet mode with M
            if (e.code === 'KeyM' && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                setMagnetMode(!magnetMode);
            }

            // Toggle lock with L (when not drawing)
            if (e.code === 'KeyL' && !e.ctrlKey && !e.metaKey && e.shiftKey) {
                e.preventDefault();
                setIsLocked(!isLocked);
            }

            // Undo/Redo with Ctrl/Cmd
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
                e.preventDefault();
                handleUndo();
            }
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
                e.preventDefault();
                handleRedo();
            }

            // Delete selected drawings (multi-select parity)
            if (e.code === 'Delete' || e.code === 'Backspace') {
                if (selectedIds.length && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
                    e.preventDefault();
                    const next = drawings.filter(d => !selectedIds.includes(d.id));
                    setDrawings(next);
                    pushToHistory(next);
                    setSelectedIds([]);
                }
            }

            // TV clipboard: Ctrl+D duplicate, Ctrl+C copy, Ctrl+V paste, Ctrl+A select all
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') {
                e.preventDefault();
                duplicateSelected();
            }
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC') {
                const sel = drawings.filter(d => selectedIds.includes(d.id));
                if (sel.length) { e.preventDefault(); setClipboard(sel[0]); }
            }
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') {
                if (clipboard && mousePos && chartContainerRef.current) {
                    e.preventDefault();
                    const rect = chartContainerRef.current.getBoundingClientRect();
                    handlePasteDrawing(mousePos.x, mousePos.y);
                    void rect;
                }
            }
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
                if (drawings.length) { e.preventDefault(); setSelectedIds(drawings.map(d => d.id)); }
            }

            // Escape to deselect or exit modes
            if (e.code === 'Escape') {
                setStyleDrawer(null);
                setSelectedIds([]);
                setCurrentDrawing(null); // Cancel active drawing
                placingOneClickRef.current = null;
                resetAim();
                setIsSelectBarMode(false);
                setActiveTool('cursor');
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [centerChart, magnetMode, isLocked, selectedIds, handleUndo, handleRedo, drawings, pushToHistory, addToast, duplicateSelected, clipboard, mousePos, handlePasteDrawing, resetAim]);


    return (
        <div className={`w-full h-full flex flex-col overflow-hidden font-sans ${isDarkMode ? 'bg-black text-zinc-200' : 'bg-white text-slate-900'}`} onMouseUp={handleMouseUp}>
            {!isFullscreenCanvas && !showWelcome && (
            <div className={`h-12 sm:h-16 shrink-0 border-b flex items-center justify-between px-2.5 sm:px-6 z-50 relative shadow-sm gap-2 sm:gap-4 overflow-visible ${isDarkMode ? 'border-[#1f1f1f] bg-[#0a0a0a]/95 backdrop-blur-sm' : 'border-slate-200 bg-white/95 backdrop-blur-sm'}`}>
                {/* Replay Counter + Wide Progress Bar closing the empty space */}
                {allData.length > 0 ? (
                    <div className="flex-1 flex items-center justify-center min-w-0 px-1 sm:px-2">
                        <div className="flex flex-col items-center justify-center gap-0.5 w-full max-w-[280px] sm:max-w-[380px]">
                            <div className="hidden sm:flex justify-center items-center gap-2 w-full mb-0.5">
                                <span className="text-[8px] font-bold uppercase tracking-widest text-zinc-500">Replay</span>
                                <button
                                    onClick={() => { setJumpInput(String(currentIndex + 1)); setIsJumpSheetOpen(true); }}
                                    title="Jump to bar"
                                    className={`min-h-0 text-[9px] font-mono font-bold tabular-nums px-1 rounded hover:bg-white/10 ${isDarkMode ? 'text-zinc-400' : 'text-slate-600'}`}
                                >
                                    {currentIndex + 1}/{allData.length}
                                </button>
                            </div>
                            <button
                                onClick={() => { setJumpInput(String(currentIndex + 1)); setIsJumpSheetOpen(true); }}
                                title="Jump to bar"
                                className={`sm:hidden min-h-0 relative z-10 text-[9px] font-mono font-bold leading-none tabular-nums whitespace-nowrap px-1.5 py-0.5 rounded ${isDarkMode ? 'text-zinc-300' : 'text-slate-700'}`}
                            >
                                {currentIndex + 1}/{allData.length}
                            </button>
                            <div
                                onClick={handleProgressBarClick}
                                onPointerDown={(e) => {
                                    if (e.pointerType === 'mouse' && e.button !== 0) return;
                                    scrubbingRef.current = true;
                                    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                                    scrubToRatio(e.clientX, e.currentTarget);
                                }}
                                onPointerMove={(e) => {
                                    if (scrubbingRef.current) scrubToRatio(e.clientX, e.currentTarget);
                                }}
                                onPointerUp={() => { scrubbingRef.current = false; }}
                                onPointerCancel={() => { scrubbingRef.current = false; }}
                                className={`w-full min-w-[28px] h-1.5 sm:h-2 rounded-full cursor-pointer touch-none select-none ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-200'} transition-colors relative`}
                                title="Drag to scrub, click to jump"
                            >
                                <div
                                    className="h-full bg-emerald-500 transition-all duration-150 ease-out rounded-full pointer-events-none"
                                    style={{ width: `${Math.min(100, ((currentIndex + 1) / allData.length) * 100)}%` }}
                                />
                                {/* Fat invisible grab strip for fingers */}
                                <div className="absolute -inset-y-2.5 inset-x-0" />
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1" />
                )}

                {/* Right Section: Back button placed near orange icon, Auto-follow, Timeframe, Watchlist */}
                <div className="flex items-center gap-1 sm:gap-1.5 justify-end shrink-0 min-w-0">
                    {(!showWelcome || allData.length > 0) && (
                        <button
                            onClick={() => {
                                setIsFullscreenCanvas(false);
                                setIsPlaying(false);
                                setShowWelcome(true);
                            }}
                            className={`p-1.5 rounded-lg transition-all shrink-0 ${isDarkMode ? 'text-zinc-400 hover:text-white hover:bg-white/10' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'}`}
                            title="Back to Lab Menu"
                            aria-label="Back to Lab Menu"
                        >
                            <ArrowLeftToLine size={16} />
                        </button>
                    )}
                    {allData.length > 0 && (
                        <button
                            onClick={() => {
                                setIsAutoFollow((v: boolean) => !v);
                                addToast({ type: 'info', title: isAutoFollow ? 'Follow Off' : 'Follow On', message: isAutoFollow ? 'Chart stays put as replay advances.' : 'Chart follows the replay cursor.' });
                            }}
                            title={isAutoFollow ? 'Following replay (tap to lock view)' : 'View locked (tap to follow replay)'}
                            aria-pressed={isAutoFollow}
                            className={`p-1.5 rounded-lg transition-all shrink-0 touch-manipulation ${isAutoFollow ? 'text-[#FF4F01]' : (isDarkMode ? 'text-zinc-600 hover:text-zinc-300' : 'text-slate-400 hover:text-slate-600')}`}
                        >
                            <LocateFixed size={14} />
                        </button>
                    )}
                    <div className={`w-px h-5 shrink-0 ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-200'}`} />
                    {/* Timeframe Selector Pill (left of watchlist) */}
                    <div className="relative group/tf shrink-0">
                        <button
                            onClick={() => setIsTFMenuOpen(!isTFMenuOpen)}
                            className={`flex items-center gap-1 px-1.5 py-1 rounded-lg text-[10px] sm:text-xs font-bold transition-all ${
                                isDarkMode
                                    ? 'text-zinc-300 hover:text-white hover:bg-white/5'
                                    : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
                            }`}
                        >
                            <span>{timeframe}</span>
                            <ChevronDown size={11} className="text-zinc-400" />
                            {(isCtraderFetching || isFetching) && <Loader2 size={10} className="animate-spin text-[#FF4F01] shrink-0 ml-0.5" />}
                        </button>
                        {isTFMenuOpen && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setIsTFMenuOpen(false)} />
                                <div className={`absolute top-full left-1/2 -translate-x-1/2 mt-2 w-16 rounded-2xl border shadow-2xl p-1.5 z-[100] backdrop-blur-xl animate-sheet-fade origin-top ${isDarkMode ? 'bg-black/85 border-white/10' : 'bg-white border-slate-200'}`}>
                                    {['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'].map(tf => (
                                        <button key={tf} onClick={() => { setTimeframe(tf); setIsTFMenuOpen(false); handleFetchActiveSourceData(undefined, tf); }} className={`w-full flex items-center justify-center gap-1 px-1 py-2 rounded-xl ${timeframe === tf ? 'bg-[#FF4F01] text-white' : (isDarkMode ? 'text-zinc-400 hover:bg-white/5 hover:text-white' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')}`}>
                                            <span className="text-[11px] font-bold">{tf}</span>
                                            {timeframe === tf && <Check size={12} className="text-white shrink-0" />}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                    <button
                        onClick={() => setIsWatchlistOpen(!isWatchlistOpen)}
                        title="Toggle Watchlist Sidebar"
                        aria-label="Toggle watchlist sidebar"
                        aria-pressed={isWatchlistOpen}
                        className={`p-1.5 rounded-lg shrink-0 transition-colors touch-manipulation ${isWatchlistOpen ? 'bg-[#FF4F01] text-white' : isDarkMode ? 'hover:bg-zinc-900 text-zinc-400' : 'hover:bg-slate-100 text-slate-500'}`}
                    >
                        <List size={18} />
                    </button>
                </div>
            </div>
            )}

            <div className={`flex-1 flex relative overflow-hidden min-h-0 group ${isDarkMode ? 'bg-black' : 'bg-slate-50'}`}>
                <div
                    ref={chartContainerRef}
                    className="relative flex-1 w-full h-full min-h-0 min-w-0 outline-none"
                    style={{ touchAction: (activeTool !== 'cursor' || isSelectBarMode) ? 'none' : 'pan-y' }}
                    onContextMenu={handleContextMenuInternal}
                    onMouseDown={onMouseDown}
                    onMouseMove={onMouseMove}
                    onMouseUp={handleMouseUp}
                    onTouchStart={onTouchStart}
                    onTouchMove={onTouchMove}
                    onTouchEnd={onTouchEnd}
                >
                {isChartOpen && allData.length > 0 && (
                <DrawingToolbarV2
                    activeTool={activeTool}
                    setActiveTool={setActiveTool}
                    clearDrawings={clearDrawings}
                    magnetMode={magnetMode}
                    toggleMagnetMode={toggleMagnetModeCb}
                    isLocked={toolbarLocked}
                    toggleLocked={toggleLockedCb}
                    orientation={toolbarOrientation}
                    toggleOrientation={toggleToolbarOrientationCb}
                    isDarkMode={isDarkMode}
                    onUndo={handleUndo}
                    onRedo={handleRedo}
                    canUndo={historyPointer > 0}
                    canRedo={historyPointer < historyStates.length - 1}
                    currentColor={currentToolbarColor}
                    setCurrentColor={handleToolbarColorChange}
                    currentStrokeWidth={currentStrokeWidth}
                    currentStrokeStyle={currentStrokeStyle}
                    setStrokeWidth={handleToolbarStrokeWidthChange}
                    setStrokeStyle={handleToolbarStrokeStyleChange}
                    selectedDrawingId={selectedDrawingId}
                    selectedIds={selectedIds}
                    onDeleteSelected={deleteSelected}
                    drawingsCount={drawings.length}
                    stickyMode={stickyMode}
                    toggleStickyMode={() => setStickyMode((v: boolean) => !v)}
                />
                )}
                    {dataNotice && allData.length > 0 && (
                        <div
                            role="status"
                            className={`absolute bottom-2 left-2 z-40 rounded-lg border px-2.5 py-1 text-[10px] font-bold shadow-lg backdrop-blur-sm ${isDarkMode ? 'border-amber-500/25 bg-black/75 text-amber-300' : 'border-amber-300 bg-amber-50/95 text-amber-700'}`}
                        >
                            {dataNotice}
                        </div>
                    )}
                    <ChartErrorBoundary>
                        {/* Armed-tool chip (TV): obvious draw mode + on-screen cancel */}
                        {isChartOpen && allData.length > 0 && activeTool !== 'cursor' && (
                            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 pl-3 pr-1.5 py-1 rounded-full bg-[#2962ff] text-white shadow-lg shadow-black/40 max-w-[calc(100%-120px)]">
                                <span className="text-[11px] font-bold whitespace-nowrap overflow-hidden text-ellipsis">
                                    {TOOL_LABELS[activeTool] || activeTool} — {isCoarsePointer ? (
                                        activeTool === 'horizontal' || activeTool === 'vertical' || activeTool === 'text'
                                            ? 'tap to place'
                                            : (aimPhase === 'aim-p2' ? 'tap to set point 2/2' : 'tap to set point 1/2')
                                    ) : (
                                        <>tap {activeTool === 'horizontal' || activeTool === 'vertical' || activeTool === 'text' ? 'once' : 'two points'}</>
                                    )}
                                </span>
                                <button
                                    onClick={() => { setActiveTool('cursor'); setCurrentDrawing(null); resetAim(); }}
                                    aria-label="Cancel drawing tool"
                                    className="w-7 h-7 grid place-items-center rounded-full bg-white/20 hover:bg-white/30 active:scale-95 touch-manipulation shrink-0"
                                >
                                    <X size={13} strokeWidth={2.5} />
                                </button>
                            </div>
                        )}
                        {/* Selection quick-actions (TV edit flyout): no long-press needed */}
                        {isChartOpen && allData.length > 0 && selectedDrawing && activeTool === 'cursor' && !isSelectBarMode && !styleDrawer && (
                            <div
                                data-drawing-toolbar
                                onMouseDown={(e) => e.stopPropagation()}
                                onTouchStart={(e) => e.stopPropagation()}
                                onPointerDown={(e) => e.stopPropagation()}
                                className={`absolute top-2 left-1/2 -translate-x-1/2 z-40 flex items-center gap-0.5 p-1 rounded-2xl border shadow-xl backdrop-blur-xl overflow-x-auto no-scrollbar ${isDarkMode ? 'bg-black/85 border-white/10' : 'bg-white/90 border-slate-200'}`}>
                                <button
                                    onClick={() => { setStyleDrawer('color'); hapticTick(8); }}
                                    title="Line color"
                                    aria-label="Line color"
                                    className={`min-w-[44px] min-h-[44px] px-2 shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-xl active:scale-95 touch-manipulation ${isDarkMode ? 'text-zinc-300 hover:bg-white/10' : 'text-slate-600 hover:bg-slate-100'}`}
                                >
                                    <Palette size={16} />
                                    <span className="text-[8px] font-bold leading-none">Color</span>
                                </button>
                                {selectedDrawing.type !== 'text' && (
                                    <button
                                        onClick={() => { setStyleDrawer('width'); hapticTick(8); }}
                                        title="Line width"
                                        aria-label="Line width"
                                        className={`min-w-[44px] min-h-[44px] px-2 shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-xl active:scale-95 touch-manipulation ${isDarkMode ? 'text-zinc-300 hover:bg-white/10' : 'text-slate-600 hover:bg-slate-100'}`}
                                    >
                                        <Minus size={16} strokeWidth={Math.min(4, Math.max(1.5, selectedDrawing.strokeWidth || 1))} />
                                        <span className="text-[8px] font-bold leading-none">Width</span>
                                    </button>
                                )}
                                {selectedDrawing.type !== 'text' && (
                                    <button
                                        onClick={() => { setStyleDrawer('style'); hapticTick(8); }}
                                        title="Line style"
                                        aria-label="Line style"
                                        className={`min-w-[44px] min-h-[44px] px-2 shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-xl active:scale-95 touch-manipulation ${isDarkMode ? 'text-zinc-300 hover:bg-white/10' : 'text-slate-600 hover:bg-slate-100'}`}
                                    >
                                        <span className={`w-4 border-t-[3px] border-current ${selectedDrawing.strokeStyle === 'dashed' ? 'border-dashed' : selectedDrawing.strokeStyle === 'dotted' ? 'border-dotted' : 'border-solid'}`} />
                                        <span className="text-[8px] font-bold leading-none">Line</span>
                                    </button>
                                )}
                                <button
                                    onClick={() => { updateDrawingProperty(selectedDrawing.id, { isLocked: !selectedDrawing.isLocked }); hapticTick(8); }}
                                    title={selectedDrawing.isLocked ? 'Unlock' : 'Lock'}
                                    aria-label={selectedDrawing.isLocked ? 'Unlock' : 'Lock'}
                                    className={`min-w-[44px] min-h-[44px] px-2 shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-xl active:scale-95 touch-manipulation ${isDarkMode ? 'text-zinc-300 hover:bg-white/10' : 'text-slate-600 hover:bg-slate-100'}`}
                                >
                                    {selectedDrawing.isLocked ? <Lock size={16} /> : <Unlock size={16} />}
                                    <span className="text-[8px] font-bold leading-none">{selectedDrawing.isLocked ? 'Locked' : 'Lock'}</span>
                                </button>
                                <button
                                    onClick={() => { duplicateSelected(); hapticTick(8); addToast({ type: 'success', title: selectedIds.length > 1 ? `${selectedIds.length} drawings copied` : 'Drawing copied', message: 'Duplicate selected — drag it into place.' }); }}
                                    title="Duplicate"
                                    aria-label="Duplicate drawing"
                                    className={`min-w-[44px] min-h-[44px] px-2 shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-xl active:scale-95 touch-manipulation ${isDarkMode ? 'text-zinc-300 hover:bg-white/10' : 'text-slate-600 hover:bg-slate-100'}`}
                                >
                                    <Copy size={16} />
                                    <span className="text-[8px] font-bold leading-none">Copy</span>
                                </button>
                                <button
                                    onClick={() => { const n = selectedIds.length; deleteSelected(); setStyleDrawer(null); hapticTick(8); addToast({ type: 'info', title: n > 1 ? `${n} drawings deleted` : 'Drawing deleted', message: 'Tap Undo in the toolbar to restore.' }); }}
                                    title="Delete"
                                    aria-label="Delete drawing"
                                    className="min-w-[44px] min-h-[44px] px-2 shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-xl text-rose-500 hover:bg-rose-500/10 active:scale-95 touch-manipulation"
                                >
                                    <Trash2 size={16} />
                                    <span className="text-[8px] font-bold leading-none">Delete</span>
                                </button>
                                <button
                                    onClick={() => { setSelectedIds([]); setStyleDrawer(null); }}
                                    title="Deselect"
                                    aria-label="Deselect drawing"
                                    className={`min-w-[40px] min-h-[44px] px-1 shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-xl active:scale-95 touch-manipulation ${isDarkMode ? 'text-zinc-500 hover:bg-white/10' : 'text-slate-400 hover:bg-slate-100'}`}
                                >
                                    <X size={16} />
                                    <span className="text-[8px] font-bold leading-none">Close</span>
                                </button>
                            </div>
                        )}
                        <CustomChart
                            data={allData.slice(0, currentIndex + 1)}
                            trades={history as any}
                            drawings={visibleDrawings}
                            isDarkMode={isDarkMode}
                            symbol={symbol}
                            timeframe={timeframe}
                            tradingView
                            isSelectBarMode={isSelectBarMode}
                            selectBarIndex={selectBarIndex}
                            onSelectBar={(idx) => { setCurrentIdx(idx); setIsSelectBarMode(false); setSelectBarIndex(null); }}
                            onSelectBarMove={(idx) => setSelectBarIndex(idx)}
                            onCoordinatesChange={handleCoordinatesChange}
                            onMouseUpdate={(x, y) => setMousePos({ x, y })}
                            onViewStateChange={handleViewStateChange}
                            initialViewState={chartViewState}
                            disablePan={activeTool !== 'cursor' || isSelectBarMode}
                            selectedIds={selectedIds}
                            selectedDrawingId={selectedDrawingId}
                            hoveredDrawingId={hoveredDrawingId}
                            previewDrawing={currentDrawing}
                            previewMouse={mousePos}
                            snapIndicator={snapIndicator}
                            placementCursor={aimCursor ? { x: aimCursor.x, y: aimCursor.y, snapped: aimCursor.snapped } : null}
                        >
                            <DrawingLayer drawings={visibleDrawings} currentDrawing={currentDrawing} selectedDrawingId={selectedDrawingId} hoveredDrawingId={hoveredDrawingId} mousePos={mousePos} chart={chartRef.current} series={candlestickSeriesRef.current} containerWidth={dimensions.width - PRICE_SCALE_WIDTH} containerHeight={dimensions.height} activeTool={activeTool} isSelectBarMode={isSelectBarMode} onMouseDownHandle={handleMouseDownHandle} onSelectDrawing={handleSelectDrawing} onHoverDrawing={setHoveredDrawingId} onDoubleClickDrawing={handleDoubleClickDrawing} selectedIds={selectedIds} tick={tick} isLocked={isLocked} isDarkMode={isDarkMode} />
                        </CustomChart>
                    </ChartErrorBoundary>

                    {/* Pair/TF loading feedback: dims the previous chart under a
                        status card so switching pairs never looks like a freeze.
                        Delayed by beginChartLoading, so cache hits never flash it. */}
                    <AnimatePresence>
                        {chartLoadingLabel && !showWelcome && (
                            <motion.div
                                key="chart-loading-overlay"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.15 }}
                                className={`absolute inset-0 z-[55] flex items-center justify-center ${isDarkMode ? 'bg-black/50' : 'bg-white/60'} backdrop-blur-[2px]`}
                            >
                                <div className={`flex items-center gap-4 px-6 py-4 rounded-2xl border shadow-2xl ${isDarkMode ? 'bg-black/90 border-zinc-700' : 'bg-white/95 border-slate-200'}`}>
                                    <Loader2 size={22} className="animate-spin text-[#FF4F01] shrink-0" />
                                    <div>
                                        <p className={`text-sm font-black uppercase tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Loading {chartLoadingLabel}</p>
                                        <p className={`text-[9px] font-bold uppercase tracking-widest mt-0.5 ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>Fetching history — first load can take a few seconds</p>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Start Screen: single guided entry point (resume / start
                        fresh / connect) replacing the old 4-card grid. */}
                    <AnimatePresence initial={false}>
                        {showWelcome && (
                            <motion.div
                                key="start-screen"
                                initial={{ opacity: 1 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                className="absolute inset-0 z-[60]"
                            >
                                <StartScreen
                                    isDarkMode={isDarkMode}
                                    defaultSymbol={symbol}
                                    defaultTimeframe={timeframe}
                                    onOpenWatchlist={() => setIsWatchlistOpen(true)}
                                    cachedSeries={cachedSeries}
                                    onResume={handleResumeFromCache}
                                    onStartFresh={handleStartFresh}
                                />
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <AnimatePresence>
                        {isImporting && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md"
                            >
                                <div className="flex flex-col items-center gap-6">
                                    <div className="relative">
                                        <div className="w-20 h-20 border-2 border-dashed border-zinc-800 rounded-full animate-spin" />
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <FileUp size={32} className="text-[#FF4F01] animate-pulse" />
                                        </div>
                                    </div>
                                    <div className="text-center space-y-2">
                                        <h3 className="text-xl font-black uppercase tracking-tight text-white">Importing Data</h3>
                                        <div className="flex items-center gap-2">
                                            <div className="flex gap-1">
                                                {[0, 1, 2].map(i => (
                                                    <motion.div
                                                        key={i}
                                                        animate={{ opacity: [0.3, 1, 0.3] }}
                                                        transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                                                        className="w-1.5 h-1.5 rounded-full bg-[#FF4F01]"
                                                    />
                                                ))}
                                            </div>
                                            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Processing JSON structures</p>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* cTrader Auth Required Modal */}
                    <CtraderAuthModal
                        isOpen={showCtraderAuthModal}
                        isDarkMode={isDarkMode}
                        onClose={() => setShowCtraderAuthModal(false)}
                        onConnect={async () => {
                            setShowCtraderAuthModal(false);
                            await handleConnectCtrader();
                        }}
                    />
                </div>

                {/* TradingView-style Watchlist Sidebar — fixed overlay drawer on mobile */}
                {isWatchlistOpen && (
                    <div className="fixed inset-0 z-[65] lg:hidden bg-black/50 backdrop-blur-[2px] animate-sheet-fade" onClick={() => setIsWatchlistOpen(false)} aria-hidden />
                )}
                <div className={`${isWatchlistOpen ? 'translate-x-0' : 'translate-x-full'} fixed lg:static inset-y-0 right-0 z-[70] [@media(orientation:landscape)]:z-[110] lg:z-auto w-[85vw] max-w-[320px] [@media(orientation:landscape)]:w-[70vw] [@media(orientation:landscape)]:max-w-[280px] lg:w-72 lg:max-w-none border-l flex flex-col overflow-hidden transition-transform duration-300 lg:shrink-0 shadow-[0_0_44px_rgba(0,0,0,0.55)] ${isWatchlistOpen ? 'lg:w-72' : 'lg:w-0 lg:border-l-0'} ${isDarkMode ? 'bg-black/90 backdrop-blur-2xl border-white/10' : 'bg-white border-slate-200'}`}>
                    <div className="p-4 border-b shrink-0 flex items-center justify-between">
                        <h3 className="font-bold text-sm">Watchlist</h3>
                        <button onClick={() => setIsWatchlistOpen(false)} className="opacity-50 hover:opacity-100"><X size={16} /></button>
                    </div>
                    <div className="flex p-2 gap-1 overflow-x-auto border-b no-scrollbar">
                        {(Object.keys(WATCHLISTS)).map(cat => (
                            <button key={cat} onClick={() => setWatchlistCategory(cat)} className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap ${watchlistCategory === cat ? 'bg-[#FF4F01] text-white' : isDarkMode ? 'hover:bg-black text-zinc-400' : 'hover:bg-slate-100 text-slate-600'}`}>{cat}</button>
                        ))}
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
                        {sortedWatchlist.map(fullSymbol => {
                            const isStarred = starredSymbols.includes(fullSymbol);
                            const displaySymbol = fullSymbol.split(':')[1] || fullSymbol;
                            const bareSymbol = displaySymbol;
                            const isActive = symbol === bareSymbol;
                            return (
                                <button key={fullSymbol} onClick={() => handleWatchlistSymbolClick(fullSymbol)} className={`w-full flex items-center justify-between p-3 rounded-lg text-left group ${isActive ? (isDarkMode ? 'bg-[#FF4F01]/10 text-[#FF4F01]' : 'bg-[#FF4F01]/10 text-[#FF4F01]') : isDarkMode ? 'hover:bg-black text-zinc-300' : 'hover:bg-slate-50 text-slate-700'}`}>                                    <span className="font-bold text-sm">{displaySymbol}</span>
                                    <div onClick={(e) => toggleStar(fullSymbol, e)} className={`opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 ${isStarred ? 'opacity-100 text-amber-400' : 'text-zinc-500'}`}>
                                        <Star size={14} fill={isStarred ? 'currentColor' : 'none'} />
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                </div>
            </div>

            {/* Desktop / tablet replay bar — hidden on mobile (replaced by the floating replay dock below) and in fullscreen canvas */}
            {!isFullscreenCanvas && (
            <div className={`hidden lg:flex h-12 lg:h-14 shrink-0 border-t items-center px-3 lg:px-8 justify-between relative z-20 gap-2 overflow-x-auto no-scrollbar ${isDarkMode ? 'border-zinc-800 bg-black' : 'border-slate-200 bg-white'}`}>
                    <div className="hidden lg:flex items-center gap-3 shrink-0">
                    </div>
                    <div className={`lg:absolute lg:left-1/2 lg:-translate-x-1/2 flex items-center gap-1 lg:gap-2 p-1 rounded-xl lg:rounded-2xl border backdrop-blur shadow-2xl shrink-0 ${isDarkMode ? 'bg-black/80 border-zinc-800' : 'bg-slate-50/80 border-slate-200'}`}>
                        <button onClick={() => setIsSelectBarMode(!isSelectBarMode)} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl font-black text-[10px] uppercase tracking-widest ${isSelectBarMode ? 'bg-rose-500/20 text-rose-500 border border-rose-500/30' : (isDarkMode ? 'hover:bg-black text-zinc-400 border border-transparent' : 'hover:bg-slate-200 text-slate-500 border border-transparent')}`}><ArrowLeftToLine size={16} /> Select bar</button>
                        <div className={`w-px h-5 mx-1 ${isDarkMode ? 'bg-black' : 'bg-slate-200'}`} />
                        <button onClick={handleZoomOut} disabled={allData.length === 0} title="Zoom Out" className={`p-2 rounded-xl ${allData.length === 0 ? 'opacity-30 cursor-not-allowed' : (isDarkMode ? 'hover:bg-black text-zinc-400' : 'hover:bg-slate-200 text-slate-500')}`}><ZoomOut size={16} /></button>
                        <span className={`text-[10px] font-mono font-bold min-w-[40px] text-center ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>{zoomLevel}%</span>
                        <button onClick={handleZoomIn} disabled={allData.length === 0} title="Zoom In" className={`p-2 rounded-xl ${allData.length === 0 ? 'opacity-30 cursor-not-allowed' : (isDarkMode ? 'hover:bg-black text-zinc-400' : 'hover:bg-slate-200 text-slate-500')}`}><ZoomIn size={16} /></button>
                        <div className={`w-px h-4 mx-1 ${isDarkMode ? 'bg-black' : 'bg-slate-200'}`} />
                        <button 
                            onClick={handleResetView} 
                            disabled={allData.length === 0} 
                            title="Reset View" 
                            className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${allData.length === 0 ? 'opacity-30 cursor-not-allowed' : (isDarkMode ? 'bg-black text-zinc-400 hover:bg-black hover:text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700')}`}
                        >
                            Reset
                        </button>
                        <div className={`w-px h-5 mx-1 ${isDarkMode ? 'bg-black' : 'bg-slate-200'}`} />
                        <button onClick={centerChart} disabled={allData.length === 0} title="Fit Chart" className={`flex items-center gap-2 px-3 py-1.5 rounded-xl font-black text-[10px] uppercase tracking-widest ${allData.length === 0 ? 'opacity-30 cursor-not-allowed' : (isDarkMode ? 'hover:bg-black text-zinc-400 border border-transparent' : 'hover:bg-slate-200 text-slate-500 border border-transparent')}`}><Search size={16} /></button>
                        <div className={`w-px h-5 mx-1 ${isDarkMode ? 'bg-black' : 'bg-slate-200'}`} />
                        <button onClick={resetReplay} className={`p-2 rounded-xl ${isDarkMode ? 'hover:bg-black text-zinc-400' : 'hover:bg-slate-200 text-slate-500'}`}><RotateCcw size={18} /></button>
                        <button onClick={() => setIsPlaying(!isPlaying)} disabled={isFetching || allData.length === 0} className={`w-9 h-9 flex items-center justify-center rounded-xl bg-[#FF4F01] text-white shadow-lg shadow-[#FF4F01]/30`}>{isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
                        <button onClick={stepForward} disabled={isFetching || allData.length === 0} className={`p-2 rounded-xl ${isDarkMode ? 'hover:bg-black text-zinc-400' : 'hover:bg-slate-200 text-slate-500'}`}><StepForward size={18} /></button>
                    </div>
                    <div className="flex items-center gap-4">
                        {isLocked && (
                            <div className="flex items-center gap-2">
                                <span className="px-2 py-1 rounded bg-rose-500/20 text-rose-500 text-[8px] font-black uppercase tracking-widest">LOCKED</span>
                            </div>
                        )}
                        <div className="flex flex-col items-end gap-1 relative">
                            <button onClick={() => setIsSpeedMenuOpen(!isSpeedMenuOpen)} className="flex flex-col items-end gap-1 opacity-70 hover:opacity-100">
                                <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Replay Speed</span>
                                <div className={`flex items-center gap-2 px-2 py-0.5 rounded border ${isDarkMode ? 'bg-black border-zinc-800' : 'bg-slate-100 border-slate-200'}`}><span className="text-[10px] font-mono font-black text-[#FF4F01]">{playSpeed === 1000 ? '0.5x' : playSpeed === 500 ? '1.0x' : playSpeed === 200 ? '2.5x' : '10x'}</span><ChevronDown size={12} /></div>
                            </button>
                            {isSpeedMenuOpen && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setIsSpeedMenuOpen(false)} />
                                    <div className={`absolute bottom-full right-0 mb-4 w-48 rounded-xl border shadow-2xl p-2 z-50 backdrop-blur-xl animate-sheet-fade origin-bottom ${isDarkMode ? 'bg-black/85 border-white/10' : 'bg-white border-slate-200'}`}>
                                        {[{ l: '0.5x', v: 1000 }, { l: '1.0x', v: 500 }, { l: '2.5x', v: 200 }, { l: '10x', v: 50 }].map(opt => (
                                            <button key={opt.v} onClick={() => { setPlaySpeed(opt.v); setIsSpeedMenuOpen(false); }} className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-bold flex items-center justify-between ${playSpeed === opt.v ? 'bg-[#FF4F01]/10 text-[#FF4F01]' : (isDarkMode ? 'text-zinc-400 hover:bg-white/5' : 'text-slate-600 hover:bg-slate-50')}`}><span>{opt.l}</span>{playSpeed === opt.v && <Check size={14} />}</button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                        {history.length > 0 && (
                            <div className="flex items-center gap-2">
                                <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">{history.length} trade{history.length !== 1 ? 's' : ''}</span>
                                <button onClick={handleUndoTrade} title="Undo Last Trade" className={`p-1.5 rounded-lg ${isDarkMode ? 'hover:bg-black text-zinc-400' : 'hover:bg-slate-200 text-slate-500'}`}>
                                    <RotateCcw size={14} />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
            {/* Mobile replay dock — replaces the global MobileDock while a chart is open.
                Same floating liquid-glass island styling as MobileNav. In fullscreen
                canvas it floats over the chart (no reserved spacer) with the
                fullscreen toggle riding the bottom-right corner. */}
            {isChartOpen && (
                <>
                {/* In-flow spacer reserves layout space so the fixed dock below
                    never covers the chart's date axis or vertical scale. */}
                {!isFullscreenCanvas && (
                <div className="lg:hidden h-[60px] [@media(orientation:landscape)]:h-[48px] shrink-0" aria-hidden />
                )}
                <div className={isFullscreenCanvas
                    ? "lg:hidden fixed z-[100] pointer-events-none select-none bottom-2 left-1/2 -translate-x-1/2 w-[440px] max-w-[94vw]"
                    : "lg:hidden fixed bottom-0 left-0 right-0 z-[100] pointer-events-none select-none safe-area-inset-bottom pb-3 [@media(orientation:landscape)]:pb-2"}>
                    <nav
                        className="mx-3.5 [@media(orientation:landscape)]:mx-auto [@media(orientation:landscape)]:max-w-[440px] pointer-events-auto"
                        onPointerDown={pokeDock}
                        onTouchStart={pokeDock}
                    >
                        <div className={`flex items-center justify-between px-2 py-1 rounded-[28px] bg-white/[0.08] backdrop-blur-2xl border border-white/[0.10] shadow-[0_12px_40px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.08)] transition-opacity duration-500 ${dockFaded ? 'opacity-40' : 'opacity-100'}`}>
                            <button
                                onClick={() => setIsSelectBarMode(!isSelectBarMode)}
                                aria-label="Select bar"
                                className={`flex flex-col items-center justify-center gap-1 flex-1 py-1.5 px-1 rounded-[20px] transition-all min-h-[44px] touch-manipulation ${isSelectBarMode ? 'bg-[#FF4F01] text-white shadow-[0_2px_12px_rgba(255,79,1,0.35)] font-bold' : 'text-zinc-400'}`}
                            >
                                <ArrowLeftToLine size={17} strokeWidth={isSelectBarMode ? 2.5 : 2} />
                                <span className="text-[10px] tracking-tight leading-none font-medium">Bar</span>
                            </button>
                            <button
                                onClick={() => { if (!dockLpFired.current) stepBack(); dockLpFired.current = false; }}
                                onTouchStart={() => {
                                    dockLpFired.current = false;
                                    clearDockLp();
                                    dockLpTimer.current = window.setTimeout(() => {
                                        dockLpFired.current = true;
                                        resetReplay();
                                        hapticTick(15);
                                        addToast({ type: 'info', title: 'Replay Restarted', message: 'Back at the first bar.' });
                                    }, 600);
                                }}
                                onTouchEnd={clearDockLp}
                                onTouchMove={clearDockLp}
                                disabled={currentIndex <= 0}
                                aria-label="Step back (long-press = restart)"
                                className="flex flex-col items-center justify-center gap-1 flex-1 py-1.5 px-1 rounded-[20px] transition-all min-h-[44px] touch-manipulation text-zinc-400 disabled:opacity-40"
                            >
                                <StepBack size={17} strokeWidth={2} />
                                <span className="text-[10px] tracking-tight leading-none font-medium">Back</span>
                            </button>
                            <button
                                onClick={() => setIsPlaying(!isPlaying)}
                                disabled={isFetching || allData.length === 0}
                                aria-label={isPlaying ? 'Pause' : 'Play'}
                                className="flex flex-col items-center justify-center gap-1 flex-1 py-1.5 px-1 rounded-[20px] transition-all min-h-[44px] touch-manipulation bg-[#FF4F01] text-white shadow-[0_2px_12px_rgba(255,79,1,0.35)] font-bold disabled:opacity-50"
                            >
                                {isPlaying ? <Pause size={17} strokeWidth={2.5} fill="currentColor" /> : <Play size={17} strokeWidth={2.5} fill="currentColor" />}
                                <span className="text-[10px] tracking-tight leading-none font-bold">{isPlaying ? 'Pause' : 'Play'}</span>
                            </button>
                            <button
                                onClick={stepForward}
                                disabled={isFetching || allData.length === 0}
                                aria-label="Step forward"
                                className="flex flex-col items-center justify-center gap-1 flex-1 py-1.5 px-1 rounded-[20px] transition-all min-h-[44px] touch-manipulation text-zinc-400 disabled:opacity-50"
                            >
                                <StepForward size={17} strokeWidth={2} />
                                <span className="text-[10px] tracking-tight leading-none font-medium">Step</span>
                            </button>
                            <button
                                onClick={() => setIsSpeedSheetOpen(true)}
                                aria-label="Replay speed"
                                className="flex flex-col items-center justify-center gap-1 flex-1 py-1.5 px-1 rounded-[20px] transition-all min-h-[44px] touch-manipulation text-zinc-400"
                            >
                                <Zap size={17} strokeWidth={2} />
                                <span className="text-[10px] tracking-tight leading-none font-medium">{playSpeed === 1000 ? '0.5x' : playSpeed === 500 ? '1.0x' : playSpeed === 200 ? '2.5x' : '10x'}</span>
                            </button>
                        </div>
                    </nav>
                </div>
                </>
            )}
            {/* Landscape corner controls — standalone bottom-right controls (Fullscreen Exit/Enter + Watchlist shortcut) */}
            {isChartOpen && (
                <div
                    className="hidden [@media(orientation:landscape)]:flex fixed right-3 bottom-3 z-[120] items-center gap-2.5"
                >
                    <button
                        onClick={() => setIsFullscreenCanvas(v => !v)}
                        aria-label={isFullscreenCanvas ? 'Exit fullscreen chart' : 'Fullscreen chart'}
                        title={isFullscreenCanvas ? 'Exit fullscreen chart' : 'Fullscreen chart'}
                        className="w-11 h-11 rounded-full flex items-center justify-center backdrop-blur-xl border border-white/10 bg-white/[0.08] hover:bg-white/[0.14] text-zinc-200 hover:text-white transition-all active:scale-95 touch-manipulation shadow-[0_4px_16px_rgba(0,0,0,0.4)]"
                    >
                        {isFullscreenCanvas ? <Minimize size={18} strokeWidth={2.5} /> : <Maximize size={18} strokeWidth={2} />}
                    </button>
                    {isFullscreenCanvas && (
                        <button
                            onClick={() => setIsWatchlistOpen(v => !v)}
                            aria-label="Toggle watchlist"
                            title="Toggle watchlist"
                            className={`w-11 h-11 rounded-full flex items-center justify-center backdrop-blur-xl border transition-all active:scale-95 touch-manipulation shadow-[0_4px_16px_rgba(0,0,0,0.4)] ${
                                isWatchlistOpen
                                    ? 'bg-[#FF4F01] border-[#FF4F01] text-white shadow-[0_2px_12px_rgba(255,79,1,0.4)]'
                                    : 'bg-white/[0.08] border-white/10 text-zinc-200 hover:text-white hover:bg-white/[0.14]'
                            }`}
                        >
                            <List size={19} strokeWidth={2.2} />
                        </button>
                    )}
                </div>
            )}
            {/* Selection-pill style drawers: color stays open for live-trying,
                width/style close on pick (single-tap actions). */}
            <ColorDrawer
                open={styleDrawer === 'color'}
                onClose={() => setStyleDrawer(null)}
                isDarkMode={isDarkMode}
                subtitle={selectedIds.length > 1 ? `${selectedIds.length} drawings` : (selectedDrawing ? (TOOL_LABELS[selectedDrawing.type] || selectedDrawing.type) : undefined)}
                value={selectedDrawing?.color || '#2962ff'}
                onPick={(color) => applyStyleToSelection({ color })}
                buzz={hapticTick}
            />
            <WidthDrawer
                open={styleDrawer === 'width'}
                onClose={() => setStyleDrawer(null)}
                isDarkMode={isDarkMode}
                subtitle={selectedIds.length > 1 ? `${selectedIds.length} drawings` : (selectedDrawing ? (TOOL_LABELS[selectedDrawing.type] || selectedDrawing.type) : undefined)}
                value={selectedDrawing?.strokeWidth || 1}
                onPick={(strokeWidth) => { applyStyleToSelection({ strokeWidth }); setStyleDrawer(null); hapticTick(8); }}
            />
            <LineStyleDrawer
                open={styleDrawer === 'style'}
                onClose={() => setStyleDrawer(null)}
                isDarkMode={isDarkMode}
                subtitle={selectedIds.length > 1 ? `${selectedIds.length} drawings` : (selectedDrawing ? (TOOL_LABELS[selectedDrawing.type] || selectedDrawing.type) : undefined)}
                value={selectedDrawing?.strokeStyle || 'solid'}
                onPick={(strokeStyle) => { applyStyleToSelection({ strokeStyle }); setStyleDrawer(null); hapticTick(8); }}
            />
            {/* Mobile speed picker sheet (tap Zap) — shared Drawer shell */}
            <Drawer open={isSpeedSheetOpen} onClose={() => setIsSpeedSheetOpen(false)} title="Replay speed" isDarkMode={isDarkMode} maxHeight="max-h-[60dvh]">
                <div className="grid grid-cols-4 gap-2">
                    {[{ l: '0.5x', v: 1000 }, { l: '1.0x', v: 500 }, { l: '2.5x', v: 200 }, { l: '10x', v: 50 }].map(opt => (
                        <button
                            key={opt.v}
                            onClick={() => { setPlaySpeed(opt.v); setIsSpeedSheetOpen(false); hapticTick(8); }}
                            className={`min-h-[52px] rounded-2xl text-sm font-black flex items-center justify-center gap-1.5 touch-manipulation active:scale-95 transition-colors ${playSpeed === opt.v ? 'bg-[#FF4F01] text-white' : (isDarkMode ? 'bg-white/[0.06] text-zinc-200' : 'bg-slate-100 text-slate-700')}`}
                        >
                            {opt.l}{playSpeed === opt.v && <Check size={14} />}
                        </button>
                    ))}
                </div>
            </Drawer>
            {/* Mobile jump-to-bar sheet (tap the bar counter) */}
            <Drawer open={isJumpSheetOpen} onClose={() => setIsJumpSheetOpen(false)} title="Jump to bar" subtitle={`${symbol} · ${timeframe}`} isDarkMode={isDarkMode} maxHeight="max-h-[60dvh]">
                <div className="flex gap-2 mb-2">
                    <input
                        value={jumpInput}
                        onChange={(e) => setJumpInput(e.target.value.replace(/[^0-9]/g, ''))}
                        inputMode="numeric"
                        placeholder={`1 – ${allData.length}`}
                        aria-label="Bar number"
                        className={`flex-1 min-h-[52px] px-4 rounded-2xl text-base font-black tabular-nums outline-none ${isDarkMode ? 'bg-white/[0.06] border border-white/10 text-white' : 'bg-slate-100 border border-slate-200 text-slate-900'}`}
                        onKeyDown={(e) => { if (e.key === 'Enter') jumpToBar(parseInt(jumpInput, 10) - 1); }}
                    />
                    <button
                        onClick={() => jumpToBar(parseInt(jumpInput, 10) - 1)}
                        className="min-h-[52px] px-6 rounded-2xl bg-[#FF4F01] text-white text-sm font-black touch-manipulation active:scale-95"
                    >
                        Go
                    </button>
                </div>
                <div className="grid grid-cols-4 gap-2">
                    <button onClick={() => jumpToBar(0)} className={`min-h-[48px] rounded-2xl text-xs font-black touch-manipulation active:scale-95 ${isDarkMode ? 'bg-white/[0.06] text-zinc-200' : 'bg-slate-100 text-slate-700'}`}>Start</button>
                    <button onClick={() => jumpToBar(currentIndex - 50)} className={`min-h-[48px] rounded-2xl text-xs font-black touch-manipulation active:scale-95 ${isDarkMode ? 'bg-white/[0.06] text-zinc-200' : 'bg-slate-100 text-slate-700'}`}>−50</button>
                    <button onClick={() => jumpToBar(currentIndex + 50)} className={`min-h-[48px] rounded-2xl text-xs font-black touch-manipulation active:scale-95 ${isDarkMode ? 'bg-white/[0.06] text-zinc-200' : 'bg-slate-100 text-slate-700'}`}>+50</button>
                    <button onClick={jumpLive} className={`min-h-[48px] rounded-2xl text-xs font-black touch-manipulation active:scale-95 ${isDarkMode ? 'bg-white/[0.06] text-zinc-200' : 'bg-slate-100 text-slate-700'}`}>Live</button>
                </div>
            </Drawer>
        </div>
    );
};

export default BacktestLab;
