
import React, { createContext, useContext, useState, useCallback, ReactNode, useRef, useEffect } from 'react';
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle, Clock } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  timestamp: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastContextType {
  addToast: (toast: Omit<Toast, 'id' | 'timestamp'>) => void;
  removeToast: (id: string) => void;
  notifications: Array<Toast & { read: boolean }>;
  unreadCount: number;
  markNotificationsRead: () => void;
  clearNotifications: () => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const noop = () => {};
const fallbackToastContext: ToastContextType = {
  addToast: noop,
  removeToast: noop,
  notifications: [],
  unreadCount: 0,
  markNotificationsRead: noop,
  clearNotifications: noop,
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    if (import.meta.env.DEV) {
      console.warn('useToast was called outside of a ToastProvider. Using a no-op fallback.');
    }
    return fallbackToastContext;
  }
  return context;
};

const NOTIFICATION_DEDUPE_WINDOW_MS = 5000;

const normalizeToastText = (value: string | undefined) => (value || '').trim().replace(/\s+/g, ' ').toLowerCase();

const getToastFingerprint = (toast: Pick<Toast, 'type' | 'title' | 'message'>) => {
  return [
    toast.type,
    normalizeToastText(toast.title),
    normalizeToastText(toast.message),
  ].join('|');
};

