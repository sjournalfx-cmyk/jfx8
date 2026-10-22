import React, { useState, useMemo, useEffect, useRef, Suspense } from 'react';
import { Trade, UserProfile, DailyBias, EASession, Note, Goal, Portfolio, CashTransaction } from '../../types';
import { type PsychologyInsightsEntry } from '../../lib/psychologyInsights';
import { MobileTopHeader, HomeSubTab } from './MobileTopHeader';
import { MobileDashboardView } from './views/MobileDashboardView';
import { MobileAnalyticsView } from './views/MobileAnalyticsView';
import { MobileNav } from '../ui/MobileNav';
import { MobileDrawer } from './MobileDrawer';
import { MobilePortfoliosView } from './MobilePortfoliosView';
import { MobilePortfolioSheet } from './MobilePortfolioSheet';
import { MobileFilterModal, MobileFilterState } from './MobileFilterModal';
import Journal from './journal/Journal';
import Notes from './notebook/Notes';
import LogTrade from '../LogTrade';
import { CtraderLogTradeTabs } from './CtraderLogTradeTabs';
import EASetup from '../EASetup';
import Settings from '../Settings';
import { ChevronLeft } from 'lucide-react';
import QuickLogModal from '../QuickLogModal';
import { ChecklistBuilder } from '../discipline/ChecklistBuilder';
import { TradingLocks } from '../discipline/TradingLocks';
import { BrandedLoader } from '../ui/BrandedLoader';
import { safeLazy } from '../../lib/safeLazy';

const BacktestLab = safeLazy(() => import('../BacktestLab'));
// Code-split: the AI chat (and its markdown + generative-UI deps) loads only
// when the user opens it, instead of riding in the main bundle. App.tsx
// already lazy-loads it; this static import was defeating that split.
const AIChat = safeLazy(() => import('../AIChat'));

interface MobileLayoutProps {
  currentView: string;
  onViewChange: (view: string) => void;
  trades: Trade[];
  notes: Note[];
  goals?: Goal[];
  dailyBias: DailyBias[];
  userProfile: UserProfile;
  userEmail?: string | null;
  eaSession?: EASession | null;
  lastKnownBridgeBalance?: import('../../lib/bridgeBalance').StoredBridgeBalance | number | null;
  isBridgeOnline?: boolean;
  isDemoMode?: boolean;
  onToggleDemoMode?: () => void;
  onLogout?: () => void;
  onAddTrade: (trade: Trade) => void | Promise<void> | Promise<import('../../lib/saveReceipt').AddTradeOutcome>;
  onBrokerTradeAdded?: (trade: Trade) => void;
  onUpdateTrade: (trade: Trade) => void | Promise<void>;
  onBatchUpdateTrades: (trades: Trade[]) => Promise<boolean>;
  onTradesAddedBatch?: (trades: Trade[]) => void;
  onTradesDeletedBatch?: (tradeIds: string[]) => void;
  onDeleteTrades: (tradeIds: string[]) => void;
  onEditTrade: (trade: Trade) => void;
  onAddNote: (note: any) => Promise<any>;
  onUpdateNote: (note: any) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onRestoreNote: (noteId: string) => Promise<void>;
  onUpdateProfile: (profile: any) => Promise<any>;
  isDarkMode?: boolean;
  userId?: string;
  offlineQueue?: Trade[];
  onAddOffline?: (trade: Trade) => void;
  onBatchAddTrades?: (trades: Trade[]) => Promise<void>;
  editingTrade?: Trade | null;
  onClearEditingTrade?: () => void;
  portfolios?: Portfolio[];
  activePortfolioId?: string | null;
  defaultPortfolioId?: string | null;
  canAddPortfolio?: boolean;
  tradeCounts?: Record<string, number>;
  onSelectPortfolioId?: (id: string) => void;
  onAddPortfolio?: (input: { name: string; description?: string; purpose?: Portfolio['purpose']; source?: Portfolio['source']; startingBalance?: number; currency?: string }) => Promise<Portfolio>;
  onRemovePortfolio?: (id: string) => Promise<void>;
  onLinkPortfolioAccount?: (portfolioId: string, account: { provider: string; externalAccountId?: string }) => Promise<void> | void;
  linkCollisionCheck?: (provider: string, externalAccountId: string, excludeId?: string) => Portfolio | null;
  settingsInitialTab?: 'profile' | 'account' | 'appearance' | 'billing' | 'security' | 'developer-tools' | 'help';
  portfolioBalances?: Record<string, number>;
  tradesThisMonth?: number;
  maxTradesPerMonth?: number;
  totalNotes?: number;
  totalImages?: number;
  tradesCount?: number;
  onDeduplicate?: () => Promise<void>;
  migrationVersion?: string;
  dailyPsychologyInsights?: PsychologyInsightsEntry | null;
  onRefreshPsychologyInsights?: () => void;
  isRefreshingPsychologyInsights?: boolean;
  psychologyAnalyzeLimitReached?: boolean;
  cashTransactions?: CashTransaction[];
  activePortfolio?: Portfolio | null;
  activeInitialBalance?: number;
  currentBalance?: number;
  liveBalanceSource?: 'bridge' | 'ctrader' | null;
  isLiveBalance?: boolean;
  /** Linked/selected cTrader account id (App resolves link -> selected fallback). */
  ctraderAccountId?: string | null;
}

