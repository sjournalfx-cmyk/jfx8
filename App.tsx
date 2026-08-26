import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import { safeLazy } from './lib/safeLazy';
import Sidebar from './components/Sidebar';
import LogTrade from './components/LogTrade';
import Dashboard from './components/Dashboard';
import Journal from './components/Journal';
import Auth from './components/Auth';
import BetaSplash from './components/BetaSplash';

import { Trade, Note, DailyBias, UserProfile } from './types';
import Onboarding from './components/Onboarding';
import Settings from './components/Settings';
import EASetup from './components/EASetup';
import ConfirmationModal from './components/ConfirmationModal';
import QuickLogModal from './components/QuickLogModal';
import ErrorBoundary from './components/ErrorBoundary';
import { APP_CONSTANTS, PLAN_FEATURES, normalizePlan } from './lib/constants';
import { useLocalStorage } from './hooks/useLocalStorage';
import { getSASTDateTime } from './lib/timeUtils';
import { buildAnalyticsAiSnapshot } from './lib/analyticsAiSnapshot';
import { buildPsychologyInsightsPrompt, extractSectionBody, getPsychologyInsightsDayKey, getPsychologyInsightsScopeKey, PSYCHOLOGY_INSIGHTS_STORAGE_KEY, type PsychologyInsightsCache } from './lib/psychologyInsights';
import { dataService } from './services/dataService';
import { modalResearchService } from './services/nvidiaAiService';
import { ToastProvider, useToast } from './components/ui/Toast';
import { BrandedLoader } from './components/ui/BrandedLoader';
import { MobileBlocker } from './components/ui/MobileBlocker';
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
  const [settingsTab, setSettingsTab] = useState<'profile' | 'account' | 'appearance' | 'billing' | 'security' | 'help'>('profile');
  const { addToast } = useToast();
  const [isDemoMode, setIsDemoMode] = useLocalStorage<boolean>('jfx_demo_mode', false);
  const [showBetaSplash, setShowBetaSplash] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      // Suppress splash immediately when returning from cTrader OAuth redirect
      if (params.has('code') || window.location.search.includes('ctrader_token')) {
        return false;
      }
    }
    return true;
  });

  const [currentMigrationVersion] = useState('v20250201.1');

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
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
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
        const result = await exchangeCode(code);
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
  const activeTrades = isDemoMode ? demoTrades : trades;
  const activeNotes = isDemoMode ? demoNotes : notes;
  const activeDailyBias = isDemoMode ? demoDailyBias : dailyBias;
  const activeEaSession = isDemoMode ? demoEASession : eaSession;

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

  // Auto-enable demo mode for new users (onboarded with no trades)
  useEffect(() => {
    const storedDemo = localStorage.getItem('jfx_demo_mode');
    if (isAuthenticated && userProfile?.onboarded && trades.length === 0 && storedDemo === null) {
      setIsDemoMode(true);
    }
  }, [isAuthenticated, userProfile?.onboarded, trades.length, setIsDemoMode, isDemoMode]);

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
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    confirmText?: string;
    cancelText?: string;
    variant?: 'danger' | 'warning' | 'info';
    showCancel?: boolean;
    onConfirm: () => void;
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
      } else {
        const sastNow = getSASTDateTime();
        const [year, month] = sastNow.date.split('-').map(Number);
        
        const currentPlan = normalizePlan(userProfile?.plan);
        const features = PLAN_FEATURES[currentPlan] || PLAN_FEATURES[APP_CONSTANTS.PLANS.FREE];

        if (userId && features.maxTradesPerMonth !== Infinity) {
          const dbTradesThisMonth = await dataService.getMonthlyTradeCount(userId, year, month);
          
          if (dbTradesThisMonth >= features.maxTradesPerMonth) {
            setConfirmModal({
              isOpen: true,
              title: 'Monthly Limit Reached',
              description: `You have reached the limit of ${features.maxTradesPerMonth} trades per month for the ${currentPlan}. Upgrade your plan for more capacity.`,
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

      setConfirmModal({
        isOpen: true,
        title: 'Error',
        description: 'Failed to save trade. Please try again.',
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

  const handleBatchAddTrades = async (newTrades: Trade[]) => {
    if (isDemoMode) {
      blockDemoAction('Cannot import trades');
      return;
    }
    try {
      const addedTrades = await dataService.batchAddTrades(newTrades);
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

    if (isCommentOnlyUpdate) {
      setTrades(prev => prev.map(t => t.id === updatedTrade.id ? updatedTrade : t));
    }
    try {
      const savedTrade = isCommentOnlyUpdate
        ? await dataService.updateTradeComments(updatedTrade.id, updatedTrade.notes, updatedTrade.exitComment)
        : await dataService.updateTrade(updatedTrade);
      setTrades(prev => prev.map(t => t.id === savedTrade.id ? savedTrade : t));
    } catch (error) {
      console.error("Error updating trade:", error);
      if (previousTrade) {
        setTrades(prev => prev.map(t => t.id === updatedTrade.id ? previousTrade : t));
      }
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
        try {
          await dataService.deleteTrades(tradeIds);
          setTrades(prev => prev.filter(t => !tradeIds.includes(t.id)));
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
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
          addToast({
            type: 'error',
            title: 'Delete Failed',
            message: 'An error occurred while deleting trades.'
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
    // Optimistic update with temp ID
    const tempId = `temp-${Date.now()}`;
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

  const handleUpdateNote = async (note: Note) => {
    if (isDemoMode) {
      blockDemoAction('Cannot update note');
      return;
    }
    // Optimistic update
    setNotes(prev => prev.map(n => n.id === note.id ? { ...n, ...note } : n));
    try {
      await dataService.updateNote(note);
    } catch (error) {
      console.error("Error updating note:", error);
      // Rollback would be nice but typically Realtime sync handles it
    }
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
        try {
          // Optimistic update
          setNotes(prev => prev.filter(n => n.id !== noteId));
          const updatedNote = { ...noteToDelete, isTrashed: true };
          await dataService.updateNote(updatedNote);
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
          addToast({
            type: 'success',
            title: 'Note Deleted',
            message: 'Note has been moved to trash.',
            duration: 5000
          });
        } catch (error) {
          console.error("Error deleting note:", error);
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

    try {
      // Optimistic update
      const updatedNote = { ...noteToRestore, isTrashed: false };
      setNotes(prev => prev.map(n => n.id === noteId ? (updatedNote as Note) : n));
      await dataService.updateNote(updatedNote as Note);
      addToast({
        type: 'success',
        title: 'Note Restored',
        message: 'Note has been restored to your library.',
        duration: 3000
      });
    } catch (error) {
      console.error("Error restoring note:", error);
    }
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

  if (isInitialLoading) {
    return <BrandedLoader />;
  }

  if (isMobile) {
    return <MobileBlocker isDarkMode={isDarkMode} />;
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
    return <BetaSplash onContinue={() => setShowBetaSplash(false)} />;
  }

  const totalPnL = activeTrades.reduce((acc, t) => acc + getSafePnL(t.pnl), 0);
  // Balance priority:
  //  1. Bridge is live → use live balance from eaSession
  //  2. Bridge just went offline → show last known synced balance (from localStorage)
  //  3. Never synced → fall back to initialBalance + PnL
  const currentBalance = resolveBridgeBackedBalance({
    userProfile: activeUserProfile,
    totalPnL,
    eaSession: activeEaSession,
    lastKnownBridgeBalance,
    isBridgeOnline,
    isDemoMode,
  });

  const { date: sastDate } = getSASTDateTime();
  const [year, month] = sastDate.split('-').map(Number);
  
  const tradesThisMonth = activeTrades.filter(t => {
    const [tYear, tMonth] = t.date.split('-').map(Number);
    return tMonth === month && tYear === year;
  }).length;

  const totalNotes = activeNotes.length;
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
      <div className={`compact-scale flex h-screen w-full transition-colors duration-300 ${isDemoMode ? 'pt-16' : ''} ${isDarkMode ? 'text-zinc-100' : 'bg-slate-50 text-slate-900'}`} style={isDarkMode ? { background: '#000000' } : {}}>

        {!isFocusMode && (
            <Sidebar
              currentView={currentView}
              onViewChange={setCurrentView}
              onSettingsTabChange={setSettingsTab}
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
            {currentView === 'notes' && (
              <Notes
                isDarkMode={isDarkMode}
                notes={activeNotes}
                onAddNote={handleAddNote}
                onUpdateNote={handleUpdateNote}
                onDeleteNote={handleDeleteNote}
                onRestoreNote={handleRestoreNote}
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
    </ErrorBoundary>
  );
};

const App: React.FC = () => {
  const handleAnnotationAdd = (_annotation: Annotation) => {};

  return (
    <ToastProvider>
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
