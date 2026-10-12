import React, { useState, useMemo, useEffect } from 'react';
import { 
  Search, List, X, Upload, Image as ImageIcon, TrendingUp, TrendingDown, 
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, Activity, 
  Brain, ShieldCheck, ArrowUpRight, ArrowDownRight, Edit3,
  ChevronDown, Clock, CheckCircle2, Trash2, CheckSquare, Square, 
  Trophy, CheckCircle, LayoutPanelTop, Target, Star, Eye, Layers, Link, Unlink, RefreshCw, Mic,
  Pencil, Check, XCircle
} from 'lucide-react';
import { Trade, UserProfile, Portfolio } from '../types';
import { haptic } from '../lib/haptics';
import { getSASTDateTime, getDefaultTimezone } from '../lib/timeUtils';
import { getPipSize } from '../lib/trade-calculations';
import { sanitizeRichTextHtml } from '../lib/htmlSanitizer';
import { JournalSkeleton, EmptyState } from './ui/Skeleton';
import TradeChartView from './TradeChartView';
import { AudioNote, isAudioSource } from './ui/AudioNote';
import ConfirmationModal from './ConfirmationModal';
import { LinkTradesCard } from './journal/link-trades/LinkTradesCard';
import { TradeChecklistPanel, GradePill } from './discipline/TradeChecklistPanel';
import { useChecklistTemplates } from '../lib/useChecklistTemplates';
import { computeAdherence, derivePlanAdherence, gradeFor, isViolationTag } from '../lib/disciplineChecklist';

// Set false to fall back to the legacy Link Trades modal below (kept intact).
const USE_NEW_LINK_CARD = true;

interface JournalProps {
  isDarkMode: boolean;
  trades: Trade[];
  onUpdateTrade: (trade: Trade) => void;
  onBatchUpdateTrades: (trades: Trade[]) => Promise<boolean>;
  onDeleteTrades: (tradeIds: string[]) => void;
  onEditTrade: (trade: Trade) => void;
  userProfile: UserProfile;
  onViewChange: (view: string) => void;
  isLoading?: boolean;
  offlineQueue?: Trade[];
  isDemoMode?: boolean;
  portfolios?: Portfolio[];
  activePortfolioId?: string;
  defaultPortfolioId?: string;
  activePortfolioName?: string;
  onSelectPortfolioId?: (id: string) => void;
}

interface GroupedTrade {
    type: 'standalone' | 'setup' | 'pending';
    setupId?: string;
    setupName?: string;
    trades: Trade[];
    date: string; // Latest trade date
    id: string; // for React key
}

const formatDuration = (openTime?: string, closeTime?: string) => {
    if (!openTime || !closeTime) return null;
    try {
        const startStr = openTime.includes(' ') && !openTime.includes('T') ? openTime.replace(' ', 'T') : openTime;
        const endStr = closeTime.includes(' ') && !closeTime.includes('T') ? closeTime.replace(' ', 'T') : closeTime;
        
        const start = new Date(startStr);
        const end = new Date(endStr);
        
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
        
        const diff = end.getTime() - start.getTime();
        if (diff < 0) return '0s';
        
        const totalSeconds = Math.floor(diff / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        
        let parts = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (seconds > 0 || (hours === 0 && minutes === 0)) parts.push(`${seconds}s`);
        
        return parts.join(' ');
    } catch (e) {
        return null;
    }
};

const safePnL = (value: unknown): number => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
};

// Numeric-safe price formatting — DB rows can carry null/undefined prices and
// calling .toFixed() on those threw and blanked the whole detail panel.
const safePrice = (value: unknown, fallback = '—'): string => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n.toFixed(2) : fallback;
};

const stripTime = (date?: string): string => (typeof date === 'string' ? date.slice(0, 10) : '');