export const MobileLayout: React.FC<MobileLayoutProps> = ({
  currentView,
  onViewChange,
  trades,
  notes,
  goals = [],
  dailyBias,
  userProfile,
  userEmail,
  eaSession,
  lastKnownBridgeBalance,
  isBridgeOnline,
  isDemoMode,
  onToggleDemoMode,
  onLogout,
  onAddTrade,
  onBrokerTradeAdded,
  onUpdateTrade,
  onBatchUpdateTrades,
  onTradesAddedBatch,
  onTradesDeletedBatch,
  onDeleteTrades,
  onEditTrade,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  onRestoreNote,
  onUpdateProfile,
  userId,
  offlineQueue = [],
  onAddOffline,
  onBatchAddTrades,
  editingTrade,
  onClearEditingTrade,
  portfolios,
  activePortfolioId,
  defaultPortfolioId,
  canAddPortfolio = true,
  tradeCounts,
  onSelectPortfolioId,
  onAddPortfolio,
  onRemovePortfolio,
  onLinkPortfolioAccount,
  linkCollisionCheck,
  portfolioBalances,
  settingsInitialTab = 'profile',
  tradesThisMonth = 0,
  maxTradesPerMonth,
  totalNotes = 0,
  totalImages = 0,
  tradesCount = 0,
  onDeduplicate,
  migrationVersion,
  dailyPsychologyInsights = null,
  onRefreshPsychologyInsights,
  isRefreshingPsychologyInsights = false,
  psychologyAnalyzeLimitReached = false,
  cashTransactions = [],
  activePortfolio: activePortfolioProp,
  activeInitialBalance,
  currentBalance,
  liveBalanceSource = null,
  isLiveBalance = false,
  ctraderAccountId = null,
}) => {
  // Sub-tabs
  const [homeSubTab, setHomeSubTab] = useState<HomeSubTab>('dashboard');

  // The single shared scroll container for all mobile views. Tab/view
  // switches only swap children inside it, so reset to top on every switch
  // — otherwise a new tab opens mid-page at the previous tab's position.
  // Deps are tab identity only: data refreshes must never yank scroll.
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [homeSubTab, currentView]);

  // UI state
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isPortfolioSheetOpen, setIsPortfolioSheetOpen] = useState(false);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [isQuickLogOpen, setIsQuickLogOpen] = useState(false);
  const [portfolioName, setPortfolioName] = useState('Default Portfolio');
  const [portfolioCreateSignal, setPortfolioCreateSignal] = useState(0);
  // Settings floating save button: bumped by the FAB, consumed by <Settings saveSignal>.
  const [settingsSaveSignal, setSettingsSaveSignal] = useState(0);
  const [settingsTab, setSettingsTab] = useState('profile');
  const openPortfoliosPage = (create = false) => {
    if (create) setPortfolioCreateSignal(s => s + 1);
    onViewChange('portfolios');
    setIsDrawerOpen(false);
  };
  // When the portfolio store is wired (App passes portfolios), the header +
  // drawer display name derives from the active portfolio instead of local state.
  const storeActiveName = portfolios?.find(p => p.id === activePortfolioId)?.name;
  const displayPortfolioName = storeActiveName || portfolioName;
  const handleSelectPortfolioName = (name: string) => {
    const match = portfolios?.find(p => p.name === name);
    if (match && onSelectPortfolioId) onSelectPortfolioId(match.id);
    else setPortfolioName(name);
  };

  // Filters
  const [filters, setFilters] = useState<MobileFilterState>({
    dateRange: 'all',
    outcome: 'all',
    direction: 'all',
  });

  // Apply filters to trades
  const filteredTrades = useMemo(() => {
    return trades.filter((t) => {
      // Outcome filter
      if (filters.outcome === 'win' && (t.pnl || 0) <= 0) return false;
      if (filters.outcome === 'loss' && (t.pnl || 0) >= 0) return false;

      // Direction filter
      if (filters.direction === 'long' && t.direction !== 'Long') return false;
      if (filters.direction === 'short' && t.direction !== 'Short') return false;

      // Date Range filter
      if (filters.dateRange !== 'all') {
        const tradeDateStr = t.closeTime || t.openTime || t.date;
        if (!tradeDateStr) return false;
        const tradeTime = new Date(tradeDateStr).getTime();
        const now = Date.now();

        if (filters.dateRange === 'today') {
          const todayStart = new Date().setHours(0, 0, 0, 0);
          if (tradeTime < todayStart) return false;
        } else if (filters.dateRange === 'week') {
          const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
          if (tradeTime < weekAgo) return false;
        } else if (filters.dateRange === 'month' || filters.dateRange === '30days') {
          const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
          if (tradeTime < monthAgo) return false;
        }
      }

      return true;
    });
  }, [trades, filters]);

  // Default portfolio IS the Manual + Imports portfolio (source === 'manual').
  // Legacy rows without a source are also treated as manual.
  // Prefer the App-level active portfolio (single source of truth) when provided.
  const activePortfolio = activePortfolioProp ?? portfolios?.find(p => p.id === activePortfolioId) ?? portfolios?.find(p => p.isDefault) ?? portfolios?.[0];
  const activeSource = activePortfolio?.source || 'manual';
  // Manual + cTrader portfolios both log: manual via the journal form, cTrader
  // via the Log Trade / Trade tab switcher. Bridge stays connector-only.
  const showLogTrade = activeSource === 'manual' || activeSource === 'ctrader';
  const isCtraderPortfolio = activeSource === 'ctrader';
  // The portfolio we are currently linking (only non-manual actives need a connect screen).
  const linkPortfolio = activePortfolio && activeSource !== 'manual' ? activePortfolio : null;
  // Create → immediately open the connector so users never wonder "now what?".
  const handleCreatePortfolio: typeof onAddPortfolio = async (input) => {
    if (!onAddPortfolio) throw new Error('Portfolios unavailable right now.');
    const created = await onAddPortfolio(input);
    if ((created.source || 'manual') !== 'manual') {
      onViewChange('ea-setup');
    }
    return created;
  };

  // Main active tab mapping
  const isHomeView = currentView === 'dashboard' || currentView === 'home';
  const isBacktestLabView = currentView === 'backtest-lab';
  const isAiChatView = currentView === 'ai-chat';
  const isLogTradeView = currentView === 'log-trade' || currentView === 'add-trade';
  // True while the cTrader full-screen trade detail is open (from a Quotes row).
  // Hides the global MobileNav island so the detail page owns the screen.
  const [isTradeDetailOpen, setIsTradeDetailOpen] = useState(false);
  // Leaving the log view unmounts the detail — never trap the nav hidden.
  useEffect(() => {
    if (currentView !== 'log-trade' && currentView !== 'add-trade') setIsTradeDetailOpen(false);
  }, [currentView]);
  // True while a Backtest Lab chart is open (welcome menu dismissed).
  // Hides the global MobileDock so the in-chart replay dock replaces it.
  // Reset when leaving the lab so the dock reappears elsewhere.
  const [isBacktestChartOpen, setIsBacktestChartOpen] = useState(false);
  // True while an analytics widget (time heatmap / treemap) holds a fullscreen
  // portal overlay. Hides the global MobileNav island so it can't cover the
  // fullscreen SVG/heatmap (z-index alone isn't enough once ancestors trap
  // fixed positioning). Driven by the `jfx:fullscreen-change` event from
  // useFullscreenLandscape — no prop drilling through Analytics needed.
  const [isWidgetFullscreenOpen, setIsWidgetFullscreenOpen] = useState(false);

  useEffect(() => {
    const onFullscreenChange = (e: Event) => {
      setIsWidgetFullscreenOpen(!!(e as CustomEvent<{ open?: boolean }>).detail?.open);
    };
    window.addEventListener('jfx:fullscreen-change', onFullscreenChange);
    return () => window.removeEventListener('jfx:fullscreen-change', onFullscreenChange);
  }, []);

  useEffect(() => {
    if (!isWidgetFullscreenOpen) return;
    if (typeof document !== 'undefined' && !document.body.classList.contains('jfx-fullscreen-open')) {
      setIsWidgetFullscreenOpen(false);
    }
  }, [isWidgetFullscreenOpen]);

  return (
    <div className="flex flex-col h-screen w-full bg-[#000000] text-zinc-100 overflow-hidden overflow-x-hidden select-none">
      
      {/* 1. Mobile Top Header — hidden on AI chat and Backtest Lab (it has its own header) */}
      {isHomeView && (
        <MobileTopHeader
          activeMainTab={isHomeView ? 'home' : 'backtest-lab'}
          homeSubTab={homeSubTab}
          onHomeSubTabChange={setHomeSubTab}
          portfolioName={displayPortfolioName}
          onOpenDrawer={() => setIsDrawerOpen(true)}
          onOpenPortfolioSheet={() => setIsPortfolioSheetOpen(true)}
          onOpenFilter={() => setIsFilterModalOpen(true)}
          currencySymbol={userProfile?.currencySymbol || '$'}
        />
      )}

      {/* 2. Main Scrollable Content */}
      <main
        ref={mainRef}
        onScroll={(e) => {
          if (e.currentTarget.scrollLeft !== 0) {
            e.currentTarget.scrollLeft = 0;
          }
        }}
        className={`flex-1 overflow-y-auto overflow-x-hidden no-scrollbar overscroll-y-contain ${isAiChatView || isLogTradeView ? 'overflow-hidden' : isBacktestLabView ? 'overflow-hidden flex flex-col' : ''}`}
      >
        {/* HOME VIEW */}
        {isHomeView && (
          <>
            {homeSubTab === 'dashboard' && (
              <MobileDashboardView
                trades={filteredTrades}
                userProfile={userProfile}
                eaSession={eaSession}
                lastKnownBridgeBalance={lastKnownBridgeBalance}
                isBridgeOnline={isBridgeOnline}
                isDemoMode={isDemoMode}
                activePortfolio={activePortfolio}
                defaultPortfolioId={defaultPortfolioId}
                initialBalance={activeInitialBalance}
                currentBalance={currentBalance}
                liveBalanceSource={liveBalanceSource}
                isLiveBalance={isLiveBalance}
                onViewChange={onViewChange}
              />
            )}
            {homeSubTab === 'analytics' && (
              <MobileAnalyticsView
                trades={filteredTrades}
                userProfile={userProfile}
                isDarkMode={true}
                onViewChange={onViewChange}
                eaSession={eaSession}
                lastKnownBridgeBalance={lastKnownBridgeBalance}
                isBridgeOnline={isBridgeOnline}
                isDemoMode={isDemoMode}
                cashTransactions={cashTransactions}
                dailyPsychologyInsights={dailyPsychologyInsights}
                onRefreshPsychologyInsights={onRefreshPsychologyInsights}
                isRefreshingPsychologyInsights={isRefreshingPsychologyInsights}
                psychologyAnalyzeLimitReached={psychologyAnalyzeLimitReached}
              />
            )}
            {/* 9 analytics tabs surfaced at Home top bar — direct render without duplicating inner sticky nav */}
            {(['overview','trades','psychology','compliance','session','comparison','reports','cash'] as const).includes(homeSubTab as any) && (
              <MobileAnalyticsView
                trades={filteredTrades}
                userProfile={userProfile}
                isDarkMode={true}
                onViewChange={onViewChange}
                eaSession={eaSession}
                lastKnownBridgeBalance={lastKnownBridgeBalance}
                isBridgeOnline={isBridgeOnline}
                isDemoMode={isDemoMode}
                activeTabOverride={homeSubTab as any}
                hideTopChrome={true}
                cashTransactions={cashTransactions}
                dailyPsychologyInsights={dailyPsychologyInsights}
                onRefreshPsychologyInsights={onRefreshPsychologyInsights}
                isRefreshingPsychologyInsights={isRefreshingPsychologyInsights}
                psychologyAnalyzeLimitReached={psychologyAnalyzeLimitReached}
              />
            )}
          </>
        )}

        {/* BACKTEST LAB VIEW */}
        {isBacktestLabView && (
          <div className="flex-1 min-h-0 w-full flex flex-col overflow-hidden">
            <Suspense fallback={<BrandedLoader />}>
              <BacktestLab isDarkMode={true} userProfile={userProfile} onUpdateProfile={onUpdateProfile} onChartOpenChange={setIsBacktestChartOpen} />
            </Suspense>
          </div>
        )}

        {/* ADD TRADE VIEW — no outer pb, scroll ends at Back/Continue (inner 20px spacer) */}
        {(currentView === 'log-trade' || currentView === 'add-trade') && (
          <div className="flex-1 min-h-0 flex flex-col">
            {isCtraderPortfolio ? (
              <CtraderLogTradeTabs
                ctidAccountId={ctraderAccountId}
                isDemoMode={isDemoMode}
                onGoConnect={() => onViewChange('ea-setup')}
                currencySymbol={userProfile?.currencySymbol || '$'}
                onDetailOpenChange={setIsTradeDetailOpen}
                portfolioId={activePortfolioId}
                timezone={userProfile?.timezone}
              />
            ) : (
              <LogTrade
                key={editingTrade?.id || 'new-trade'}
                isDarkMode={true}
                onSave={async (t) => {
                  if (editingTrade?.id) {
                    await onUpdateTrade(t);
                    onClearEditingTrade?.();
                    onViewChange('history');
                  } else {
                    // handleAddTrade reports the outcome: a blocked (limit) or
                    // failed save keeps the form open so the trade is never
                    // silently abandoned behind a Dashboard landing.
                    const outcome = await onAddTrade(t);
                    if (outcome === 'blocked-limit' || outcome === 'failed') return;
                    onClearEditingTrade?.();
                    onViewChange('history');
                  }
                }}
                currencySymbol={userProfile?.currencySymbol || '$'}
                trades={trades}
                userProfile={userProfile}
                initialTrade={editingTrade ?? undefined}
                portfolioName={activePortfolio?.name}
                tradesUsedThisMonth={tradesThisMonth}
                maxTradesThisMonth={maxTradesPerMonth}
                onCancel={() => {
                  const wasEditing = !!editingTrade?.id;
                  onClearEditingTrade?.();
                  onViewChange(wasEditing ? 'history' : 'dashboard');
                }}
                isReadOnly={isDemoMode}
              />
            )}
          </div>
        )}

        {/* PORTFOLIOS DEDICATED PAGE */}
        {currentView === 'portfolios' && (
          <div className="pb-20">
            <MobilePortfoliosView
              portfolios={portfolios || []}
              activePortfolioId={activePortfolioId || null}
              defaultPortfolioId={defaultPortfolioId || null}
              canAddPortfolio={canAddPortfolio}
              tradeCounts={tradeCounts}
              startCreatingSignal={portfolioCreateSignal}
              onSelectPortfolioId={(id) => {
                onSelectPortfolioId?.(id);
                // Non-manual portfolios own their connection: tapping one opens
                // its scoped connector (cTrader / Bridge) instead of the
                // dashboard, so users never wonder where "connect" went.
                const picked = (portfolios || []).find(p => p.id === id);
                if (picked && (picked.source || 'manual') !== 'manual') {
                  onViewChange('ea-setup');
                } else {
                  onViewChange('dashboard');
                }
              }}
              onAddPortfolio={handleCreatePortfolio || (async () => { throw new Error('Portfolios unavailable right now.'); })}
              onRemovePortfolio={onRemovePortfolio || (async () => { throw new Error('Portfolios unavailable right now.'); })}
              onBack={() => onViewChange('dashboard')}
            />
          </div>
        )}

        {/* HISTORY / JOURNAL TRADES VIEW */}
        {currentView === 'history' && (
          <div className="pb-20">
            <Journal
              isDarkMode={true}
              trades={filteredTrades}
              onUpdateTrade={onUpdateTrade}
              onBatchUpdateTrades={onBatchUpdateTrades}
              onDeleteTrades={onDeleteTrades}
              onEditTrade={onEditTrade}
              userProfile={userProfile}
              onViewChange={onViewChange}
              offlineQueue={offlineQueue}
              isDemoMode={isDemoMode}
              portfolios={portfolios}
              activePortfolioId={activePortfolioId}
              defaultPortfolioId={defaultPortfolioId}
              activePortfolioName={activePortfolio?.name || displayPortfolioName}
              onSelectPortfolioId={onSelectPortfolioId}
            />
          </div>
        )}

        {/* JOURNAL / NOTES VIEW */}
        {(currentView === 'notes' || currentView === 'journal') && (
          <div className="pb-20">
            <Notes
              isDarkMode={true}
              notes={notes}
              onAddNote={onAddNote}
              onUpdateNote={onUpdateNote}
              onDeleteNote={onDeleteNote}
              onRestoreNote={onRestoreNote}
              userProfile={userProfile}
              onViewChange={onViewChange}
              isDemoMode={isDemoMode}
            />
          </div>
        )}

        {/* EA SETUP / BROKER CONNECT VIEW */}
        {currentView === 'ea-setup' && userId && (
          <div className="pb-20">
            <EASetup
              isDarkMode={true}
              userProfile={userProfile}
              onUpdateProfile={onUpdateProfile}
              eaSession={eaSession}
              isDemoMode={isDemoMode}
              onTradeAdded={onBrokerTradeAdded || onAddTrade}
              onEditTrade={onEditTrade}
              onAddOffline={onAddOffline || (() => {})}
              onImportTrades={onBatchAddTrades || (async () => {})}
              trades={trades}
              userId={userId}
              onNavigateToJournal={() => onViewChange('history')}
              linkPortfolio={linkPortfolio}
              onLinkAccount={onLinkPortfolioAccount}
              linkCollisionCheck={linkCollisionCheck}
              onDoneLink={() => onViewChange('dashboard')}
              activePortfolioId={activePortfolioId}
              defaultPortfolioId={defaultPortfolioId}
              activePortfolioName={activePortfolio?.name || displayPortfolioName}
              onTradesAddedBatch={onTradesAddedBatch}
              onTradesDeletedBatch={onTradesDeletedBatch}
            />
          </div>
        )}

        {/* STRATEGY RULES & CHECKLISTS (Discipline Engine builder) — no bottom nav */}
        {currentView === 'discipline' && (
          <div className="bg-[#000000] min-h-full">
            <div className="sticky top-0 z-30 bg-[#000000]/90 backdrop-blur-xl border-b border-white/[0.06]">
              <div className="relative flex items-center h-14 px-2">
                <button
                  onClick={() => onViewChange('dashboard')}
                  aria-label="Back to home"
                  className="w-10 h-10 rounded-full flex items-center justify-center text-zinc-300 hover:text-white active:scale-95 transition-all"
                >
                  <ChevronLeft size={22} strokeWidth={2.2} />
                </button>
                <h1 className="absolute left-1/2 -translate-x-1/2 text-[13px] font-black tracking-tight text-white pointer-events-none whitespace-nowrap">Rules & Checklists</h1>
              </div>
            </div>
            <div className="px-4 pt-4 pb-8">
              <ChecklistBuilder isDarkMode={true} />
              <TradingLocks
                portfolios={portfolios || []}
                activePortfolioId={activePortfolioId}
                resolveCtraderAccountId={(pid) =>
                  portfolios?.find((p) => p.id === pid)?.accounts?.find((a) => a.provider === 'ctrader')?.externalAccountId ?? null
                }
                timezone={userProfile?.timezone}
              />
            </div>
          </div>
        )}

        {/* SETTINGS VIEW — desktop Settings (Persona, Plan & Billing, Security…) adapted via .mobile-settings CSS */}
        {currentView === 'settings' && (
          <div className="pb-20 bg-[#000000] min-h-full">
            <div className="sticky top-0 z-30 bg-[#000000]/90 backdrop-blur-xl border-b border-white/[0.06]">
              <div className="relative flex items-center h-14 px-2">
                <button
                  onClick={() => onViewChange('dashboard')}
                  aria-label="Back to home"
                  className="w-10 h-10 rounded-full flex items-center justify-center text-zinc-300 hover:text-white active:scale-95 transition-all"
                >
                  <ChevronLeft size={22} strokeWidth={2.2} />
                </button>
                <h1 className="absolute left-1/2 -translate-x-1/2 text-[15px] font-black tracking-tight text-white pointer-events-none">Settings</h1>
              </div>
            </div>
            <div className="mobile-settings">
              <Settings
                isDarkMode={true}
                hiddenTabs={['account', 'appearance', 'help']}
                userProfile={userProfile}
                userEmail={userEmail || undefined}
                onUpdateProfile={onUpdateProfile}
                onLogout={() => onLogout?.()}
                tradesThisMonth={tradesThisMonth}
                totalNotes={totalNotes}
                totalImages={totalImages}
                tradesCount={tradesCount}
                onDeduplicate={onDeduplicate}
                initialTab={settingsInitialTab}
                saveSignal={settingsSaveSignal}
                onSettingsTabChange={setSettingsTab}
                migrationVersion={migrationVersion}
                eaSession={eaSession}
                portfolios={portfolios}
                activePortfolioId={activePortfolioId}
                defaultPortfolioId={defaultPortfolioId}
                canAddPortfolio={canAddPortfolio}
                tradeCounts={tradeCounts}
                onSelectPortfolioId={onSelectPortfolioId}
                onAddPortfolio={onAddPortfolio}
                onRemovePortfolio={onRemovePortfolio}
                userId={userId}
                offlineQueueCount={offlineQueue.length}
              />
            </div>
          </div>
        )}

        {/* AI STRATEGY COPILOT VIEW — full-bleed, no bottom nav, zoomed-out minimal */}
        {currentView === 'ai-chat' && (
          <div className="h-full w-full max-w-full min-w-0 overflow-hidden flex flex-col [zoom:0.92] sm:[zoom:1] origin-top">
            <Suspense fallback={<BrandedLoader />}>
            <AIChat
              isDarkMode={true}
              trades={filteredTrades}
              userProfile={userProfile}
              dailyBias={dailyBias}
              eaSession={eaSession}
              lastKnownBridgeBalance={lastKnownBridgeBalance}
              isBridgeOnline={isBridgeOnline}
              notes={notes}
              goals={goals}
              onBackToHome={() => onViewChange('dashboard')}
              onNavigate={(target) => {
                // Mobile shows analytics as a Home sub-tab, not its own view.
                if (target === 'analytics') {
                  setHomeSubTab('analytics');
                  onViewChange('dashboard');
                  return;
                }
                onViewChange(target);
              }}
            />
            </Suspense>
          </div>
        )}
      </main>

      {/* 3. Bottom Navigation Bar — hidden on AI chat, while a Backtest chart is open (replay dock replaces it), while an analytics fullscreen overlay is open, and while the cTrader trade detail owns the screen */}
      {!isAiChatView && !isWidgetFullscreenOpen && !isTradeDetailOpen && currentView !== 'discipline' && !(isBacktestLabView && isBacktestChartOpen) && (
      <MobileNav
        currentView={currentView}
        onViewChange={(newView) => {
          if (newView === 'home' || newView === 'chats') onViewChange('dashboard');
          else if (newView === 'journal' || newView === 'profile') onViewChange('notes');
          else if (newView === 'contacts') onViewChange('backtest-lab');
          else if (newView === 'settings') onViewChange('history');
          else onViewChange(newView);
        }}
        onOpenQuickLog={() => setIsQuickLogOpen(true)}
        showLogTrade={showLogTrade}
        onSaveSettings={currentView === 'settings' && settingsTab !== 'security' && settingsTab !== 'developer-tools' ? () => setSettingsSaveSignal((s) => s + 1) : undefined}
        hideFab={currentView === 'settings' && (settingsTab === 'security' || settingsTab === 'developer-tools')}
      />
      )}

      {/* 4. Slide-Out Menu Drawer */}
      <MobileDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        userProfile={userProfile}
        userEmail={userEmail}
        isDemoMode={isDemoMode}
        onToggleDemoMode={onToggleDemoMode}
        eaSession={eaSession}
        isBridgeOnline={isBridgeOnline}
        onNavigate={(v) => {
          onViewChange(v);
          setIsDrawerOpen(false);
        }}
        onLogout={onLogout}
        portfolioName={displayPortfolioName}
        onSelectPortfolio={handleSelectPortfolioName}
        portfolios={portfolios}
        activePortfolioId={activePortfolioId}
        defaultPortfolioId={defaultPortfolioId}
        canAddPortfolio={canAddPortfolio}
        tradeCounts={tradeCounts}
        onSelectPortfolioId={onSelectPortfolioId}
        onAddPortfolio={onAddPortfolio}
        onRemovePortfolio={onRemovePortfolio}
        onOpenPortfolios={() => openPortfoliosPage(false)}
        onNewPortfolio={() => openPortfoliosPage(true)}
        activeSource={activeSource}
      />

      {/* 5. Portfolio Bottom Sheet */}
      <MobilePortfolioSheet
        isOpen={isPortfolioSheetOpen}
        onClose={() => setIsPortfolioSheetOpen(false)}
        portfolios={portfolios || []}
        activePortfolioId={activePortfolioId || null}
        defaultPortfolioId={defaultPortfolioId || null}
        tradeCounts={tradeCounts}
        balances={portfolioBalances}
        currencySymbol={userProfile?.currencySymbol || '$'}
        onSelect={(id) => onSelectPortfolioId?.(id)}
        onManagePortfolios={() => {
          setIsPortfolioSheetOpen(false);
          onViewChange('portfolios');
          setIsDrawerOpen(false);
        }}
      />

      {/* 6. Filter Modal */}
      <MobileFilterModal
        isOpen={isFilterModalOpen}
        onClose={() => setIsFilterModalOpen(false)}
        filters={filters}
        onApplyFilters={setFilters}
      />

      {/* 7. Quick Log Modal */}
      <QuickLogModal
        isOpen={isQuickLogOpen}
        onClose={() => setIsQuickLogOpen(false)}
        onSave={async (t) => {
          const rawOutcome = await onAddTrade(t);
          const outcome = (rawOutcome === undefined ? 'saved' : rawOutcome) as import('../../lib/saveReceipt').AddTradeOutcome;
          // A blocked or failed save keeps the form open so the trade is
          // never silently abandoned behind a closed modal.
          if (outcome === 'blocked-limit' || outcome === 'failed') return outcome;
          setIsQuickLogOpen(false);
          return outcome;
        }}
        isDarkMode={true}
        currencySymbol={userProfile?.currencySymbol || '$'}
        tradesUsedThisMonth={tradesThisMonth}
        maxTradesThisMonth={maxTradesPerMonth}
      />

    </div>
  );
};
