
import React, { useState, useRef, useEffect } from 'react';
import {
  LayoutDashboard, PlusCircle, History, BarChart2,
  Target, StickyNote,
  Workflow, ChevronRight, CandlestickChart, LogOut,
  Settings, Link, Activity, Lock, Bell, X, CheckCircle2, AlertCircle, AlertTriangle, Info, Trash2, Globe, Medal, UserCircle
 } from 'lucide-react';
import {
  IconPower,
  IconBell,
  IconMoon,
  IconSun,
  IconSettings,
  IconLayoutDashboard,
  IconPlus,
  IconNotebook,
  IconChartBar,
  IconFileText,
  IconWorld,
  IconLink,
  IconChartCandle,
  IconGitMerge,
  IconTargetArrow,
  IconMessage,
  IconTerminal2,
  IconFlask,
  IconRadio,
  IconWallet
} from '@tabler/icons-react';
import { UserProfile, Trade } from '../types';
import { useToast } from './ui/Toast';
import { APP_CONSTANTS, PLAN_FEATURES, normalizePlan } from '../lib/constants';
import { desktopTradingNavItems } from '../lib/desktopTradingRoutes';
import { DESKTOP_BRIDGE_ENABLED } from '../config/features';
import { FloatingDock } from './ui/floating-dock';
import { AnimatePresence, motion } from 'motion/react';

interface SidebarProps {
  currentView: string;
  onViewChange: (view: string) => void;
  onSettingsTabChange?: (tab: 'profile' | 'account' | 'appearance' | 'billing' | 'security' | 'developer-tools' | 'help') => void;
  isDarkMode: boolean;
  onOpenQuickLog: () => void;
  onLogout: () => void;
  userProfile?: UserProfile | null;
  trades?: Trade[];
  offlineQueueCount?: number;
  isDemoMode?: boolean;
  onToggleDemoMode?: () => void;
  /**
   * Source of the active portfolio. Broker/bridge connections belong to a
   * cTrader or Desktop Bridge portfolio, so Connect cTrader is disabled on
   * Manual portfolios. Omitted (undefined) leaves the item enabled so the
   * sidebar still works in any context that has no portfolio store wired.
   */
  activePortfolioSource?: 'manual' | 'ctrader' | 'bridge';
  /** Shows the live-trading nav group when a cTrader account is linked. */
  hasCtraderAccount?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onViewChange,
  onSettingsTabChange,
  isDarkMode,
  onOpenQuickLog,
  onLogout,
  userProfile,
  trades = [],
  offlineQueueCount = 0,
  isDemoMode = false,
  onToggleDemoMode,
  activePortfolioSource,
  hasCtraderAccount = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationRef = useRef<HTMLDivElement>(null);

  const currentPlan = normalizePlan(userProfile?.plan);
  const isBasicTier = !PLAN_FEATURES[currentPlan].advancedAnalytics;
  // Same rule as the mobile drawer: only cTrader / Desktop Bridge portfolios
  // own a broker connection. Treat an unknown source as manual so the gate is
  // never silently open.
  const connectionsDisabled = (activePortfolioSource ?? 'manual') === 'manual';

  const { notifications, unreadCount, clearNotifications, markNotificationsRead } = useToast();

