import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trade, UserProfile, DailyBias, EASession, Note, Goal } from '../types';
import { modalResearchService, ModalModelType, getAssistantMode, AssistantContextSummary, describeAiError } from '../services/nvidiaAiService';
import { browserSpeechService } from '../services/voiceInputService';
import { calculateStats } from '../lib/statsUtils';
import { buildAnalyticsAiSnapshot } from '../lib/analyticsAiSnapshot';
import { normalizeAssistantMarkdown, stripAssistantWidgetMarkup } from '../lib/aiChatFormatting';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { cleanAssistantResponse, cleanThinkingTags } from '../lib/thinkingCleaner';
import { TrendingUp, TrendingDown, Brain, Clock, Coins, ChevronDown, X, Plus, Workflow, StickyNote, Activity, Sparkles, Target, Mic, RotateCcw, LayoutGrid, Copy, ThumbsUp, ThumbsDown, CornerDownLeft, Zap, AlertCircle, Check, Loader2, StopCircle, ArrowLeft, ArrowRight, ListChecks, BarChart3, Clock3, BrainCircuit, Timer, CircleDot, Goal as GoalIcon, Pause, Play, Settings, Telescope } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useToast } from './ui/Toast';
import GenerativeMessage, { type GenUiNavTarget } from '../lib/openui/GenerativeMessage';
import { extractGenerativeParts } from '../lib/openui/detect';
import { GEN_UI } from '../lib/openui/flag';

// Paid data proxies (/api/fmp, /api/finnhub) require an authenticated Supabase
// session server-side; attach the access token so logged-in users keep working.
// Native-safe: prefix relative /api/* with the hosted backend URL inside the
// Capacitor APK (no local backend there) via apiUrl().
const authedFetch = async (url: string): Promise<Response> => {
  const { apiUrl } = await import('../lib/capacitor');
  const finalUrl = url.startsWith('/') ? apiUrl(url) : url;
  try {
    const { getSessionToken } = await import('../lib/supabase');
    const token = await getSessionToken();
    return await fetch(finalUrl, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  } catch {
    return fetch(finalUrl);
  }
};

// --- Utilities ---
const DAILY_CREDIT_MAX = 10;
// Longest single message accepted. Keeps payloads far below the proxy's
// 512KB cap and bounds model latency for everyone sharing the quota.
const MAX_INPUT_CHARS = 6000;
// Cap persisted history so power users can never blow the localStorage quota.
const MAX_STORED_MESSAGES = 150;

type DailyCreditState = {
  date: string;
  researchRemaining: number;
  mentorRemaining: number;
};

const getLocalDateKey = (date = new Date()) => (
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
);

const createDailyCreditState = (date = getLocalDateKey()): DailyCreditState => ({
  date,
  researchRemaining: DAILY_CREDIT_MAX,
  mentorRemaining: DAILY_CREDIT_MAX,
});

const formatSignedCurrency = (value: number, symbol: string) => (
  `${value < 0 ? '-' : ''}${symbol}${Math.abs(value).toFixed(2)}`
);

type StructuredWidget =
  | {
      kind: 'mermaid';
      title: string;
      type: string;
      raw: string;
      body: string;
    };

type StructuredBlock =
  | { type: 'text'; content: string }
  | { type: 'widget'; widget: StructuredWidget };

const WIDGET_OPEN_REGEX = /\[WIDGET:(MERMAID)(?::([^\]]+))?\]/g;
const WIDGET_CLOSE_REGEX = /\[\/WIDGET:(MERMAID)\]|\[\/WIDGET\]/g;

const findWidgetCloseIndex = (text: string, kind: string, fromIndex: number) => {
  WIDGET_CLOSE_REGEX.lastIndex = fromIndex;
  let match: RegExpExecArray | null;

  while ((match = WIDGET_CLOSE_REGEX.exec(text)) !== null) {
    const matchedKind = match[1];
    if (!matchedKind || matchedKind === kind) {
      return {
        closeStart: match.index,
        closeEnd: WIDGET_CLOSE_REGEX.lastIndex,
      };
    }
  }

  return null;
};

export const parseStructuredBlocks = (text: string): StructuredBlock[] => {
  const blocks: StructuredBlock[] = [];
  WIDGET_OPEN_REGEX.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = WIDGET_OPEN_REGEX.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    if (before) {
      blocks.push({ type: 'text', content: before });
    }

    const kind = match[1];
    const meta = (match[2] || '').trim();
    const bodyStart = WIDGET_OPEN_REGEX.lastIndex;
    const closeMatch = findWidgetCloseIndex(text, kind, bodyStart);
    const closeStart = closeMatch?.closeStart ?? text.length;
    const closeEnd = closeMatch?.closeEnd ?? text.length;
    const body = text
      .slice(bodyStart, closeStart)
      .replace(/\[\/WIDGET(?::(?:CHECKLIST|MERMAID))?\]\s*$/i, '')
      .trim();

    blocks.push({
      type: 'widget',
      widget: {
        kind: 'mermaid',
        title: meta || 'Flowchart',
        type: meta || 'FLOWCHART',
        body,
        raw: text.slice(match.index, closeEnd),
      },
    });

    lastIndex = closeEnd;
    WIDGET_OPEN_REGEX.lastIndex = closeEnd;
  }

  const after = text.slice(lastIndex);
  if (after) {
    blocks.push({ type: 'text', content: after });
  }

  return blocks.length > 0 ? blocks : [{ type: 'text', content: text }];
};

export const stripStructuredBlocks = (text: string) => parseStructuredBlocks(text)
  .filter((block): block is Extract<StructuredBlock, { type: 'text' }> => block.type === 'text')
  .map((block) => block.content)
  .join('')
  .replace(/\[SECTION:[A-Z_]+\]/g, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const isPairPerformanceQuestion = (input: string) => {
  const normalized = input.toLowerCase();
  return (
    normalized.includes('biggest losing pair') ||
    normalized.includes('biggest lossing pair') ||
    normalized.includes('worst pair') ||
    normalized.includes('losing pair') ||
    normalized.includes('best pair') ||
    normalized.includes('winning pair') ||
    normalized.includes('most profitable pair') ||
    normalized.includes('least profitable pair')
  );
};

const buildPairPerformanceAnswer = (input: string, trades: Trade[], userProfile: UserProfile | null) => {
  const stats = calculateStats(trades);
  const normalized = input.toLowerCase();
  const wantsBoth =
    normalized.includes('best pair') &&
    (
      normalized.includes('worst pair') ||
      normalized.includes('lowest pair') ||
      normalized.includes('losing pair')
    );
  const wantsBestPair =
    normalized.includes('best pair') ||
    normalized.includes('winning pair') ||
    normalized.includes('most profitable pair');

  const formatPairLine = (label: string, pair: { symbol: string; pnl: number } | null) => {
    if (!pair) return `**${label}:** I don't have enough trade data yet.`;

    const pairTrades = trades.filter((trade) => trade.pair.toUpperCase() === pair.symbol);
    const wins = pairTrades.filter((trade) => trade.result === 'Win').length;
    const winRate = pairTrades.length > 0 ? (wins / pairTrades.length) * 100 : 0;
    const currency = userProfile?.currencySymbol || '$';

    return `**${label}:** **${pair.symbol}** with ${formatSignedCurrency(pair.pnl, currency)} P&L across ${pairTrades.length} trade${pairTrades.length === 1 ? '' : 's'} (${winRate.toFixed(1)}% win rate)`;
  };

  if (wantsBoth) {
    return [
      formatPairLine('Best pair', stats.bestPair),
      formatPairLine('Worst pair', stats.worstPair),
    ].join('\n\n');
  }

  const selectedPair = wantsBestPair ? stats.bestPair : stats.worstPair;
  if (!selectedPair) {
    return "I don't have enough trade data to identify a pair yet.";
  }

  const symbol = selectedPair.symbol;
  const pairTrades = trades.filter((trade) => trade.pair.toUpperCase() === symbol);
  const wins = pairTrades.filter((trade) => trade.result === 'Win').length;
  const pairWinRate = pairTrades.length > 0 ? (wins / pairTrades.length) * 100 : 0;
  const currency = userProfile?.currencySymbol || '$';
  const pnl = selectedPair.pnl;
  const label = wantsBestPair ? 'best pair' : 'biggest losing pair';

  return `**${symbol}** is your ${label} with ${formatSignedCurrency(pnl, currency)} P&L across ${pairTrades.length} trade${pairTrades.length === 1 ? '' : 's'} (${pairWinRate.toFixed(1)}% win rate).`;
};

// --- Types ---
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  audioAttachment?: {
    url: string;
    durationMs: number;
    mimeType: string;
    deviceLabel?: string;
  };
  sections?: Record<string, string>;
  isStreaming?: boolean;
  isDeepAnalysis?: boolean;
  kind?: 'chat' | 'analysis' | 'strategy' | 'psychology' | 'scaling' | 'trading-plan';
  strategyProfile?: {
    tradingStyle: string;
    goals: string;
    riskTolerance: string;
    challenges: string[];
    timeCommitment: string;
    experience: string;
    preferredPairs: string[];
    markets: string[];
    analysisTimeframe: string;
    entryTimeframe: string;
    tradingSessions: string[];
    dailyTradeLimit: string;
    exitMechanics: string;
    tradeManagement: string;
    profitTarget: string;
    lossCap: string;
    whyITrade: string;
  };
  psychologySnapshot?: {
    topEmotion: string;
    worstEmotion: string;
    noPlanTrades: number;
    followPlanTrades: number;
    recentLosses: number;
    totalTrades: number;
  };
  scalingSnapshot?: {
    balance: string;
    netProfit: string;
    winRate: string;
    profitFactor: string;
    avgWin: string;
    avgLoss: string;
    riskPerTrade: string;
    bestPair: string;
  };
  contextSummary?: AssistantContextSummary;
}

interface VoiceClipAttachment {
  blob: Blob;
  url: string;
  durationMs: number;
  mimeType: string;
  deviceLabel?: string;
}

// Audio attachments live only in memory (blob object URLs). They are stripped
// before persisting so base64 audio can never blow the localStorage quota.
const stripAudioForStorage = (messages: Message[]): Message[] =>
  messages.map(({ audioAttachment: _audio, ...rest }) => rest as Message);

const reviveStoredMessages = (stored: Message[] = []): Message[] =>
  stored.map((m) => ({ ...m, timestamp: new Date(m.timestamp) }));

const useSessionMessages = (storageKey: string): [Message[], React.Dispatch<React.SetStateAction<Message[]>>] => {
  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? reviveStoredMessages(JSON.parse(raw)) : [];
    } catch (error) {
      console.warn(`Error reading chat history key "${storageKey}":`, error);
      return [];
    }
  });

  useEffect(() => {
    try {
      const capped = stripAudioForStorage(messages);
      window.localStorage.setItem(
        storageKey,
        JSON.stringify(capped.length > MAX_STORED_MESSAGES ? capped.slice(-MAX_STORED_MESSAGES) : capped)
      );
    } catch (error) {
      console.warn(`Error saving chat history key "${storageKey}":`, error);
    }
  }, [storageKey, messages]);

  return [messages, setMessages];
};

const formatAudioDuration = (durationMs: number) => {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const VoiceWaveform = ({ bars, isDarkMode, active }: { bars: number[]; isDarkMode: boolean; active: boolean }) => (
  <div className="flex h-10 items-end gap-1" aria-hidden="true">
    {bars.map((bar, index) => (
      <motion.div
        key={`${index}-${bar}`}
        animate={{ height: `${Math.max(18, bar * 100)}%`, opacity: active ? 1 : 0.45 }}
        transition={{ duration: 0.12, ease: 'easeOut' }}
        className={`w-1.5 rounded-full ${isDarkMode ? 'bg-emerald-400/90' : 'bg-emerald-500/85'}`}
      />
    ))}
  </div>
);

const VoiceAudioPlayer = ({
  src,
  durationMs,
  isDarkMode,
  compact = false,
}: {
  src: string;
  durationMs: number;
  isDarkMode: boolean;
  compact?: boolean;
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [loadedDuration, setLoadedDuration] = useState(durationMs / 1000);
  const totalSeconds = Math.max(durationMs / 1000, 0.1);
  const resolvedDuration = Math.max(loadedDuration || 0, totalSeconds);
  const progress = Math.min(100, (currentTime / resolvedDuration) * 100);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.pause();
    audio.currentTime = 0;
    audio.load();
    setIsPlaying(false);
    setCurrentTime(0);
    setLoadedDuration(durationMs / 1000);
  }, [src, durationMs]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime || 0);
    const handleLoadedMetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setLoadedDuration(audio.duration);
      }
    };
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      audio.currentTime = 0;
    };
    const handlePause = () => setIsPlaying(false);
    const handlePlay = () => setIsPlaying(true);

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('play', handlePlay);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('play', handlePlay);
    };
  }, [src, durationMs]);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      try {
        audio.muted = false;
        audio.volume = 1;
        await audio.play();
      } catch (error) {
        console.error('Voice audio playback failed:', error);
      }
      return;
    }

    audio.pause();
  };

  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;

    const nextTime = Number(event.target.value);
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  return (
    <div className={`rounded-xl border px-2 py-1.5 ${isDarkMode ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white/80'}`}>
      <audio ref={audioRef} preload="metadata" playsInline className="hidden" src={src} />
      <div className={`flex items-center gap-2.5 ${compact ? 'min-w-[190px]' : ''}`}>
        <button
          type="button"
          onClick={togglePlayback}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors ${
            isDarkMode ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
          }`}
          title={isPlaying ? 'Pause audio' : 'Play audio'}
        >
          {isPlaying ? <Pause size={13} /> : <Play size={13} className="ml-0.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center justify-between gap-2">
            <span className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
              {isPlaying ? 'Playing' : 'Preview'}
            </span>
            <span className={`text-[11px] tabular-nums ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
              {formatAudioDuration(currentTime * 1000)} / {formatAudioDuration(resolvedDuration * 1000)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={resolvedDuration}
            step={0.01}
            value={Math.min(currentTime, resolvedDuration)}
            onChange={handleSeek}
            aria-label="Seek audio"
            className="h-1 w-full cursor-pointer accent-emerald-500"
            style={{
              background: `linear-gradient(to right, rgb(16 185 129) 0%, rgb(16 185 129) ${progress}%, ${isDarkMode ? 'rgb(63 63 70)' : 'rgb(226 232 240)'} ${progress}%, ${isDarkMode ? 'rgb(63 63 70)' : 'rgb(226 232 240)'} 100%)`,
            }}
          />
        </div>
      </div>
    </div>
  );
};

interface AIChatProps {
  isDarkMode: boolean;
  trades: Trade[];
  userProfile: UserProfile | null;
  dailyBias?: DailyBias[];
  eaSession?: EASession | null;
  lastKnownBridgeBalance?: import('../lib/bridgeBalance').StoredBridgeBalance | number | null;
  isBridgeOnline?: boolean;
  notes?: Note[];
  goals?: Goal[];
  onAddNote?: (note: Note) => Promise<Note | undefined>;
  onOpenSettings?: () => void;
  onBackToHome?: () => void;
  /** In-app navigation for buttons inside AI-generated UI. Never trades. */
  onNavigate?: (target: GenUiNavTarget, tradeId?: string) => void;
}

const STRATEGY_SECTION_ORDER = ['IDENTITY', 'MARKET_SELECTION', 'CORE_EDGE', 'RISK', 'STRATEGY_RULES', 'EXECUTION_FLOW', 'EXIT_PROTOCOL', 'ROUTINE', 'REVIEW'];
const PSYCHOLOGY_SECTION_ORDER = ['STATE_READ', 'TRIGGERS', 'RESET_PROTOCOL', 'ROUTINE', 'TARGETS'];
const SCALING_SECTION_ORDER = ['BASELINE', 'RISK_LIMITS', 'SCALING_ROADMAP', 'CAPITAL_RULES', 'TARGETS'];

