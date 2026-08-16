import React, { useState, useMemo } from 'react';
import { ChevronLeft, X, Search, Link2, Check } from 'lucide-react';
import { WIDGET_HELP_DATABASE, getWidgetHelpArticle, WidgetHelpArticle } from '../../lib/widgetHelpData';

interface WidgetHelpDrawerProps {
    isOpen: boolean;
    widgetId: string | null;
    onClose: () => void;
    isDarkMode?: boolean;
}

export const WidgetHelpDrawer: React.FC<WidgetHelpDrawerProps> = ({
    isOpen,
    widgetId,
    onClose,
    isDarkMode = true
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(widgetId);
    const [copied, setCopied] = useState(false);

    React.useEffect(() => {
        if (widgetId) setSelectedId(widgetId);
    }, [widgetId]);

    const activeArticle: WidgetHelpArticle = useMemo(() => {
        const idToUse = selectedId || widgetId || 'winRate';
        return getWidgetHelpArticle(idToUse);
    }, [selectedId, widgetId]);

    const searchResults = useMemo(() => {
        if (!searchQuery.trim()) return [];
        const q = searchQuery.toLowerCase();
        return Object.values(WIDGET_HELP_DATABASE).filter(art =>
            art.title.toLowerCase().includes(q) ||
            art.category.toLowerCase().includes(q) ||
            art.definition.toLowerCase().includes(q)
        );
    }, [searchQuery]);

    if (!isOpen) return null;

    const handleCopyLink = () => {
        const url = `${window.location.origin}${window.location.pathname}?help=${activeArticle.id}`;
        navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="fixed inset-0 z-[500] flex justify-end">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Drawer Panel — Compact width (max-w-md / 440px), pure black, no side/inner borders */}
            <div
                className="relative flex flex-col z-10 h-full shadow-2xl"
                style={{ width: 'min(440px, 85vw)', backgroundColor: '#000000', color: '#e4e4e7' }}
            >
                {/* ── Header ── */}
                <div
                    className="px-5 py-4 flex items-center gap-3 shrink-0"
                    style={{ backgroundColor: '#000000' }}
                >
                    <button
                        onClick={() => {
                            if (searchQuery) setSearchQuery('');
                            else onClose();
                        }}
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-white transition-colors shrink-0"
                        title="Back"
                    >
                        <ChevronLeft size={18} />
                    </button>

                    {/* Search */}
                    <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-zinc-950 rounded-lg">
                        <Search size={14} className="text-zinc-500 shrink-0" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search help..."
                            className="w-full bg-transparent text-xs outline-none placeholder:text-zinc-600 text-zinc-200"
                        />
                        {searchQuery && (
                            <button onClick={() => setSearchQuery('')} className="text-zinc-500 hover:text-zinc-300">
                                <X size={13} />
                            </button>
                        )}
                    </div>

                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-white transition-colors shrink-0"
                        title="Close"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* ── Scrollable Content (Raw text and bullet points) ── */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6 custom-scrollbar">

                    {/* ── SEARCH RESULTS ── */}
                    {searchQuery.trim() ? (
                        <div className="space-y-3">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                                Results ({searchResults.length})
                            </p>
                            {searchResults.length === 0 ? (
                                <p className="text-xs text-zinc-500 py-6 text-center">
                                    No articles found for "{searchQuery}".
                                </p>
                            ) : (
                                searchResults.map(art => (
                                    <div
                                        key={art.id}
                                        onClick={() => { setSelectedId(art.id); setSearchQuery(''); }}
                                        className="py-2 cursor-pointer transition-all hover:opacity-80"
                                    >
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#FF4F00]">{art.category}</span>
                                        <h5 className="font-bold text-sm text-zinc-100">{art.title}</h5>
                                        <p className="text-xs text-zinc-400 line-clamp-2 mt-0.5">{art.definition}</p>
                                    </div>
                                ))
                            )}
                        </div>

                    ) : (
                        /* ── ARTICLE VIEW (RAW TEXT & BULLET POINTS ONLY) ── */
                        <div className="flex flex-col gap-6 text-xs text-zinc-300 leading-relaxed">

                            {/* Title row */}
                            <div className="flex items-start justify-between gap-3">
                                <h2 className="text-xl font-bold text-white leading-tight">
                                    {activeArticle.title}
                                </h2>
                                <button
                                    onClick={handleCopyLink}
                                    className="p-1 text-zinc-500 hover:text-white transition-colors shrink-0"
                                    title="Copy link"
                                >
                                    {copied ? <Check size={14} className="text-emerald-400" /> : <Link2 size={14} />}
                                </button>
                            </div>

                            {/* Definition */}
                            <p className="text-zinc-300 text-xs leading-relaxed">
                                {activeArticle.definition}
                            </p>

                            {/* Formula */}
                            {activeArticle.formula && (
                                <div className="order-1 space-y-2">
                                    <p className="font-bold text-white text-xs">The Formula:</p>
                                    <p className="text-zinc-300 text-xs">{activeArticle.formula}</p>
                                    {activeArticle.formulaExample && (
                                        <div className="space-y-2 pt-1">
                                            {activeArticle.formulaExample.split('\n\n').map((para, i) => (
                                                <p key={i} className="text-zinc-400 text-xs leading-relaxed">
                                                    {para}
                                                </p>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Why Misleading */}
                            {activeArticle.whyMisleading && (
                                <div className="order-3 space-y-2">
                                    <p className="font-bold text-white text-xs">
                                        Why {activeArticle.title.replace('What is ', '').replace('?', '')} Alone is Misleading
                                    </p>
                                    <p className="text-zinc-400 text-xs leading-relaxed">
                                        {activeArticle.whyMisleading.intro}
                                    </p>
                                    <ul className="space-y-2 pt-1 pl-1">
                                        {activeArticle.whyMisleading.examples.map((ex, i) => (
                                            <li key={i} className="flex items-start gap-2 text-xs text-zinc-300 leading-relaxed">
                                                <span className="text-zinc-500 shrink-0">•</span>
                                                <span>{ex}</span>
                                            </li>
                                        ))}
                                    </ul>
                                    {activeArticle.whyMisleading.breakEvenFormula && (
                                        <div className="pt-2">
                                            <p className="font-bold text-white text-xs">The Break-Even Formula:</p>
                                            <p className="text-zinc-300 text-xs mt-1">{activeArticle.whyMisleading.breakEvenFormula}</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* How It Helps */}
                            {activeArticle.howItHelps && activeArticle.howItHelps.length > 0 && (
                                <div className="order-2 space-y-4">
                                    <p className="font-bold text-white text-xs">
                                        How Tracked {activeArticle.title.replace('What is ', '').replace(/\?$/, 's').replace(/a$/i, 'a').replace(/e$/i, 'e')} Help Traders
                                    </p>                                    <div className="space-y-4">
                                        {activeArticle.howItHelps.map((section, si) => (
                                            <div key={si} className="space-y-1.5">
                                                <p className="font-semibold text-zinc-200 text-xs">
                                                    {section.title}
                                                </p>
                                                <ul className="space-y-1 pl-1">
                                                    {section.points.map((pt, pi) => (
                                                        <li key={pi} className="flex items-start gap-2 text-xs text-zinc-400 leading-relaxed">
                                                            <span className="text-zinc-500 shrink-0">•</span>
                                                            <span>{pt}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Bottom spacer */}
                            <div className="order-4 h-8" />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
