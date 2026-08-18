import React, { useEffect, useRef } from 'react';

interface CtraderAuthModalProps {
  isOpen: boolean;
  isDarkMode: boolean;
  onClose: () => void;
  onConnect: () => void;
}

/**
 * Shown when the Backtest Lab tries to pull candles from cTrader Open API
 * but no account is authenticated yet. Matches the app's standard
 * ConfirmationModal pattern; the primary action jumps into Settings.
 */
const CtraderAuthModal: React.FC<CtraderAuthModalProps> = ({
  isOpen,
  isDarkMode,
  onClose,
  onConnect
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const connectButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 50);
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        const focusableElements = modalRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled])'
        );
        if (!focusableElements || focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ctrader-modal-title"
      aria-describedby="ctrader-modal-description"
    >
      <div className="absolute inset-0 bg-black/80" />
      <div
        ref={modalRef}
        className="relative w-full max-w-[26rem] rounded-2xl overflow-hidden border border-zinc-800 bg-black shadow-xl shadow-black/40"
        role="document"
      >
        <div className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center overflow-hidden">
              <img src="/icon3.jpeg" alt="cTrader" className="w-9 h-9 object-contain" />
            </div>

            <div className="min-w-0 flex-1">
              <h3 id="ctrader-modal-title" className="text-xl font-semibold text-white tracking-tight">
                cTrader Connection Required
              </h3>
              <p id="ctrader-modal-description" className="mt-2 text-sm leading-6 text-zinc-400">
                You're not connected to the cTrader Open API yet. Link your account in Settings to pull historical candlesticks straight into the Backtest Lab.
              </p>

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end" role="group" aria-label="Dialog actions">
                <button
                  onClick={onClose}
                  className="inline-flex min-h-10 items-center justify-center rounded-xl border border-zinc-700 bg-black px-4 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-900"
                  ref={closeButtonRef}
                >
                  Not Now
                </button>
                <button
                  onClick={onConnect}
                  className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[#0061FF] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#0052d4]"
                  ref={connectButtonRef}
                  autoFocus
                >
                  Connect
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CtraderAuthModal;
