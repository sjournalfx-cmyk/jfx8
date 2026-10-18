import React, { useEffect, useCallback } from 'react';
import { 
    Keyboard, X, Search, Plus, LayoutDashboard, 
    FileText, BarChart2, Settings
} from 'lucide-react';

interface Shortcut {
    key: string;
    modifiers?: 'ctrl' | 'alt' | 'shift' | 'meta';
    action: string;
    description: string;
    category: string;
}

const SHORTCUTS: Shortcut[] = [
    // Navigation
    { key: '1', modifiers: 'ctrl', action: 'go-dashboard', description: 'Go to Dashboard', category: 'Navigation' },
    { key: '2', modifiers: 'ctrl', action: 'go-journal', description: 'Go to Journal', category: 'Navigation' },
    { key: '3', modifiers: 'ctrl', action: 'go-analytics', description: 'Go to Analytics', category: 'Navigation' },
    { key: '4', modifiers: 'ctrl', action: 'go-notes', description: 'Go to Notes', category: 'Navigation' },
    { key: 'n', modifiers: 'ctrl', action: 'new-trade', description: 'Log Trade', category: 'Actions' },
    { key: 'k', modifiers: 'ctrl', action: 'search', description: 'Search (Global)', category: 'Actions' },
    { key: 's', modifiers: 'ctrl', action: 'save', description: 'Save Current Form', category: 'Actions' },
    { key: 'Escape', action: 'close-modal', description: 'Close Modal/Dialog', category: 'Actions' },
    { key: '?', action: 'show-shortcuts', description: 'Show Keyboard Shortcuts', category: 'Help' },
];

interface UseKeyboardShortcutsOptions {
    onShortcut?: (action: string) => void;
    enabled?: boolean;
}

export const useKeyboardShortcuts = (options: UseKeyboardShortcutsOptions = {}) => {
    const { onShortcut, enabled = true } = options;

    const handleKeyDown = useCallback((event: KeyboardEvent) => {
        if (!enabled) return;
        
        // Ignore if user is typing in an input
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
            return;
        }

        const { key, ctrlKey, altKey, metaKey, shiftKey } = event;
        
        SHORTCUTS.forEach(shortcut => {
            const modifiersMatch = 
                (shortcut.modifiers === 'ctrl' && (ctrlKey || metaKey)) ||
                (shortcut.modifiers === 'alt' && altKey) ||
                (shortcut.modifiers === 'shift' && shiftKey) ||
                (!shortcut.modifiers && !ctrlKey && !altKey && !metaKey && !shiftKey);

            if (key.toLowerCase() === shortcut.key.toLowerCase() && modifiersMatch) {
                event.preventDefault();
                onShortcut?.(shortcut.action);
            }
        });
    }, [enabled, onShortcut]);

    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);
};

interface KeyboardShortcutsModalProps {
    isOpen: boolean;
    onClose: () => void;
    isDarkMode: boolean;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
    isOpen,
    onClose,
    isDarkMode
}) => {
    if (!isOpen) return null;

    const categories = [...new Set(SHORTCUTS.map(s => s.category))];

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className={`
                relative w-full max-w-lg rounded-3xl border shadow-2xl overflow-hidden
                ${isDarkMode ? 'bg-[#000000] border-zinc-800' : 'bg-white border-slate-200'}
            `}>
                <div className={`p-6 border-b flex items-center justify-between ${isDarkMode ? 'border-zinc-800' : 'border-slate-100'}`}>
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-xl ${isDarkMode ? 'bg-black' : 'bg-slate-100'}`}>
                            <Keyboard size={20} className="text-[#FF4F01]" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold">Keyboard Shortcuts</h3>
                            <p className={`text-xs ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>
                                Press <kbd className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${isDarkMode ? 'bg-black' : 'bg-slate-100'}`}>?</kbd> to toggle this panel
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-black' : 'hover:bg-slate-100'}`}
                    >
                        <X size={20} />
                    </button>
                </div>
                
                <div className="p-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
                    {categories.map(category => (
                        <div key={category} className="mb-6 last:mb-0">
                            <h4 className={`text-xs font-black uppercase tracking-widest mb-3 ${
                                isDarkMode ? 'text-zinc-500' : 'text-slate-500'
                            }`}>
                                {category}
                            </h4>
                            <div className="space-y-2">
                                {SHORTCUTS.filter(s => s.category === category).map(shortcut => (
                                    <div key={shortcut.action} className="flex items-center justify-between">
                                        <span className={`text-sm ${isDarkMode ? 'text-zinc-300' : 'text-slate-700'}`}>
                                            {shortcut.description}
                                        </span>
                                        <div className="flex items-center gap-1">
                                            {shortcut.modifiers && (
                                                <kbd className={`
                                                    px-2 py-1 rounded text-[10px] font-mono font-bold
                                                    ${isDarkMode ? 'bg-black text-zinc-400' : 'bg-slate-100 text-slate-600'}
                                                `}>
                                                    {shortcut.modifiers === 'ctrl' ? '⌘' : shortcut.modifiers}
                                                </kbd>
                                            )}
                                            <kbd className={`
                                                px-2 py-1 rounded text-[10px] font-mono font-bold
                                                ${isDarkMode ? 'bg-black text-zinc-400' : 'bg-slate-100 text-slate-600'}
                                            `}>
                                                {shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key}
                                            </kbd>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export const KeyboardShortcutHint: React.FC<{
    shortcut: string;
    isDarkMode: boolean;
}> = ({ shortcut, isDarkMode }) => {
    const [modifiers, key] = shortcut.split('+');
    
    return (
        <div className="flex items-center gap-1">
            {modifiers && (
                <kbd className={`
                    px-1.5 py-0.5 rounded text-[9px] font-mono font-bold
                    ${isDarkMode ? 'bg-black text-zinc-400' : 'bg-slate-100 text-slate-600'}
                `}>
                    {modifiers === 'ctrl' ? '⌘' : modifiers}
                </kbd>
            )}
            <kbd className={`
                px-1.5 py-0.5 rounded text-[9px] font-mono font-bold
                ${isDarkMode ? 'bg-black text-zinc-400' : 'bg-slate-100 text-slate-600'}
            `}>
                {key}
            </kbd>
        </div>
    );
};
