import React from 'react';
import { Menu, ChevronDown } from 'lucide-react';
import { haptic } from '../../lib/haptics';

export type HomeSubTab = 'dashboard' | 'analytics' | 'overview' | 'trades' | 'psychology' | 'compliance' | 'session' | 'comparison' | 'reports' | 'cash';
interface MobileTopHeaderProps {
  isDarkMode?: boolean;
  activeMainTab: string;
  homeSubTab: HomeSubTab;
  onHomeSubTabChange: (tab: HomeSubTab) => void;
  portfolioName?: string;
  onOpenDrawer?: () => void;
  onOpenPortfolioSheet?: () => void;
  onOpenFilter?: () => void;
  onOpenCalendarShortcut?: () => void;
  onToggleCurrency?: () => void;
  currencySymbol?: string;
}

export const MobileTopHeader: React.FC<MobileTopHeaderProps> = ({
  activeMainTab,
  homeSubTab,
  onHomeSubTabChange,
  portfolioName = 'Default Portfolio',
  onOpenDrawer,
  onOpenPortfolioSheet,
  onOpenFilter,
  onToggleCurrency,
}) => {
  const isHome = activeMainTab === 'dashboard' || activeMainTab === 'home';

  return (
    <header className="sticky top-0 z-40 bg-[#000000]/95 border-b border-zinc-800/80 backdrop-blur-xl select-none safe-area-inset-top">
      {/* Top Bar: Hamburger, Portfolio Selector, Actions */}
      <div className="flex items-center justify-between px-3.5 pt-3 pb-2.5">
        {/* Left: Drawer button */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              try { haptic.light(); } catch {}
              onOpenDrawer?.();
            }}
            aria-label="Open menu"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-zinc-300 hover:text-white active:scale-95 transition-all"
          >
            <Menu size={19} strokeWidth={2.2} />
          </button>
        </div>

        {/* Center: Portfolio Selector — opens the bottom sheet */}
        <button
          onClick={() => {
            try { haptic.selection(); } catch {}
            if (onOpenPortfolioSheet) onOpenPortfolioSheet();
            else onOpenDrawer?.();
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-transparent active:bg-zinc-900/60 transition-all"
        >
          <span className="text-[15px] font-black tracking-tight text-white">{portfolioName}</span>
          <ChevronDown size={16} className="text-zinc-400" strokeWidth={2.5} />
        </button>

        {/* Right spacer (keeps portfolio centered) */}
        <div className="w-9" />
      </div>

      {/* Sub Navigation Tabs */}
      {isHome && (
        <div className="flex items-center gap-1.5 px-3 pb-2.5 overflow-x-auto no-scrollbar snap-x snap-mandatory overscroll-x-contain touch-pan-x scroll-smooth">
          {[
            { id: 'dashboard' as const, label: 'Dashboard' },
            { id: 'overview' as const, label: 'Overview' },
            { id: 'trades' as const, label: 'Trade Analysis' },
            { id: 'psychology' as const, label: 'Psychology' },
            { id: 'compliance' as const, label: 'Rules Compliance' },
            { id: 'session' as const, label: 'Session' },
            { id: 'comparison' as const, label: 'Reports' },
            { id: 'reports' as const, label: 'Comparison' },
            { id: 'cash' as const, label: 'Transactions' },
          ].map((tab) => {
            const isActive = homeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  try { haptic.selection(); } catch {}
                  onHomeSubTabChange(tab.id);
                }}
                className={`shrink-0 snap-start px-3.5 py-1.5 rounded-xl text-[12.5px] font-bold whitespace-nowrap transition-all touch-manipulation ${
                  isActive
                    ? 'bg-[#FF4F01] text-white shadow-[0_2px_12px_rgba(255,79,1,0.35)]'
                    : 'text-zinc-400 hover:text-zinc-200 bg-zinc-900/60 hover:bg-zinc-800/80 border border-zinc-800/60'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
};
