import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check, Tags } from 'lucide-react';
import { POSITIVE_TAGS, VIOLATION_TAGS } from '../../lib/disciplineChecklist';

interface ExecutionTagsSelectProps {
  value: string[];
  onChange: (tags: string[]) => void;
  isDarkMode: boolean;
  disabled?: boolean;
}

export const ExecutionTagsSelect: React.FC<ExecutionTagsSelectProps> = ({
  value,
  onChange,
  isDarkMode,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggle = (tag: string) => onChange(value.includes(tag) ? value.filter((t) => t !== tag) : [...value, tag]);
  const displayLabel = value.length === 0 ? 'Select tags...' : `${value.length} selected: ${value.join(', ')}`;
  const renderOption = (tag: string, tone: 'positive' | 'violation') => {
    const isSelected = value.includes(tag);
    return (
      <button key={tag} type="button" onClick={() => toggle(tag)}
        className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center gap-3 ${isSelected ? (tone === 'positive' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300') : isDarkMode ? 'text-zinc-300 hover:bg-[#27272a]' : 'text-slate-700 hover:bg-slate-100'}`}>
        <div className={`w-4 flex items-center justify-center shrink-0 ${isSelected ? (tone === 'positive' ? 'text-emerald-400' : 'text-rose-400') : 'opacity-0'}`}><Check size={14} /></div>
        <span className="truncate">{tag}</span>
      </button>
    );
  };

  return (
    <div className={`relative group ${disabled ? 'pointer-events-none opacity-50' : ''}`} ref={containerRef}>
      <label className="block text-[11px] font-bold uppercase tracking-widest mb-1 opacity-60">Execution Tags</label>
      <button type="button" disabled={disabled} onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`w-full text-left pl-11 pr-10 py-3.5 rounded-lg border-0 outline-none font-medium transition-all text-sm flex items-center justify-between relative ${isOpen ? 'ring-2 ring-[#FF4F00]/20 border-0' : ''} ${isDarkMode ? 'bg-[#0a0a0a] border-0 text-zinc-100 hover:bg-[#27272a]' : 'bg-white border-slate-200 text-slate-900 hover:bg-slate-50 shadow-sm'} ${disabled ? 'cursor-not-allowed bg-zinc-100 dark:bg-black/50' : ''}`}>
        <div className={`absolute left-3.5 top-1/2 -translate-y-1/2 transition-colors pointer-events-none ${isOpen ? 'text-[#FF4F00]' : 'text-zinc-400'}`}><Tags size={16} strokeWidth={2} /></div>
        <span className={`truncate ${value.length === 0 ? 'opacity-50' : ''}`}>{displayLabel}</span>
        <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-50 pointer-events-none text-zinc-500"><ChevronDown size={16} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : 'rotate-0'}`} /></div>
      </button>
      {isOpen && (
        <div className={`absolute left-0 right-0 mt-2 rounded-xl border-0 shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-top ${isDarkMode ? 'bg-[#0a0a0a] border-0' : 'bg-white border-slate-200'}`}>
          <div className="max-h-60 overflow-y-auto custom-scrollbar p-1.5 space-y-0.5">
            <p className="px-3 pt-2 pb-1 text-[10px] font-black uppercase tracking-widest text-emerald-500/80">Positive</p>
            {POSITIVE_TAGS.map((tag) => renderOption(tag, 'positive'))}
            <p className="px-3 pt-2 pb-1 text-[10px] font-black uppercase tracking-widest text-rose-500/80">Violations</p>
            {VIOLATION_TAGS.map((tag) => renderOption(tag, 'violation'))}
            <button type="button" onClick={() => setIsOpen(false)} className="w-full mt-1 px-3 py-2.5 rounded-lg text-sm font-bold bg-[#FF4F01] text-white transition-all">Done</button>
          </div>
        </div>
      )}
    </div>
  );
};