  // Close notifications on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };
    if (showNotifications) {
      document.addEventListener('mousedown', handleClickOutside);
    };
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showNotifications]);

  useEffect(() => {
    if (showNotifications) {
      markNotificationsRead();
    }
  }, [markNotificationsRead, showNotifications]);

  const tradingItems = desktopTradingNavItems(hasCtraderAccount).map((item) => ({
    id: item.id,
    icon:
      item.id === 'trade' ? <Activity size={18} /> :
      item.id === 'quotes' ? <Globe size={18} /> :
      item.id === 'live-chart' ? <CandlestickChart size={18} /> :
      <Lock size={18} />,
    label: item.label,
    description: item.description,
  }));

  const menuItems = [
    { id: 'dashboard', icon: <IconLayoutDashboard size={18} />, label: 'Dashboard', description: 'Overview of your trading performance' },
    { id: 'ea-setup', icon: <IconLink size={18} />, label: 'Connect cTrader', restricted: true, description: 'Connect your cTrader account' },
    { id: 'log-trade', icon: <IconPlus size={18} />, label: 'Log Trade', description: 'Record a new trade entry' },
    { 
      id: 'history', 
      icon: (
        <div className="relative">
          <IconNotebook size={18} />
          {offlineQueueCount > 0 && (
            <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-indigo-500 rounded-full border border-white dark:border-[#000000] animate-pulse" />
          )}
        </div>
      ), 
      label: 'Journal',
      description: 'View and manage trade history'
    },
    { id: 'analytics', icon: <IconChartBar size={18} />, label: 'Analytics', description: 'Deep dive into your statistics' },
    { id: 'notes', icon: <IconFileText size={18} />, label: 'Notebook', description: 'Trading notes and strategies' },
    { id: 'portfolios', icon: <IconWallet size={18} />, label: 'Portfolios', description: 'Journals, connections and stats per portfolio' },
    { id: 'charts', icon: <IconChartCandle size={18} />, label: 'Market Grid', restricted: true, description: 'Multi-chart analysis view' },
    { id: 'backtest-lab', icon: <IconFlask size={18} />, label: 'Backtest Lab', restricted: true, description: 'Test strategies historically' },
    { id: 'ai-chat', icon: <IconMessage size={18} />, label: 'AI Assistant', description: 'Get AI trading insights' },
    ...tradingItems,
  ];

  // Section grouping for the primary nav. Ids must match `menuItems`; the
  // log-trade gate (hidden for non-basic tiers) still applies per item.
  const menuGroups: { label: string; ids: string[] }[] = [
    { label: 'Trade', ids: ['dashboard', 'log-trade', 'history', 'ea-setup'] },
    { label: 'Live Trading', ids: tradingItems.map((item) => item.id) },
    { label: 'Review', ids: ['analytics', 'notes', 'portfolios'] },
    { label: 'Tools', ids: ['charts', 'backtest-lab', 'ai-chat'] },
  ];

  const filteredMenuIds = menuItems
    .filter(item => item.id !== 'log-trade' || isBasicTier)
    .map(item => item.id);

  const systemItems = [
    {
      id: 'notifications',
      icon: <IconBell size={18} />,
      label: 'Notifications',
      description: unreadCount > 0 ? `${unreadCount} unread alerts` : 'No new notifications',
      onClick: () => setShowNotifications((prev) => !prev),
      badge: unreadCount > 0,
      isActive: showNotifications,
      secondaryAction: notifications.length > 0 ? {
        label: 'Clear All',
        onClick: clearNotifications
      } : undefined
    },
    {
      id: 'settings',
      icon: <IconSettings size={18} />,
      label: 'Settings',
      description: 'Manage your account & preferences',
      onClick: () => {
        onSettingsTabChange?.('profile');
        onViewChange('settings');
      },
      isActive: currentView === 'settings'
    },
  ];

  return (
    <motion.div 
      layout="position"
      className={`h-full flex flex-col py-4 border-r z-[100] relative transition-colors duration-300 ${isDarkMode
        ? 'bg-[#000000] border-zinc-800 shadow-[4px_0_24px_rgba(0,0,0,0.5)]'
        : 'bg-white border-slate-200 shadow-[4px_0_24px_rgba(0,0,0,0.02)]'
        }`}
      style={{ width: isExpanded ? 240 : 72 }}
    >
      {/* Notification Menu */}
      <div
        ref={notificationRef}
        aria-hidden={!showNotifications}
        className={`absolute left-full ml-4 bottom-24 w-80 max-h-[500px] flex flex-col rounded-3xl border shadow-2xl z-[200] overflow-hidden transition-all duration-200 origin-bottom-left ${
          showNotifications
            ? 'opacity-100 translate-x-0 scale-100 pointer-events-auto'
            : 'opacity-0 -translate-x-2 scale-95 pointer-events-none'
        } ${isDarkMode ? 'bg-[#000000] border-zinc-800 shadow-black/50' : 'bg-white border-slate-200 shadow-slate-200/50'}`}
      >
        {showNotifications && (
          <>
            <div className={`p-5 border-b flex items-center justify-between ${isDarkMode ? 'border-zinc-800 bg-black/50' : 'border-slate-100 bg-slate-50/50'}`}>
              <div>
                <h3 className="text-sm font-black uppercase tracking-widest">Notifications</h3>
                <p className="text-[10px] font-bold opacity-40 uppercase tracking-widest mt-0.5">{notifications.length} recent alerts</p>
              </div>
              {notifications.length > 0 && (
                <button
                  onClick={clearNotifications}
                  className="p-2 rounded-xl bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 transition-all text-[10px] font-black uppercase tracking-widest"
                >
                  Clear All
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
              {notifications.length > 0 ? (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`p-4 rounded-2xl border flex items-start gap-3 transition-all hover:scale-[1.02] ${isDarkMode ? 'bg-black/30 border-zinc-800 hover:border-zinc-700' : 'bg-slate-50 border-slate-100 hover:border-slate-200'
                      }`}
                  >
                    <div className={`mt-0.5 p-1.5 rounded-lg ${n.type === 'success' ? 'bg-emerald-500/10 text-emerald-500' :
                      n.type === 'error' ? 'bg-rose-500/10 text-rose-500' :
                        n.type === 'warning' ? 'bg-amber-500/10 text-amber-500' :
                          'bg-indigo-500/10 text-indigo-500'
                      }`}>
                      {n.type === 'success' && <CheckCircle2 size={14} />}
                      {n.type === 'error' && <AlertCircle size={14} />}
                      {n.type === 'warning' && <AlertTriangle size={14} />}
                      {n.type === 'info' && <Info size={14} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-xs font-bold leading-tight">{n.title}</h4>
                        <span className="text-[9px] font-medium opacity-40 whitespace-nowrap">
                          {new Date(n.timestamp).toDateString() === new Date().toDateString() 
                            ? new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : new Date(n.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                      {n.message && <p className="text-[10px] opacity-60 mt-1 leading-relaxed">{n.message}</p>}
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-12 flex flex-col items-center justify-center text-center opacity-30">
                  <IconBell size={32} className="mb-3" />
                  <p className="text-[10px] font-black uppercase tracking-widest">Inbox is empty</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Toggle Button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`absolute -right-3 top-12 w-6 h-6 rounded-full border flex items-center justify-center transition-all z-50 ${isDarkMode ? 'bg-black border-zinc-800 text-zinc-400 hover:text-white' : 'bg-white border-slate-200 text-slate-500 hover:text-slate-900 shadow-sm'}`}
      >
        <ChevronRight size={14} className={`${isExpanded ? 'rotate-180' : ''}`} />
      </button>

      <div className="flex flex-col items-center w-full mb-4 px-[18px] shrink-0">
        <div
          className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-xl overflow-hidden relative shrink-0 pointer-events-none select-none"
          aria-hidden="true"
        >
          {userProfile?.avatarUrl ? (
            <img src={userProfile.avatarUrl} alt="" className="w-full h-full object-cover" draggable={false} />
          ) : (
            <UserCircle size={28} />
          )}
        </div>
        <button
          type="button"
          onClick={() => onToggleDemoMode?.()}
          className={`mt-1.5 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest transition-all text-zinc-500 hover:text-zinc-300 border border-transparent`}
        >
          {isDemoMode ? 'Exit Demo' : 'Try Demo'}
        </button>
      </div>

      {/* Main Navigation */}
      <motion.nav 
        layout="position"
        className="flex-1 flex flex-col justify-center w-full overflow-y-visible px-[18px] gap-3"
      >
        {menuGroups.map(group => {
          const groupItems = group.ids
            .filter(id => filteredMenuIds.includes(id))
            .map(id => menuItems.find(item => item.id === id))
            .filter((item): item is typeof menuItems[number] => Boolean(item));
          if (groupItems.length === 0) return null;
          return (
            <div key={group.label} className="w-full">
              {isExpanded && (
                <p className={`px-2 mb-1 text-[9px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-600' : 'text-slate-400'}`}>
                  {group.label}
                </p>
              )}
              <FloatingDock
                items={groupItems.map(item => ({
                  title: item.label,
                  description: item.description,
                  icon: (
                    <div className="relative">
                      {item.icon}
                      {isBasicTier && item.restricted && (
                        <div className="absolute -top-1.5 -right-1.5 bg-[#FF4F01] rounded-full p-0.5 shadow-sm">
                          <Lock size={8} fill="white" className="text-white" />
                        </div>
                      )}
                      {item.id === 'ea-setup' && !isBasicTier && userProfile?.syncMethod === 'EA_CONNECT' && !userProfile?.eaConnected && (
                        <div className="absolute w-1.5 h-1.5 bg-rose-500 rounded-full border border-white dark:border-[#000000] animate-bounce -top-0.5 -right-0.5" />
                      )}
                    </div>
                  ),
                  onClick: () => onViewChange(item.id),
                  isActive: currentView === item.id,
                  isLocked: isBasicTier && item.restricted,
                  isDisabled: item.id === 'ea-setup' && connectionsDisabled,
                  disabledReason: item.id === 'ea-setup' && connectionsDisabled
                    ? (DESKTOP_BRIDGE_ENABLED ? 'Needs a cTrader or Desktop Bridge portfolio' : 'Select a cTrader portfolio to connect')
                    : undefined,
                  type: 'item' as const
                }))}
                desktopClassName="bg-transparent border-none px-0"
                showLabels={isExpanded}
              />
            </div>
          );
        })}
      </motion.nav>

      {/* System Actions (Bottom Fixed) */}
      <motion.div 
        layout="position"
        className="mt-auto w-full px-[18px] pt-4 border-t border-dashed border-zinc-200 dark:border-zinc-800/50"
      >
        <FloatingDock
          items={systemItems.map(item => ({
            title: item.label,
            description: item.description,
            icon: item.icon,
            onClick: item.onClick,
            isActive: item.isActive,
            badge: item.badge,
            secondaryAction: item.secondaryAction,
            type: 'item' as const
          }))}
          desktopClassName="bg-transparent border-none px-0"
          showLabels={isExpanded}
        />

      </motion.div>
    </motion.div>
  );
};

export default Sidebar;
