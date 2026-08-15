import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Target, Workflow, Activity, AlertCircle, Zap, Timer,
  Clock3, BarChart3, LayoutGrid, CheckCircle2, CircleDot,
  ArrowLeft, ShieldAlert, Globe, LogOut, User, Goal, ListChecks,
  Search, Command, ChevronDown, ChevronRight, X, Filter,
  LayoutDashboard, FileText, Shield, GitBranch, ScrollText,
  Sparkles, Eye, EyeOff, RotateCcw, Download, Share2, Bookmark
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { ChecklistWidget } from './AIWidgets';

interface Props {
  isDarkMode: boolean;
  message: {
    id: string;
    sections?: Record<string, string>;
    strategyProfile?: any;
    signatures?: Record<string, boolean>;
    checklistData?: Record<string, { title: string, items: { text: string, checked: boolean }[] }>;
  };
  onClose: () => void;
  onToggleSignature: (messageId: string, sectionKey: string) => void;
}

type TabType = 'overview' | 'strategy' | 'risk' | 'execution' | 'checklists';
type ViewMode = 'grid' | 'list';

const TABS: { id: TabType; label: string; icon: React.ReactNode; color: string }[] = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={16} />, color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  { id: 'strategy', label: 'Strategy', icon: <Target size={16} />, color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20' },
  { id: 'risk', label: 'Risk', icon: <ShieldAlert size={16} />, color: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
  { id: 'execution', label: 'Flows', icon: <GitBranch size={16} />, color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' },
  { id: 'checklists', label: 'Checks', icon: <CheckCircle2 size={16} />, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
];

const SECTION_CONFIG: Record<string, {
  icon: React.ReactNode;
  color: string;
  bg: string;
  borderColor: string;
  label: string;
  gridClass: string;
  type?: 'text' | 'mermaid' | 'checklist';
  category: TabType;
}> = {
  STRATEGY_RULES: {
    icon: <Workflow size={24} />,
    color: 'text-indigo-400',
    bg: 'bg-indigo-500/5',
    borderColor: 'border-indigo-500/20',
    label: 'Strategic Rules',
    gridClass: 'md:col-span-2 md:row-span-2',
    category: 'strategy'
  },
  CORE_EDGE: {
    icon: <Activity size={24} />,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/5',
    borderColor: 'border-emerald-500/20',
    label: 'Core Edge',
    gridClass: 'md:col-span-2 md:row-span-2',
    category: 'strategy'
  },
  RISK: {
    icon: <ShieldAlert size={20} />,
    color: 'text-rose-400',
    bg: 'bg-rose-500/5',
    borderColor: 'border-rose-500/20',
    label: 'Risk Management',
    gridClass: 'md:col-span-2 md:row-span-1',
    category: 'risk'
  },
  EXECUTION_FLOW: {
    icon: <Zap size={20} />,
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/5',
    borderColor: 'border-cyan-500/20',
    label: 'Execution Flow',
    gridClass: 'md:col-span-2 md:row-span-1',
    category: 'execution'
  },
  IDENTITY: {
    icon: <User size={18} />,
    color: 'text-amber-400',
    bg: 'bg-amber-500/5',
    borderColor: 'border-amber-500/20',
    label: 'Identity',
    gridClass: 'md:col-span-1 md:row-span-1',
    category: 'overview'
  },
  MARKET_SELECTION: {
    icon: <Globe size={18} />,
    color: 'text-blue-400',
    bg: 'bg-blue-500/5',
    borderColor: 'border-blue-500/20',
    label: 'Markets',
    gridClass: 'md:col-span-1 md:row-span-1',
    category: 'overview'
  },
  EXIT_PROTOCOL: {
    icon: <LogOut size={18} />,
    color: 'text-orange-400',
    bg: 'bg-orange-500/5',
    borderColor: 'border-orange-500/20',
    label: 'Exit Protocol',
    gridClass: 'md:col-span-1 md:row-span-1',
    category: 'execution'
  },
  ROUTINE: {
    icon: <Clock3 size={18} />,
    color: 'text-violet-400',
    bg: 'bg-violet-500/5',
    borderColor: 'border-violet-500/20',
    label: 'Routine',
    gridClass: 'md:col-span-1 md:row-span-1',
    category: 'overview'
  }
};

const TradingPlanBento: React.FC<Props> = ({ isDarkMode, message, onClose, onToggleSignature }) => {
  const sections = message.sections || {};
  const profile = message.strategyProfile || {};
  const signatures = message.signatures || {};
  const checklistData = message.checklistData || {};

  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(Object.keys(sections)));
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [showAllSections, setShowAllSections] = useState(true);

  const filteredSections = useMemo(() => {
    let filtered = Object.entries(SECTION_CONFIG).filter(([key]) => sections[key]);
    
    if (!showAllSections) {
      filtered = filtered.filter(([_, cfg]) => cfg.category === activeTab);
    }
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(([key, cfg]) => {
        const content = sections[key]?.toLowerCase() || '';
        return cfg.label.toLowerCase().includes(query) || content.includes(query);
      });
    }
    
    return Object.fromEntries(filtered);
  }, [sections, activeTab, searchQuery, showAllSections]);

  const signatureProgress = useMemo(() => {
    const total = Object.keys(sections).length;
    const signed = Object.values(signatures).filter(Boolean).length;
    return total > 0 ? Math.round((signed / total) * 100) : 0;
  }, [sections, signatures]);

  const checklistProgress = useMemo(() => {
    const allChecklists = Object.values(checklistData);
    if (allChecklists.length === 0) return 0;
    
    let total = 0;
    let checked = 0;
    allChecklists.forEach(checklist => {
      checklist.items.forEach(item => {
        total++;
        if (item.checked) checked++;
      });
    });
    
    return total > 0 ? Math.round((checked / total) * 100) : 0;
  }, [checklistData]);

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const expandAll = () => setExpandedSections(new Set(Object.keys(sections)));
  const collapseAll = () => setExpandedSections(new Set());

  const AccordionCard = ({ 
    sectionKey, 
    config, 
    content, 
    isSigned 
  }: { 
    sectionKey: string; 
    config: typeof SECTION_CONFIG[string]; 
    content: string; 
    isSigned: boolean;
  }) => {
    const isExpanded = expandedSections.has(sectionKey);

    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`relative rounded-2xl border transition-all duration-300 overflow-hidden ${
          isSigned
            ? 'border-emerald-500/30 bg-emerald-500/[0.02]'
            : `${config.bg} ${config.borderColor} ${isDarkMode ? 'bg-black/40' : 'bg-white'}`
        }`}
      >
        <button
          onClick={() => toggleSection(sectionKey)}
          className={`w-full flex items-center justify-between p-4 text-left transition-colors ${
            isDarkMode ? 'hover:bg-white/5' : 'hover:bg-slate-50'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${isDarkMode ? 'bg-black/40' : 'bg-white shadow-sm border border-slate-200'} ${config.color}`}>
              {config.icon}
            </div>
            <div>
              <span className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-zinc-200' : 'text-slate-800'}`}>
                {config.label}
              </span>
              {isSigned && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <CheckCircle2 size={10} className="text-emerald-500" />
                  <span className="text-[9px] font-semibold text-emerald-500 uppercase tracking-wide">Verified</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isSigned && (
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            )}
            <motion.div
              animate={{ rotate: isExpanded ? 180 : 0 }}
              className={`${config.color}`}
            >
              <ChevronDown size={18} />
            </motion.div>
          </div>
        </button>

        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className={`px-4 pb-4 pt-2 border-t ${isDarkMode ? 'border-zinc-800' : 'border-slate-100'}`}>
                <div className={`text-sm leading-relaxed ${isDarkMode ? 'text-zinc-300' : 'text-slate-700'}`}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                </div>
                <div className="mt-4 pt-3 border-t border-black/5 dark:border-white/5 flex items-center justify-between">
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleSignature(message.id, sectionKey); }}
                    className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider transition-all ${
                      isSigned ? 'text-emerald-500' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {isSigned ? <CheckCircle2 size={14} /> : <CircleDot size={14} />}
                    {isSigned ? 'Signature Active' : 'Sign Module'}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={`fixed inset-0 z-[100] flex flex-col overflow-hidden ${
        isDarkMode ? 'bg-[#0a0a0f]' : 'bg-slate-50'
      }`}
      style={{ backgroundImage: isDarkMode ? 'radial-gradient(#ffffff03_1px,transparent_1px)' : 'radial-gradient(#00000003_1px,transparent_1px)', backgroundSize: '24px 24px' }}
    >
      {/* Header */}
      <header className={`flex items-center justify-between px-6 py-4 border-b shrink-0 backdrop-blur-xl ${
        isDarkMode ? 'bg-[#0a0a0f]/80 border-zinc-800/50' : 'bg-white/80 border-slate-200/50'
      }`}>
        <div className="flex items-center gap-6">
          <button
            onClick={onClose}
            className={`p-2.5 rounded-xl transition-all active:scale-95 ${
              isDarkMode ? 'hover:bg-black text-zinc-400 hover:text-white' : 'hover:bg-slate-100 text-slate-500 hover:text-slate-700'
            }`}
          >
            <ArrowLeft size={20} />
          </button>

        </div>

        <div className="flex items-center gap-3">
          {/* Search */}
          <div className={`relative flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${
            isDarkMode ? 'bg-black/50 border-zinc-700' : 'bg-white border-slate-200'
          }`}>
            <Search size={14} className={isDarkMode ? 'text-zinc-500' : 'text-slate-400'} />
            <input
              type="text"
              placeholder="Search sections..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`bg-transparent text-xs font-medium w-32 outline-none placeholder:text-zinc-500 ${
                isDarkMode ? 'text-zinc-300' : 'text-slate-700'
              }`}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-zinc-500 hover:text-zinc-300">
                <X size={12} />
              </button>
            )}
            <div className={`w-px h-4 ${isDarkMode ? 'bg-black' : 'bg-slate-200'}`} />
            <kbd className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
              isDarkMode ? 'bg-black text-zinc-500' : 'bg-slate-100 text-slate-400'
            }`}>⌘K</kbd>
          </div>

          {/* Progress */}
          <div className={`flex items-center gap-2 px-4 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-widest ${
            isDarkMode ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-emerald-50 border-emerald-200 text-emerald-600'
          }`}>
            <CheckCircle2 size={12} />
            {signatureProgress}% Verified
          </div>

          <button
            onClick={onClose}
            className="px-5 py-2 bg-gradient-to-r from-amber-500 to-amber-600 text-white rounded-xl text-xs font-bold uppercase tracking-widest shadow-lg shadow-amber-500/20 active:scale-95 transition-all hover:shadow-amber-500/30"
          >
            Exit
          </button>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className={`flex items-center gap-1 px-6 py-3 border-b overflow-x-auto ${
        isDarkMode ? 'bg-[#0a0a0f]/50 border-zinc-800/50' : 'bg-white/50 border-slate-200/50'
      }`}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setShowAllSections(false); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap ${
              activeTab === tab.id && !showAllSections
                ? `${tab.color} shadow-lg`
                : isDarkMode
                  ? 'text-zinc-500 hover:text-zinc-300 hover:bg-black/50'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
        <div className={`w-px h-6 mx-2 ${isDarkMode ? 'bg-black' : 'bg-slate-200'}`} />
        <button
          onClick={() => setShowAllSections(true)}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
            showAllSections
              ? 'bg-gradient-to-r from-violet-500 to-purple-500 text-white shadow-lg shadow-purple-500/20'
              : isDarkMode
                ? 'text-zinc-500 hover:text-zinc-300 hover:bg-black/50'
                : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
          }`}
        >
          <LayoutGrid size={16} />
          All Sections
        </button>
        
        <div className="flex-1" />
        
        {/* View Controls */}
        <div className={`flex items-center gap-1 p-1 rounded-xl ${isDarkMode ? 'bg-black/50' : 'bg-slate-100'}`}>
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 rounded-lg transition-all ${viewMode === 'grid' 
              ? (isDarkMode ? 'bg-black text-white' : 'bg-white text-slate-700 shadow-sm')
              : (isDarkMode ? 'text-zinc-500 hover:text-zinc-300' : 'text-slate-400 hover:text-slate-600')
            }`}
          >
            <LayoutGrid size={14} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-2 rounded-lg transition-all ${viewMode === 'list' 
              ? (isDarkMode ? 'bg-black text-white' : 'bg-white text-slate-700 shadow-sm')
              : (isDarkMode ? 'text-zinc-500 hover:text-zinc-300' : 'text-slate-400 hover:text-slate-600')
            }`}
          >
            <ScrollText size={14} />
          </button>
        </div>

        {/* Expand/Collapse */}
        <div className={`flex items-center gap-1 p-1 rounded-xl ${isDarkMode ? 'bg-black/50' : 'bg-slate-100'}`}>
          <button
            onClick={expandAll}
            className={`p-2 rounded-lg transition-all ${isDarkMode ? 'text-zinc-500 hover:text-white' : 'text-slate-400 hover:text-slate-700'}`}
            title="Expand All"
          >
            <Eye size={14} />
          </button>
          <button
            onClick={collapseAll}
            className={`p-2 rounded-lg transition-all ${isDarkMode ? 'text-zinc-500 hover:text-white' : 'text-slate-400 hover:text-slate-700'}`}
            title="Collapse All"
          >
            <EyeOff size={14} />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-[1800px] mx-auto p-6 space-y-6 pb-20">
          


          {/* Checklists */}
          {Object.keys(checklistData).length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 ${
                  isDarkMode ? 'text-zinc-400' : 'text-slate-600'
                }`}>
                  <CheckCircle2 size={14} />
                  Compliance Checklists
                </h3>
                <div className={`text-[10px] font-bold uppercase tracking-wider ${
                  checklistProgress === 100 ? 'text-emerald-500' : isDarkMode ? 'text-zinc-500' : 'text-slate-400'
                }`}>
                  {checklistProgress}% Complete
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.keys(checklistData).map((clKey, idx) => (
                  <motion.div
                    key={clKey}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.1 }}
                  >
                    <ChecklistWidget 
                      title={checklistData[clKey].title} 
                      items={checklistData[clKey].items} 
                      isDarkMode={isDarkMode} 
                    />
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Content Sections - Grid or List View */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 ${
                isDarkMode ? 'text-zinc-400' : 'text-slate-600'
              }`}>
                <FileText size={14} />
                {showAllSections ? 'All Sections' : TABS.find(t => t.id === activeTab)?.label || 'Sections'}
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                  isDarkMode ? 'bg-black text-zinc-500' : 'bg-slate-100 text-slate-400'
                }`}>
                  {Object.keys(filteredSections).length}
                </span>
              </h3>
            </div>

            {viewMode === 'grid' ? (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 auto-rows-min">
                {Object.entries(filteredSections).map(([key, config], idx) => {
                  const content = sections[key];
                  if (!content) return null;
                  const isSigned = signatures[key];

                  return (
                    <motion.div
                      key={key}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className={`${config.gridClass}`}
                    >
                      <AccordionCard
                        sectionKey={key}
                        config={config}
                        content={content}
                        isSigned={isSigned}
                      />
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-3">
                {Object.entries(filteredSections).map(([key, config], idx) => {
                  const content = sections[key];
                  if (!content) return null;
                  const isSigned = signatures[key];

                  return (
                    <motion.div
                      key={key}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.03 }}
                    >
                      <AccordionCard
                        sectionKey={key}
                        config={{ ...config, gridClass: '' }}
                        content={content}
                        isSigned={isSigned}
                      />
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Empty State */}
          {Object.keys(filteredSections).length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className={`flex flex-col items-center justify-center py-20 ${
                isDarkMode ? 'text-zinc-500' : 'text-slate-400'
              }`}
            >
              <div className={`p-4 rounded-2xl mb-4 ${isDarkMode ? 'bg-black' : 'bg-slate-100'}`}>
                <Search size={32} />
              </div>
              <p className="text-sm font-medium">No sections found</p>
              <p className="text-xs mt-1">Try adjusting your search or filters</p>
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default TradingPlanBento;