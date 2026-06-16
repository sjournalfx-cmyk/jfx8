
import React, { useState } from 'react';
import { Shield, Target, Brain, Clock, Book, Plus, Trash2, CheckCircle, XCircle, AlertTriangle, Scroll, PenTool, Gavel, Scale } from 'lucide-react';
import { RuleSection } from '../types';

interface RulesProps {
  isDarkMode: boolean;
  ruleSections: RuleSection[];
  onUpdateSections: (sections: RuleSection[]) => void;
}

const Rules: React.FC<RulesProps> = ({ isDarkMode, ruleSections, onUpdateSections }) => {
  const [activeSectionId, setActiveSectionId] = useState<string>(ruleSections[0]?.id || '');
  const [newRuleText, setNewRuleText] = useState('');
  const [isSigned, setIsSigned] = useState(false);

  const getIcon = (name: string) => {
    switch(name) {
      case 'Shield': return Shield;
      case 'Target': return Target;
      case 'Brain': return Brain;
      case 'Clock': return Clock;
      default: return Book;
    }
  };

  const handleAddRule = (sectionId: string) => {
    if (!newRuleText.trim()) return;
    
    const updatedSections = ruleSections.map(section => {
      if (section.id === sectionId) {
        return {
          ...section,
          rules: [...section.rules, { id: Date.now().toString(), text: newRuleText, isActive: true }]
        };
      }
      return section;
    });

    onUpdateSections(updatedSections);
    setNewRuleText('');
  };

  const handleDeleteRule = (sectionId: string, ruleId: string) => {
    const updatedSections = ruleSections.map(section => {
      if (section.id === sectionId) {
        return {
          ...section,
          rules: section.rules.filter(r => r.id !== ruleId)
        };
      }
      return section;
    });
    onUpdateSections(updatedSections);
  };

  const toggleRuleActive = (sectionId: string, ruleId: string) => {
    const updatedSections = ruleSections.map(section => {
      if (section.id === sectionId) {
        return {
          ...section,
          rules: section.rules.map(r => r.id === ruleId ? { ...r, isActive: !r.isActive } : r)
        };
      }
      return section;
    });
    onUpdateSections(updatedSections);
  };

  const totalRules = ruleSections.reduce((acc, section) => acc + section.rules.length, 0);
  const activeRules = ruleSections.reduce((acc, section) => acc + section.rules.filter(r => r.isActive).length, 0);
  const compliance = totalRules > 0 ? Math.round((activeRules / totalRules) * 100) : 0;

  return (
    <div className={`w-full h-full overflow-hidden flex flex-col ${isDarkMode ? 'bg-[#000000] text-zinc-200' : 'bg-slate-50 text-slate-900'}`}>
      
      {/* Hero Header */}
      <header className={`px-8 py-8 border-b shrink-0 flex items-start justify-between ${isDarkMode ? 'border-[#27272a] bg-[#000000]' : 'border-slate-200 bg-white'}`}>
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-[#FF4F00] text-white shadow-lg shadow-[#FF4F00]/20">
              <Scale size={24} />
            </div>
            <h1 className="text-3xl font-black tracking-tight font-serif italic">The Trading Constitution</h1>
          </div>
          <p className={`text-base max-w-2xl ${isDarkMode ? 'text-zinc-400' : 'text-slate-600'}`}>
            These are your non-negotiable laws. This document protects you from the market, and more importantly, from yourself.
          </p>
        </div>
        <div className={`hidden md:flex flex-col items-end`}>
             <div className="text-xs font-bold uppercase tracking-widest opacity-50 mb-1">Integrity Score</div>
             <div className="flex items-center gap-3">
                 <div className={`text-3xl font-black ${compliance === 100 ? 'text-teal-500' : 'text-amber-500'}`}>
                     {compliance}%
                 </div>
                 <div className="w-12 h-12 rounded-full border-4 border-current opacity-20 relative">
                      <div className="absolute inset-0 border-4 border-current border-t-transparent rounded-full animate-spin" />
                 </div>
             </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
        
        {/* Navigation / TOC */}
        <aside className={`w-full md:w-72 border-r overflow-y-auto flex flex-col ${isDarkMode ? 'border-[#27272a] bg-[#000000]' : 'border-slate-200 bg-white'}`}>
           <div className="p-6 space-y-1 flex-1">
             <h3 className="text-xs font-bold uppercase tracking-wider opacity-50 px-3 mb-4">Articles of Law</h3>
             {ruleSections.map((section, index) => {
               const isActive = section.id === activeSectionId;
               return (
                 <button
                   key={section.id}
                   onClick={() => setActiveSectionId(section.id)}
                   className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all text-sm font-semibold text-left
                     ${isActive 
                       ? 'bg-[#FF4F00]/10 text-[#FF4F00] border border-[#FF4F00]/20' 
                       : isDarkMode ? 'text-zinc-400 hover:bg-black border border-transparent' : 'text-slate-600 hover:bg-slate-100 border border-transparent'
                     }
                   `}
                 >
                   <span className="font-serif italic opacity-50 w-6">
                      {['I', 'II', 'III', 'IV', 'V', 'VI'][index] || index + 1}.
                   </span>
                   {section.title.replace(/Article [IVX]+: /, '')}
                 </button>
               );
             })}
             

             <button className={`w-full mt-2 border border-dashed rounded-xl p-3 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wide opacity-50 hover:opacity-100 transition-opacity ${isDarkMode ? 'border-zinc-700 text-zinc-500' : 'border-slate-300 text-slate-500'}`}>
                 <Plus size={14} /> Draft New Article
             </button>
           </div>

           {/* Daily Ratification Panel */}
           <div className={`m-6 p-6 rounded-2xl border flex flex-col gap-4 text-center ${isDarkMode ? 'bg-black border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
              <div className="mx-auto p-3 rounded-full bg-[#FF4F00] text-white shadow-lg">
                  <Gavel size={20} />
              </div>
              <div>
                  <h4 className="font-bold text-sm">Daily Ratification</h4>
                  <p className="text-xs opacity-60 mt-1">
                      I pledge to uphold these laws for today's session, {new Date().toLocaleDateString()}.
                  </p>
              </div>
              
              {!isSigned ? (
                  <button 
                    onClick={() => setIsSigned(true)}
                    className="w-full py-3 bg-[#FF4F00] hover:bg-[#E64600] text-white font-bold rounded-xl shadow-lg shadow-[#FF4F00]/25 transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                      <PenTool size={16} /> Sign Pledge
                  </button>
              ) : (
                  <div className="w-full py-3 bg-teal-500/10 text-teal-500 border border-teal-500/20 font-bold rounded-xl flex items-center justify-center gap-2">
                      <CheckCircle size={16} /> Ratified
                  </div>
              )}
           </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto custom-scrollbar p-6 md:p-12 relative">
          {/* Background watermark */}
          <div className="absolute inset-0 flex items-center justify-center opacity-[0.02] pointer-events-none select-none">
              <Scale size={400} />
          </div>

          <div className="max-w-3xl mx-auto relative z-10">
            
            {ruleSections.filter(s => s.id === activeSectionId).map(section => {
               const Icon = getIcon(section.iconName);
               return (
                 <div key={section.id} className="animate-in fade-in duration-500 slide-in-from-bottom-4">
                    
                    {/* Section Header */}
                    <div className="mb-10">
                        <div className="flex items-center gap-2 text-[#FF4F00] font-bold uppercase tracking-widest text-xs mb-3">
                            <Icon size={14} /> Section Overview
                        </div>
                        <h2 className="text-4xl font-black font-serif italic mb-4">{section.title}</h2>
                        {section.description && (
                            <div className={`p-4 rounded-xl border-l-4 ${isDarkMode ? 'bg-black/50 border-[#FF4F00]' : 'bg-indigo-50 border-[#FF4F00]'}`}>
                                <p className={`text-lg italic ${isDarkMode ? 'text-zinc-300' : 'text-slate-700'}`}>
                                    "{section.description}"
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Rules List */}
                    <div className="space-y-6">
                      {section.rules.map((rule, index) => (
                        <div 
                          key={rule.id}
                          className={`group relative pl-8 border-l-2 transition-all duration-300
                            ${rule.isActive 
                              ? (isDarkMode ? 'border-zinc-700' : 'border-slate-300')
                              : (isDarkMode ? 'border-rose-900 opacity-50' : 'border-rose-200 opacity-60')
                            }
                          `}
                        >
                           {/* Clause Number */}
                           <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 transition-colors ${rule.isActive ? (isDarkMode ? 'bg-black border-zinc-500' : 'bg-white border-slate-400') : 'bg-rose-500 border-rose-500'}`} />

                           <div className="flex items-start justify-between gap-4">
                               <div className="flex-1">
                                   <div className="flex items-center gap-2 mb-1">
                                        <h4 className="text-xs font-bold uppercase tracking-wider opacity-50">Clause {index + 1}.0</h4>
                                        {!rule.isActive && <span className="text-[10px] bg-rose-500 text-white px-1.5 rounded font-bold">SUSPENDED</span>}
                                   </div>
                                   <p className={`text-xl font-medium leading-relaxed ${rule.isActive ? '' : 'line-through decoration-rose-500/50'}`}>
                                       {rule.text}
                                   </p>
                               </div>
                               
                               <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                   <button 
                                     onClick={() => toggleRuleActive(section.id, rule.id)}
                                     title={rule.isActive ? "Suspend Rule" : "Activate Rule"}
                                     className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-black text-zinc-500' : 'hover:bg-slate-100 text-slate-400'}`}
                                   >
                                     {rule.isActive ? <XCircle size={18} /> : <CheckCircle size={18} />}
                                   </button>
                                   <button 
                                     onClick={() => handleDeleteRule(section.id, rule.id)}
                                     title="Repeal Rule"
                                     className="p-2 rounded-lg text-rose-500 hover:bg-rose-500/10 transition-colors"
                                   >
                                     <Trash2 size={18} />
                                   </button>
                               </div>
                           </div>
                        </div>
                      ))}

                      {/* Add New Rule Input */}
                      <div className={`mt-12 p-6 rounded-2xl border border-dashed transition-all ${isDarkMode ? 'border-zinc-800 bg-black/30' : 'border-slate-300 bg-slate-50'}`}>
                          <h4 className="text-sm font-bold flex items-center gap-2 mb-4 opacity-70">
                              <Scroll size={16} /> Amend Article
                          </h4>
                          <div className="flex gap-3">
                              <input 
                                type="text"
                                placeholder="Draft a new clause..."
                                className={`flex-1 bg-transparent border-b-2 py-2 outline-none text-lg font-medium transition-colors ${isDarkMode ? 'border-zinc-700 focus:border-[#FF4F00] placeholder-zinc-700' : 'border-slate-300 focus:border-[#FF4F00] placeholder-slate-400'}`}
                                value={newRuleText}
                                onChange={(e) => setNewRuleText(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddRule(section.id)}
                              />
                              <button 
                                 onClick={() => handleAddRule(section.id)}
                                 disabled={!newRuleText.trim()}
                                 className="px-6 py-2 bg-[#FF4F00] hover:bg-[#E64600] disabled:opacity-50 disabled:hover:bg-[#FF4F00] text-white font-bold rounded-xl text-sm transition-all shadow-lg shadow-[#FF4F00]/20"
                              >
                                Ratify
                              </button>
                          </div>
                      </div>
                    </div>
                 </div>
               );
            })}

          </div>
        </main>
      </div>
    </div>
  );
};

export default Rules;