const ToastItem: React.FC<{ toast: Toast; onRemove: () => void }> = ({ toast, onRemove }) => {
  const [progress, setProgress] = useState(100);
  const [isHovered, setIsHovered] = useState(false);
  const remainingRef = useRef(toast.duration ?? 0);
  const startedAtRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    remainingRef.current = toast.duration ?? 0;
    setProgress(100);
    clearTimer();
    startedAtRef.current = null;

    return () => {
      clearTimer();
      startedAtRef.current = null;
    };
  }, [toast.id, toast.duration, clearTimer]);

  useEffect(() => {
    if (!toast.duration || toast.duration <= 0) {
      return undefined;
    }

    if (isHovered) {
      const startedAt = startedAtRef.current;
      if (startedAt) {
        remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAt));
        startedAtRef.current = null;
      }
      clearTimer();
      return undefined;
    }

    startedAtRef.current = Date.now();
    intervalRef.current = window.setInterval(() => {
      if (!startedAtRef.current || !toast.duration) return;
      const elapsed = Date.now() - startedAtRef.current;
      const remaining = Math.max(0, remainingRef.current - elapsed);
      setProgress((remaining / toast.duration) * 100);

      if (remaining <= 0) {
        clearTimer();
        onRemove();
      }
    }, 50);

    return () => {
      const startedAt = startedAtRef.current;
      if (startedAt) {
        remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAt));
      }
      startedAtRef.current = null;
      clearTimer();
    };
  }, [toast.id, toast.duration, isHovered, onRemove, clearTimer]);

  const typeStyles = {
    success: {
      bg: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400',
      progress: 'bg-emerald-500',
      icon: <CheckCircle2 size={18} />,
    },
    error: {
      bg: 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400',
      progress: 'bg-rose-500',
      icon: <AlertCircle size={18} />,
    },
    warning: {
      bg: 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400',
      progress: 'bg-amber-500',
      icon: <AlertTriangle size={18} />,
    },
    info: {
      bg: 'bg-indigo-500/10 border-indigo-500/20 text-indigo-600 dark:text-indigo-400',
      progress: 'bg-indigo-500',
      icon: <Info size={18} />,
    },
  };

  const style = typeStyles[toast.type];

  return (
    <div
      role="alert"
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`pointer-events-auto relative flex items-start gap-3 p-4 rounded-xl border shadow-lg backdrop-blur-md w-full sm:min-w-[320px] sm:max-w-[420px] overflow-hidden animate-in slide-in-from-right-full fade-in duration-300 ${style.bg}`}
    >
      <div 
        className={`absolute bottom-0 left-0 h-1 transition-all duration-100 ease-linear ${style.progress}`}
        style={{ width: `${progress}%` }}
      />
      <div className="shrink-0 mt-0.5" aria-hidden="true">
        {style.icon}
      </div>
      <div className="flex-1">
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-bold text-sm">{toast.title}</h4>
          <span className="text-[10px] font-medium opacity-50 whitespace-nowrap">
            {new Date(toast.timestamp).toDateString() === new Date().toDateString() 
              ? new Date(toast.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : new Date(toast.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}
          </span>
        </div>
        {toast.message && <p className="text-xs opacity-80 mt-1">{toast.message}</p>}
        {toast.action && (
          <button
            onClick={() => {
              toast.action?.onClick();
              onRemove();
            }}
            className="mt-2 text-xs font-black uppercase tracking-widest underline decoration-2 underline-offset-4 hover:opacity-70 transition-opacity"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button 
        onClick={onRemove}
        className="shrink-0 opacity-50 hover:opacity-100 transition-opacity"
        aria-label="Dismiss notification"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
};

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [history, setHistory] = useState<Array<Toast & { read: boolean }>>([]);
  const recentNotificationsRef = useRef<Record<string, number>>({});
  const activeToastsRef = useRef<Toast[]>([]);

  useEffect(() => {
    activeToastsRef.current = toasts;
  }, [toasts]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback(({ type, title, message, duration = 5000, action }: Omit<Toast, 'id' | 'timestamp'>) => {
    const now = Date.now();
    const cleanTitle = title.trim().replace(/\s+/g, ' ');
    const cleanMessage = message?.trim().replace(/\s+/g, ' ');
    const fingerprint = getToastFingerprint({ type, title: cleanTitle, message: cleanMessage });

    const lastSeenAt = recentNotificationsRef.current[fingerprint];
    if (lastSeenAt && now - lastSeenAt < NOTIFICATION_DEDUPE_WINDOW_MS) {
      return;
    }

    if (activeToastsRef.current.some((toast) => getToastFingerprint(toast) === fingerprint)) {
      return;
    }

    recentNotificationsRef.current[fingerprint] = now;

    const pruneCutoff = now - NOTIFICATION_DEDUPE_WINDOW_MS * 4;
    for (const [key, timestamp] of Object.entries(recentNotificationsRef.current)) {
      if (timestamp < pruneCutoff) {
        delete recentNotificationsRef.current[key];
      }
    }
    
    const id = Math.random().toString(36).substring(2, 9);
    const newToast: Toast = { 
      id, 
      type, 
      title: cleanTitle, 
      message: cleanMessage || undefined,
      duration, 
      action, 
      timestamp: now 
    };
    
    setToasts((prev) => {
      if (prev.some((toast) => getToastFingerprint(toast) === fingerprint)) return prev;
      return [...prev, newToast];
    });

    setHistory((prev) => {
      if (prev.some((toast) => getToastFingerprint(toast) === fingerprint)) {
        return prev;
      }
      return [{ ...newToast, read: false }, ...prev].slice(0, 20);
    });
  }, []);

  const markNotificationsRead = useCallback(() => {
    setHistory((prev) => prev.map((notification) => (
      notification.read ? notification : { ...notification, read: true }
    )));
  }, []);

  const clearNotifications = useCallback(() => {
    setToasts([]);
    setHistory([]);
    recentNotificationsRef.current = {};
  }, []);

  const unreadCount = history.filter((notification) => !notification.read).length;

  return (
    <ToastContext.Provider value={{
      addToast,
      removeToast,
      notifications: history,
      unreadCount,
      markNotificationsRead,
      clearNotifications
    }}>
      {children}
      <div className="fixed inset-x-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom)+12px)] sm:inset-x-auto sm:bottom-6 sm:right-6 z-[100] flex flex-col gap-3 pointer-events-none pb-[env(safe-area-inset-bottom)] sm:pb-0" role="region" aria-label="Notifications">
        {toasts.map((toast) => (
          <ToastItem 
            key={toast.id} 
            toast={toast} 
            onRemove={() => removeToast(toast.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
};
