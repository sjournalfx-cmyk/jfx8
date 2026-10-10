import React, { useMemo } from 'react';
import { CheckCircle2, ShieldCheck, Zap, ClipboardCheck } from 'lucide-react';
import type { ChecklistPhase, ChecklistTemplate } from '../../types';
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

const PHASE_ICONS: Record<ChecklistPhase, React.ElementType> = {
  'pre-entry': ShieldCheck,
  'in-trade': Zap,
  'post-trade': ClipboardCheck,
};

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

  const card = isDarkMode ? 'bg-[#0a0a0a] border-zinc-800/80' : 'bg-white border-slate-200';
  const muted = isDarkMode ? 'text-zinc-500' : 'text-slate-400';

  return (
    <div className="space-y-3">
      {/* Adherence header */}
      <div className={`p-4 rounded-2xl border flex items-center gap-3 ${card}`}>
        <div className="flex-1 min-w-0">
          <p className={`text-[10px] font-black uppercase tracking-widest ${muted}`}>Rule Adherence</p>
          <p className={`text-2xl font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
            {adherence === null ? '—' : `${adherence}%`}
            <span className={`text-xs font-bold ml-2 ${muted}`}>
              {adherence === null
                ? 'No rules'
                : `${template.items.filter((i) => checks[i.id]).length}/${template.items.length} checked`}
            </span>
          </p>
        </div>
        {grade && (
          <span className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl font-black shrink-0 ${GRADE_STYLES[grade]}`}>
            {grade}
          </span>
        )}
      </div>

      {/* Phase-grouped checks */}
      {CHECKLIST_PHASES.map((phase) => {
        const items = template.items.filter((i) => i.phase === phase.id);
        if (!items.length) return null;
        const Icon = PHASE_ICONS[phase.id];
        return (
          <div key={phase.id} className={`rounded-2xl border overflow-hidden ${card}`}>
            <header className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800/60">
              <Icon size={13} className={muted} />
              <h4 className={`text-[11px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-300' : 'text-slate-700'}`}>
                {phase.label}
              </h4>
              <span className={`ml-auto text-[10px] font-bold ${muted}`}>
                {items.filter((i) => checks[i.id]).length}/{items.length}
              </span>
            </header>
            <div className="p-2 space-y-1.5">
              {items.map((item) => {
                const checked = checks[item.id] === true;
                return (
                  <button
                    key={item.id}
                    onClick={() => toggleCheck(item.id)}
                    disabled={readOnly}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all min-h-[52px] touch-manipulation ${
                      checked
                        ? isDarkMode
                          ? 'bg-[#FF4F01]/10 border-[#FF4F01]/50'
                          : 'bg-orange-50 border-orange-200'
                        : isDarkMode
                          ? 'bg-black/40 border-zinc-800/70'
                          : 'bg-slate-50 border-slate-200'
                    } ${readOnly ? 'opacity-90' : ''}`}
                  >
                    <span
                      className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                        checked ? 'bg-[#FF4F01] border-[#FF4F01] text-white' : 'border-gray-400'
                      }`}
                    >
                      {checked && <CheckCircle2 size={14} />}
                    </span>
                    <span className={`text-[13px] font-medium leading-snug ${isDarkMode ? 'text-zinc-200' : 'text-slate-800'}`}>
                      {item.text}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Behavior tags */}
      {!hideTags && (
      <div className={`p-4 rounded-2xl border space-y-3 ${card}`}>
        <p className={`text-[10px] font-black uppercase tracking-widest ${muted}`}>Execution tags</p>
        <div>
          <p className="text-[10px] font-bold text-emerald-500/80 uppercase tracking-widest mb-1.5">Positive</p>
          <div className="flex flex-wrap gap-1.5">
            {POSITIVE_TAGS.map((tag) => {
              const active = behaviorTags.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  disabled={readOnly}
                  className={`px-3 py-2 rounded-xl text-[11px] font-bold transition-all min-h-[40px] touch-manipulation border ${
                    active
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : isDarkMode
                        ? 'bg-black/40 text-zinc-400 border-zinc-800'
                        : 'bg-slate-50 text-slate-500 border-slate-200'
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-bold text-rose-500/80 uppercase tracking-widest mb-1.5">Violations</p>
          <div className="flex flex-wrap gap-1.5">
            {VIOLATION_TAGS.map((tag) => {
              const active = behaviorTags.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  disabled={readOnly}
                  className={`px-3 py-2 rounded-xl text-[11px] font-bold transition-all min-h-[40px] touch-manipulation border ${
                    active
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                      : isDarkMode
                        ? 'bg-black/40 text-zinc-400 border-zinc-800'
                        : 'bg-slate-50 text-slate-500 border-slate-200'
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
        {behaviorTags.some(isViolationTag) && (
          <p className="text-[11px] font-bold text-rose-400/90">
            {behaviorTags.filter(isViolationTag).length} violation{behaviorTags.filter(isViolationTag).length > 1 ? 's' : ''} tagged — counted in Cost of Mistakes.
          </p>
        )}
      </div>
      )}
    </div>
  );
};
