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
import { calculateRiskReward, getSessionFromTime } from '../lib/trade-calculations';
import { parseMTTradeCSV } from '../lib/trade-import';
import { TradeFormStep1 } from './log-trade/TradeFormStep1';
import { TradeFormStep2 } from './log-trade/TradeFormStep2';
import { TradeFormStep3 } from './log-trade/TradeFormStep3';
import { cn } from '../lib/utils';
import { normalizeTrade } from '../lib/trade-normalization';

interface LogTradeProps {
    isDarkMode: boolean;
    onSave: (trade: Trade) => void;
    onBatchSave?: (trades: Trade[]) => Promise<void>;
    initialTrade?: Trade;
    onCancel?: () => void;
    currencySymbol: string;
    userProfile?: UserProfile | null;
    trades: Trade[];
    isReadOnly?: boolean;
}

const STEPS = [
    { label: 'Market Context', description: 'Setup & conditions' },
    { label: 'Execution', description: 'Entry & risk management' },
    { label: 'Review', description: 'Outcome & psychology' },
];

const StepIndicator = ({ current, total, isDarkMode }: { current: number, total: number, isDarkMode: boolean }) => (
    <div className="flex items-center gap-3 mb-10">
        {Array.from({ length: total }).map((_, i) => {
            const isActive = i + 1 === current;
            const isCompleted = i + 1 < current;
            const step = STEPS[i];
            return (
                <div key={i} className="flex items-center flex-1 last:flex-none">
                    <div
                        className={`
                        w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all duration-300
                        ${isActive
                                ? 'border-[#FF4F01] bg-[#FF4F01] text-white shadow-lg shadow-[#FF4F01]/30 scale-110'
                                : isCompleted
                                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                                    : isDarkMode ? 'border-[#27272a] bg-[#000000] text-zinc-500' : 'border-slate-200 bg-slate-100 text-slate-400'
                            }
                    `}
                    >
                        {isCompleted ? <CheckCircle2 size={14} /> : i + 1}
                    </div>
                    <div className="hidden sm:block ml-3 flex-1">
                        <p className={`text-sm font-bold ${isActive ? 'text-[#FF4F01]' : isDarkMode ? 'text-zinc-300' : 'text-slate-700'}`}>
                            {step.label}
                        </p>
                        <p className={`text-[10px] ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>
                            {step.description}
                        </p>
                    </div>
                    {i < total - 1 && (
                        <div className={`flex-1 h-0.5 mx-4 rounded-full transition-all duration-500 ${isCompleted ? 'bg-emerald-500/40' : isDarkMode ? 'bg-[#27272a]' : 'bg-slate-200'}`} />
                    )}
                </div>
            )
        })}
    </div>
);

const LogTrade: React.FC<LogTradeProps> = ({ isDarkMode, onSave, onBatchSave, initialTrade, onCancel, currencySymbol, userProfile, trades, isReadOnly = false }) => {
    const [step, setStep] = useState(1);
    const [isSaving, setIsSaving] = useState(false);
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
        onConfirm: () => void;
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
    });

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

    const handleImportMT4MT5 = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !onBatchSave) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const text = event.target?.result as string;
                if (!text) return;
                const importedTrades = parseMTTradeCSV(text);
                if (importedTrades.length > 0) {
                    setConfirmModal({
                        isOpen: true,
                        title: 'Import Trades',
                        description: `Found ${importedTrades.length} trades. Import them?`,
                        showCancel: true,
                        onConfirm: async () => { await onBatchSave(importedTrades); setConfirmModal(p => ({ ...p, isOpen: false })); }
                    });
                }
            } catch (err) { console.error(err); }
        };
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

  const finalizeSave = async () => {
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

    const normalizedTrade = normalizeTrade({
      ...(initialTrade || {}),
      ...formData,
      ...metrics,
      id: initialTrade?.id || Date.now().toString(),
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

    setIsSaving(true);
    try {
      await onSave(lockedTrade);
    } finally { setIsSaving(false); }
  };

    const isLong = formData.direction === 'Long';
    const themeColor = isLong ? 'text-teal-500' : 'text-rose-500';
    const ratingTheme = formData.rating === 5 ? { border: 'border-amber-500', shadow: 'shadow-amber-500/20', glow: 'from-amber-500/20' } : { border: isDarkMode ? 'border-[#27272a]' : 'border-slate-200', shadow: isDarkMode ? 'shadow-black/50' : 'shadow-slate-200', glow: 'from-transparent' };

    return (
        <div className={cn("w-full h-full overflow-hidden flex flex-col font-sans", isDarkMode ? 'bg-[#000000] text-zinc-200' : 'bg-[#F8FAFC] text-slate-900')}>
            <div className={cn("h-18 shrink-0 flex items-center justify-between px-8 py-4 z-20 relative", isDarkMode ? 'bg-[#000000]' : 'bg-white')}>
                <div className={cn("absolute bottom-0 left-8 right-8 h-px", isDarkMode ? "bg-[#27272a]" : "bg-slate-200")} />
                <div className="flex items-center gap-4">
                    <div className={cn("p-2 rounded-lg", isDarkMode ? 'bg-violet-500/10 text-violet-400' : 'bg-violet-50 text-violet-600')}>
                        <FileText size={20} />
                    </div>
                    <div>
                        <h1 className="text-lg font-bold tracking-tight leading-none">{initialTrade?.id ? 'Edit Trade Entry' : 'Log New Trade'}</h1>
                        <p className="text-xs text-zinc-500 font-medium mt-1">{initialTrade?.id ? `ID: ${initialTrade.id}` : `Entry #${Date.now().toString().slice(-4)}`}</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {initialTrade && onCancel && <Button variant="destructive" size="sm" onClick={onCancel} leftIcon={<X size={14} />}>Cancel</Button>}
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
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    <div className="max-w-4xl mx-auto px-8 py-10 pb-32">
                        <StepIndicator current={step} total={3} isDarkMode={isDarkMode} />
                        {step === 1 ? <TradeFormStep1 formData={formData} handleInputChange={handleInputChange} pairError={pairError} isDarkMode={isDarkMode} userProfile={userProfile} isDesktopBridgeTrade={isDesktopBridgeTrade} /> : step === 2 ? <TradeFormStep2 formData={formData} handleInputChange={handleInputChange} isDarkMode={isDarkMode} isDesktopBridgeTrade={isDesktopBridgeTrade} /> : <TradeFormStep3 formData={formData} handleInputChange={handleInputChange} screenshots={screenshots} handleFileUpload={handleFileUpload} handleDeleteScreenshot={handleDeleteScreenshot} setPreviewImage={setPreviewImage} beforeInputRef={beforeInputRef} afterInputRef={afterInputRef} isDarkMode={isDarkMode} userProfile={userProfile} />}
                    </div>
                </div>
            </div>

            <div className={cn("p-6 shrink-0 flex justify-between items-center z-20 relative", isDarkMode ? "bg-[#000000]" : "bg-white border-slate-200")}>
                <div className={cn("absolute top-0 left-8 right-8 h-px", isDarkMode ? "bg-[#27272a]" : "bg-slate-200")} />
                <Button variant="ghost" onClick={prevStep} disabled={step === 1} leftIcon={<ChevronLeft size={16} />} className={cn(step === 1 && "opacity-0")}>Back</Button>
                {step < 3 ? <Button variant="primary" onClick={nextStep} rightIcon={<ChevronRight size={16} />} className="px-8">Continue</Button> : <div className="w-24" />}
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
        </div>
    );
};

export default LogTrade;
