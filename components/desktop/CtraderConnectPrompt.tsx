import React from 'react';
import { ArrowRight, Link2 } from 'lucide-react';

interface CtraderConnectPromptProps {
  title?: string;
  description?: string;
  onGoConnect?: () => void;
}

/** Desktop empty state used by every live-trading surface. */
export const CtraderConnectPrompt: React.FC<CtraderConnectPromptProps> = ({
  title = 'Connect cTrader to trade live',
  description = 'Link a cTrader account to see live quotes, place market orders, and manage open positions from the desktop journal.',
  onGoConnect,
}) => (
  <div className="flex min-h-[420px] w-full items-center justify-center rounded-2xl border border-white/10 bg-[#0b0b0c] p-6 sm:p-8">
    <div className="mx-auto flex w-full max-w-md flex-col items-center text-center">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#FF4F01]/30 bg-[#FF4F01]/10 text-[#FF4F01]">
        <Link2 size={24} />
      </div>
      <h2 className="mt-4 text-balance text-xl font-black tracking-tight text-white">{title}</h2>
      <p className="mt-2 max-w-sm text-pretty text-sm leading-relaxed text-zinc-400">{description}</p>
      <button
        type="button"
        onClick={onGoConnect}
        className="mt-5 inline-flex h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-[#FF4F01] px-5 text-sm font-bold text-white transition-transform hover:brightness-110 active:scale-95"
      >
        Connect cTrader <ArrowRight size={16} />
      </button>
      <p className="mt-3 text-[11px] font-medium text-zinc-600">Demo and live accounts supported</p>
    </div>
  </div>
);
