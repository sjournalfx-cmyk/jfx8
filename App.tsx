import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import { safeLazy } from './lib/safeLazy';
import Sidebar from './components/Sidebar';
import LogTrade from './components/LogTrade';
import Dashboard from './components/Dashboard';
import Journal from './components/Journal';
import Auth from './components/Auth';
import BetaSplash from './components/BetaSplash';
import { PrivacyPolicy, TermsOfService } from './components/LegalPages';
import { ChevronLeft } from 'lucide-react';
import { PortfolioSwitcher } from './components/PortfolioSwitcher';

import { Trade, Note, DailyBias, UserProfile, Portfolio } from './types';
import Onboarding from './components/Onboarding';
import Settings from './components/Settings';
import EASetup from './components/EASetup';
import ConfirmationModal from './components/ConfirmationModal';
import QuickLogModal from './components/QuickLogModal';
import TradeRecapSheet from './components/TradeRecapSheet';
import ErrorBoundary from './components/ErrorBoundary';
import { APP_CONSTANTS, PLAN_FEATURES, normalizePlan } from './lib/constants';
import { useLocalStorage } from './hooks/useLocalStorage';
import { getSASTDateTime } from './lib/timeUtils';
import { buildAnalyticsAiSnapshot } from './lib/analyticsAiSnapshot';
import { buildPsychologyInsightsPrompt, extractSectionBody, getPsychologyInsightsDayKey, getPsychologyInsightsScopeKey, PSYCHOLOGY_INSIGHTS_STORAGE_KEY, type PsychologyInsightsCache } from './lib/psychologyInsights';
import { dataService, isTradeInPortfolio, removeTradePortfolioOverlays, writeTradePortfolioOverlays, writeTradePortfolioOverlay } from './services/dataService';
import { usePortfolios } from './hooks/usePortfolios';
import { useCtraderLiveBalance } from './hooks/useCtraderLiveBalance';
import { modalResearchService } from './services/nvidiaAiService';
import { ToastProvider, useToast } from './components/ui/Toast';
import { OfflineBanner, useNetworkStatus } from './components/OfflineBlocker';
import { BrandedLoader } from './components/ui/BrandedLoader';
import { MobileBlocker } from './components/ui/MobileBlocker';
import { MobileLayout } from './components/mobile/MobileLayout';
import { MOBILE_ENABLED, IS_CAPACITOR } from './lib/featureFlags';
import { useAuth } from './hooks/useAuth';
import { useData } from './hooks/useData';
import { authService } from './services/authService';
import posthog from 'posthog-js';
import { Agentation, type Annotation } from "agentation";
import { getSafePnL } from './lib/trade-normalization';
import { normalizeThemePreference } from './lib/theme';
import { demoDailyBias, demoEASession, demoNotes, demoTrades, getDemoProfile } from './lib/demoData';
import { resolveBridgeBackedBalance } from './lib/bridgeBalance';

// Lazy load heavy components for performance
const Analytics = safeLazy(() => import('./components/Analytics'));
const AIChat = safeLazy(() => import('./components/AIChat'));
const BacktestLab = safeLazy(() => import('./components/BacktestLab'));
const ChartGrid = safeLazy(() => import('./components/ChartGrid'));
const Notes = safeLazy(() => import('./components/Notes'));

const AppContent: React.FC = () => {
  const [currentView, setCurrentView] = useState(() => {
    return 'dashboard';
  });
  const [settingsTab, setSettingsTab] = useState<'profile' | 'account' | 'appearance' | 'billing' | 'security' | 'developer-tools' | 'help'>('profile');
  const { addToast } = useToast();
  const [isDemoMode, setIsDemoMode] = useLocalStorage<boolean>('jfx_demo_mode', false);
  const [showBetaSplash, setShowBetaSplash] = useState(() => {
    try {
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        // Suppress splash immediately when returning from cTrader OAuth redirect
        if (params.has('code') || window.location.search.includes('ctrader_token')) {
          return false;
        }
        // Persisted dismissal — don't re-show on every reload.
        if (window.localStorage.getItem('jfx_beta_seen_v1')) {
          return false;
        }
      }
    } catch {
      // Storage unavailable (e.g. private mode) — fall through to showing it.
    }
    return true;
  });

  const [currentMigrationVersion] = useState('v20250201.1');

  // Public paths: no login, no splash, no mobile blocker, no onboarding.
  // (Canonical /privacy + /terms are static HTML via vercel rewrites; these
  const [currentPath, setCurrentPath] = useState(() => (typeof window !== 'undefined' ? window.location.pathname : '/'));
  const publicPath = currentPath;
  const isAuthCallbackPath = currentPath === '/auth/callback';

  useEffect(() => {
    if (publicPath === '/privacy') {
      document.title = 'Privacy Policy | JFX-JOURNAL';
    } else if (publicPath === '/terms') {
      document.title = 'Terms of Service | JFX-JOURNAL';
    }
  }, [publicPath]);

  const {
    userId,
    userProfile,
    userEmail,
    isAuthenticated,
    isInitialLoading,
    handleLogout,
    handleOnboardingComplete,
    handleUpdateProfile,
    loadUserData,
    setIsAuthenticated,
    setIsInitialLoading,
    setUserId,
    setUserEmail
  } = useAuth();

  // PostHog analytics initialization
  useEffect(() => {
    posthog.init('phc_afcj9r3oxhjFLVOZq2hUbcbkWBYM0mPxgNpiYYYjlSw', {
      api_host: 'https://us.i.posthog.com',
      autocapture: true,
      capture_pageview: false,
    });
  }, []);

  useEffect(() => {
    // Supabase Google OAuth returns to /auth/callback?code= — handled by
    // AuthCallback, never by the cTrader exchange below.
    if (window.location.pathname === '/auth/callback') return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (!code || params.has('ctrader_ready')) return;

    // ─── CRITICAL: clear the URL synchronously BEFORE the async import ───────
    // React 18 StrictMode runs effects twice in dev (mount → unmount → mount).
    // Clearing the URL here means the second invocation finds no ?code= and
    // exits via the guard above, so the single-use OAuth code is only sent once.
    window.history.replaceState({}, '', window.location.pathname);

    // Ensure splash is hidden immediately
    setShowBetaSplash(false);

    import('./services/ctraderService').then(async ({ exchangeCode }) => {
      let ok = false;
      let errDetail = '';
      try {
        const result = await exchangeCode(code, state);
        if (typeof result === 'object' && result !== null) {
          ok = (result as any).ok === true;
          errDetail = (result as any).error || '';
        } else {
          ok = (result as unknown) as boolean;
        }
      } catch (e: any) {
        ok = false;
        errDetail = e?.message || '';
      }

      if (ok) {
        // Request storage access first — after OAuth redirect Safari/Firefox may block localStorage
        try {
          if (typeof document.requestStorageAccess === 'function') {
            await document.requestStorageAccess().catch(() => {});
          }
        } catch { /* ignore */ }
        // Set flag BEFORE navigating so Bridge's useState initializer reads it on first mount
        try { localStorage.setItem('ctrader_just_authorized', 'true'); } catch { /* blocked */ }
        try { sessionStorage.setItem('ctrader_just_authorized', 'true'); } catch { /* blocked */ }
        setCurrentView('ea-setup');
      } else {
        addToast({
          type: 'error',
          title: 'cTrader Auth Failed',
          message: errDetail
            ? `Token exchange failed: ${errDetail}`
            : 'Token exchange failed. Please try connecting again.',
          duration: 8000,
        });
        setCurrentView('ea-setup');
      }
    });
  }, []);


  // Track view changes as pageviews
  useEffect(() => {
    if (isAuthenticated) {
      posthog.capture('$pageview', { view: currentView });
    }
  }, [currentView, isAuthenticated]);

