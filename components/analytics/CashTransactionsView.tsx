
import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpCircle,
  ArrowDownCircle,
  Percent,
  Receipt,
  ArrowRightLeft,
  Filter,
  Calendar,
  Plus,
  X,
  Trash2,
  Edit3,
  Coins,
  Sparkles
} from 'lucide-react';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart
} from 'recharts';
import { CashTransaction, CashTransactionType, UserProfile } from '../../types';
import { clsx } from 'clsx';

interface CashTransactionsViewProps {
  isDarkMode: boolean;
  userProfile: UserProfile;
  cashTransactions: CashTransaction[];
}

const TRANSACTION_TYPES: CashTransactionType[] = ['Deposit', 'Withdrawal', 'Interest', 'Fee', 'Transfer'];
type CashTransactionFormData = Omit<Partial<CashTransaction>, 'amount'> & {
  amount: string;
  type: CashTransactionType;
  date: string;
  description?: string;
};

export const CashTransactionsView: React.FC<CashTransactionsViewProps> = ({ isDarkMode, userProfile, cashTransactions }) => {
  const [activeSubTab, setActiveTab] = useState<'transactions' | 'insights'>('insights');
  const [timeFilter, setTimeFilter] = useState('Last 12 months');
  const [typeFilter, setTypeFilter] = useState<CashTransactionType | 'All'>('All');
  const [isCumulative, setIsCumulative] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<CashTransaction | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localTransactions, setLocalTransactions] = useState<CashTransaction[]>(cashTransactions);

  const [formData, setFormData] = useState<CashTransactionFormData>({
    type: 'Deposit',
    amount: '0',
    date: new Date().toISOString().split('T')[0],
    description: '',
  });

  const currencySymbol = userProfile?.currencySymbol || '$';

  useEffect(() => {
    setLocalTransactions(cashTransactions);
  }, [cashTransactions]);

  const normalizeAmount = (type: CashTransactionType, amount: number) => {
    if (!Number.isFinite(amount)) return 0;

    switch (type) {
      case 'Deposit':
      case 'Interest':
        return Math.abs(amount);
      case 'Withdrawal':
      case 'Fee':
        return -Math.abs(amount);
      case 'Transfer':
      default:
        return amount;
    }
  };

  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawAmount = Number(formData.amount);
    if (!formData.type || !Number.isFinite(rawAmount) || rawAmount === 0 || !formData.date) return;

    setIsSubmitting(true);
    try {
      const transactionToSave: CashTransaction = {
        id: '',
        type: formData.type,
        amount: normalizeAmount(formData.type, rawAmount),
        date: formData.date,
        description: formData.description,
      };

      const saved = {
        ...transactionToSave,
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      };
      setLocalTransactions(prev => [saved, ...prev.filter(t => t.id !== saved.id)]);
      setShowAddModal(false);
      setEditingTransaction(null);
      setFormData({
        type: 'Deposit',
        amount: '0',
        date: new Date().toISOString().split('T')[0],
        description: '',
      });
    } catch (error) {
      console.error('Failed to add transaction:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawAmount = Number(formData.amount);
    if (!editingTransaction || !formData.type || !Number.isFinite(rawAmount) || rawAmount === 0 || !formData.date) return;

    setIsSubmitting(true);
    try {
      const updatedTransaction: CashTransaction = {
        ...editingTransaction,
        type: formData.type,
        amount: normalizeAmount(formData.type, rawAmount),
        date: formData.date,
        description: formData.description,
      };
      setLocalTransactions(prev => prev.map(t => t.id === updatedTransaction.id ? updatedTransaction : t));
      setEditingTransaction(null);
      setShowAddModal(false);
      setFormData({
        type: 'Deposit',
        amount: '0',
        date: new Date().toISOString().split('T')[0],
        description: '',
      });
    } catch (error) {
      console.error('Failed to update transaction:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteTransaction = async (id: string) => {
    if (!confirm('Are you sure you want to delete this transaction?')) return;
    try {
      setLocalTransactions(prev => prev.filter(t => t.id !== id));
    } catch (error) {
      console.error('Failed to delete transaction:', error);
    }
  };

  const openEditModal = (transaction: CashTransaction) => {
    setEditingTransaction(transaction);
    setFormData({
      type: transaction.type,
      amount: String(transaction.amount),
      date: transaction.date,
      description: transaction.description,
    });
    setShowAddModal(true);
  };

  const filteredTransactions = useMemo(() => {
    return localTransactions.filter(t => {
      if (typeFilter !== 'All' && t.type !== typeFilter) return false;
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
  }, [localTransactions, typeFilter, timeFilter]);

  const hasTransactions = localTransactions.length > 0;

  const stats = useMemo(() => {
    const data = filteredTransactions;
    const deposits = data.filter(t => t.type === 'Deposit');
    const withdrawals = data.filter(t => t.type === 'Withdrawal');
    const interest = data.filter(t => t.type === 'Interest');
    const fees = data.filter(t => t.type === 'Fee');
    const transfers = data.filter(t => t.type === 'Transfer');

    return {
      deposits: { count: deposits.length, amount: deposits.reduce((acc, t) => acc + t.amount, 0) },
      withdrawals: { count: withdrawals.length, amount: withdrawals.reduce((acc, t) => acc + t.amount, 0) },
      interest: { count: interest.length, amount: interest.reduce((acc, t) => acc + t.amount, 0) },
      fees: { count: fees.length, amount: fees.reduce((acc, t) => acc + t.amount, 0) },
      transfers: { count: transfers.length, amount: transfers.reduce((acc, t) => acc + t.amount, 0) },
    };
  }, [filteredTransactions]);

const chartData = useMemo(() => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const now = new Date();
    const currentYear = now.getFullYear();
    const years = [currentYear - 2, currentYear - 1, currentYear];

    let cumulative = 0;
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
        cumulative += monthTotal;

        const entry: any = { name: monthYear };

        if (isCumulative) {
          entry.value = cumulative;
        } else {
          entry.value = monthTotal;
        }

        // Split by types for the lines
        TRANSACTION_TYPES.forEach(type => {
          const typeTotal = monthlyTransactions.filter(t => t.type === type).reduce((acc, t) => acc + t.amount, 0);
          entry[type] = typeTotal;
        });

        data.push(entry);
      });
    });

    return data;
  }, [isCumulative, filteredTransactions]);

  const formatLargeNumber = (num: number) => {
    const abs = Math.abs(num);
    if (abs >= 1000000) return `${num < 0 ? '-' : ''}${currencySymbol}${(abs / 1000000).toFixed(1)}M`;
    if (abs >= 1000) return `${num < 0 ? '-' : ''}${currencySymbol}${(abs / 1000).toFixed(1)}K`;
    return `${num < 0 ? '-' : ''}${currencySymbol}${abs.toFixed(2)}`;
  };

  const SummaryCard = ({ title, amount, count, icon: Icon, color }: any) => (
    <div
      className={clsx(
        "p-5 rounded-[24px] border flex flex-col gap-4 min-h-[122px]",
        isDarkMode ? "bg-black/40 border-zinc-800/50 backdrop-blur-md" : "bg-white border-slate-200 shadow-lg"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={clsx("p-2.5 rounded-xl shrink-0", isDarkMode ? "bg-black" : "bg-slate-100")}>
          <Icon size={18} style={{ color }} />
        </div>
        <div className="text-right min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest opacity-40 truncate">{count} {title}</p>
        </div>
      </div>
      <div className="space-y-1">
        <h3 className={clsx("text-2xl font-black tracking-tight", isDarkMode ? "text-zinc-100" : "text-slate-900")}>
          {formatLargeNumber(amount)}
        </h3>
        <p className="text-xs font-bold opacity-30 uppercase tracking-wider">{title}</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-8 pb-20">
      {/* Header & Local Tabs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-black tracking-tight">Cash Transactions</h2>
          <p className={clsx("text-xs font-semibold uppercase tracking-[0.18em]", isDarkMode ? "text-zinc-500" : "text-slate-500")}>
            Track deposits, withdrawals, interest, fees, and transfers
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

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-800/50 bg-black/20">
          <Filter size={14} className="opacity-40" />
          <span className="text-xs font-bold opacity-60">Type:</span>
          <select 
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
            className="bg-transparent text-xs font-black outline-none cursor-pointer"
          >
            <option>All</option>
            <option>Deposit</option>
            <option>Withdrawal</option>
            <option>Interest</option>
            <option>Fee</option>
            <option>Transfer</option>
          </select>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs font-bold opacity-40 uppercase tracking-widest">Cumulative</span>
          <button 
            onClick={() => setIsCumulative(!isCumulative)}
            className={clsx(
              "w-12 h-6 rounded-full relative",
              isCumulative ? "bg-brand" : "bg-black"
            )}
          >
          <div className="absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm" />
          </button>
        </div>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div
            className={clsx(
              "w-[min(94vw,48rem)] max-h-[90vh] overflow-y-auto p-6 md:p-8 rounded-2xl border shadow-xl",
              isDarkMode ? "bg-black border-zinc-800" : "bg-white border-slate-200"
            )}
          >
            <div className="flex items-start justify-between gap-4 mb-6">
              <h3 className="text-lg font-black tracking-tight">
                {editingTransaction ? 'Edit Transaction' : 'Add Transaction'}
              </h3>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setEditingTransaction(null);
                }}
                className={clsx(
                  "p-2 rounded-lg transition-colors",
                  isDarkMode ? "hover:bg-black text-zinc-300" : "hover:bg-slate-100 text-slate-600"
                )}
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
                  Deposits and Interest are saved as positive values. Withdrawals and Fees are saved as negative values.
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
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingTransaction(null);
                  }}
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
                  disabled={isSubmitting}
                  className={clsx(
                    "flex-1 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest",
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-5">
              <SummaryCard title="Deposits" amount={stats.deposits.amount} count={stats.deposits.count} icon={ArrowUpCircle} color="#10B981" />
              <SummaryCard title="Withdrawals" amount={stats.withdrawals.amount} count={stats.withdrawals.count} icon={ArrowDownCircle} color="#3B82F6" />
              <SummaryCard title="Interest" amount={stats.interest.amount} count={stats.interest.count} icon={Percent} color="#EC4899" />
              <SummaryCard title="Fees" amount={stats.fees.amount} count={stats.fees.count} icon={Receipt} color="#EF4444" />
              <SummaryCard title="Transfers" amount={stats.transfers.amount} count={stats.transfers.count} icon={ArrowRightLeft} color="#06B6D4" />
            </div>

            {/* Chart Section */}
            <div className={clsx(
              "p-6 md:p-8 rounded-[32px] border",
              isDarkMode ? "bg-black border-zinc-800 shadow-2xl" : "bg-white border-slate-200 shadow-xl"
            )}>
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between mb-6">
                <div>
                  <h3 className="text-xl font-black tracking-tight italic">TRANSACTION MOMENTUM</h3>
                  <p className="text-xs opacity-40 font-bold uppercase tracking-[0.2em] mt-1">Net capital flow over time</p>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg border self-start md:self-auto bg-black/50 border-zinc-800">
                  <div className="w-2 h-2 rounded-full bg-brand shadow-[0_0_10px_#8251EE]" />
                  <span className="text-[10px] font-black uppercase tracking-widest opacity-60 text-brand">Equity Balance</span>
                </div>
              </div>

              <div className="h-[340px] md:h-[380px] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%" minWidth={320} minHeight={340}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8251EE" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#8251EE" stopOpacity={0}/>
                      </linearGradient>
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
                      tickFormatter={(val) => `${currencySymbol}${val >= 1000 ? (val/1000) + 'K' : val}`}
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
                      formatter={(val: number) => [formatLargeNumber(val), 'Balance']}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="value" 
                      stroke="#8251EE" 
                      strokeWidth={4}
                      fillOpacity={1} 
                      fill="url(#colorValue)" 
                      animationDuration={0}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-3 mt-6 pt-5 border-t border-zinc-800/50">
                 {[
                   { label: 'Deposits', color: '#10B981' },
                   { label: 'Withdrawals', color: '#3B82F6' },
                   { label: 'Interest', color: '#EC4899' },
                   { label: 'Fee', color: '#EF4444' },
                   { label: 'Transfer', color: '#06B6D4' },
                 ].map(l => (
                   <div key={l.label} className="flex items-center gap-2">
                     <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: l.color }} />
                     <span className="text-[10px] font-black uppercase tracking-widest opacity-40">{l.label}</span>
                   </div>
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
                    This page keeps transactions local to this tab only.
                  </p>
                </div>
                <div className="md:ml-auto">
                  <button
                    onClick={() => {
                      setEditingTransaction(null);
                      setFormData({
                        type: 'Deposit',
                        amount: '0',
                        date: new Date().toISOString().split('T')[0],
                        description: '',
                      });
                      setShowAddModal(true);
                    }}
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
                      <span className={clsx(
                        "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider",
                        t.type === 'Deposit' && "bg-emerald-500/10 text-emerald-500",
                        t.type === 'Withdrawal' && "bg-blue-500/10 text-blue-500",
                        t.type === 'Fee' && "bg-rose-500/10 text-rose-500",
                        t.type === 'Interest' && "bg-pink-500/10 text-pink-500",
                        t.type === 'Transfer' && "bg-cyan-500/10 text-cyan-500"
                      )}>
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
                  Your current filters hide every transaction in this tab. Adjust the date or type filter to see results.
                </p>
                <button
                  onClick={() => {
                    setTimeFilter('All Time');
                    setTypeFilter('All');
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
                  Add a transaction to start tracking deposits, withdrawals, fees, and transfers inside this tab.
                </p>
                <button
                  onClick={() => {
                    setEditingTransaction(null);
                    setFormData({
                      type: 'Deposit',
                      amount: '0',
                      date: new Date().toISOString().split('T')[0],
                      description: '',
                    });
                    setShowAddModal(true);
                  }}
                  className={clsx(
                    "mt-6 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-[0.18em]",
                    isDarkMode ? "bg-brand text-white" : "bg-brand text-white"
                  )}
                >
                  <Plus size={15} />
                  Add Transaction
                </button>
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
