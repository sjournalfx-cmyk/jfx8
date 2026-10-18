import React, { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Check, X, HelpCircle, ListChecks, ChevronDown } from 'lucide-react';
import type { ChecklistPhase, ChecklistTemplateItem } from '../../types';
import { CHECKLIST_PHASES } from '../../lib/disciplineChecklist';
import { useChecklistTemplates } from '../../lib/useChecklistTemplates';
import { WidgetHelpDrawer } from '../ui/WidgetHelpDrawer';
import { haptic } from '../../lib/haptics';

interface ChecklistBuilderProps {
  isDarkMode?: boolean;
}

const PHASE_SHORT: Record<ChecklistPhase, string> = {
  'pre-entry': 'Pre',
  'in-trade': 'In',
  'post-trade': 'Post',
};

const PHASE_ORDER: ChecklistPhase[] = ['pre-entry', 'in-trade', 'post-trade'];

const PHASE_BADGE: Record<ChecklistPhase, string> = {
  'pre-entry': 'text-emerald-400',
  'in-trade': 'text-sky-400',
  'post-trade': 'text-amber-400',
};

type Filter = 'all' | ChecklistPhase;

/**
 * Rule card: phase badge + text + visible edit button.
 * Tap card or pencil to expand inline editor (input + phase chips + save/delete).
 */
