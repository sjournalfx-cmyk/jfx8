import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Calendar, Clock, Target, Hash, Image as ImageIcon, Save, ChevronRight, ChevronLeft, TrendingUp, TrendingDown, Layout, Type, CheckCircle2, XCircle, MinusCircle, Upload, FileText, ArrowRight, Brain, AlertTriangle, ShieldCheck, Check, ChevronDown, X, Star, Eye, Trash2, Square, Lock } from 'lucide-react';
import { Trade, AssetType, UserProfile } from '../types';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { getSASTDateTime } from '../lib/timeUtils';
import RichTextEditor from './RichTextEditor';
import { Select } from './Select';
import ConfirmationModal from './ConfirmationModal';
import { APP_CONSTANTS, PLAN_FEATURES, normalizePlan } from '../lib/constants';
import { useToast } from './ui/Toast';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Card } from './ui/Card';
import { StarRating } from './ui/StarRating';
import { PhasedLoader } from './ui/PhasedLoader';
import { UsageBadge } from './ui/UsageBadge';
import { calculateRiskReward, getSessionFromTime } from '../lib/trade-calculations';
import { parseMTTradeCSV } from '../lib/trade-import';
import { TradeFormStep1 } from './log-trade/TradeFormStep1';
import { TradeFormStep2 } from './log-trade/TradeFormStep2';
import { TradeFormStep3 } from './log-trade/TradeFormStep3';
import { cn } from '../lib/utils';
import { normalizeTrade } from '../lib/trade-normalization';
import { useChecklistTemplates } from '../lib/useChecklistTemplates';
import { computeAdherence, derivePlanAdherence, gradeFor } from '../lib/disciplineChecklist';

interface LogTradeProps {
    isDarkMode: boolean;
    onSave: (trade: Trade) => Promise<void>;
    onBatchSave?: (trades: Trade[]) => Promise<void>;
    initialTrade?: Trade;
    onCancel?: () => void;
    currencySymbol: string;
    userProfile?: UserProfile | null;
    trades: Trade[];
    isReadOnly?: boolean;
    portfolioName?: string;
    /** Free-tier monthly usage badge (hidden when the limit is unlimited). */
    tradesUsedThisMonth?: number;
    maxTradesThisMonth?: number;
}

const STEPS = [
    { label: 'Market Context', description: 'Setup & conditions' },
    { label: 'Execution', description: 'Entry & risk management' },
    { label: 'Review', description: 'Outcome & psychology' },
];

/** Phases shown while a CSV file is read and parsed during import. */
const IMPORT_PHASES = [
    { icon: Upload, text: 'Reading your file' },
    { icon: FileText, text: 'Parsing trades' },
    { icon: CheckCircle2, text: 'Validating entries' },
];

