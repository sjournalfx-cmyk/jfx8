import React, { useState } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  ShieldCheck,
  Zap,
  ClipboardCheck,
  HelpCircle,
} from 'lucide-react';
import type { ChecklistPhase, ChecklistTemplateItem } from '../../types';
import { CHECKLIST_PHASES } from '../../lib/disciplineChecklist';
import { useChecklistTemplates } from '../../lib/useChecklistTemplates';
import { WidgetHelpDrawer } from '../ui/WidgetHelpDrawer';
import { haptic } from '../../lib/haptics';

interface ChecklistBuilderProps {
  isDarkMode?: boolean;
}

const PHASE_ICONS: Record<ChecklistPhase, React.ElementType> = {
  'pre-entry': ShieldCheck,
  'in-trade': Zap,
  'post-trade': ClipboardCheck,
};

const PHASE_SHORT: Record<ChecklistPhase, string> = {
  'pre-entry': 'Pre',
  'in-trade': 'In',
  'post-trade': 'Post',
};

const PHASE_ORDER: ChecklistPhase[] = ['pre-entry', 'in-trade', 'post-trade'];

/**
 * One rule row: borderless text; swipe right to edit, swipe left to delete
 * (same gesture pattern as the journal trade cards); tap text to edit.
 */
const RuleRow: React.FC<{
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
  const [swipeX, setSwipeX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = React.useRef<number | null>(null);
  const startY = React.useRef<number | null>(null);
  const moved = React.useRef(false);

  const muted = isDarkMode ? 'text-zinc-500' : 'text-slate-400';
  const input = isDarkMode
    ? 'bg-black border-zinc-800 text-zinc-100 placeholder:text-zinc-600'
    : 'bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400';

  return (
    <div className="relative overflow-hidden">
      {(dragging || swipeX !== 0) && swipeX >= 0 && !editing && (
        <div className="absolute left-0 top-0 bottom-0 w-[76px] flex items-center justify-start">
          <button
            aria-label="Edit rule"
            onClick={(e) => { e.stopPropagation(); setSwipeX(0); onBeginEdit(); }}
            className="w-[60px] h-[40px] rounded-xl bg-[#FF4F01] text-white flex items-center justify-center active:scale-95 transition-transform"
          >
            <Pencil size={15} />
          </button>
        </div>
      )}
      {(dragging || swipeX !== 0) && swipeX <= 0 && !editing && (
        <div className="absolute right-0 top-0 bottom-0 w-[76px] flex items-center justify-end">
          <button
            aria-label="Delete rule"
            onClick={(e) => { e.stopPropagation(); try { haptic.medium(); } catch {} setSwipeX(0); onDelete(); }}
            className="w-[60px] h-[40px] rounded-xl bg-[#ff4f64] text-white flex items-center justify-center active:scale-95 transition-transform"
          >
            <Trash2 size={15} />
          </button>
        </div>
      )}
      <div
        onClick={() => {
          if (moved.current) { moved.current = false; return; }
          if (swipeX !== 0) { setSwipeX(0); return; }
          if (!editing) {
            try { haptic.selection(); } catch {}
            onBeginEdit();
          }
        }}
        onTouchStart={(e) => {
          startX.current = e.touches[0].clientX;
          startY.current = e.touches[0].clientY;
          moved.current = false;
          setDragging(true);
        }}
        onTouchMove={(e) => {
          if (startX.current === null || startY.current === null) return;
          const dx = e.touches[0].clientX - startX.current;
          const dy = e.touches[0].clientY - startY.current;
          if (Math.abs(dx) > 10 || Math.abs(dy) > 10) moved.current = true;
          if (Math.abs(dy) > Math.abs(dx) || editing) { setSwipeX(0); return; }
          setSwipeX(Math.max(-76, Math.min(76, dx)));
        }}
        onTouchEnd={() => {
          startX.current = null;
          startY.current = null;
          setDragging(false);
          setSwipeX((v) => (v < -38 ? -76 : v > 38 ? 76 : 0));
        }}
        style={{ transform: `translateX(${swipeX}px)` }}
        className={`relative z-10 flex items-center min-h-[52px] py-1.5 select-none ${dragging ? '' : 'transition-transform duration-200'} ${isDarkMode ? 'bg-[#000000]' : 'bg-white'}`}
      >
        {editing ? (
          <div className="flex-1 min-w-0 space-y-2 py-1 pr-1">
            <input
              autoFocus
              value={editText}
              onChange={(e) => onEditText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onCommitEdit(); if (e.key === 'Escape') onCancelEdit(); }}
              onClick={(e) => e.stopPropagation()}
              aria-label="Edit rule text"
              className={`w-full rounded-lg border px-2.5 py-2 text-sm outline-none ${input}`}
            />
            <div className="flex items-center gap-1">
              {PHASE_ORDER.map((phase) => (
                <button
                  key={phase}
                  onClick={(e) => { e.stopPropagation(); try { haptic.selection(); } catch {} onPhase(phase); }}
                  className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest touch-manipulation min-h-[34px] ${
                    item.phase === phase ? 'bg-[#FF4F01] text-white' : muted
                  }`}
                >
                  {PHASE_SHORT[phase]}
                </button>
              ))}
              <span className="flex-1" />
              <button onClick={(e) => { e.stopPropagation(); onCancelEdit(); }} aria-label="Cancel edit" className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 touch-manipulation ${muted}`}>
                <X size={15} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); try { haptic.medium(); } catch {} onDelete(); }}
                aria-label="Delete rule"
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-rose-500/80 touch-manipulation"
              >
                <Trash2 size={15} />
              </button>
              <button onClick={(e) => { e.stopPropagation(); onCommitEdit(); }} aria-label="Save rule" className="w-9 h-9 rounded-lg bg-[#FF4F01] text-white flex items-center justify-center shrink-0 touch-manipulation">
                <Check size={15} />
              </button>
            </div>
          </div>
        ) : (
          <p className={`flex-1 min-w-0 text-[13px] leading-snug ${isDarkMode ? 'text-zinc-200' : 'text-slate-800'}`}>
            {item.text}
          </p>
        )}
      </div>
    </div>
  );
};

