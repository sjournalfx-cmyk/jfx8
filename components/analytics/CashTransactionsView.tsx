
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpCircle,
  ArrowDownCircle,
  Percent,
  Receipt,
  ArrowRightLeft,
  Landmark,
  Gift,
  Filter,
  Calendar,
  Plus,
  X,
  Trash2,
  Edit3,
  Coins,
  Sparkles,
  HelpCircle,
  Search,
  RefreshCw,
  CheckCircle2
} from 'lucide-react';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  Line,
  ComposedChart
} from 'recharts';
import { CashTransaction, CashTransactionType, UserProfile } from '../../types';
import { clsx } from 'clsx';
import { Tooltip as InfoTooltip } from '../ui/Tooltip';
import { useToast } from '../ui/Toast';
import { dataService, cashTransactionSignature } from '../../services/dataService';
import { supabase } from '../../lib/supabase';
import {
  hasActiveSession as hasCtraderSession,
  getSelectedAccountId,
  getAccounts as getCtraderAccounts,
  getCashFlowHistory
} from '../../services/ctraderService';

interface CashTransactionsViewProps {
  isDarkMode: boolean;
  userProfile: UserProfile;
  cashTransactions: CashTransaction[];
  onCashTransactionsInfoClick?: () => void;
  onTransactionMomentumInfoClick?: () => void;
}

const TRANSACTION_TYPES: CashTransactionType[] = ['Deposit', 'Withdrawal', 'Interest', 'Fee', 'Tax', 'Promotion', 'Transfer'];

const TYPE_META: Record<CashTransactionType, { label: string; plural: string; color: string; icon: React.ElementType }> = {
  Deposit: { label: 'Deposit', plural: 'Deposits', color: '#10B981', icon: ArrowUpCircle },
  Withdrawal: { label: 'Withdrawal', plural: 'Withdrawals', color: '#3B82F6', icon: ArrowDownCircle },
  Interest: { label: 'Interest', plural: 'Interest', color: '#EC4899', icon: Percent },
  Fee: { label: 'Fee', plural: 'Fees', color: '#EF4444', icon: Receipt },
  Tax: { label: 'Tax', plural: 'Tax', color: '#F97316', icon: Landmark },
  Promotion: { label: 'Promotion', plural: 'Promotions', color: '#A855F7', icon: Gift },
  Transfer: { label: 'Transfer', plural: 'Transfers', color: '#06B6D4', icon: ArrowRightLeft },
};

const CTRADER_MARKER = /\[CW:(\d+)\]/;

type CashTransactionFormData = Omit<Partial<CashTransaction>, 'amount'> & {
  amount: string;
  type: CashTransactionType;
  date: string;
  description?: string;
};

const emptyForm = (): CashTransactionFormData => ({
  type: 'Deposit',
  amount: '',
  date: new Date().toISOString().split('T')[0],
  description: '',
});