const STRATEGY_SECTION_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string; borderColor: string; label: string }> = {
  IDENTITY: { icon: <Target size={16} />, color: 'text-amber-400', bg: 'bg-amber-500/10', borderColor: 'border-amber-500/20', label: 'Goals & Identity' },
  MARKET_SELECTION: { icon: <LayoutGrid size={16} />, color: 'text-blue-400', bg: 'bg-blue-500/10', borderColor: 'border-blue-500/20', label: 'Market Selection' },
  CORE_EDGE: { icon: <Activity size={16} />, color: 'text-emerald-400', bg: 'bg-emerald-500/10', borderColor: 'border-emerald-500/20', label: 'Core Edge' },
  RISK: { icon: <AlertCircle size={16} />, color: 'text-rose-400', bg: 'bg-rose-500/10', borderColor: 'border-rose-500/20', label: 'Risk Rules' },
  STRATEGY_RULES: { icon: <Workflow size={16} />, color: 'text-indigo-400', bg: 'bg-indigo-500/10', borderColor: 'border-indigo-500/20', label: 'Strategic Rules' },
  EXECUTION_FLOW: { icon: <Zap size={16} />, color: 'text-cyan-400', bg: 'bg-cyan-500/10', borderColor: 'border-cyan-500/20', label: 'Execution Flow' },
  EXIT_PROTOCOL: { icon: <Timer size={16} />, color: 'text-orange-400', bg: 'bg-orange-500/10', borderColor: 'border-orange-500/20', label: 'Exit Management' },
  ROUTINE: { icon: <Clock3 size={16} />, color: 'text-violet-400', bg: 'bg-violet-500/10', borderColor: 'border-violet-500/20', label: 'Trading Routine' },
  REVIEW: { icon: <BarChart3 size={16} />, color: 'text-zinc-400', bg: 'bg-zinc-500/10', borderColor: 'border-zinc-500/20', label: 'Weekly Review' }
};
const PSYCHOLOGY_SECTION_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string; borderColor: string; label: string }> = {
  STATE_READ: { icon: <Brain size={16} />, color: 'text-rose-400', bg: 'bg-rose-500/10', borderColor: 'border-rose-500/20', label: 'State Read' },
  TRIGGERS: { icon: <AlertCircle size={16} />, color: 'text-orange-400', bg: 'bg-orange-500/10', borderColor: 'border-orange-500/20', label: 'Triggers' },
  RESET_PROTOCOL: { icon: <RotateCcw size={16} />, color: 'text-indigo-400', bg: 'bg-indigo-500/10', borderColor: 'border-indigo-500/20', label: 'Reset Protocol' },
  ROUTINE: { icon: <Clock3 size={16} />, color: 'text-emerald-400', bg: 'bg-emerald-500/10', borderColor: 'border-emerald-500/20', label: 'Routine' },
  TARGETS: { icon: <Target size={16} />, color: 'text-pink-400', bg: 'bg-pink-500/10', borderColor: 'border-pink-500/20', label: 'Targets' }
};
const SCALING_SECTION_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string; borderColor: string; label: string }> = {
  BASELINE: { icon: <BarChart3 size={16} />, color: 'text-cyan-400', bg: 'bg-cyan-500/10', borderColor: 'border-cyan-500/20', label: 'Baseline' },
  RISK_LIMITS: { icon: <AlertCircle size={16} />, color: 'text-rose-400', bg: 'bg-rose-500/10', borderColor: 'border-rose-500/20', label: 'Risk Limits' },
  SCALING_ROADMAP: { icon: <TrendingUp size={16} />, color: 'text-amber-400', bg: 'bg-amber-500/10', borderColor: 'border-amber-500/20', label: 'Scaling Roadmap' },
  CAPITAL_RULES: { icon: <Coins size={16} />, color: 'text-emerald-400', bg: 'bg-emerald-500/10', borderColor: 'border-emerald-500/20', label: 'Capital Rules' },
  TARGETS: { icon: <Target size={16} />, color: 'text-indigo-400', bg: 'bg-indigo-500/10', borderColor: 'border-indigo-500/20', label: 'Targets' }
};

const ANALYSIS_SECTION_ORDER = ['SNAPSHOT', 'EDGE', 'LEAKS', 'PLAYBOOK', 'TARGETS'];

const ANALYSIS_SECTION_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string; borderColor: string; label: string }> = {
  SNAPSHOT: { icon: <Activity size={16} />, color: 'text-cyan-400', bg: 'bg-cyan-500/10', borderColor: 'border-cyan-500/20', label: 'Performance Snapshot' },
  EDGE: { icon: <TrendingUp size={16} />, color: 'text-emerald-400', bg: 'bg-emerald-500/10', borderColor: 'border-emerald-500/20', label: 'Current Edge' },
  LEAKS: { icon: <AlertCircle size={16} />, color: 'text-rose-400', bg: 'bg-rose-500/10', borderColor: 'border-rose-500/20', label: 'Primary Leaks' },
  PLAYBOOK: { icon: <Workflow size={16} />, color: 'text-indigo-400', bg: 'bg-indigo-500/10', borderColor: 'border-indigo-500/20', label: 'Fix Plan' },
  TARGETS: { icon: <Target size={16} />, color: 'text-amber-400', bg: 'bg-amber-500/10', borderColor: 'border-amber-500/20', label: '30-Day Targets' },
  LACKS: { icon: <AlertCircle size={16} />, color: 'text-rose-400', bg: 'bg-rose-500/10', borderColor: 'border-rose-500/20', label: 'Weaknesses' },
  RECOMMENDATIONS: { icon: <Sparkles size={16} />, color: 'text-indigo-400', bg: 'bg-indigo-500/10', borderColor: 'border-indigo-500/20', label: 'Strategic Fixes' },
};

interface MessageRowProps {
  message: Message;
  isDarkMode: boolean;
  userProfile: UserProfile | null;
  renderMessageContent: (message: Message) => React.ReactNode;
  renderSectionCards: (sections: Record<string, string>, message: Message) => React.ReactNode;
  assistantIcon: React.ElementType;
  onSaveAsNote?: (message: Message) => Promise<void>;
}

