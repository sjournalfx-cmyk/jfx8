import React, { useState, useEffect, useCallback } from 'react';
import {
  Radio, Plus, Trash2, Sparkles, ExternalLink,
  MessageSquare, X, ChevronDown, ChevronUp, Loader2,
  Bell, BellOff, Clock, Globe, AlertCircle
} from 'lucide-react';
import { FirehoseRule, FirehoseEvent } from '../types';
import { firehoseService } from '../services/firehoseService';
import { modalResearchService } from '../services/nvidiaAiService';
import ConfirmationModal from './ConfirmationModal';

interface MonitoringProps {
  isDarkMode: boolean;
  userId: string;
  trades?: import('../types').Trade[];
  onViewChange: (view: string) => void;
  onNavigateToChat: (event: FirehoseEvent) => void;
}

const Monitoring: React.FC<MonitoringProps> = ({
  isDarkMode,
  userId,
  trades = [],
  onViewChange,
  onNavigateToChat,
}) => {
  const [rules, setRules] = useState<FirehoseRule[]>([]);
  const [events, setEvents] = useState<FirehoseEvent[]>([]);
  const [loadingRules, setLoadingRules] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<FirehoseEvent | null>(null);
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FirehoseRule | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<{ name: string; query: string }[]>([]);

  const loadData = useCallback(async () => {
    try {
      const [loadedRules, loadedEvents] = await Promise.all([
        firehoseService.getRules(userId),
        firehoseService.getEvents(userId),
      ]);
      setRules(loadedRules);
      setEvents(loadedEvents);
    } catch (err) {
      console.error('Failed to load Firehose data:', err);
    } finally {
      setLoadingRules(false);
      setLoadingEvents(false);
    }
  }, [userId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleToggle = async (rule: FirehoseRule) => {
    const newActive = !rule.active;
    setRules(prev => prev.map(r => r.id === rule.id ? { ...r, active: newActive } : r));
    try {
      await firehoseService.toggleRule(rule.id, newActive);
    } catch {
      setRules(prev => prev.map(r => r.id === rule.id ? { ...r, active: rule.active } : r));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setRules(prev => prev.filter(r => r.id !== target.id));
    try {
      await firehoseService.deleteRule(target.id);
    } catch {
      setRules(prev => [...prev, target]);
    }
  };

  const handleSuggestRules = async () => {
    setSuggesting(true);
    setSuggestions([]);
    try {
      const openTrades = trades.filter(t => !t.exitPrice);
      const watchedSymbols = [...new Set(trades.map(t => t.pair))].slice(0, 10);
      const portfolioContext = JSON.stringify({
        openTrades: openTrades.map(t => ({ pair: t.pair, direction: t.direction })),
        watchedSymbols,
        totalTrades: trades.length,
      });

      const result = await modalResearchService.generateResponse(
        `You are a market monitoring rule generator. Based on this trader's portfolio, suggest 2-3 Firehose monitoring rules (Lucene queries) that would help them track relevant financial news.

Portfolio: ${portfolioContext}

For each rule, provide:
- A short name (e.g. "ZAR News", "Gold Prices")
- A Lucene query targeting financial news (use page_category:"/News" AND language:"en")

Format each rule as:
[Rule: Name | query]

Only output the rules, nothing else.`,
        [],
        null,
        [],
        null,
        false,
        [],
        'deepseek',
        false
      );

      const parsedSuggestions = parseRuleSuggestions(result);
      setSuggestions(parsedSuggestions);
    } catch (err) {
      console.error('Failed to suggest rules:', err);
    } finally {
      setSuggesting(false);
    }
  };

  const handleApproveSuggestion = async (suggestion: { name: string; query: string }, index: number) => {
    try {
      const newRule = await firehoseService.createRule(userId, suggestion.name, suggestion.query, 'ai');
      setRules(prev => [newRule, ...prev]);
      setSuggestions(prev => prev.filter((_, i) => i !== index));
    } catch (err) {
      console.error('Failed to create rule:', err);
    }
  };

  const handleEventClick = async (event: FirehoseEvent) => {
    setSelectedEvent(event);
    if (!event.seen) {
      setEvents(prev => prev.map(e => e.id === event.id ? { ...e, seen: true } : e));
      await firehoseService.markEventSeen(event.id).catch(() => {});
    }
  };

  const handleAskAI = (event: FirehoseEvent) => {
    setSelectedEvent(null);
    onNavigateToChat(event);
  };

  const toggleQueryExpand = (ruleId: string) => {
    setExpandedRuleId(prev => prev === ruleId ? null : ruleId);
  };

  const bg = isDarkMode ? 'bg-[#09090b]' : 'bg-[#F8FAFC]';
  const text = isDarkMode ? 'text-zinc-200' : 'text-slate-900';
  const muted = isDarkMode ? 'text-zinc-500' : 'text-slate-500';
  const cardBg = isDarkMode ? 'bg-[#18181b] border-[#27272a]' : 'bg-white border-slate-100';
  const inputBg = isDarkMode ? 'bg-[#18181b] border-[#27272a]' : 'bg-white border-slate-200';

  return (
    <div className={`w-full h-full overflow-hidden flex flex-col font-sans ${bg} ${text}`}>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Radio className="text-[#FF4F01]" size={22} />
              <h1 className="text-xl font-bold">Market Monitoring</h1>
            </div>
            <p className={`text-sm ${muted}`}>
              Monitor financial news in real-time using Firehose. Rules poll every 60 seconds.
            </p>
          </div>

          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className={`text-sm font-semibold uppercase tracking-wider ${muted}`}>
                Rules ({rules.length})
              </h2>
              <button
                onClick={handleSuggestRules}
                disabled={suggesting}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                  ${isDarkMode
                    ? 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  } disabled:opacity-50`}
              >
                <Sparkles size={14} />
                {suggesting ? 'Suggesting...' : 'AI Suggest Rules'}
              </button>
            </div>

            {suggestions.length > 0 && (
              <div className={`mb-3 p-3 rounded-xl border ${isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-amber-50 border-amber-200'}`}>
                <p className={`text-xs font-medium mb-2 ${isDarkMode ? 'text-zinc-400' : 'text-amber-800'}`}>
                  AI-suggested rules based on your portfolio:
                </p>
                <div className="space-y-2">
                  {suggestions.map((s, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${text}`}>{s.name}</p>
                        <p className={`text-xs truncate ${muted}`}>{s.query}</p>
                      </div>
                      <button
                        onClick={() => handleApproveSuggestion(s, i)}
                        className="shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium bg-[#FF4F01] text-white hover:bg-[#E04500]"
                      >
                        Add
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {loadingRules ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="animate-spin text-zinc-500" size={20} />
              </div>
            ) : rules.length === 0 ? (
              <div className={`p-6 rounded-xl border text-center ${cardBg}`}>
                <Radio className={`mx-auto mb-2 ${muted}`} size={24} />
                <p className={`text-sm ${muted}`}>No monitoring rules yet.</p>
                <p className={`text-xs ${muted} mt-1`}>
                  Click "AI Suggest Rules" to generate rules from your trades, or create one manually.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {rules.map(rule => (
                  <div key={rule.id} className={`p-3 rounded-xl border ${cardBg}`}>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleToggle(rule)}
                        className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-lg transition-colors
                          ${rule.active
                            ? 'bg-emerald-500/20 text-emerald-500'
                            : isDarkMode ? 'bg-zinc-800 text-zinc-600' : 'bg-slate-200 text-slate-400'
                          }`}
                      >
                        {rule.active ? <Bell size={15} /> : <BellOff size={15} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{rule.name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${rule.createdBy === 'ai' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'}`}>
                            {rule.createdBy === 'ai' ? 'AI' : 'Manual'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <code className={`text-[11px] font-mono truncate max-w-[260px] ${muted}`}>
                            {rule.luceneQuery}
                          </code>
                          <button
                            onClick={() => toggleQueryExpand(rule.id)}
                            className={`shrink-0 ${muted} hover:text-zinc-300`}
                          >
                            {expandedRuleId === rule.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          </button>
                        </div>
                        {expandedRuleId === rule.id && (
                          <pre className={`mt-1 p-2 rounded-lg text-[11px] font-mono overflow-x-auto ${isDarkMode ? 'bg-black/40 text-zinc-400' : 'bg-slate-100 text-slate-600'}`}>
                            {rule.luceneQuery}
                          </pre>
                        )}
                      </div>
                      <button
                        onClick={() => setDeleteTarget(rule)}
                        className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-lg ${isDarkMode ? 'text-zinc-600 hover:text-rose-400 hover:bg-rose-500/10' : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    {rule.lastEventAt && (
                      <div className={`flex items-center gap-1 mt-2 text-[10px] ${muted}`}>
                        <Clock size={10} />
                        Last event: {new Date(rule.lastEventAt).toLocaleString()}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className={`text-sm font-semibold uppercase tracking-wider mb-3 ${muted}`}>
              Events ({events.length})
            </h2>

            {loadingEvents ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="animate-spin text-zinc-500" size={20} />
              </div>
            ) : events.length === 0 ? (
              <div className={`p-6 rounded-xl border text-center ${cardBg}`}>
                <Globe className={`mx-auto mb-2 ${muted}`} size={24} />
                <p className={`text-sm ${muted}`}>No events yet.</p>
                <p className={`text-xs ${muted} mt-1`}>
                  Events will appear here once your active rules detect matching content.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {events.map(event => (
                  <button
                    key={event.id}
                    onClick={() => handleEventClick(event)}
                    className={`w-full text-left p-3 rounded-xl border transition-colors ${cardBg}
                      ${!event.seen
                        ? (isDarkMode ? 'border-zinc-600' : 'border-amber-300')
                        : ''
                      }
                      hover:${isDarkMode ? 'bg-zinc-800' : 'bg-slate-50'}
                    `}
                  >
                    <div className="flex items-start gap-3">
                      {!event.seen && (
                        <div className="shrink-0 mt-1.5 w-2 h-2 rounded-full bg-[#FF4F01]" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${!event.seen ? text : muted}`}>
                          {event.title}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          {event.source && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${isDarkMode ? 'bg-zinc-800 text-zinc-400' : 'bg-slate-100 text-slate-500'}`}>
                              {event.source}
                            </span>
                          )}
                          {event.publishedAt && (
                            <span className={`text-[10px] ${muted}`}>
                              {new Date(event.publishedAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                      <ExternalLink size={14} className={`shrink-0 mt-1 ${muted}`} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {selectedEvent && (
        <div className="fixed inset-0 z-[150] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSelectedEvent(null)} />
          <div className={`relative w-full sm:max-w-lg max-h-[80vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border shadow-2xl ${cardBg} ${text}`}>
            <div className="sticky top-0 flex items-center justify-between p-4 border-b border-inherit bg-inherit">
              <h3 className="text-sm font-semibold">Event Details</h3>
              <button onClick={() => setSelectedEvent(null)} className={`p-1 rounded-lg ${muted} hover:text-zinc-300`}>
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <p className="text-sm font-medium">{selectedEvent.title}</p>
                {selectedEvent.source && (
                  <p className={`text-xs ${muted} mt-1`}>Source: {selectedEvent.source}</p>
                )}
              </div>
              {selectedEvent.summary && (
                <div>
                  <p className={`text-xs font-medium uppercase tracking-wider ${muted} mb-1`}>Summary</p>
                  <p className="text-sm leading-relaxed">{selectedEvent.summary}</p>
                </div>
              )}
              {selectedEvent.publishedAt && (
                <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <Clock size={12} />
                  {new Date(selectedEvent.publishedAt).toLocaleString()}
                </div>
              )}
              <div className="flex gap-2">
                <a
                  href={selectedEvent.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium
                    ${isDarkMode ? 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                >
                  <ExternalLink size={12} />
                  Open Source
                </a>
                <button
                  onClick={() => handleAskAI(selectedEvent)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[#FF4F01] text-white hover:bg-[#E04500]"
                >
                  <MessageSquare size={12} />
                  Ask AI about this
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={!!deleteTarget}
        title="Delete Rule"
        description={`Remove "${deleteTarget?.name}" and all its events?`}
        confirmText="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        isDarkMode={isDarkMode}
      />
    </div>
  );
};

function parseRuleSuggestions(text: string): { name: string; query: string }[] {
  const results: { name: string; query: string }[] = [];
  const regex = /\[Rule:\s*(.+?)\s*\|\s*(.+?)\s*\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    results.push({ name: match[1].trim(), query: match[2].trim() });
  }
  return results;
}

export default Monitoring;