export const CashTransactionsView: React.FC<CashTransactionsViewProps> = ({ isDarkMode, userProfile, cashTransactions, onCashTransactionsInfoClick, onTransactionMomentumInfoClick }) => {
  const [activeSubTab, setActiveTab] = useState<'transactions' | 'insights'>('insights');
  const [timeFilter, setTimeFilter] = useState('Last 12 months');
  // Empty selection === "All types". One or many types can be selected at once.
  const [selectedTypes, setSelectedTypes] = useState<CashTransactionType[]>([]);
  const [isTypeDropdownOpen, setIsTypeDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCumulative, setIsCumulative] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<CashTransaction | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // The prop list (cashTransactions) is the single source of truth. Optimistic
  // changes live in small overlays that clear automatically once the
  // authoritative list confirms them — no blind state mirroring, so stale or
  // out-of-order prop updates can never flicker rows in/out.
  const [pendingAdds, setPendingAdds] = useState<CashTransaction[]>([]);
  const [pendingUpdates, setPendingUpdates] = useState<Record<string, CashTransaction>>({});
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [hiddenSeries, setHiddenSeries] = useState<string[]>([]);
  const [ctraderSyncing, setCtraderSyncing] = useState(false);
  const [ctraderSyncResult, setCtraderSyncResult] = useState<{ added: number; at: Date } | null>(null);
  const autoSyncAttemptedRef = useRef(false);
  const { addToast } = useToast();

  const [formData, setFormData] = useState<CashTransactionFormData>(emptyForm());

  const currencySymbol = userProfile?.currencySymbol || '$';
  const isCtraderLinked = hasCtraderSession();

  // Reconcile optimistic overlays against the authoritative list. Runs on
  // every props change; entries disappear only when genuinely confirmed, so
  // mid-flight refetches can't make rows blink or resurrect deleted ones.
  useEffect(() => {
    setPendingAdds(prev => {
      if (prev.length === 0) return prev;
      const propIds = new Set(cashTransactions.map(t => t.id));
      const propSigs = new Set(cashTransactions.map(cashTransactionSignature));
      const remaining = prev.filter(p => !propIds.has(p.id) && !propSigs.has(cashTransactionSignature(p)));
      return remaining.length === prev.length ? prev : remaining;
    });

    setPendingUpdates(prev => {
      const ids = Object.keys(prev);
      if (ids.length === 0) return prev;
      const next = { ...prev };
      let changed = false;
      ids.forEach(id => {
        const confirmed = cashTransactions.find(t => t.id === id);
        if (confirmed && cashTransactionSignature(confirmed) === cashTransactionSignature(prev[id])) {
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    setDeletedIds(prev => {
      if (prev.size === 0) return prev;
      const propIds = new Set(cashTransactions.map(t => t.id));
      const remaining = new Set(Array.from(prev).filter(id => propIds.has(id)));
      return remaining.size === prev.size ? prev : remaining;
    });
  }, [cashTransactions]);

  // Stable display list: newest first, deterministic tie-break so identical
  // dates never swap rows between renders (the old "glitch").
  const allTransactions = useMemo(() => {
    const base = cashTransactions
      .map(t => pendingUpdates[t.id] || t)
      .filter(t => !deletedIds.has(t.id));

    const knownIds = new Set(base.map(t => t.id));
    const knownSigs = new Set(base.map(cashTransactionSignature));
    const extras = pendingAdds.filter(t => !knownIds.has(t.id) && !knownSigs.has(cashTransactionSignature(t)));

    const merged = [...extras, ...base];
    merged.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return merged;
  }, [cashTransactions, pendingAdds, pendingUpdates, deletedIds]);

  useEffect(() => {
    if (!isTypeDropdownOpen) return;
    const close = () => setIsTypeDropdownOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [isTypeDropdownOpen]);

  const normalizeAmount = (type: CashTransactionType, amount: number) => {
    if (!Number.isFinite(amount)) return 0;

    switch (type) {
      case 'Deposit':
      case 'Interest':
      case 'Promotion':
        return Math.abs(amount);
      case 'Withdrawal':
      case 'Fee':
      case 'Tax':
        return -Math.abs(amount);
      case 'Transfer':
      default:
        return amount;
    }
  };

  // --- cTrader auto-import -------------------------------------------------
  const runCtraderSync = async (silent: boolean): Promise<void> => {
    if (ctraderSyncing || !hasCtraderSession()) return;

    setCtraderSyncing(true);
    let accountLabelForError = 'account';
    try {
      const accounts = await getCtraderAccounts();
      if (!accounts.length) throw new Error('No cTrader accounts linked to this profile.');

      const savedId = getSelectedAccountId();
      const account = accounts.find(a => a.ctidTraderAccountId === savedId) || accounts[0];
      accountLabelForError = account.name || account.login || String(account.ctidTraderAccountId);

      const flows = await getCashFlowHistory(account.ctidTraderAccountId, undefined, undefined, !!account.isDemo);

      // Fetch the freshest persisted list so we never double-import while the
      // parent's cash transactions are still loading.
      let existing: CashTransaction[] = cashTransactions;
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) existing = await dataService.getCashTransactions(user.id);
      } catch { /* fall back to props */ }

      const importedMarkers = new Set(
        existing.map(t => t.description?.match(CTRADER_MARKER)?.[1]).filter(Boolean) as string[]
      );
      const existingKeys = new Set(existing.map(t => `${t.type}|${t.date}|${Math.abs(t.amount).toFixed(2)}`));

      const freshFlows = flows.filter(f => {
        if (!Number.isFinite(f.amount) || f.amount === 0) return false;
        if (f.creditFacility) return false;
        const dateOnly = f.timestamp.split('T')[0];
        const markerHit = importedMarkers.has(String(f.depositId));
        const keyHit = existingKeys.has(`${f.operationType === 'withdrawal' ? 'Withdrawal' : 'Deposit'}|${dateOnly}|${Math.abs(f.amount).toFixed(2)}`);
        return !markerHit && !keyHit;
      });

      let added = 0;
      let failed = 0;
      for (const flow of freshFlows) {
        try {
          await dataService.addCashTransaction({
            id: '',
            type: flow.operationType === 'withdrawal' ? 'Withdrawal' : 'Deposit',
            amount: Math.abs(flow.amount),
            date: flow.timestamp.split('T')[0],
            description: `cTrader import [CW:${flow.depositId}]`,
          });
          added++;
        } catch {
          failed++;
        }
      }

      if (added > 0) {
        setCtraderSyncResult({ added, at: new Date() });
        addToast({
          type: 'success',
          title: 'cTrader Synced',
          message: `Imported ${added} deposit/withdrawal record${added !== 1 ? 's' : ''}${failed ? ` (${failed} skipped)` : ''}.`,
          duration: 5000
        });
      } else if (!silent && freshFlows.length === 0) {
        addToast({ type: 'info', title: 'cTrader Sync', message: 'No new deposits or withdrawals to import.', duration: 4000 });
      }
    } catch (error: any) {
      const rawMessage = String(error?.message || error);
      console.warn('[cTrader] cash-flow sync failed:', rawMessage);

      if (rawMessage.includes('CANT_ROUTE_REQUEST')) {
        // The service already retried the opposite demo/live host. Remaining
        // causes: broker blocks this endpoint, or the account is unreachable.
        if (!silent) {
          addToast({
            type: 'warning',
            title: 'History Not Available',
            message: `cTrader could not return deposit/withdrawal history for ${accountLabelForError}. Try selecting a different account in EA Setup, or add transactions manually.`,
            duration: 7000
          });
        }
      } else if (!silent) {
        addToast({
          type: 'warning',
          title: 'cTrader Sync Failed',
          message: rawMessage,
          duration: 6000
        });
      }
    } finally {
      setCtraderSyncing(false);
    }
  };

  // Auto-fetch once when the tab opens for cTrader-connected users.
  useEffect(() => {
    if (autoSyncAttemptedRef.current || !hasCtraderSession()) return;
    autoSyncAttemptedRef.current = true;
    const timer = setTimeout(() => { void runCtraderSync(true); }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- CRUD (persisted via dataService; optimistic overlays keep the UI
  // --- instant while the authoritative list catches up) --------------------
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    const rawAmount = Number(formData.amount);
    if (!formData.type || !Number.isFinite(rawAmount) || rawAmount <= 0 || !formData.date) return;

    setIsSubmitting(true);
    const tempId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const normalized = normalizeAmount(formData.type, rawAmount);

    // Optimistic row — visible immediately, reconciled automatically.
    setPendingAdds(prev => [{
      id: tempId,
      type: formData.type,
      amount: normalized,
      date: formData.date,
      description: formData.description,
    }, ...prev]);

    try {
      const saved = await dataService.addCashTransaction({
        id: tempId,
        type: formData.type,
        amount: rawAmount,
        date: formData.date,
        description: formData.description,
      });
      // Swap the temp row for the authoritative one; the reconcile effect
      // clears it once the prop list confirms.
      setPendingAdds(prev => prev.map(t => t.id === tempId ? { ...saved } : t));
      if (mountedRef.current) {
        if ((saved as any).__unsynced) {
          addToast({ type: 'warning', title: 'Saved Offline', message: `${formData.type} stored on this device and will sync automatically.`, duration: 5000 });
        } else {
          addToast({ type: 'success', title: 'Transaction Added', message: `${formData.type} saved.`, duration: 3500 });
        }
      }
    } catch (error) {
      console.error('Failed to add transaction:', error);
      if (mountedRef.current) {
        addToast({ type: 'warning', title: 'Sign-in Required', message: 'Please sign in again — the entry is kept on this device.', duration: 5000 });
      }
    } finally {
      if (mountedRef.current) {
        setShowAddModal(false);
        setEditingTransaction(null);
        setFormData(emptyForm());
        setIsSubmitting(false);
      }
    }
  };

  const handleUpdateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !editingTransaction) return;
    const rawAmount = Number(formData.amount);
    if (!formData.type || !Number.isFinite(rawAmount) || rawAmount <= 0 || !formData.date) return;

    setIsSubmitting(true);
    const updatedTransaction: CashTransaction = {
      ...editingTransaction,
      type: formData.type,
      amount: normalizeAmount(formData.type, rawAmount),
      date: formData.date,
      description: formData.description,
    };

    // Optimistic update overlay
    setPendingUpdates(prev => ({ ...prev, [updatedTransaction.id]: updatedTransaction }));

    try {
      await dataService.updateCashTransaction(updatedTransaction);
      if (mountedRef.current) {
        addToast({ type: 'success', title: 'Transaction Updated', message: `${updatedTransaction.type} updated.`, duration: 3500 });
      }
    } catch (error) {
      console.error('Failed to update transaction:', error);
      if (mountedRef.current) {
        addToast({ type: 'warning', title: 'Sign-in Required', message: 'Please sign in again — changes are kept on this device.', duration: 5000 });
      }
    } finally {
      if (mountedRef.current) {
        setEditingTransaction(null);
        setShowAddModal(false);
        setFormData(emptyForm());
        setIsSubmitting(false);
      }
    }
  };

  const handleDeleteTransaction = async (id: string) => {
    if (deletedIds.has(id)) return; // already deleting
    if (!confirm('Are you sure you want to delete this transaction?')) return;

    // Hide instantly; dataService tombstones it so no refetch race can
    // resurrect the row anywhere in the app.
    setDeletedIds(prev => new Set(prev).add(id));

    try {
      await dataService.deleteCashTransaction(id);
      if (mountedRef.current) {
        addToast({ type: 'success', title: 'Deleted', message: 'Transaction removed.', duration: 3000 });
      }
    } catch (error) {
      console.error('Failed to delete transaction:', error);
      if (mountedRef.current) {
        addToast({ type: 'warning', title: 'Sign-in Required', message: 'Please sign in again to finish deleting.', duration: 5000 });
      }
    }
  };

  const openEditModal = (transaction: CashTransaction) => {
    if (deletedIds.has(transaction.id)) return; // mid-deletion — ignore
    setEditingTransaction(transaction);
    setFormData({
      type: transaction.type,
      amount: String(Math.abs(Number(transaction.amount) || 0)),
      date: transaction.date,
      description: transaction.description,
    });
    setShowAddModal(true);
  };

  const closeAddModal = () => {
    if (isSubmitting) return; // never abandon an in-flight save
    setShowAddModal(false);
    setEditingTransaction(null);
    setFormData(emptyForm());
  };

  // Escape closes the modal; body scroll locks while open.
  useEffect(() => {
    if (!showAddModal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAddModal(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAddModal, isSubmitting]);

  const toggleTypeSelection = (type: CashTransactionType) => {
    setSelectedTypes(prev => prev.includes(type)
      ? prev.filter(t => t !== type)
      : [...prev, type]
    );
  };

  const filteredTransactions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return allTransactions.filter(t => {
      if (selectedTypes.length > 0 && !selectedTypes.includes(t.type)) return false;
      if (query && !(t.description || '').toLowerCase().includes(query) && !t.type.toLowerCase().includes(query)) return false;
      // Apply time filter logic
      const txDate = new Date(t.date);
      const now = new Date();
      if (timeFilter === 'Last 12 months') {
        const twelveMonthsAgo = new Date();
        twelveMonthsAgo.setMonth(now.getMonth() - 12);
        if (txDate < twelveMonthsAgo) return false;
      } else if (timeFilter === 'Year to Date') {
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        if (txDate < startOfYear) return false;
      }
      return true;
    });
  }, [allTransactions, selectedTypes, searchQuery, timeFilter]);

  const hasTransactions = allTransactions.length > 0;

  const stats = useMemo(() => {
    const result: Record<string, { count: number; amount: number }> = {};
    TRANSACTION_TYPES.forEach(type => {
      const rows = filteredTransactions.filter(t => t.type === type);
      result[type] = { count: rows.length, amount: rows.reduce((acc, t) => acc + t.amount, 0) };
    });
    return result;
  }, [filteredTransactions]);

  const chartData = useMemo(() => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const now = new Date();
    const currentYear = now.getFullYear();
    const years = [currentYear - 2, currentYear - 1, currentYear];

    let cumulativeNet = 0;
    const cumulativeByType: Record<string, number> = {};
    const data: any[] = [];

    years.forEach(year => {
      months.forEach(month => {
        const monthYear = `${month} ${year.toString().slice(-2)}`;
        const monthlyTransactions = filteredTransactions.filter(t => {
          const d = new Date(t.date);
          const m = months[d.getMonth()];
          const y = d.getFullYear();
          return m === month && y === year;
        });

        const monthTotal = monthlyTransactions.reduce((acc, t) => acc + t.amount, 0);
        cumulativeNet += monthTotal;

        const entry: any = { name: monthYear };

        entry.value = isCumulative ? cumulativeNet : monthTotal;

        // Split by types so each selected type gets its own series on the chart
        TRANSACTION_TYPES.forEach(type => {
          const typeTotal = monthlyTransactions.filter(t => t.type === type).reduce((acc, t) => acc + t.amount, 0);
          cumulativeByType[type] = (cumulativeByType[type] || 0) + typeTotal;
          entry[type] = isCumulative ? cumulativeByType[type] : typeTotal;
        });

        data.push(entry);
      });
    });

    return data;
  }, [isCumulative, filteredTransactions]);

  // Series rendered on the momentum chart: every selected type, or every type
  // with activity when "All" is chosen — plus the net flow line, always.
  const activeChartSeries = useMemo(() => {
    const totals: Record<string, number> = {};
    TRANSACTION_TYPES.forEach(type => {
      totals[type] = filteredTransactions.filter(t => t.type === type).reduce((acc, t) => acc + t.amount, 0);
    });
    const sourceTypes = selectedTypes.length > 0
      ? selectedTypes
      : TRANSACTION_TYPES.filter(type => Math.abs(totals[type]) > 0);

    return sourceTypes.filter(type => !hiddenSeries.includes(type));
  }, [filteredTransactions, selectedTypes, hiddenSeries]);

  const toggleSeriesVisibility = (key: string) => {
    setHiddenSeries(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const formatLargeNumber = (num: number) => {
    const abs = Math.abs(num);
    if (abs >= 1000000) return `${num < 0 ? '-' : ''}${currencySymbol}${(abs / 1000000).toFixed(1)}M`;
    if (abs >= 1000) return `${num < 0 ? '-' : ''}${currencySymbol}${(abs / 1000).toFixed(1)}K`;
    return `${num < 0 ? '-' : ''}${currencySymbol}${abs.toFixed(2)}`;
  };

  const SummaryCard = ({ meta, amount, count }: { meta: typeof TYPE_META[CashTransactionType]; amount: number; count: number }) => {
    const Icon = meta.icon;
    return (
      <div
        className={clsx(
          "p-5 rounded-[24px] border flex flex-col gap-4 min-h-[122px]",
          isDarkMode ? "bg-black/40 border-zinc-800/50 backdrop-blur-md" : "bg-white border-slate-200 shadow-lg"
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className={clsx("p-2.5 rounded-xl shrink-0", isDarkMode ? "bg-black" : "bg-slate-100")}>
            <Icon size={18} style={{ color: meta.color }} />
          </div>
          <div className="text-right min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest opacity-40 truncate">{count}</p>
          </div>
        </div>
        <div className="space-y-1">
          <h3 className={clsx("text-2xl font-black tracking-tight", isDarkMode ? "text-zinc-100" : "text-slate-900")}>
            {formatLargeNumber(amount)}
          </h3>
          <p className="text-xs font-bold opacity-30 uppercase tracking-wider">{meta.plural}</p>
        </div>
      </div>
    );
  };

  const openAddModal = () => {
    setEditingTransaction(null);
    setFormData(emptyForm());
    setShowAddModal(true);
  };

  const typeFilterLabel = selectedTypes.length === 0
    ? 'All'
    : selectedTypes.length === 1
      ? selectedTypes[0]
      : `${selectedTypes.length} types`;

  return (
    <div className="space-y-8 pb-20">
      {/* Header & Local Tabs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black tracking-tight">Cash Transactions</h2>
            <InfoTooltip content="A log of non-trade capital events that impact your overall trading account balance." isDarkMode={isDarkMode} onInfoClick={onCashTransactionsInfoClick}>
              <HelpCircle size={16} className="opacity-40 cursor-help hover:opacity-100" />
            </InfoTooltip>
          </div>
          <p className={clsx("text-xs font-semibold uppercase tracking-[0.18em]", isDarkMode ? "text-zinc-500" : "text-slate-500")}>
            Track deposits, withdrawals, interest, fees, taxes, promotions, and transfers
          </p>
        </div>

        <div className={clsx("flex p-1 rounded-xl border w-full md:w-auto", isDarkMode ? "bg-black border-zinc-800" : "bg-slate-100 border-slate-200")}>
          {(['transactions', 'insights'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={clsx(
                "px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest",
                activeSubTab === tab 
                  ? "bg-[#FF4F00] text-white shadow-xl"
                  : "opacity-40 hover:opacity-100"
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Filter Bar */}
      <div className={clsx(
        "flex flex-wrap items-center gap-4 p-4 rounded-2xl border",
        isDarkMode ? "bg-black/40 border-zinc-800/50" : "bg-white border-slate-200"
      )}>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-800/50 bg-black/20">
          <Calendar size={14} className="opacity-40" />
          <span className="text-xs font-bold opacity-60">Date:</span>
          <select 
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value)}
            className="bg-transparent text-xs font-black outline-none cursor-pointer"
          >
            <option>Last 12 months</option>
            <option>Year to Date</option>
            <option>All Time</option>
          </select>
        </div>

        {/* Multi-select type filter */}
        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setIsTypeDropdownOpen(o => !o)}
            className={clsx(
              "flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer",
              isDarkMode ? "border-zinc-800/50 bg-black/20" : "border-slate-200 bg-slate-50"
            )}
          >
            <Filter size={14} className="opacity-40" />
            <span className="text-xs font-bold opacity-60">Type:</span>
            <span className={clsx(
              "text-xs font-black",
              selectedTypes.length > 0 && "text-brand"
            )}>{typeFilterLabel}</span>
          </button>

          {isTypeDropdownOpen && (
            <div className={clsx(
              "absolute left-0 top-full mt-2 z-30 w-52 p-2 rounded-xl border shadow-xl",
              isDarkMode ? "bg-zinc-950 border-zinc-800" : "bg-white border-slate-200"
            )}>
              <label className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-brand/10">
                <input
                  type="checkbox"
                  checked={selectedTypes.length === 0}
                  onChange={() => setSelectedTypes([])}
                  className="accent-brand"
                />
                <span className="text-xs font-black uppercase tracking-widest">All Types</span>
              </label>
              <div className={clsx("my-1 border-t", isDarkMode ? "border-zinc-800" : "border-slate-100")} />
              {TRANSACTION_TYPES.map(type => (
                <label key={type} className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-brand/10">
                  <input
                    type="checkbox"
                    checked={selectedTypes.includes(type)}
                    onChange={() => toggleTypeSelection(type)}
                    className="accent-brand"
                  />
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: TYPE_META[type].color }} />
                  <span className="text-xs font-bold">{TYPE_META[type].plural}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-800/50 bg-black/20">
          <Search size={14} className="opacity-40" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search description..."
            className="w-32 sm:w-44 bg-transparent text-xs font-bold outline-none placeholder:opacity-40"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="opacity-40 hover:opacity-100">
              <X size={12} />
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {isCtraderLinked && (
            <button
              onClick={() => void runCtraderSync(false)}
              disabled={ctraderSyncing}
              className={clsx(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-colors",
                isDarkMode ? "border-zinc-800/50 bg-black/20 hover:border-brand/50" : "border-slate-200 bg-slate-50 hover:border-brand/50",
                ctraderSyncing && "opacity-50 cursor-not-allowed"
              )}
              title="Import deposits & withdrawals from your connected cTrader account"
            >
              <RefreshCw size={13} className={ctraderSyncing ? "animate-spin" : ''} />
              {ctraderSyncing ? 'Syncing...' : 'cTrader Sync'}
            </button>
          )}
          <span className="text-xs font-bold opacity-40 uppercase tracking-widest">Cumulative</span>
          <button 
            onClick={() => setIsCumulative(!isCumulative)}
            className={clsx(
              "w-12 h-6 rounded-full relative transition-colors",
              isCumulative ? "bg-brand" : "bg-zinc-700"
            )}
            aria-label="Toggle cumulative view"
          >
            <div className={clsx(
              "absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all",
              isCumulative ? "left-7" : "left-1"
            )} />
          </button>
        </div>
      </div>

      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onMouseDown={(e) => { if (e.target === e.currentTarget) closeAddModal(); }}
        >
          <div
            className={clsx(
              "w-[min(94vw,48rem)] max-h-[90vh] overflow-y-auto p-6 md:p-8 rounded-2xl border shadow-xl",
              isDarkMode ? "bg-black border-zinc-800" : "bg-white border-slate-200"
            )}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-start justify-between gap-4 mb-6">
              <h3 className="text-lg font-black tracking-tight">
                {editingTransaction ? 'Edit Transaction' : 'Add Transaction'}
              </h3>
              <button
                onClick={closeAddModal}
                className={clsx(
                  "p-2 rounded-lg transition-colors",
                  isDarkMode ? "hover:bg-black text-zinc-300" : "hover:bg-slate-100 text-slate-600"
                )}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={editingTransaction ? handleUpdateTransaction : handleAddTransaction} className="space-y-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider opacity-60 block mb-2">Type</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as CashTransactionType })}
                  className={clsx(
                    "w-full px-4 py-3 rounded-xl border text-sm font-bold outline-none",
                    isDarkMode
                      ? "bg-black border-zinc-800 focus:border-brand"
                      : "bg-slate-50 border-slate-200 focus:border-brand"
                  )}
                >
                  {TRANSACTION_TYPES.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider opacity-60 block mb-2">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  className={clsx(
                    "w-full px-4 py-3 rounded-xl border text-sm font-bold outline-none",
                    isDarkMode
                      ? "bg-black border-zinc-800 focus:border-brand"
                      : "bg-slate-50 border-slate-200 focus:border-brand"
                  )}
                  placeholder="0.00"
                />
                <p className="mt-2 text-[11px] leading-relaxed opacity-40 max-w-2xl whitespace-normal break-normal">
                  Enter a positive value — Deposits, Interest and Promotions are stored as inflows; Withdrawals, Fees and Taxes as outflows automatically.
                </p>
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider opacity-60 block mb-2">Date</label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  className={clsx(
                    "w-full px-4 py-3 rounded-xl border text-sm font-bold outline-none",
                    isDarkMode
                      ? "bg-black border-zinc-800 focus:border-brand"
                      : "bg-slate-50 border-slate-200 focus:border-brand"
                  )}
                />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider opacity-60 block mb-2">Description</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className={clsx(
                    "w-full px-4 py-3 rounded-xl border text-sm font-bold outline-none",
                    isDarkMode
                      ? "bg-black border-zinc-800 focus:border-brand"
                      : "bg-slate-50 border-slate-200 focus:border-brand"
                  )}
                  placeholder="Optional description..."
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeAddModal}
                  className={clsx(
                    "flex-1 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest",
                    isDarkMode
                      ? "bg-black hover:bg-black"
                      : "bg-slate-100 hover:bg-slate-200"
                  )}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !formData.type || !Number.isFinite(Number(formData.amount)) || Number(formData.amount) <= 0 || !formData.date}
                  className={clsx(
                    "flex-1 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed",
                    isDarkMode
                      ? "bg-brand hover:bg-brand/90 text-white"
                      : "bg-brand hover:bg-brand/90 text-white"
                  )}
                >
                  {isSubmitting ? 'Saving...' : (editingTransaction ? 'Update' : 'Add')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeSubTab === 'insights' ? (
          <div 
            key="insights"
            className="space-y-6"
          >
            {/* Summary Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {TRANSACTION_TYPES.map(type => (
                <SummaryCard key={type} meta={TYPE_META[type]} amount={stats[type].amount} count={stats[type].count} />
              ))}
            </div>

            {/* Chart Section */}
            <div className={clsx(
              "p-6 md:p-8 rounded-[32px] border",
              isDarkMode ? "bg-black border-zinc-800 shadow-2xl" : "bg-white border-slate-200 shadow-xl"
            )}>
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between mb-6">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-black tracking-tight italic uppercase">TRANSACTION MOMENTUM</h3>
                    <InfoTooltip content="Net capital flow over time for each selected transaction type, alongside the combined net flow." isDarkMode={isDarkMode} onInfoClick={onTransactionMomentumInfoClick}>
                      <HelpCircle size={16} className="opacity-40 cursor-help hover:opacity-100" />
                    </InfoTooltip>
                  </div>
                  <p className="text-xs opacity-40 font-bold uppercase tracking-[0.2em] mt-1">
                    Net capital flow over time{selectedTypes.length > 0 ? ` • ${typeFilterLabel}` : ''}
                  </p>
                </div>
                {ctraderSyncResult && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg border self-start md:self-auto border-emerald-500/30 bg-emerald-500/10">
                    <CheckCircle2 size={14} className="text-emerald-500" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-500">
                      {ctraderSyncResult.added} imported from cTrader
                    </span>
                  </div>
                )}
              </div>

              {hasTransactions ? (
                <div className="h-[340px] md:h-[380px] w-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%" minWidth={320} minHeight={340}>
                    <ComposedChart data={chartData}>
                      <defs>
                        <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#8251EE" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#8251EE" stopOpacity={0}/>
                        </linearGradient>
                        {activeChartSeries.map(type => (
                          <linearGradient key={`grad-${type}`} id={`colorType-${type}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={TYPE_META[type].color} stopOpacity={0.18}/>
                            <stop offset="95%" stopColor={TYPE_META[type].color} stopOpacity={0}/>
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? "#27272a" : "#e2e8f0"} vertical={false} />
                      <XAxis 
                        dataKey="name" 
                        stroke={isDarkMode ? "#71717a" : "#94a3b8"} 
                        fontSize={10} 
                        tickLine={false} 
                        axisLine={false} 
                      />
                      <YAxis 
                        stroke={isDarkMode ? "#71717a" : "#94a3b8"} 
                        fontSize={10} 
                        tickLine={false} 
                        axisLine={false} 
                        tickFormatter={(val) => `${val < 0 ? '-' : ''}${currencySymbol}${Math.abs(val) >= 1000 ? (Math.abs(val)/1000) + 'K' : Math.abs(val)}`}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: isDarkMode ? '#000000' : '#fff', 
                          borderColor: isDarkMode ? '#27272a' : '#e2e8f0',
                          borderRadius: '16px',
                          fontSize: '12px',
                          fontWeight: 'bold',
                          color: isDarkMode ? '#fff' : '#000'
                        }}
                        itemStyle={{ color: isDarkMode ? '#a1a1aa' : '#64748b' }}
                        formatter={(val: number, name: string) => [
                          formatLargeNumber(val),
                          name === 'value' ? 'Net Flow' : TYPE_META[name as CashTransactionType]?.label || name
                        ]}
                      />
                      {activeChartSeries.map(type => (
                        <Area
                          key={type}
                          type="monotone"
                          dataKey={type}
                          stroke={TYPE_META[type].color}
                          strokeWidth={2}
                          strokeDasharray="5 4"
                          fillOpacity={1}
                          fill={`url(#colorType-${type})`}
                          animationDuration={0}
                          connectNulls
                        />
                      ))}
                      <Area 
                        type="monotone" 
                        dataKey="value" 
                        stroke="#8251EE" 
                        strokeWidth={4}
                        fillOpacity={1} 
                        fill="url(#colorValue)" 
                        animationDuration={0}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className={clsx(
                  "h-[340px] md:h-[380px] flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed",
                  isDarkMode ? "border-zinc-800" : "border-slate-200"
                )}>
                  <Coins size={28} className="opacity-30" />
                  <p className="text-sm font-bold opacity-40">Add or import a transaction to see your capital flow</p>
                  {isCtraderLinked && (
                    <button
                      onClick={() => void runCtraderSync(false)}
                      disabled={ctraderSyncing}
                      className={clsx(
                        "inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-brand text-white",
                        ctraderSyncing && "opacity-60"
                      )}
                    >
                      <RefreshCw size={13} className={ctraderSyncing ? "animate-spin" : ''} />
                      Import from cTrader
                    </button>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-x-6 gap-y-3 mt-6 pt-5 border-t border-zinc-800/50">
                 <button
                   onClick={() => toggleSeriesVisibility('value')}
                   className={clsx("flex items-center gap-2", hiddenSeries.includes('value') && "opacity-30")}
                 >
                   <div className="w-2.5 h-2.5 rounded-full bg-[#8251EE]" />
                   <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Net Flow</span>
                 </button>
                 {(selectedTypes.length > 0 ? selectedTypes : TRANSACTION_TYPES).filter(type =>
                   selectedTypes.length > 0 || filteredTransactions.some(t => t.type === type)
                 ).map(type => (
                   <button
                     key={type}
                     onClick={() => toggleSeriesVisibility(type)}
                     className={clsx("flex items-center gap-2 transition-opacity", hiddenSeries.includes(type) && "opacity-30")}
                     title={hiddenSeries.includes(type) ? 'Show on chart' : 'Hide from chart'}
                   >
                     <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TYPE_META[type].color }} />
                     <span className="text-[10px] font-black uppercase tracking-widest opacity-40">{TYPE_META[type].plural}</span>
                   </button>
                 ))}
              </div>
            </div>
          </div>
        ) : (
          <div 
            key="transactions"
            className={clsx(
              "rounded-[32px] border overflow-hidden min-w-0",
              isDarkMode ? "bg-black border-zinc-800 shadow-2xl" : "bg-white border-slate-200 shadow-xl"
            )}
          >
            <div className={clsx(
              "flex flex-col gap-4 p-6 border-b",
              isDarkMode ? "border-zinc-800" : "border-slate-100"
            )}>
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-bold opacity-60 uppercase tracking-widest">All Transactions</h3>
                  <p className="text-[11px] font-semibold opacity-35">
                    Saved to your account{isCtraderLinked ? ' • deposits & withdrawals import automatically from cTrader' : ''}.
                  </p>
                </div>
                <div className="md:ml-auto">
                  <button
                    onClick={openAddModal}
                    className={clsx(
                      "inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-[0.18em] shadow-sm w-full md:w-auto",
                      isDarkMode
                        ? "bg-brand text-white hover:bg-brand"
                        : "bg-brand text-white hover:bg-brand"
                    )}
                  >
                    <Plus size={15} />
                    Add Transaction
                    </button>
                </div>
            </div>
            </div>
            <div className="overflow-x-auto">
            {filteredTransactions.length > 0 ? (
              <table className="w-full text-left border-collapse">
              <thead>
                <tr className={clsx(
                  "border-b uppercase text-[10px] font-black tracking-[0.2em] opacity-40",
                  isDarkMode ? "border-zinc-800" : "border-slate-100"
                )}>
                  <th className="px-8 py-5">Date</th>
                  <th className="px-8 py-5">Type</th>
                  <th className="px-8 py-5">Description</th>
                  <th className="px-8 py-5 text-right">Amount</th>
                  <th className="px-8 py-5 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {filteredTransactions.map((t) => (
                  <tr key={t.id} className={clsx(
                    isDarkMode ? "hover:bg-black/50" : "hover:bg-slate-50"
                  )}>
                    <td className="px-8 py-5 text-xs font-bold opacity-60 font-mono">{t.date}</td>
                    <td className="px-8 py-5">
                      <span
                        className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider"
                        style={{ backgroundColor: `${TYPE_META[t.type]?.color || '#71717a'}1A`, color: TYPE_META[t.type]?.color || '#71717a' }}
                      >
                        {t.type}
                      </span>
                    </td>
                    <td className="px-8 py-5 text-xs font-bold">{t.description || '-'}</td>
                    <td className={clsx(
                      "px-8 py-5 text-sm font-black text-right",
                      t.amount >= 0 ? "text-emerald-500" : "text-rose-500"
                    )}>
                      {t.amount >= 0 ? '+' : ''}{formatLargeNumber(t.amount)}
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => openEditModal(t)}
                          className={clsx(
                            "p-2 rounded-lg",
                            isDarkMode ? "hover:bg-black text-zinc-400 hover:text-brand" : "hover:bg-slate-100 text-slate-500 hover:text-brand"
                          )}
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteTransaction(t.id)}
                          className={clsx(
                            "p-2 rounded-lg",
                            isDarkMode ? "hover:bg-black text-zinc-400 hover:text-rose-500" : "hover:bg-slate-100 text-slate-500 hover:text-rose-500"
                          )}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            ) : hasTransactions ? (
              <div className={clsx(
                "px-6 py-16 text-center",
                isDarkMode ? "bg-black" : "bg-white"
              )}>
                <div className={clsx(
                  "mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border",
                  isDarkMode ? "border-zinc-800 bg-black/60 text-brand" : "border-slate-200 bg-slate-50 text-brand"
                )}>
                  <Sparkles size={28} />
                </div>
                <h4 className="text-lg font-black tracking-tight">No matching transactions</h4>
                <p className="mt-2 text-sm leading-6 opacity-50 max-w-2xl mx-auto whitespace-normal break-normal">
                  Your current filters hide every transaction. Adjust the date, type, or search filter to see results.
                </p>
                <button
                  onClick={() => {
                    setTimeFilter('All Time');
                    setSelectedTypes([]);
                    setSearchQuery('');
                  }}
                  className={clsx(
                    "mt-6 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-[0.18em]",
                    isDarkMode ? "bg-black text-white" : "bg-slate-900 text-white"
                  )}
                >
                  Reset Filters
                </button>
              </div>
            ) : (
              <div className={clsx(
                "px-6 py-16 text-center",
                isDarkMode ? "bg-black" : "bg-white"
              )}>
                <div className={clsx(
                  "mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border",
                  isDarkMode ? "border-zinc-800 bg-black/60 text-brand" : "border-slate-200 bg-slate-50 text-brand"
                )}>
                  <Coins size={28} />
                </div>
                <h4 className="text-lg font-black tracking-tight">No transactions yet</h4>
                <p className="mt-2 text-sm leading-6 opacity-50 max-w-2xl mx-auto whitespace-normal break-normal">
                  Add one manually{isCtraderLinked ? ', or import your deposits & withdrawals from cTrader' : ''}.
                </p>
                <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
                  {isCtraderLinked && (
                    <button
                      onClick={() => void runCtraderSync(false)}
                      disabled={ctraderSyncing}
                      className={clsx(
                        "inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-[0.18em] border",
                        isDarkMode ? "border-zinc-700 text-white hover:border-brand" : "border-slate-300 text-slate-900 hover:border-brand",
                        ctraderSyncing && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <RefreshCw size={15} className={ctraderSyncing ? "animate-spin" : ''} />
                      {ctraderSyncing ? 'Syncing...' : 'Import from cTrader'}
                    </button>
                  )}
                  <button
                    onClick={openAddModal}
                    className={clsx(
                      "inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-[0.18em]",
                      isDarkMode ? "bg-brand text-white" : "bg-brand text-white"
                    )}
                  >
                    <Plus size={15} />
                    Add Transaction
                  </button>
                </div>
              </div>
            )}
            <div className={clsx("px-6 py-4 flex justify-center border-t", isDarkMode ? "border-zinc-800/50" : "border-slate-200")}>
              <p className="text-[11px] font-bold opacity-30 uppercase tracking-widest italic">
                Displaying {filteredTransactions.length} transaction{filteredTransactions.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>
      )}
  </div>
);
};