const StepIndicator = ({ current, total, isDarkMode, onSelect }: { current: number, total: number, isDarkMode: boolean, onSelect: (step: number) => void }) => (
    <div className="flex items-center gap-2 md:gap-3 mb-3 px-1 py-1 overflow-visible">
        {Array.from({ length: total }).map((_, i) => {
            const isActive = i + 1 === current;
            const isCompleted = i + 1 < current;
            const step = STEPS[i];
            return (
                <div key={i} className="flex items-center flex-1 last:flex-none min-w-0">
                    <button
                        type="button"
                        onClick={() => onSelect(i + 1)}
                        aria-label={`Go to step ${i + 1}: ${step.label}`}
                        aria-current={isActive ? 'step' : undefined}
                        className={`
                        w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all duration-300 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4F01] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent
                        ${isActive
                                ? 'border-[#FF4F01] bg-[#FF4F01] text-white shadow-lg shadow-[#FF4F01]/30 scale-110'
                                : isCompleted
                                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:border-emerald-500/70'
                                    : isDarkMode ? 'border-[#27272a] bg-[#000000] text-zinc-500 hover:border-[#FF4F01]/60 hover:text-zinc-300' : 'border-slate-200 bg-slate-100 text-slate-400 hover:border-[#FF4F01]/60 hover:text-slate-600'
                            }
                    `}
                    >
                        {isCompleted ? <CheckCircle2 size={14} /> : i + 1}
                    </button>
                    <button
                        type="button"
                        onClick={() => onSelect(i + 1)}
                        aria-label={`Go to step ${i + 1}: ${step.label}`}
                        className="hidden sm:block ml-3 flex-1 min-w-0 text-left cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4F01]"
                    >
                        <p className={`text-sm font-bold ${isActive ? 'text-[#FF4F01]' : isDarkMode ? 'text-zinc-300' : 'text-slate-700'}`}>
                            {step.label}
                        </p>
                        <p className={`text-[10px] ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>
                            {step.description}
                        </p>
                    </button>
                    {i < total - 1 && (
                        <div className={`flex-1 min-w-[24px] h-0.5 mx-4 rounded-full transition-all duration-500 ${isCompleted ? 'bg-emerald-500/40' : isDarkMode ? 'bg-[#27272a]' : 'bg-slate-200'}`} />
                    )}
                </div>
            )
        })}
    </div>
);

const LogTrade: React.FC<LogTradeProps> = ({ isDarkMode, onSave, onBatchSave, initialTrade, onCancel, currencySymbol, userProfile, trades, isReadOnly = false, portfolioName, tradesUsedThisMonth, maxTradesThisMonth }) => {
    const [step, setStep] = useState(1);
    const [isSaving, setIsSaving] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const { addToast } = useToast();
    
    const currentPlan = normalizePlan(userProfile?.plan);
    const isFreeTier = currentPlan === APP_CONSTANTS.PLANS.FREE;
    const features = PLAN_FEATURES[currentPlan];
    const canUploadImages = features.allowImageUploads;
    const isRestricted = !canUploadImages;

    const [confirmModal, setConfirmModal] = useState<{
        isOpen: boolean;
        title: string;
        description: string;
        showCancel?: boolean;
        confirmText?: string;
        cancelText?: string;
        onConfirm: () => void | Promise<void>;
    }>({
        isOpen: false,
        title: '',
        description: '',
        onConfirm: () => { }
    });

    const sast = getSASTDateTime();

    const [formData, setFormData] = useState({
        pair: initialTrade?.pair || '',
        assetType: initialTrade?.assetType || 'Forex' as AssetType,
        date: initialTrade?.date || sast.date,
        time: initialTrade?.time || sast.time,
        session: initialTrade?.session || getSessionFromTime(sast.time),
        direction: initialTrade?.direction || 'Long' as 'Long' | 'Short',
        entryPrice: (initialTrade?.entryPrice !== undefined && initialTrade?.entryPrice !== null) ? initialTrade.entryPrice.toString() : '',
        exitPrice: (initialTrade?.exitPrice !== undefined && initialTrade?.exitPrice !== null) ? initialTrade.exitPrice.toString() : '',
        stopLoss: (initialTrade?.stopLoss !== undefined && initialTrade?.stopLoss !== null) ? initialTrade.stopLoss.toString() : '',
        takeProfit: (initialTrade?.takeProfit !== undefined && initialTrade?.takeProfit !== null) ? initialTrade.takeProfit.toString() : '',
        lots: (initialTrade?.lots !== undefined && initialTrade?.lots !== null) ? initialTrade.lots.toString() : '1.00',
        result: initialTrade?.result || 'Pending' as 'Win' | 'Loss' | 'BE' | 'Pending',
        rating: initialTrade?.rating || 0,
        emotions: initialTrade?.emotions || [] as string[],
        notes: initialTrade?.notes || '',
        exitComment: initialTrade?.exitComment || '',
        planAdherence: initialTrade?.planAdherence || 'Followed Exactly',
        tradingMistake: initialTrade?.tradingMistake || 'None',
        mindset: initialTrade?.mindset || 'Neutral',
        tags: initialTrade?.tags?.join(', ') || '',
        voiceNote: initialTrade?.voiceNote || '',
        setupId: initialTrade?.setupId || '',
        checklistChecks: initialTrade?.checklistChecks || {} as Record<string, boolean>,
        behaviorTags: initialTrade?.behaviorTags || [] as string[],
    });

    // Discipline engine: active checklist template (single template, P1).
    const { activeTemplate: checklistTemplate } = useChecklistTemplates();
    // Soft-warning bypass: set when the user confirms "Save anyway" on a
    // sub-100% checklist; reset whenever the checklist changes.
    //
    // A REF, not state. Confirming re-enters finalizeSave() in the same tick,
    // and a state update would not have landed yet — the stale `false` closure
    // would re-open the same modal and the save would never happen.
    const disciplineConfirmedRef = useRef(false);
    const [disciplineConfirmed, setDisciplineConfirmed] = useState(false);

    const handleChecklistChange = (checks: Record<string, boolean>, tags: string[]) => {
        const items = checklistTemplate.items;
        const touched = Object.keys(checks).length > 0 || tags.length > 0;
        disciplineConfirmedRef.current = false;
        setDisciplineConfirmed(false);
        setFormData(prev => ({
            ...prev,
            checklistChecks: checks,
            behaviorTags: tags,
            // Auto-derive the legacy tier from the checklist; the manual
            // dropdown stays as fallback for untouched/imported trades.
            ...(touched && items.length
                ? { planAdherence: derivePlanAdherence(computeAdherence(checks, items) ?? 0) }
                : {}),
        }));
    };

    const [metrics, setMetrics] = useState({ risk: 0, reward: 0, rr: 0 });

    const pairError = useMemo(() => {
        const pair = formData.pair;
        const type = formData.assetType;
        if (!pair || pair.length < 2) return null;
        let hint = "";
        const isAlphanumeric = /^[A-Z0-9]+$/.test(pair);
        const hasSeparator = /[\/\-\s]/.test(pair);
        if (type === 'Forex') {
            const isStandardForex = /^[A-Z]{6}$/.test(pair);
            const isSeparatedForex = /^[A-Z]{3}[\/\-\s][A-Z]{3}$/.test(pair);
            if (isStandardForex || isSeparatedForex) return null;
            hint = "Forex usually: 'EURUSD' or 'EUR/USD'";
        } else if (type === 'Indices') {
            if (isAlphanumeric && pair.length >= 3 && pair.length <= 8) return null;
            if (hasSeparator && pair.length >= 6) return null;
            hint = "Indices example: 'NAS100', 'GER40'";
        } else if (type === 'Commodities') {
            if (pair.length >= 3) return null;
        } else if (pair.length >= 2) return null;
        return hint;
    }, [formData.pair, formData.assetType]);

    const [screenshots, setScreenshots] = useState<{ before?: string, after?: string }>({
        before: initialTrade?.beforeScreenshot,
        after: initialTrade?.afterScreenshot
    });

    const [previewImage, setPreviewImage] = useState<{ url: string, title: string } | null>(null);
    const isDesktopBridgeTrade = Boolean(
      initialTrade?.ticketId ||
      initialTrade?.tags?.some(tag => /MT[45]_Auto_Journal|Imported/i.test(tag))
    );

    useEffect(() => {
        const entry = parseFloat(formData.entryPrice);
        const sl = parseFloat(formData.stopLoss);
        const tp = parseFloat(formData.takeProfit);
        const exit = parseFloat(formData.exitPrice);

        if (entry && sl && (tp || exit)) {
            const metrics = calculateRiskReward({
                ...formData,
                entryPrice: entry,
                stopLoss: sl,
                takeProfit: tp,
                exitPrice: exit
            });

            setMetrics(metrics);
        } else {
            setMetrics({ risk: 0, reward: 0, rr: 0 });
        }
    }, [formData.entryPrice, formData.stopLoss, formData.takeProfit, formData.exitPrice, formData.lots, formData.assetType, formData.direction]);

    useEffect(() => {
        handleInputChange('session', getSessionFromTime(formData.time));
    }, [formData.time]);

    const handleInputChange = (field: string, value: any) => setFormData(prev => ({ ...prev, [field]: value }));
    const nextStep = () => setStep(s => Math.min(s + 1, 3));
    const prevStep = () => setStep(s => Math.max(s - 1, 1));
    const beforeInputRef = useRef<HTMLInputElement>(null);
    const afterInputRef = useRef<HTMLInputElement>(null);
    const importTradesInputRef = useRef<HTMLInputElement>(null);
    const saveInFlightRef = useRef(false);

    const handleImportMT4MT5 = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !onBatchSave) return;
        const maxImportBytes = 5 * 1024 * 1024;
        if (file.size > maxImportBytes) {
            addToast({ type: 'error', title: 'Import too large', message: 'Choose a CSV smaller than 5 MB.', duration: 5000 });
            e.target.value = '';
            return;
        }
        const reader = new FileReader();
        setIsImporting(true);
        reader.onload = async (event) => {
            try {
                const text = event.target?.result as string;
                if (!text) return;
                const importedTrades = parseMTTradeCSV(text);
                if (importedTrades.length > 0) {
                    if (importedTrades.length > 5000) {
                        addToast({ type: 'error', title: 'Import too large', message: 'A single import is limited to 5,000 trades.', duration: 5000 });
                        return;
                    }
                    setConfirmModal({
                        isOpen: true,
                        title: 'Import Trades',
                        description: `Found ${importedTrades.length} trades. Import them?`,
                        showCancel: true,
                        onConfirm: async () => { await onBatchSave(importedTrades); setConfirmModal(p => ({ ...p, isOpen: false })); }
                    });
                }
            } catch (err) { console.error(err); }
            finally { setIsImporting(false); }
        };
        reader.onerror = () => setIsImporting(false);
        reader.readAsText(file);
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'before' | 'after') => {
        if (isFreeTier) return;
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => setScreenshots(p => ({ ...p, [type]: reader.result as string }));
            reader.readAsDataURL(file);
        }
    };

  const handleDeleteScreenshot = (type: 'before' | 'after') => setScreenshots(p => ({ ...p, [type]: undefined }));

    // Dirty guard: a new trade with any user input asks before discard,
    // so backing out of the form can never look like a silent failed save.
    const isFormDirty = !initialTrade?.id && (
        (formData.pair || '').trim() !== '' ||
        (formData.entryPrice || '') !== '' ||
        step > 1 ||
        Boolean(screenshots.before || screenshots.after)
    );
    const requestCancel = () => {
        if (isFormDirty && onCancel) {
            setConfirmModal({
                isOpen: true,
                title: 'Discard unsaved trade?',
                description: 'You have unsaved input. Leaving now will lose this trade.',
                showCancel: true,
                confirmText: 'Discard',
                cancelText: 'Keep editing',
                onConfirm: () => { setConfirmModal(p => ({ ...p, isOpen: false })); onCancel(); },
            });
            return;
        }
        onCancel?.();
    };

    // Client-side id that never throws, even where crypto.randomUUID is
    // unavailable (non-secure WebViews / older Android system WebView).
    const newClientId = (): string => {
        try {
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                return crypto.randomUUID();
            }
        } catch { /* fall through to fallback below */ }
        return `trade-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    };

    const finalizeSave = async () => {
    if (saveInFlightRef.current) {
        addToast({ type: 'info', title: 'Already saving', message: 'Your trade is being saved — please wait a moment.', duration: 3000 });
        return;
    }
    const entry = parseFloat(formData.entryPrice);
    const stopLoss = parseFloat(formData.stopLoss);
    const takeProfit = parseFloat(formData.takeProfit);
    const exitPrice = formData.exitPrice === '' ? undefined : parseFloat(formData.exitPrice);
    const lots = parseFloat(formData.lots);
    const rating = Number(formData.rating) || 0;
    const normalizedPair = formData.pair.trim().toUpperCase();
    const hasInitialTrade = Boolean(initialTrade?.id || initialTrade?.ticketId || initialTrade?.pnl !== undefined);
    const hasExecutionChanges = hasInitialTrade ? [
      normalizedPair !== (initialTrade?.pair || '').trim().toUpperCase(),
      formData.assetType !== initialTrade?.assetType,
      formData.date !== initialTrade?.date,
      formData.time !== initialTrade?.time,
      formData.session !== initialTrade?.session,
      formData.direction !== initialTrade?.direction,
      entry !== Number(initialTrade?.entryPrice ?? 0),
      (exitPrice ?? undefined) !== (initialTrade?.exitPrice ?? undefined),
      Number.isFinite(stopLoss) ? stopLoss !== Number(initialTrade?.stopLoss ?? 0) : Number(initialTrade?.stopLoss ?? 0) !== 0,
      Number.isFinite(takeProfit) ? takeProfit !== Number(initialTrade?.takeProfit ?? 0) : Number(initialTrade?.takeProfit ?? 0) !== 0,
      Number.isFinite(lots) ? lots !== Number(initialTrade?.lots ?? 0) : Number(initialTrade?.lots ?? 0) !== 0,
      formData.result !== initialTrade?.result,
    ].some(Boolean) : false;

    if (!formData.pair || isNaN(entry)) {
      setConfirmModal({ isOpen: true, title: 'Incomplete', description: 'Fill required fields.', onConfirm: () => setConfirmModal(p => ({ ...p, isOpen: false })) });
      return;
    }

    // Discipline soft warning: sub-100% checklist asks once, never blocks.
    const templateItems = checklistTemplate.items;
    const gateUncheckedCount = templateItems.filter((i) => !formData.checklistChecks?.[i.id]).length;
    if (templateItems.length > 0 && gateUncheckedCount > 0 && !disciplineConfirmedRef.current) {
        const gateRate = computeAdherence(formData.checklistChecks, templateItems) ?? 0;
        const grade = gradeFor(gateRate);
        setConfirmModal({
            isOpen: true,
            title: `Execution Grade ${grade} (${gateRate}%)`,
            description: `${gateUncheckedCount} of ${templateItems.length} rules unchecked. Save anyway? Your grade is recorded either way.`,
            showCancel: true,
            confirmText: 'Save anyway',
            cancelText: 'Review checklist',
            onConfirm: () => {
                setConfirmModal(p => ({ ...p, isOpen: false }));
                disciplineConfirmedRef.current = true;
                setDisciplineConfirmed(true);
                void finalizeSave();
            },
        });
        return;
    }


    let normalizedTrade: Trade;
    try {
      normalizedTrade = normalizeTrade({
      ...(initialTrade || {}),
      ...formData,
      ...metrics,
      id: initialTrade?.id || newClientId(),
      entryPrice: entry,
      exitPrice,
      stopLoss: Number.isFinite(stopLoss) ? stopLoss : 0,
      takeProfit: Number.isFinite(takeProfit) ? takeProfit : 0,
      lots: Number.isFinite(lots) ? lots : 0,
      rating,
      rr: Number.isFinite(metrics.rr) ? metrics.rr : 0,
      tags: formData.tags.split(',').map(t => t.trim()).filter(t => t),
      voiceNote: formData.voiceNote,
      beforeScreenshot: screenshots.before,
      afterScreenshot: screenshots.after,
    }, initialTrade, { preserveProvidedPnl: initialTrade?.ticketId ? true : (hasInitialTrade ? !hasExecutionChanges : false) });
    } catch (err) {
        console.error('Failed to prepare trade for save:', err);
        addToast({ type: 'error', title: 'Could not prepare trade', message: 'Something went wrong building your trade. Please try again.', duration: 6000 });
        return;
    }

    // Discipline snapshot: recompute at save time so the stored grade always
    // matches the checklist. Untouched trades keep the manual planAdherence.
    const checklistTouched =
        Object.keys(formData.checklistChecks || {}).length > 0 || (formData.behaviorTags || []).length > 0;
    if (checklistTouched && templateItems.length > 0) {
        const rate = computeAdherence(formData.checklistChecks, templateItems) ?? 0;
        normalizedTrade.checklistTemplateId = checklistTemplate.id;
        normalizedTrade.checklistChecks = formData.checklistChecks;
        normalizedTrade.adherenceRate = rate;
        normalizedTrade.executionGrade = gradeFor(rate);
        normalizedTrade.planAdherence = derivePlanAdherence(rate);
        normalizedTrade.behaviorTags = formData.behaviorTags;
    }

    const lockedTrade = isDesktopBridgeTrade && initialTrade
      ? {
          ...normalizedTrade,
          pair: initialTrade.pair,
          assetType: initialTrade.assetType,
          direction: initialTrade.direction,
          date: initialTrade.date,
          time: initialTrade.time,
          entryPrice: initialTrade.entryPrice,
          exitPrice: initialTrade.exitPrice,
          result: initialTrade.result,
        }
      : normalizedTrade;

    saveInFlightRef.current = true;
    setIsSaving(true);
    // Watchdog: if the save hangs (network stall, hung upload), say so loudly
    // instead of spinning forever with zero feedback.
    const saveWatchdog = window.setTimeout(() => {
        if (saveInFlightRef.current) {
            addToast({ type: 'warning', title: 'Still saving…', message: 'Taking longer than expected — check your connection. Your input is safe on this form.', duration: 8000 });
        }
    }, 20000);
    try {
      await onSave(lockedTrade);
    } catch (err) {
      console.error('LogTrade save failed:', err);
      addToast({ type: 'error', title: 'Save failed', message: (err as any)?.message || 'Could not save your trade. Check your connection and try again.', duration: 7000 });
    } finally {
      window.clearTimeout(saveWatchdog);
      saveInFlightRef.current = false;
      setIsSaving(false);
    }
  };

    const isLong = formData.direction === 'Long';
    const themeColor = isLong ? 'text-teal-500' : 'text-rose-500';
    const ratingTheme = formData.rating === 5 ? { border: 'border-amber-500', shadow: 'shadow-amber-500/20', glow: 'from-amber-500/20' } : { border: isDarkMode ? 'border-[#27272a]' : 'border-slate-200', shadow: isDarkMode ? 'shadow-black/50' : 'shadow-slate-200', glow: 'from-transparent' };

    return (
        <div className={cn("w-full h-full overflow-hidden flex flex-col font-sans", isDarkMode ? 'bg-[#000000] text-zinc-200' : 'bg-[#F8FAFC] text-slate-900')}>
            {/* Single responsive header (APK parity): compact bar on phones with
                Cancel (step 1) / Back (steps 2-3) on the left, full header with
                Import / Save / Cancel from md up. */}
            <div className={cn("h-[56px] sm:h-[60px] shrink-0 flex items-center gap-1 px-2 sm:px-6 py-2 z-20 relative", isDarkMode ? 'bg-[#000000]' : 'bg-white')}>
                <div className={cn("absolute bottom-0 left-2 sm:left-6 right-2 sm:right-6 h-px", isDarkMode ? "bg-zinc-800/80" : "bg-slate-200")} />
                <div className="shrink-0 min-w-[44px] flex items-center md:hidden">
                    {step === 1 ? (
                        onCancel ? (
                            <button onClick={requestCancel} aria-label="Cancel" className="flex items-center gap-1 min-h-[44px] px-2 -ml-2 rounded-xl text-[13px] font-bold text-zinc-400 active:scale-95 transition-all touch-manipulation">
                                <X size={16} strokeWidth={2.5} /> Cancel
                            </button>
                        ) : <div className="w-[72px]" />
                    ) : (
                        <button onClick={prevStep} aria-label="Back" className="flex items-center gap-1 min-h-[44px] px-2 -ml-2 rounded-xl text-[13px] font-bold text-zinc-400 active:scale-95 transition-all touch-manipulation">
                            <ChevronLeft size={16} strokeWidth={2.5} /> Back
                        </button>
                    )}
                </div>
                <div className="hidden md:block md:w-[220px] shrink-0" aria-hidden />
                <div className="flex-1 min-w-0 text-center px-2">
                    <h1 className="text-[11px] sm:text-[13px] font-bold tracking-tight leading-none text-white">{initialTrade?.id ? 'Edit Trade' : 'Log Trade'}</h1>
                    <p className="text-[9px] text-zinc-400 font-medium font-mono leading-none mt-0.5">{initialTrade?.id ? `#${initialTrade.id.slice(0, 6)}` : `Entry #${Date.now().toString().slice(-4)}`}</p>
                </div>
                <div className="shrink-0 flex items-center gap-1 sm:gap-2">
                    {initialTrade && onCancel && <Button variant="destructive" size="sm" onClick={requestCancel} leftIcon={<X size={14} />} className="hidden md:inline-flex">Cancel</Button>}
                    {!initialTrade && onCancel && <Button variant="destructive" size="sm" onClick={requestCancel} leftIcon={<X size={14} />} className="hidden md:inline-flex">Cancel</Button>}
                    <Button variant="secondary" size="sm" disabled={isRestricted || isReadOnly} onClick={() => !isReadOnly && importTradesInputRef.current?.click()} leftIcon={isRestricted || isReadOnly ? <Lock size={14} /> : <Upload size={14} />} className="hidden sm:flex">Import</Button>
                    <input type="file" ref={importTradesInputRef} className="hidden" accept=".csv,.txt" onChange={handleImportMT4MT5} />
                    <Button variant="primary" size="sm" onClick={finalizeSave} isLoading={isSaving} disabled={isReadOnly} leftIcon={!isSaving && <Save size={16} />}>{initialTrade?.id ? 'Update' : 'Save'}</Button>
                </div>
            </div>

            {isReadOnly && (
                <div className="px-8 pt-4">
                    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                        Demo mode is read-only. Switch back to your real journal to save or import trades.
                    </div>
                </div>
            )}


            <div className="flex flex-1 overflow-hidden relative">
                <div className="flex-1 overflow-y-auto custom-scrollbar pb-4 md:pb-8">
                    <div className="max-w-4xl mx-auto px-4 md:px-8 py-2 md:py-4 pb-2">
                        <UsageBadge used={tradesUsedThisMonth} limit={maxTradesThisMonth} isDarkMode={isDarkMode} className={initialTrade?.id ? 'hidden' : 'mb-2'} />
                        <StepIndicator current={step} total={3} isDarkMode={isDarkMode} onSelect={setStep} />
                        {step === 1 ? <TradeFormStep1 formData={formData} handleInputChange={handleInputChange} pairError={pairError} isDarkMode={isDarkMode} userProfile={userProfile} isDesktopBridgeTrade={isDesktopBridgeTrade} /> : step === 2 ? <TradeFormStep2 formData={formData} handleInputChange={handleInputChange} isDarkMode={isDarkMode} isDesktopBridgeTrade={isDesktopBridgeTrade} /> : <TradeFormStep3 formData={formData} handleInputChange={handleInputChange} screenshots={screenshots} handleFileUpload={handleFileUpload} handleDeleteScreenshot={handleDeleteScreenshot} setPreviewImage={setPreviewImage} beforeInputRef={beforeInputRef} afterInputRef={afterInputRef} isDarkMode={isDarkMode} userProfile={userProfile} checklistTemplate={checklistTemplate} checklistChecks={formData.checklistChecks || {}} behaviorTags={formData.behaviorTags || []} onChecklistChange={handleChecklistChange} />}
                        {/* Mobile inline actions — below Entry Comment, scrolls with content so AI button + island nav don't cover it */}
                        <div className={cn("mt-2 pt-3 flex justify-start items-center gap-4 border-0 md:hidden", isDarkMode ? "border-zinc-800/80" : "border-slate-200")}>
                            {step < 3 ? <Button variant="primary" onClick={nextStep} rightIcon={<ChevronRight size={16} />} className="px-8 min-h-[44px] rounded-xl shadow-[0_8px_24px_rgba(255,79,1,0.18)]">Continue</Button> : <div className="w-24" />}
                        </div>
                        {/* clearance for island nav only — Continue sits left, clear of the right-side AI button */}
                        <div className="h-[calc(108px+env(safe-area-inset-bottom))] md:hidden" aria-hidden />
                    </div>
                </div>
            </div>

            <div className={cn("hidden md:flex p-4 md:p-6 shrink-0 justify-between items-center z-20 relative gap-4", isDarkMode ? "bg-[#000000]" : "bg-white border-slate-200")}>
                <div className={cn("absolute top-0 left-4 md:left-8 right-4 md:right-8 h-px", isDarkMode ? "bg-zinc-800/80" : "bg-slate-200")} />
                <Button variant="ghost" onClick={prevStep} disabled={step === 1} leftIcon={<ChevronLeft size={16} />} className={cn(step === 1 ? "opacity-0 pointer-events-none" : "", "min-h-[44px] rounded-xl")}>Back</Button>
                {step < 3 ? <Button variant="primary" onClick={nextStep} rightIcon={<ChevronRight size={16} />} className="px-8 min-h-[44px] rounded-xl shadow-[0_8px_24px_rgba(255,79,1,0.18)]">Continue</Button> : <div className="w-24" />}
            </div>
            {confirmModal.isOpen && <ConfirmationModal {...confirmModal} onCancel={() => setConfirmModal(p => ({ ...p, isOpen: false }))} isDarkMode={isDarkMode} />}

            {previewImage && (
                <div 
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
                    onClick={() => setPreviewImage(null)}
                >
                    <div className="absolute top-4 right-4 text-white hover:text-zinc-300 cursor-pointer">
                        <X size={24} />
                    </div>
                    <div 
                        className="relative max-w-5xl max-h-[85vh] w-full h-full flex flex-col items-center justify-center"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="font-bold mb-4 text-white text-lg tracking-tight">{previewImage.title}</h3>
                        <div className="relative w-full h-full flex items-center justify-center overflow-hidden rounded-xl border border-zinc-700 bg-black/40">
                            <img 
                                src={previewImage.url} 
                                alt={previewImage.title} 
                                className="max-w-full max-h-full object-contain rounded-lg"
                            />
                        </div>
                    </div>
                </div>
            )}

            {isImporting && (
                <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
                    <div className={cn("w-full max-w-sm rounded-2xl border overflow-hidden", isDarkMode ? "bg-[#000000] border-[#27272a]" : "bg-white border-slate-200")}>
                        <PhasedLoader phases={IMPORT_PHASES} title="Importing trades" isDarkMode={isDarkMode} />
                    </div>
                </div>
            )}
        </div>
    );
};

export default LogTrade;