const MessageRow = React.memo(({ message, isDarkMode, userProfile, renderMessageContent, renderSectionCards, assistantIcon: AssistantIcon, onSaveAsNote }: MessageRowProps) => {
  const [copied, setCopied] = useState(false);
  const [savedAsNote, setSavedAsNote] = useState(false);
  const isUser = message.role === 'user';
  const isCompactAudioMessage = isUser && Boolean(message.audioAttachment) && (!message.content || message.content === '[Voice recording]');
  const isMarketDataAssistantMessage = !isUser && /^## .+ — (Stock Quote|Company Profile|Key Metrics|Ratios & Growth|Price Change|DCF Valuation|Financial Statements|Insider Transactions|Analyst Recommendations|Earnings Surprises|Recent News)/.test(message.content || '');
  const modeLabel = message.contextSummary?.mode === 'research' ? 'Public research' : 'Journal data';

  const handleCopy = () => {
    const cleanContentText = stripStructuredBlocks(message.content || '').trim();
    navigator.clipboard?.writeText(cleanContentText).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveAsNote = async () => {
    if (!onSaveAsNote) return;
    await onSaveAsNote(message);
    setSavedAsNote(true);
    window.setTimeout(() => setSavedAsNote(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={`group flex w-full px-4 py-2 hover:bg-zinc-50/50 dark:hover:bg-white/5 transition-colors ${isUser ? 'bg-zinc-100 dark:bg-[#0a0a0a]' : ''}`}
    >
      <div className="flex gap-4 max-w-4xl mx-auto w-full">
        {/* Avatar */}
        <div className={`shrink-0 mt-1 ${isUser ? 'order-2' : 'order-1'}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium ${
            isUser 
              ? isDarkMode ? 'bg-black' : 'bg-slate-300 text-slate-600'
              : 'bg-black dark:bg-black'
          }`}>
            {isUser ? (
              userProfile?.avatarUrl 
                ? <img src={userProfile.avatarUrl} className="w-full h-full object-cover rounded-full" alt="User" />
                : <span>{userProfile?.name?.charAt(0) || 'U'}</span>
            ) : (
              <AssistantIcon size={16} />
            )}
          </div>
        </div>

        {/* Message Content */}
        <div className={`flex-1 min-w-0 ${isUser ? 'order-1' : 'order-2'}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-sm font-medium ${isDarkMode ? 'text-zinc-300' : 'text-slate-900'}`}>
              {isUser ? (userProfile?.name || 'You') : 'JFX Architect'}
            </span>
            {!isUser && (
              <>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  isDarkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700'
                }`}>
                  AI
                </span>
                {!isUser && message.contextSummary && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      message.contextSummary.privateDataAllowed
                        ? isDarkMode ? 'bg-indigo-500/20 text-indigo-300' : 'bg-indigo-100 text-indigo-700'
                        : isDarkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-slate-100 text-slate-600'
                    }`}
                    title={message.contextSummary.promptScope}
                  >
                    {modeLabel}
                  </span>
                )}
                {!isUser && message.contextSummary?.fellBack && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      isDarkMode ? 'bg-amber-500/20 text-amber-300' : 'bg-amber-100 text-amber-700'
                    }`}
                    title={`Primary model unavailable — answered by backup model${message.contextSummary.modelUsed ? ` (${message.contextSummary.modelUsed})` : ''}.`}
                  >
                    BACKUP
                  </span>
                )}
                {message.kind === 'strategy' && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3 }}
                    className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      isDarkMode ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    STRATEGY PLAN
                  </motion.span>
                )}
                {message.kind === 'analysis' && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3 }}
                    className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      isDarkMode ? 'bg-cyan-500/20 text-cyan-400' : 'bg-cyan-100 text-cyan-700'
                    }`}
                  >
                    NEURAL AUDIT
                  </motion.span>
                )}
                {message.kind === 'psychology' && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3 }}
                    className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      isDarkMode ? 'bg-rose-500/20 text-rose-400' : 'bg-rose-100 text-rose-700'
                    }`}
                  >
                    PSYCHOLOGY
                  </motion.span>
                )}
                {message.kind === 'scaling' && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3 }}
                    className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      isDarkMode ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    SCALING
                  </motion.span>
                )}
                {isMarketDataAssistantMessage && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3 }}
                    className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      isDarkMode ? 'bg-cyan-500/20 text-cyan-400' : 'bg-cyan-100 text-cyan-700'
                    }`}
                  >
                    MARKET DATA
                  </motion.span>
                )}
                {message.isDeepAnalysis && message.kind !== 'strategy' && message.kind !== 'analysis' && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3 }}
                    className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      isDarkMode ? 'bg-indigo-500/20 text-indigo-400' : 'bg-indigo-100 text-indigo-700'
                    }`}
                  >
                    DEEP ANALYSIS
                  </motion.span>
                )}
              </>
            )}
          </div>
          
          {/* Message Body - ChatGPT Style */}
          <div className={`prose prose-sm max-w-none ${
            isUser 
              ? 'prose-invert' 
              : (isDarkMode ? 'prose-invert prose-invert:text-zinc-300' : 'text-slate-800')
          }`}>
            <div className={`rounded-2xl ${
              isCompactAudioMessage ? 'w-fit max-w-xs px-2 py-1.5 ml-auto' : 'px-4 py-3'
            } ${
              isUser 
                ? isDarkMode ? 'bg-black text-zinc-100' : 'bg-slate-200 text-slate-900'
                : isDarkMode ? 'bg-transparent text-zinc-200' : 'bg-transparent text-slate-800'
            } ${message.isDeepAnalysis && !isUser ? (isDarkMode ? 'border border-emerald-500/50 bg-emerald-900/10' : 'border border-emerald-300/50 bg-emerald-50') : ''}`}>
              {renderMessageContent(message)}
            </div>
          </div>

          {/* Section Cards for AI messages */}
          {message.sections && !isUser && (message.isDeepAnalysis || message.kind === 'strategy' || message.kind === 'psychology' || message.kind === 'scaling') && (
            <div className="mt-4">
              {renderSectionCards(message.sections, message)}
            </div>
          )}

          {/* Action Buttons - ChatGPT Style (dimmed by default on desktop so they stay reachable on touch) */}
          {!message.isStreaming && (
            <div
              className={`flex items-center gap-1 mt-2 -ml-2 transition-opacity opacity-70 focus-within:opacity-100 md:opacity-0 md:group-hover:opacity-100 ${isUser ? 'justify-start' : ''}`}
            >
              <button 
                onClick={handleCopy}
                className={`p-1.5 rounded-lg transition-colors ${
                  isDarkMode ? 'hover:bg-black text-zinc-400' : 'hover:bg-slate-200 text-slate-500'
                }`}
                title="Copy"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
              {!isUser && (
                <>
                  <button 
                    className={`p-1.5 rounded-lg transition-colors ${
                      isDarkMode ? 'hover:bg-black text-zinc-400' : 'hover:bg-slate-200 text-slate-500'
                    }`}
                    title="Good response"
                  >
                    <ThumbsUp size={14} />
                  </button>
                  <button 
                    className={`p-1.5 rounded-lg transition-colors ${
                      isDarkMode ? 'hover:bg-black text-zinc-400' : 'hover:bg-slate-200 text-slate-500'
                    }`}
                    title="Bad response"
                  >
                    <ThumbsDown size={14} />
                  </button>
                  {onSaveAsNote && (
                    <button
                      onClick={handleSaveAsNote}
                      className={`p-1.5 rounded-lg transition-colors ${
                        isDarkMode ? 'hover:bg-black text-zinc-400' : 'hover:bg-slate-200 text-slate-500'
                      }`}
                      title="Save as note"
                    >
                      {savedAsNote ? <Check size={14} /> : <StickyNote size={14} />}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
});
MessageRow.displayName = 'MessageRow';

interface WizardData {
  tradingStyle: string;
  goals: string;
  riskTolerance: string;
  challenges: string[];
  timeCommitment: string;
  experience: string;
  preferredPairs: string[];
  markets: string[];
  analysisTimeframe: string;
  entryTimeframe: string;
  tradingSessions: string[];
  dailyTradeLimit: string;
  exitMechanics: string;
  tradeManagement: string;
  profitTarget: string;
  lossCap: string;
  whyITrade: string;
}

interface ChallengeOption {
  id: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
}

interface ChallengesStepProps {
  isDarkMode: boolean;
  data: WizardData;
  challengeOptions: ChallengeOption[];
  onChange: (update: Partial<Pick<WizardData, 'challenges'>>) => void;
}

/**
 * Scroll ONLY the chat's own message list to the end.
 * Never use element.scrollIntoView() here: it also scrolls every ancestor —
 * including overflow-hidden ones and the page itself — which pushed the
 * header (Research / Mentor toggles) off the top of the screen on mobile web.
 */
export function scrollMessagesToEnd(end: HTMLElement | null, behavior: ScrollBehavior = 'smooth') {
  if (!end) return;
  let el: HTMLElement | null = end.parentElement;
  while (el) {
    const oy = window.getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) break;
    el = el.parentElement;
  }
  if (el) el.scrollTo({ top: el.scrollHeight, behavior });
}

interface ResearchPrompt {
  title: string;
  icon: React.ReactNode;
  prompt: string;
  color: string;
  desc: string;
}

const ChallengesStep = ({ isDarkMode, data, challengeOptions, onChange }: ChallengesStepProps) => (
  <div className="space-y-6">
    <div className="text-center">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center mx-auto mb-4">
        <Brain size={32} className="text-white" />
      </div>
      <h2 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Core Challenges</h2>
      <p className={`mt-2 ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Select the issues that affect your trading most.</p>
    </div>

    <div className="grid sm:grid-cols-2 gap-3">
      {challengeOptions.map((option) => {
        const active = data.challenges.includes(option.id);
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => {
              const next = active
                ? data.challenges.filter((challenge) => challenge !== option.id)
                : [...data.challenges, option.id];
              onChange({ challenges: next });
            }}
            className={`rounded-2xl border p-4 text-left transition-all ${
              active
                ? 'border-rose-500 bg-rose-500/10'
                : isDarkMode
                  ? 'border-zinc-800 bg-black/50 hover:border-zinc-700'
                  : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 rounded-xl p-2 ${active ? 'bg-rose-500/15 text-rose-500' : isDarkMode ? 'bg-black text-zinc-300' : 'bg-slate-100 text-slate-600'}`}>
                {option.icon}
              </div>
              <div className="min-w-0">
                <div className={`text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{option.label}</div>
                <div className={`mt-1 text-xs leading-relaxed ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>{option.desc}</div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  </div>
);

const RESEARCH_QUICK_PROMPTS: ResearchPrompt[] = [
  { title: "Risk Model", icon: <Coins size={16} />, prompt: "Compare fixed fractional risk, volatility-adjusted position sizing, and R-based execution for discretionary traders. Keep it practical.", color: 'text-amber-500', desc: 'Risk framework research' },
  { title: "Macro Lens", icon: <TrendingUp size={16} />, prompt: "Explain how a trader should research macro drivers before taking a directional trade in forex or indices, without relying on live headlines.", color: 'text-violet-500', desc: 'Top-down context building' },
];

const FORGE_ITEMS = [
  { title: "Strategy Roadmap", icon: <Workflow size={20} />, desc: "Logic & decision trees", prompt: "Generate a visual decision tree for my current trading strategy." },
  { title: "Psychology Flow", icon: <Brain size={20} />, desc: "Emotional state management", prompt: "Create a psychology protocol for managing state during drawdown." }
];
const isEconomicCalendarRequest = (query: string) => {
  const normalized = query.toLowerCase();
  return normalized.includes('economic calendar')
    || (normalized.includes('calendar') && /\b(cpi|ppi|nfp|fomc|fed|ecb|boe|boj|gdp|inflation|employment|jobs|rate|macro)\b/.test(normalized));
};

type ForexFactoryEvent = {
  date: string;
  time?: string;
  currency?: string;
  Currency?: string;
  impact?: string;
  Impact?: string;
  event?: string;
  Event?: string;
  actual?: string;
  Actual?: string;
  forecast?: string;
  Forecast?: string;
  previous?: string;
  Previous?: string;
  datetime_local?: string;
  datetime_utc?: string;
};

const formatForexFactoryCalendarMarkdown = (events: ForexFactoryEvent[]): string => {
  if (!events || events.length === 0) return '## 📅 Economic Calendar\n\nNo upcoming economic events found. Try again later.';

  const impactIcon = (impact: string | undefined) => {
    const imp = (impact || '').toLowerCase();
    if (imp === 'high' || imp === 'red') return '🔴 High';
    if (imp === 'medium' || imp === 'orange' || imp === 'med') return '🟠 Medium';
    if (imp === 'low' || imp === 'yellow') return '🟡 Low';
    return '⚪ —';
  };

  const formatTime = (evt: ForexFactoryEvent) => {
    const dtLocal = evt.datetime_local;
    if (dtLocal) {
      try {
        const d = new Date(dtLocal);
        if (!isNaN(d.getTime())) {
          return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        }
      } catch { /* fall through */ }
    }
    return evt.time || '—';
  };

  const formatDate = (evt: ForexFactoryEvent) => {
    const dtLocal = evt.datetime_local;
    if (dtLocal) {
      try {
        const d = new Date(dtLocal);
        if (!isNaN(d.getTime())) {
          return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        }
      } catch { /* fall through */ }
    }
    return evt.date || '—';
  };

  // Group events by date
  const grouped = new Map<string, ForexFactoryEvent[]>();
  for (const evt of events) {
    const dateKey = formatDate(evt);
    if (!grouped.has(dateKey)) grouped.set(dateKey, []);
    grouped.get(dateKey)!.push(evt);
  }

  let md = '## 📅 Economic Calendar — ForexFactory Live\n\n';

  for (const [dateKey, dayEvents] of grouped) {
    md += `### ${dateKey}\n\n`;
    md += '| Time | Currency | Impact | Event | Actual | Forecast | Previous |\n';
    md += '|------|----------|--------|-------|--------|----------|----------|\n';
    for (const evt of dayEvents) {
      const currency = evt.currency || evt.Currency || '—';
      const impact = impactIcon(evt.impact || evt.Impact);
      const event = evt.event || evt.Event || '—';
      const actual = evt.actual || evt.Actual || '—';
      const forecast = evt.forecast || evt.Forecast || '—';
      const previous = evt.previous || evt.Previous || '—';
      const time = formatTime(evt);
      md += `| ${time} | **${currency}** | ${impact} | ${event} | ${actual} | ${forecast} | ${previous} |\n`;
    }
    md += '\n';
  }

  md += `\n*Source: ForexFactory — Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}*`;
  return md;
};

// --- Slash Commands --
const AIChat: React.FC<AIChatProps> = ({ isDarkMode, trades: rawTrades = [], userProfile, dailyBias = [], eaSession, lastKnownBridgeBalance, isBridgeOnline = false, notes = [], goals = [], onAddNote, onOpenSettings, onBackToHome, onNavigate }) => {
  // Full mentor context: notebook + goals ride as props, live open positions
  // come from the already-connected EA session. Rules checklist is read from
  // localStorage inside the AI service at send time (always fresh).
  const mentorExtraContext = useMemo(() => ({
    notes,
    goals,
    openPositions: (eaSession?.data?.openPositions ?? []).map((p) => ({
      symbol: p.symbol,
      side: p.type,
      volume: p.volume,
      openPrice: p.open_price,
      currentPrice: p.current_price,
      profit: p.profit,
    })),
  }), [notes, goals, eaSession]);
  const challengeOptions = useMemo(() => ([
    { id: 'emotions', label: 'Emotional Trading', desc: 'FOMO, revenge trading, fear of missing out', icon: <Brain size={20} /> },
    { id: 'discipline', label: 'Lack of Discipline', desc: 'Skipping trades, not following rules', icon: <ListChecks size={20} /> },
    { id: 'analysis', label: 'Analysis Paralysis', desc: 'Overthinking, unable to make decisions', icon: <BrainCircuit size={20} /> },
    { id: 'drawdown', label: 'Drawdown Recovery', desc: 'Difficulty recovering from losses', icon: <TrendingDown size={20} /> },
    { id: 'consistency', label: 'Inconsistent Results', desc: 'Unpredictable performance', icon: <BarChart3 size={20} /> },
    { id: 'time', label: 'Time Management', desc: 'Not enough time to trade properly', icon: <Timer size={20} /> },
  ]), []);
  const challengeLabelMap = useMemo(
    () => Object.fromEntries(challengeOptions.map(({ id, label }) => [id, label])),
    [challengeOptions]
  );
  const [showWizard, setShowWizard] = useState(false);
  const [showForgeMenu, setShowForgeMenu] = useState(false);
  const [showFeaturesMenu, setShowFeaturesMenu] = useState(false);
  const [visibleMessageLimit, setVisibleMessageLimit] = useState(60);
  const { addToast } = useToast();
  const [wizardStep, setWizardStep] = useState(0);

  const trades = useMemo(() => [...rawTrades].sort((a, b) => new Date(`${a.date}T${a.time}`).getTime() - new Date(`${b.date}T${b.time}`).getTime()), [rawTrades]);
  const analyticsSnapshot = useMemo(
    () => buildAnalyticsAiSnapshot(trades, userProfile, dailyBias, eaSession, lastKnownBridgeBalance, isBridgeOnline),
    [trades, userProfile, dailyBias, eaSession, lastKnownBridgeBalance, isBridgeOnline]
  );
  const preferredPairOptions = useMemo(() => {
    const pairs = Array.from(new Set(rawTrades.map((trade) => trade.pair).filter(Boolean)));
    return (pairs.length > 0 ? pairs : ['EURUSD', 'GBPUSD', 'XAUUSD', 'USDJPY', 'NAS100', 'US30']).slice(0, 8);
  }, [rawTrades]);

  const createInitialWizardData = useCallback(() => ({
    tradingStyle: '',
    goals: '',
    riskTolerance: 'moderate',
    challenges: [] as string[],
    timeCommitment: '',
    experience: userProfile?.experienceLevel || '',
    preferredPairs: preferredPairOptions.slice(0, Math.min(3, preferredPairOptions.length)),
    markets: [] as string[],
    analysisTimeframe: 'Daily',
    entryTimeframe: 'M15',
    tradingSessions: [] as string[],
    dailyTradeLimit: '3',
    exitMechanics: 'Fixed TP/SL',
    tradeManagement: 'Move to BE at 1R',
    profitTarget: '',
    lossCap: '',
    whyITrade: '',
  }), [preferredPairOptions, userProfile?.experienceLevel]);
  const [wizardData, setWizardData] = useState<WizardData>(() => createInitialWizardData());
  
  const [selectedModel, setSelectedModel] = useLocalStorage<ModalModelType>('jfx_ai_selected_model', 'deepseek');
  const [selectedChatModelId, setSelectedChatModelId] = useLocalStorage<string>('jfx_ai_chat_model_id', 'muse-spark-1.2-contributor-free');
  const [showModelDrawer, setShowModelDrawer] = useState(false);
  const [recallMemory, setRecallMemory] = useLocalStorage<boolean>('jfx_ai_recall_memory', true);
  const [dailyCredits, setDailyCredits] = useLocalStorage<DailyCreditState>('jfx_ai_daily_credits', createDailyCreditState());
  const assistantMode = useMemo(() => getAssistantMode(selectedModel), [selectedModel]);
  const isResearchMode = assistantMode === 'research';
  const assistantLabel = isResearchMode ? 'JFX Research' : 'JFX Mentor';
  const [isPlanMode, setIsPlanMode] = useState(false);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [visualizerBars, setVisualizerBars] = useState<number[]>(() => Array.from({ length: 20 }, () => 0.18));
  const [pendingVoiceClip, setPendingVoiceClip] = useState<VoiceClipAttachment | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const speechRecognitionRef = useRef<ReturnType<typeof browserSpeechService.createRecognition> | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingMimeTypeRef = useRef<string>('audio/webm');
  const voiceBaseInputRef = useRef('');
  const voiceFinalTranscriptRef = useRef('');
  const voiceInterimTranscriptRef = useRef('');
  const recordingActionRef = useRef<'transcribe' | 'discard'>('transcribe');
  const recordingStartTimestampRef = useRef<number | null>(null);
  const recordingAccumulatedMsRef = useRef(0);
  const recordingTimerRef = useRef<number | null>(null);
  const analyserContextRef = useRef<AudioContext | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const analyserSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserFrameRef = useRef<number | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const stickToBottomRef = useRef(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Streaming bookkeeping: the placeholder message id plus the latest partial
  // text, so abort/stop can finalize (or discard) exactly the right bubble.
  const streamIdRef = useRef<string | null>(null);
  const streamedTextRef = useRef('');
  const inputRef = useRef<HTMLInputElement>(null);
  const isProcessingRef = useRef(false);
  useEffect(() => {
    const syncDailyCredits = () => {
      const today = getLocalDateKey();
      setDailyCredits((current) => (
        current.date === today ? current : createDailyCreditState(today)
      ));
    };

    syncDailyCredits();
    const intervalId = window.setInterval(syncDailyCredits, 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [setDailyCredits]);

  const [researchMessages, setResearchMessages] = useSessionMessages('jfx_ai_chat_history_research');
  const [mentorMessages, setMentorMessages] = useSessionMessages('jfx_ai_chat_history_mentor');
  const AssistantIcon = selectedModel === 'deepseek' ? Telescope : Brain;

  const messages = selectedModel === 'deepseek' ? researchMessages : mentorMessages;

  // Render only the latest slice of history; older rows load on demand.
  const visibleMessages = useMemo(
    () => (messages.length > visibleMessageLimit ? messages.slice(-visibleMessageLimit) : messages),
    [messages, visibleMessageLimit]
  );
  const hiddenMessageCount = messages.length - visibleMessages.length;

  const setMessages = useCallback((value: Message[] | ((val: Message[]) => Message[])) => {
    if (selectedModel === 'deepseek') {
      setResearchMessages(prev => value instanceof Function ? value(prev) : value);
      return;
    }
    setMentorMessages(prev => value instanceof Function ? value(prev) : value);
  }, [selectedModel, setMentorMessages, setResearchMessages]);

  useEffect(() => {
    window.localStorage.removeItem('jfx_ai_communication_style');
  }, []);

  // Abort any in-flight AI request when the page unmounts.
  useEffect(() => () => {
    abortControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!showWizard) return;
    setWizardStep(0);
    setWizardData(createInitialWizardData());
  }, [createInitialWizardData, showWizard]);

  useEffect(() => {
    if (!showWizard) {
      setIsPlanMode(false);
    }
  }, [showWizard]);



  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsGenerating(false);
      addToast({ type: 'info', title: 'Generation Stopped', message: 'The AI architect has paused.' });
    }
  };

  const handleScroll = useCallback(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    const isAtBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 100;
    stickToBottomRef.current = isAtBottom;
    setShowScrollToBottom(!isAtBottom);
  }, []);

  const mergeVoiceInput = useCallback((baseInput: string, finalTranscript: string, interimTranscript: string = '') => {
    const segments = [baseInput.trim(), finalTranscript.trim(), interimTranscript.trim()].filter(Boolean);
    return segments.join(' ').trim();
  }, []);

  const playEarcon = useCallback((type: 'record-start' | 'ready' | 'thinking-done' | 'task-complete' | 'discard') => {
    if (typeof window === 'undefined') return;

    const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtor) return;

    const context = new AudioCtor();
    const gain = context.createGain();
    gain.connect(context.destination);
    gain.gain.value = 0.0001;

    const sequences: Record<string, number[]> = {
      'record-start': [540, 720],
      ready: [480, 640],
      'thinking-done': [660, 880],
      'task-complete': [523, 659, 784],
      discard: [420, 280],
    };

    const sequence = sequences[type];
    const now = context.currentTime;

    sequence.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      const startAt = now + index * 0.11;
      const endAt = startAt + 0.08;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.05, startAt + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
      oscillator.start(startAt);
      oscillator.stop(endAt);
    });

    window.setTimeout(() => {
      void context.close().catch(() => undefined);
    }, sequence.length * 180);
  }, []);

  const handleModelSwitch = useCallback((nextModel: ModalModelType) => {
    if (nextModel === selectedModel) return;
    // Never let an in-flight answer land in the wrong mode's history.
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setShowForgeMenu(false);
    setShowFeaturesMenu(false);
    if (getAssistantMode(nextModel) === 'research') {
      setShowWizard(false);
      setIsPlanMode(false);
    }
    setSelectedModel(nextModel);
  }, [selectedModel, setSelectedModel]);

  const handleNewChat = useCallback(() => {
    // Abort first so a late completion can't resurrect into the fresh chat.
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setMessages([]);
  }, [setMessages]);

  const stopVisualizer = useCallback(() => {
    if (analyserFrameRef.current) {
      window.cancelAnimationFrame(analyserFrameRef.current);
      analyserFrameRef.current = null;
    }
    analyserSourceRef.current?.disconnect();
    analyserSourceRef.current = null;
    analyserNodeRef.current?.disconnect();
    analyserNodeRef.current = null;
    if (analyserContextRef.current && analyserContextRef.current.state !== 'closed') {
      void analyserContextRef.current.close().catch(() => undefined);
    }
    analyserContextRef.current = null;
    setVisualizerBars(Array.from({ length: 20 }, () => 0.18));
  }, []);

  const stopRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const startRecordingTimer = useCallback(() => {
    stopRecordingTimer();
    setRecordingElapsedMs(recordingAccumulatedMsRef.current);
    recordingTimerRef.current = window.setInterval(() => {
      const base = recordingAccumulatedMsRef.current;
      const activeSlice = recordingStartTimestampRef.current ? Date.now() - recordingStartTimestampRef.current : 0;
      setRecordingElapsedMs(base + activeSlice);
    }, 120);
  }, [stopRecordingTimer]);

  const startVisualizer = useCallback((stream: MediaStream) => {
    const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtor) return;

    stopVisualizer();

    const context = new AudioCtor();
    const analyser = context.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.78;

    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);

    analyserContextRef.current = context;
    analyserNodeRef.current = analyser;
    analyserSourceRef.current = source;

    const buffer = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      if (!analyserNodeRef.current || isRecordingPaused) {
        setVisualizerBars(Array.from({ length: 20 }, () => 0.12));
        return;
      }

      analyser.getByteFrequencyData(buffer);
      const nextBars = Array.from({ length: 20 }, (_, index) => {
        const bucketStart = Math.floor((index / 20) * buffer.length);
        const bucketEnd = Math.max(bucketStart + 1, Math.floor(((index + 1) / 20) * buffer.length));
        const slice = buffer.slice(bucketStart, bucketEnd);
        const average = slice.reduce((sum, value) => sum + value, 0) / slice.length / 255;
        return Math.max(0.14, Math.min(1, average * 1.8));
      });
      setVisualizerBars(nextBars);
      analyserFrameRef.current = window.requestAnimationFrame(tick);
    };

    analyserFrameRef.current = window.requestAnimationFrame(tick);
  }, [isRecordingPaused, stopVisualizer]);

  const discardPendingVoiceClip = useCallback(() => {
    setPendingVoiceClip((current) => {
      if (current) {
        URL.revokeObjectURL(current.url);
      }
      return null;
    });
  }, []);

  const cleanupVoiceInput = useCallback(() => {
    stopRecordingTimer();
    stopVisualizer();
    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.onresult = null;
      speechRecognitionRef.current.onerror = null;
      speechRecognitionRef.current.onend = null;
      try {
        speechRecognitionRef.current.abort();
      } catch {}
    }
    speechRecognitionRef.current = null;
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;
    audioChunksRef.current = [];
    recordingMimeTypeRef.current = 'audio/webm';
    recordingStartTimestampRef.current = null;
    recordingAccumulatedMsRef.current = 0;
    voiceFinalTranscriptRef.current = '';
    voiceInterimTranscriptRef.current = '';
    setRecordingElapsedMs(0);
    setIsRecordingPaused(false);
  }, [stopRecordingTimer, stopVisualizer]);

  const stopVoiceRecording = useCallback((action: 'transcribe' | 'discard' = 'transcribe') => {
    recordingActionRef.current = action;
    if (recordingStartTimestampRef.current) {
      recordingAccumulatedMsRef.current += Date.now() - recordingStartTimestampRef.current;
      recordingStartTimestampRef.current = null;
    }
    stopRecordingTimer();
    stopVisualizer();
    try {
      speechRecognitionRef.current?.stop();
    } catch {}
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    } catch {}
  }, [stopRecordingTimer, stopVisualizer]);

  const togglePauseRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    if (recorder.state === 'recording') {
      recorder.pause();
      try {
        speechRecognitionRef.current?.stop();
      } catch {}
      if (recordingStartTimestampRef.current) {
        recordingAccumulatedMsRef.current += Date.now() - recordingStartTimestampRef.current;
        recordingStartTimestampRef.current = null;
      }
      stopRecordingTimer();
      stopVisualizer();
      setIsRecordingPaused(true);
      setRecordingElapsedMs(recordingAccumulatedMsRef.current);
      return;
    }

    if (recorder.state === 'paused') {
      recorder.resume();
      try {
        speechRecognitionRef.current?.start();
      } catch {}
      recordingStartTimestampRef.current = Date.now();
      startRecordingTimer();
      if (mediaStreamRef.current) {
        startVisualizer(mediaStreamRef.current);
      }
      setIsRecordingPaused(false);
    }
  }, [startRecordingTimer, startVisualizer, stopRecordingTimer, stopVisualizer]);

  const finalizeVoiceRecording = useCallback(async (): Promise<string | null> => {
    if (recordingActionRef.current === 'discard') {
      cleanupVoiceInput();
      playEarcon('discard');
      return null;
    }

    if (audioChunksRef.current.length === 0) {
      setIsTranscribing(false);
      cleanupVoiceInput();
      addToast({ type: 'warning', title: 'Voice Input', message: 'No audio was captured. Try again closer to the microphone.' });
      return null;
    }

    setIsTranscribing(true);
    try {
      const audioBlob = new Blob(audioChunksRef.current, { type: recordingMimeTypeRef.current });
      const audioUrl = URL.createObjectURL(audioBlob);
      discardPendingVoiceClip();
      setPendingVoiceClip({
        blob: audioBlob,
        url: audioUrl,
        durationMs: recordingAccumulatedMsRef.current,
        mimeType: recordingMimeTypeRef.current,
      });
      const transcript = `${voiceFinalTranscriptRef.current} ${voiceInterimTranscriptRef.current}`.trim();
      const nextInput = mergeVoiceInput(voiceBaseInputRef.current, transcript);

      if (nextInput) {
        playEarcon('ready');
        return nextInput;
      } else {
        addToast({ type: 'warning', title: 'Voice Input', message: 'No speech was recognized. Try again closer to the microphone.' });
      }
    } catch (error: any) {
      addToast({ type: 'error', title: 'Transcription Error', message: error?.message || 'Voice transcription failed.' });
    } finally {
      setIsTranscribing(false);
      cleanupVoiceInput();
    }
    return null;
  }, [addToast, cleanupVoiceInput, discardPendingVoiceClip, mergeVoiceInput, playEarcon]);

  const toggleRecording = async () => {
    if (isRecording) {
      stopVoiceRecording();
      setIsRecording(false);
      return;
    }

    try {
      if (!browserSpeechService.isSupported()) {
        throw new Error('Browser speech recognition is not supported in this browser.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;
      voiceBaseInputRef.current = input;
      voiceFinalTranscriptRef.current = '';
      voiceInterimTranscriptRef.current = '';
      audioChunksRef.current = [];
      recordingAccumulatedMsRef.current = 0;
      recordingStartTimestampRef.current = Date.now();
      setRecordingElapsedMs(0);
      recordingActionRef.current = 'transcribe';

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';

      if (!mimeType) {
        throw new Error('Audio recording is not supported in this browser.');
      }

      recordingMimeTypeRef.current = mimeType;
      const mediaRecorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128000 });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        void (async () => {
          const finalText = await finalizeVoiceRecording();
          if (finalText) {
            setInput(finalText);
            setTimeout(() => inputRef.current?.focus(), 100);
          } else {
            setTimeout(() => inputRef.current?.focus(), 100);
          }
        })();
      };

      mediaRecorder.start(250);
      const recognition = browserSpeechService.createRecognition(
        ({ finalTranscript, interimTranscript }) => {
          if (finalTranscript) {
            voiceFinalTranscriptRef.current = `${voiceFinalTranscriptRef.current} ${finalTranscript}`.trim();
          }
          voiceInterimTranscriptRef.current = interimTranscript;
          setInput(mergeVoiceInput(voiceBaseInputRef.current, voiceFinalTranscriptRef.current, interimTranscript));
        },
        (error) => {
          if (!['aborted', 'no-speech'].includes(error)) {
            addToast({ type: 'warning', title: 'Voice Input', message: 'Speech recognition was interrupted. Stop and try again.' });
          }
        }
      );

      speechRecognitionRef.current = recognition;
      try {
        recognition?.start();
      } catch {}
      startRecordingTimer();
      startVisualizer(stream);

      setIsRecording(true);
      setIsRecordingPaused(false);
      playEarcon('record-start');
    } catch (error: any) {
      cleanupVoiceInput();
      setIsRecording(false);
      addToast({ type: 'error', title: 'Microphone Error', message: error?.message || 'Could not access the microphone.' });
    }
  };

  useEffect(() => () => {
    cleanupVoiceInput();
    discardPendingVoiceClip();
  }, [cleanupVoiceInput, discardPendingVoiceClip]);

  const voiceStatusLabel = isRecording
    ? (isRecordingPaused ? 'Paused' : 'Recording')
    : isTranscribing
      ? 'Processing'
      : '';

  const voiceStatusHint = isRecording
    ? (isRecordingPaused ? 'Recording paused. Resume or stop when ready.' : 'Recording audio. Pause, discard, or stop when you are done.')
    : isTranscribing
      ? 'Sending the recording through the model.'
      : pendingVoiceClip
        ? 'Review the audio, edit the transcript, and send when ready.'
        : '';

  const inputPlaceholder = isRecording
    ? (isRecordingPaused ? 'Recording paused...' : 'Recording...')
    : isTranscribing
      ? 'Processing recording...'
      : isResearchMode
        ? 'Research a market idea, setup, or trading concept...'
        : 'Ask about your journal, psychology, or trading plan...';

  const canSendMessage = isGenerating || Boolean(input.trim()) || Boolean(pendingVoiceClip);

  useEffect(() => {
    const container = chatContainerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.features-menu') && !target.closest('.features-btn')) {
        setShowFeaturesMenu(false);
      }
      if (!target.closest('.forge-menu') && !target.closest('.forge-btn')) {
        setShowForgeMenu(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  useEffect(() => {
    const shouldAutoFollow = messages.length > 0 || isGenerating || isTranscribing;
    if (!shouldAutoFollow) return;
    // Respect the reader: never yank the scroll position while they are
    // browsing older messages (they can use the jump-to-latest button).
    if (!stickToBottomRef.current) return;

    const timer = window.setTimeout(() => {
      scrollMessagesToEnd(messagesEndRef.current, isGenerating || isTranscribing ? 'auto' : 'smooth');
    }, 50);

    return () => window.clearTimeout(timer);
  }, [messages, isGenerating, isTranscribing]);

  const handleSend = async (
    overrideInput?: string,
    options: { audioAttachment?: Message['audioAttachment']; voiceClip?: VoiceClipAttachment | null } = {}
  ) => {
    if (isProcessingRef.current) return;

    const finalInput = overrideInput || input;
    let nextAudioAttachment = options.audioAttachment;
    if (options.voiceClip) {
      // Blob object URL keeps the audio out of localStorage entirely.
      nextAudioAttachment = {
        url: URL.createObjectURL(options.voiceClip.blob),
        durationMs: options.voiceClip.durationMs,
        mimeType: options.voiceClip.mimeType,
        deviceLabel: options.voiceClip.deviceLabel,
      };
    }

    const hasAudioAttachment = Boolean(nextAudioAttachment);
    let normalizedInput = finalInput.trim();
    if (normalizedInput.length > MAX_INPUT_CHARS) {
      normalizedInput = normalizedInput.slice(0, MAX_INPUT_CHARS);
      addToast({
        type: 'info',
        title: 'Message shortened',
        message: `Kept the first ${MAX_INPUT_CHARS} characters so the request stays fast and within service limits.`,
      });
    }
    if ((!normalizedInput && !hasAudioAttachment) || isGenerating) return;

    const activeCreditMode: 'research' | 'mentor' = isResearchMode ? 'research' : 'mentor';
    const remainingCredits = activeCreditMode === 'research' ? dailyCredits.researchRemaining : dailyCredits.mentorRemaining;

    // Bail out BEFORE mutating anything so the draft text and any pending
    // voice clip survive a credits rejection.
    if (remainingCredits <= 0) {
      addToast({
        type: 'error',
        title: 'Daily credits used up',
        message: `You have used all ${isResearchMode ? 'research' : 'mentor'} credits for today. Try again tomorrow.`,
      });
      setTimeout(() => inputRef.current?.focus(), 100);
      return;
    }

    isProcessingRef.current = true;
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: normalizedInput || '[Voice recording]',
      timestamp: new Date(),
      audioAttachment: nextAudioAttachment,
    };
    stickToBottomRef.current = true;
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setPendingVoiceClip(null);
    if (options.voiceClip) {
      URL.revokeObjectURL(options.voiceClip.url);
    }
    setIsGenerating(true);
    setShowForgeMenu(false);

    abortControllerRef.current = new AbortController();
    const requestContext = isResearchMode
      ? { trades: [] as Trade[], userProfile: null as UserProfile | null, dailyBias: [] as DailyBias[], analyticsSnapshot: null as any }
      : { trades, userProfile, dailyBias, analyticsSnapshot };
    const requestHistory = recallMemory ? messages.map(m => ({ role: m.role, content: m.content })) : [];
    const contextSummary = buildContextSummary(isResearchMode ? 'research' : 'mentor', isResearchMode ? 0 : requestHistory.length);

    if (isResearchMode && normalizedInput && isPrivateTradingRequest(normalizedInput)) {
      processResponse(
        'I can help with general market research, setups, risk models, and trading concepts, but Research mode cannot access your private journal, trades, account, or performance data. Switch to Mentor mode for that.',
        (Date.now() + 1).toString(),
        { contextSummary }
      );
      setIsGenerating(false);
      abortControllerRef.current = null;
      isProcessingRef.current = false;
      setTimeout(() => inputRef.current?.focus(), 100);
      return;
    }

    if (!isResearchMode && normalizedInput && isPairPerformanceQuestion(normalizedInput)) {
      const localAnswer = buildPairPerformanceAnswer(normalizedInput, trades, userProfile);
      processResponse(localAnswer, (Date.now() + 1).toString(), { contextSummary });
      setIsGenerating(false);
      abortControllerRef.current = null;
      isProcessingRef.current = false;
      setTimeout(() => inputRef.current?.focus(), 100);
      return;
    }

    if (normalizedInput && isEconomicCalendarRequest(normalizedInput)) {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const from = new Date().toISOString().split('T')[0];
        const to = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
        // Native-safe: uses hosted API on web, direct CDN fallback in APK.
        const { fetchEconomicCalendar } = await import('../lib/economicCalendarClient');
        const calPayload = await fetchEconomicCalendar({ from, to, tz });
        const events: ForexFactoryEvent[] = Array.isArray(calPayload) ? calPayload as unknown as ForexFactoryEvent[] : (calPayload as any)?.data ?? (calPayload as any)?.events ?? [];
        const calendarMd = formatForexFactoryCalendarMarkdown(events);
        processResponse(calendarMd, (Date.now() + 1).toString(), { contextSummary });
      } catch (error) {
        console.error('Economic calendar fetch error:', error);
        processResponse(
          '## 📅 Economic Calendar\n\nFailed to fetch the live economic calendar. Please check your connection and try again.',
          (Date.now() + 1).toString(),
          { contextSummary }
        );
      } finally {
        setIsGenerating(false);
        abortControllerRef.current = null;
        isProcessingRef.current = false;
        setTimeout(() => inputRef.current?.focus(), 100);
      }
      return;
    }

    try {
      consumeDailyCredit(activeCreditMode);
      // Streaming placeholder: tokens render as they arrive (fast perceived
      // response) and the finished answer swaps into the same bubble.
      const streamId = `stream-${Date.now()}`;
      streamIdRef.current = streamId;
      streamedTextRef.current = '';
      setMessages(prev => [...prev, {
        id: streamId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
        contextSummary,
      }]);
      const res = await modalResearchService.generateResponseWithMeta(
        normalizedInput || 'Analyze and respond to this attached voice recording.',
        requestContext.trades,
        requestContext.userProfile,
        requestContext.dailyBias,
        requestContext.analyticsSnapshot,
        false,
        requestHistory,
        selectedModel,
        isPlanMode,
        (partial) => {
          streamedTextRef.current = partial;
          setMessages(prev => prev.map(m => m.id === streamId ? { ...m, content: partial } : m));
        },
        abortControllerRef.current.signal,
        { extraContext: mentorExtraContext }
      );
      processResponse(res.text, (Date.now() + 1).toString(), {
        replaceId: streamId,
        contextSummary: { ...contextSummary, modelUsed: res.modelId, fellBack: res.fellBack },
      });
    } catch (error: any) {
      const streamId = streamIdRef.current;
      const partial = streamedTextRef.current.trim();
      // Give the credit back — it was only spent on a successful answer.
      refundDailyCredit(activeCreditMode);
      if (error?.message === "Generation aborted") {
        // Stopped by the user: keep what had already streamed (if anything)
        // instead of leaving an empty bubble behind.
        if (streamId && partial) {
          processResponse(partial, (Date.now() + 1).toString(), { replaceId: streamId, contextSummary });
        } else if (streamId) {
          removeMessage(streamId);
        }
        return;
      }
      if (streamId) {
        removeMessage(streamId);
      }
      console.error("AI Error:", error);
      addToast({ type: 'error', title: 'AI Error', message: describeAiError(error) });
    } finally {
      streamIdRef.current = null;
      streamedTextRef.current = '';
      setIsGenerating(false);
      abortControllerRef.current = null;
      isProcessingRef.current = false;
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const mapChallengeLabels = useCallback((challengeIds: string[]) => (
    challengeIds.map((id) => challengeLabelMap[id] || id)
  ), [challengeLabelMap]);

  const buildPsychologySnapshot = useCallback(() => {
    const emotionEntries = Object.entries(trades.reduce((acc, trade) => {
      const key = trade.mindset || 'Neutral';
      if (!acc[key]) acc[key] = { pnl: 0, trades: 0 };
      acc[key].pnl += trade.pnl;
      acc[key].trades += 1;
      return acc;
    }, {} as Record<string, { pnl: number; trades: number }>));
    const topEmotion = emotionEntries.sort((a, b) => b[1].pnl - a[1].pnl)[0]?.[0] || 'Neutral';
    const worstEmotion = emotionEntries.sort((a, b) => a[1].pnl - b[1].pnl)[0]?.[0] || 'Neutral';
    return {
      topEmotion,
      worstEmotion,
      noPlanTrades: trades.filter(t => t.planAdherence === 'No Plan').length,
      followPlanTrades: trades.filter(t => t.planAdherence === 'Followed Exactly').length,
      recentLosses: trades.filter(t => t.result === 'Loss').slice(-5).length,
      totalTrades: trades.length,
    };
  }, [trades]);

  const buildScalingSnapshot = useCallback(() => {
    const fullStats = calculateStats(trades);
    const currency = userProfile?.currencySymbol || '$';
    return {
      balance: formatSignedCurrency(userProfile?.initialBalance ?? 0, currency),
      netProfit: formatSignedCurrency(fullStats.netProfit, currency),
      winRate: `${fullStats.winRate.toFixed(1)}%`,
      profitFactor: fullStats.profitFactor.toFixed(2),
      avgWin: formatSignedCurrency(fullStats.avgWin, currency),
      avgLoss: formatSignedCurrency(-Math.abs(fullStats.avgLoss), currency),
      riskPerTrade: userProfile?.defaultRR ? `${userProfile.defaultRR}R default` : 'Not set',
      bestPair: fullStats.bestPair ? `${fullStats.bestPair.symbol} (${formatSignedCurrency(fullStats.bestPair.pnl, currency)})` : 'N/A',
    };
  }, [trades, userProfile]);

  const buildContextSummary = useCallback((mode: 'research' | 'mentor' | 'research-quick', historyUsed: number, isDeepAnalysis = false): AssistantContextSummary => {
    if (mode === 'research' || mode === 'research-quick') {
      return {
        mode: 'research',
        sourceLabel: mode === 'research-quick' ? 'Public research only - quick prompt' : 'Public research only',
        historyUsed: 0,
        maxTokens: 420,
        privateDataAllowed: false,
        promptScope: isDeepAnalysis ? 'Research prompt' : 'Market concepts, setups, and trading research',
      };
    }

    return {
      mode: 'mentor',
      sourceLabel: isDeepAnalysis ? 'Private journal context - deep analysis' : 'Private journal context',
      historyUsed,
      maxTokens: 420,
      privateDataAllowed: true,
      promptScope: isDeepAnalysis ? 'Performance review and coaching' : 'Mentor coaching, performance review, and strategy planning',
    };
  }, []);

  const handleSaveMessageAsNote = useCallback(async (message: Message) => {
    if (!onAddNote || message.role !== 'assistant') return;

    const rawContent = stripStructuredBlocks(cleanThinkingTags(message.content || '')).trim();
    const noteBody = rawContent || 'Saved from AI Chat.';
    const firstLine = noteBody.split('\n').map(line => line.trim()).find(Boolean) || 'AI Chat Note';
    const title = firstLine.replace(/^#+\s*/, '').slice(0, 60);

    const note: Note = {
      id: `${Date.now()}`,
      title,
      content: noteBody,
      date: new Date().toISOString().slice(0, 10),
      tags: [message.contextSummary?.mode === 'research' ? 'research' : 'mentor', 'ai-chat'],
      color: '#FF4F00',
      isPinned: false,
      isArchived: false,
      isTrashed: false,
      isList: false,
      position: 0,
    };

    await onAddNote(note);
    addToast({
      type: 'success',
      title: 'Note saved',
      message: 'Assistant response added to Notes.'
    });
  }, [addToast, onAddNote]);

  const getCurrentCreditLabel = useCallback(() => {
    const remaining = isResearchMode ? dailyCredits.researchRemaining : dailyCredits.mentorRemaining;
    return `AI credit ${remaining}/${DAILY_CREDIT_MAX}`;
  }, [isResearchMode, dailyCredits]);

  const currentCreditsRemaining = isResearchMode ? dailyCredits.researchRemaining : dailyCredits.mentorRemaining;
  const isCreditWarning = currentCreditsRemaining <= 1;

  const consumeDailyCredit = useCallback((mode: 'research' | 'mentor') => {
    const today = getLocalDateKey();
    setDailyCredits((current) => {
      const base = current.date === today ? current : createDailyCreditState(today);
      if (mode === 'research') {
        return {
          ...base,
          researchRemaining: Math.max(0, base.researchRemaining - 1),
        };
      }

      return {
        ...base,
        mentorRemaining: Math.max(0, base.mentorRemaining - 1),
      };
    });
  }, [setDailyCredits]);

  const refundDailyCredit = useCallback((mode: 'research' | 'mentor') => {
    const today = getLocalDateKey();
    setDailyCredits((current) => {
      const base = current.date === today ? current : createDailyCreditState(today);
      if (mode === 'research') {
        return {
          ...base,
          researchRemaining: Math.min(DAILY_CREDIT_MAX, base.researchRemaining + 1),
        };
      }

      return {
        ...base,
        mentorRemaining: Math.min(DAILY_CREDIT_MAX, base.mentorRemaining + 1),
      };
    });
  }, [setDailyCredits]);

  const processResponse = (
    fullResponse: string,
    messageId: string,
    options: {
      isDeepAnalysis?: boolean;
      kind?: 'chat' | 'analysis' | 'strategy' | 'psychology' | 'scaling' | 'trading-plan';
      psychologySnapshot?: Message['psychologySnapshot'];
      scalingSnapshot?: Message['scalingSnapshot'];
      strategyProfile?: Message['strategyProfile'];
      contextSummary?: AssistantContextSummary;
      replaceId?: string;
    } = {}
  ) => {
    const { isDeepAnalysis = false, kind = isDeepAnalysis ? 'analysis' : 'chat', psychologySnapshot, scalingSnapshot, strategyProfile, contextSummary, replaceId } = options;
    let cleanContent = cleanAssistantResponse(fullResponse).replace(/\n\n\n+/g, '\n\n').trim();
    if (!cleanContent) {
      cleanContent = 'I couldn\'t prepare a safe final response. Please try again.';
    }

    const sections: Record<string, string> = {};
    const sectionMatches = Array.from(cleanContent.matchAll(/\[SECTION:([A-Z_]+)\]([\s\S]*?)(?=\[SECTION:[A-Z_]+\]|$)/g));
    sectionMatches.forEach(([, name, body]) => {
      sections[name] = body.trim();
    });
    if (sectionMatches.length > 0) {
      cleanContent = cleanContent.replace(/\[SECTION:([A-Z_]+)\]([\s\S]*?)(?=\[SECTION:[A-Z_]+\]|$)/g, '').trim();
    }

    const node: Message = { id: messageId, role: 'assistant', content: cleanContent, timestamp: new Date(), sections, isDeepAnalysis, kind, psychologySnapshot, scalingSnapshot, strategyProfile, contextSummary };
    // Streaming flow swaps the live placeholder for the finished bubble so
    // the message keeps its position and history stays coherent.
    setMessages(prev => replaceId
      ? prev.map(m => m.id === replaceId ? { ...node, id: replaceId } : m)
      : [...prev, node]);
    playEarcon(kind === 'chat' ? 'thinking-done' : 'task-complete');
  };

  const removeMessage = useCallback((id: string) => {
    setMessages(prev => prev.filter(m => m.id !== id));
  }, [setMessages]);

  const handleFeatureRequest = async (mode: 'psychology' | 'scaling', userRequest: string) => {
    if (isGenerating) return;
    if (isResearchMode) {
      addToast({
        type: 'info',
        title: 'Mentor Only',
        message: 'Switch to Mentor mode for psychology and scaling analysis based on your private trading data.',
      });
      return;
    }

    // Check credits BEFORE mutating anything so a rejection leaves no ghost
    // user message and no stuck generation spinner.
    if (dailyCredits.mentorRemaining <= 0) {
      addToast({
        type: 'error',
        title: 'Daily credits used up',
        message: 'You have used all mentor credits for today. Try again tomorrow.',
      });
      return;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: `### ${mode === 'psychology' ? 'Psychology' : 'Scaling'} Request\n\n${userRequest}`,
      timestamp: new Date(),
      kind: mode,
    };
    stickToBottomRef.current = true;
    setMessages(prev => [...prev, userMessage]);
    setIsGenerating(true);
    setShowForgeMenu(false);

    abortControllerRef.current = new AbortController();
    const psychologySnapshot = mode === 'psychology' ? buildPsychologySnapshot() : undefined;
    const scalingSnapshot = mode === 'scaling' ? buildScalingSnapshot() : undefined;
    const requestHistory = recallMemory ? messages.map(m => ({ role: m.role, content: m.content })) : [];
    const contextSummary = buildContextSummary('mentor', requestHistory.length, true);
    const prompt = mode === 'psychology'
      ? `Build a trading psychology operating plan for this trader.

Use exactly these sections:
[SECTION:STATE_READ]
[SECTION:TRIGGERS]
[SECTION:RESET_PROTOCOL]
[SECTION:ROUTINE]
[SECTION:TARGETS]
Base the response on actual emotions, adherence, and recent behavior. Focus on practical emotional control, reset rules, and a repeatable routine.

FORMAT REQUIREMENTS
- Do not use widget tags, Mermaid blocks, checklist widgets, tool tags, or hidden UI syntax.
- RESET_PROTOCOL must be plain Markdown bullets or numbered steps.
- ROUTINE and TARGETS must be concise plain Markdown bullets.

User request: ${userRequest}`
      : `Build a capital scaling plan for this trader.

Use exactly these sections:
[SECTION:BASELINE]
[SECTION:RISK_LIMITS]
[SECTION:SCALING_ROADMAP]
[SECTION:CAPITAL_RULES]
[SECTION:TARGETS]
Base the response on actual performance, current balance, risk profile, and pair performance. Focus on practical risk control, scaling gates, and capital preservation.

FORMAT REQUIREMENTS
- Do not use widget tags, Mermaid blocks, checklist widgets, tool tags, or hidden UI syntax.
- SCALING_ROADMAP must be plain Markdown bullets grouped by phase.
- CAPITAL_RULES and TARGETS must be concise plain Markdown bullets.

 User request: ${userRequest}`;

    try {
      consumeDailyCredit('mentor');
      const res = await modalResearchService.generateResponseWithMeta(
        prompt,
        trades,
        userProfile,
        dailyBias,
        analyticsSnapshot,
        true,
        requestHistory,
        selectedModel,
        false,
        undefined,
        abortControllerRef.current.signal,
        { extraContext: mentorExtraContext }
      );
      processResponse(res.text, (Date.now() + 1).toString(), {
        isDeepAnalysis: true,
        kind: mode,
        psychologySnapshot,
        scalingSnapshot,
        contextSummary: { ...contextSummary, modelUsed: res.modelId, fellBack: res.fellBack },
      });
    } catch (error: any) {
      // Refund the credit — it is only spent on a successful answer.
      refundDailyCredit('mentor');
      if (error?.message === "Generation aborted") return;
      addToast({
        type: 'error',
        title: `${mode === 'psychology' ? 'Psychology' : 'Scaling'} Error`,
        message: describeAiError(error),
      });
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
      isProcessingRef.current = false;
    }
  };

  const isStepComplete = (step: number, data: any): boolean => {
    switch (step) {
      case 0: return !!data.tradingStyle && data.markets.length > 0;
      case 1: return !!data.goals.trim() && !!data.whyITrade.trim();
      case 2: return !!data.riskTolerance && !!data.dailyTradeLimit && !!data.profitTarget && !!data.lossCap;
      case 3: return data.challenges.length > 0;
      case 4: return !!data.timeCommitment && data.tradingSessions.length > 0;
      case 5: return !!data.experience && data.preferredPairs.length > 0;
      case 6: return !!data.exitMechanics && !!data.tradeManagement;
      case 7: return true;
      default: return false;
    }
  };

  const generateStrategy = async () => {
    if (isResearchMode) {
      addToast({
        type: 'info',
        title: 'Mentor Only',
        message: 'Strategy Blueprint uses your private journal context and is only available in Mentor mode.',
      });
      return;
    }

    if (dailyCredits.mentorRemaining <= 0) {
      addToast({
        type: 'error',
        title: 'Daily credits used up',
        message: 'You have used all mentor credits for today. Try again tomorrow.',
      });
      return;
    }

    setShowWizard(false);
    setIsGenerating(true);

    const strategyProfile = {
      tradingStyle: wizardData.tradingStyle,
      goals: wizardData.goals.trim(),
      riskTolerance: wizardData.riskTolerance,
      challenges: mapChallengeLabels(wizardData.challenges),
      timeCommitment: wizardData.timeCommitment,
      experience: wizardData.experience,
      preferredPairs: wizardData.preferredPairs,
      markets: wizardData.markets,
      analysisTimeframe: wizardData.analysisTimeframe,
      entryTimeframe: wizardData.entryTimeframe,
      tradingSessions: wizardData.tradingSessions,
      dailyTradeLimit: wizardData.dailyTradeLimit,
      exitMechanics: wizardData.exitMechanics,
      tradeManagement: wizardData.tradeManagement,
      profitTarget: wizardData.profitTarget,
      lossCap: wizardData.lossCap,
      whyITrade: wizardData.whyITrade,
    };

    const prompt = `Build a professional Strategy Blueprint for this trader.

TRADER IDENTITY & GOALS
- Style: ${strategyProfile.tradingStyle}
- Markets: ${strategyProfile.markets.join(', ')}
- Experience: ${strategyProfile.experience}
- Motivation: ${strategyProfile.whyITrade}
- Goals: ${strategyProfile.goals}

LOGISTICS & LIMITS
- Sessions: ${strategyProfile.tradingSessions.join(', ')}
- Daily Limit: ${strategyProfile.dailyTradeLimit} trades
- Time Commitment: ${strategyProfile.timeCommitment}

RISK FRAMEWORK
- Risk per Trade: ${strategyProfile.riskTolerance}
- Profit Targets: ${strategyProfile.profitTarget || 'Standard'}
- Loss Caps: ${strategyProfile.lossCap || 'Standard'}

STRATEGY ARCHITECTURE
- Analysis Timeframe (HTF): ${strategyProfile.analysisTimeframe}
- Entry Timeframe (LTF): ${strategyProfile.entryTimeframe}
- Preferred Pairs: ${strategyProfile.preferredPairs.join(', ')}
- Exit Mechanics: ${strategyProfile.exitMechanics}
- Trade Management: ${strategyProfile.tradeManagement}

OUTPUT REQUIREMENTS
- Use exactly these sections:
[SECTION:IDENTITY]
[SECTION:MARKET_SELECTION]
[SECTION:CORE_EDGE]
[SECTION:RISK]
[SECTION:STRATEGY_RULES]
[SECTION:EXECUTION_FLOW]
[SECTION:EXIT_PROTOCOL]
[SECTION:ROUTINE]
[SECTION:REVIEW]

CONTENT RULES
- IDENTITY: Define the trader's core profile and motivation.
- MARKET_SELECTION: Detail the specific asset classes and criteria for pair selection.
- CORE_EDGE: Explain the technical edge and market conditions required for success.
- RISK: Establish absolute loss caps, position sizing rules, and circuit breakers.
- STRATEGY_RULES: Map HTF structure to LTF triggers. Define valid setups.
- EXECUTION_FLOW: Specific 6-point entry checklist and trigger mechanics.
- EXIT_PROTOCOL: Management of active trades, scaling out, and exit rules.
- ROUTINE: List pre-market prep, in-session focus, and post-market shutdown.
- REVIEW: Weekly review prompts and performance tracking metrics.

FORMAT RULES
- Do not use widget tags, Mermaid blocks, checklist widgets, tool tags, or hidden UI syntax.
- EXECUTION_FLOW must be a plain numbered sequence.
- ROUTINE and RISK must use normal Markdown bullets only.

STYLE
- Be structural, architectural, and highly specific.
- No generic motivation.`;

    const userFacingPrompt = `### Strategy Blueprint Request

- **Style:** ${strategyProfile.tradingStyle}
- **Markets:** ${strategyProfile.markets.join(', ')}
- **Risk:** ${strategyProfile.riskTolerance}
- **Timeframes:** ${strategyProfile.analysisTimeframe} / ${strategyProfile.entryTimeframe}
- **Daily Limit:** ${strategyProfile.dailyTradeLimit} Trades

**Core Motivation**
${strategyProfile.whyITrade}`;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: userFacingPrompt, timestamp: new Date(), kind: 'trading-plan', strategyProfile };
    stickToBottomRef.current = true;
    setMessages(prev => [...prev, userMsg]);

    abortControllerRef.current = new AbortController();
    const requestHistory = recallMemory ? messages.map(m => ({ role: m.role, content: m.content })) : [];
    const contextSummary = buildContextSummary('mentor', requestHistory.length, true);

    try {
      consumeDailyCredit('mentor');
      const res = await modalResearchService.generateResponseWithMeta(
        prompt,
        trades,
        userProfile,
        dailyBias,
        analyticsSnapshot,
        true,
        requestHistory,
        selectedModel,
        true,
        undefined,
        abortControllerRef.current.signal,
        { extraContext: mentorExtraContext }
      );
      processResponse(res.text, Date.now().toString(), {
        isDeepAnalysis: true,
        kind: 'trading-plan',
        strategyProfile,
        contextSummary: { ...contextSummary, modelUsed: res.modelId, fellBack: res.fellBack },
      });
    } catch (error: any) {
      // Refund the credit — it is only spent on a successful answer.
      refundDailyCredit('mentor');
      if (error?.message === "Generation aborted") return;
      console.error("Trading Plan Error:", error);
      addToast({
        type: 'error',
        title: 'Plan Error',
        message: describeAiError(error),
      });
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
      setIsPlanMode(false);
    }
  };

  const renderMarkdownFragment = useCallback((markdown: string, key: string) => (
    <ReactMarkdown
      key={key}
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h1 className="ai-md-h1">{children}</h1>,
        h2: ({ children }) => <h2 className="ai-md-h2">{children}</h2>,
        h3: ({ children }) => <h3 className="ai-md-h3">{children}</h3>,
        p: ({ children }) => <p className="ai-md-p">{children}</p>,
        ul: ({ children }) => <ul className="ai-md-ul">{children}</ul>,
        ol: ({ children }) => <ol className="ai-md-ol">{children}</ol>,
        li: ({ children }) => <li className="ai-md-li">{children}</li>,
        strong: ({ children }) => <strong className="ai-md-strong">{children}</strong>,
        em: ({ children }) => <em className="ai-md-em">{children}</em>,
        blockquote: ({ children }) => <blockquote className="ai-md-blockquote">{children}</blockquote>,
        table: ({ children }) => (
          <div className="my-4 overflow-x-auto rounded-2xl border border-white/10">
            <table className="ai-md-table">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="ai-md-thead">{children}</thead>,
        tbody: ({ children }) => <tbody className="ai-md-tbody">{children}</tbody>,
        tr: ({ children }) => <tr className="ai-md-tr">{children}</tr>,
        th: ({ children }) => <th className="ai-md-th">{children}</th>,
        td: ({ children }) => <td className="ai-md-td">{children}</td>,
        hr: () => <hr className="ai-md-hr" />,
        a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="ai-md-link">{children}</a>,
        code: ({ children, className, ...props }: any) => props.inline
          ? <code className="ai-md-code-inline">{children}</code>
          : <code className={className || 'ai-md-code-block'}>{children}</code>,
        pre: ({ children }) => <pre className="ai-md-pre">{children}</pre>,
      }}
    >
      {markdown}
    </ReactMarkdown>
  ), []);

  const renderStructuredContent = useCallback((rawContent: string, keyPrefix: string) => {
    const blocks = parseStructuredBlocks(rawContent);
    return blocks.map((block, index) => {
      if (block.type === 'text') {
        const markdown = stripStructuredBlocks(block.content);
        if (!markdown.trim()) return null;
        return (
          <div key={`${keyPrefix}-text-${index}`} className="space-y-4">
            {renderMarkdownFragment(markdown, `${keyPrefix}-markdown-${index}`)}
          </div>
        );
      }

      // Diagram blocks are rendered as plain code (not executed) so no
      // mermaid-generated HTML/SVG is ever injected into the page.
      return (
        <div key={`${keyPrefix}-mermaid-${index}`} className="my-4">
          <pre className="ai-md-code-block overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-3 text-xs leading-relaxed">
            <code>{block.widget.body}</code>
          </pre>
        </div>
      );
    });
  }, [renderMarkdownFragment]);

  const renderMessageContent = useCallback((message: Message) => {
    const { content, role, audioAttachment } = message;
    const isUser = role === 'user';
    const isAudioOnlyUserMessage = isUser && Boolean(audioAttachment) && (!content || content === '[Voice recording]');

    let safeContent = isUser ? cleanThinkingTags(content || '') : cleanAssistantResponse(content || '');
    // Generative UI: detect an OpenUI Lang program before markdown normalisation
    // can touch it. Plain replies (and every older saved message) skip this.
    const generativeParts = !isUser && GEN_UI && !audioAttachment ? extractGenerativeParts(safeContent) : null;
    if (!isUser) {
      safeContent = normalizeAssistantMarkdown(safeContent);
      if (message.contextSummary?.mode === 'mentor') {
        safeContent = stripAssistantWidgetMarkup(safeContent);
      }
    }

    const markdownClassName = isUser
      ? 'ai-markdown ai-markdown-user'
      : `ai-markdown ${message.kind === 'analysis' || message.kind === 'strategy' ? 'ai-markdown-report' : 'ai-markdown-standard'} ${isDarkMode ? 'ai-markdown-dark' : 'ai-markdown-light'}`;

    return (
      <div className={markdownClassName}>
        {audioAttachment && (
          <div className={`${isAudioOnlyUserMessage ? '' : 'mb-3 '}rounded-2xl border p-3 ${isDarkMode ? 'border-white/10 bg-black/20' : 'border-slate-300 bg-white/70'}`}>
            <div className={`mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.18em] ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
              <span>{isAudioOnlyUserMessage ? 'Voice' : 'Voice Recording'}</span>
              <span>{formatAudioDuration(audioAttachment.durationMs)}</span>
            </div>
            <VoiceAudioPlayer
              src={audioAttachment.url}
              durationMs={audioAttachment.durationMs}
              isDarkMode={isDarkMode}
              compact={isAudioOnlyUserMessage}
            />
            {audioAttachment.deviceLabel && (
              <p className={`mt-2 text-xs ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>
                Source: {audioAttachment.deviceLabel}
              </p>
            )}
          </div>
        )}
        {isAudioOnlyUserMessage ? null : generativeParts ? (
          <div className="space-y-4">
            {generativeParts.before && renderStructuredContent(normalizeAssistantMarkdown(generativeParts.before), `message-${message.id}-before`)}
            <GenerativeMessage
              code={generativeParts.code}
              isStreaming={message.isStreaming}
              onNavigate={onNavigate}
              fallback={renderStructuredContent(safeContent, `message-${message.id}-fallback`)}
            />
            {generativeParts.after && renderStructuredContent(normalizeAssistantMarkdown(generativeParts.after), `message-${message.id}-after`)}
          </div>
        ) : (
          <div className="space-y-4">
            {renderStructuredContent(safeContent, `message-${message.id}`)}
          </div>
        )}
      </div>
    );
  }, [isDarkMode, renderMarkdownFragment, renderStructuredContent, onNavigate]);

  // Memoized so the React.memo'd MessageRow actually skips re-renders while
  // the parent updates (typing, generation toggles, etc.).
  const renderSectionCards = useCallback((sections: Record<string, string>, message: Message) => {
    const isTradingPlan = message.kind === 'trading-plan' || message.kind === 'strategy';
    const config = isTradingPlan
      ? STRATEGY_SECTION_CONFIG
      : message.kind === 'psychology'
        ? PSYCHOLOGY_SECTION_CONFIG
      : message.kind === 'scaling'
          ? SCALING_SECTION_CONFIG
          : ANALYSIS_SECTION_CONFIG;

    const orderedSections = isTradingPlan
      ? STRATEGY_SECTION_ORDER.filter((key) => sections[key]).map((key) => [key, sections[key]] as const)
      : message.kind === 'psychology'
        ? PSYCHOLOGY_SECTION_ORDER.filter((key) => sections[key]).map((key) => [key, sections[key]] as const)
      : message.kind === 'scaling'
        ? SCALING_SECTION_ORDER.filter((key) => sections[key]).map((key) => [key, sections[key]] as const)
      : message.kind === 'analysis'
        ? (() => {
            const nextSections = ANALYSIS_SECTION_ORDER.filter((key) => sections[key]).map((key) => [key, sections[key]] as const);
            return nextSections.length > 0 ? nextSections : Object.entries(sections);
          })()
      : Object.entries(sections);
    
    return (
      <div className={`relative flex flex-col gap-3 mt-4 ${(isTradingPlan || message.kind === 'analysis' || message.kind === 'psychology' || message.kind === 'scaling') ? 'max-w-4xl' : 'max-w-2xl'}`}>
        {isTradingPlan && message.strategyProfile && (
          <div className={`rounded-2xl border p-5 ${isDarkMode ? 'border-zinc-800 bg-black/70' : 'border-slate-200 bg-slate-50'}`}>
            <div className="flex items-center mb-4">
              <div className="flex items-center gap-2">
                <Workflow size={18} className="text-amber-500" />
                <span className={`text-xs font-semibold uppercase tracking-[0.2em] ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Strategy Blueprint</span>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                ['Style', message.strategyProfile.tradingStyle],
                ['Markets', message.strategyProfile.markets?.join(', ') || 'N/A'],
                ['HTF/LTF', `${message.strategyProfile.analysisTimeframe}/${message.strategyProfile.entryTimeframe}`],
                ['Risk', message.strategyProfile.riskTolerance],
                ['Sessions', message.strategyProfile.tradingSessions?.join(', ') || 'N/A'],
                ['Limit', `${message.strategyProfile.dailyTradeLimit} Trades`],
                ['Target', message.strategyProfile.profitTarget || 'N/A'],
                ['Loss Cap', message.strategyProfile.lossCap || 'N/A'],
              ].map(([label, value]) => (
                <div key={label} className={`rounded-xl p-3 ${isDarkMode ? 'bg-black/20 border border-zinc-800' : 'bg-white border border-slate-200'}`}>
                  <div className={`text-[10px] uppercase tracking-widest mb-1 ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>{label}</div>
                  <div className={`text-sm font-bold truncate ${isDarkMode ? 'text-white' : 'text-slate-900'}`} title={String(value)}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {message.kind === 'scaling' && message.scalingSnapshot && (
          <div className={`rounded-2xl border p-5 ${isDarkMode ? 'border-zinc-800 bg-black/70' : 'border-slate-200 bg-slate-50'}`}>
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={18} className="text-amber-500" />
              <span className={`text-xs font-semibold uppercase tracking-[0.2em] ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Scaling Snapshot</span>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                ['Balance', message.scalingSnapshot.balance],
                ['Net PnL', message.scalingSnapshot.netProfit],
                ['Win Rate', message.scalingSnapshot.winRate],
                ['Profit Factor', message.scalingSnapshot.profitFactor],
                ['Avg Win', message.scalingSnapshot.avgWin],
                ['Avg Loss', message.scalingSnapshot.avgLoss],
                ['Risk Default', message.scalingSnapshot.riskPerTrade],
                ['Best Pair', message.scalingSnapshot.bestPair],
              ].map(([label, value]) => (
                <div key={label} className={`rounded-xl p-3 ${isDarkMode ? 'bg-black/20 border border-zinc-800' : 'bg-white border border-slate-200'}`}>
                  <div className={`text-[10px] uppercase tracking-widest mb-1 ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>{label}</div>
                  <div className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {message.kind === 'psychology' && message.psychologySnapshot && (
          <div className={`rounded-2xl border p-5 ${isDarkMode ? 'border-zinc-800 bg-black/70' : 'border-slate-200 bg-slate-50'}`}>
            <div className="flex items-center gap-2 mb-4">
              <Brain size={18} className="text-rose-500" />
              <span className={`text-xs font-semibold uppercase tracking-[0.2em] ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Psychology Snapshot</span>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                ['Top State', message.psychologySnapshot.topEmotion],
                ['Worst State', message.psychologySnapshot.worstEmotion],
                ['No Plan Trades', String(message.psychologySnapshot.noPlanTrades)],
                ['Followed Plan', String(message.psychologySnapshot.followPlanTrades)],
                ['Recent Losses', String(message.psychologySnapshot.recentLosses)],
                ['Total Trades', String(message.psychologySnapshot.totalTrades)],
              ].map(([label, value]) => (
                <div key={label} className={`rounded-xl p-3 ${isDarkMode ? 'bg-black/20 border border-zinc-800' : 'bg-white border border-slate-200'}`}>
                  <div className={`text-[10px] uppercase tracking-widest mb-1 ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>{label}</div>
                  <div className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className={isTradingPlan ? 'hidden' : 'flex flex-col gap-3'}>
          {orderedSections.map(([key, content], i) => {
            const c = config[key] || { icon: <AlertCircle size={16} />, color: 'text-zinc-400', bg: 'bg-zinc-500/10', borderColor: 'border-zinc-500/20', label: key };
            
            return (
              <motion.div 
                id={`section-${message.id}-${key}`}
                key={i} 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className={`relative break-inside-avoid p-4 rounded-xl border flex flex-col gap-2 transition-all duration-300 ${c.bg} ${c.borderColor} ${isDarkMode ? 'bg-black/50' : 'bg-slate-50'} group hover:border-amber-500/30 shadow-sm mb-4`}
              >
                <div className="flex items-center justify-between">
                  <div className={`flex items-center gap-2 ${c.color}`}>
                    {c.icon}
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em]">{c.label}</span>
                  </div>
                </div>
                
                <div className={`text-sm leading-relaxed ${isDarkMode ? 'text-zinc-300' : 'text-slate-700'}`}>
                  <div className="space-y-4">
                    {renderStructuredContent(content, `section-${key}`)}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    );
  }, [isDarkMode, renderStructuredContent]);

  return (
    <div className={`flex flex-col h-full w-full max-w-full overflow-hidden overflow-x-hidden ${isDarkMode ? 'bg-[#000000]' : 'bg-white'}`}>
      {/* Header — minimal, back to home */}
      <header className={`shrink-0 flex items-center justify-between px-3 h-[52px] border-b ${isDarkMode ? 'bg-[#000000] border-zinc-900' : 'bg-white border-slate-200'}`}>
        <div className="flex items-center gap-2 min-w-0">
          {onBackToHome && (
            <button onClick={onBackToHome} className={`min-h-[44px] min-w-[44px] touch-manipulation rounded-full flex items-center justify-center shrink-0 ${isDarkMode ? 'hover:bg-zinc-900 text-zinc-400 hover:text-white' : 'hover:bg-slate-100 text-slate-500'}`} aria-label="Back to home">
              <ArrowLeft size={18} />
            </button>
          )}
          <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center shrink-0">
              <AssistantIcon size={13} className="text-black" />
            </div>
            <h2 className={`text-[14px] font-semibold truncate ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                {assistantLabel}
              </h2>
        </div>
        
        {/* Model Switcher & New Chat */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-zinc-100 dark:bg-black rounded-lg p-1">
            <button
              onClick={() => handleModelSwitch('deepseek')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                selectedModel === 'deepseek'
                  ? 'bg-[#FF4F00] text-white shadow-sm'
                  : isDarkMode ? 'text-zinc-400 hover:text-zinc-200' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Telescope size={12} />
              <span className="hidden sm:inline">Research</span>
            </button>
            <button
              onClick={() => handleModelSwitch('kimi')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                selectedModel === 'kimi'
                  ? 'bg-[#FF4F00] text-white shadow-sm'
                  : isDarkMode ? 'text-zinc-400 hover:text-zinc-200' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Brain size={12} />
              <span className="hidden sm:inline">Mentor</span>
            </button>
          </div>
          <button 
            onClick={handleNewChat} 
            className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-black text-zinc-300' : 'hover:bg-slate-100 text-slate-700'}`}
            title={`New ${selectedModel === 'deepseek' ? 'Research' : 'Mentor'} Chat`}
          >
            <Plus size={18} />
          </button>
          <button
            onClick={() => setShowModelDrawer(true)}
            className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-black text-zinc-300' : 'hover:bg-slate-100 text-slate-700'}`}
            title="Model Settings"
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      {/* Trading Plan Architect Wizard */}
      <AnimatePresence>
        {showWizard && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={`flex-1 overflow-y-auto p-4 sm:p-6 pb-24 sm:pb-6 ${isDarkMode ? 'bg-[#000000]' : 'bg-white'}`}
          >
            {/* Progress Bar */}
            <div className="max-w-2xl mx-auto mb-8">
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
                  Step {wizardStep + 1} of 8
                </span>
                <button 
                  onClick={() => setShowWizard(false)}
                  className={`text-xs ${isDarkMode ? 'text-zinc-500 hover:text-zinc-300' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  Cancel
                </button>
              </div>
              <div className={`h-1 rounded-full ${isDarkMode ? 'bg-black' : 'bg-slate-200'}`}>
                <motion.div 
                  className="h-full bg-gradient-to-r from-amber-500 to-amber-600 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${((wizardStep + 1) / 8) * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>

            {/* Wizard Content */}
            <div className="max-w-2xl mx-auto">
              {wizardStep === 0 && (
                <div className="space-y-6">
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center mx-auto mb-4">
                      <Target size={32} className="text-white" />
                    </div>
                    <h2 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Trader Identity & Markets</h2>
                    <p className={`mt-2 ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Define your style and market focus</p>
                  </div>
                  
                  <div className="space-y-6">
                    <div>
                      <label className={`block mb-3 text-sm font-semibold uppercase tracking-wider ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>Trading Style</label>
                      <div className="grid grid-cols-2 gap-3">
                        {['Scalper', 'Day Trader', 'Swing Trader', 'Position Trader'].map((style) => (
                          <button
                            key={style}
                            onClick={() => setWizardData({ ...wizardData, tradingStyle: style })}
                            className={`p-4 rounded-xl border-2 text-left transition-all ${
                              wizardData.tradingStyle === style
                                ? 'border-amber-500 bg-amber-500/10'
                                : isDarkMode ? 'border-zinc-800 hover:border-zinc-700' : 'border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{style}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className={`block mb-3 text-sm font-semibold uppercase tracking-wider ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>Asset Classes</label>
                      <div className="flex flex-wrap gap-2">
                        {['Forex', 'Crypto', 'Stocks', 'Options', 'Futures', 'Indices', 'Commodities'].map((market) => (
                          <button
                            key={market}
                            onClick={() => {
                              const next = wizardData.markets.includes(market)
                                ? wizardData.markets.filter(m => m !== market)
                                : [...wizardData.markets, market];
                              setWizardData({ ...wizardData, markets: next });
                            }}
                            className={`px-4 py-2 rounded-full border-2 transition-all ${
                              wizardData.markets.includes(market)
                                ? 'border-amber-500 bg-amber-500/10 text-amber-500'
                                : isDarkMode ? 'border-zinc-800 text-zinc-400' : 'border-slate-200 text-slate-600'
                            }`}
                          >
                            {market}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {wizardStep === 1 && (
                <div className="space-y-6">
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center mx-auto mb-4">
                      <GoalIcon size={32} className="text-white" />
                    </div>
                    <h2 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Goals & Motivation</h2>
                    <p className={`mt-2 ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>What drives your trading performance?</p>
                  </div>
                  
                  <div className="space-y-4">
                    <div>
                      <label className={`block mb-2 text-sm font-medium ${isDarkMode ? 'text-zinc-400' : 'text-slate-700'}`}>Your 'Why' (Core Motivation)</label>
                      <textarea
                        value={wizardData.whyITrade}
                        onChange={(e) => setWizardData({ ...wizardData, whyITrade: e.target.value })}
                        placeholder="e.g., Financial freedom for my family, building a legacy, or master technical analysis..."
                        className={`w-full h-24 p-4 rounded-xl border-2 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/20 ${
                          isDarkMode ? 'bg-black border-zinc-800 text-white placeholder-zinc-600' : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400'
                        }`}
                      />
                    </div>
                    <div>
                      <label className={`block mb-2 text-sm font-medium ${isDarkMode ? 'text-zinc-400' : 'text-slate-700'}`}>Specific Performance Goals</label>
                      <textarea
                        value={wizardData.goals}
                        onChange={(e) => setWizardData({ ...wizardData, goals: e.target.value })}
                        placeholder="e.g., Target 5% monthly return, grow account to $50k, maintain < 3% drawdown..."
                        className={`w-full h-24 p-4 rounded-xl border-2 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/20 ${
                          isDarkMode ? 'bg-black border-zinc-800 text-white placeholder-zinc-600' : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400'
                        }`}
                      />
                    </div>
                  </div>
                </div>
              )}

              {wizardStep === 2 && (
                <div className="space-y-6">
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-500 to-rose-600 flex items-center justify-center mx-auto mb-4">
                      <AlertCircle size={32} className="text-white" />
                    </div>
                    <h2 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Risk & Volume Caps</h2>
                    <p className={`mt-2 ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Protecting your capital with hard limits</p>
                  </div>

                  <div className="space-y-6">
                    <div>
                      <label className={`block mb-3 text-sm font-semibold uppercase tracking-wider ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>Risk Per Trade</label>
                      <div className="grid grid-cols-3 gap-3">
                        {['Conservative (0.5%)', 'Moderate (1%)', 'Aggressive (2%)'].map((risk) => (
                          <button
                            key={risk}
                            onClick={() => setWizardData({ ...wizardData, riskTolerance: risk })}
                            className={`p-3 rounded-xl border-2 text-center transition-all ${
                              wizardData.riskTolerance === risk
                                ? 'border-rose-500 bg-rose-500/10 text-rose-500'
                                : isDarkMode ? 'border-zinc-800 text-zinc-400' : 'border-slate-200 text-slate-600'
                            }`}
                          >
                            <span className="text-sm font-medium">{risk.split(' ')[0]}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className={`block mb-3 text-sm font-semibold uppercase tracking-wider ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>Daily Trade Limit</label>
                      <div className="grid grid-cols-3 gap-3">
                        {['1-2 Trades', '3-5 Trades', 'Unlimited'].map((limit) => (
                          <button
                            key={limit}
                            onClick={() => setWizardData({ ...wizardData, dailyTradeLimit: limit })}
                            className={`p-3 rounded-xl border-2 text-center transition-all ${
                              wizardData.dailyTradeLimit === limit
                                ? 'border-rose-500 bg-rose-500/10 text-rose-500'
                                : isDarkMode ? 'border-zinc-800 text-zinc-400' : 'border-slate-200 text-slate-600'
                            }`}
                          >
                            <span className="text-sm font-medium">{limit}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className={`block mb-2 text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>Daily Loss Cap</label>
                        <input
                          type="text"
                          value={wizardData.lossCap}
                          onChange={(e) => setWizardData({ ...wizardData, lossCap: e.target.value })}
                          placeholder="e.g., -2% or -$500"
                          className={`w-full p-3 rounded-xl border-2 focus:outline-none focus:ring-2 focus:ring-rose-500/20 ${
                            isDarkMode ? 'bg-black border-zinc-800 text-white placeholder-zinc-600' : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400'
                          }`}
                        />
                      </div>
                      <div>
                        <label className={`block mb-2 text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>Profit Target</label>
                        <input
                          type="text"
                          value={wizardData.profitTarget}
                          onChange={(e) => setWizardData({ ...wizardData, profitTarget: e.target.value })}
                          placeholder="e.g., +4% or +$1000"
                          className={`w-full p-3 rounded-xl border-2 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 ${
                            isDarkMode ? 'bg-black border-zinc-800 text-white placeholder-zinc-600' : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400'
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {wizardStep === 3 && (
                <ChallengesStep 
                  isDarkMode={isDarkMode}
                  data={wizardData}
                  challengeOptions={challengeOptions}
                  onChange={(u) => setWizardData({ ...wizardData, ...u })}
                />
              )}

              {wizardStep === 4 && (
                <div className="space-y-6">
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500 to-cyan-600 flex items-center justify-center mx-auto mb-4">
                      <Clock size={32} className="text-white" />
                    </div>
                    <h2 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Logistics & Timing</h2>
                    <p className={`mt-2 ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>When and how long will you trade?</p>
                  </div>

                  <div className="space-y-6">
                    <div>
                      <label className={`block mb-3 text-sm font-semibold uppercase tracking-wider ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>Preferred Sessions</label>
                      <div className="grid grid-cols-2 gap-3">
                        {['London Open', 'New York Open', 'Asian Session', 'NY/London Overlap'].map((session) => (
                          <button
                            key={session}
                            onClick={() => {
                              const next = wizardData.tradingSessions.includes(session)
                                ? wizardData.tradingSessions.filter(s => s !== session)
                                : [...wizardData.tradingSessions, session];
                              setWizardData({ ...wizardData, tradingSessions: next });
                            }}
                            className={`p-4 rounded-xl border-2 text-left transition-all ${
                              wizardData.tradingSessions.includes(session)
                                ? 'border-cyan-500 bg-cyan-500/10 text-cyan-500'
                                : isDarkMode ? 'border-zinc-800 hover:border-zinc-700' : 'border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{session}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className={`block mb-3 text-sm font-semibold uppercase tracking-wider ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>Daily Screen Time</label>
                      <div className="grid grid-cols-2 gap-3">
                        {['Minimal (<1hr)', 'Part-Time (1-3hr)', 'Full-Time (3-5hr)', 'Intense (5hr+)'].map((time) => (
                          <button
                            key={time}
                            onClick={() => setWizardData({ ...wizardData, timeCommitment: time })}
                            className={`p-4 rounded-xl border-2 text-left transition-all ${
                              wizardData.timeCommitment === time
                                ? 'border-cyan-500 bg-cyan-500/10 text-cyan-500'
                                : isDarkMode ? 'border-zinc-800 hover:border-zinc-700' : 'border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{time}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {wizardStep === 5 && (
                <div className="space-y-6">
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center mx-auto mb-4">
                      <LayoutGrid size={32} className="text-white" />
                    </div>
                    <h2 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Technical Framework</h2>
                    <p className={`mt-2 ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Map your structure and execution pairs</p>
                  </div>

                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className={`block mb-2 text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>HTF (Structure)</label>
                        <select
                          value={wizardData.analysisTimeframe}
                          onChange={(e) => setWizardData({ ...wizardData, analysisTimeframe: e.target.value })}
                          className={`w-full p-3 rounded-xl border-2 focus:outline-none ${
                            isDarkMode ? 'bg-black border-zinc-800 text-white' : 'bg-white border-slate-200 text-slate-900'
                          }`}
                        >
                          {['Monthly', 'Weekly', 'Daily', 'H4', 'H1'].map(tf => <option key={tf} value={tf}>{tf}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={`block mb-2 text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>LTF (Entry)</label>
                        <select
                          value={wizardData.entryTimeframe}
                          onChange={(e) => setWizardData({ ...wizardData, entryTimeframe: e.target.value })}
                          className={`w-full p-3 rounded-xl border-2 focus:outline-none ${
                            isDarkMode ? 'bg-black border-zinc-800 text-white' : 'bg-white border-slate-200 text-slate-900'
                          }`}
                        >
                          {['H1', 'M15', 'M5', 'M1', 'Seconds'].map(tf => <option key={tf} value={tf}>{tf}</option>)}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className={`block mb-3 text-sm font-semibold uppercase tracking-wider ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>Primary Watchlist</label>
                      <div className="flex flex-wrap gap-2">
                        {preferredPairOptions.map((pair) => (
                          <button
                            key={pair}
                            onClick={() => {
                              const next = wizardData.preferredPairs.includes(pair)
                                ? wizardData.preferredPairs.filter(p => p !== pair)
                                : [...wizardData.preferredPairs, pair].slice(0, 4);
                              setWizardData({ ...wizardData, preferredPairs: next });
                            }}
                            className={`px-4 py-2 rounded-full border-2 transition-all ${
                              wizardData.preferredPairs.includes(pair)
                                ? 'border-indigo-500 bg-indigo-500/10 text-indigo-500'
                                : isDarkMode ? 'border-zinc-800 text-zinc-400' : 'border-slate-200 text-slate-600'
                            }`}
                          >
                            {pair}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {wizardStep === 6 && (
                <div className="space-y-6">
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center mx-auto mb-4">
                      <Zap size={32} className="text-white" />
                    </div>
                    <h2 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Execution Protocols</h2>
                    <p className={`mt-2 ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>How do you manage active trades?</p>
                  </div>

                  <div className="space-y-6">
                    <div>
                      <label className={`block mb-3 text-sm font-semibold uppercase tracking-wider ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>Exit Mechanic</label>
                      <div className="grid grid-cols-2 gap-3">
                        {['Fixed TP/SL', 'Trailing Stop', 'Tiered Targets (TP1/2)', 'Time-Based Exit'].map((mech) => (
                          <button
                            key={mech}
                            onClick={() => setWizardData({ ...wizardData, exitMechanics: mech })}
                            className={`p-4 rounded-xl border-2 text-left transition-all ${
                              wizardData.exitMechanics === mech
                                ? 'border-violet-500 bg-violet-500/10'
                                : isDarkMode ? 'border-zinc-800 hover:border-zinc-700' : 'border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{mech}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className={`block mb-3 text-sm font-semibold uppercase tracking-wider ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>Trade Management (BE)</label>
                      <div className="grid grid-cols-2 gap-3">
                        {['Move to BE at 1R', 'Move to BE after TP1', 'No Break Even (Hard SL)', 'Dynamic Discretion'].map((mgmt) => (
                          <button
                            key={mgmt}
                            onClick={() => setWizardData({ ...wizardData, tradeManagement: mgmt })}
                            className={`p-4 rounded-xl border-2 text-left transition-all ${
                              wizardData.tradeManagement === mgmt
                                ? 'border-violet-500 bg-violet-500/10'
                                : isDarkMode ? 'border-zinc-800 hover:border-zinc-700' : 'border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{mgmt}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {wizardStep === 7 && (
                <div className="space-y-6">
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-zinc-500 to-zinc-600 flex items-center justify-center mx-auto mb-4">
                      <BarChart3 size={32} className="text-white" />
                    </div>
                    <h2 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Architect Review</h2>
                    <p className={`mt-2 ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Verify your trading plan parameters</p>
                  </div>

                  <div className={`rounded-2xl border p-5 space-y-4 ${isDarkMode ? 'border-zinc-800 bg-black/50' : 'border-slate-200 bg-slate-50'}`}>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                      {[
                        { label: 'Style', value: wizardData.tradingStyle },
                        { label: 'Markets', value: wizardData.markets.join(', ') },
                        { label: 'Risk', value: wizardData.riskTolerance },
                        { label: 'Limit', value: wizardData.dailyTradeLimit },
                        { label: 'HTF/LTF', value: `${wizardData.analysisTimeframe}/${wizardData.entryTimeframe}` },
                        { label: 'Sessions', value: wizardData.tradingSessions.join(', ') },
                        { label: 'Watchlist', value: wizardData.preferredPairs.join(', ') },
                        { label: 'Screen Time', value: wizardData.timeCommitment },
                        { label: 'Challenges', value: mapChallengeLabels(wizardData.challenges).join(', ') },
                        { label: 'Exit', value: wizardData.exitMechanics },
                        { label: 'Management', value: wizardData.tradeManagement },
                        { label: 'Target / Loss Cap', value: [wizardData.profitTarget, wizardData.lossCap].filter(Boolean).join(' / ') }
                      ].filter(item => item.value).map(item => (
                        <div key={item.label} className={`p-3 rounded-xl border ${isDarkMode ? 'border-zinc-800 bg-black/20' : 'border-slate-200 bg-white'}`}>
                          <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">{item.label}</div>
                          <div className={`text-sm font-bold truncate ${isDarkMode ? 'text-white' : 'text-slate-900'}`} title={item.value}>{item.value}</div>
                        </div>
                      ))}
                    </div>
                    <div className={`p-3 rounded-xl border ${isDarkMode ? 'border-zinc-800 bg-black/20' : 'border-slate-200 bg-white'}`}>
                      <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Core Motivation</div>
                      <div className={`text-sm italic ${isDarkMode ? 'text-zinc-300' : 'text-slate-700'}`}>"{wizardData.whyITrade}"</div>
                    </div>
                  </div>

                </div>
              )}

              {/* Navigation Buttons */}
              <div className="flex items-center justify-between mt-8 pt-6 border-t border-black/10 dark:border-white/10">
                <button
                  onClick={() => setWizardStep(wizardStep - 1)}
                  disabled={wizardStep === 0}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
                    wizardStep === 0 
                      ? 'opacity-0 cursor-not-allowed' 
                      : isDarkMode ? 'text-zinc-400 hover:text-white hover:bg-black' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <ArrowLeft size={16} /> Back
                </button>
                {wizardStep < 7 ? (
                  <button
                    onClick={() => setWizardStep(wizardStep + 1)}
                    disabled={!isStepComplete(wizardStep, wizardData)}
                    className={`flex items-center gap-2 px-6 py-2 rounded-lg font-medium transition-all ${
                      isStepComplete(wizardStep, wizardData)
                        ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white hover:from-amber-600 hover:to-amber-700'
                        : isDarkMode ? 'bg-black text-zinc-600 cursor-not-allowed' : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    Next <ArrowRight size={16} />
                  </button>
                ) : (
                  <button
                    onClick={generateStrategy}
                    disabled={isGenerating}
                    title="Generate your Strategy Blueprint from the wizard answers"
                    aria-label="Generate Strategy Blueprint"
                    className={`flex items-center gap-2 px-6 py-2 rounded-lg font-medium transition-all active:scale-95 disabled:cursor-not-allowed disabled:active:scale-100 ${
                      isGenerating
                        ? (isDarkMode ? 'bg-black text-zinc-600 cursor-not-allowed' : 'bg-slate-200 text-slate-400 cursor-not-allowed')
                        : 'bg-gradient-to-r from-amber-500 to-amber-600 text-white hover:from-amber-600 hover:to-amber-700'
                    }`}
                  >
                    {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                    {isGenerating ? 'Architecting...' : 'Generate Blueprint'}
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Chat Area — vertical scroll, no horizontal scroll, zoomed-out minimal */}
      {!showWizard && (
      <main ref={chatContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar relative overscroll-y-contain w-full max-w-full min-w-0">
        <div className="w-full max-w-full min-w-0 overflow-x-hidden">
        <AnimatePresence mode="popLayout">
          {messages.length === 0 && !showWizard ? (
            <motion.div 
              key="empty-state"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center h-full px-4"
            >
              <div className="w-14 h-14 rounded-full bg-black dark:bg-black flex items-center justify-center mb-4">
                <AssistantIcon size={28} className="text-white" />
              </div>
              <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{assistantLabel}</h2>
              <p className={`text-sm mt-1 mb-6 max-w-2xl text-center leading-relaxed whitespace-normal break-normal ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
                {isResearchMode
                  ? 'Research markets, setups, and risk ideas without touching private trading data.'
                  : 'Use your journal context for performance coaching, psychology work, and strategy architecture.'}
              </p>
            </motion.div>
          ) : (
            <div key="chat-messages" className="space-y-0">
              {hiddenMessageCount > 0 && (
                <div className="flex justify-center py-3">
                  <button
                    onClick={() => setVisibleMessageLimit(limit => limit + 60)}
                    className={`px-4 py-1.5 rounded-full border text-xs font-medium transition-colors ${
                      isDarkMode ? 'border-zinc-700 text-zinc-400 hover:bg-white/5' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    Show earlier messages ({hiddenMessageCount})
                  </button>
                </div>
              )}
              {visibleMessages.map((m, i) => (
                <MessageRow
                  key={m.id}
                  message={m}
                  isDarkMode={isDarkMode}
                  userProfile={userProfile}
                  renderMessageContent={renderMessageContent}
                  renderSectionCards={renderSectionCards}
                  assistantIcon={AssistantIcon}
                  onSaveAsNote={m.role === 'assistant' ? handleSaveMessageAsNote : undefined}
                />
              ))}
            </div>
          )}
          {(isGenerating || isTranscribing) && messages.length > 0 && !showWizard && (
            <motion.div 
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 px-4 py-2"
            >
              <div className="flex items-center gap-4 max-w-4xl mx-auto w-full pl-12">
                <div className="flex items-center gap-2">
                <div className="flex gap-1">
                    {[0, 1, 2].map(i => (
                      <motion.div 
                        key={i}
                        animate={{ scale: [1, 1.3, 1], opacity: [0.3, 0.8, 0.3] }}
                        transition={{ repeat: Infinity, duration: 1, delay: i * 0.15 }}
                        className="w-2 h-2 rounded-full bg-zinc-500" 
                      />
                    ))}
                  </div>
                  <span className={`text-xs ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
                    {isTranscribing ? 'Processing voice recording...' : isResearchMode ? 'Researching...' : 'Thinking...'}
                  </span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={messagesEndRef} />

        {/* Floating Controls Container */}
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[70]">
          {/* Scroll to Bottom Button */}
          <AnimatePresence>
            {showScrollToBottom && (
              <motion.button
                initial={{ opacity: 0, scale: 0.9, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 12 }}
                onClick={() => scrollMessagesToEnd(messagesEndRef.current, 'smooth')}
                className={`flex items-center justify-center w-9 h-9 rounded-full shadow-lg transition-all active:scale-95 border backdrop-blur-sm opacity-50 hover:opacity-90 ${
                  isDarkMode
                    ? 'bg-black/45 text-zinc-300 hover:bg-black/70 border-zinc-700/60'
                    : 'bg-white/45 text-slate-600 hover:bg-white/80 border-slate-200/60'
                }`}
                title="Scroll to bottom"
                aria-label="Scroll to latest message"
              >
                <ChevronDown size={18} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
        </div>
      </main>
      )}

      {/* Chat Input Area — minimal ChatGPT / Claude style */}
      {!showWizard && (
      <div className={`sticky bottom-0 z-40 safe-area-inset-bottom ${isDarkMode ? 'bg-[#000000]' : 'bg-white'}`}>
        <div className="max-w-[760px] mx-auto px-3 sm:px-4 py-3">
          
          {/* Features Menu */}
          <AnimatePresence>
            {showFeaturesMenu && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className={`features-menu mb-4 p-4 rounded-2xl shadow-lg max-h-[40vh] overflow-y-auto custom-scrollbar ${
                  isDarkMode ? 'bg-black/95' : 'bg-slate-50/95'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className={`text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                    {assistantLabel}
                  </h3>
                  <button 
                    onClick={() => setShowFeaturesMenu(false)}
                    aria-label="Close features menu"
                    className={`min-h-[44px] min-w-[44px] touch-manipulation p-1 rounded-lg flex items-center justify-center ${isDarkMode ? 'hover:bg-black text-zinc-400' : 'hover:bg-slate-200 text-slate-500'}`}
                  >
                    <X size={14} />
                  </button>
                </div>
                {isResearchMode ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {RESEARCH_QUICK_PROMPTS.map((item) => (
                      <button
                        key={item.title}
                        onClick={() => { void handleSend(item.prompt); setShowFeaturesMenu(false); }}
                        className={`w-full min-w-0 p-4 rounded-xl border text-left transition-all ${
                          isDarkMode ? 'bg-black border-zinc-700 hover:border-zinc-600' : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className={item.color}>{item.icon}</span>
                          <span className={`text-sm font-medium whitespace-normal break-normal ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{item.title}</span>
                        </div>
                        <p className={`text-xs leading-relaxed whitespace-normal break-normal ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>{item.desc}</p>
                      </button>
                    ))}
                  </div>
                ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={() => { handleFeatureRequest('psychology', "Create a psychology protocol for managing tilt and emotional state during drawdown."); setShowFeaturesMenu(false); }}
                    className={`p-4 rounded-xl border text-left transition-all ${
                      isDarkMode ? 'bg-black border-zinc-700 hover:border-zinc-600' : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                    <div className="flex items-center gap-2 mb-1">
                      <Brain size={16} className="text-rose-500" />
                      <span className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Psychology</span>
                    </div>
                    <p className={`text-xs ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Tilt & mindset protocols</p>
                  </button>
                  <button
                    onClick={() => { handleFeatureRequest('scaling', "Create a capital scaling plan based on my current performance, risk profile, and best pairs."); setShowFeaturesMenu(false); }}
                    className={`p-4 rounded-xl border text-left transition-all ${
                      isDarkMode ? 'bg-black border-zinc-700 hover:border-zinc-600' : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                    <div className="flex items-center gap-2 mb-1">
                      <TrendingUp size={16} className="text-amber-500" />
                      <span className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Scaling</span>
                    </div>
                    <p className={`text-xs ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Capital roadmap & risk gates</p>
                  </button>
                </div>
              )}
              </motion.div>
            )}
          </AnimatePresence>
          
          {/* Quick Prompt Menu */}
          <AnimatePresence>
            {showForgeMenu && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                className={`forge-menu mb-4 p-4 rounded-2xl border max-h-[40vh] overflow-y-auto custom-scrollbar ${
                  isDarkMode ? 'bg-black border-zinc-700' : 'bg-slate-50 border-slate-200'
                }`}
              >
                {isResearchMode ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {RESEARCH_QUICK_PROMPTS.map((item, i) => (
                      <button
                        key={i}
                        onClick={() => { handleSend(item.prompt); setShowForgeMenu(false); }}
                        className={`flex flex-col items-center gap-2 p-3 rounded-2xl transition-all hover:scale-105 active:scale-95 ${isDarkMode ? 'hover:bg-white/5' : 'hover:bg-slate-50'}`}
                      >
                        <div className={`p-2 rounded-xl bg-current/10 ${item.color}`}>{item.icon}</div>
                        <span className="text-[9px] font-black uppercase tracking-widest text-center">{item.title}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {FORGE_ITEMS.map((item) => (
                      <button
                        key={item.title}
                        onClick={() => { handleSend(item.prompt); setShowForgeMenu(false); }}
                        className={`flex items-center gap-3 p-3 rounded-2xl border text-left transition-all active:scale-[0.98] ${
                          isDarkMode ? 'border-zinc-800 hover:border-zinc-600 hover:bg-white/5' : 'border-slate-200 hover:border-slate-300 hover:bg-white'
                        }`}
                      >
                        <div className={`shrink-0 p-2.5 rounded-xl ${isDarkMode ? 'bg-black text-emerald-300' : 'bg-slate-100 text-emerald-600'}`}>{item.icon}</div>
                        <div className="min-w-0">
                          <div className={`text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{item.title}</div>
                          <div className={`text-xs ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>{item.desc}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

            {/* Input pill — single rounded bar */}
            <div className={`relative rounded-[24px] border flex items-center shadow-sm ${
              isDarkMode 
                ? 'bg-zinc-900 border-zinc-800 focus-within:border-zinc-700' 
                : 'bg-white border-slate-200 focus-within:border-slate-300'
            }`}>
              {(isRecording || pendingVoiceClip) && (
                <div className={`border-b px-3 pt-3 ${isDarkMode ? 'border-zinc-800' : 'border-slate-200'}`}>
                  {isRecording && (
                    <div className={`mb-3 rounded-2xl border p-3 ${isDarkMode ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-emerald-200 bg-emerald-50/70'}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="relative flex h-12 w-12 items-center justify-center rounded-full">
                            <div className={`absolute inset-0 rounded-full ${isDarkMode ? 'bg-emerald-500/15' : 'bg-emerald-500/10'}`} />
                            {!isRecordingPaused && (
                              <motion.div
                                className={`absolute inset-0 rounded-full ${isDarkMode ? 'border border-emerald-400/40' : 'border border-emerald-500/30'}`}
                                animate={{ scale: [1, 1.18, 1], opacity: [0.8, 0.2, 0.8] }}
                                transition={{ duration: 1.4, repeat: Infinity }}
                              />
                            )}
                            <Mic size={18} className="relative z-10 text-emerald-500" />
                          </div>
                          <div className="min-w-0">
                            <div className={`mt-1 text-sm ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{formatAudioDuration(recordingElapsedMs)}</div>
                          </div>
                        </div>
                        <VoiceWaveform bars={visualizerBars} isDarkMode={isDarkMode} active={!isRecordingPaused} />
                      </div>
                    </div>
                  )}

                  {pendingVoiceClip && (
                    <div className={`mb-3 rounded-2xl border p-3 ${isDarkMode ? 'border-zinc-700 bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div>
                          <div className={`text-xs font-semibold uppercase tracking-[0.2em] ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Voice Preview</div>
                          <div className={`mt-1 text-sm ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                            {formatAudioDuration(pendingVoiceClip.durationMs)}
                            {pendingVoiceClip.deviceLabel ? ` from ${pendingVoiceClip.deviceLabel}` : ''}
                          </div>
                        </div>
                        <button
                          onClick={discardPendingVoiceClip}
                          className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${isDarkMode ? 'bg-black text-zinc-300 hover:bg-black' : 'bg-white text-slate-700 hover:bg-slate-100'}`}
                        >
                          Discard Clip
                        </button>
                      </div>
                      <VoiceAudioPlayer
                        src={pendingVoiceClip.url}
                        durationMs={pendingVoiceClip.durationMs}
                        isDarkMode={isDarkMode}
                      />
                    </div>
                  )}
                </div>
              )}


              <div className="relative flex w-full items-center gap-2 p-2">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    // Don't hijack keys while an IME composition is in progress.
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={inputPlaceholder}
                  className={`min-w-0 flex-1 bg-transparent px-2 py-3 focus:outline-none text-sm ${
                    isDarkMode ? 'text-white placeholder-zinc-500' : 'text-slate-900 placeholder-slate-400'
                  }`}
                  aria-label="Chat input"
                />

                <motion.button 
                  onClick={toggleRecording}
                  disabled={isTranscribing}
                  animate={(isRecording || isTranscribing) ? { 
                    scale: [1, 1.03, 1],
                    backgroundColor: isDarkMode ? ['rgba(16, 185, 129, 0.12)', 'rgba(16, 185, 129, 0.22)', 'rgba(16, 185, 129, 0.12)'] : ['rgba(16, 185, 129, 0.08)', 'rgba(16, 185, 129, 0.16)', 'rgba(16, 185, 129, 0.08)']
                  } : {}}
                  transition={{ repeat: Infinity, duration: 1.4 }}
                  className={`shrink-0 flex items-center gap-2 px-3 py-2.5 rounded-2xl border min-h-[44px] transition-colors ${
                    isRecording || isTranscribing
                      ? (isDarkMode ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10' : 'border-emerald-200 text-emerald-700 bg-emerald-50')
                      : (isDarkMode ? 'border-zinc-700 text-zinc-300 hover:bg-black' : 'border-slate-200 text-slate-700 hover:bg-slate-50')
                  } disabled:opacity-50`}
                  title={isTranscribing ? "Processing voice note..." : (isRecording ? "Stop voice note recording" : "Record a voice note")}
                  aria-label={isTranscribing ? "Processing voice note" : (isRecording ? "Stop voice note recording" : "Record a voice note")}
                >
                  {isTranscribing ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
                </motion.button>

                {isRecording && (
                  <>
                    <button
                      onClick={togglePauseRecording}
                      disabled={isTranscribing}
                      className={`shrink-0 flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-xs font-semibold transition-colors ${
                        isDarkMode ? 'border-zinc-700 text-zinc-200 hover:bg-black' : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                      title={isRecordingPaused ? 'Resume recording' : 'Pause recording'}
                    >
                      {isRecordingPaused ? <Play size={15} /> : <Pause size={15} />}
                      <span className="hidden sm:inline">{isRecordingPaused ? 'Resume' : 'Pause'}</span>
                    </button>

                    <button
                      onClick={() => {
                        stopVoiceRecording('discard');
                        setIsRecording(false);
                      }}
                      disabled={isTranscribing}
                      className={`shrink-0 flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-xs font-semibold transition-colors ${
                        isDarkMode ? 'border-rose-500/30 text-rose-300 hover:bg-rose-500/10' : 'border-rose-200 text-rose-700 hover:bg-rose-50'
                      }`}
                      title="Discard recording"
                    >
                      <X size={15} />
                      <span className="hidden sm:inline">Discard</span>
                    </button>
                  </>
                )}

                <button 
                  onClick={isGenerating ? handleStopGeneration : () => handleSend(undefined, pendingVoiceClip ? {
                    voiceClip: pendingVoiceClip,
                  } : {})} 
                  disabled={(!isGenerating && !canSendMessage) || isRecording || isTranscribing} 
                  className={`shrink-0 p-2.5 rounded-2xl min-h-[44px] min-w-[44px] flex items-center justify-center transition-all active:scale-95 ${
                    isGenerating
                      ? (isDarkMode ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'bg-slate-900 text-white hover:bg-slate-800')
                      : (canSendMessage
                        ? (isDarkMode ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'bg-slate-900 text-white hover:bg-slate-800')
                        : (isDarkMode ? 'bg-black text-zinc-600' : 'bg-slate-100 text-slate-400'))
                  } disabled:cursor-not-allowed disabled:active:scale-100`}
                  title={isGenerating ? "Stop Generating" : "Send Message"}
                >
                  {isGenerating ? (
                    <StopCircle size={16} />
                  ) : (
                    <CornerDownLeft size={16} />
                  )}
                </button>
              </div>
            </div>
            
            <div className="mt-2 flex items-center justify-start">
              <div className={`text-[11px] font-medium ${isCreditWarning ? 'text-red-500' : isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
                  {getCurrentCreditLabel()}
                </div>
            </div>
        </div>
      </div>
      )}

      {/* Model Settings Bottom Drawer */}
      <AnimatePresence>
        {showModelDrawer && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowModelDrawer(false)} className="fixed inset-0 bg-black/50 z-[60]" />
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 28, stiffness: 320 }} className={`fixed bottom-0 left-0 right-0 z-[61] rounded-t-[24px] max-h-[75vh] overflow-hidden flex flex-col ${isDarkMode ? 'bg-zinc-900 border border-zinc-800' : 'bg-white border border-slate-200'}`}>
              <div className="flex justify-center pt-3 pb-2"><div className={`w-10 h-1 rounded-full ${isDarkMode ? 'bg-zinc-700' : 'bg-slate-200'}`} /></div>
              <div className="px-5 pb-3 flex items-center justify-between">
                <h3 className={`text-[15px] font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Model</h3>
                <button onClick={() => setShowModelDrawer(false)} className={`min-h-[44px] min-w-[44px] touch-manipulation rounded-full grid place-items-center ${isDarkMode ? 'bg-zinc-800 text-zinc-400' : 'bg-slate-100 text-slate-500'}`} aria-label="Close model settings"><X size={14} /></button>
              </div>
              <p className={`px-5 pb-3 text-xs ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>Switch any time. Applies to next message.</p>
              <div className="px-3 pb-6 overflow-y-auto space-y-2">
                {[
                  { id: 'nvidia/nemotron-3-super-120b-a12b', label: 'Nemotron 3.5 Super', desc: 'Balanced reasoning & speed', badge: 'FAST', provider: 'NVIDIA' },
                  { id: 'nvidia/nemotron-3-ultra-550b-a55b', label: 'Nemotron 3.5 Ultra', desc: 'Strongest reasoning', badge: 'POWERFUL', provider: 'NVIDIA' },
                  { id: 'z-ai/glm-5.3-flash', label: 'GLM 5.3 Flash', desc: 'Ultra-fast responses', badge: 'FLASH', provider: 'Z-AI' },
                  { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', label: 'Nemotron 3 Nano 30B', desc: 'Fastest reasoning 30B', badge: 'FAST', provider: 'NVIDIA' },
                  { id: 'meta/llama-3.2-11b-vision-instruct', label: 'Llama 3.2 11B Vision', desc: 'Vision + fast text', badge: 'LIGHTNING', provider: 'Meta' },
                  { id: 'muse-spark-1.2-contributor-free', label: 'Muse Spark 1.2 Free', desc: 'Free - Meta • default', badge: 'FREE', provider: 'Zen / Meta' },
                  { id: 'big-pickle', label: 'Big Pickle', desc: 'Free - stealth model', badge: 'FREE', provider: 'Zen' },
                  { id: 'mimo-v2.5-free', label: 'MiMo V2.5 Free', desc: 'Free - Xiaomi', badge: 'FREE', provider: 'Zen / Xiaomi' },
                  { id: 'ling-3.0-flash-fin-free', label: 'Ling 3.0 Flash Fin Free', desc: 'Free - finance', badge: 'FREE', provider: 'Zen' },
                  { id: 'nemotron-3-ultra-free', label: 'Nemotron 3 Ultra Free', desc: 'Free - NVIDIA', badge: 'FREE', provider: 'Zen / NVIDIA' },
                  { id: 'nemotron-3.5-lightning-free', label: 'Nemotron 3.5 Lightning Free', desc: 'Free - NVIDIA', badge: 'FREE', provider: 'Zen / NVIDIA' },
                  { id: 'muse-spark-1.3-contributor-free', label: 'Muse Spark 1.3 Free', desc: 'Free - Meta', badge: 'FREE', provider: 'Zen / Meta' },
                ].map(m => {
                  const active = selectedChatModelId === m.id;
                  return (
                    <button key={m.id} onClick={() => { setSelectedChatModelId(m.id); setShowModelDrawer(false); addToast({ type: 'info', title: 'Model Changed', message: `Model: ${m.label}` }); }} className={`w-full text-left px-4 py-3.5 rounded-2xl border flex items-center justify-between transition-all ${active ? (isDarkMode ? 'bg-white text-black border-white' : 'bg-slate-900 text-white border-slate-900') : (isDarkMode ? 'bg-zinc-800 border-zinc-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-900')}`}>
                      <div className="min-w-0 flex-1"><div className="text-[14px] font-semibold flex items-center gap-2 flex-wrap">{m.label} <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold tracking-widest ${active ? 'bg-white/20' : isDarkMode ? 'bg-zinc-700 text-zinc-300' : 'bg-slate-200 text-slate-600'}`}>{m.badge}</span><span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium tracking-wide ${active ? 'bg-black/10 text-black/60' : isDarkMode ? 'bg-zinc-700/60 text-zinc-400' : 'bg-slate-100 text-slate-500'}`}>{(m as any).provider}</span></div><div className={`text-xs mt-0.5 ${active ? 'opacity-70' : isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>{m.desc}</div><div className={`text-[10px] mt-1 font-mono truncate ${active ? 'opacity-50' : 'opacity-40'}`}>{m.id}</div></div>
                      {active && <Check size={18} className="shrink-0 ml-3" />}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      </div>
  );
};

const isPrivateTradingRequest = (input: string) => {
  const normalized = input.toLowerCase();
  const phrases = [
    'my trades',
    'my trade',
    'my journal',
    'my results',
    'my performance',
    'my win rate',
    'my balance',
    'my pnl',
    'my drawdown',
    'my psychology',
    'my strategy',
    'my risk',
    'based on my',
    'analyze my',
    'review my',
    'audit my',
    'what should i change',
    'how am i doing',
  ];
  return phrases.some((phrase) => normalized.includes(phrase));
};

export default AIChat;