export const ChecklistBuilder: React.FC<ChecklistBuilderProps> = ({ isDarkMode = true }) => {
  const { activeTemplate, addItem, updateItem, removeItem } = useChecklistTemplates();
  const [newText, setNewText] = useState('');
  const [newPhase, setNewPhase] = useState<ChecklistPhase>('pre-entry');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);

  const muted = isDarkMode ? 'text-zinc-500' : 'text-slate-400';
  const input = isDarkMode
    ? 'bg-black border-zinc-800 text-zinc-100 placeholder:text-zinc-600'
    : 'bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400';

  const itemsByPhase = (phase: ChecklistPhase): ChecklistTemplateItem[] =>
    activeTemplate.items.filter((i) => i.phase === phase);

  const handleAdd = () => {
    if (!newText.trim()) return;
    try { haptic.light(); } catch {}
    addItem(newText, newPhase);
    setNewText('');
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

  return (
    <div className="space-y-4 pb-24">
      <p className={`text-[12px] font-medium px-1 ${muted}`}>
        {activeTemplate.items.length === 0
          ? 'No rules yet — add your first rule below.'
          : `${activeTemplate.items.length} rules — swipe a rule to edit or delete.`}
      </p>

      <div className="space-y-2.5">
        <div className="flex items-center gap-2 px-1">
          <h3 className={`text-[11px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-300' : 'text-slate-600'}`}>
            Add a rule
          </h3>
          <button
            onClick={() => { try { haptic.selection(); } catch {} setHelpOpen(true); }}
            aria-label="How do strategy rules work?"
            className={`${muted} hover:text-[#FF4F01] touch-manipulation min-w-[36px] min-h-[36px] flex items-center justify-center -ml-1`}
          >
            <HelpCircle size={16} />
          </button>
        </div>
        <input
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          placeholder="New rule…"
          className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none min-h-[46px] ${input}`}
        />
        <div className="flex items-center gap-3 px-1">
          <div className="flex-1 flex items-center gap-4">
            {PHASE_ORDER.map((phase) => (
              <button
                key={phase}
                onClick={() => { try { haptic.selection(); } catch {} setNewPhase(phase); }}
                className={`py-2 text-[11px] font-black uppercase tracking-widest touch-manipulation min-h-[38px] transition-colors ${
                  newPhase === phase ? 'text-[#FF4F01]' : muted
                }`}
              >
                {PHASE_SHORT[phase]}
              </button>
            ))}
          </div>
          <button
            onClick={handleAdd}
            disabled={!newText.trim()}
            aria-label="Add rule"
            className="w-11 h-11 rounded-full bg-[#FF4F01] text-white flex items-center justify-center shrink-0 disabled:opacity-40 touch-manipulation active:scale-95 transition-transform"
          >
            <Plus size={18} />
          </button>
        </div>
      </div>

      {CHECKLIST_PHASES.map((phase) => {
        const Icon = PHASE_ICONS[phase.id];
        const items = itemsByPhase(phase.id);
        if (items.length === 0) return null;
        return (
          <section key={phase.id}>
            <div className="flex items-center gap-1.5 px-1 py-1">
              <Icon size={12} className={muted} />
              <h3 className={`text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
                {phase.label}
              </h3>
              <span className={`text-[10px] font-bold ${isDarkMode ? 'text-zinc-600' : 'text-slate-400'}`}>{items.length}</span>
            </div>
            <div className={`divide-y ${isDarkMode ? 'divide-zinc-800/70' : 'divide-slate-100'}`}>
              {items.map((item) => (
                <RuleRow
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

      <WidgetHelpDrawer
        isOpen={helpOpen}
        widgetId="strategyRulesChecklists"
        onClose={() => setHelpOpen(false)}
        isDarkMode={isDarkMode}
      />
    </div>
  );
};
