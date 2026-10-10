import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Trash2, LogOut, X } from 'lucide-react';

export interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  isDarkMode: boolean;
  showCancel?: boolean;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel,
  isDarkMode,
  showCancel = true
}) => {
  const [isConfirming, setIsConfirming] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    // Restore whatever the page had (the app keeps the body locked while
    // authenticated) instead of forcing an unlock when the modal closes.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = setTimeout(() => {
      cancelButtonRef.current?.focus();
    }, 50);
    return () => {
      clearTimeout(focusTimer);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      
      if (e.key === 'Escape' && !isConfirming) {
        e.preventDefault();
        onCancel();
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
  }, [isOpen, isConfirming, onCancel]);

  useEffect(() => {
    if (!isOpen) setIsConfirming(false);
  }, [isOpen]);

  const handleConfirm = async () => {
    if (isConfirming) return;
    setIsConfirming(true);
    try {
      await onConfirm();
    } finally {
      setIsConfirming(false);
    }
  };

  if (!isOpen) return null;

  const getIcon = () => {
    switch (variant) {
      case 'danger':
        return <Trash2 className="text-zinc-200" size={22} aria-hidden="true" />;
      case 'warning':
        return <AlertCircle className="text-zinc-200" size={22} aria-hidden="true" />;
      case 'info':
        return <LogOut className="text-zinc-200" size={22} aria-hidden="true" />;
      default:
        return <AlertCircle className="text-zinc-200" size={22} aria-hidden="true" />;
    }
  };

  const getIconBg = () => {
    switch (variant) {
      case 'danger':
        return 'bg-black';
      case 'warning':
        return 'bg-black';
      case 'info':
        return 'bg-black';
      default:
        return 'bg-black';
    }
  };

  const getConfirmButtonClass = () => {
    switch (variant) {
      case 'danger':
        return 'bg-black text-white';
      case 'warning':
        return 'bg-black text-white';
      case 'info':
        return 'bg-black text-white';
      default:
        return 'bg-black text-white';
    }
  };

  const getAriaLabel = () => {
    switch (variant) {
      case 'danger':
        return 'Confirmation required for destructive action';
      case 'warning':
        return 'Confirmation required';
      default:
        return 'Confirmation dialog';
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      aria-describedby="modal-description"
      aria-label={getAriaLabel()}
    >
      <div className="absolute inset-0 bg-black/80" />
      <div
        ref={modalRef}
        className="relative w-full max-w-[26rem] rounded-2xl overflow-hidden border border-zinc-800 bg-black shadow-xl shadow-black/40"
        role="document"
      >
        <div className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className={`w-11 h-11 shrink-0 rounded-xl flex items-center justify-center ${getIconBg()}`}>
              {getIcon()}
            </div>

            <div className="min-w-0 flex-1">
              <h3 id="modal-title" className="text-xl font-semibold text-white tracking-tight">
                {title}
              </h3>
              <p id="modal-description" className="mt-2 text-sm leading-6 text-zinc-400">
                {description}
              </p>

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end" role="group" aria-label="Dialog actions">
                {showCancel && (
                  <button
                    onClick={onCancel}
                    disabled={isConfirming}
                    className="inline-flex min-h-10 items-center justify-center rounded-xl border border-zinc-700 bg-black px-4 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-900"
                    ref={cancelButtonRef}
                  >
                    {cancelText}
                  </button>
                )}
                <button
                  onClick={() => { void handleConfirm(); }}
                  disabled={isConfirming}
                  className={`inline-flex min-h-10 items-center justify-center rounded-xl px-4 text-sm font-semibold transition-colors ${getConfirmButtonClass()}`}
                  ref={confirmButtonRef}
                  autoFocus={!showCancel}
                >
                  {isConfirming ? 'Working…' : confirmText}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationModal;
