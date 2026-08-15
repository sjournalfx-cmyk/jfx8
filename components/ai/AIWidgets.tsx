import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { List, Check, X } from 'lucide-react';

export type ChecklistStatus = 'todo' | 'doing' | 'done' | 'blocked';

export type ChecklistItem = {
    text: string;
    checked: boolean;
    status?: ChecklistStatus;
    indentLevel?: number;
};

export const ChecklistWidget = ({
    title,
    items,
    isDarkMode
}: {
    title: string,
    items: ChecklistItem[],
    isDarkMode: boolean
}) => {
    const [localItems, setLocalItems] = useState(items);

    useEffect(() => {
        setLocalItems(items);
    }, [items]);

    const toggleItem = (index: number) => {
        const nextStatus = (status?: ChecklistStatus, checked = false): Pick<ChecklistItem, 'status' | 'checked'> => {
            if (!status) {
                return { checked: !checked };
            }

            switch (status) {
                case 'todo':
                    return { status: 'doing', checked: false };
                case 'doing':
                    return { status: 'done', checked: true };
                case 'done':
                    return { status: 'blocked', checked: false };
                case 'blocked':
                default:
                    return { status: 'todo', checked: false };
            }
        };

        const newItems = localItems.map((item, i) => (
            i === index
                ? { ...item, ...nextStatus(item.status, item.checked) }
                : item
        ));
        setLocalItems(newItems);
    };

    const completedCount = localItems.filter((item) => item.checked || item.status === 'done').length;
    const activeCount = localItems.filter((item) => item.status === 'doing').length;
    const blockedCount = localItems.filter((item) => item.status === 'blocked').length;
    const progress = localItems.length > 0 
        ? (completedCount / localItems.length) * 100 
        : 0;

    return (
        <motion.div 
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className={`w-full overflow-hidden rounded-[28px] border ${
                isDarkMode 
                    ? 'bg-black/70 border-white/8 shadow-2xl shadow-black/20' 
                    : 'bg-white border-slate-200 shadow-xl shadow-slate-200/50'
            }`}
        >
            {/* Header */}
            <div className={`px-4 py-3 border-b flex items-center justify-between ${
                isDarkMode ? 'border-white/8 bg-white/[0.03]' : 'border-slate-200 bg-slate-50/80'
            }`}>
                <div className="flex items-center gap-2.5">
                    <div className={`p-1.5 rounded-lg ${isDarkMode ? 'bg-emerald-500/10 text-emerald-300' : 'bg-emerald-50 text-emerald-600'}`}>
                        <List size={14} />
                    </div>
                    <div>
                        <span className={`text-[10px] font-bold uppercase tracking-[0.18em] ${isDarkMode ? 'text-zinc-100' : 'text-slate-800'}`}>
                        {title || 'Checklist'}
                        </span>
                        <div className={`mt-0.5 text-[9px] uppercase tracking-[0.18em] ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>
                            {completedCount}/{localItems.length || 0} done
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[0.15em] ${
                        isDarkMode ? 'bg-white/5 text-emerald-300' : 'bg-emerald-50 text-emerald-700'
                    }`}>
                        {Math.round(progress)}% complete
                    </span>
                    <span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[0.15em] ${
                        isDarkMode ? 'bg-white/5 text-cyan-300' : 'bg-cyan-50 text-cyan-700'
                    }`}>
                        {activeCount} active
                    </span>
                    {blockedCount > 0 && (
                        <span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[0.15em] ${
                            isDarkMode ? 'bg-white/5 text-rose-300' : 'bg-rose-50 text-rose-700'
                        }`}>
                            {blockedCount} blocked
                        </span>
                    )}
                </div>
            </div>

            {/* Progress Bar */}
            <div className={`h-0.5 w-full ${isDarkMode ? 'bg-white/5' : 'bg-slate-100'}`}>
                <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    className="h-full bg-gradient-to-r from-emerald-500 via-cyan-500 to-emerald-400"
                />
            </div>

            {/* Items */}
            <div className="p-2.5 space-y-1.5">
                {localItems.map((item, i) => (
                    <button
                        key={i}
                        onClick={() => toggleItem(i)}
                        style={{ paddingLeft: `${12 + (item.indentLevel || 0) * 18}px` }}
                        className={`w-full flex items-center gap-3 px-3 py-3 rounded-2xl transition-all group text-left ${
                            item.status === 'done' || item.checked
                                ? (isDarkMode ? 'bg-emerald-500/8 text-zinc-500' : 'bg-emerald-50/70 text-slate-400')
                                : item.status === 'doing'
                                    ? (isDarkMode ? 'bg-cyan-500/10 text-cyan-100 ring-1 ring-cyan-500/20' : 'bg-cyan-50 text-cyan-900 ring-1 ring-cyan-200')
                                    : item.status === 'blocked'
                                        ? (isDarkMode ? 'bg-rose-500/8 text-rose-100 ring-1 ring-rose-500/20' : 'bg-rose-50 text-rose-900 ring-1 ring-rose-200')
                                        : (isDarkMode ? 'hover:bg-white/6 text-zinc-200 border border-white/5' : 'hover:bg-white text-slate-700 shadow-sm border border-transparent hover:border-slate-200')
                        }`}
                    >
                        <div className={`shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                            item.status === 'done' || item.checked
                                ? 'bg-emerald-500 border-emerald-500 text-white'
                                : item.status === 'doing'
                                    ? 'bg-cyan-500 border-cyan-500 text-white'
                                    : item.status === 'blocked'
                                        ? 'bg-rose-500 border-rose-500 text-white'
                                        : (isDarkMode ? 'border-white/10 bg-white/[0.03]' : 'border-slate-200 bg-white group-hover:border-emerald-500/50')
                        }`}>
                            {item.status === 'done' || item.checked
                                ? <Check size={12} strokeWidth={4} />
                                : item.status === 'doing'
                                    ? <div className="h-1.5 w-1.5 rounded-full bg-white" />
                                    : item.status === 'blocked'
                                        ? <X size={12} strokeWidth={3.5} />
                                        : null}
                        </div>
                        <span className={`text-xs font-medium text-left flex-1 leading-5 ${
                            item.status === 'done' || item.checked ? 'line-through opacity-55' : ''
                        }`}>
                            {item.text}
                        </span>
                        {item.status && (
                            <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[0.16em] ${
                                item.status === 'done'
                                    ? isDarkMode ? 'bg-emerald-500/10 text-emerald-300' : 'bg-emerald-100 text-emerald-700'
                                    : item.status === 'doing'
                                        ? isDarkMode ? 'bg-cyan-500/10 text-cyan-300' : 'bg-cyan-100 text-cyan-700'
                                        : item.status === 'blocked'
                                            ? isDarkMode ? 'bg-rose-500/10 text-rose-300' : 'bg-rose-100 text-rose-700'
                                            : isDarkMode ? 'bg-white/5 text-zinc-400' : 'bg-slate-100 text-slate-500'
                            }`}>
                                {item.status}
                            </span>
                        )}
                    </button>
                ))}
            </div>
        </motion.div>
    );
};

// Preset templates for common trading diagrams
export const CHECKLIST_PRESETS = {
    entry: [
        "Market aligns with daily bias",
        "Price at key structure level",
        "Confirm momentum direction",
        "Check news/events calendar",
        "Risk/Reward minimum 1:2",
        "Position size calculated",
        "Stop loss placed at logical level",
        "Take profit target identified"
    ],
    exit: [
        "Hit profit target - Exit full",
        "Hit stop loss - Accept loss",
        "Time exit - Session end",
        "Trailing stop activated",
        "News event approaching",
        "Technical reversal signal"
    ],
    psychology: [
        "Are you trading the plan?",
        "Is your mind clear?",
        "Did you check your P&L?",
        "Are you emotionally stable?",
        "Is this a revenge trade?",
        "Have you taken breaks?",
        "Is your focus sharp?",
        "Are you following rules?"
    ],
    risk: [
        "Max risk per trade: 1-2%",
        "Max daily loss: 6%",
        "Max open positions: 3",
        "Correlation check done",
        "Lot size verified",
        "Account balance confirmed"
    ]
};

// Mermaid Widget Component