const {
    trades,
    notes,
    dailyBias,
    cashTransactions,
    eaSession,
    lastKnownBridgeBalance,
    isBridgeOnline,
    editingTrade,
    isDataLoading,
    setTrades,
    setNotes,
    setDailyBias,
    setEASession,
    setEditingTrade,
    offlineQueue,
    addToOfflineQueue
  } = useData(userId, userProfile);

  const activeUserProfile = isDemoMode ? getDemoProfile(userProfile) : userProfile;
  const {
    portfolios,
    activePortfolio,
    activePortfolioId,
    defaultId: defaultPortfolioId,
    canAdd: canAddPortfolio,
    setActiveId: setActivePortfolioId,
    addPortfolio,
    updatePortfolio,
    removePortfolio,
    findLinkCollision,
  } = usePortfolios(isDemoMode ? null : userId);
  // Portfolio scoping: legacy trades without a portfolio live in Default.
  // Fail open (show all) while the store is still resolving ids or when 'all' is chosen.
  const portfolioTrades = useMemo(() => {
    if (!activePortfolioId || activePortfolioId === 'all') return trades;
    return trades.filter(t => isTradeInPortfolio(t.portfolio_id, activePortfolioId, defaultPortfolioId));
  }, [trades, activePortfolioId, defaultPortfolioId]);

  const tradeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of trades) {
      for (const p of portfolios) {
        if (isTradeInPortfolio(t.portfolio_id, p.id, defaultPortfolioId)) {
          counts[p.id] = (counts[p.id] || 0) + 1;
        }
      }
    }
    return counts;
  }, [trades, portfolios, defaultPortfolioId]);

  // Live balance per portfolio: starting balance + realized PnL of its completed trades.
  const portfolioBalances = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of portfolios) {
      const isDef = p.isDefault || p.id === defaultPortfolioId || p.id === 'default';
      const start = p.startingBalance ?? (isDef ? activeUserProfile?.initialBalance : undefined) ?? 0;
      let pnl = 0;
      for (const t of trades) {
        if (!isTradeInPortfolio(t.portfolio_id, p.id, defaultPortfolioId)) continue;
        if (t.result === 'Pending') continue;
        pnl += t.pnl || 0;
      }
      out[p.id] = start + pnl;
    }
    return out;
  }, [trades, portfolios, defaultPortfolioId, activeUserProfile]);

  const handleRemovePortfolio = useCallback(async (id: string) => {
    const { from, to } = await removePortfolio(id);
    if (to) setTrades(prev => prev.map(t => (t.portfolio_id === from ? { ...t, portfolio_id: to } : t)));
  }, [removePortfolio, setTrades]);

  // Link a cTrader/bridge account to a freshly-created portfolio (one account per portfolio).
  const handleLinkPortfolioAccount = useCallback(async (portfolioId: string, account: { provider: string; externalAccountId?: string }) => {
    await updatePortfolio(portfolioId, { accounts: [{ provider: account.provider, externalAccountId: account.externalAccountId }] });
  }, [updatePortfolio]);

  // Create -> if cTrader/bridge, jump straight to its connector (less confusion).
  const handleAddPortfolioAndConnect = useCallback(async (input: { name: string; description?: string; purpose?: Portfolio['purpose']; source?: Portfolio['source']; startingBalance?: number; currency?: string }) => {
    const created = await addPortfolio(input);
    if ((created.source || 'manual') !== 'manual') {
      setCurrentView('ea-setup');
    }
    return created;
  }, [addPortfolio]);

  const linkPortfolio = activePortfolio && (activePortfolio.source || 'manual') !== 'manual' ? activePortfolio : null;
  const activeTrades = isDemoMode ? demoTrades : portfolioTrades;
  const activeNotes = isDemoMode ? demoNotes : notes;
  const activeDailyBias = isDemoMode ? demoDailyBias : dailyBias;
  const activeEaSession = isDemoMode ? demoEASession : eaSession;

  // Live cTrader broker balance for the dashboard card. Prefers the cTrader
  // account linked to the active portfolio; falls back to the account picked
  // in Connect & Import so a connected broker still matches the card even
  // before linking. Disabled in demo mode (demo shows demo-session math).
  const linkedCtraderAccountId = activePortfolio?.accounts?.find(a => a.provider === 'ctrader')?.externalAccountId ?? null;
  const selectedCtraderAccountId = useMemo(() => {
    try { return localStorage.getItem('jfx_ctrader_selected_account'); } catch { return null; }
    // Re-read when the portfolio or view changes (e.g. back from ea-setup).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePortfolio?.id, currentView]);
  const ctraderAccountId = !isDemoMode ? (linkedCtraderAccountId ?? selectedCtraderAccountId) : null;
  const ctraderLive = useCtraderLiveBalance(ctraderAccountId);

  useEffect(() => {
    if (!isAuthenticated) {
      // Landing page and Auth page: restore full-size layout, remove compact scaling
      document.body.style.overflow = 'auto';
      document.documentElement.classList.remove('compact-scale');
      const rootEl = document.getElementById('root');
      if (rootEl) {
        rootEl.style.overflow = 'auto';
        rootEl.style.height = 'auto';
        rootEl.style.width = 'auto';
      }
    } else {
      // Authenticated workspace: apply compact scaling + lock overflow
      document.body.style.overflow = 'hidden';
      document.documentElement.classList.add('compact-scale');
      const rootEl = document.getElementById('root');
      if (rootEl) {
        rootEl.style.overflow = 'hidden';
        rootEl.style.height = '100vh';
        rootEl.style.width = '100vw';
      }
    }
    return () => {
      // Cleanup: restore compact scale on unmount (returning to authenticated state)
      document.documentElement.classList.add('compact-scale');
    };
  }, [isAuthenticated]);

  const analyticsSnapshot = useMemo(
    () => buildAnalyticsAiSnapshot(activeTrades, activeUserProfile, activeDailyBias, activeEaSession, lastKnownBridgeBalance, isBridgeOnline, isDemoMode),
    [activeTrades, activeUserProfile, activeDailyBias, activeEaSession, lastKnownBridgeBalance, isBridgeOnline]
  );
  const [psychologyInsightsCache, setPsychologyInsightsCache] = useLocalStorage<PsychologyInsightsCache>(PSYCHOLOGY_INSIGHTS_STORAGE_KEY, {});
  const [psychologyAnalyzeUsage, setPsychologyAnalyzeUsage] = useLocalStorage<Record<string, { date: string; count: number }>>('jfx_psychology_analyze_usage_v1', {});
  const psychologyInsightsScope = getPsychologyInsightsScopeKey(userId, isDemoMode);
  const todayPsychologyInsightsKey = getPsychologyInsightsDayKey();
  const todayPsychologyAnalyzeCount = psychologyAnalyzeUsage[psychologyInsightsScope]?.date === todayPsychologyInsightsKey
    ? psychologyAnalyzeUsage[psychologyInsightsScope].count
    : 0;
  const psychologyAnalyzeLimitReached = todayPsychologyAnalyzeCount >= 2;
  const buildPsychologyInsightsFallbackContent = useCallback(() => {
    const disciplineScore = analyticsSnapshot?.psychology?.disciplineScore?.score;
    const adherenceLevel = analyticsSnapshot?.psychology?.psychologyInsights?.adherenceLevel || 'Medium';
    const bestMindset = analyticsSnapshot?.psychology?.psychologyInsights?.bestMindset || 'Neutral';
    const winRate = analyticsSnapshot?.overview?.winRate;
    const netProfit = analyticsSnapshot?.overview?.netProfit;

    return `### Key Insights
- Discipline check: score is ${disciplineScore ?? 'unavailable'}/100 and adherence is ${String(adherenceLevel).toLowerCase()}.
- Best-performing mindset: ${bestMindset} is currently the strongest state in the analytics snapshot.
- Performance snapshot: recent win rate is ${winRate ?? 'unavailable'}% with net P/L of ${netProfit ?? 'unavailable'}.

### Warnings
- Size pressure: do not increase size until plan adherence becomes more consistent.
- Execution review: check the last few trades for repeated emotional or execution slips before the next session.

### Immediate Action
- Trade note review: re-open the latest trade notes and mark the exact point where discipline broke down.`;
  }, [analyticsSnapshot]);
  const isValidPsychologyInsightsContent = (content: string) => {
    const normalized = content.trim();
    const hasRequiredSections = [
      /^#{1,6}\s*key insights\s*$/im,
      /^#{1,6}\s*warnings\s*$/im,
      /^#{1,6}\s*immediate action\s*$/im,
    ].every((pattern) => pattern.test(normalized));
    const containsPromptLeak = /source facts|inside,? structure|format specifics|generate the trader'?s daily key insights/i.test(normalized);

    return hasRequiredSections && !containsPromptLeak;
  };
  const dailyPsychologyInsights = useMemo(() => {
    if (isDemoMode) return null;

    const entry = psychologyInsightsCache[psychologyInsightsScope] ?? null;
    if (!entry?.content?.trim()) return null;

    const cleanedContent = extractSectionBody(entry.content, 'KEY_INSIGHTS_WARNINGS')
      || entry.content.replace(/^\s*\[SECTION:KEY_INSIGHTS_WARNINGS\]\s*/i, '').trim();

    if (isValidPsychologyInsightsContent(cleanedContent)) {
      return {
        ...entry,
        content: cleanedContent.trim(),
      };
    }

    return {
      date: todayPsychologyInsightsKey,
      generatedAt: entry.generatedAt,
      content: buildPsychologyInsightsFallbackContent(),
    };
  }, [buildPsychologyInsightsFallbackContent, isDemoMode, psychologyInsightsCache, psychologyInsightsScope, todayPsychologyInsightsKey]);
  const psychologyInsightsRequestRef = useRef<string | null>(null);
  const [isRefreshingPsychologyInsights, setIsRefreshingPsychologyInsights] = useState(false);
  const psychologyInsightsSourceFacts = useMemo(() => ({
    scope: psychologyInsightsScope,
    date: todayPsychologyInsightsKey,
    mode: isDemoMode ? 'demo' : 'live',
    profile: activeUserProfile ? {
      name: activeUserProfile.name,
      plan: activeUserProfile.plan,
      experienceLevel: activeUserProfile.experienceLevel,
      initialBalance: activeUserProfile.initialBalance,
      currencySymbol: activeUserProfile.currencySymbol,
      defaultRR: activeUserProfile.defaultRR ?? null,
    } : null,
    overview: analyticsSnapshot?.overview ? {
      totalTrades: analyticsSnapshot.overview.totalTrades,
      netProfit: analyticsSnapshot.overview.netProfit,
      winRate: analyticsSnapshot.overview.winRate,
      profitFactor: analyticsSnapshot.overview.profitFactor,
      avgWin: analyticsSnapshot.overview.avgWin,
      avgLoss: analyticsSnapshot.overview.avgLoss,
    } : null,
    psychology: analyticsSnapshot?.psychology ? {
      disciplineScore: analyticsSnapshot.psychology.disciplineScore,
      momentum: analyticsSnapshot.psychology.momentum,
      plByMindset: analyticsSnapshot.psychology.plByMindset,
      plByPlanAdherence: analyticsSnapshot.psychology.plByPlanAdherence,
      psychologyInsights: analyticsSnapshot.psychology.psychologyInsights,
    } : null,
    recentTrades: analyticsSnapshot?.recentTrades?.slice(-10) ?? [],
    dailyBias: activeDailyBias.slice(-5),
  }), [activeDailyBias, activeUserProfile, analyticsSnapshot, isDemoMode, psychologyInsightsScope, todayPsychologyInsightsKey]);

  const refreshPsychologyInsights = useCallback(async (force = false) => {
    if (isDemoMode || isDataLoading || !activeUserProfile) return;

    if (force) {
      const usage = psychologyAnalyzeUsage[psychologyInsightsScope];
      const count = usage?.date === todayPsychologyInsightsKey ? usage.count : 0;
      if (count >= 3) return;
      setPsychologyAnalyzeUsage((current) => ({
        ...current,
        [psychologyInsightsScope]: {
          date: todayPsychologyInsightsKey,
          count: count + 1,
        },
      }));
    }

    const requestKey = `${psychologyInsightsScope}:${todayPsychologyInsightsKey}`;
    const cachedEntry = psychologyInsightsCache[psychologyInsightsScope];
    if (!force && (cachedEntry?.date === todayPsychologyInsightsKey || psychologyInsightsRequestRef.current === requestKey)) {
      return;
    }

    psychologyInsightsRequestRef.current = requestKey;
    setIsRefreshingPsychologyInsights(true);

    try {
      if (force) {
        setPsychologyInsightsCache((current) => {
          const next = { ...current };
          delete next[psychologyInsightsScope];
          return next;
        });
      }

      const response = await modalResearchService.generateResponse(
        buildPsychologyInsightsPrompt(psychologyInsightsSourceFacts),
        activeTrades,
        activeUserProfile,
        activeDailyBias,
        analyticsSnapshot,
        true,
        [],
        'kimi',
        false
      );
      const extractedContent = extractSectionBody(response, 'KEY_INSIGHTS_WARNINGS')
        || response.replace(/^\s*\[SECTION:KEY_INSIGHTS_WARNINGS\]\s*/i, '').trim();
      const content = isValidPsychologyInsightsContent(extractedContent)
        ? extractedContent.trim()
        : buildPsychologyInsightsFallbackContent();

      setPsychologyInsightsCache((current) => ({
        ...current,
        [psychologyInsightsScope]: {
          date: todayPsychologyInsightsKey,
          generatedAt: new Date().toISOString(),
          content: content.trim(),
        },
      }));
    } catch (error) {
      console.warn('Failed to generate daily psychology insights:', error);
      setPsychologyInsightsCache((current) => ({
        ...current,
        [psychologyInsightsScope]: {
          date: todayPsychologyInsightsKey,
          generatedAt: new Date().toISOString(),
          content: buildPsychologyInsightsFallbackContent(),
        },
      }));
    } finally {
      psychologyInsightsRequestRef.current = null;
      setIsRefreshingPsychologyInsights(false);
    }
  }, [
    activeDailyBias,
    activeEaSession,
    activeTrades,
    activeUserProfile,
    analyticsSnapshot,
    isDataLoading,
    isDemoMode,
    psychologyInsightsCache,
    psychologyAnalyzeUsage,
    psychologyInsightsScope,
    psychologyInsightsSourceFacts,
    setPsychologyInsightsCache,
    setPsychologyAnalyzeUsage,
    todayPsychologyInsightsKey,
  ]);

  useEffect(() => {
    void refreshPsychologyInsights(false);
  }, [refreshPsychologyInsights]);

  useEffect(() => {
    if (isDemoMode && currentView === 'log-trade') {
      setCurrentView('dashboard');
    }
  }, [currentView, isDemoMode]);

  // Auto-enable demo mode for new users (onboarded with no trades).
  // Gated behind load completion so a slow first fetch never flips real
  // users into sample data (which hides the real journal).
  useEffect(() => {
    if (isInitialLoading || isDataLoading) return;
    const storedDemo = localStorage.getItem('jfx_demo_mode');
    if (isAuthenticated && userProfile?.onboarded && trades.length === 0 && storedDemo === null) {
      setIsDemoMode(true);
    }
  }, [isAuthenticated, userProfile?.onboarded, trades.length, setIsDemoMode, isDemoMode, isInitialLoading, isDataLoading]);

  const blockDemoAction = (title: string, message = 'Demo mode is read-only. Switch back to your real journal to make changes.') => {
    addToast({
      type: 'info',
      title,
      message,
      duration: 5000,
    });
  };

  
  // Obsidian-only UI; the app no longer switches to light mode.
  const isDarkMode = true;
  
  // UI State
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isQuickLogOpen, setIsQuickLogOpen] = useState(false);
  // Peak-moment recap shown after a NEW trade is saved (edits keep the toast).
  const [recapTrade, setRecapTrade] = useState<Trade | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    confirmText?: string;
    cancelText?: string;
    variant?: 'danger' | 'warning' | 'info';
    showCancel?: boolean;
    onConfirm: () => void | Promise<void>;
  }>({
    isOpen: false,
    title: '',
    description: '',
    onConfirm: () => { }
  });
  
  const handleAddTrade = async (trade: Trade) => {
    if (isDemoMode) {
      blockDemoAction('Cannot save trade');
      return;
    }
    try {
      if (editingTrade && editingTrade.id) {
        const savedTrade = await dataService.updateTrade(trade);
        setTrades(prev => prev.map(t => t.id === savedTrade.id ? savedTrade : t));
        setEditingTrade(null);
        // Edits keep the lightweight success toast (no recap sheet).
        addToast({
          type: 'success',
          title: 'Trade Updated',
          message: `${savedTrade.pair || 'Trade'} saved to your journal.`,
          duration: 4000,
        });
      } else {
        const sastNow = getSASTDateTime();
        const [year, month] = sastNow.date.split('-').map(Number);
        
        const currentPlan = normalizePlan(userProfile?.plan);
        const features = PLAN_FEATURES[currentPlan] || PLAN_FEATURES[APP_CONSTANTS.PLANS.FREE];

        if (userId && features.maxTradesPerMonth !== Infinity) {
          const dbTradesThisMonth = await dataService.getMonthlyTradeCount(userId, year, month);
          
          if (dbTradesThisMonth >= features.maxTradesPerMonth) {
            const resetMonth = month === 12 ? 1 : month + 1;
            const resetYear = month === 12 ? year + 1 : year;
            const resetLabel = new Date(Date.UTC(resetYear, resetMonth - 1, 1)).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              timeZone: 'UTC',
            });
            setConfirmModal({
              isOpen: true,
              title: 'Monthly Limit Reached',
              description: `${dbTradesThisMonth} of ${features.maxTradesPerMonth} trades used this month, resets on ${resetLabel} (SAST). Upgrade your plan for more capacity.`,
              confirmText: 'Upgrade Plan',
              cancelText: 'Maybe Later',
              variant: 'warning',
              onConfirm: () => {
                setCurrentView('settings');
                setConfirmModal(prev => ({ ...prev, isOpen: false }));
              },
            });
            return;
          }
        }

        const newTrade = await dataService.addTrade(trade);
        setTrades(prev => [newTrade, ...prev.filter(t => t.id !== newTrade.id)]);
        dataService.logActivity('ADD_TRADE', { pair: newTrade.pair, pnl: newTrade.pnl });
        // New trades get the recap sheet instead of only a toast — a peak
        // moment to capture notes. Edits keep the toast below.
        setRecapTrade(newTrade);
      }
      setCurrentView('history');
    } catch (error) {
      console.error("Error saving trade:", error);
      if (editingTrade && editingTrade.id) {
        const previousTrade = trades.find(t => t.id === trade.id);
        if (previousTrade) {
          setTrades(prev => prev.map(t => t.id === trade.id ? previousTrade : t));
        }
      }

      // Check if it's a network/connectivity error
      const isNetworkError = !navigator.onLine ||
        error instanceof TypeError ||
        (error as any).code === 'FETCH_ERROR' ||
        (error as any).message?.includes('Failed to fetch');

      if (isNetworkError && !editingTrade) {
        addToOfflineQueue(trade);
        setCurrentView('history');
        return;
      }

      const errMsg = (error as any)?.message || 'Failed to save trade. Please try again.';
      setConfirmModal({
        isOpen: true,
        title: 'Error',
        description: errMsg,
        confirmText: 'OK',
        variant: 'danger',
        showCancel: false,
        onConfirm: () => setConfirmModal(prev => ({ ...prev, isOpen: false })),
      });
    }
  };

  const handleEditTrade = (trade: Trade) => {
    if (isDemoMode) {
      blockDemoAction('Cannot edit trade');
      return;
    }
    setEditingTrade(trade);
    setCurrentView('log-trade');
  };

  // Broker reconnect can replay a single deal we already have. Merge instead
  // of duplicating, and stamp the active portfolio so the row is visible in
  // the journal the user is actually looking at.
  const handleBrokerTradeAdded = useCallback((newTrade: Trade) => {
    if (isDemoMode) { blockDemoAction('Cannot save trade'); return; }
    const targetPid = activePortfolioId || defaultPortfolioId || undefined;
    const withPortfolio = (newTrade as any)?.portfolio_id ? newTrade : { ...newTrade, portfolio_id: targetPid };
    if (userId && withPortfolio.id && targetPid) {
      writeTradePortfolioOverlay(userId, withPortfolio.id, targetPid);
    }
    setTrades(prev => [withPortfolio, ...prev.filter(t => t.id !== withPortfolio.id)]);
  }, [isDemoMode, activePortfolioId, defaultPortfolioId, userId]);

  // Bulk broker-import sync: ONE state update for all saved rows.
  // Merges into existing rows (fixes realtime echo races) and writes the
  // portfolio overlay immediately so a refresh cannot lose the assignment.
  const handleTradesAddedBatch = (savedTrades: Trade[]) => {
    if (!savedTrades || savedTrades.length === 0) return;
    const targetPid = activePortfolioId || defaultPortfolioId || undefined;

    const stamped = savedTrades.map(t => ({
      ...t,
      portfolio_id: t.portfolio_id || targetPid,
    }));

    if (userId && targetPid) {
      const overlayEntries: Record<string, string> = {};
      for (const t of stamped) {
        if (t.id && !String(t.id).startsWith('dupe-')) {
          overlayEntries[t.id] = targetPid;
        }
      }
      if (Object.keys(overlayEntries).length > 0) {
        writeTradePortfolioOverlays(userId, overlayEntries);
      }
    }

    setTrades(prev => {
      const savedMap = new Map(stamped.filter(t => t?.id && !String(t.id).startsWith('dupe-')).map(t => [t.id, t]));
      const updated = prev.map(t => {
        const fresh = savedMap.get(t.id);
        if (fresh) {
          savedMap.delete(t.id);
          return { ...t, ...fresh, portfolio_id: fresh.portfolio_id || targetPid };
        }
        return t;
      });
      const brandNew = Array.from(savedMap.values());
      return [...brandNew, ...updated];
    });
  };

  // Bulk delete sync: ONE state update + overlay cleanup for many rows.
  const handleTradesDeletedBatch = (tradeIds: string[]) => {
    if (!tradeIds || tradeIds.length === 0) return;
    const idSet = new Set(tradeIds);
    setTrades(prev => prev.filter(t => !idSet.has(t.id)));
    if (userId) removeTradePortfolioOverlays(userId, tradeIds);
  };

  const handleBatchAddTrades = async (newTrades: Trade[]) => {
    if (isDemoMode) {
      blockDemoAction('Cannot import trades');
      return;
    }
    try {
      const currentPlan = normalizePlan(userProfile?.plan);
      const features = PLAN_FEATURES[currentPlan] || PLAN_FEATURES[APP_CONSTANTS.PLANS.FREE];
      if (userId && features.maxTradesPerMonth !== Infinity) {
        // Re-importing a broker export should be a harmless no-op. Do not
        // count ticketed rows already present in the local journal (or repeat
        // tickets within the same file) against the monthly plan allowance.
        const knownTickets = new Set(trades.map(trade => trade.ticketId).filter(Boolean));
        const importTickets = new Set<string>();
        const tradesForLimit = newTrades.filter(trade => {
          if (!trade.ticketId) return true;
          if (knownTickets.has(trade.ticketId) || importTickets.has(trade.ticketId)) return false;
          importTickets.add(trade.ticketId);
          return true;
        });
        const importsByMonth = new Map<string, number>();
        for (const trade of tradesForLimit) {
          const month = String(trade.date || '').slice(0, 7);
          if (/^\d{4}-\d{2}$/.test(month)) {
            importsByMonth.set(month, (importsByMonth.get(month) || 0) + 1);
          }
        }

        const counts = await Promise.all(Array.from(importsByMonth.entries()).map(async ([month, imported]) => {
          const [year, monthNumber] = month.split('-').map(Number);
          return { month, imported, existing: await dataService.getMonthlyTradeCount(userId, year, monthNumber) };
        }));
        const overLimit = counts.find(({ imported, existing }) => existing + imported > features.maxTradesPerMonth);
        if (overLimit) {
          addToast({
            type: 'error',
            title: 'Import exceeds monthly limit',
            message: `${overLimit.month} would exceed your ${features.maxTradesPerMonth}-trade ${currentPlan} limit.`,
            duration: 7000,
          });
          return;
        }
      }

      // Imports land in the active portfolio unless the file already stamps one.
      const targetPid = activePortfolioId || defaultPortfolioId || undefined;
      const stamped = newTrades.map(t => ({ ...t, portfolio_id: t.portfolio_id || targetPid }));
      const addedTrades = await dataService.batchAddTrades(stamped);

      // Persist the overlay immediately so a refresh/offline cold start still
      // resolves the assignment even if trades.portfolio_id lags behind.
      if (userId && targetPid) {
        const overlayEntries: Record<string, string> = {};
        for (const t of addedTrades) {
          if (t.id && !String(t.id).startsWith('dupe-')) {
            overlayEntries[t.id] = t.portfolio_id || targetPid;
          }
        }
        if (Object.keys(overlayEntries).length > 0) {
          writeTradePortfolioOverlays(userId, overlayEntries);
        }
      }

      setTrades(prev => {
        const existingIds = new Set(prev.map(t => t.id));
        return [...addedTrades.filter(t => !existingIds.has(t.id)), ...prev];
      });
      addToast({
        type: 'success',
        title: 'Import Successful',
        message: `Successfully imported ${addedTrades.length} trades from file.`,
        duration: 5000
      });
      setCurrentView('history');
    } catch (error) {
      console.error("Error batch adding trades:", error);
      addToast({
        type: 'error',
        title: 'Import Error',
        message: 'Failed to import trades. Please check the file format.',
        duration: 5000
      });
    }
  };

  const LIGHT_EDIT_FIELDS = ['notes', 'exitComment', 'rating', 'tags'];

  const handleUpdateTrade = async (updatedTrade: Trade) => {
    if (isDemoMode) {
      blockDemoAction('Cannot update trade');
      return;
    }
    const previousTrade = trades.find(t => t.id === updatedTrade.id);
    const changedFields = previousTrade
      ? Object.keys(updatedTrade).filter(key => updatedTrade[key as keyof Trade] !== previousTrade[key as keyof Trade])
      : [];
    const isCommentOnlyUpdate = changedFields.length > 0 && changedFields.every(key => key === 'notes' || key === 'exitComment');
    const isLightUpdate = changedFields.length > 0 && changedFields.every(key => LIGHT_EDIT_FIELDS.includes(key));

    // Optimistic for ALL edits so the UI never freezes behind the network.
    setTrades(prev => prev.map(t => t.id === updatedTrade.id ? updatedTrade : t));
    try {
      const savedTrade = isCommentOnlyUpdate
        ? await dataService.updateTradeComments(updatedTrade.id, updatedTrade.notes, updatedTrade.exitComment)
        : isLightUpdate
          ? await dataService.updateTradeFields(updatedTrade.id, {
              notes: updatedTrade.notes,
              exitComment: updatedTrade.exitComment,
              rating: updatedTrade.rating,
              tags: updatedTrade.tags,
            })
          : await dataService.updateTrade(updatedTrade);
      setTrades(prev => prev.map(t => t.id === savedTrade.id ? savedTrade : t));
    } catch (error: any) {
      console.error("Error updating trade:", error);
      if (previousTrade) {
        setTrades(prev => prev.map(t => t.id === updatedTrade.id ? previousTrade : t));
      }
      const msg = String(error?.message || '');
      addToast({
        type: 'error',
        title: 'Update Failed',
        message: msg.includes('another tab')
          ? 'This trade changed elsewhere. Reloaded the newest version — please re-apply your edit.'
          : 'Could not save your changes. Please try again.',
        duration: 6000,
      });
    }
  };

  const handleBatchUpdateTrades = async (updatedTrades: Trade[]) => {
    if (isDemoMode) {
      blockDemoAction('Cannot update trades');
      return false;
    }
    const previousTrades = trades.filter(t => updatedTrades.some(updated => updated.id === t.id));
    const updatesById = new Map(updatedTrades.map(trade => [trade.id, trade]));
    setTrades(prev => prev.map(trade => updatesById.get(trade.id) || trade));
    try {
      await dataService.batchUpdateTrades(updatedTrades);
      return true;
    } catch (error) {
      console.error("Error batch updating trades:", error);
      const rollbackById = new Map(previousTrades.map(trade => [trade.id, trade]));
      setTrades(prev => prev.map(trade => rollbackById.get(trade.id) || trade));
      addToast({
        type: 'error',
        title: 'Update Failed',
        message: 'Could not link trades. Please try again.'
      });
      return false;
    }
  };

  const handleDeleteTrades = async (tradeIds: string[]) => {
    if (isDemoMode) {
      blockDemoAction('Cannot delete trades');
      return;
    }
    setConfirmModal({
      isOpen: true,
      title: 'Delete Trades',
      description: `Are you sure you want to delete ${tradeIds.length} trade(s)? This action can be undone for 30 days.`,
      confirmText: 'Delete',
      variant: 'danger',
      onConfirm: async () => {
        const removedTrades = trades.filter(t => tradeIds.includes(t.id));
        // Optimistic: rows vanish instantly, modal closes immediately.
        setTrades(prev => prev.filter(t => !tradeIds.includes(t.id)));
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        try {
          await dataService.deleteTrades(tradeIds);
          dataService.logActivity('DELETE_TRADES', { count: tradeIds.length, ids: tradeIds });

          addToast({
            type: 'success',
            title: 'Trades Deleted',
            message: `${tradeIds.length} trade(s) moved to trash.`,
            duration: 8000,
            action: {
              label: 'Undo',
              onClick: async () => {
                try {
                  await dataService.restoreTrades(tradeIds);
                  setTrades(prev => {
                    const existingIds = new Set(prev.map(t => t.id));
                    return [...removedTrades.filter(t => !existingIds.has(t.id)), ...prev]
                      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                  });
                  addToast({
                    type: 'success',
                    title: 'Deletion Undone',
                    message: 'Your trades have been restored.'
                  });
                } catch (err) {
                  console.error("Failed to undo delete:", err);
                  addToast({
                    type: 'error',
                    title: 'Undo Failed',
                    message: 'Could not restore trades. Please refresh.'
                  });
                }
              }
            }
          });
        } catch (error) {
          console.error("Error deleting trades:", error);
          // Rollback so a failed delete never looks like data loss.
          setTrades(prev => {
            const existingIds = new Set(prev.map(t => t.id));
            return [...removedTrades.filter(t => !existingIds.has(t.id)), ...prev]
              .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
          });
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
          addToast({
            type: 'error',
            title: 'Delete Failed',
            message: 'Could not delete trades. They have been restored — please try again.'
          });
        }
      }
    });
  };

  const handleDeduplicate = async () => {
    if (isDemoMode) {
      blockDemoAction('Cannot de-duplicate trades');
      return;
    }
    try {
      const removedCount = await dataService.deduplicateManualTrades();
      if (removedCount > 0) {
        addToast({
          type: 'success',
          title: 'De-duplication Complete',
          message: `Successfully removed ${removedCount} duplicate manual entries.`,
          duration: 5000
        });
      } else {
        addToast({
          type: 'info',
          title: 'No Duplicates Found',
          message: 'Your manual trade history is already clean.',
          duration: 4000
        });
      }
    } catch (error) {
      console.error("Deduplication failed:", error);
      addToast({
        type: 'error',
        title: 'Task Failed',
        message: 'Could not complete de-duplication. Please try again later.'
      });
    }
  };

  const handleUpdateBias = async (bias: DailyBias) => {
    if (isDemoMode) {
      blockDemoAction('Cannot update daily bias');
      return;
    }
    // Optimistic update
    setDailyBias(prev => {
      const exists = prev.some(b => b.date === bias.date);
      if (exists) {
        return prev.map(b => b.date === bias.date ? bias : b);
      }
      return [bias, ...prev];
    });

    try {
      await dataService.updateBias(bias);
    } catch (error) {
      console.error("Error updating bias:", error);
    }
  };

  const handleAddNote = async (note: Note) => {
    if (isDemoMode) {
      blockDemoAction('Cannot add note');
      return undefined;
    }
    // Optimistic update with temp ID (crypto.randomUUID needs a secure context)
    const tempId = `temp-${typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
    const optimisticNote = { ...note, id: tempId };
    setNotes(prev => [optimisticNote, ...prev]);

    try {
      const newNote = await dataService.addNote(note);
      // Replace temp note with real one
      setNotes(prev => prev.map(n => n.id === tempId ? newNote : n));
      return newNote;
    } catch (error) {
      console.error("Error adding note:", error);
      // Rollback
      setNotes(prev => prev.filter(n => n.id !== tempId));
      throw error;
    }
  };

  // Optimistic-concurrency bookkeeping for notes.
  //
  // `updateNote` refuses to write when `updated_at` no longer matches, which is
  // exactly what a real cross-tab edit looks like — but overlapping saves from
  // the autosave queue also produced stale revisions and a false
  // "updated in another tab" error. Updates are therefore serialised per note
  // and the revision is re-read at execution time, never capture time.
  const noteRevisionRef = useRef<Map<string, string | undefined>>(new Map());
  const noteChainRef = useRef<Map<string, Promise<unknown>>>(new Map());

  const getNoteRevision = (noteId: string): string | undefined => {
    if (noteRevisionRef.current.has(noteId)) return noteRevisionRef.current.get(noteId);
    return notes.find(n => n.id === noteId)?.updatedAt;
  };

  const runNoteMutation = <T,>(noteId: string, mutation: () => Promise<T>): Promise<T> => {
    const previous = noteChainRef.current.get(noteId) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(mutation);
    noteChainRef.current.set(noteId, task);
    return task.finally(() => {
      if (noteChainRef.current.get(noteId) === task) noteChainRef.current.delete(noteId);
    });
  };

  const handleUpdateNote = async (note: Partial<Note> & { id: string }) => {
    if (isDemoMode) {
      blockDemoAction('Cannot update note');
      return;
    }
    return runNoteMutation(note.id, async () => {
      const payload: Partial<Note> & { id: string } = {
        ...note,
        updatedAt: getNoteRevision(note.id),
      };
      // Optimistic update — capture the real previous row inside the setter so
      // the rollback never depends on a stale render closure.
      let previousNote: Note | undefined;
      setNotes(prev => {
        previousNote = prev.find(n => n.id === payload.id);
        return prev.map(n => n.id === payload.id ? { ...n, ...payload } : n);
      });
      try {
        const savedNote = await dataService.updateNote(payload);
        noteRevisionRef.current.set(savedNote.id, savedNote.updatedAt);
        setNotes(prev => prev.map(n => n.id === savedNote.id ? savedNote : n));
        return savedNote;
      } catch (error) {
        console.error("Error updating note:", error);
        if (previousNote) {
          const rollback = previousNote;
          setNotes(prev => prev.map(n => n.id === payload.id ? rollback : n));
        }
        throw error;
      }
    });
  };

  const handleDeleteNote = async (noteId: string) => {
    if (isDemoMode) {
      blockDemoAction('Cannot delete note');
      return;
    }
    const noteToDelete = notes.find(n => n.id === noteId);
    if (!noteToDelete) return;

    if (noteToDelete.isTrashed) {
      handleDeleteNoteForever(noteId);
      return;
    }

    setConfirmModal({
      isOpen: true,
      title: 'Delete Note',
      description: 'Are you sure you want to delete this note? It will be moved to trash.',
      confirmText: 'Delete',
      variant: 'danger',
      onConfirm: async () => {
        // Move in place — filtering the note out first made it vanish from the
        // UI entirely when the write failed (or while offline).
        const trashedNote = { ...noteToDelete, isTrashed: true };
        setNotes(prev => prev.map(n => n.id === noteId ? trashedNote : n));
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        try {
          const saved = await runNoteMutation(noteId, () =>
            dataService.updateNote({ ...trashedNote, updatedAt: getNoteRevision(noteId) })
          );
          if (saved)           noteRevisionRef.current.set(noteId, saved.updatedAt);
          addToast({
            type: 'success',
            title: 'Note Deleted',
            message: 'Note has been moved to trash.',
            duration: 8000,
            action: { label: 'Undo', onClick: () => void handleRestoreNote(noteId) },
          });
        } catch (error) {
          console.error("Error deleting note:", error);
          setNotes(prev => prev.map(n => n.id === noteId ? noteToDelete : n));
          addToast({
            type: 'error',
            title: 'Delete Failed',
            message: 'An error occurred while deleting the note.'
          });
        }
      }
    });
  };

  const handleRestoreNote = async (noteId: string) => {
    if (isDemoMode) {
      blockDemoAction('Cannot restore note');
      return;
    }
    const noteToRestore = notes.find(n => n.id === noteId);
    if (!noteToRestore) return;

    const restored = { ...noteToRestore, isTrashed: false };
    // Optimistic update
    setNotes(prev => prev.map(n => n.id === noteId ? (restored as Note) : n));

    try {
      const saved = await runNoteMutation(noteId, () =>
        dataService.updateNote({ ...restored, updatedAt: getNoteRevision(noteId) })
      );
      if (saved) noteRevisionRef.current.set(noteId, saved.updatedAt);
      addToast({
        type: 'success',
        title: 'Note Restored',
        message: 'Note has been restored to your library.',
        duration: 3000
      });
    } catch (error) {
      console.error("Error restoring note:", error);
      setNotes(prev => prev.map(note => note.id === noteId ? noteToRestore : note));
      addToast({
        type: 'error',
        title: 'Restore Failed',
        message: 'Your note could not be restored. Please try again.',
      });
    }
  };

  // Reorder writes happen straight through dataService (one UPDATE per row),
  // so this only mirrors the result locally and refreshes each note's revision
  // — otherwise the next autosave would trip the stale-revision guard.
  const handleReorderNotes = (rows: { id: string; position: number; updatedAt?: string }[]) => {
    const byId = new Map(rows.map(r => [r.id, r]));
    setNotes(prev => prev.map(n => {
      const row = byId.get(n.id);
      if (!row) return n;
      if (row.updatedAt) noteRevisionRef.current.set(n.id, row.updatedAt);
      return { ...n, position: row.position, updatedAt: row.updatedAt ?? n.updatedAt };
    }));
  };

  const handleDeleteNoteForever = async (noteId: string) => {
    if (isDemoMode) {
      blockDemoAction('Cannot permanently delete note');
      return;
    }
    setConfirmModal({
      isOpen: true,
      title: 'Delete Forever',
      description: 'Are you sure you want to permanently delete this note? This action cannot be undone.',
      confirmText: 'Delete Forever',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await dataService.deleteNote(noteId);
          setNotes(prev => prev.filter(n => n.id !== noteId));
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
          addToast({
            type: 'success',
            title: 'Note Deleted Permanently',
            message: 'Note has been removed forever.',
            duration: 5000
          });
        } catch (error) {
          console.error("Error deleting note forever:", error);
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
          addToast({
            type: 'error',
            title: 'Delete Failed',
            message: 'An error occurred while deleting the note.'
          });
        }
      }
    });
  };

const onLogout = async () => {
  setConfirmModal({
    isOpen: true,
    title: 'Log Out',
    description: 'Log out of this device now?',
    confirmText: 'Log Out',
    variant: 'danger',
    onConfirm: async () => {
      await handleLogout();
      setIsDemoMode(false);
      setTrades([]);
      setNotes([]);
      setDailyBias([]);
      setEASession(null);
      setConfirmModal(prev => ({ ...prev, isOpen: false }));
    }
  });
};

  useEffect(() => {
    const themeClasses = ['theme-obsidian', 'theme-cosmic'];
    document.documentElement.classList.remove(...themeClasses);
    document.body.classList.remove(...themeClasses);

    document.documentElement.classList.add('dark');
    const activeTheme = normalizeThemePreference(activeUserProfile?.themePreference);
    const themeClass = `theme-${activeTheme}`;
    document.documentElement.classList.add(themeClass);
    document.body.classList.add(themeClass);
    document.body.style.background = activeTheme === 'cosmic'
      ? 'linear-gradient(135deg,#000000 0%,#000000 50%,#000000 100%)'
      : 'linear-gradient(135deg,#000000 0%,#000000 55%,#000000 100%)';
  }, [isDarkMode, activeUserProfile?.themePreference]);

  useEffect(() => {
    if (currentView !== 'charts') {
      setIsFocusMode(false);
    }
  }, [currentView]);

  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    // Scope the mobile design system: body.jfx-mobile gates every ported
    // mobile-shell CSS rule, so desktop rendering is never affected.
    // Mirrors the MobileLayout branch condition below exactly.
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('jfx-mobile', isMobile && !!activeUserProfile);
    }
  }, [isMobile, activeUserProfile]);

  // §2.3A: auth-callback path reset runs as an effect (hooks live above
  // every early return). Render below reads state only — no setState in render.
  useEffect(() => {
    if (isAuthCallbackPath) {
      if (typeof window !== 'undefined') {
        window.history.replaceState({}, '', '/');
      }
      setCurrentPath('/');
    }
  }, [isAuthCallbackPath]);

  if (publicPath === '/privacy') {
    return <PrivacyPolicy />;
  }

  if (publicPath === '/terms') {
    return <TermsOfService />;
  }

  if (isAuthCallbackPath) {
    return <BrandedLoader />;
  }

  if (isInitialLoading) {
    return <BrandedLoader />;
  }

  if (!isAuthenticated) {
    return (
      <Auth
        isDarkMode={isDarkMode}
        onLogin={async () => {
          setIsInitialLoading(true);
          try {
            const user = await authService.getCurrentUser();
            if (user) {
              setUserId(user.id);
              setUserEmail(user.email || '');
              await loadUserData(user.id);
              setIsAuthenticated(true);
              posthog.identify(user.id, { email: user.email || '' });
            }
          } catch (error) {
            console.error("Login data load failed:", error);
          } finally {
            setIsInitialLoading(false);
          }
        }}
        onRegister={async () => {
          setIsInitialLoading(true);
          try {
            const user = await authService.getCurrentUser();
            if (user) {
              setUserId(user.id);
              setUserEmail(user.email || '');
              await loadUserData(user.id);
              setIsAuthenticated(true);
              posthog.identify(user.id, { email: user.email || '' });
            }
          } catch (error) {
            console.error("Registration data load failed:", error);
          } finally {
            setIsInitialLoading(false);
          }
        }}
      />
    );
  }

  // Mobile web renders the same mobile shell as the APK. The hard blocker
  // only returns when explicitly opted out via VITE_MOBILE_ENABLED=false.
  if (isMobile && !IS_CAPACITOR && !MOBILE_ENABLED) {
    return <MobileBlocker isDarkMode={isDarkMode} />;
  }

  if (!userProfile || !userProfile.onboarded) {
    return <Onboarding isDarkMode={isDarkMode} onComplete={async (profile) => {
      await handleOnboardingComplete(profile);
      setCurrentView(profile.syncMethod === 'EA_CONNECT' ? 'ea-setup' : 'dashboard');
      setTrades([]);
    }} onExploreDemo={() => {
      // Enter demo immediately; a real profile gets created when the user
      // eventually finishes onboarding normally. Demo profile overlays this
      // one via getDemoProfile until they exit demo.
      localStorage.setItem('jfx_demo_mode', 'true');
      setIsDemoMode(true);
      void (async () => {
        await handleOnboardingComplete({
          name: 'Demo Trader',
          country: '',
          accountName: 'Sample Trading Account',
          initialBalance: 12500,
          currency: 'USD',
          currencySymbol: '$',
          syncMethod: 'Manual',
          experienceLevel: 'Beginner',
          tradingStyle: 'Day Trader',
          onboarded: true,
          plan: 'FREE TIER (JOURNALER)',
          themePreference: 'obsidian',
          eaConnected: false,
        } as UserProfile);
        setCurrentView('dashboard');
      })();
    }} />;
  }

  if (showBetaSplash) {
    return <BetaSplash onContinue={() => {
      try { window.localStorage.setItem('jfx_beta_seen_v1', '1'); } catch {
        // Storage unavailable — splash simply shows again next load.
      }
      setShowBetaSplash(false);
    }} />;
  }

  const totalPnL = activeTrades.reduce((acc, t) => acc + getSafePnL(t.pnl), 0);

  // Balance priority (portfolio-scoped, so one connection's balance never
  // leaks into an unrelated portfolio):
  //  1. Portfolio source === 'bridge' (or Default while the EA is connected)
  //     → resolveBridgeBackedBalance: live eaSession balance, else the last
  //       synced snapshot, else initialBalance + PnL.
  //  2. Else if a cTrader broker account is connected (linked to this
  //     portfolio, or the account picked in Connect & Import): show the live
  //     broker balance (cached snapshot while offline) so the card matches
  //     cTrader.
  //  3. Otherwise: portfolio startingBalance + journaled PnL.
  const activeInitialBalance = activePortfolio?.startingBalance ?? (
    (activePortfolio?.isDefault || activePortfolio?.id === defaultPortfolioId)
      ? activeUserProfile?.initialBalance
      : 0
  ) ?? 0;

  const isBridgePortfolio = activePortfolio?.source === 'bridge' || (
    (!activePortfolio || activePortfolio?.isDefault || activePortfolio?.id === defaultPortfolioId) &&
    Boolean(activeUserProfile?.eaConnected)
  );

  const ctraderBalanceForCard = (!isDemoMode && !isBridgePortfolio && ctraderLive.balance !== null)
    ? ctraderLive.balance
    : null;

  const currentBalance = (!isDemoMode && isBridgePortfolio)
    ? resolveBridgeBackedBalance({
        userProfile: activeUserProfile,
        totalPnL,
        eaSession: activeEaSession,
        lastKnownBridgeBalance,
        isBridgeOnline,
        isDemoMode,
      })
    : (ctraderBalanceForCard ?? activeInitialBalance + totalPnL);

  const balanceSource: 'bridge' | 'ctrader' | null = (!isDemoMode && isBridgePortfolio)
    ? 'bridge'
    : (ctraderBalanceForCard !== null ? 'ctrader' : null);
  const isLiveBalance = balanceSource === 'bridge' ? isBridgeOnline : ctraderLive.isLive;

  const { date: sastDate } = getSASTDateTime();
  const [year, month] = sastDate.split('-').map(Number);
  
  const tradesThisMonth = activeTrades.filter(t => {
    const [tYear, tMonth] = t.date.split('-').map(Number);
    return tMonth === month && tYear === year;
  }).length;

  // Free-tier monthly limit (Infinity for paid plans) used by the usage badge
  // near the Log Trade entry.
  const currentPlanFeatures = PLAN_FEATURES[normalizePlan(activeUserProfile?.plan)] || PLAN_FEATURES[APP_CONSTANTS.PLANS.FREE];

  const totalNotes = activeNotes.filter(n => !n.isTrashed).length;
  const totalImages = activeTrades.reduce((acc, t) => {
    let count = 0;
    if (t.beforeScreenshot) count++;
    if (t.afterScreenshot) count++;
    return acc + count;
  }, 0);

  return (
    <ErrorBoundary isDarkMode={isDarkMode}>
      {isDemoMode && (
        <div className="fixed inset-x-0 top-0 z-[260] border-b border-amber-500/20 bg-gradient-to-r from-amber-500/15 via-orange-500/15 to-rose-500/15 backdrop-blur-xl">
          <div className="mx-auto flex w-full max-w-[1800px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <div className="flex items-center gap-3 min-w-0">
              <span className="inline-flex shrink-0 items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.25em] text-amber-300">
                Demo Mode
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-amber-50">You are viewing a sample journal covering a recent three-month period.</p>
                <p className="truncate text-xs text-amber-100/70">Real data is untouched. Switch back any time to resume your live journal.</p>
              </div>
            </div>
            <button
              onClick={() => {
                setIsDemoMode(false);
                setCurrentView('dashboard');
                setEditingTrade(null);
                setIsQuickLogOpen(false);
                addToast({
                  type: 'info',
                  title: 'Exited Demo Mode',
                  message: 'Your real journal is active again.',
                  duration: 4000,
                });
              }}
              className="shrink-0 rounded-xl border border-amber-400/30 bg-white/10 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-amber-50 transition-all hover:bg-white/15"
            >
              Exit Demo
            </button>
          </div>
        </div>
      )}
      {isMobile && activeUserProfile ? (
        <MobileLayout
          currentView={currentView}
          onViewChange={setCurrentView}
          trades={activeTrades}
          notes={activeNotes}
          dailyBias={activeDailyBias}
          userProfile={activeUserProfile}
          userEmail={userEmail}
          eaSession={activeEaSession}
          lastKnownBridgeBalance={lastKnownBridgeBalance}
          isBridgeOnline={isBridgeOnline}
          isDemoMode={isDemoMode}
          onToggleDemoMode={() => {
            const nextDemo = !isDemoMode;
            setIsDemoMode(nextDemo);
            setCurrentView('dashboard');
            setEditingTrade(null);
            setIsQuickLogOpen(false);
            addToast({
              type: 'info',
              title: nextDemo ? 'Demo Mode Enabled' : 'Demo Mode Disabled',
              message: nextDemo
                ? 'Sample trades, notes, and analytics are now visible.'
                : 'Your live journal data is visible again.',
              duration: 4000,
            });
          }}
          onLogout={onLogout}
          onAddTrade={handleAddTrade}
          onUpdateTrade={handleUpdateTrade}
          onBatchUpdateTrades={handleBatchUpdateTrades}
          onDeleteTrades={handleDeleteTrades}
          onEditTrade={handleEditTrade}
          onTradesAddedBatch={handleTradesAddedBatch}
          onTradesDeletedBatch={handleTradesDeletedBatch}
          onBrokerTradeAdded={handleBrokerTradeAdded}
          onAddNote={handleAddNote}
          onUpdateNote={async (note: any) => { await handleUpdateNote(note); }}
          onDeleteNote={handleDeleteNote}
          onRestoreNote={handleRestoreNote}
          onUpdateProfile={async (profile: any) => { await handleUpdateProfile(profile); return profile; }}
          isDarkMode={isDarkMode}
          userId={userId}
          offlineQueue={offlineQueue}
          onAddOffline={addToOfflineQueue}
          onBatchAddTrades={handleBatchAddTrades}
          editingTrade={editingTrade}
          onClearEditingTrade={() => setEditingTrade(null)}
          settingsInitialTab={settingsTab}
          portfolios={portfolios}
          activePortfolioId={activePortfolioId}
          defaultPortfolioId={defaultPortfolioId}
          canAddPortfolio={canAddPortfolio}
          tradeCounts={tradeCounts}
          onSelectPortfolioId={setActivePortfolioId}
          onAddPortfolio={handleAddPortfolioAndConnect}
          onRemovePortfolio={handleRemovePortfolio}
          onLinkPortfolioAccount={handleLinkPortfolioAccount}
          linkCollisionCheck={findLinkCollision}
          portfolioBalances={portfolioBalances}
          activePortfolio={activePortfolio}
          currentBalance={currentBalance}
          activeInitialBalance={activeInitialBalance}
          liveBalanceSource={balanceSource}
          isLiveBalance={isLiveBalance}
          ctraderAccountId={ctraderAccountId}
          tradesThisMonth={tradesThisMonth}
          maxTradesPerMonth={currentPlanFeatures.maxTradesPerMonth}
          totalNotes={totalNotes}
          totalImages={totalImages}
          tradesCount={activeTrades.length}
          dailyPsychologyInsights={dailyPsychologyInsights}
          onRefreshPsychologyInsights={() => refreshPsychologyInsights(true)}
          isRefreshingPsychologyInsights={isRefreshingPsychologyInsights}
          psychologyAnalyzeLimitReached={psychologyAnalyzeLimitReached}
          cashTransactions={cashTransactions}
          onDeduplicate={handleDeduplicate}
          migrationVersion={currentMigrationVersion}
        />
      ) : (
      <div className={`compact-scale flex h-screen w-full transition-colors duration-300 ${isDemoMode ? 'pt-16' : ''} ${isDarkMode ? 'text-zinc-100' : 'bg-slate-50 text-slate-900'}`} style={isDarkMode ? { background: '#000000' } : {}}>

        {!isFocusMode && (
            <Sidebar
              currentView={currentView}
              onViewChange={setCurrentView}
              onSettingsTabChange={setSettingsTab}
              activePortfolioSource={activePortfolio?.source}
              isDarkMode={isDarkMode}
              onOpenQuickLog={() => setIsQuickLogOpen(true)}
              onLogout={onLogout}
              userProfile={activeUserProfile}
              trades={activeTrades}
              offlineQueueCount={offlineQueue.length}
              isDemoMode={isDemoMode}
              onToggleDemoMode={() => {
                const nextDemo = !isDemoMode;
                setIsDemoMode(nextDemo);
                setCurrentView('dashboard');
                setEditingTrade(null);
                setIsQuickLogOpen(false);
                addToast({
                  type: 'info',
                  title: nextDemo ? 'Demo Mode Enabled' : 'Demo Mode Disabled',
                  message: nextDemo
                    ? 'Sample trades, notes, and analytics are now visible.'
                    : 'Your live journal data is visible again.',
                  duration: 4000,
                });
              }}
            />
        )}

        <main className="flex-1 h-full overflow-hidden relative">
          <Suspense fallback={<BrandedLoader />}>
            {currentView === 'dashboard' && (
              <Dashboard
                isDarkMode={isDarkMode}
                trades={activeTrades}
                dailyBias={activeDailyBias}
                onUpdateBias={handleUpdateBias}
                userProfile={activeUserProfile}
                onViewChange={setCurrentView}
                eaSession={activeEaSession}
                lastKnownBridgeBalance={lastKnownBridgeBalance}
                isBridgeOnline={isBridgeOnline}
                isLoading={isDataLoading}
                offlineQueue={offlineQueue}
                isDemoMode={isDemoMode}
              />
            )}
            {currentView === 'ai-chat' && (
            <AIChat
                isDarkMode={isDarkMode}
                trades={activeTrades}
                userProfile={activeUserProfile}
                dailyBias={activeDailyBias}
                onAddNote={handleAddNote}
                eaSession={activeEaSession}
                lastKnownBridgeBalance={lastKnownBridgeBalance}
                isBridgeOnline={isBridgeOnline}
                onOpenSettings={() => setCurrentView('settings')}
              />
            )}
            {currentView === 'log-trade' && activeUserProfile && (
              <LogTrade
                key={editingTrade?.id || 'new-trade'}
                isDarkMode={isDarkMode}
                onSave={handleAddTrade}
                onBatchSave={handleBatchAddTrades}
                onCancel={() => {
                  setEditingTrade(null);
                  setCurrentView(editingTrade ? 'history' : 'dashboard');
                }}
                initialTrade={editingTrade}
                currencySymbol={activeUserProfile.currencySymbol}
                trades={activeTrades}
                userProfile={activeUserProfile}
                isReadOnly={isDemoMode}
                tradesUsedThisMonth={tradesThisMonth}
                maxTradesThisMonth={currentPlanFeatures.maxTradesPerMonth}
              />
            )}
            {currentView === 'backtest-lab' && activeUserProfile && (
              <BacktestLab isDarkMode={isDarkMode} userProfile={activeUserProfile} onUpdateProfile={handleUpdateProfile} />
            )}
            {currentView === 'history' && (
              <Journal
                isDarkMode={isDarkMode}
                trades={activeTrades}
                onUpdateTrade={handleUpdateTrade}
                onBatchUpdateTrades={handleBatchUpdateTrades}
                onDeleteTrades={handleDeleteTrades}
                onEditTrade={handleEditTrade}
                userProfile={activeUserProfile}
                onViewChange={setCurrentView}
                offlineQueue={offlineQueue}
                isDemoMode={isDemoMode}
              />
            )}
{currentView === 'analytics' && activeUserProfile && (
          <Analytics
            isDarkMode={isDarkMode}
            trades={activeTrades}
            userProfile={activeUserProfile}
            eaSession={activeEaSession}
            lastKnownBridgeBalance={lastKnownBridgeBalance}
            isBridgeOnline={isBridgeOnline}
            onViewChange={setCurrentView}
            cashTransactions={cashTransactions}
            dailyPsychologyInsights={dailyPsychologyInsights}
            onRefreshPsychologyInsights={() => refreshPsychologyInsights(true)}
            isRefreshingPsychologyInsights={isRefreshingPsychologyInsights}
            psychologyAnalyzeLimitReached={psychologyAnalyzeLimitReached}
            isDemoMode={isDemoMode}
          />
        )}
            {currentView === 'portfolios' && (
              <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6">
                <div className="mb-5 flex items-center gap-3">
                  <button
                    onClick={() => setCurrentView('dashboard')}
                    aria-label="Back to dashboard"
                    className="w-9 h-9 rounded-xl flex items-center justify-center border border-white/[0.08] bg-white/[0.03] text-zinc-300 hover:text-white transition-all"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <h1 className="text-xl font-black tracking-tight text-white">Portfolios</h1>
                </div>
                <div className="mx-auto w-full max-w-2xl rounded-3xl border border-white/[0.08] bg-[#0a0a0a] p-4 sm:p-6">
                  <PortfolioSwitcher
                    portfolios={portfolios}
                    activeId={activePortfolioId}
                    defaultId={defaultPortfolioId}
                    canAdd={canAddPortfolio}
                    isDarkMode={isDarkMode}
                    variant="settings"
                    tradeCounts={tradeCounts}
                    onSelect={(id) => setActivePortfolioId(id)}
                    onAdd={handleAddPortfolioAndConnect}
                    onRemove={handleRemovePortfolio}
                  />
                </div>
              </div>
            )}

            {currentView === 'notes' && (
              <Notes
                isDarkMode={isDarkMode}
                notes={activeNotes}
                onAddNote={handleAddNote}
                onUpdateNote={handleUpdateNote}
                onDeleteNote={handleDeleteNote}
                onRestoreNote={handleRestoreNote}
                onReorderNotes={handleReorderNotes}
                userProfile={activeUserProfile}
                onViewChange={setCurrentView}
                isDemoMode={isDemoMode}
              />
            )}

            {activeUserProfile?.keepChartsAlive ? (
              <div className={currentView === 'charts' ? 'h-full w-full' : 'hidden'}>
                {activeUserProfile && (
                  <ChartGrid
                    isDarkMode={isDarkMode}
                    isFocusMode={isFocusMode}
                    onToggleFocus={() => setIsFocusMode(!isFocusMode)}
                    userProfile={activeUserProfile}
                    onUpdateProfile={handleUpdateProfile}
                  />
                )}
              </div>
            ) : (
              currentView === 'charts' && activeUserProfile && (
                <ChartGrid
                  isDarkMode={isDarkMode}
                  isFocusMode={isFocusMode}
                  onToggleFocus={() => setIsFocusMode(!isFocusMode)}
                  userProfile={activeUserProfile}
                  onUpdateProfile={handleUpdateProfile}
                />
              )
            )}

            {currentView === 'ea-setup' && activeUserProfile && userId && (
              <EASetup
                isDarkMode={isDarkMode}
                userProfile={activeUserProfile}
                onUpdateProfile={handleUpdateProfile}
                eaSession={activeEaSession}
                isDemoMode={isDemoMode}
                onTradeAdded={(newTrade) => {
                  if (isDemoMode) { blockDemoAction('Cannot save trade'); return; }
                  setTrades(prev => [newTrade, ...prev]);
                }}
                onEditTrade={handleEditTrade}
                onAddOffline={(trade) => {
                  if (isDemoMode) { blockDemoAction('Cannot queue trade'); return; }
                  addToOfflineQueue(trade);
                }}
                onImportTrades={handleBatchAddTrades}
                trades={activeTrades}
                userId={userId}
                onNavigateToJournal={() => {
                  setEditingTrade(null);
                  setCurrentView('history');
                }}
              />
            )}
            {currentView === 'settings' && activeUserProfile && (
              <Settings
                isDarkMode={isDarkMode}
                userProfile={activeUserProfile}
                userEmail={userEmail}
                onUpdateProfile={handleUpdateProfile}
                onLogout={onLogout}
                tradesThisMonth={tradesThisMonth}
                totalNotes={totalNotes}
                totalImages={totalImages}
                tradesCount={activeTrades.length}
                onDeduplicate={handleDeduplicate}
                initialTab={settingsTab}
                migrationVersion={currentMigrationVersion}
                eaSession={activeEaSession}
                userId={userId}
                offlineQueueCount={offlineQueue.length}
                portfolios={portfolios}
                activePortfolioId={activePortfolioId}
                defaultPortfolioId={defaultPortfolioId}
                canAddPortfolio={canAddPortfolio}
                tradeCounts={tradeCounts}
                onSelectPortfolioId={setActivePortfolioId}
                onAddPortfolio={handleAddPortfolioAndConnect}
                onRemovePortfolio={handleRemovePortfolio}
              />
            )}
          </Suspense>
        </main>

        <QuickLogModal
          isOpen={isQuickLogOpen}
          onClose={() => setIsQuickLogOpen(false)}
          onSave={handleAddTrade}
          isDarkMode={isDarkMode}
          currencySymbol={activeUserProfile?.currencySymbol || '$'}
          tradesUsedThisMonth={tradesThisMonth}
          maxTradesThisMonth={currentPlanFeatures.maxTradesPerMonth}
        />

        <ConfirmationModal
          isOpen={confirmModal.isOpen}
          title={confirmModal.title}
          description={confirmModal.description}
          confirmText={confirmModal.confirmText}
      cancelText={confirmModal.cancelText}
          variant={confirmModal.variant}
          showCancel={confirmModal.showCancel}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
          isDarkMode={isDarkMode}
        />
      </div>
      )}

      {/* Trade recap — peak-moment acknowledgement after a NEW trade saves.
          Rendered above both the mobile shell and the desktop layout. */}
      <TradeRecapSheet
        isOpen={!!recapTrade}
        trade={recapTrade}
        trades={activeTrades}
        currencySymbol={activeUserProfile?.currencySymbol || '$'}
        isDarkMode={isDarkMode}
        onAddNotes={() => {
          const saved = recapTrade;
          setRecapTrade(null);
          if (saved) handleEditTrade(saved);
        }}
        onSetBias={() => {
          setRecapTrade(null);
          setCurrentView('dashboard');
        }}
        onDone={() => {
          setRecapTrade(null);
          setCurrentView('history');
        }}
        onClose={() => {
          setRecapTrade(null);
          setCurrentView('history');
        }}
      />
    </ErrorBoundary>
  );
};

const App: React.FC = () => {
  const handleAnnotationAdd = (_annotation: Annotation) => {};
  const { isOnline, isChecking, checkConnection } = useNetworkStatus();

  return (
    <ToastProvider>
      {!isOnline && (
        <OfflineBanner
          isChecking={isChecking}
          onRetry={checkConnection}
        />
      )}
      <AppContent />
      {import.meta.env.DEV && (
        <Agentation 
          onAnnotationAdd={handleAnnotationAdd}
          onAnnotationUpdate={() => {}}
          onAnnotationDelete={() => {}}
        />
      )}
    </ToastProvider>
  );
};

export default App;