// `YYYY-MM-DD` parsed by `new Date()` is read as UTC midnight, which shifts the
// weekday backwards by one day for SAST (UTC+2) users. Parse the parts locally.
const weekdayIndex = (date?: string): number | null => {
    const parts = stripTime(date).split('-').map(Number);
    if (parts.length !== 3 || parts.some(p => !Number.isFinite(p))) return null;
    const [y, m, d] = parts;
    if (y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    return new Date(y, m - 1, d).getDay();
};

// Groups sort by "date + time"; a missing/garbage `time` produced `Invalid Date`
// (NaN) and scrambled the whole list. Fall back to date-only ordering.
const groupSortTime = (group: GroupedTrade): number => {
    const dateStr = stripTime(group.date);
    const timeStr = group.trades[0]?.time;
    const time = typeof timeStr === 'string' && /^\d{1,2}:\d{2}/.test(timeStr) ? timeStr.slice(0, 5) : '00:00';
    const parsed = new Date(`${dateStr}T${time}:00`);
    const fallback = new Date(`${dateStr}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? fallback.getTime() : parsed.getTime();
};

// Break-even / flat day threshold. The old hardcoded `$5` treated every R5 loss
// as a "winning day" for ZAR accounts, so scale it with the account currency.
const BE_PNL_THRESHOLD_MAJOR = 5;
const bePnlThreshold = (currencySymbol?: string): number => {
    const symbol = (currencySymbol || '').trim();
    if (symbol === 'R') return 100; // ~US$5 at prevailing ZAR rates
    return BE_PNL_THRESHOLD_MAJOR;
};

const PLATFORM_TAGS = ['cTrader', 'MT5', 'Others'];

const getStrategyTags = (trade: Trade) => (trade.tags || []).filter(t => !PLATFORM_TAGS.includes(t));

const buildSetupName = (trades: Trade[]) => {
    const uniquePairs = Array.from(new Set(trades.map(trade => trade.pair).filter(Boolean)));
    const pairLabel = uniquePairs.length === 0
        ? 'Linked'
        : uniquePairs.length === 1
            ? uniquePairs[0]
            : uniquePairs.length === 2
                ? `${uniquePairs[0]} + ${uniquePairs[1]}`
                : `${uniquePairs[0]} + ${uniquePairs[1]} +${uniquePairs.length - 2}`;

    return `${pairLabel} ${trades.length}-Trade Setup`;
};

const buildSetupId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `setup-${crypto.randomUUID()}`;
    }

    return `setup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const ReadOnlyStarRating = ({ rating, isDarkMode }: { rating: number, isDarkMode: boolean }) => (
  <div className="flex items-center gap-0.5">
    {[1, 2, 3, 4, 5].map((star) => (
      <Star 
        key={star} 
        size={12} 
        className={`${
          star <= rating 
            ? 'text-amber-400 fill-amber-400' 
            : isDarkMode ? 'text-zinc-700' : 'text-slate-200'
        }`} 
      />
    ))}
  </div>
);

type DetailTab = 'overview' | 'chart' | 'journal' | 'rules';

interface MobileTradeDetailSheetProps {
  trade: Trade;
  isDarkMode: boolean;
  userProfile: UserProfile;
  isDemoMode?: boolean;
  onClose: () => void;
  onEdit: (trade: Trade) => void;
  onDelete: (tradeId: string) => void;
  onUpdateTrade: (trade: Trade) => void;
  onViewChange: (view: string) => void;
  editingComment: { tradeId: string; field: 'notes' | 'exitComment'; value: string } | null;
  onBeginCommentEdit: (trade: Trade, field: 'notes' | 'exitComment') => void;
  onSaveCommentEdit: (trade: Trade) => void;
  onCancelCommentEdit: () => void;
  onCommentChange: (value: string) => void;
  onPreviewImage: (url: string, title: string) => void;
  onUploadImage: (trade: Trade, type: 'before' | 'after', e: React.ChangeEvent<HTMLInputElement>) => void;
  onDeleteImage: (trade: Trade, type: 'before' | 'after') => void;
}

// Rules tab body: interactive discipline checklist for one trade.
// Persists live via onUpdateTrade (same pattern as chart candles) — every
// tap recomputes adherence, grade and the derived planAdherence tier.
const RulesTabBody: React.FC<{
  trade: Trade;
  isDarkMode: boolean;
  onUpdateTrade: (trade: Trade) => void;
  onViewChange: (view: string) => void;
}> = ({ trade, isDarkMode, onUpdateTrade, onViewChange }) => {
  const { activeTemplate } = useChecklistTemplates();
  const checks = trade.checklistChecks ?? {};
  const tags = trade.behaviorTags ?? [];
  const hasSnapshot = !!trade.checklistChecks;

  const persist = (nextChecks: Record<string, boolean>, nextTags: string[]) => {
    const rate = computeAdherence(nextChecks, activeTemplate.items) ?? 0;
    onUpdateTrade({
      ...trade,
      checklistTemplateId: activeTemplate.id,
      checklistChecks: nextChecks,
      adherenceRate: rate,
      executionGrade: gradeFor(rate),
      planAdherence: derivePlanAdherence(rate),
      behaviorTags: nextTags,
    });
  };

  if (!activeTemplate.items.length) {
    return (
      <div className={`rounded-xl border-0 p-4 flex flex-col items-center text-center gap-1.5 ${isDarkMode ? 'bg-[#0a0a0a] text-zinc-500' : 'bg-slate-50 text-slate-400'}`}>
        <p className="text-[13px] font-bold">No rules yet</p>
        <p className="text-[11px] leading-snug">Build your checklist first — then grade this trade.</p>
        <button
          onClick={() => { try { haptic.selection(); } catch {} onViewChange('discipline'); }}
          className="mt-1 px-4 py-2 rounded-lg text-xs font-bold bg-[#FF4F01] text-white touch-manipulation min-h-[36px]"
        >
          Open Rules
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {!hasSnapshot && (
        <p className={`text-[10px] leading-snug ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>
          Tap rules to grade this trade.
        </p>
      )}
      <TradeChecklistPanel
        template={activeTemplate}
        checks={checks}
        behaviorTags={tags}
        onChecksChange={(c) => persist(c, tags)}
        onTagsChange={(t) => persist(checks, t)}
        isDarkMode={isDarkMode}
      />
    </div>
  );
};

// Full-screen mobile trade detail sheet (header + tab pills + bottom actions).
const MobileTradeDetailSheet: React.FC<MobileTradeDetailSheetProps> = ({
  trade, isDarkMode, userProfile, isDemoMode, onClose, onEdit, onDelete, onUpdateTrade, onViewChange,
  editingComment, onBeginCommentEdit, onSaveCommentEdit, onCancelCommentEdit, onCommentChange,
  onPreviewImage, onUploadImage, onDeleteImage,
}) => {
  const [tab, setTab] = useState<DetailTab>('overview');
  const [chartSubTab, setChartSubTab] = useState<'candles' | 'screenshots'>('candles');
  const pnl = safePnL(trade.pnl);
  const currSym = userProfile?.currencySymbol || '$';
  const isLong = trade.direction === 'Long';
  const tabs: { id: DetailTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'chart', label: 'Chart' },
    { id: 'journal', label: 'Journal' },
    { id: 'rules', label: 'Rules' },
  ];

  const pipSize = getPipSize(trade.assetType, trade.pair);
  const hasExit = Number.isFinite(Number(trade.exitPrice));
  const pipMovement = hasExit && Number.isFinite(Number(trade.entryPrice)) ? (isLong ? Number(trade.exitPrice) - Number(trade.entryPrice) : Number(trade.entryPrice) - Number(trade.exitPrice)) / pipSize : 0;

  const Cell = ({ label, value, valueClassName = '', align = 'left' }: { label: string; value: React.ReactNode; valueClassName?: string; align?: 'left' | 'right' }) => (
    <div className={align === 'right' ? 'text-right' : ''}>
      <p className={`text-[11px] font-medium tracking-wide ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>{label}</p>
      <p className={`text-[14px] font-bold tracking-tight mt-0.5 ${valueClassName || (isDarkMode ? 'text-zinc-200' : 'text-slate-800')}`}>{value}</p>
    </div>
  );

  const renderNoteEditor = (field: 'notes' | 'exitComment', content: string | undefined, placeholder: string, emptyText: string) => {
    const isEditing = editingComment?.tradeId === trade.id && editingComment.field === field;
    return (
      <div>
        {isEditing ? (
          <div className="space-y-2">
            <textarea
              value={editingComment.value}
              onChange={(e) => onCommentChange(e.target.value)}
              className={`w-full min-h-24 resize-none rounded-xl border px-3 py-2 text-sm outline-none ${isDarkMode ? 'bg-black border-zinc-800 text-zinc-100' : 'bg-slate-50 border-slate-200 text-slate-900'}`}
              placeholder={placeholder}
            />
            <div className="flex items-center justify-end gap-2">
              <button onClick={onCancelCommentEdit} className={`px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-widest ${isDarkMode ? 'bg-zinc-900 text-zinc-300' : 'bg-slate-100 text-slate-600'}`}>Cancel</button>
              <button onClick={() => onSaveCommentEdit(trade)} className="px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-widest bg-blue-600 text-white">Save</button>
            </div>
          </div>
        ) : content ? (
          <div className="min-w-0 break-words text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: sanitizeRichTextHtml(content) }} />
        ) : (
          <p className="text-sm opacity-50 italic">{emptyText}</p>
        )}
        {!isEditing && (
          <button onClick={() => onBeginCommentEdit(trade, field)} className={`mt-2 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-widest ${isDarkMode ? 'bg-zinc-900 text-zinc-300' : 'bg-slate-100 text-slate-600'}`}>Edit</button>
        )}
      </div>
    );
  };

  return (
    <div className={`fixed inset-0 z-[300] flex flex-col ${isDarkMode ? 'bg-[#050505] text-white' : 'bg-white text-slate-900'}`}>
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-center gap-3 shrink-0">
        <div className="flex-1 min-w-0 flex items-baseline gap-2">
          <h2 className="text-[26px] font-black tracking-tight truncate">{trade.pair}</h2>
          <span className={`text-[15px] font-bold shrink-0 ${isLong ? 'text-emerald-400' : 'text-[#ff4f64]'}`}>{isLong ? 'Buy (Long)' : 'Sell (Short)'}</span>
        </div>
        <button onClick={onClose} aria-label="Close" className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${isDarkMode ? 'text-zinc-300' : 'text-slate-600'}`}>
          <X size={24} />
        </button>
      </div>
      {/* Tabs */}
      <div className="px-4 shrink-0">
        <div className={`flex items-center gap-1 p-1 rounded-2xl overflow-x-auto no-scrollbar ${isDarkMode ? 'bg-zinc-900/80' : 'bg-slate-100'}`}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => { try { haptic.selection(); } catch {} setTab(t.id); }}
              className={`flex-1 whitespace-nowrap px-4 py-2.5 rounded-xl text-[15px] font-bold transition-all ${tab === t.id ? 'bg-[#FF4F01] text-white' : (isDarkMode ? 'text-zinc-400' : 'text-slate-500')}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-5 py-4 pb-28">
        {tab === 'overview' && (
          <div className={`divide-y ${isDarkMode ? 'divide-zinc-800/70' : 'divide-slate-100'}`}>
            <div className="grid grid-cols-2 gap-3 pb-4">
              <Cell label="Net P&L" value={`${pnl > 0 ? '+' : pnl < 0 ? '-' : ''}${currSym}${Math.abs(pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} valueClassName={pnl > 0 ? 'text-emerald-400' : pnl < 0 ? 'text-[#ff4f64]' : ''} />
              <Cell align="right" label="R:R" value={trade.rr > 0 ? `1 : ${trade.rr}` : '—'} />
            </div>
            <div className="grid grid-cols-2 gap-3 py-4">
              <Cell label="Entry" value={safePrice(trade.entryPrice)} />
              <Cell align="right" label="Exit" value={trade.exitPrice === undefined || trade.exitPrice === null ? '—' : safePrice(trade.exitPrice)} />
            </div>
            <div className="grid grid-cols-2 gap-3 py-4">
              <Cell label="Stop Loss" value={safePrice(trade.stopLoss)} valueClassName="text-[#ff4f64]" />
              <Cell align="right" label="Take Profit" value={safePrice(trade.takeProfit)} valueClassName="text-emerald-400" />
            </div>
            <div className="grid grid-cols-2 gap-3 py-4">
              <Cell label="Volume" value={`${trade.lots} Lots`} />
              <Cell align="right" label="Pip Movement" value={hasExit ? `${pipMovement >= 0 ? '+' : ''}${pipMovement.toFixed(2)}` : '—'} valueClassName={hasExit ? (pipMovement >= 0 ? 'text-emerald-400' : 'text-[#ff4f64]') : ''} />
            </div>
            <div className="grid grid-cols-2 gap-3 py-4">
              <Cell label="Date" value={trade.date} />
              <Cell align="right" label="Session" value={trade.session || '—'} />
            </div>
            {(trade.openTime || trade.closeTime) && (
              <div className="grid grid-cols-2 gap-3 py-4">
                <Cell label="Opened" value={trade.openTime ? new Date(trade.openTime).toLocaleString() : '—'} />
                <Cell align="right" label="Closed" value={trade.closeTime ? new Date(trade.closeTime).toLocaleString() : '—'} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 py-4">
              <Cell label="Mindset" value={trade.mindset || 'Neutral'} />
              <div className="text-right">
                <p className={`text-[11px] font-medium tracking-wide ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>Rating</p>
                <div className="mt-1 flex justify-end"><ReadOnlyStarRating rating={trade.rating || 0} isDarkMode={isDarkMode} /></div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 py-4">
              <Cell label="Type" value={trade.assetType || '—'} />
              <Cell align="right" label="Duration" value={trade.openTime && trade.closeTime ? formatDuration(trade.openTime, trade.closeTime) : '—'} />
            </div>
          </div>
        )}
        {tab === 'chart' && (
          <div className="space-y-4">
            {/* Sub-tabs for Candlestick vs Screenshots */}
            <div className={`flex items-center gap-1.5 p-1 rounded-xl ${isDarkMode ? 'bg-zinc-900/60 border border-zinc-800/60' : 'bg-slate-100 border border-slate-200'}`}>
              <button
                type="button"
                onClick={() => { try { haptic.selection(); } catch {} setChartSubTab('candles'); }}
                className={`flex-1 py-1.5 px-3 rounded-lg text-[12px] font-bold tracking-wide transition-all ${
                  chartSubTab === 'candles'
                    ? 'bg-zinc-800 text-white shadow-sm border border-white/10'
                    : isDarkMode ? 'text-zinc-400 hover:text-zinc-200' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Candlestick
              </button>
              <button
                type="button"
                onClick={() => { try { haptic.selection(); } catch {} setChartSubTab('screenshots'); }}
                className={`flex-1 py-1.5 px-3 rounded-lg text-[12px] font-bold tracking-wide transition-all ${
                  chartSubTab === 'screenshots'
                    ? 'bg-zinc-800 text-white shadow-sm border border-white/10'
                    : isDarkMode ? 'text-zinc-400 hover:text-zinc-200' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Screenshots
              </button>
            </div>

            {/* Candlestick Canvas Section */}
            {chartSubTab === 'candles' && (
              <div className={`h-[480px] rounded-2xl overflow-hidden border ${isDarkMode ? 'border-zinc-800' : 'border-slate-200'}`}>
                <TradeChartView trade={trade} isDarkMode={isDarkMode} onSaveCandles={(candles, tf) => { onUpdateTrade({ ...trade, chartCandles: candles, chartTimeframe: tf }); }} />
              </div>
            )}

            {/* Screenshots Section */}
            {chartSubTab === 'screenshots' && (
              <div className="space-y-3 pt-1">
                <p className={`text-[12px] font-medium ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Before & After Screenshots</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[{ id: 'before', label: 'Before Screenshot', data: trade.beforeScreenshot }, { id: 'after', label: 'After Screenshot', data: trade.afterScreenshot }].map((slot) => (
                    <div key={slot.id} className={`rounded-2xl overflow-hidden border ${isDarkMode ? 'border-zinc-800 bg-zinc-950/60' : 'border-slate-200 bg-slate-50'}`}>
                      <div className="px-3.5 py-2 border-b border-white/5 flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-zinc-400">{slot.label}</span>
                        {slot.data && (
                          <button
                            type="button"
                            onClick={() => onDeleteImage(trade, slot.id as any)}
                            className="text-[11px] text-rose-400 hover:text-rose-300"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      {slot.data ? (
                        <button className="block w-full" onClick={() => onPreviewImage(slot.data!, `${trade.pair} - ${slot.label}`)}>
                          <img src={slot.data} alt={slot.label} className="w-full h-48 object-cover" />
                        </button>
                      ) : (
                        <label className="flex flex-col items-center justify-center h-40 cursor-pointer opacity-60 hover:opacity-100 transition-opacity">
                          <span className="text-[11px] font-bold uppercase tracking-widest">{slot.label} · Tap to upload</span>
                          <input type="file" accept="image/*" className="hidden" aria-label={`Upload ${slot.label}`} onChange={(e) => onUploadImage(trade, slot.id as any, e)} />
                        </label>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {tab === 'journal' && (
          <div className={`divide-y ${isDarkMode ? 'divide-zinc-800/70' : 'divide-slate-100'}`}>
            <div className="pb-4">
              <p className={`text-[11px] font-medium mb-2 ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>Entry Note</p>
              {renderNoteEditor('notes', trade.notes, 'Edit entry comment...', 'No entry comments recorded.')}
            </div>
            <div className="py-4">
              <p className={`text-[11px] font-medium mb-2 ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>Exit Note</p>
              {renderNoteEditor('exitComment', trade.exitComment, 'Edit exit comment...', 'No exit comments recorded.')}
            </div>
            <div className="py-4">
              <p className={`text-[11px] font-medium mb-2 ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>Voice Note</p>
              {trade.voiceNote ? (
                isAudioSource(trade.voiceNote) ? (
                  <AudioNote src={trade.voiceNote} className="w-full h-10" />
                ) : (
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{trade.voiceNote}</p>
                )
              ) : (
                <p className="text-sm opacity-50 italic">No voice note.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 py-4">
              <Cell label="Mistake" value={trade.tradingMistake || 'None'} />
              <Cell align="right" label="Plan" value={trade.planAdherence || 'N/A'} />
            </div>
            {(trade.executionGrade || trade.adherenceRate != null) && (
              <div className="grid grid-cols-2 gap-3 py-4">
                <div>
                  <p className={`text-[11px] font-medium tracking-wide ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>Grade</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <GradePill grade={trade.executionGrade} adherenceRate={trade.adherenceRate} size="sm" />
                    {trade.adherenceRate != null && (
                      <span className={`text-[14px] font-bold ${isDarkMode ? 'text-zinc-200' : 'text-slate-800'}`}>{trade.adherenceRate}%</span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <Cell align="right" label="Violations" value={(trade.behaviorTags ?? []).filter(isViolationTag).join(', ') || 'None'} />
                </div>
              </div>
            )}
          </div>
        )}
        {tab === 'rules' && (
          <RulesTabBody trade={trade} isDarkMode={isDarkMode} onUpdateTrade={onUpdateTrade} onViewChange={onViewChange} />
        )}
      </div>

    </div>
  );
};

const MiniCalendar = ({ year, month, trades, isDarkMode, onClick, currencySymbol }: any) => {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();
    const blanks = Array.from({ length: firstDay }, (_, i) => i);
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const beThreshold = bePnlThreshold(currencySymbol);

    const monthTrades = trades.filter((t: Trade) => {
        return t.date.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`);
    });

    const getDayStyle = (day: number) => {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayTrades = monthTrades.filter((t: Trade) => t.date === dateStr);
        if (dayTrades.length === 0) return { bg: isDarkMode ? 'text-zinc-500 hover:bg-black hover:text-zinc-200' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600', text: '' };
        
        const pnl = dayTrades.reduce((acc: number, t: Trade) => acc + safePnL(t.pnl), 0);
        
        // Match main calendar logic (shared currency-aware threshold)
        if (Math.abs(pnl) < beThreshold) return { bg: 'bg-zinc-400/80 shadow-sm shadow-zinc-400/10', text: 'text-white font-bold' };
        if (pnl > 0) return { bg: 'bg-emerald-700/65 shadow-sm shadow-emerald-900/10', text: 'text-white font-bold' };
        if (pnl < 0) return { bg: 'bg-rose-700/65 shadow-sm shadow-rose-900/10', text: 'text-white font-bold' };
        
        return { bg: 'bg-zinc-400', text: 'text-white font-bold' };
    };

    return (
        <div onClick={onClick} className={`p-5 rounded-2xl border cursor-pointer transition-all hover:scale-[1.02] hover:shadow-xl ${isDarkMode ? 'bg-[#000000] border-[#27272a]' : 'bg-white border-slate-100 shadow-md'}`}>
            <div className="flex justify-between items-center mb-4">
                <h4 className={`text-sm font-bold ${isDarkMode ? 'text-zinc-200' : 'text-slate-700'}`}>{new Date(year, month).toLocaleString('default', { month: 'long' })}</h4>
                {monthTrades.length > 0 && (<span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isDarkMode ? 'bg-black text-zinc-400' : 'bg-slate-100 text-slate-500'}`}>{monthTrades.length} Trades</span>)}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
                {['S','M','T','W','T','F','S'].map((d, i) => (<div key={`${d}-${i}`} className="text-[9px] font-bold opacity-30 text-center">{d}</div>))}
                {blanks.map(b => <div key={`b-${b}`} />)}
                {days.map(d => { 
                    const style = getDayStyle(d); 
                    return (<div key={d} className={`aspect-square rounded-md flex items-center justify-center text-[10px] transition-colors ${style.bg} ${style.text}`}>{d}</div>) 
                })}
            </div>
        </div>
    );
};

const CalendarView = ({ isDarkMode, trades, userProfile, onSelectTrade }: { isDarkMode: boolean, trades: Trade[], userProfile: UserProfile, onSelectTrade: (trade: Trade) => void }) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [mode, setMode] = useState<'month' | 'year'>('month');
    const [isSummaryOpen, setIsSummaryOpen] = useState(false);
    const [selectedDateStr, setSelectedDateStr] = useState<string | null>(null);
    // Swipe navigation refs for whole calendar canvas (mobile)
    const calSwipeX = React.useRef<number | null>(null);
    const calSwipeY = React.useRef<number | null>(null);
    
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfMonth = new Date(year, month, 1).getDay(); 
    const blanks = Array.from({ length: firstDayOfMonth }, (_, i) => i);
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    
    const prev = () => { if (mode === 'month') setCurrentDate(new Date(year, month - 1, 1)); else setCurrentDate(new Date(year - 1, month, 1)); };
    const next = () => { if (mode === 'month') setCurrentDate(new Date(year, month + 1, 1)); else setCurrentDate(new Date(year + 1, month, 1)); };
    const getTradesForDay = (day: number) => { const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; return trades.filter(t => t.date === dateStr); };

    const { monthlyStats, weekdayStats } = useMemo(() => {
        const currentMonthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
        const monthTrades = trades.filter(t => t.date.startsWith(currentMonthStr));
        const totalPnL = monthTrades.reduce((acc, t) => acc + safePnL(t.pnl), 0);
        const winTrades = monthTrades.filter(t => t.result === 'Win').length;
        const totalCount = monthTrades.length;
        // Pending/BE trades aren't decided outcomes, so counting them in the
        // denominator silently deflated the win rate.
        const decidedTrades = monthTrades.filter(t => t.result === 'Win' || t.result === 'Loss').length;
        const winRateTotal = decidedTrades > 0 ? (winTrades / decidedTrades) * 100 : 0;
        const lossTrades = monthTrades.filter(t => t.result === 'Loss').length;

        const dayMap: Record<string, number> = {};
        monthTrades.forEach(t => { dayMap[t.date] = (dayMap[t.date] || 0) + safePnL(t.pnl); });
        const winDays = Object.values(dayMap).filter(p => p > 0).length;
        const lossDays = Object.values(dayMap).filter(p => p < 0).length;

        const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const wdStats = weekdayNames.map((name, index) => {
            const dayTrades = monthTrades.filter(t => weekdayIndex(t.date) === index);
            const netProfits = dayTrades.reduce((acc, t) => acc + safePnL(t.pnl), 0);
            const totalProfits = dayTrades.reduce((acc, t) => safePnL(t.pnl) > 0 ? acc + safePnL(t.pnl) : acc, 0);
            const totalLoss = dayTrades.reduce((acc, t) => safePnL(t.pnl) < 0 ? acc + safePnL(t.pnl) : acc, 0);
            const wCount = dayTrades.filter(t => t.result === 'Win').length;
            const lCount = dayTrades.filter(t => t.result === 'Loss').length;
            const tCount = dayTrades.length;
            const decided = wCount + lCount;
            const wRate = decided > 0 ? (wCount / decided) * 100 : 0;
            const lRate = decided > 0 ? (lCount / decided) * 100 : 0;

            return { name, netProfits, totalProfits, totalLoss, wRate, lRate, tCount };
        });

        return { 
            monthlyStats: { totalPnL, winRate: winRateTotal, totalCount, winTrades, lossTrades, winDays, lossDays },
            weekdayStats: wdStats
        };
    }, [trades, year, month]);

    const isToday = (day: number) => { 
        const currentSASTDate = getSASTDateTime().date;
        const targetDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        return currentSASTDate === targetDate;
    };

    const dateStrForDay = (day: number) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // Day drawer (replay-speed sheet pattern): Escape to close + lock body scroll.
    useEffect(() => {
        if (!selectedDateStr) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedDateStr(null); };
        window.addEventListener('keydown', onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [selectedDateStr]);

    const selectedDayTrades = useMemo(() => {
        if (!selectedDateStr) return [];
        return trades
            .filter(t => t.date === selectedDateStr)
            .slice()
            .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    }, [trades, selectedDateStr]);

    const selectedDayPnL = useMemo(
        () => selectedDayTrades.reduce((acc, t) => acc + safePnL(t.pnl), 0),
        [selectedDayTrades]
    );

    const selectedDateLabel = useMemo(() => {
        if (!selectedDateStr) return '';
        try {
            return new Date(`${selectedDateStr}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        } catch { return selectedDateStr; }
    }, [selectedDateStr]);

    const formatSheetPnL = (pnl: number) => {
        const sym = userProfile?.currencySymbol || '$';
        if (pnl < 0) return `-${sym}${Math.abs(pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        if (pnl > 0) return `+${sym}${Math.abs(pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        return `${sym}0.00`;
    };

    return (
        <div className="h-full flex flex-col">
            <div className={`flex flex-col md:flex-row md:items-center justify-between px-4 py-2.5 gap-3 border-b shrink-0 ${isDarkMode ? 'border-[#27272a] bg-[#000000]' : 'border-slate-100 bg-white'}`}>
                <div className="flex items-center gap-3 order-2 md:order-1 w-full md:w-auto justify-between md:justify-start">
                    <div className={`flex-1 flex items-center justify-center p-0.5 rounded-lg border h-[30px] ${isDarkMode ? 'bg-[#000000] border-[#27272a]' : 'bg-slate-50 border-slate-200'}`}>
                        <button onClick={prev} className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all flex items-center ${isDarkMode ? 'hover:bg-white hover:bg-opacity-10 text-zinc-400' : 'hover:bg-black hover:bg-opacity-10 text-slate-500'}`}><ChevronLeft size={12} /></button>
                        <span className={`w-32 text-center font-bold text-[11px] ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{mode === 'month' ? currentDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : year}</span>
                        <button onClick={next} className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all flex items-center ${isDarkMode ? 'hover:bg-white hover:bg-opacity-10 text-zinc-400' : 'hover:bg-black hover:bg-opacity-10 text-slate-500'}`}><ChevronRight size={12} /></button>
                    </div>
                    <div className={`flex-1 flex rounded-lg border overflow-hidden p-0.5 gap-0.5 h-[30px] items-center justify-center ${isDarkMode ? 'border-[#27272a] bg-[#000000]' : 'border-slate-200 bg-slate-50'}`}>
                         <button onClick={() => setMode('month')} className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${mode === 'month' ? (isDarkMode ? 'bg-black text-white shadow' : 'bg-white text-slate-900 shadow') : 'text-zinc-500'}`}>Month</button>
                         <button onClick={() => setMode('year')} className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${mode === 'year' ? (isDarkMode ? 'bg-black text-white shadow' : 'bg-white text-slate-900 shadow') : 'text-zinc-500'}`}>Year</button>
                    </div>
                </div>
                {mode === 'month' && (
                    <div className="grid grid-cols-3 gap-x-2 gap-y-3 py-1 order-1 md:order-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end sm:gap-x-4 sm:gap-y-1.5 sm:py-0 animate-in fade-in slide-in-from-right-4">
                        <div className="flex flex-col sm:items-end">
                            <span className="text-[9px] uppercase font-bold opacity-50 tracking-wider">Winning Days</span>
                            <div className="flex items-center gap-1">
                                <Trophy size={12} className="text-amber-500" />
                                <span className={`font-bold text-xs ${isDarkMode ? 'text-zinc-200' : 'text-slate-700'}`}>{monthlyStats.winDays}</span>
                            </div>
                        </div>
                        <div className="flex flex-col sm:items-end">
                            <span className="text-[9px] uppercase font-bold opacity-50 tracking-wider">Losing Days</span>
                            <div className="flex items-center gap-1">
                                <TrendingDown size={12} className="text-rose-500" />
                                <span className={`font-bold text-xs ${isDarkMode ? 'text-zinc-200' : 'text-slate-700'}`}>{monthlyStats.lossDays}</span>
                            </div>
                        </div>
                        <div className="flex flex-col sm:items-end">
                            <span className="text-[9px] uppercase font-bold opacity-50 tracking-wider">Winning Trades</span>
                            <div className="flex items-center gap-1">
                                <CheckCircle size={12} className="text-emerald-500" />
                                <span className={`font-bold text-xs ${isDarkMode ? 'text-zinc-200' : 'text-slate-700'}`}>{monthlyStats.winTrades}</span>
                            </div>
                        </div>
                        <div className="flex flex-col sm:items-end">
                            <span className="text-[9px] uppercase font-bold opacity-50 tracking-wider">Losing Trades</span>
                            <div className="flex items-center gap-1">
                                <XCircle size={12} className="text-rose-500" />
                                <span className={`font-bold text-xs ${isDarkMode ? 'text-zinc-200' : 'text-slate-700'}`}>{monthlyStats.lossTrades}</span>
                            </div>
                        </div>
                        <div className={`w-px h-6 hidden lg:block ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-200'}`} />
                        <div className="flex flex-col sm:items-end">
                            <span className="text-[9px] uppercase font-bold opacity-50 tracking-wider">Net P&L</span>
                            <span className={`font-mono font-bold text-sm ${monthlyStats.totalPnL > 0 ? 'text-teal-500' : monthlyStats.totalPnL < 0 ? 'text-rose-500' : isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>
                                {monthlyStats.totalPnL > 0 ? '+' : ''}{userProfile.currencySymbol}{Math.abs(monthlyStats.totalPnL).toLocaleString()}
                            </span>
                        </div>
                        <div className={`w-px h-6 hidden lg:block ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-200'}`} />
                        <div className="flex flex-col sm:items-end">
                            <span className="text-[9px] uppercase font-bold opacity-50 tracking-wider">Win Rate</span>
                            <div className="flex items-center gap-1"><Activity size={12} className="text-purple-500" /><span className={`font-bold text-xs ${isDarkMode ? 'text-zinc-200' : 'text-slate-700'}`}>{monthlyStats.winRate.toFixed(0)}%</span></div>
                        </div>
                    </div>
                )}
            </div>

            <div className={`flex-1 overflow-y-auto custom-scrollbar px-0 py-3 sm:py-4 pb-24 sm:pb-4 ${isDarkMode ? 'bg-[#000000]' : 'bg-slate-50/50'}`}>
                {mode === 'month' && (
                    <div className={`mb-3 border-t border-l border-r rounded-xl overflow-hidden transition-all duration-300 ${isDarkMode ? 'bg-[#000000] border-[#27272a]' : 'bg-white border-slate-200 shadow-sm'}`}>
                        <button 
                            onClick={() => setIsSummaryOpen(!isSummaryOpen)}
                            className={`w-full flex items-center justify-between py-2.5 px-4 hover:bg-black/5 dark:hover:bg-white/5 transition-colors`}
                        >
                            <div className="flex items-center gap-2.5">
                                <LayoutPanelTop size={15} className="text-indigo-500" />
                                <span className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-zinc-200' : 'text-slate-700'}`}>Performance Summary</span>
                            </div>
                            <ChevronDown size={16} className={`transition-transform duration-300 ${isSummaryOpen ? 'rotate-180' : ''} ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`} />
                        </button>
                        
                        <div className={`transition-all duration-300 overflow-hidden ${isSummaryOpen ? 'max-h-[1000px] border-t dark:border-zinc-800 border-slate-100' : 'max-h-0'}`}>
                            <div className="p-4 overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead>
                                        <tr className={`text-[9px] font-black uppercase tracking-widest border-b dark:border-zinc-800 border-slate-100 ${isDarkMode ? 'text-zinc-200 opacity-40' : 'text-slate-500 opacity-70'}`}>
                                            <th className="pb-2.5 font-bold">Day</th>
                                            <th className="pb-2.5 font-bold">Net Profits</th>
                                            <th className="pb-2.5 font-bold text-center">Winning %</th>
                                            <th className="pb-2.5 font-bold text-right">Total Profits</th>
                                            <th className="pb-2.5 font-bold text-right pr-3">Total Loss</th>
                                        </tr>
                                    </thead>
                                    <tbody className={`text-xs font-bold divide-y dark:divide-zinc-800/50 divide-slate-100 ${isDarkMode ? 'text-zinc-300' : 'text-slate-700'}`}>
                                        {weekdayStats.map((wd) => (
                                            <tr key={wd.name} className="group">
                                                <td className="py-2.5 opacity-80">{wd.name}</td>
                                                <td className={`py-2.5 font-mono font-black ${wd.netProfits > 0 ? 'text-emerald-500' : wd.netProfits < 0 ? 'text-rose-500' : (isDarkMode ? 'opacity-40' : 'text-slate-400')}`}>
                                                    {wd.netProfits === 0 ? userProfile.currencySymbol + '0' : (wd.netProfits > 0 ? '+' : '-') + userProfile.currencySymbol + Math.abs(wd.netProfits).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                                </td>
                                                <td className="py-2.5">
                                                    <div className="flex items-center justify-center">
                                                        {wd.tCount > 0 ? (
                                                            <div className={`relative w-28 h-2 rounded-full overflow-hidden flex ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-100'}`}>
                                                                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-zinc-400/30 z-10" />
                                                                <div className="h-full bg-rose-500/80 ml-auto transition-all" style={{ width: `${wd.lRate / 2}%` }} />
                                                                <div className="h-full bg-emerald-500/80 transition-all" style={{ width: `${wd.wRate / 2}%` }} />
                                                            </div>
                                                        ) : (
                                                            <span className="opacity-30">--</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="py-2.5 text-right font-mono text-emerald-500">
                                                    {userProfile.currencySymbol}{wd.totalProfits.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                                </td>
                                                <td className="py-2.5 text-right pr-3 font-mono text-rose-500">
                                                    {wd.totalLoss === 0 ? `${userProfile.currencySymbol}0` : `-${userProfile.currencySymbol}${Math.abs(wd.totalLoss).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {mode === 'month' ? (
                    <div
                        className="touch-pan-y"
                        onTouchStart={(e) => { calSwipeX.current = e.touches[0].clientX; calSwipeY.current = e.touches[0].clientY; }}
                        onTouchEnd={(e) => {
                            if (calSwipeX.current === null || calSwipeY.current === null) return;
                            const dx = e.changedTouches[0].clientX - calSwipeX.current;
                            const dy = e.changedTouches[0].clientY - calSwipeY.current;
                            calSwipeX.current = null; calSwipeY.current = null;
                            if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
                            try { haptic.selection(); } catch {}
                            if (dx < 0) next(); else prev();
                        }}
                    >
                        <div className="grid grid-cols-7 gap-1 text-center mb-2">
                            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                                <div key={d} className="text-[10px] font-bold uppercase opacity-40">{d}</div>
                            ))}
                        </div>
                        <div className="grid grid-cols-7 gap-1 auto-rows-fr">
                            {blanks.map(b => <div key={`blank-${b}`} className="min-h-[92px] sm:min-h-[80px]" />)}
                            {days.map(day => { 
                                const dayTrades = getTradesForDay(day); 
                                const hasTrades = dayTrades.length > 0; 
                                const dayPnL = dayTrades.reduce((acc, t) => acc + safePnL(t.pnl), 0); 
                                
                                // TradeZella style logic: BE/Grey if P&L sits inside the
                                // break-even band for the account currency.
                                const beThreshold = bePnlThreshold(userProfile.currencySymbol);
                                const isBE = hasTrades && Math.abs(dayPnL) < beThreshold;
                                const isPositive = dayPnL >= beThreshold;
                                const isNegative = dayPnL <= -beThreshold;
                                
                                const isCurrentDay = isToday(day); 
                                
                                const getBgColor = () => {
                                    if (!hasTrades) return isDarkMode ? 'bg-[#000000] border-[#27272a]' : 'bg-white border-slate-200';
                                    if (isBE) return isDarkMode ? 'bg-zinc-500/20 border-zinc-500/30' : 'bg-slate-200 border-slate-300';
                                    if (isPositive) return isDarkMode ? 'bg-emerald-500/20 border-emerald-500/30' : 'bg-emerald-50 border-emerald-200';
                                    if (isNegative) return isDarkMode ? 'bg-rose-500/20 border-rose-500/30' : 'bg-rose-50 border-rose-200';
                                    return '';
                                };

                                return (
                                    <button
                                        key={day}
                                        type="button"
                                        disabled={!hasTrades}
                                        aria-label={hasTrades ? `View ${dayTrades.length} ${dayTrades.length === 1 ? 'trade' : 'trades'} on ${dateStrForDay(day)}` : `No trades on ${dateStrForDay(day)}`}
                                        onClick={() => { if (!hasTrades) return; try { haptic.selection(); } catch {} setSelectedDateStr(dateStrForDay(day)); }}
                                        className={`relative rounded-lg border p-1.5 sm:p-2 flex flex-col items-center justify-center min-h-[92px] sm:min-h-[80px] transition-all duration-200 overflow-hidden group w-full text-center ${getBgColor()} ${hasTrades ? 'cursor-pointer active:scale-[0.98]' : 'cursor-default'} ${isDarkMode ? 'hover:border-zinc-600' : 'hover:shadow-md hover:-translate-y-0.5'} ${isCurrentDay ? 'ring-1.5 ring-indigo-500 ring-offset-1 ring-offset-[#000000]' : ''} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4F01]`}>
                                        <div className="absolute top-1.5 right-2 z-10">
                                            <span className={`text-[9px] font-bold ${isCurrentDay ? 'text-indigo-400 font-black' : isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>{day}</span>
                                        </div>
                                        
                                        {hasTrades ? (
                                            <div className="flex flex-col items-center justify-center gap-0.5 relative z-10">
                                                <div className={`text-xs sm:text-sm font-mono font-bold tracking-tight ${isPositive ? 'text-emerald-500' : isNegative ? 'text-rose-500' : (isDarkMode ? 'text-zinc-400' : 'text-slate-600')}`}>
                                                    {dayPnL >= 0 ? '+' : '-'}{userProfile.currencySymbol}{Math.abs(dayPnL).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </div>
                                                <div className={`text-[8px] font-bold uppercase tracking-wider opacity-40 whitespace-nowrap ${isDarkMode ? 'text-white' : 'text-black'}`}>
                                                    {dayTrades.length} {dayTrades.length === 1 ? 'Trade' : 'Trades'}
                                                </div>
                                            </div>
                                        ) : null}
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-in fade-in zoom-in-95">
                        {Array.from({length: 12}).map((_, i) => (
                            <MiniCalendar key={i} year={year} month={i} trades={trades} isDarkMode={isDarkMode} currencySymbol={userProfile.currencySymbol} onClick={() => { setCurrentDate(new Date(year, i, 1)); setMode('month'); }} />
                        ))}
                    </div>
                )}
            </div>
            {/* Day trades drawer — same bottom-sheet pattern as backtest replay speed */}
            {selectedDateStr && (
                <>
                    <div className="fixed inset-0 z-[500] bg-black/50" onClick={() => setSelectedDateStr(null)} aria-hidden />
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label={`Trades on ${selectedDateLabel}`}
                        className={`fixed bottom-0 left-0 right-0 z-[510] rounded-t-3xl border-t p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] max-h-[75dvh] flex flex-col ${isDarkMode ? 'bg-black border-white/10' : 'bg-white border-slate-200'}`}
                    >
                        <div className="w-10 h-1 rounded-full mx-auto mb-3 bg-zinc-600/40 shrink-0" />
                        <div className="flex items-start justify-between gap-3 mb-1 shrink-0">
                            <div className="min-w-0">
                                <h3 className={`text-[16px] font-black tracking-tight leading-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{selectedDateLabel}</h3>
                                <p className={`text-[12px] font-bold mt-0.5 ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
                                    {selectedDayTrades.length} {selectedDayTrades.length === 1 ? 'trade' : 'trades'}
                                    {' · '}
                                    <span className={`font-mono ${selectedDayPnL < 0 ? 'text-[#ff4f64]' : selectedDayPnL > 0 ? 'text-emerald-400' : ''}`}>{formatSheetPnL(selectedDayPnL)}</span>
                                </p>
                            </div>
                            <button
                                type="button"
                                aria-label="Close day trades"
                                onClick={() => setSelectedDateStr(null)}
                                className={`w-9 h-9 min-w-[36px] rounded-full flex items-center justify-center active:scale-95 transition-all ${isDarkMode ? 'bg-white/[0.06] text-zinc-300' : 'bg-slate-100 text-slate-600'}`}
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div className="overflow-y-auto min-h-0 -mx-1 px-1">
                            {selectedDayTrades.map((trade) => {
                                const pnl = safePnL(trade.pnl);
                                const displayDate = trade.date || '';
                                const rowPnL = formatSheetPnL(pnl);
                                return (
                                    <button
                                        key={trade.id}
                                        type="button"
                                        onClick={() => { const t = trade; setSelectedDateStr(null); try { haptic.selection(); } catch {} onSelectTrade(t); }}
                                        className="w-full flex items-center justify-between py-3 border-b border-zinc-800/80 text-left cursor-pointer select-none active:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4F01]"
                                    >
                                        <div className="min-w-0 pr-3 flex-1">
                                            <h3 className={`text-[16px] font-black uppercase tracking-tight leading-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                                                {trade.pair || 'UNKNOWN'}
                                            </h3>
                                            <p className={`text-[13px] font-medium leading-tight mt-1 ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
                                                {trade.direction || 'Trade'}{displayDate ? ` · ${displayDate}` : ''}
                                            </p>
                                        </div>
                                        <span className={`text-[16px] font-black jfx-value-mono tracking-tight shrink-0 ${pnl < 0 ? 'text-[#ff4f64]' : pnl > 0 ? 'text-emerald-400' : (isDarkMode ? 'text-zinc-400' : 'text-slate-500')}`}>
                                            {rowPnL}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

// Hoisted to module level: stable identity across Journal renders, so rows
// never unmount/remount (no flash frames) and swipe state survives.
const MobileTradeCard: React.FC<{ trade: Trade; onToggle: () => void; isSelected: boolean; onSelect: () => void; onDelete: (id: string) => void; onEdit: (trade: Trade) => void; showCheckbox: boolean; isDarkMode: boolean; currencySymbol: string }> = ({ trade, onToggle, isSelected, onSelect, onDelete, onEdit, showCheckbox, isDarkMode, currencySymbol }) => {
    const [swipeX, setSwipeX] = useState(0);
    const [dragging, setDragging] = useState(false);
    const touchStartX = React.useRef<number | null>(null);
    const touchStartY = React.useRef<number | null>(null);
    const touchMoved = React.useRef(false);
    const pnl = safePnL(trade.pnl);
    const currSym = currencySymbol || '$';
    const displayDate = trade.date || (trade.closeTime ? trade.closeTime.split('T')[0] : trade.openTime ? trade.openTime.split('T')[0] : '');
    const formattedPnL = pnl < 0
        ? `-${currSym}${Math.abs(pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : pnl > 0
            ? `+${currSym}${Math.abs(pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : `${currSym}0.00`;

    return (
        <div className="relative overflow-hidden">
            {/* Swipe-right: delete */}
            {(dragging || swipeX !== 0) && swipeX >= 0 && (
                <div className="absolute left-0 top-0 bottom-0 w-[76px] flex items-center justify-start pl-1">
                    <button
                        aria-label="Delete trade"
                        onClick={(e) => { e.stopPropagation(); if (window.confirm('Delete this trade?')) { onDelete(trade.id); } }}
                        className="w-[60px] h-[44px] rounded-xl bg-[#ff4f64] text-white flex items-center justify-center shadow-lg active:scale-95 transition-transform"
                    >
                        <Trash2 size={20} />
                    </button>
                </div>
            )}
            {/* Swipe-left: edit */}
            {(dragging || swipeX !== 0) && swipeX <= 0 && (
                <div className="absolute right-0 top-0 bottom-0 w-[76px] flex items-center justify-end pr-1">
                    <button
                        aria-label="Edit trade"
                        onClick={(e) => { e.stopPropagation(); setSwipeX(0); onEdit(trade); }}
                        className="w-[60px] h-[44px] rounded-xl bg-[#FF4F01] text-white flex items-center justify-center shadow-lg active:scale-95 transition-transform"
                    >
                        <Pencil size={18} />
                    </button>
                </div>
            )}
        <div
            onClick={() => { if (touchMoved.current) { touchMoved.current = false; return; } if (swipeX !== 0) { setSwipeX(0); return; } try { haptic.selection(); } catch {} try { navigator.vibrate?.(10); } catch {} if (showCheckbox) { onSelect(); } else { onToggle(); } }}
            onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; touchStartY.current = e.touches[0].clientY; touchMoved.current = false; setDragging(true); }}
            onTouchMove={(e) => {
                if (touchStartX.current === null || touchStartY.current === null) return;
                const dx = e.touches[0].clientX - touchStartX.current;
                const dy = e.touches[0].clientY - touchStartY.current;
                if (Math.abs(dx) > 10 || Math.abs(dy) > 10) touchMoved.current = true;
                if (Math.abs(dy) > Math.abs(dx)) { setSwipeX(0); return; }
                setSwipeX(Math.max(-76, Math.min(76, dx)));
            }}
            onTouchEnd={() => { touchStartX.current = null; touchStartY.current = null; setDragging(false); setSwipeX((v) => (v < -38 ? -76 : v > 38 ? 76 : 0)); }}
            style={{ transform: `translateX(${swipeX}px)` }}
            className={`relative z-10 flex items-center justify-between py-2.5 px-0 border-b cursor-pointer select-none active:bg-white/[0.04] ${
                dragging ? '' : 'transition-transform duration-200'
            } ${
                isDarkMode ? 'border-zinc-800/80 bg-[#000000]' : 'border-slate-100 bg-white'
            } ${isSelected ? (isDarkMode ? 'bg-indigo-500/10' : 'bg-indigo-50/50') : ''}`}
        >
            {showCheckbox && (
                <button
                    aria-label={isSelected ? 'Untick trade' : 'Tick trade'}
                    onClick={(e) => { e.stopPropagation(); touchMoved.current = true; setSwipeX(0); onSelect(); }}
                    className={`w-[18px] h-[18px] rounded-full border flex items-center justify-center shrink-0 mr-2.5 transition-all active:scale-90 ${isSelected ? 'bg-violet-600 border-violet-600 text-white shadow-[0_2px_8px_rgba(124,58,237,0.35)]' : (isDarkMode ? 'border-zinc-700 bg-white/[0.03] text-transparent' : 'border-slate-300 bg-slate-50 text-transparent')}`}
                >
                    <Check size={8} strokeWidth={4} className={isSelected ? 'opacity-100' : 'opacity-0'} />
                </button>
            )}
            <div className="min-w-0 pr-3 flex-1">
                <h3 className={`text-[16px] font-black uppercase tracking-tight leading-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                    {trade.pair || 'UNKNOWN'}
                </h3>
                <p className={`text-[13px] font-medium leading-tight mt-1 ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
                    {trade.direction || 'Trade'}{displayDate ? ` · ${displayDate}` : ''}
                </p>
            </div>
            <div className="text-right shrink-0 flex flex-col items-end">
                <span className={`text-[16px] sm:text-[17px] font-black jfx-value-mono tracking-tight ${
                    pnl < 0 ? 'text-[#ff4f64]' : pnl > 0 ? 'text-emerald-400' : (isDarkMode ? 'text-zinc-400' : 'text-slate-500')
                }`}>
                    {formattedPnL}
                </span>
                {trade.executionGrade && <GradePill grade={trade.executionGrade} adherenceRate={trade.adherenceRate} size="xs" />}
            </div>
        </div>
        </div>
    );
};

const Journal: React.FC<JournalProps> = ({ 
    isDarkMode, 
    trades, 
    onUpdateTrade, 
    onBatchUpdateTrades, 
    onDeleteTrades, 
    onEditTrade, 
    userProfile, 
    onViewChange, 
    isLoading = false, 
    offlineQueue = [], 
    isDemoMode = false,
    portfolios = [],
    activePortfolioId,
    defaultPortfolioId,
    activePortfolioName,
    onSelectPortfolioId,
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
    const [expandedTradeId, setExpandedTradeId] = useState<string | null>(null);
    const [detailTradeId, setDetailTradeId] = useState<string | null>(null);
    const [isLinkMode, setIsLinkMode] = useState(false);
    const [expandedSetupIds, setExpandedSetupIds] = useState<string[]>([]);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    useEffect(() => { if (selectedIds.length === 0) setIsLinkMode(false); }, [selectedIds.length]);
    const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
    const [pendingBreakSetupId, setPendingBreakSetupId] = useState<string | null>(null);
    const [draftSetupName, setDraftSetupName] = useState('');
    const [dateRange, setDateRange] = useState<{ start: string; end: string } | null>(null);
    const [draftDateRange, setDraftDateRange] = useState<{ start: string; end: string } | null>(null);
    const [showDateFilter, setShowDateFilter] = useState(false);
    
    // Quick date range presets
    const quickRanges = [
        { label: 'Today', days: 0 },
        { label: 'Last 7 days', days: 7 },
        { label: 'Last 30 days', days: 30 },
        { label: 'This Month', days: -1 },
        { label: 'Last Month', days: -2 },
        { label: 'All Time', days: -99 },
    ];

    const getRangeForDays = (days: number) => {
        const today = new Date();
        if (days === -99) {
            return null;
        }
        if (days === -1) {
            // This month
            const start = new Date(today.getFullYear(), today.getMonth(), 1);
            return {
                start: start.toISOString().split('T')[0],
                end: today.toISOString().split('T')[0]
            };
        }
        if (days === -2) {
            // Last month
            const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            const end = new Date(today.getFullYear(), today.getMonth(), 0);
            return {
                start: start.toISOString().split('T')[0],
                end: end.toISOString().split('T')[0]
            };
        }
        const start = new Date(today);
        start.setDate(start.getDate() - days);
        return {
            start: start.toISOString().split('T')[0],
            end: today.toISOString().split('T')[0]
        };
    };

    const applyQuickRange = (days: number) => {
        setDateRange(getRangeForDays(days));
    };

    const getCurrentMonthRange = () => {
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        return {
            start: start.toISOString().split('T')[0],
            end: today.toISOString().split('T')[0]
        };
    };

    useEffect(() => {
        if (!showDateFilter) return;
        setDraftDateRange(dateRange ?? getCurrentMonthRange());
    }, [showDateFilter, dateRange]);

    const selectedTrades = useMemo(() => trades.filter(t => selectedIds.includes(t.id)), [trades, selectedIds]);
    const areAllLinkedToSameSetup = useMemo(() => {
        if (selectedTrades.length < 1) return false;
        const firstSetupId = selectedTrades[0].setupId;
        if (!firstSetupId) return false;
        return selectedTrades.every(t => t.setupId === firstSetupId);
    }, [selectedTrades]);

    useEffect(() => {
        if (!isLinkModalOpen) return;
        const nextDraftName = buildSetupName(selectedTrades);
        setDraftSetupName(nextDraftName);
    }, [isLinkModalOpen, selectedTrades]);

    const selectedSetupSummary = useMemo(() => {
        if (selectedTrades.length < 2) return null;

        const setupIds = new Set(selectedTrades.map(trade => trade.setupId).filter(Boolean));
        const hasExistingSetup = setupIds.size > 0;
        const mixedSetupState = hasExistingSetup && !areAllLinkedToSameSetup;
        const setupName = buildSetupName(selectedTrades);

        return {
            setupName,
            hasExistingSetup,
            mixedSetupState,
            tradeCount: selectedTrades.length,
            pairCount: new Set(selectedTrades.map(trade => trade.pair)).size
        };
    }, [areAllLinkedToSameSetup, selectedTrades]);

    const filteredTrades = useMemo(() => {
        const needle = searchTerm.trim().toLowerCase();
        return trades.filter(t => {
            // Search filter — rows can arrive from the DB with NULL pair/tags/
            // assetType, so every access has to tolerate a missing value.
            const matchesSearch = !needle ||
                (typeof t.pair === 'string' && t.pair.toLowerCase().includes(needle)) ||
                (Array.isArray(t.tags) && t.tags.some(tag => typeof tag === 'string' && tag.toLowerCase().includes(needle))) ||
                (typeof t.assetType === 'string' && t.assetType.toLowerCase().includes(needle));

            // Date range filter — compare only the calendar date so values that
            // carry a time component ("2026-09-21 14:30") still match.
            const tradeDate = stripTime(t.date);
            const matchesDateRange = !dateRange || (
                tradeDate >= dateRange.start && tradeDate <= dateRange.end
            );

            return matchesSearch && matchesDateRange;
        });
    }, [trades, searchTerm, dateRange]);

    // Offline-queued trades get the same search/date treatment as saved trades,
    // otherwise they'd sit pinned on screen no matter what the user filtered.
    const filteredOfflineQueue = useMemo(() => {
        const needle = searchTerm.trim().toLowerCase();
        return offlineQueue.filter(t => {
            const matchesSearch = !needle ||
                (typeof t.pair === 'string' && t.pair.toLowerCase().includes(needle)) ||
                (Array.isArray(t.tags) && t.tags.some(tag => typeof tag === 'string' && tag.toLowerCase().includes(needle))) ||
                (typeof t.assetType === 'string' && t.assetType.toLowerCase().includes(needle));
            const tradeDate = stripTime(t.date);
            const matchesDateRange = !dateRange || (tradeDate >= dateRange.start && tradeDate <= dateRange.end);
            return matchesSearch && matchesDateRange;
        });
    }, [offlineQueue, searchTerm, dateRange]);

    // List windowing: rendering 1000s of rows on every keystroke is what
    // made edit/delete feel frozen. Render the first page, grow on demand.
    const GROUP_PAGE_SIZE = 60;
    const [visibleGroupCount, setVisibleGroupCount] = useState(GROUP_PAGE_SIZE);
    useEffect(() => {
        setVisibleGroupCount(GROUP_PAGE_SIZE);
    }, [searchTerm, dateRange, trades.length]);

    const groupedTrades = useMemo(() => {
        const groups: Record<string, GroupedTrade> = {};
        const result: GroupedTrade[] = [];
        const standaloneTradeCounts: Record<string, number> = {};

        // Add pending trades at the very top. The index is always part of the
        // key so two queued trades sharing a ticketId can't collide in React.
        filteredOfflineQueue.forEach((trade, index) => {
            result.push({
                type: 'pending',
                trades: [trade],
                date: trade.date,
                id: `pending-${index}-${trade.ticketId || trade.id || 'unknown'}`
            });
        });

        filteredTrades.forEach(trade => {
            if (trade.setupId) {
                if (!groups[trade.setupId]) {
                    groups[trade.setupId] = {
                        type: 'setup',
                        setupId: trade.setupId,
                        setupName: trade.setupName,
                        trades: [],
                        date: trade.date,
                        id: `setup-${trade.setupId}`
                    };
                    result.push(groups[trade.setupId]);
                }
                if (!groups[trade.setupId].setupName && trade.setupName) {
                    groups[trade.setupId].setupName = trade.setupName;
                }
                groups[trade.setupId].trades.push(trade);
                if (new Date(trade.date) > new Date(groups[trade.setupId].date)) {
                    groups[trade.setupId].date = trade.date;
                }
            } else {
                const seenCount = standaloneTradeCounts[trade.id] || 0;
                standaloneTradeCounts[trade.id] = seenCount + 1;
                result.push({
                    type: 'standalone',
                    trades: [trade],
                    date: trade.date,
                    id: `standalone-${trade.id}-${seenCount}`
                });
            }
        });

        return result.sort((a, b) => groupSortTime(b) - groupSortTime(a));
    }, [filteredTrades, filteredOfflineQueue]);

    const toggleExpand = (id: string) => { setExpandedTradeId(expandedTradeId === id ? null : id); };
    const toggleSetupExpand = (id: string) => {
        if (expandedSetupIds.includes(id)) {
            setExpandedSetupIds(prev => prev.filter(sid => sid !== id));
        } else {
            setExpandedSetupIds(prev => [...prev, id]);
        }
    };

    const filteredTradeIds = useMemo(() => filteredTrades.map(t => t.id), [filteredTrades]);
    // Compare against the *filtered* set only — the old length comparison broke
    // as soon as a selection contained rows hidden by search/date filters.
    const areAllFilteredSelected = filteredTradeIds.length > 0 && filteredTradeIds.every(id => selectedIds.includes(id));

    const handleSelectAll = () => {
        if (areAllFilteredSelected) {
            const filteredSet = new Set(filteredTradeIds);
            setSelectedIds(prev => prev.filter(id => !filteredSet.has(id)));
        } else {
            setSelectedIds(prev => Array.from(new Set([...prev, ...filteredTradeIds])));
        }
    };

    const handleSelectOne = (id: string) => { if (selectedIds.includes(id)) setSelectedIds(prev => prev.filter(item => item !== id)); else setSelectedIds(prev => [...prev, id]); };
    const handleSelectSetup = (setupId: string, tradeIds: string[]) => {
        const allSelected = tradeIds.every(id => selectedIds.includes(id));
        if (allSelected) {
            setSelectedIds(prev => prev.filter(id => !tradeIds.includes(id)));
        } else {
            setSelectedIds(prev => Array.from(new Set([...prev, ...tradeIds])));
        }
    };

    const handleBulkDelete = () => { if (selectedIds.length === 0) return; onDeleteTrades(selectedIds); setSelectedIds([]); };

    const handleLinkSelected = async () => {
        if (selectedIds.length < 2) return;

        const cleanSetupName = draftSetupName.trim() || buildSetupName(selectedTrades);
        // Reuse the cluster id when every selected trade already shares one —
        // minting a fresh id used to split the existing cluster apart.
        const sharedIds = Array.from(new Set(selectedTrades.map(t => t.setupId).filter(Boolean))) as string[];
        const setupId = sharedIds.length === 1 ? sharedIds[0] : buildSetupId();
        const tradesToUpdate = selectedTrades
            .filter(t => selectedIds.includes(t.id))
            .map(t => ({
                ...t,
                setupId,
                setupName: cleanSetupName
            }));

        const updated = await onBatchUpdateTrades(tradesToUpdate);
        if (updated) {
            setSelectedIds([]);
            setIsLinkModalOpen(false);
            setDraftSetupName('');
            setIsLinkMode(false);
        }
    };

    // Stripping the keys entirely guarantees the DB payload resolves to NULL;
    // leaving them as `undefined` relies on serialization not dropping them.
    const detachSetup = (t: Trade): Trade => {
        const { setupId: _setupId, setupName: _setupName, ...rest } = t;
        return rest as Trade;
    };

    const handleDetachSelected = async () => {
        if (selectedIds.length === 0) return;
        const tradesToUpdate = selectedTrades
            .filter(t => selectedIds.includes(t.id))
            .map(detachSetup);

        const updated = await onBatchUpdateTrades(tradesToUpdate);
        if (updated) {
            setSelectedIds([]);
        }
    };

    const handleBreakCluster = async (setupId: string) => {
        const tradesToUpdate = trades
            .filter(t => t.setupId === setupId)
            .map(detachSetup);

        const updated = await onBatchUpdateTrades(tradesToUpdate);
        if (updated) {
            setExpandedSetupIds(prev => prev.filter(id => id !== setupId));
        }
    };

    const handleUpload = (trade: Trade, type: 'before' | 'after', e: React.ChangeEvent<HTMLInputElement>) => { if (!e.target.files || !e.target.files[0]) return; const file = e.target.files[0]; const reader = new FileReader(); reader.onloadend = () => { onUpdateTrade({ ...trade, [type === 'before' ? 'beforeScreenshot' : 'afterScreenshot']: reader.result as string }); }; reader.readAsDataURL(file); };
    const handleDeleteImage = (trade: Trade, type: 'before' | 'after') => {
        onUpdateTrade({
            ...trade,
            [type === 'before' ? 'beforeScreenshot' : 'afterScreenshot']: undefined
        });
    };

    const [previewImage, setPreviewImage] = useState<{ url: string, title: string } | null>(null);
    // Track per-trade canvas mode: 'chart' (default) or 'screenshots'
    const [canvasMode, setCanvasMode] = useState<Record<string, 'chart' | 'screenshots'>>({});
    const [editingComment, setEditingComment] = useState<{ tradeId: string; field: 'notes' | 'exitComment'; value: string } | null>(null);
    const [editingStrategy, setEditingStrategy] = useState<{ tradeId: string; value: string } | null>(null);
    const [editingRating, setEditingRating] = useState<{ tradeId: string; value: number; hoverValue?: number } | null>(null);

    const beginCommentEdit = (trade: Trade, field: 'notes' | 'exitComment') => {
        setEditingComment({
            tradeId: trade.id,
            field,
            value: field === 'notes' ? (trade.notes || '') : (trade.exitComment || '')
        });
    };

    const saveCommentEdit = (trade: Trade) => {
        if (!editingComment || editingComment.tradeId !== trade.id) return;
        onUpdateTrade({
            ...trade,
            [editingComment.field]: editingComment.value
        });
        setEditingComment(null);
    };

    const saveStrategyEdit = (trade: Trade) => {
        if (!editingStrategy || editingStrategy.tradeId !== trade.id) return;
        const trimmed = editingStrategy.value.trim();
        const newStrategyTags = trimmed ? trimmed.split(',').map(s => s.trim()).filter(Boolean) : [];
        const platformTags = (trade.tags || []).filter(t => PLATFORM_TAGS.includes(t));
        onUpdateTrade({
            ...trade,
            tags: [...newStrategyTags, ...platformTags]
        });
        setEditingStrategy(null);
    };

    const saveRatingEdit = (trade: Trade, directValue?: number) => {
        const val = directValue !== undefined 
            ? directValue 
            : (editingRating?.hoverValue !== undefined ? editingRating.hoverValue : (editingRating?.value ?? trade.rating ?? 0));
        
        onUpdateTrade({
            ...trade,
            rating: val
        });
        setEditingRating(null);
    };

    const renderTradeDetails = (trade: Trade) => (
        <div key={`details-${trade.id}`} className={`col-span-11 min-w-0 mx-0 sm:mx-6 mt-1 mb-6 rounded-2xl overflow-hidden border shadow-xl relative ${isDarkMode ? 'bg-[#000000] border-[#27272a] shadow-black' : 'bg-white border-slate-200'}`}>
            <div className={`relative px-6 py-4 border-b flex flex-wrap items-center justify-between gap-4 ${isDarkMode ? 'bg-black/50 border-zinc-800' : 'bg-slate-50/50 border-slate-100'}`}>
                <div className="flex items-center gap-6">
                    <div>
                        <div className={`text-4xl font-mono font-black tracking-tighter leading-none ${safePnL(trade.pnl) > 0 ? 'text-emerald-400' : safePnL(trade.pnl) < 0 ? 'text-rose-500' : 'text-zinc-500'}`}>
                            {safePnL(trade.pnl) > 0 ? '+' : safePnL(trade.pnl) < 0 ? '-' : ''}{userProfile.currencySymbol}{Math.abs(safePnL(trade.pnl)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div className="text-[9px] font-black uppercase tracking-[0.2em] opacity-40 mt-1">Net P&L</div>
                    </div>
                    <div className={`w-px h-10 ${isDarkMode ? 'bg-black' : 'bg-slate-200'}`} />
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-2xl font-black tracking-tight">{trade.pair}</h2>
                            <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${trade.direction === 'Long' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>{trade.direction}</span>
                            <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-indigo-500 text-white`}>{trade.assetType}</span>
                        </div>
                        <div className="flex items-center gap-3 opacity-50 text-xs font-medium mt-0.5">
                            <span className="flex items-center gap-1">{trade.date}</span>
                            <span className="w-1 h-1 rounded-full bg-current opacity-50"></span>
                            <span className="flex items-center gap-1">{trade.time}</span>
                            <span className="w-1 h-1 rounded-full bg-current opacity-50"></span>
                            <span className="flex items-center gap-1">{trade.session}</span>
                            {trade.openTime && trade.closeTime && (
                                <>
                                    <span className="w-1 h-1 rounded-full bg-current opacity-50"></span>
                                    <span className="flex items-center gap-1 text-indigo-400 font-bold">
                                        <Clock size={12} /> {formatDuration(trade.openTime, trade.closeTime)}
                                    </span>
                                </>
                            )}
                            <span className="w-1 h-1 rounded-full bg-current opacity-50"></span>
                            <div className="flex items-center gap-1" title={`Rating: ${trade.rating || 0}/5`}>
                                <ReadOnlyStarRating rating={trade.rating || 0} isDarkMode={isDarkMode} />
                            </div>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {!isDemoMode && (
                        <button
                            onClick={() => onEditTrade(trade)}
                            className={`p-2 rounded-lg transition-all ${isDarkMode ? 'hover:bg-black text-zinc-400' : 'hover:bg-white text-slate-500 shadow-sm border border-slate-200'}`}
                            title="Edit Entry"
                        >
                            <Edit3 size={16} />
                        </button>
                    )}
                    <button onClick={() => setExpandedTradeId(null)} className={`p-2 rounded-lg transition-all bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white`}><X size={18} /></button>
                </div>
            </div>
            <div className="relative p-6">
                <div className="grid grid-cols-12 gap-6 items-start min-w-0">
                    <div className="col-span-12 md:col-span-4 lg:col-span-3 space-y-4 pr-1">
                        <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-black/30 border-zinc-800' : 'bg-slate-50/50 border-slate-200'}`}>
                            <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-3">Execution</h4>
                             <div className="space-y-3 text-sm">
                                 <div className="flex justify-between"><span className="opacity-50">Entry</span><span className="font-mono font-bold">{safePrice(trade.entryPrice)}</span></div>
                                 <div className="flex justify-between"><span className="opacity-50">Exit</span><span className="font-mono font-bold">{trade.exitPrice === undefined || trade.exitPrice === null ? '—' : safePrice(trade.exitPrice)}</span></div>
                                 <div className="flex justify-between"><span className="opacity-50">Stop Loss</span><span className="font-mono font-bold text-rose-500">{safePrice(trade.stopLoss)}</span></div>
                                 <div className="flex justify-between"><span className="opacity-50">Take Profit</span><span className="font-mono font-bold text-emerald-500">{safePrice(trade.takeProfit)}</span></div>
                                 <div className="h-px bg-current opacity-10 my-2" />
                                 {(() => {
                                     const pipSize = getPipSize(trade.assetType, trade.pair);
                                     const hasExit = Number.isFinite(Number(trade.exitPrice));
                                     const pipMovement = hasExit ? (trade.direction === 'Long' ? Number(trade.exitPrice) - trade.entryPrice : trade.entryPrice - Number(trade.exitPrice)) / pipSize : 0;
                                     return (
                                          <div className="flex justify-between"><span className="opacity-50">Pip Movement</span><span className={`font-bold ${pipMovement >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{!hasExit ? '—' : `${pipMovement >= 0 ? '+' : ''}${pipMovement.toFixed(2)} pip`}</span></div>
                                     );
                                 })()}
                                {trade.openTime && (
                                    <div className="flex justify-between text-[10px]"><span className="opacity-50 uppercase font-bold">Opened</span><span className="font-mono opacity-80">{new Date(trade.openTime).toLocaleString('en-ZA', { timeZone: getDefaultTimezone() })}</span></div>
                                )}
                                {trade.closeTime && (
                                    <div className="flex justify-between text-[10px]"><span className="opacity-50 uppercase font-bold">Closed</span><span className="font-mono opacity-80">{new Date(trade.closeTime).toLocaleString('en-ZA', { timeZone: getDefaultTimezone() })}</span></div>
                                )}
                                <div className="flex justify-between"><span className="opacity-50">Volume</span><span className="font-bold">{trade.lots} Lots</span></div>
                                <div className="flex justify-between"><span className="opacity-50">R:R Ratio</span><span className="font-bold text-indigo-500">{trade.rr > 0 ? `1 : ${trade.rr}` : '—'}</span></div>
                            </div>
                        </div>
                        <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-black/30 border-zinc-800' : 'bg-slate-50/50 border-slate-200'}`}>
                            <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-3">Psychology</h4>
                            <div className="space-y-3 text-sm">
                                <div className="flex justify-between"><span className="opacity-50">Mindset</span><span className="font-bold">{trade.mindset || 'Neutral'}</span></div>
                                <div className="flex justify-between"><span className="opacity-50">Plan</span><span className="font-bold">{trade.planAdherence || 'N/A'}</span></div>
                                <div className="flex justify-between"><span className="opacity-50">Mistake</span><span className="font-bold text-rose-500">{trade.tradingMistake || 'None'}</span></div>
                            </div>
                        </div>
                        <div className={`p-3 rounded-xl border ${isDarkMode ? 'bg-black/30 border-zinc-800 text-zinc-300' : 'bg-white border-slate-200 text-slate-700'}`}>
                            <div className="flex items-center justify-between mb-2">
                                <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40">Voice Note</h4>
                                <Mic size={12} className="opacity-40" />
                            </div>
                            {trade.voiceNote ? (
                                isAudioSource(trade.voiceNote) ? (
                                    <AudioNote src={trade.voiceNote} className="w-full h-8" />
                                ) : (
                                    <p className="text-[11px] leading-relaxed whitespace-pre-wrap max-h-24 overflow-auto pr-1">
                                        {trade.voiceNote}
                                    </p>
                                )
                            ) : (
                                <div className="flex items-center gap-2 opacity-40 text-[10px] font-bold uppercase tracking-widest">
                                    <Mic size={11} />
                                    No Voice Note
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="col-span-12 lg:col-span-9 min-w-0 grid grid-cols-1 md:grid-cols-2 gap-4 items-start content-start pr-1">
                        {/* ── Chart / Screenshots dual-mode panel (spans both columns) ── */}
                        <div className={`col-span-2 h-[440px] min-h-[440px] min-w-0 rounded-xl border overflow-hidden flex flex-col border-dashed ${isDarkMode ? 'border-zinc-700' : 'border-zinc-300'}`}>
                            {/* ── Mode toggle header ── */}
                            <div className={`flex items-center justify-between px-3 py-1.5 border-b shrink-0 ${isDarkMode ? 'border-zinc-800 bg-black/40' : 'border-slate-100 bg-slate-50'}`}>
                                <span className={`text-[9px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>
                                    {(canvasMode[trade.id] ?? 'chart') === 'chart' ? 'Chart' : 'Screenshots'}
                                </span>
                                <div className={`flex items-center rounded-lg p-0.5 gap-0.5 ${isDarkMode ? 'bg-zinc-900' : 'bg-slate-100'}`}>
                                    <button
                                        onClick={() => setCanvasMode(prev => ({ ...prev, [trade.id]: 'chart' }))}
                                        className={`px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${
                                            (canvasMode[trade.id] ?? 'chart') === 'chart'
                                                ? (isDarkMode ? 'bg-zinc-700 text-white' : 'bg-white text-slate-900 shadow-sm')
                                                : (isDarkMode ? 'text-zinc-500 hover:text-zinc-300' : 'text-slate-400 hover:text-slate-600')
                                        }`}
                                        title="Historical cTrader Chart"
                                    >
                                        📈 Chart
                                    </button>
                                    <button
                                        onClick={() => setCanvasMode(prev => ({ ...prev, [trade.id]: 'screenshots' }))}
                                        className={`px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${
                                            (canvasMode[trade.id] ?? 'chart') === 'screenshots'
                                                ? (isDarkMode ? 'bg-zinc-700 text-white' : 'bg-white text-slate-900 shadow-sm')
                                                : (isDarkMode ? 'text-zinc-500 hover:text-zinc-300' : 'text-slate-400 hover:text-slate-600')
                                        }`}
                                        title="Before / After screenshots"
                                    >
                                        🖼 Screenshots
                                    </button>
                                </div>
                            </div>

                            {/* ── Mode content ── */}
                            {(canvasMode[trade.id] ?? 'chart') === 'chart' ? (
                                <div className="flex-1 min-h-0 overflow-hidden">
                                    <TradeChartView 
                                        trade={trade} 
                                        isDarkMode={isDarkMode} 
                                        onSaveCandles={(candles, tf) => {
                                            onUpdateTrade({
                                                ...trade,
                                                chartCandles: candles,
                                                chartTimeframe: tf,
                                            });
                                        }}
                                    />
                                </div>
                            ) : (
                                <div className="flex-1 min-h-0 grid grid-cols-2 gap-2 p-2">
                                    {[{ id: 'before', label: 'Before Canvas', data: trade.beforeScreenshot }, { id: 'after', label: 'After Canvas', data: trade.afterScreenshot }].map((slot) => (
                                        <div key={slot.id} className={`group rounded-lg border overflow-hidden flex flex-col border-dashed ${isDarkMode ? 'border-zinc-700 bg-white/5' : 'border-zinc-300 bg-black/5'}`}>
                                            <div className="px-3 py-1.5 border-b border-white/5 dark:border-zinc-700/70 bg-black/5 dark:bg-white/5 flex items-center justify-between shrink-0">
                                                <div className="text-[9px] font-bold text-white uppercase tracking-wider px-2 py-0.5 bg-black/60 rounded">{slot.label}</div>
                                                {slot.data && (
                                                    <div className="flex items-center gap-1.5">
                                                        <button
                                                            onClick={() => setPreviewImage({ url: slot.data!, title: `${trade.pair} - ${slot.label} Screenshot` })}
                                                            className="p-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-all"
                                                            title="View Full Size"
                                                        >
                                                            <Eye size={14} />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteImage(trade, slot.id as any)}
                                                            type="button"
                                                            className="p-1.5 bg-rose-500/80 hover:bg-rose-500 text-white rounded-lg transition-all"
                                                            title="Delete Image"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="relative flex-1 min-h-0 overflow-hidden">
                                                {slot.data ? (
                                                    <img src={slot.data} alt={slot.label} className="absolute inset-0 w-full h-full object-cover" />
                                                ) : (
                                                    <label className="absolute inset-0 cursor-pointer flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors">
                                                        <div className="flex flex-col items-center justify-center opacity-35 text-center">
                                                            <ImageIcon size={18} className="mb-1.5" />
                                                            <span className="text-[9px] font-bold uppercase tracking-wider">No Image</span>
                                                        </div>
                                                        <input
                                                            type="file"
                                                            accept="image/*"
                                                            className="hidden"
                                                            aria-label={`Upload ${slot.label} screenshot`}
                                                            onChange={(e) => handleUpload(trade, slot.id as any, e)}
                                                        />
                                                    </label>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className={`p-3.5 h-[140px] min-w-0 rounded-xl border flex flex-col overflow-hidden ${isDarkMode ? 'bg-black/20 border-zinc-800 text-zinc-300' : 'bg-white border-slate-200 text-slate-700'}`}>
                            <div className="flex items-center justify-between mb-1.5 shrink-0">
                                <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40">Entry Note</h4>
                                {!(editingComment?.tradeId === trade.id && editingComment.field === 'notes') && (
                                    <button
                                        onClick={() => beginCommentEdit(trade, 'notes')}
                                        className={`p-1 rounded transition-colors ${isDarkMode ? 'hover:bg-black text-zinc-500' : 'hover:bg-slate-100 text-slate-400'}`}
                                        title="Edit Entry Comment"
                                    >
                                        <Edit3 size={11} />
                                    </button>
                                )}
                            </div>
                            <div className="flex-1 min-h-0 min-w-0 overflow-auto overflow-x-hidden pr-1">
                                {editingComment?.tradeId === trade.id && editingComment.field === 'notes' ? (
                                    <div className="space-y-2">
                                        <textarea
                                            value={editingComment.value}
                                            onChange={(e) => setEditingComment(prev => prev ? { ...prev, value: e.target.value } : prev)}
                                            className={`w-full min-h-20 resize-none rounded-xl border px-3 py-2 text-xs outline-none ${isDarkMode ? 'bg-black border-zinc-800 text-zinc-100' : 'bg-slate-50 border-slate-200 text-slate-900'}`}
                                            placeholder="Edit entry comment..."
                                        />
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                onClick={() => setEditingComment(null)}
                                                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? 'bg-black text-zinc-300' : 'bg-slate-100 text-slate-600'}`}
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={() => saveCommentEdit(trade)}
                                                className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-brand text-white"
                                            >
                                                Save
                                            </button>
                                        </div>
                                    </div>
                                ) : trade.notes ? (
                                    <div
                                        className="min-w-0 break-words text-xs leading-relaxed prose prose-sm dark:prose-invert max-w-none"
                                        dangerouslySetInnerHTML={{ __html: sanitizeRichTextHtml(trade.notes) }}
                                    />
                                ) : (
                                    <p className="text-xs opacity-50 italic">No entry comments recorded.</p>
                                )}
                            </div>
                            {trade.voiceNote && (
                                <div className="mt-2 pt-2 border-t border-dashed border-current/10 shrink-0">
                                    <h5 className="text-[9px] font-black uppercase tracking-widest opacity-40 mb-1">Voice Note</h5>
                                    {isAudioSource(trade.voiceNote) ? (
                                    <AudioNote src={trade.voiceNote} className="w-full h-8" />
                                    ) : (
                                        <p className="text-xs leading-relaxed whitespace-pre-wrap opacity-90">
                                            {trade.voiceNote}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className={`p-3.5 h-[140px] min-w-0 rounded-xl border flex flex-col overflow-hidden ${isDarkMode ? 'bg-black/20 border-zinc-800 text-zinc-300' : 'bg-white border-slate-200 text-slate-700'}`}>
                            <div className="flex items-center justify-between mb-1.5 shrink-0">
                                <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40">Exit Note</h4>
                                {!(editingComment?.tradeId === trade.id && editingComment.field === 'exitComment') && (
                                    <button
                                        onClick={() => beginCommentEdit(trade, 'exitComment')}
                                        className={`p-1 rounded transition-colors ${isDarkMode ? 'hover:bg-black text-zinc-500' : 'hover:bg-slate-100 text-slate-400'}`}
                                        title="Edit Exit Comment"
                                    >
                                        <Edit3 size={11} />
                                    </button>
                                )}
                            </div>
                            <div className="flex-1 min-h-0 min-w-0 overflow-auto overflow-x-hidden pr-1">
                                {editingComment?.tradeId === trade.id && editingComment.field === 'exitComment' ? (
                                    <div className="space-y-2">
                                        <textarea
                                            value={editingComment.value}
                                            onChange={(e) => setEditingComment(prev => prev ? { ...prev, value: e.target.value } : prev)}
                                            className={`w-full min-h-20 resize-none rounded-xl border px-3 py-2 text-xs outline-none ${isDarkMode ? 'bg-black border-zinc-800 text-zinc-100' : 'bg-slate-50 border-slate-200 text-slate-900'}`}
                                            placeholder="Edit exit comment..."
                                        />
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                onClick={() => setEditingComment(null)}
                                                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? 'bg-black text-zinc-300' : 'bg-slate-100 text-slate-600'}`}
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={() => saveCommentEdit(trade)}
                                                className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-brand text-white"
                                            >
                                                Save
                                            </button>
                                        </div>
                                    </div>
                                ) : trade.exitComment ? (
                                    <div
                                        className="min-w-0 break-words text-xs leading-relaxed prose prose-sm dark:prose-invert max-w-none"
                                        dangerouslySetInnerHTML={{ __html: sanitizeRichTextHtml(trade.exitComment) }}
                                    />
                                ) : (
                                    <p className="text-xs opacity-50 italic">No exit comments recorded.</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    // MobileTradeCard — Clean minimalist row matching exact design (Pair + Direction · Date on left, PnL on right, divider line below)

    const renderTradeRow = (trade: Trade, isGrouped = false, isFirst = false, isLast = false, rowKey?: string) => (
        <React.Fragment key={rowKey || `${isGrouped ? 'grouped' : 'standalone'}-${trade.id}-${trade.date}-${trade.time}`}>
            <div className={`grid grid-cols-[40px_1.4fr_1fr_0.9fr_1.1fr_1.1fr_0.9fr_1.3fr_1.4fr_1.2fr_40px] px-2 py-4 border-b items-center transition-all rounded-xl ${isGrouped ? (isDarkMode ? 'bg-white/[0.02] mt-0 rounded-none first:rounded-t-xl last:rounded-b-xl last:border-b-0' : 'bg-black/[0.01] mt-0 rounded-none first:rounded-t-xl last:rounded-b-xl last:border-b-0') : 'mt-1'} ${expandedTradeId === trade.id ? (isDarkMode ? 'bg-black/50 border-indigo-500/50' : 'bg-slate-50 border-indigo-200 shadow-inner') : (isDarkMode ? 'border-[#27272a] hover:bg-black/30' : 'border-slate-100 hover:bg-slate-50')} ${selectedIds.includes(trade.id) ? (isDarkMode ? 'bg-indigo-900/10' : 'bg-indigo-50') : ''}`}>
                <div className="col-span-1 flex items-center justify-center self-stretch relative min-h-[64px]">
                    {isGrouped ? (
                        <div className="absolute inset-0 flex flex-col items-center">
                            {/* Connector Line - Full height for middle items, half for first/last */}
                            <div className={`w-0.5 flex-1 ${isFirst ? 'bg-transparent' : 'bg-violet-500/40'}`} />
                            
                            {/* Dot for First and Last */}
                            <div className="relative flex items-center justify-center h-4">
                                {(isFirst || isLast) ? (
                                    <div className="w-2.5 h-2.5 rounded-full bg-violet-500 shadow-[0_0_10px_rgba(139,92,246,0.5)] z-20" />
                                ) : (
                                    <div className="w-1.5 h-1.5 rounded-full bg-violet-500/40 z-20" />
                                )}
                            </div>
                            
                            <div className={`w-0.5 flex-1 ${isLast ? 'bg-transparent' : 'bg-violet-500/40'}`} />
                        </div>
                    ) : (
                        !isDemoMode && (
                            <button onClick={() => handleSelectOne(trade.id)} className={`${selectedIds.includes(trade.id) ? 'text-indigo-500' : 'text-zinc-500 hover:text-zinc-300'}`}>
                                {selectedIds.includes(trade.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                            </button>
                        )
                    )}
                </div>
                <div className="col-span-1 pl-2 cursor-pointer" onClick={() => toggleExpand(trade.id)}>
                    <p className="font-bold text-sm">{trade.date}</p>
                    <p className="text-xs opacity-50">{trade.time}</p>
                </div>
                <div className="col-span-1 font-bold cursor-pointer" onClick={() => toggleExpand(trade.id)}>{trade.pair}</div>
                <div className="col-span-1 text-xs opacity-70 cursor-pointer" onClick={() => toggleExpand(trade.id)}>{trade.assetType}</div>
                <div className="col-span-1 cursor-pointer" onClick={() => toggleExpand(trade.id)}>
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold ${trade.direction === 'Long' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                        {trade.direction === 'Long' ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {trade.direction}
                    </span>
                </div>
                <div className="col-span-1 text-xs opacity-80 cursor-pointer" onClick={() => toggleExpand(trade.id)}>{trade.session}</div>
                <div className="col-span-1 text-xs font-mono font-bold opacity-60 cursor-pointer" onClick={() => toggleExpand(trade.id)}>
                    {formatDuration(trade.openTime, trade.closeTime) || '---'}
                </div>
        <div 
            className="col-span-1 flex items-center gap-1.5 group/strategy min-w-0" 
            onClick={(e) => {
                e.stopPropagation();
            }}
        >
            {editingStrategy?.tradeId === trade.id ? (
                <div 
                    className="flex items-center gap-1 w-full"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <input
                        type="text"
                        autoFocus
                        value={editingStrategy.value}
                        onChange={(e) => setEditingStrategy({ tradeId: trade.id, value: e.target.value })}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                saveStrategyEdit(trade);
                            } else if (e.key === 'Escape') {
                                e.preventDefault();
                                setEditingStrategy(null);
                            }
                        }}
                        placeholder="Strategy..."
                        className={`w-full min-w-0 px-2 py-0.5 text-xs rounded border outline-none transition-all ${
                            isDarkMode 
                                ? 'bg-black border-zinc-700 text-zinc-100 focus:border-indigo-500' 
                                : 'bg-white border-slate-300 text-slate-900 focus:border-indigo-500 shadow-sm'
                        }`}
                    />
                    <button
                        type="button"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            saveStrategyEdit(trade);
                        }}
                        className="p-1 rounded text-emerald-500 hover:bg-emerald-500/10 transition-colors shrink-0"
                        title="Save Strategy"
                    >
                        <Check size={14} />
                    </button>
                    <button
                        type="button"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setEditingStrategy(null);
                        }}
                        className={`p-1 rounded transition-colors shrink-0 ${isDarkMode ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/10' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
                        title="Cancel"
                    >
                        <X size={12} />
                    </button>
                </div>
            ) : (
                <div 
                    className="flex items-center gap-1.5 min-w-0 max-w-full cursor-pointer"
                    onClick={() => toggleExpand(trade.id)}
                >
                    <span 
                        className={`text-xs font-medium truncate ${
                            getStrategyTags(trade).length > 0 
                                ? (isDarkMode ? 'text-zinc-300' : 'text-slate-700') 
                                : 'opacity-40 italic'
                        }`}
                        title={getStrategyTags(trade).join(', ')}
                    >
                        {getStrategyTags(trade).length > 0 ? getStrategyTags(trade).join(', ') : 'No Strategy'}
                    </span>
                    <button
                        type="button"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setEditingStrategy({ tradeId: trade.id, value: getStrategyTags(trade).join(', ') });
                        }}
                        className={`p-1 rounded opacity-0 group-hover/strategy:opacity-100 transition-opacity shrink-0 ${
                            isDarkMode ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/10' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                        }`}
                        title="Edit Strategy"
                    >
                        <Pencil size={12} />
                    </button>
                </div>
            )}
        </div>
        <div 
            className="col-span-1 relative z-20 flex items-center min-w-0"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
        >
            {editingRating?.tradeId === trade.id ? (
                <div 
                    className="flex items-center gap-1.5 whitespace-nowrap bg-black/60 dark:bg-black/80 px-2 py-1 rounded-xl border border-indigo-500/40 shadow-xl relative z-30"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <div className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((star) => {
                            const currentVal = editingRating.hoverValue !== undefined ? editingRating.hoverValue : editingRating.value;
                            return (
                                <button
                                    key={star}
                                    type="button"
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                    }}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        saveRatingEdit(trade, star);
                                    }}
                                    onMouseEnter={() => setEditingRating(prev => prev ? { ...prev, hoverValue: star } : null)}
                                    onMouseLeave={() => setEditingRating(prev => prev ? { ...prev, hoverValue: undefined } : null)}
                                    className="p-1 hover:scale-125 transition-transform cursor-pointer"
                                    title={`Set ${star} star${star > 1 ? 's' : ''}`}
                                >
                                    <Star 
                                        size={14} 
                                        className={`${
                                            star <= currentVal
                                                ? 'text-amber-400 fill-amber-400' 
                                                : isDarkMode ? 'text-zinc-700 hover:text-amber-400/50' : 'text-slate-400 hover:text-amber-400/50'
                                        }`} 
                                    />
                                </button>
                            );
                        })}
                    </div>
                    <button
                        type="button"
                        onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                        }}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            saveRatingEdit(trade);
                        }}
                        className="p-1 rounded-md bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all shrink-0 cursor-pointer shadow-sm ml-0.5"
                        title="Save Rating"
                    >
                        <Check size={14} />
                    </button>
                    <button
                        type="button"
                        onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                        }}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setEditingRating(null);
                        }}
                        className={`p-1 rounded-md transition-all shrink-0 cursor-pointer ${isDarkMode ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/10' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'}`}
                        title="Cancel"
                    >
                        <X size={13} />
                    </button>
                </div>
            ) : (
                <div 
                    className="flex items-center gap-1.5 group/rating cursor-pointer min-w-0"
                    onClick={(e) => {
                        e.stopPropagation();
                        setEditingRating({ tradeId: trade.id, value: trade.rating || 0 });
                    }}
                    title="Click to edit rating"
                >
                    <ReadOnlyStarRating rating={trade.rating || 0} isDarkMode={isDarkMode} />
                    <button
                        type="button"
                        onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                        }}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setEditingRating({ tradeId: trade.id, value: trade.rating || 0 });
                        }}
                        className={`p-1 rounded opacity-0 group-hover/rating:opacity-100 transition-opacity shrink-0 ${
                            isDarkMode ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/10' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                        }`}
                        title="Edit Rating"
                    >
                        <Pencil size={12} />
                    </button>
                </div>
            )}
        </div>
                <div className="col-span-1 text-right cursor-pointer" onClick={() => toggleExpand(trade.id)}>
                    <p className={`font-mono font-bold ${safePnL(trade.pnl) > 0 ? 'text-emerald-500' : safePnL(trade.pnl) < 0 ? 'text-rose-500' : ''}`}>
                        {safePnL(trade.pnl) > 0 ? '+' : safePnL(trade.pnl) < 0 ? '-' : ''}{userProfile.currencySymbol}{Math.abs(safePnL(trade.pnl)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className={`text-[10px] font-bold uppercase ${trade.result === 'Win' ? 'text-emerald-500' : trade.result === 'Loss' ? 'text-rose-500' : 'text-zinc-500'}`}>
                        {trade.result} {trade.rr > 0 ? `(${trade.rr}R)` : ''}
                    </p>
                </div>
                <div className="col-span-1 flex justify-center">
                    <div onClick={() => toggleExpand(trade.id)} className={`p-1 rounded-full cursor-pointer transition-all ${expandedTradeId === trade.id ? 'rotate-180 bg-indigo-500 text-white' : isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>
                        <ChevronDown size={18} />
                    </div>
                </div>
            </div>
            {expandedTradeId === trade.id && renderTradeDetails(trade)}
        </React.Fragment>
    );

    return (
        <div className={`w-full h-full overflow-hidden flex flex-col p-4 sm:p-8 pb-nav ${isDarkMode ? 'bg-[#000000] text-zinc-200' : 'bg-slate-50 text-slate-900'}`}>
            {previewImage && (
                <div 
                    className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-sm flex flex-col p-4 animate-in fade-in duration-200"
                    onClick={() => setPreviewImage(null)}
                >
                    <div className="flex items-center justify-between px-6 py-4 text-white">
                        <h3 className="font-bold">{previewImage.title}</h3>
                        <button
                            onClick={() => setPreviewImage(null)}
                            className="p-2 hover:bg-white/10 rounded-full transition-colors"
                            aria-label="Close preview"
                        >
                            <X size={24} />
                        </button>
                    </div>
                    <div className="flex-1 flex items-center justify-center overflow-hidden">
                        <img 
                            src={previewImage.url} 
                            alt="Preview" 
                            className="max-w-full max-h-full object-contain animate-in zoom-in-95 duration-300" 
                            onClick={(e) => e.stopPropagation()}
                        />
                    </div>
                </div>
            )}
            {(() => {
                const detailTrade = trades.find((t) => t.id === detailTradeId);
                return detailTrade ? (
                    <MobileTradeDetailSheet
                        trade={detailTrade}
                        isDarkMode={isDarkMode}
                        userProfile={userProfile}
                        isDemoMode={isDemoMode}
                        onClose={() => setDetailTradeId(null)}
                        onEdit={(t) => { setDetailTradeId(null); onEditTrade(t); }}
                        onDelete={(id) => { onDeleteTrades([id]); setDetailTradeId(null); }}
                        onUpdateTrade={onUpdateTrade}
                        onViewChange={onViewChange}
                        editingComment={editingComment}
                        onBeginCommentEdit={beginCommentEdit}
                        onSaveCommentEdit={saveCommentEdit}
                        onCancelCommentEdit={() => setEditingComment(null)}
                        onCommentChange={(value) => setEditingComment((prev) => (prev ? { ...prev, value } : prev))}
                        onPreviewImage={(url, title) => setPreviewImage({ url, title })}
                        onUploadImage={handleUpload}
                        onDeleteImage={handleDeleteImage}
                    />
                ) : null;
            })()}
            <header className="mb-4 flex flex-col gap-1">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <h1 className="text-[22px] font-black tracking-tight leading-none">Trade Journal</h1>
                        {isDemoMode && (
                            <span className="px-2 py-1 rounded-full text-[10px] font-black tracking-widest border border-amber-500/30 bg-amber-500/10 text-amber-300">
                                Demo
                            </span>
                        )}
                    </div>
                    <p className={`text-[13px] font-medium leading-relaxed ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>
                        {isDemoMode ? 'Sample trades — 3 months loaded.' : 'Your market execution history.'}
                    </p>
                </div>
                {selectedIds.length > 0 ? (
                    <div className="flex items-center gap-2 animate-in slide-in-from-right-4">
                        <span className="text-xs font-bold opacity-60 mr-1">{selectedIds.length} Selected</span>
                        {selectedIds.length >= 2 && (
                            <button 
                                onClick={() => areAllLinkedToSameSetup ? handleDetachSelected() : setIsLinkModalOpen(true)}
                                className={`py-1.5 px-3 rounded flex items-center gap-1.5 text-xs font-bold transition-all shadow-lg ${
                                    areAllLinkedToSameSetup 
                                    ? 'bg-rose-600 text-white hover:bg-rose-700 shadow-rose-500/20' 
                                    : 'bg-violet-600 text-white hover:bg-violet-700 shadow-violet-500/20'
                                }`}
                            >
                                {areAllLinkedToSameSetup ? (
                                    <><Unlink size={14} /> Unlink Setup</>
                                ) : (
                                    <><Link size={14} /> Link to Setup</>
                                )}
                            </button>
                        )}
                        {selectedSetupSummary && (
                            <div className={`hidden lg:flex flex-col gap-0.5 px-3 py-1.5 rounded-lg border text-left ${selectedSetupSummary.mixedSetupState ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : isDarkMode ? 'border-[#27272a] bg-[#000000] text-zinc-300' : 'border-slate-200 bg-white text-slate-700'}`}>
                                <span className="text-[8px] font-black uppercase tracking-widest opacity-60">Setup Preview</span>
                                <span className="text-xs font-bold leading-tight">{selectedSetupSummary.setupName}</span>
                                <span className="text-[9px] opacity-50">
                                    {selectedSetupSummary.tradeCount} trades · {selectedSetupSummary.pairCount} pair{selectedSetupSummary.pairCount === 1 ? '' : 's'}
                                </span>
                            </div>
                        )}
                        <button onClick={() => setSelectedIds([])} className={`py-1.5 px-3 rounded flex items-center gap-1.5 text-xs font-bold transition-all ${isDarkMode ? 'bg-black text-zinc-400 hover:bg-black' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}>Cancel</button>
                        <button onClick={handleBulkDelete} className="py-1.5 px-3 rounded flex items-center gap-1.5 text-xs font-bold transition-all bg-rose-500 text-white hover:bg-rose-600 shadow-lg shadow-rose-500/20"><Trash2 size={14} /> Delete Selected</button>
                    </div>
                ) : (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2 w-full sm:w-auto overflow-x-auto no-scrollbar snap-x snap-mandatory sm:snap-none max-[360px]:flex-col max-[360px]:overflow-visible">
                        <div className={`flex rounded-lg border overflow-hidden p-0.5 gap-0.5 w-full sm:w-auto ${isDarkMode ? 'border-[#27272a] bg-[#000000]' : 'border-slate-200 bg-white'}`}>
                            <button 
                                onClick={() => setViewMode('list')} 
                                aria-label="Switch to List View"
                                className={`h-11 min-h-[44px] py-1.5 px-2.5 rounded flex flex-1 justify-center items-center gap-1.5 text-xs font-bold transition-all sm:flex-none ${viewMode === 'list' ? 'bg-[#FF4F00] text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                            >
                                <List size={14} /> List
                            </button>
                            <button 
                                onClick={() => setViewMode('calendar')} 
                                aria-label="Switch to Calendar View"
                                className={`h-11 min-h-[44px] py-1.5 px-2.5 rounded flex flex-1 justify-center items-center gap-1.5 text-xs font-bold transition-all sm:flex-none ${viewMode === 'calendar' ? 'bg-[#FF4F00] text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                            >
                                <CalendarIcon size={14} /> Calendar
                            </button>
                        </div>
                        {viewMode === 'list' && (
                        <div className="relative">
                            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                            <input 
                                id="journal-search-input"
                                name="search"
                                aria-label="Search pair, tag or asset"
                                placeholder="Search pair, tag or asset..." 
                                value={searchTerm} 
                                onChange={(e) => setSearchTerm(e.target.value)} 
                                className={`pl-8 pr-3 h-11 min-h-[44px] rounded-lg border text-xs outline-none w-full sm:w-56 ${isDarkMode ? 'bg-[#000000] border-[#27272a] focus:border-blue-500' : 'bg-white border-slate-200'}`} 
                            />
                        </div>
                        )}
                        <div className="relative">
                            {/* Outer control is a div — nesting a <button> inside a
                                <button> is invalid HTML and the inner clear action
                                never fired reliably. */}
                            <div
                                role="button"
                                tabIndex={0}
                                onClick={() => setShowDateFilter(!showDateFilter)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        setShowDateFilter(!showDateFilter);
                                    }
                                }}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-all ${dateRange ? 'border-indigo-500 bg-indigo-500/10 text-indigo-500' : isDarkMode ? 'border-[#27272a] hover:border-[#3a3a3e]' : 'border-slate-200 hover:border-slate-300'}`}
                            >
                                <CalendarIcon size={14} />
                                <span className="hidden sm:inline">
                                    {dateRange ? `${dateRange.start} - ${dateRange.end}` : 'Date Range'}
                                </span>
                                {dateRange && (
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); setDateRange(null); }}
                                        className="ml-1 p-0.5 rounded hover:bg-indigo-500/20"
                                        aria-label="Clear date range"
                                    >
                                        <X size={10} />
                                    </button>
                                )}
                            </div>
                            {showDateFilter && (
                                <div className={`absolute right-0 top-full mt-2 p-4 rounded-xl border shadow-xl z-50 min-w-[320px] ${isDarkMode ? 'bg-[#000000] border-[#27272a]' : 'bg-white border-slate-200'}`}>
                                    <p className="text-xs font-bold mb-3 uppercase tracking-wider opacity-60">Quick Select</p>
                                    <div className="flex flex-wrap gap-2 mb-4">
                                        {quickRanges.map((range) => (
                                            <button
                                                key={range.label}
                                                onClick={() => { applyQuickRange(range.days); setShowDateFilter(false); }}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${range.days === -99 ? (!dateRange ? 'bg-indigo-500 text-white' : isDarkMode ? 'bg-black hover:bg-black' : 'bg-slate-100 hover:bg-slate-200') : isDarkMode ? 'bg-black hover:bg-black' : 'bg-slate-100 hover:bg-slate-200'}`}
                                                >
                                                    {range.label}
                                            </button>
                                        ))}
                                    </div>
                                    <p className="text-xs font-bold mb-3 uppercase tracking-wider opacity-60">Custom Range</p>
                                    <div className="space-y-3">
                                        <div className="flex flex-wrap gap-2">
                                            {[
                                                { label: 'Last 7', days: 7 },
                                                { label: 'Last 30', days: 30 },
                                                { label: 'This Month', days: -1 },
                                                { label: 'Last Month', days: -2 },
                                                { label: 'Clear', days: -99 },
                                            ].map((preset) => (
                                                <button
                                                    key={preset.label}
                                                    onClick={() => {
                                                        if (preset.days === -99) {
                                                            setDraftDateRange(null);
                                                            return;
                                                        }
                                                        setDraftDateRange(getRangeForDays(preset.days));
                                                    }}
                                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${isDarkMode ? 'bg-black hover:bg-black' : 'bg-slate-100 hover:bg-slate-200'}`}
                                                >
                                                    {preset.label}
                                                </button>
                                            ))}
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold uppercase tracking-wider opacity-50 block mb-1">Start Date</label>
                                            <input
                                                type="date"
                                                value={draftDateRange?.start || ''}
                                                max={draftDateRange?.end || undefined}
                                                onChange={(e) => setDraftDateRange(prev => ({ start: e.target.value, end: prev?.end || e.target.value }))}
                                                className={`w-full px-3 py-2 rounded-lg border text-sm ${isDarkMode ? 'bg-[#000000] border-[#27272a]' : 'bg-white border-slate-200'}`}
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold uppercase tracking-wider opacity-50 block mb-1">End Date</label>
                                            <input
                                                type="date"
                                                value={draftDateRange?.end || ''}
                                                min={draftDateRange?.start || undefined}
                                                onChange={(e) => setDraftDateRange(prev => ({ start: prev?.start || e.target.value, end: e.target.value }))}
                                                className={`w-full px-3 py-2 rounded-lg border text-sm ${isDarkMode ? 'bg-[#000000] border-[#27272a]' : 'bg-white border-slate-200'}`}
                                            />
                                        </div>
                                        <div className="flex gap-2 pt-1">
                                            <button
                                                onClick={() => {
                                                    setDraftDateRange(dateRange ?? getCurrentMonthRange());
                                                }}
                                                className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${isDarkMode ? 'bg-black hover:bg-black text-zinc-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                                            >
                                                Reset
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setDateRange(draftDateRange);
                                                    setShowDateFilter(false);
                                                }}
                                                disabled={!draftDateRange?.start || !draftDateRange?.end}
                                                className="flex-1 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                Apply Range
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
                {dateRange && (
                    <div className="mb-4 flex items-center gap-2">
                        <span className="text-xs font-medium opacity-60">Showing {filteredTrades.length} of {trades.length} trades</span>
                        <span className="text-xs opacity-40">|</span>
                        <span className="text-xs font-medium text-indigo-500">{dateRange.start} to {dateRange.end}</span>
                    </div>
                )}
            </header>
            
            <div className={`flex-1 rounded-t-2xl border-t border-l border-r overflow-hidden flex flex-col ${isDarkMode ? 'bg-[#000000] border-[#27272a]' : 'bg-white border-slate-200 shadow-md'}`}>
                {viewMode === 'calendar' ? (
                    <CalendarView isDarkMode={isDarkMode} trades={trades} userProfile={userProfile} onSelectTrade={(t) => setDetailTradeId(t.id)} />
                ) : (
                    <>
                    {/* Mobile closed trade rows: swipe-left edits, swipe-right deletes,
                        tap opens the full-screen detail sheet. */}
                    <div className="sm:hidden flex flex-col px-0 py-1 pb-nav overflow-y-auto no-scrollbar flex-1 min-h-0">
                        {isLoading ? (
                            <JournalSkeleton isDarkMode={isDarkMode} />
                        ) : filteredTrades.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-14 px-6 text-center rounded-2xl border border-dashed border-zinc-700/60 bg-zinc-900/20 my-3">
                                <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-3 text-zinc-500"><Search size={20} /></div>
                                <p className="text-[13px] font-black tracking-tight text-white">
                                    {searchTerm || dateRange ? "No trades match filter" : (activePortfolioName ? `No trades in ${activePortfolioName}` : "No trades found")}
                                </p>
                                <p className="text-[12px] font-medium leading-relaxed text-zinc-500 mt-1 max-w-[32ch]">
                                    {searchTerm || dateRange 
                                        ? "Try adjusting your search or date filter." 
                                        : activePortfolioId && activePortfolioId !== 'all'
                                            ? `This portfolio has no trades yet. Log manual trades to get started.`
                                            : "Try adjusting your search or date filter — or log manual trades to get started."}
                                </p>
                                <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
                                    <button 
                                        onClick={() => onViewChange('log-trade')} 
                                        className="h-9 px-4 rounded-xl bg-[#FF4F01] text-white text-[12px] font-black tracking-wide shadow-[0_4px_16px_rgba(255,79,1,0.25)] flex items-center gap-1.5"
                                    >
                                        Log Trade
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                {groupedTrades.slice(0, visibleGroupCount).map((group) => (
                                    group.type === 'pending' ? (
                                        <div key={group.id} className="flex items-center gap-2 py-3 px-3 border-b border-indigo-500/20 bg-indigo-500/5 min-h-[44px]">
                                            <RefreshCw size={14} className="text-indigo-500 animate-spin shrink-0" />
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-black leading-none">{group.trades[0].pair} · {group.trades[0].direction}</p>
                                                <p className="text-[11px] text-zinc-500 mt-1">Syncing… <span className="text-indigo-400 font-bold">Pending</span></p>
                                            </div>
                                            <span className="text-[11px] font-bold px-2 py-1 rounded-full border border-indigo-500/30 text-indigo-400">Offline</span>
                                        </div>
                                    ) : group.type === 'setup' ? (
                                        <div key={group.id} className="rounded-xl border border-violet-500/20 overflow-hidden bg-violet-500/[0.04] my-2">
                                            <div className="px-3.5 py-2.5 flex items-center justify-between border-b border-violet-500/15 bg-violet-500/[0.06]">
                                                <span className="text-[11px] font-black tracking-widest uppercase text-violet-300">{group.setupName}</span>
                                                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300">{group.trades.length} trades</span>
                                            </div>
                                            <div>
                                                {group.trades.map((trade) => (
                                                    <div key={`mob-${group.id}-${trade.id}`}>
                                                        <MobileTradeCard trade={trade} isDarkMode={isDarkMode} currencySymbol={userProfile?.currencySymbol || '$'} isSelected={selectedIds.includes(trade.id)} onSelect={() => handleSelectOne(trade.id)} onToggle={() => setDetailTradeId(trade.id)} onDelete={(id) => { onDeleteTrades([id]); }} onEdit={(tr) => onEditTrade(tr)} showCheckbox={isLinkMode} />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ) : (
                                        <div key={group.id}>
                                            <MobileTradeCard trade={group.trades[0]} isDarkMode={isDarkMode} currencySymbol={userProfile?.currencySymbol || '$'} isSelected={selectedIds.includes(group.trades[0].id)} onSelect={() => handleSelectOne(group.trades[0].id)} onToggle={() => setDetailTradeId(group.trades[0].id)} onDelete={(id) => { onDeleteTrades([id]); }} onEdit={(tr) => onEditTrade(tr)} showCheckbox={isLinkMode} />
                                        </div>
                                    )
                                ))}
                                <p className="text-center text-[10px] font-bold tracking-widest uppercase text-zinc-600 py-3">Showing {Math.min(visibleGroupCount, groupedTrades.length)} of {groupedTrades.length} groups · {filteredTrades.length} of {trades.length} trades</p>
                                {visibleGroupCount < groupedTrades.length && (
                                    <button
                                        onClick={() => setVisibleGroupCount(c => c + GROUP_PAGE_SIZE)}
                                        className="mx-auto mb-4 h-10 px-6 rounded-xl bg-white/[0.06] text-white text-[12px] font-black tracking-wide active:scale-95 transition-all"
                                    >
                                        Show more ({groupedTrades.length - visibleGroupCount} left)
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                    {/* Fixed 11-column table: hidden on phones (the cards above take
                        over), horizontally scrolled from sm up instead of crushing
                        every cell. */}
                        <div className="hidden sm:flex sm:flex-col flex-1 min-h-0 overflow-x-auto custom-scrollbar">
                        <div className="min-w-[1180px] flex flex-col flex-1 min-h-0">
                        <div className={`grid grid-cols-[40px_1.4fr_1fr_0.9fr_1.1fr_1.1fr_0.9fr_1.3fr_1.4fr_1.2fr_40px] px-6 py-4 border-b text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'border-[#27272a] text-zinc-500' : 'border-slate-100 text-slate-400'}`}>
                            <div className="col-span-1 flex items-center justify-center">
                                <button onClick={handleSelectAll} className="opacity-50 hover:opacity-100">
                                    {areAllFilteredSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                                </button>
                            </div>
                            <div className="col-span-1 pl-2">Date/Time</div>
                            <div className="col-span-1">Pair</div>
                            <div className="col-span-1">Type</div>
                            <div className="col-span-1">Direction</div>
                            <div className="col-span-1">Session</div>
                            <div className="col-span-1">Duration</div>
                            <div className="col-span-1">Strategy</div>
                            <div className="col-span-1">Rating</div>
                            <div className="col-span-1 text-right">PnL / Result</div>
                            <div className="col-span-1"></div>
                        </div>
                        <div className="overflow-y-auto custom-scrollbar flex-1 px-4">
                            {isLoading ? (
                                <JournalSkeleton isDarkMode={isDarkMode} />
                            ) : groupedTrades.length === 0 ? (
                                <EmptyState
                                    isDarkMode={isDarkMode}
                                    type="trades"
                                    title={searchTerm || dateRange ? "No Trades Match Your Filter" : (activePortfolioName ? `No Trades in ${activePortfolioName}` : "Your Journal is Empty")}
                                    description={searchTerm || dateRange ? "Try adjusting your search or date range to find trades." : (activePortfolioId && activePortfolioId !== 'all' ? `This portfolio (${activePortfolioName}) doesn't have any trades yet. Log manual trades to get started.` : "Start logging your trades to track your trading performance and build your trading journal.")}
                                    action={!searchTerm && !dateRange ? {
                                        label: "Log Your First Trade",
                                        onClick: () => onViewChange('log-trade')
                                    } : undefined}
                                />
                            ) : (
                                groupedTrades.slice(0, visibleGroupCount).map(group => {
                                    if (group.type === 'pending') {
                                        const trade = group.trades[0];
                                        return (
                                            <div key={group.id} className={`grid grid-cols-[40px_1.4fr_1fr_0.9fr_1.1fr_1.1fr_0.9fr_1.3fr_1.4fr_1.2fr_40px] px-2 py-4 border-b items-center transition-all rounded-xl opacity-60 border-dashed ${isDarkMode ? 'border-indigo-500/20 bg-indigo-500/5' : 'border-indigo-200 bg-indigo-50/30'}`}>
                                                <div className="col-span-1 flex items-center justify-center">
                                                    <RefreshCw size={14} className="text-indigo-500 animate-spin" />
                                                </div>
                                                <div className="col-span-1 pl-2">
                                                    <p className="font-bold text-sm">{trade.date}</p>
                                                    <p className="text-xs opacity-50">{trade.time}</p>
                                                </div>
                                                <div className="col-span-1 font-bold">{trade.pair}</div>
                                                <div className="col-span-1 text-xs opacity-70">{trade.assetType}</div>
                                                <div className="col-span-1">
                                                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold ${trade.direction === 'Long' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                                                        {trade.direction === 'Long' ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {trade.direction}
                                                    </span>
                                                </div>
                                                <div className="col-span-1 text-xs opacity-80">{trade.session}</div>
                                                <div className="col-span-1 text-xs opacity-50">---</div>
                                                <div className="col-span-1 flex flex-wrap gap-1">
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-indigo-500/30 text-indigo-500 animate-pulse">Syncing...</span>
                                                </div>
                                                <div className="col-span-1">
                                                    <ReadOnlyStarRating rating={trade.rating || 0} isDarkMode={isDarkMode} />
                                                </div>
                                                <div className="col-span-1 text-right">
                                                    <p className={`font-mono font-bold ${safePnL(trade.pnl) > 0 ? 'text-emerald-500' : safePnL(trade.pnl) < 0 ? 'text-rose-500' : ''}`}>
                                                        {safePnL(trade.pnl) > 0 ? '+' : safePnL(trade.pnl) < 0 ? '-' : ''}{userProfile.currencySymbol}{Math.abs(safePnL(trade.pnl)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </p>
                                                </div>
                                                <div className="col-span-1"></div>
                                            </div>
                                        );
                                    }

                                    if (group.type === 'standalone') {
                                        return renderTradeRow(group.trades[0], false, false, false, group.id);
                                    }

                                    const isExpanded = expandedSetupIds.includes(group.setupId!);
                                    const totalPnL = group.trades.reduce((acc, t) => acc + safePnL(t.pnl), 0);
                                    const tradeIds = group.trades.map(t => t.id);
                                    const allSelected = tradeIds.every(id => selectedIds.includes(id));

                                    return (
                                        <div key={group.id} className="group mt-1 border-b dark:border-zinc-800/50 pb-1">
                                            <div className={`grid grid-cols-[40px_1.4fr_1fr_0.9fr_1.1fr_1.1fr_0.9fr_1.3fr_1.4fr_1.2fr_40px] px-2 py-4 items-center transition-all rounded-xl bg-violet-500/5 border-2 ${isExpanded ? 'border-violet-500/30' : 'border-transparent'}`}>
                                                <div className="col-span-1 flex items-center justify-center">
                                                    <button onClick={() => handleSelectSetup(group.setupId!, tradeIds)} className={`${allSelected ? 'text-indigo-500' : 'text-zinc-500 hover:text-zinc-300'}`}>
                                                        {allSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                                                    </button>
                                                </div>
                                                <div className="col-span-1 pl-2 cursor-pointer flex flex-col justify-center" onClick={() => toggleSetupExpand(group.setupId!)}>
                                                    <p className="font-bold text-sm">{group.date}</p>
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-violet-500 leading-none mt-1 truncate">
                                                        {group.setupName || 'Linked Setup'}
                                                    </p>
                                                    <p className="text-[9px] opacity-40 leading-none mt-1">
                                                        {group.trades.length} trade{group.trades.length === 1 ? '' : 's'}
                                                    </p>
                                                </div>
                                                <div className="col-span-1 font-bold text-sm">{group.trades[0].pair}</div>
                                                <div className="col-span-1 text-xs opacity-70">{group.trades[0].assetType}</div>
                                                <div className="col-span-1">
                                                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold ${group.trades[0].direction === 'Long' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                                                        {group.trades[0].direction === 'Long' ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {group.trades[0].direction}
                                                    </span>
                                                </div>
                                                <div className="col-span-1 text-xs opacity-80">{group.trades[0].session}</div>
                                                <div className="col-span-1 text-xs opacity-50">---</div>
        <div className="col-span-1 flex flex-wrap gap-1">
          {(group.trades[0].tags || []).slice(0, 1).map((tag, i) => (
            <span key={i} className={`text-xs font-medium ${isDarkMode ? 'text-zinc-300' : 'text-slate-700'}`}>{tag}</span>
          ))}
        </div>
                                                <div className="col-span-1">
                                                    <ReadOnlyStarRating rating={group.trades[0].rating || 0} isDarkMode={isDarkMode} />
                                                </div>
                                                <div className="col-span-1 text-right pr-2">
                                                    <p className={`font-mono font-black text-sm ${totalPnL >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                        {totalPnL >= 0 ? '+' : ''}{userProfile.currencySymbol}{totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </p>
                                                    <p className="text-[9px] font-black uppercase tracking-widest opacity-40">Cluster P&L</p>
                                                </div>
                                                <div className="col-span-1 flex justify-center gap-2">
                                                    <button 
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setPendingBreakSetupId(group.setupId!);
                                                        }}
                                                        className="p-1.5 rounded-full hover:bg-rose-500/10 text-rose-500 transition-all opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                                                        title="Break Cluster"
                                                    >
                                                        <Unlink size={16} />
                                                    </button>
                                                    <button onClick={() => toggleSetupExpand(group.setupId!)} className={`p-1.5 rounded-full transition-all ${isExpanded ? 'rotate-180 bg-violet-500 text-white' : 'hover:bg-violet-500/20 text-violet-500'}`}>
                                                        <ChevronDown size={18} />
                                                    </button>
                                                </div>
                                            </div>
                                            {isExpanded && (
                                                <div className="space-y-0 py-0.5">
                                                    {group.trades.map((trade, idx) => renderTradeRow(trade, true, idx === 0, idx === group.trades.length - 1, `${group.id}-trade-${trade.id}`))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                            {visibleGroupCount < groupedTrades.length && (
                                <div className="hidden sm:flex justify-center py-4">
                                    <button
                                        onClick={() => setVisibleGroupCount(c => c + GROUP_PAGE_SIZE)}
                                        className="h-10 px-6 rounded-xl bg-white/[0.06] text-white text-[12px] font-black tracking-wide active:scale-95 transition-all"
                                    >
                                        Show more ({groupedTrades.length - visibleGroupCount} groups left)
                                    </button>
                                </div>
                            )}
                        </div>
                        </div>
                        </div>
                    </>
                )}
            </div>

            {/* Link Setup Modal — new minimal card (old modal kept below as fallback) */}
            {isLinkModalOpen && USE_NEW_LINK_CARD && (
                <LinkTradesCard
                    count={selectedIds.length}
                    setupName={draftSetupName}
                    onSetupNameChange={setDraftSetupName}
                    placeholderName={selectedSetupSummary?.setupName || 'EURUSD 3-Trade Setup'}
                    pairCount={selectedSetupSummary ? new Set(selectedTrades.map(t => t.pair)).size : undefined}
                    mixedState={selectedSetupSummary?.mixedSetupState}
                    alreadyLinked={selectedSetupSummary?.hasExistingSetup && !selectedSetupSummary?.mixedSetupState}
                    isDarkMode={isDarkMode}
                    onClose={() => { setIsLinkModalOpen(false); setSelectedIds([]); }}
                    onConfirm={handleLinkSelected}
                />
            )}
            {isLinkModalOpen && !USE_NEW_LINK_CARD && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center p-6">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setIsLinkModalOpen(false); setSelectedIds([]); }} />
                    <div className={`relative w-full max-w-md p-8 rounded-[32px] border shadow-2xl ${isDarkMode ? 'bg-[#000000] border-zinc-800' : 'bg-white border-slate-200'}`}>
                        <div className="flex items-center gap-3 mb-6">
                            <div className="p-2.5 rounded-2xl bg-violet-500/10 text-violet-500">
                                <Link size={24} />
                            </div>
                            <h3 className="text-2xl font-black tracking-tight">Link Trades</h3>
                        </div>
                        <p className={`text-sm mb-8 leading-relaxed ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
                            These {selectedIds.length} trades will be linked together into a strategic cluster in your journal.
                        </p>
                        <div className="space-y-4 mb-8">
                            <div>
                                <label className="text-[10px] font-black uppercase tracking-widest opacity-50 block mb-2">
                                    Setup Name
                                </label>
                                <input
                                    type="text"
                                    value={draftSetupName}
                                    onChange={(e) => setDraftSetupName(e.target.value)}
                                    placeholder={selectedSetupSummary?.setupName || 'EURUSD 3-Trade Setup'}
                                    maxLength={80}
                                    className={`w-full px-4 py-3 rounded-2xl border text-sm outline-none ${isDarkMode ? 'bg-[#000000] border-[#27272a] text-zinc-100 focus:border-violet-500' : 'bg-slate-50 border-slate-200 text-slate-900 focus:border-violet-500'}`}
                                />
                                <p className={`mt-2 text-[11px] ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>
                                    A readable name makes the setup easier to find later in both Journal and Desktop Bridge.
                                </p>
                            </div>
                            {selectedSetupSummary?.mixedSetupState && (
                                <div className="p-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-100 text-sm leading-relaxed">
                                    Some selected trades are already linked to different setups. Linking will replace those existing links with this new setup name.
                                </div>
                            )}
                            {selectedSetupSummary?.hasExistingSetup && !selectedSetupSummary.mixedSetupState && (
                                <div className="p-4 rounded-2xl border border-violet-500/20 bg-violet-500/10 text-violet-100 text-sm leading-relaxed">
                                    These trades are already linked together. Linking again will create a fresh setup cluster.
                                </div>
                            )}
                        </div>
                        <div className="flex gap-3">
                            <button 
                                onClick={() => { setIsLinkModalOpen(false); setSelectedIds([]); }}
                                className={`flex-1 py-4 rounded-2xl font-black text-sm transition-all ${isDarkMode ? 'bg-black text-white hover:bg-black' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={handleLinkSelected}
                                disabled={!draftSetupName.trim() || selectedIds.length < 2}
                                className="flex-1 py-4 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-2xl font-black text-sm transition-all shadow-xl shadow-violet-500/20"
                            >
                                Link Now
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {pendingBreakSetupId && (
                <ConfirmationModal
                    isOpen={true}
                    title="Break Cluster"
                    description="Break this cluster? Individual trades will be kept but unlinked."
                    confirmText="Break Cluster"
                    variant="warning"
                    isDarkMode={isDarkMode}
                    onConfirm={async () => {
                        const setupId = pendingBreakSetupId;
                        setPendingBreakSetupId(null);
                        await handleBreakCluster(setupId);
                    }}
                    onCancel={() => setPendingBreakSetupId(null)}
                />
            )}
        </div>
    );
};

export default Journal;
