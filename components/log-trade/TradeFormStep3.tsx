import React, { useMemo, useState } from 'react';
import { Brain, ShieldCheck, AlertTriangle, Image as ImageIcon, Eye, Trash2, Type, Lock, ListChecks, ChevronDown } from 'lucide-react';
import { APP_CONSTANTS, PLAN_FEATURES, normalizePlan } from '../../lib/constants';
import { Select } from '../Select';
import RichTextEditor from '../RichTextEditor';
import { Input } from '../ui/Input';
import { FeatureGate } from '../ui/FeatureGate';
import { cn } from '../../lib/utils';
import type { ChecklistTemplate } from '../../types';
import { TradeChecklistPanel, GradePill } from '../discipline/TradeChecklistPanel';
import { ExecutionTagsSelect } from './ExecutionTagsSelect';
import { computeAdherence, gradeFor } from '../../lib/disciplineChecklist';
import { haptic } from '../../lib/haptics';

interface TradeFormStep3Props {
    formData: any;
    handleInputChange: (field: string, value: any) => void;
    screenshots: { before?: string, after?: string };
    handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>, type: 'before' | 'after') => void;
    handleDeleteScreenshot: (type: 'before' | 'after') => void;
    setPreviewImage: (preview: { url: string, title: string } | null) => void;
    beforeInputRef: React.RefObject<HTMLInputElement>;
    afterInputRef: React.RefObject<HTMLInputElement>;
    isDarkMode: boolean;
    userProfile: any;
    checklistTemplate: ChecklistTemplate;
    checklistChecks: Record<string, boolean>;
    behaviorTags: string[];
    onChecklistChange: (checks: Record<string, boolean>, tags: string[]) => void;
}

