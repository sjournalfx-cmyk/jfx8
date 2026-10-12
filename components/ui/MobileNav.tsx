import React from 'react';
import { Home, Sparkles, History, BookOpen, Plus, FileText, Save } from 'lucide-react';
import { IconFlask } from '@tabler/icons-react';
import { haptic } from '../../lib/haptics';

export type MainMobileTab = 'home' | 'backtest-lab' | 'history' | 'journal' | 'log-trade';

interface MobileNavItem {
  id: 'home' | 'backtest-lab' | 'history' | 'journal' | 'log-trade';
  icon: React.ElementType;
  label: string;
  mappedView: string;
}

interface MobileNavProps {
  isDarkMode?: boolean;
  currentView: string;
  onViewChange: (view: string) => void;
  onOpenQuickLog?: () => void;
  showLogTrade?: boolean;
  /** Settings view only: when provided, the floating action button becomes Save. */
  onSaveSettings?: () => void;
  /** When true, the floating action button above the island is hidden entirely. */
  hideFab?: boolean;
}

export const MobileNav: React.FC<MobileNavProps> = ({ currentView, onViewChange, onOpenQuickLog, showLogTrade = false, onSaveSettings, hideFab = false }) => {
  const baseItems: MobileNavItem[] = [
    { id: 'home', icon: Home, label: 'Home', mappedView: 'dashboard' },
    { id: 'history', icon: History, label: 'History', mappedView: 'history' },
    { id: 'backtest-lab', icon: IconFlask, label: 'Lab', mappedView: 'backtest-lab' },
    { id: 'journal', icon: BookOpen, label: 'Journal', mappedView: 'notes' },
  ];
  // Log button for manual + cTrader portfolios — inserted between History and Lab so order stays Home | History | Log | Lab | Journal
  const navItems: MobileNavItem[] = showLogTrade
    ? [baseItems[0], baseItems[1], { id: 'log-trade', icon: Plus, label: 'Log', mappedView: 'log-trade' }, baseItems[2], baseItems[3]]
    : baseItems;

  const getIsActive = (item: MobileNavItem) => {
    if (item.id === 'home') {
      return currentView === 'home' || currentView === 'dashboard' || currentView === 'chats';
    }
    if (item.id === 'backtest-lab') {
      return currentView === 'backtest-lab';
    }
    if (item.id === 'history') {
      return currentView === 'history' || currentView === 'settings';
    }
    if (item.id === 'log-trade') {
      return currentView === 'log-trade' || currentView === 'add-trade';
    }
    if (item.id === 'journal') {
      return currentView === 'journal' || currentView === 'notes' || currentView === 'profile';
    }
    return false;
  };

  return (
    <div className="jfx-mobile-nav fixed bottom-0 left-0 right-0 z-[100] pointer-events-none select-none safe-area-inset-bottom pb-10">
      {/* Floating action button above the Island Bar — Save on Settings, AI Copilot elsewhere */}
      {!hideFab && (
      <div className="flex justify-end px-5 mb-3 pointer-events-auto">
        {currentView === 'settings' && onSaveSettings ? (
          <button
            onClick={() => {
              try { haptic.selection(); } catch {}
              onSaveSettings();
            }}
            aria-label="Save Settings"
            className="w-16 h-16 rounded-full bg-[#FF4F01] text-white flex items-center justify-center shadow-[0_12px_40px_rgba(255,79,1,0.45),inset_0_1px_0_rgba(255,255,255,0.15)] active:scale-95 transition-all touch-manipulation"
          >
            <Save size={27} strokeWidth={2.2} className="text-white drop-shadow-sm" />
          </button>
        ) : (
          <button
            onClick={() => {
              try { haptic.selection(); } catch {}
              onViewChange('ai-chat');
            }}
            aria-label="AI Strategy Copilot"
            className="w-16 h-16 rounded-full bg-white/[0.08] backdrop-blur-2xl border border-white/[0.10] text-white flex items-center justify-center shadow-[0_12px_40px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.08)] active:scale-95 transition-all touch-manipulation"
          >
            <Sparkles size={27} strokeWidth={2.2} className="text-white drop-shadow-sm" />
          </button>
        )}
      </div>
      )}

      {/* Floating Liquid Glass Navigation Bar Island — hidden on Settings (focused screen, back chevron owns navigation) */}
      {currentView !== 'settings' && (
      <nav className="mx-2.5 pointer-events-auto">
        <div className="flex items-center justify-between gap-0.5 px-1.5 py-1.5 rounded-[32px] bg-white/[0.08] backdrop-blur-2xl border border-white/[0.10] shadow-[0_12px_40px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.08)]">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = getIsActive(item);
            const isLog = item.id === 'log-trade';

            return (
              <button
                key={item.id}
                onClick={() => {
                  try { haptic.selection(); } catch {}
                  onViewChange(item.mappedView);
                }}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                className={`flex flex-col items-center justify-center gap-1 flex-1 py-2 px-1 rounded-[22px] transition-all min-h-[48px] touch-manipulation ${
                  isActive
                    ? 'bg-[#FF4F01] text-white shadow-[0_2px_12px_rgba(255,79,1,0.35)] font-bold active:scale-95'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Icon size={isLog ? 19 : 18} strokeWidth={isActive ? 2.5 : 2} className={isActive ? 'text-white' : 'text-zinc-400'} />
                <span className={`text-[10px] tracking-tight leading-none ${isActive ? 'font-bold text-white' : 'font-medium text-zinc-400'}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
      )}
    </div>
  );
};

export const MobileQuickActions: React.FC<{ isDarkMode?: boolean; onOpenQuickLog: () => void; onViewChange?: (view: string) => void }> = ({
  onOpenQuickLog,
  onViewChange,
}) => (
  <div className="fixed bottom-24 right-4 z-40">
    <button
      onClick={() => {
        try { haptic.selection(); } catch {}
        if (onViewChange) onViewChange('ai-chat');
        else onOpenQuickLog();
      }}
      aria-label="AI Strategy Copilot"
      className="w-16 h-16 rounded-full bg-white/[0.08] backdrop-blur-2xl border border-white/[0.10] text-white flex items-center justify-center shadow-[0_12px_40px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.08)] active:scale-95 transition-all touch-manipulation"
    >
      <Sparkles size={27} strokeWidth={2.2} className="text-white" />
    </button>
  </div>
);

export const MobilePageHeader: React.FC<{
  isDarkMode?: boolean;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  onBack?: () => void;
}> = ({ title, subtitle, actions, onBack }) => (
  <header className="sticky top-0 z-40 px-4 py-3 border-b backdrop-blur-xl bg-[#000000]/90 border-zinc-800/80">
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        {onBack && (
          <button
            onClick={() => {
              try { haptic.selection(); } catch {}
              onBack();
            }}
            aria-label="Back"
            className="-ml-2 p-2 rounded-xl shrink-0 min-h-[40px] min-w-[40px] flex items-center justify-center active:scale-[0.96] text-zinc-400 active:bg-zinc-900"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <div className="min-w-0">
          <h1 className="text-[17px] font-black tracking-tight leading-none truncate text-white">{title}</h1>
          {subtitle && <p className="text-[11px] font-medium mt-1 leading-none truncate text-zinc-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  </header>
);

export const MobileCard: React.FC<{
  isDarkMode?: boolean;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}> = ({ children, className = '', onClick }) => (
  <div
    onClick={onClick}
    className={`p-4 rounded-2xl border transition-all bg-[#0a0a0a] border-zinc-800/80 shadow-[0_4px_16px_rgba(0,0,0,0.35)] ${
      onClick ? 'cursor-pointer active:scale-[0.98] touch-manipulation' : ''
    } ${className}`}
  >
    {children}
  </div>
);
