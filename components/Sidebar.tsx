
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
  IconRadio
} from '@tabler/icons-react';
import { UserProfile, Trade, EASession } from '../types';
import { useToast } from './ui/Toast';
import { APP_CONSTANTS, PLAN_FEATURES, normalizePlan } from '../lib/constants';
import { FloatingDock } from './ui/floating-dock';
import { AnimatePresence, motion } from 'motion/react';

interface SidebarProps {
  currentView: string;
  onViewChange: (view: string) => void;
  onSettingsTabChange?: (tab: 'profile' | 'account' | 'appearance' | 'billing' | 'security' | 'help') => void;
  isDarkMode: boolean;
  onOpenQuickLog: () => void;
  onLogout: () => void;
  userProfile?: UserProfile | null;
  trades?: Trade[];
  eaSession?: EASession | null;
  offlineQueueCount?: number;
  isDemoMode?: boolean;
  onToggleDemoMode?: () => void;
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
  eaSession,
  offlineQueueCount = 0,
  isDemoMode = false,
  onToggleDemoMode,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationRef = useRef<HTMLDivElement>(null);

  const currentPlan = normalizePlan(userProfile?.plan);
  const isBasicTier = !PLAN_FEATURES[currentPlan].advancedAnalytics;

  const { notifications, unreadCount, clearNotifications, markNotificationsRead } = useToast();

  const tradeCount = trades.length;

  // Bridge Health Logic
  const [isBridgeOnline, setIsBridgeOnline] = useState(false);

  useEffect(() => {
    const checkHealth = () => {
      if (!userProfile?.eaConnected || !eaSession?.last_updated) {
        setIsBridgeOnline(false);
        return;
      }

      // Check explicit heartbeat flag from bridge for instant reaction
      if (eaSession.data?.isHeartbeat === false) {
        setIsBridgeOnline(false);
        return;
      }

      const lastUpdate = new Date(eaSession.last_updated).getTime();
      const now = new Date().getTime();
      const diffSeconds = (now - lastUpdate) / 1000;

      // Use a shorter 15s threshold for better accuracy
      setIsBridgeOnline(diffSeconds < 15);
    };

    checkHealth();
    const interval = setInterval(checkHealth, 2000); // Check every 2s for better responsiveness
    return () => clearInterval(interval);
  }, [eaSession, userProfile?.eaConnected]);

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

  const menuItems = [
    { id: 'dashboard', icon: <IconLayoutDashboard size={18} />, label: 'Dashboard', description: 'Overview of your trading performance' },
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
    { id: 'ea-setup', icon: <IconLink size={18} />, label: 'Desktop Bridge', restricted: true, description: 'Connect MetaTrader EA' },
    { id: 'charts', icon: <IconChartCandle size={18} />, label: 'Market Grid', restricted: true, description: 'Multi-chart analysis view' },
    { id: 'backtest-lab', icon: <IconFlask size={18} />, label: 'Backtest Lab', restricted: true, description: 'Test strategies historically' },
    { id: 'ai-chat', icon: <IconMessage size={18} />, label: 'AI Assistant', description: 'Get AI trading insights' },
  ];

  const filteredMenuItems = menuItems.filter(item => {
    if (item.id === 'log-trade' && !isBasicTier) return false;

    return true;
  });

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
      <style>{`
        @keyframes heartbeat {
            0% { transform: scale(1); opacity: 0.6; }
            15% { transform: scale(1.1); opacity: 1; }
            30% { transform: scale(1); opacity: 0.6; }
            45% { transform: scale(1.15); opacity: 1; }
            60% { transform: scale(1); opacity: 0.6; }
            100% { transform: scale(1); opacity: 0.6; }
        }
        @keyframes pulse-line {
            0% { stroke-dashoffset: 100; opacity: 0.4; }
            20% { stroke-dashoffset: 0; opacity: 1; }
            40% { stroke-dashoffset: -100; opacity: 0.4; }
            100% { stroke-dashoffset: -100; opacity: 0.4; }
        }
      `}</style>

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

      <div className="flex items-center w-full mb-4 px-[18px] shrink-0 justify-start">
        <button
          type="button"
          onClick={() => {
            onToggleDemoMode?.();
          }}
          className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-xl overflow-hidden relative shrink-0"
          title={isDemoMode ? 'Exit demo mode' : 'Enter demo mode'}
        >
          {userProfile?.avatarUrl ? (
            <img src={userProfile.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
          ) : (
            <UserCircle size={28} />
          )}
        </button>
        <AnimatePresence mode="popLayout">
          {isExpanded && (
            <motion.div 
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
              className="ml-3 flex flex-col gap-1 overflow-hidden whitespace-nowrap"
            >
              <div className="flex flex-col">
                <div className={`text-[9px] font-black uppercase tracking-widest leading-none ${isDemoMode ? 'text-amber-500' : isBridgeOnline ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {isDemoMode ? 'Demo Mode' : 'Live Status'}
                </div>
                <div className="text-[11px] font-bold mt-0.5">
                  {isDemoMode ? 'Sample data active' : (isBridgeOnline ? 'Bridge Active' : (userProfile?.eaConnected ? 'Bridge Offline' : 'Disconnected'))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Main Navigation */}
      <motion.nav 
        layout="position"
        className="flex-1 flex flex-col justify-center w-full overflow-y-visible px-[18px]"
      >
        <div className="w-full">
          <FloatingDock
            items={filteredMenuItems.map(item => ({
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
              type: 'item' as const
            }))}
            desktopClassName="bg-transparent border-none px-0"
            showLabels={isExpanded}
          />
        </div>
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
