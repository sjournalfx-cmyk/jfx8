import React from 'react';
import {
  X, LogOut, Settings, MessageCircle, ChevronRight, Plus
} from 'lucide-react';
import { UserProfile, EASession, Portfolio } from '../../types';
import { haptic } from '../../lib/haptics';

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile?: UserProfile;
  userEmail?: string | null;
  isDemoMode?: boolean;
  onToggleDemoMode?: () => void;
  eaSession?: EASession | null;
  isBridgeOnline?: boolean;
  onNavigate: (view: string) => void;
  onLogout?: () => void;
  portfolioName?: string;
  onSelectPortfolio?: (name: string) => void;
  portfolios?: Portfolio[];
  activePortfolioId?: string | null;
  defaultPortfolioId?: string | null;
  canAddPortfolio?: boolean;
  tradeCounts?: Record<string, number>;
  onSelectPortfolioId?: (id: string) => void;
  onAddPortfolio?: (input: { name: string; description?: string; purpose?: Portfolio['purpose']; source?: Portfolio['source']; startingBalance?: number; currency?: string }) => Promise<Portfolio>;
  onRemovePortfolio?: (id: string) => Promise<void>;
  onOpenPortfolios?: () => void;
  onNewPortfolio?: () => void;
}

export const MobileDrawer: React.FC<MobileDrawerProps> = ({
  isOpen,
  onClose,
  userProfile,
  userEmail,
  isDemoMode,
  onToggleDemoMode,
  eaSession,
  isBridgeOnline,
  onNavigate,
  onLogout,
  portfolioName = 'Default Portfolio',
  onSelectPortfolio,
  portfolios = [],
  activePortfolioId = null,
  defaultPortfolioId = null,
  canAddPortfolio = true,
  tradeCounts,
  onSelectPortfolioId,
  onAddPortfolio,
  onRemovePortfolio,
  onOpenPortfolios,
  onNewPortfolio,
}) => {
  if (!isOpen) return null;

  const drawerPortfolios: Portfolio[] = portfolios.length ? portfolios : [
    { id: 'default', name: portfolioName, description: 'Main Trading Journal', purpose: 'Journal', source: 'manual', isDefault: true, createdAt: '2020-01-01T00:00:00.000Z' },
  ];
  const effectiveActiveId = activePortfolioId || drawerPortfolios.find(p => p.name === portfolioName)?.id || drawerPortfolios[0]?.id || null;

  return (
    <div className="fixed inset-0 z-[200] flex">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/75 backdrop-blur-sm"
        onClick={() => {
          try { haptic.light(); } catch {}
          onClose();
        }} 
      />

      {/* Drawer Panel */}
      <div className="relative w-[85%] max-w-[340px] h-full bg-[#000000] border-r border-[#27272a] flex flex-col z-10 shadow-2xl safe-area-inset-bottom safe-area-inset-top">
        
        {/* Header */}
        <div className="p-4 border-b border-[#27272a] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-white font-black text-lg overflow-hidden shrink-0">
              {userProfile?.avatarUrl ? (
                <img src={userProfile.avatarUrl} alt="" className="w-full h-full object-cover" draggable={false} />
              ) : (
                <>{userProfile?.name?.charAt(0) || userEmail?.charAt(0) || 'J'}</>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white truncate">{userProfile?.name || 'Trader'}</p>
              <p className="text-[11px] text-zinc-400 truncate">{userEmail || 'trader@jfx-journal.io'}</p>
            </div>
          </div>
          <button
            onClick={() => {
              try { haptic.light(); } catch {}
              onClose();
            }}
            className="w-8 h-8 rounded-xl bg-[#000000] text-zinc-400 hover:text-white flex items-center justify-center border-none"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-4 py-1.5 space-y-1.5">
          
          {/* Portfolio Section — cards live on the dedicated page; drawer keeps active + New */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-0.5">Portfolios</p>
            <button
              onClick={() => {
                try { haptic.selection(); } catch {}
                if (onOpenPortfolios) onOpenPortfolios();
                else onClose();
              }}
              className="w-full p-2.5 rounded-xl border-0 bg-[#0a0a0a] text-white flex items-center justify-between text-left transition-all"
            >
              <div className="min-w-0">
                <p className="text-xs font-bold truncate text-left">{drawerPortfolios.find(p => p.id === effectiveActiveId)?.name || portfolioName}</p>
                <p className="text-[10px] text-zinc-400 truncate text-left">{drawerPortfolios.length} of 3 slots · tap to manage</p>
              </div>
              <ChevronRight size={16} className="text-zinc-500 shrink-0" />
            </button>
            <button
              onClick={() => {
                try { haptic.selection(); } catch {}
                if (onNewPortfolio) onNewPortfolio();
                else onClose();
              }}
              className="mt-1 w-full p-2 rounded-xl border border-dashed border-white/15 text-zinc-400 hover:text-white hover:border-[#FF4F01]/50 flex items-center justify-center gap-2 text-xs font-bold transition-all"
            >
              <Plus size={14} /> New portfolio
            </button>
          </div>

          {/* Connections (global broker/bridge settings; per-portfolio terminal lives on the portfolio card) */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-0.5">Connections</p>
            <button
              onClick={() => {
                try { haptic.selection(); } catch {}
                onNavigate('ea-setup');
                onClose();
              }}
              className="w-full p-3 rounded-xl bg-[#0a0a0a] border-0 flex items-center justify-between text-left hover:bg-[#0a0a0a]"
            >
              <div className="text-left">
                <p className="text-xs font-bold text-white text-left">Bridge & broker settings</p>
                <p className="text-[10px] text-zinc-400 text-left">
                  {isBridgeOnline ? 'Bridge Online · Syncing' : 'Logins & pairing · for a portfolio, tap its card instead'}
                </p>
              </div>
              <ChevronRight size={14} className="text-zinc-500 shrink-0" />
            </button>
          </div>

          {/* Strategy Rules & Checklists (Discipline Engine) */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-0.5">Discipline</p>
            <button
              onClick={() => {
                try { haptic.selection(); } catch {}
                onNavigate('discipline');
                onClose();
              }}
              className="w-full p-3 rounded-xl bg-[#0a0a0a] border-0 flex items-center justify-between text-left hover:bg-[#0a0a0a]"
            >
              <div className="text-left">
                <p className="text-xs font-bold text-white text-left">Strategy Rules & Checklists</p>
                <p className="text-[10px] text-zinc-400 text-left">
                  Pre-entry / In-trade / Review
                </p>
              </div>
              <ChevronRight size={14} className="text-zinc-500 shrink-0" />
            </button>
          </div>

        </div>

        {/* Footer with Support + Logout */}
        <div className="p-4 border-t border-[#27272a] space-y-3">
          <div className="rounded-2xl bg-[#000000] border border-white/[0.06] overflow-hidden">
            <button
              onClick={() => {
                try { haptic.selection(); } catch {}
                onNavigate('settings');
                onClose();
              }}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-white/[0.04] transition-colors"
            >
              <span className="w-9 h-9 rounded-xl bg-white/[0.07] border border-white/[0.08] flex items-center justify-center shrink-0">
                <Settings size={17} className="text-white" />
              </span>
              <span className="flex-1 text-[15px] font-semibold text-white">Settings</span>
              <ChevronRight size={18} className="text-zinc-500 shrink-0" />
            </button>
            <div className="mx-4 h-px bg-white/[0.07]" />
            <button
              onClick={() => {
                try { haptic.selection(); } catch {}
                onClose();
                window.setTimeout(() => {
                  try {
                    window.open('https://t.me/+w_KvKM5HESYyMTdk', '_blank', 'noopener');
                  } catch { /* noop */ }
                }, 80);
              }}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-white/[0.04] transition-colors"
            >
              <span className="w-9 h-9 rounded-xl bg-white/[0.07] border border-white/[0.08] flex items-center justify-center shrink-0">
                <MessageCircle size={17} className="text-white" />
              </span>
              <span className="flex-1 text-[15px] font-semibold text-white">Live support</span>
              <ChevronRight size={18} className="text-zinc-500 shrink-0" />
            </button>
          </div>
          <button
            onClick={() => {
              try { haptic.medium(); } catch {}
              onClose();
              setTimeout(() => onLogout?.(), 80);
            }}
            className="w-full py-2.5 rounded-xl bg-[#1E1215] hover:bg-[#2A1519] border border-rose-500/20 text-rose-400 flex items-center justify-center gap-2 text-xs font-bold transition-all active:scale-[0.98]"
          >
            <LogOut size={15} />
            Log Out
          </button>
        </div>

      </div>
    </div>
  );
};