export const TradeFormStep3: React.FC<TradeFormStep3Props> = ({
    formData,
    handleInputChange,
    screenshots,
    handleFileUpload,
    handleDeleteScreenshot,
    setPreviewImage,
    beforeInputRef,
    afterInputRef,
    isDarkMode,
    userProfile,
    checklistTemplate,
    checklistChecks,
    behaviorTags,
    onChecklistChange,
}) => {
    const currentPlan = normalizePlan(userProfile?.plan);
    const canUploadImages = PLAN_FEATURES[currentPlan]?.allowImageUploads ?? false;
    const [checklistOpen, setChecklistOpen] = useState(false);
    const adherence = useMemo(
        () => computeAdherence(checklistChecks, checklistTemplate.items),
        [checklistChecks, checklistTemplate.items],
    );
    const grade = adherence === null ? null : gradeFor(adherence);
    const checkedCount = checklistTemplate.items.filter((i) => checklistChecks[i.id]).length;

    return (
        <div className="space-y-1 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">
                <div className="space-y-1">
                    <div className="flex items-center justify-between">
                        <label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-500">Mindset/Psychology</label>
                        <FeatureGate feature="advancedAnalytics" userProfile={userProfile} variant="inline"><span></span></FeatureGate>
                    </div>
                    <Select
                        isDarkMode={isDarkMode}
                        icon={Brain}
                        value={formData.mindset}
                        onChange={(val) => handleInputChange('mindset', val)}
                        options={[
                            { value: 'Neutral', label: 'Neutral' },
                            { value: 'Confident', label: 'Confident' },
                            { value: 'Hesitant', label: 'Hesitant' },
                            { value: 'Anxious', label: 'Anxious' },
                            { value: 'FOMO', label: 'FOMO' },
                        ]}
                    />
                </div>
                <div className="space-y-1">
                    <div className="flex items-center justify-between">
                        <label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-500">Plan Adherence</label>
                        <FeatureGate feature="advancedAnalytics" userProfile={userProfile} variant="inline"><span></span></FeatureGate>
                    </div>
                    <Select
                        isDarkMode={isDarkMode}
                        icon={ShieldCheck}
                        value={formData.planAdherence}
                        onChange={(val) => handleInputChange('planAdherence', val)}
                        options={[
                            { value: 'Followed Exactly', label: 'Followed Exactly' },
                            { value: 'Minor Deviation', label: 'Minor Deviation' },
                            { value: 'Major Deviation', label: 'Major Deviation' },
                            { value: 'No Plan', label: 'No Plan' },
                        ]}
                    />
                </div>
            </div>

            {/* Execution Tags — Select-styled multi-select, below Plan Adherence */}
            <ExecutionTagsSelect
                isDarkMode={isDarkMode}
                value={behaviorTags}
                onChange={(tags) => onChecklistChange(checklistChecks, tags)}
            />

            {/* Discipline checklist — grade preview + expandable rule checkoff */}
            <div className={`mt-2 rounded-2xl border-0 overflow-hidden ${isDarkMode ? 'border-0 bg-[#0a0a0a]' : 'border-slate-200 bg-slate-50'}`}>
                <button
                    type="button"
                    onClick={() => { try { haptic.selection(); } catch {} setChecklistOpen(o => !o); }}
                    className="w-full flex items-center gap-3 p-2.5 text-left touch-manipulation min-h-[48px]"
                >
                    <span className="flex-1 min-w-0 text-left">
                        <span className={`block text-sm font-bold ${isDarkMode ? 'text-zinc-100' : 'text-slate-900'}`}>
                            Discipline Checklist
                        </span>
                        <span className="block text-[11px] text-zinc-500 mt-0.5">
                            {checklistTemplate.items.length === 0
                                ? 'No rules yet'
                                : adherence === null
                                    ? `${checklistTemplate.items.length} rules`
                                    : `${checkedCount}/${checklistTemplate.items.length} rules · ${adherence}%`}
                        </span>
                    </span>
                    {grade && <GradePill grade={grade} adherenceRate={adherence} size="sm" />}
                    <ChevronDown size={16} className={`text-zinc-500 shrink-0 transition-transform ${checklistOpen ? 'rotate-180' : ''}`} />
                </button>
                {checklistOpen && (
                    <div className="px-3 pb-3">
                        <TradeChecklistPanel
                            template={checklistTemplate}
                            checks={checklistChecks}
                            behaviorTags={behaviorTags}
                            onChecksChange={(c) => onChecklistChange(c, behaviorTags)}
                            onTagsChange={(t) => onChecklistChange(checklistChecks, t)}
                            isDarkMode={isDarkMode}
                            hideTags
                        />
                    </div>
                )}
            </div>

            <div className="space-y-1">
                <div className="flex items-center justify-between">
                    <label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-500">Trading Mistake</label>
                    <FeatureGate feature="advancedAnalytics" userProfile={userProfile} variant="inline"><span></span></FeatureGate>                </div>
                <Select
                    isDarkMode={isDarkMode}
                    icon={AlertTriangle}
                    value={formData.tradingMistake}
                    onChange={(val) => handleInputChange('tradingMistake', val)}
                    options={[
                        { value: 'None', label: 'None' },
                        { value: 'Overtrading', label: 'Overtrading' },
                        { value: 'Early Exit', label: 'Early Exit' },
                        { value: 'Late Entry', label: 'Late Entry' },
                        { value: 'Ignored Stop Loss', label: 'Ignored Stop Loss' },
                        { value: 'Revenge Trade', label: 'Revenge Trade' },
                        { value: 'Wrong Position Size', label: 'Wrong Position Size' },
                        { value: 'Ignored Setup', label: 'Ignored Setup' },
                        { value: 'FOMO Entry', label: 'FOMO Entry' },
                        { value: 'No Plan', label: 'No Plan' },
                        { value: 'Other', label: 'Other' },
                    ]}
                />
            </div>

            <div className="pt-1">
                <label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Exit Comment</label>
                <RichTextEditor
                    isDarkMode={isDarkMode}
                    placeholder="Describe why you exited the trade..."
                    content={formData.exitComment}
                    onChange={(val) => handleInputChange('exitComment', val)}
                    minHeight="70px"
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3 pt-1">
                {(['before', 'after'] as const).map((type) => (
                    <div key={type} className="space-y-1">
                        <div className="flex items-center justify-between">
                            <label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-500">
                                {type === 'before' ? 'Entry/Before' : 'Exit/After'} Screenshot
                            </label>
                        <FeatureGate feature="allowImageUploads" userProfile={userProfile} variant="inline"><span></span></FeatureGate>
                        </div>
                        <input
                            type="file"
                            ref={type === 'before' ? beforeInputRef : afterInputRef}
                            className="hidden"
                            accept="image/*"
                            onChange={(e) => handleFileUpload(e, type)}
                        />
                        <div
                            onClick={() => {
                                if (canUploadImages) {
                                    (type === 'before' ? beforeInputRef : afterInputRef).current?.click();
                                }
                            }}
                            className={cn(
                                "w-full h-24 border-0 rounded-xl flex flex-col items-center justify-center gap-3 transition-all overflow-hidden relative",
                                canUploadImages 
                                    ? "cursor-pointer " 
                                    : "cursor-not-allowed opacity-50 bg-zinc-100/10",
                                isDarkMode ? 'border-0 bg-[#0a0a0a]' : 'border-slate-300 bg-slate-50'
                            )}>
                            {screenshots[type] ? (
                                <>
                                    <img src={screenshots[type]} className="w-full h-full object-cover" alt={type} />
                                    <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-3 z-10">
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); setPreviewImage({ url: screenshots[type]!, title: `${type === 'before' ? 'Before' : 'After'} Screenshot` }); }}
                                            className="p-2 bg-white/20 backdrop-blur-md hover:bg-white/40 text-white rounded-lg"
                                        >
                                            <Eye size={18} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); handleDeleteScreenshot(type); }}
                                            className="p-2 bg-rose-500/80 backdrop-blur-md hover:bg-rose-500 text-white rounded-lg"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <div className="flex flex-col items-center gap-2">
                                    {canUploadImages ? (
                                        <>
                                            <ImageIcon size={20} className="text-zinc-500" />
                                            <span className="text-[10px] font-bold text-zinc-500">CLICK TO UPLOAD</span>
                                        </>
                                    ) : (
                                        <>
                                            <Lock size={20} className="text-amber-500 animate-pulse" />
                                            <span className="text-[10px] font-bold text-amber-500">LOCKED ON FREE TIER</span>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <div className="pt-1">
                <Input
                    label="Strategy"
                    leftIcon={<Type size={16} />}
                    placeholder="e.g. Trendline Break, News Event"
                    value={formData.tags}
                    onChange={(e) => handleInputChange('tags', e.target.value)}
                    isDarkMode={isDarkMode}
                />
                <p className="text-[10px] opacity-50 mt-2 pl-1 italic">Separate strategies with commas</p>
            </div>
        </div>
    );
};