const RuleCard: React.FC<{
  item: ChecklistTemplateItem;
  isDarkMode: boolean;
  editing: boolean;
  editText: string;
  onEditText: (v: string) => void;
  onBeginEdit: () => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onPhase: (phase: ChecklistPhase) => void;
  onDelete: () => void;
}> = ({
  item,
  isDarkMode,
  editing,
  editText,
  onEditText,
  onBeginEdit,
  onCommitEdit,
  onCancelEdit,
  onPhase,
  onDelete,
}) => {
  const muted = isDarkMode ? 'text-zinc-500' : 'text-slate-400';
  const input = isDarkMode
    ? 'bg-black border-zinc-800 text-zinc-100 placeholder:text-zinc-600'
    : 'bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400';
  const cardBg = isDarkMode ? 'bg-[#0a0a0a]' : 'bg-white border border-slate-200';

  if (editing) {
    return (
      <div className={`rounded-xl border-0 p-3 space-y-2.5 ${cardBg}`}>
        <input
          autoFocus
          value={editText}
          onChange={(e) => onEditText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onCommitEdit(); if (e.key === 'Escape') onCancelEdit(); }}
          aria-label="Edit rule text"
          className={`w-full rounded-lg border px-3 py-2.5 text-sm outline-none ${input}`}
        />
        <div className="flex items-center gap-1.5 flex-wrap">
          {PHASE_ORDER.map((phase) => (
            <button
              key={phase}
              onClick={() => { try { haptic.selection(); } catch {} onPhase(phase); }}
              className={`px-2.5 py-0 rounded-lg text-[10px] font-black uppercase tracking-widest touch-manipulation ${
                item.phase === phase ? 'bg-[#FF4F01] text-white' : `${muted} ${isDarkMode ? 'bg-white/[0.04]' : 'bg-slate-100'}`
              }`}
            >
              {PHASE_SHORT[phase]}
            </button>
          ))}
          <span className="flex-1" />
          <button onClick={onCancelEdit} aria-label="Cancel edit" className={`w-9 h-4 rounded-lg flex items-center justify-center touch-manipulation ${muted}`}>
            <X size={13} />
          </button>
          <button
            onClick={() => { try { haptic.medium(); } catch {} onDelete(); }}
            aria-label="Delete rule"
            className="w-9 h-4 rounded-lg flex items-center justify-center text-rose-500/80 touch-manipulation"
          >
            <Trash2 size={13} />
          </button>
          <button onClick={onCommitEdit} aria-label="Save rule" className="w-9 h-4 rounded-lg bg-[#FF4F01] text-white flex items-center justify-center touch-manipulation">
            <Check size={13} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={() => { try { haptic.selection(); } catch {} onBeginEdit(); }}
      className={`rounded-xl border-0 p-3 flex items-center gap-3 cursor-pointer active:scale-[0.99] transition-transform ${cardBg}`}
    >
      <span className={`shrink-0 px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest ${PHASE_BADGE[item.phase]}`}>
        {PHASE_SHORT[item.phase]}
      </span>
      <p className={`flex-1 min-w-0 text-[13px] leading-snug ${isDarkMode ? 'text-zinc-200' : 'text-slate-800'}`}>
        {item.text}
      </p>
      <span aria-hidden className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${isDarkMode ? 'bg-white/[0.04] text-zinc-400' : 'bg-slate-100 text-slate-500'}`}>
        <Pencil size={13} />
      </span>
    </div>
  );
};

export const ChecklistBuilder: React.FC<ChecklistBuilderProps> = ({ isDarkMode = true }) => {
  const { activeTemplate, addItem, updateItem, removeItem } = useChecklistTemplates();
  const [filter, setFilter] = useState<Filter>('all');
  const [composerOpen, setComposerOpen] = useState(false);
  const [newText, setNewText] = useState('');
  const [newPhase, setNewPhase] = useState<ChecklistPhase>('pre-entry');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);

  const muted = isDarkMode ? 'text-zinc-500' : 'text-slate-400';
  const input = isDarkMode
    ? 'bg-black border-zinc-800 text-zinc-100 placeholder:text-zinc-600'
    : 'bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400';
  const sheetBg = isDarkMode ? 'bg-[#0a0a0a]' : 'bg-white';

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: activeTemplate.items.length, 'pre-entry': 0, 'in-trade': 0, 'post-trade': 0 };
    for (const i of activeTemplate.items) c[i.phase] += 1;
    return c;
  }, [activeTemplate.items]);

  const visiblePhases: ChecklistPhase[] = filter === 'all' ? PHASE_ORDER : [filter];

  const openComposer = () => {
    try { haptic.light(); } catch {}
    setNewText('');
    setNewPhase(filter === 'all' ? 'pre-entry' : filter);
    setComposerOpen(true);
  };

  const closeComposer = () => {
    setComposerOpen(false);
    setNewText('');
  };

  const handleAdd = () => {
    if (!newText.trim()) return;
    try { haptic.medium(); } catch {}
    addItem(newText, newPhase);
    closeComposer();
  };

  const commitEdit = () => {
    if (editingId && editText.trim()) updateItem(editingId, { text: editText.trim() });
    setEditingId(null);
    setEditText('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'pre-entry', label: 'Pre' },
    { id: 'in-trade', label: 'In' },
    { id: 'post-trade', label: 'Post' },
  ];

  return (
    <div className="space-y-4 pb-24">
      {/* Phase filter pills — help is the 5th cell so the row fills edge-to-edge */}
      <div className="grid grid-cols-5 gap-1.5">
        {filters.map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => { try { haptic.selection(); } catch {} setFilter(f.id); }}
              className={`py-2 rounded-lg text-[11px] font-black uppercase tracking-widest touch-manipulation transition-colors ${
                active
                  ? 'bg-[#FF4F01] text-white'
                  : isDarkMode ? 'bg-white/[0.04] text-zinc-500' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {f.label} <span className={active ? 'text-white/70' : 'opacity-60'}>{counts[f.id]}</span>
            </button>
          );
        })}
        <button
          onClick={() => { try { haptic.selection(); } catch {} setHelpOpen(true); }}
          aria-label="How do strategy rules work?"
          className={`py-2 rounded-lg flex items-center justify-center touch-manipulation ${isDarkMode ? 'bg-white/[0.04] text-zinc-500' : 'bg-slate-100 text-slate-500'} hover:text-[#FF4F01]`}
        >
          <HelpCircle size={16} />
        </button>
      </div>

      {/* Empty state */}
      {activeTemplate.items.length === 0 && (
        <div className={`rounded-xl border-0 p-6 flex flex-col items-center text-center gap-3 ${isDarkMode ? 'bg-[#0a0a0a]' : 'bg-white border border-slate-200'}`}>
          <span className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isDarkMode ? 'bg-white/[0.04] text-zinc-500' : 'bg-slate-100 text-slate-400'}`}>
            <ListChecks size={22} />
          </span>
          <p className={`text-[13px] font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>No rules yet</p>
          <p className={`text-[11px] leading-relaxed ${muted}`}>Build your pre-entry, in-trade and post-trade checklist to grade every trade on execution.</p>
        </div>
      )}

      {/* Phase-grouped rule cards */}
      {visiblePhases.map((phaseId) => {
        const phaseMeta = CHECKLIST_PHASES.find((p) => p.id === phaseId)!;
        const items = activeTemplate.items.filter((i) => i.phase === phaseId);
        if (!items.length) return null;
        return (
          <section key={phaseId} className="space-y-1.5">
            <div className="flex items-baseline gap-2 px-1">
              <h3 className={`text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
                {phaseMeta.label}
              </h3>
              <span className={`text-[10px] font-bold ${isDarkMode ? 'text-zinc-600' : 'text-slate-400'}`}>{items.length}</span>
              <span className={`text-[10px] ${isDarkMode ? 'text-zinc-700' : 'text-slate-400'}`}>· {phaseMeta.hint}</span>
            </div>
            <div className="space-y-1.5">
              {items.map((item) => (
                <RuleCard
                  key={item.id}
                  item={item}
                  isDarkMode={isDarkMode}
                  editing={editingId === item.id}
                  editText={editText}
                  onEditText={setEditText}
                  onBeginEdit={() => { setEditingId(item.id); setEditText(item.text); }}
                  onCommitEdit={commitEdit}
                  onCancelEdit={cancelEdit}
                  onPhase={(p) => updateItem(item.id, { phase: p })}
                  onDelete={() => removeItem(item.id)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {/* Prominent add button */}
      <button
        onClick={openComposer}
        aria-label="New rule"
        className={`w-full rounded-xl py-3.5 flex items-center justify-center gap-2 text-[13px] font-black uppercase tracking-widest touch-manipulation active:scale-[0.99] transition-transform ${
          isDarkMode ? 'bg-[#FF4F01] text-white' : 'bg-[#FF4F01] text-white'
        }`}
      >
        <Plus size={16} strokeWidth={2.5} /> New Rule
      </button>

      {/* Bottom-sheet composer */}
      {composerOpen && (
        <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true" aria-label="New rule">
          <button aria-label="Close" onClick={closeComposer} className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div className={`relative w-full rounded-t-2xl border-0 p-4 pb-6 space-y-4 animate-in slide-in-from-bottom duration-200 ${sheetBg} shadow-2xl`}>
            <div className="flex items-center justify-between">
              <h2 className={`text-[13px] font-black uppercase tracking-widest ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>New Rule</h2>
              <button onClick={closeComposer} aria-label="Close composer" className={`w-8 h-8 rounded-lg flex items-center justify-center ${muted}`}>
                <X size={16} />
              </button>
            </div>
            <input
              autoFocus
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
              placeholder="New rule…"
              className={`w-full rounded-xl border px-3.5 py-3 text-sm outline-none min-h-[48px] ${input}`}
            />
            <div className="space-y-2">
              <p className={`text-[10px] font-black uppercase tracking-widest ${muted}`}>Phase</p>
              <div className="flex gap-1.5">
                {PHASE_ORDER.map((phase) => (
                  <button
                    key={phase}
                    onClick={() => { try { haptic.selection(); } catch {} setNewPhase(phase); }}
                    className={`flex-1 py-2.5 rounded-lg text-[11px] font-black uppercase tracking-widest touch-manipulation ${
                      newPhase === phase
                        ? 'bg-[#FF4F01] text-white'
                        : isDarkMode ? 'bg-white/[0.04] text-zinc-500' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {PHASE_SHORT[phase]}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={handleAdd}
              disabled={!newText.trim()}
              aria-label="Add rule"
              className="w-full rounded-xl py-3.5 bg-[#FF4F01] text-white text-[13px] font-black uppercase tracking-widest touch-manipulation disabled:opacity-40 active:scale-[0.99] transition-transform"
            >
              Add Rule
            </button>
          </div>
        </div>
      )}

      <WidgetHelpDrawer
        isOpen={helpOpen}
        widgetId="strategyRulesChecklists"
        onClose={() => setHelpOpen(false)}
        isDarkMode={isDarkMode}
      />
    </div>
  );
};
