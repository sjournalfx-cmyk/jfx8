import React, { useMemo, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { ChecklistTemplate } from '../../types';
import {
  CHECKLIST_PHASES,
  POSITIVE_TAGS,
  VIOLATION_TAGS,
  computeAdherence,
  gradeFor,
  isViolationTag,
} from '../../lib/disciplineChecklist';
import { haptic } from '../../lib/haptics';

interface TradeChecklistPanelProps {
  template: ChecklistTemplate;
  checks: Record<string, boolean>;
  behaviorTags?: string[];
  onChecksChange?: (checks: Record<string, boolean>) => void;
  onTagsChange?: (tags: string[]) => void;
  isDarkMode?: boolean;
  readOnly?: boolean;
  /** Hides the execution-tags section (Log Trade uses the dropdown instead). */
  hideTags?: boolean;
}

const GRADE_STYLES: Record<string, string> = {
  A: 'text-emerald-400',
  B: 'text-sky-400',
  C: 'text-amber-400',
  D: 'text-orange-400',
  F: 'text-rose-400',
};

/** Compact execution-grade pill for trade cards and rows. Renders nothing without a grade. */
export const GradePill: React.FC<{ grade?: string | null; adherenceRate?: number | null; size?: 'xs' | 'sm' }> = ({
  grade,
  adherenceRate,
  size = 'xs',
}) => {
  if (!grade) return null;
  return (
    <span
      title={adherenceRate != null ? `${adherenceRate}% rule adherence` : `Grade ${grade}`}
      className={`inline-flex items-center justify-center font-black ${GRADE_STYLES[grade] ?? GRADE_STYLES.F} ${
        size === 'xs' ? 'w-5 h-5 text-[10px]' : 'px-2 py-1 text-[11px]'
      }`}
    >
      {grade}
    </span>
  );
};

export const TradeChecklistPanel: React.FC<TradeChecklistPanelProps> = ({
  template,
  checks,
  behaviorTags = [],
  onChecksChange,
  onTagsChange,
  isDarkMode = true,
  readOnly = false,
  hideTags = false,
}) => {
  const adherence = useMemo(
    () => computeAdherence(checks, template.items),
    [checks, template.items],
  );
  const grade = adherence === null ? null : gradeFor(adherence);

  const toggleCheck = (id: string) => {
    if (readOnly || !onChecksChange) return;
    try { haptic.selection(); } catch {}
    onChecksChange({ ...checks, [id]: !checks[id] });
  };

  const toggleTag = (tag: string) => {
    if (readOnly || !onTagsChange) return;
    try { haptic.selection(); } catch {}
    onTagsChange(
      behaviorTags.includes(tag) ? behaviorTags.filter((t) => t !== tag) : [...behaviorTags, tag],
    );
  };

  const card = isDarkMode ? 'bg-[#0a0a0a] border-0' : 'bg-white border-0';
  const muted = isDarkMode ? 'text-zinc-500' : 'text-slate-400';
  const [tagTab, setTagTab] = useState<'positive' | 'violations'>('positive');

  return (
    <div className="space-y-2">

      {/* Phase-grouped checks */}
      {CHECKLIST_PHASES.map((phase) => {
        const items = template.items.filter((i) => i.phase === phase.id);
        if (!items.length) return null;
        return (
          <div key={phase.id} className={`rounded-xl border-0 overflow-hidden ${isDarkMode ? 'bg-[#000000] border-0' : card}`}>
            <header className="flex items-center gap-2 px-3 py-1.5 border-0">
              <h4 className={`text-[11px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-300' : 'text-slate-700'}`}>
                {phase.label}
              </h4>
              <span className={`ml-auto text-[10px] font-bold ${muted}`}>
                {items.filter((i) => checks[i.id]).length}/{items.length}
              </span>
            </header>
            <div className="p-1.5 space-y-1">
              {items.map((item) => {
                const checked = checks[item.id] === true;
                return (
                  <button
                    key={item.id}
                    onClick={() => toggleCheck(item.id)}
                    disabled={readOnly}
                    className={`w-full flex items-center gap-3 p-2 rounded-lg border-0 text-left transition-all min-h-[32px] touch-manipulation ${
                      checked
                        ? isDarkMode
                          ? 'bg-[#FF4F01]/10 border-[#FF4F01]/50'
                          : 'bg-orange-50 border-orange-200'
                        : isDarkMode
                          ? 'bg-[#0a0a0a] border-0'
                          : 'bg-slate-50 border-slate-200'
                    } ${readOnly ? 'opacity-90' : ''}`}
                  >
                    <span
                      className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                        checked ? 'bg-[#FF4F01] border-[#FF4F01] text-white' : 'border-zinc-600 bg-transparent opacity-100'
                      }`}
                    >
                      {checked && <CheckCircle2 size={12} />}
                    </span>
                    <span className={`text-[12px] font-medium leading-snug ${isDarkMode ? 'text-zinc-200' : 'text-slate-800'}`}>
                      {item.text}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Behavior tags — segmented tabs + checkbox rows (tap to toggle) */}
      {!hideTags && (
      <div className={`rounded-xl border-0 overflow-hidden ${isDarkMode ? 'bg-[#000000]' : 'bg-white border border-slate-200'}`}>
        <header className="flex items-center gap-2 px-3 py-1.5 border-0">
          <h4 className={`text-[11px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-300' : 'text-slate-700'}`}>Execution</h4>
          <span className={`ml-auto text-[10px] font-bold ${muted}`}>{behaviorTags.length} tagged</span>
        </header>
        {/* Segmented control */}
        <div className={`px-1.5 pb-1.5 flex gap-1`}>
          {(['positive', 'violations'] as const).map(tab => {
            const list = tab === 'positive' ? POSITIVE_TAGS : VIOLATION_TAGS;
            const count = list.filter(t => behaviorTags.includes(t)).length;
            const activeTab = tagTab === tab;
            const tone = tab === 'positive' ? 'emerald' : 'rose';
            return (
              <button key={tab} type="button" onClick={() => setTagTab(tab)}
                className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                  activeTab
                    ? tone === 'emerald'
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-rose-500/15 text-rose-300'
                    : isDarkMode ? 'text-zinc-500' : 'text-slate-400'
                }`}>
                {tab === 'positive' ? 'Positive' : 'Violations'}{count > 0 ? ` (${count})` : ''}
              </button>
            );
          })}
        </div>
        {/* Option rows */}
        <div className="p-1.5 space-y-1">
          {(tagTab === 'positive' ? POSITIVE_TAGS : VIOLATION_TAGS).map(tag => {
            const checked = behaviorTags.includes(tag);
            const isPos = tagTab === 'positive';
            return (
              <button key={tag} onClick={() => toggleTag(tag)} disabled={readOnly}
                className={`w-full flex items-center gap-3 p-2 rounded-lg border-0 text-left transition-all min-h-[32px] touch-manipulation ${
                  checked
                    ? isPos
                      ? (isDarkMode ? 'bg-emerald-500/10' : 'bg-emerald-50')
                      : (isDarkMode ? 'bg-rose-500/10' : 'bg-rose-50')
                    : isDarkMode ? 'bg-[#0a0a0a]' : 'bg-slate-50'
                } ${readOnly ? 'opacity-90' : ''}`}>
                <span className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                  checked
                    ? isPos ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-rose-500 border-rose-500 text-white'
                    : isDarkMode ? 'border-zinc-700' : 'border-slate-300'
                }`}>
                  {checked && <CheckCircle2 size={12} />}
                </span>
                <span className={`text-[12px] font-medium leading-snug ${isDarkMode ? 'text-zinc-200' : 'text-slate-800'}`}>{tag}</span>
              </button>
            );
          })}
        </div>
        {behaviorTags.some(isViolationTag) && (
          <p className={`px-3 pb-2 text-[10px] font-bold ${isDarkMode ? 'text-rose-400/80' : 'text-rose-500'}`}>
            {behaviorTags.filter(isViolationTag).length} violation{behaviorTags.filter(isViolationTag).length > 1 ? 's' : ''} — counted in Cost of Mistakes
          </p>
        )}
      </div>
      )}
    </div>
  );
};
