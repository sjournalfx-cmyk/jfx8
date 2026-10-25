import React, { useEffect, useRef, useState } from 'react';
import { Coins, ExternalLink, SquarePlus, Trophy, X } from 'lucide-react';
import {
  BROKER_PARTNERS,
  BROKER_PARTNERS_CAPTION,
  PROP_FIRM_PARTNERS,
  type PartnerLink,
} from '../../config/partnerLinks';

interface NoConnectionStateProps {
  /** Opens the existing connect flow used by the rest of the app. */
  onConnect?: () => void;
}

type SheetKind = 'brokers' | 'prop-firms' | null;

const ORANGE_GLOW =
  'radial-gradient(circle at 30% 30%, rgba(255, 79, 1, 0.34) 0%, rgba(255, 79, 1, 0.12) 45%, transparent 72%)';
const NEUTRAL_GLOW =
  'radial-gradient(circle at 30% 30%, rgba(161, 161, 170, 0.24) 0%, rgba(161, 161, 170, 0.08) 45%, transparent 72%)';

const CardGlow = ({ background }: { background: string }) => (
  <span
    aria-hidden
    className="pointer-events-none absolute -left-12 -top-12 h-40 w-40 rounded-full"
    style={{ background }}
  />
);

interface ConnectionCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  glow: string;
  onClick: () => void;
  opensSheet?: boolean;
}

const ConnectionCard: React.FC<ConnectionCardProps> = ({
  icon,
  title,
  description,
  glow,
  onClick,
  opensSheet = false,
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-haspopup={opensSheet ? 'dialog' : undefined}
    className="group relative w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-[#111111] p-5 text-left transition-colors duration-200 hover:border-[#FF4F01]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4F01]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black active:border-[#FF4F01]/40"
  >
    <CardGlow background={glow} />
    <span className="relative flex items-start gap-4">
      <span className="mt-0.5 shrink-0 text-white">{icon}</span>
      <span className="min-w-0">
        <span className="block text-base font-bold text-white">{title}</span>
        <span className="mt-1 block text-sm leading-relaxed text-zinc-400">{description}</span>
      </span>
    </span>
  </button>
);

interface PartnerSheetProps {
  title: string;
  links: PartnerLink[];
  caption?: string;
  onClose: () => void;
}

const PartnerSheet: React.FC<PartnerSheetProps> = ({ title, links, caption, onClose }) => {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[240] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[420px] rounded-t-3xl border border-white/10 bg-[#0b0b0c] px-5 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] outline-none sm:rounded-3xl sm:pb-5"
      >
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-base font-bold text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-zinc-400 transition-colors hover:border-[#FF4F01]/40 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2">
          {links.map((partner) => (
            <a
              key={partner.name}
              href={partner.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#111111] px-4 py-3 text-sm font-bold text-white transition-colors hover:border-[#FF4F01]/40 hover:text-[#FF4F01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4F01]/60"
            >
              <span>{partner.name}</span>
              <ExternalLink size={16} className="shrink-0 text-zinc-500" />
            </a>
          ))}
        </div>

        {caption && <p className="mt-3 text-xs leading-relaxed text-zinc-500">{caption}</p>}
      </div>
    </div>
  );
};

/**
 * Full-page state shown on Log Trade when no broker, prop firm or desktop
 * portfolio is connected. The actions only route into existing flows; no new
 * authentication is started here.
 */
export const NoConnectionState: React.FC<NoConnectionStateProps> = ({ onConnect }) => {
  const [openSheet, setOpenSheet] = useState<SheetKind>(null);

  return (
    <div
      data-testid="no-connection-state"
      className="h-full min-h-0 w-full overflow-y-auto bg-black text-white"
    >
      <div className="flex min-h-full w-full flex-col items-center justify-center px-4 pt-[max(1.75rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6">
        <div className="w-full max-w-[560px]">
          <h1 className="text-center text-3xl font-black tracking-tight text-white sm:text-4xl">
            Ready for the next step?
          </h1>

          <div className="mt-7 space-y-3 sm:mt-9">
            <ConnectionCard
              icon={<Coins size={40} strokeWidth={1.5} aria-hidden />}
              title="Pick a broker"
              description="See brokers that work with JFX and open an account with your own funds."
              glow={ORANGE_GLOW}
              onClick={() => setOpenSheet('brokers')}
              opensSheet
            />

            <ConnectionCard
              icon={<Trophy size={40} strokeWidth={1.5} aria-hidden />}
              title="Pick a prop firm"
              description="See prop firms that run on cTrader, take a challenge and get funded."
              glow={ORANGE_GLOW}
              onClick={() => setOpenSheet('prop-firms')}
              opensSheet
            />

            <div className="flex items-center gap-3 py-1" aria-hidden>
              <span className="h-px flex-1 bg-white/[0.08]" />
              <span className="text-[11px] font-bold tracking-[0.2em] text-zinc-500">OR</span>
              <span className="h-px flex-1 bg-white/[0.08]" />
            </div>

            <ConnectionCard
              icon={<SquarePlus size={40} strokeWidth={1.5} aria-hidden />}
              title="Connect broker / prop"
              description="Already have a Deriv, cTrader or MT5 account? Connect it to log trades from here."
              glow={NEUTRAL_GLOW}
              onClick={() => onConnect?.()}
            />
          </div>
        </div>
      </div>

      {openSheet === 'brokers' && (
        <PartnerSheet
          title="Pick a broker"
          links={BROKER_PARTNERS}
          caption={BROKER_PARTNERS_CAPTION}
          onClose={() => setOpenSheet(null)}
        />
      )}

      {openSheet === 'prop-firms' && (
        <PartnerSheet
          title="Pick a prop firm"
          links={PROP_FIRM_PARTNERS}
          onClose={() => setOpenSheet(null)}
        />
      )}
    </div>
  );
};

export default NoConnectionState;
