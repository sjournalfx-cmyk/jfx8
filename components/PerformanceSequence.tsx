import React from 'react';
import { clsx } from 'clsx';
import { MOCK_TRADES } from './landing-mock-data';
import { 
  TrendingUp, TrendingDown, ChevronDown, Star, Eye, X, Brain,
  Image as ImageIcon, Clock, Edit3, Trash2, Mic, Telescope
} from 'lucide-react';

// AIChatDemo: Premium AI chat demo for the landing page
// Typewriter text animation, inline stat cards, Mentor → Research mode transition
const TypewriterText: React.FC<{ text: string; speed?: number }> = ({ text, speed = 18 }) => {
  const [displayed, setDisplayed] = React.useState('');
  const indexRef = React.useRef(0);

  React.useEffect(() => {
    setDisplayed('');
    indexRef.current = 0;
    const interval = setInterval(() => {
      indexRef.current++;
      setDisplayed(text.slice(0, indexRef.current));
      if (indexRef.current >= text.length) clearInterval(interval);
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed]);

  return (
    <span>
      {displayed}
      {displayed.length < text.length && (
        <span className="inline-block w-[2px] h-[13px] bg-[#FF4F01] ml-0.5 align-middle chat-demo-cursor" />
      )}
    </span>
  );
};

const AIChatDemo: React.FC = () => {
  const CursorFlow: React.FC = () => {
    const [phase, setPhase] = React.useState(0);
    const contentEndRef = React.useRef<HTMLDivElement | null>(null);

    React.useEffect(() => {
      const steps: Array<{ phase: number; delay: number }> = [
        { phase: 0, delay: 1200 },
        { phase: 1, delay: 700 },
        { phase: 2, delay: 1800 },
        { phase: 3, delay: 650 },
        { phase: 4, delay: 700 },
        { phase: 5, delay: 1800 },
        { phase: 6, delay: 1200 },
      ];

      let timer: ReturnType<typeof setTimeout> | undefined;

      const run = (index: number) => {
        const current = steps[index];
        setPhase(current.phase);
        timer = setTimeout(() => run((index + 1) % steps.length), current.delay);
      };

      run(0);

      return () => {
        if (timer) clearTimeout(timer);
      };
    }, []);

    React.useEffect(() => {
      contentEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [phase]);

    const mentorActive = phase === 1 || phase === 2 || phase === 3;
    const researchActive = phase === 4 || phase === 5 || phase === 6;
    const mentorMessageVisible = phase === 2;
    const researchMessageVisible = phase === 5;
    const cursorVisible = phase !== 0 && phase !== 3 && phase !== 6;

    const cursorStyle = (() => {
      if (phase === 1 || phase === 2) return { left: '24%', top: '13%', opacity: 1 };
      if (phase === 4 || phase === 5) return { left: '76%', top: '13%', opacity: 1 };
      return { left: '50%', top: '78%', opacity: 0 };
    })();

    const ModeCard = ({
      active,
      icon,
      label,
      tone,
    }: {
      active: boolean;
      icon: React.ReactNode;
      label: string;
      tone: 'mentor' | 'research';
    }) => {
      const isMentor = tone === 'mentor';
      return (
        <div
          className="flex-1 rounded-2xl border px-4 py-3.5"
          style={{
            background: active ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
            borderColor: active ? (isMentor ? 'rgba(255,79,1,0.45)' : 'rgba(34,211,238,0.45)') : 'rgba(255,255,255,0.08)',
            boxShadow: active ? '0 18px 40px rgba(0,0,0,0.20)' : 'none',
            transform: active ? 'translateY(-1px)' : 'translateY(0)',
            transition: 'background 220ms ease, border-color 220ms ease, box-shadow 220ms ease, transform 220ms ease',
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="h-10 w-10 rounded-xl flex items-center justify-center"
              style={{
                background: isMentor ? 'rgba(255,79,1,0.12)' : 'rgba(34,211,238,0.12)',
                color: isMentor ? '#FF7A45' : '#67E8F9',
                border: `1px solid ${isMentor ? 'rgba(255,79,1,0.22)' : 'rgba(34,211,238,0.22)'}`,
              }}
            >
              {icon}
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
                {isMentor ? 'Private context' : 'Market research'}
              </div>
              <div className="text-[15px] font-semibold text-white">{label}</div>
            </div>
          </div>
        </div>
      );
    };

    const Bubble = ({
      side,
      icon,
      title,
      body,
      accent,
    }: {
      side: 'left' | 'right';
      icon: React.ReactNode;
      title: string;
      body: string;
      accent: 'mentor' | 'research';
    }) => {
      const isMentor = accent === 'mentor';
      return (
        <div className={`rounded-2xl border border-white/[0.04] bg-white/[0.02] px-4 py-3.5 ${side === 'right' ? 'text-right' : ''}`}>
          <div className={`flex gap-3 ${side === 'right' ? 'flex-row-reverse' : ''}`}>
            <div
              className="shrink-0 h-8 w-8 rounded-full flex items-center justify-center"
              style={{
                background: isMentor ? 'rgba(255,79,1,0.12)' : 'rgba(34,211,238,0.12)',
                color: isMentor ? '#FF7A45' : '#67E8F9',
                border: `1px solid ${isMentor ? 'rgba(255,79,1,0.20)' : 'rgba(34,211,238,0.20)'}`,
              }}
            >
              {icon}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-zinc-300">{title}</div>
              <div className="mt-1 text-[13px] leading-relaxed text-zinc-400">
                {body === '__mentor_tip__' ? <TypewriterText text="Late-week liquidity thins and spreads widen, so the edge fades faster after the mid-session window." /> : body === '__research_tip__' ? <TypewriterText text="London into New York has the cleanest read because participation is stronger and breakouts hold better." speed={16} /> : body}
              </div>
            </div>
          </div>
        </div>
      );
    };

    const Cursor = () => (
      <div
        className="absolute z-30 pointer-events-none select-none"
        style={{
          ...cursorStyle,
          transform: `translate(-50%, -50%) scale(${phase === 1 || phase === 4 ? 1.02 : 0.96})`,
          transition: 'left 650ms ease, top 650ms ease, opacity 250ms ease, transform 180ms ease',
          opacity: cursorVisible ? 1 : 0,
        }}
      >
        <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
          <path d="M5 4 L22 15.5 L14 17 L18 26 L14.2 27 L10.4 18.2 L5 23 Z" fill="white" stroke="#0A0A0A" strokeWidth="1.1" />
        </svg>
      </div>
    );

    return (
      <div className="w-full h-full flex flex-col bg-[#101013] text-white overflow-hidden relative font-sans">
        <div className="absolute top-1/4 left-1/4 w-[180px] h-[180px] rounded-full bg-[#FF4F01]/5 blur-[60px] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-[180px] h-[180px] rounded-full bg-[#22D3EE]/5 blur-[60px] pointer-events-none" />

        <div className="px-4 pt-4 shrink-0">
          <div className="flex gap-3 rounded-[24px] border border-white/[0.08] bg-white/[0.03] p-3">
            <ModeCard active={mentorActive || phase === 0} icon={<Brain size={15} />} label="JFX MENTOR" tone="mentor" />
            <ModeCard active={researchActive} icon={<Telescope size={15} />} label="JFX RESEARCH" tone="research" />
          </div>
        </div>

        <div className="relative flex-1 px-4 py-4">
          <div className="relative h-full rounded-[28px] border border-white/[0.06] bg-[#121217] overflow-hidden">
            <Cursor />

            <div className="absolute inset-0 p-4 sm:p-5">
              <div
                className="h-full flex flex-col gap-3"
                style={{
                  opacity: mentorMessageVisible ? 1 : 0,
                  transition: 'opacity 220ms ease',
                  pointerEvents: mentorMessageVisible ? 'auto' : 'none',
                }}
              >
                <Bubble side="right" icon={<span className="text-[10px] font-bold">U</span>} title="You" body="Why are Fridays weaker?" accent="mentor" />
                <Bubble side="left" icon={<Brain size={16} />} title="JFX MENTOR" body="__mentor_tip__" accent="mentor" />
                <Bubble side="right" icon={<span className="text-[10px] font-bold">U</span>} title="You" body="What should I avoid?" accent="mentor" />
                <Bubble side="left" icon={<Brain size={16} />} title="JFX MENTOR" body="Avoid new entries after the Friday cutoff and keep the cleaner sessions." accent="mentor" />
              </div>

              <div
                className="h-full flex flex-col gap-3"
                style={{
                  opacity: researchMessageVisible ? 1 : 0,
                  transition: 'opacity 220ms ease',
                  pointerEvents: researchMessageVisible ? 'auto' : 'none',
                }}
              >
                <Bubble side="right" icon={<span className="text-[10px] font-bold">U</span>} title="You" body="Which setup is worth studying?" accent="research" />
                <Bubble side="left" icon={<Telescope size={16} />} title="JFX RESEARCH" body="__research_tip__" accent="research" />
                <Bubble side="right" icon={<span className="text-[10px] font-bold">U</span>} title="You" body="And the weak spot?" accent="research" />
                <Bubble side="left" icon={<Telescope size={16} />} title="JFX RESEARCH" body="Late Friday is the weakest window because participation drops and false moves become more common." accent="research" />
              </div>

              <div
                className="absolute inset-0 flex items-center justify-center px-6"
                style={{
                  opacity: phase === 0 || phase === 3 || phase === 6 ? 1 : 0,
                  transition: 'opacity 220ms ease',
                }}
              >
                <div className="text-center max-w-md">
                  <div className="text-[12px] uppercase tracking-[0.24em] text-zinc-500 font-semibold">
                    Choose a mode
                  </div>
                  <div className="mt-2 text-[14px] text-zinc-400">
                    The cursor will open Mentor first, then Research.
                  </div>
                </div>
              </div>
            </div>

            <div ref={contentEndRef} />
          </div>
        </div>
      </div>
    );
  };

  return <CursorFlow />;

  const [step, setStep] = React.useState(0);
  const chatEndRef = React.useRef<HTMLDivElement | null>(null);
  const [showGridSweep, setShowGridSweep] = React.useState(false);

  // step 0  = user msg 1 (always visible)
  // step 1  = AI thinking (Mentor)
  // step 2  = AI response 1 (Mentor) — with typewriter
  // step 3  = user msg 2
  // step 4  = AI thinking (Mentor)
  // step 5  = AI response 2 (Mentor)
  // step 6  = user msg 3
  // step 7  = AI thinking (Research)
  // step 8  = AI response 3 (Research) — with typewriter
  // step 9  = pause then loop

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = [
      // [nextStep, delayMs]
      [1, 1600],
      [2, 1800],
      [3, 3200],
      [4, 1200],
      [5, 1800],
      [6, 3800],
      [7, 1200],
      [8, 1800],
      [9, 4200],
      [0, 1800], // reset
    ] as const;

    let i = 0;
    const tick = () => {
      const [nextStep, delay] = schedule[i % schedule.length];
      setStep(nextStep);
      i++;
      timer = setTimeout(tick, delay);
    };

    timer = setTimeout(tick, schedule[0][1]);

    return () => { if (timer) clearTimeout(timer); };
  }, []);

  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [step]);

  const isResearch = step >= 7;

  React.useEffect(() => {
    if (isResearch) {
      setShowGridSweep(true);
      const timer = setTimeout(() => setShowGridSweep(false), 2200);
      return () => clearTimeout(timer);
    } else {
      setShowGridSweep(false);
    }
  }, [isResearch]);

  const activeMode = isResearch ? 'research' : 'mentor';
  const accentColor = isResearch ? '#22D3EE' : '#FF4F01';

  const UserBubble: React.FC<{ text: string }> = ({ text }) => (
    <div className="flex justify-end animate-in">
      <div className="max-w-[82%] flex items-start gap-3">
        <div className="rounded-2xl rounded-tr-md bg-white/[0.06] border border-white/[0.08] px-4 py-3">
          <p className="text-[13px] text-zinc-200 leading-relaxed">{text}</p>
        </div>
        <div className="shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-zinc-700 to-zinc-800 border border-white/10 flex items-center justify-center text-[10px] font-bold text-white shadow-sm">
          U
        </div>
      </div>
    </div>
  );

  const ThinkingIndicator: React.FC<{ label: string }> = ({ label }) => (
    <div className="flex items-start gap-3 animate-in">
      <div
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center shadow-sm transition-all duration-700"
        style={{
          background: `${accentColor}15`,
          border: `1px solid ${accentColor}30`,
          boxShadow: `0 0 16px ${accentColor}18`,
        }}
      >
        {isResearch ? <Telescope size={13} style={{ color: accentColor }} /> : <Brain size={13} style={{ color: accentColor }} />}
      </div>
      <div className="flex items-center gap-2 py-2">
        <div className="flex items-center gap-1">
          <span className="chat-demo-dot transition-colors duration-700" style={{ background: accentColor, animationDelay: '0ms' }} />
          <span className="chat-demo-dot transition-colors duration-700" style={{ background: accentColor, animationDelay: '160ms' }} />
          <span className="chat-demo-dot transition-colors duration-700" style={{ background: accentColor, animationDelay: '320ms' }} />
        </div>
        <span className="text-[11px] text-zinc-500 font-medium">{label}</span>
      </div>
    </div>
  );

  const AIBubble: React.FC<{ children: React.ReactNode; label: string }> = ({ children, label }) => (
    <div className="flex items-start gap-3 animate-in">
      <div
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center shadow-sm transition-all duration-700"
        style={{
          background: `${accentColor}15`,
          border: `1px solid ${accentColor}30`,
        }}
      >
        {activeMode === 'research' ? <Telescope size={13} style={{ color: accentColor }} /> : <Brain size={13} style={{ color: accentColor }} />}
      </div>
      <div className="max-w-[88%] min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] transition-all duration-700" style={{ color: accentColor }}>{label}</span>
        </div>
        <div className="rounded-2xl rounded-tl-md bg-white/[0.03] border border-white/[0.06] px-4 py-3">
          {children}
        </div>
      </div>
    </div>
  );

  return (
    <div className="w-full h-full flex flex-col bg-[#0C0C0F] text-white overflow-hidden relative font-sans">
      {/* Ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] h-[180px] rounded-full blur-[80px] pointer-events-none transition-colors duration-1000" style={{ background: `${accentColor}08` }} />

      {/* Quantum Grid sweep effect */}
      {showGridSweep && (
        <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
          <div className="absolute left-0 w-full h-[2px] bg-cyan-400 shadow-[0_0_20px_#22d3ee,0_0_40px_#22d3ee] animate-laser-sweep" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(34,211,238,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.02)_1px,transparent_1px)] bg-[size:16px_16px] opacity-100 animate-pulse-fast" />
        </div>
      )}

      {/* Header — mode switcher */}
      <div className="shrink-0 px-4 pt-3.5 pb-2 border-b border-white/[0.05]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 relative h-6 overflow-hidden">
            <div className="relative w-5 h-5 flex items-center justify-center rounded-md transition-all duration-700" style={{ background: `${accentColor}18` }}>
              <div className={clsx(
                "absolute inset-0 flex items-center justify-center transition-all duration-700 transform",
                isResearch ? "opacity-0 rotate-90 scale-75" : "opacity-100 rotate-0 scale-100"
              )}>
                <Brain size={11} style={{ color: '#FF4F01' }} />
              </div>
              <div className={clsx(
                "absolute inset-0 flex items-center justify-center transition-all duration-700 transform",
                isResearch ? "opacity-100 rotate-0 scale-100" : "opacity-0 -rotate-90 scale-75"
              )}>
                <Telescope size={11} style={{ color: '#22D3EE' }} />
              </div>
            </div>
            <div className="relative h-5 w-28 overflow-hidden">
              <span className={clsx(
                "absolute left-0 top-0 text-[13px] font-semibold text-white transition-all duration-700 transform",
                isResearch ? "-translate-y-full opacity-0" : "translate-y-0 opacity-100"
              )}>
                JFX Mentor
              </span>
              <span className={clsx(
                "absolute left-0 top-0 text-[13px] font-semibold text-white transition-all duration-700 transform",
                isResearch ? "translate-y-0 opacity-100" : "translate-y-full opacity-0"
              )}>
                JFX Research
              </span>
            </div>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)] ml-1" />
          </div>
          <div className="flex items-center gap-1.5 bg-white/[0.03] border border-white/[0.06] rounded-full p-0.5 relative select-none">
            <button
              className={clsx(
                "px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-[0.18em] transition-all duration-500 z-10",
                !isResearch ? "text-[#FF9A63]" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              Mentor
            </button>
            <button
              className={clsx(
                "px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-[0.18em] transition-all duration-500 z-10",
                isResearch ? "text-[#67E8F9]" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              Research
            </button>
            <div 
              className="absolute top-0.5 bottom-0.5 rounded-full transition-all duration-500 ease-out"
              style={{
                left: isResearch ? 'calc(50% + 1px)' : '2px',
                width: 'calc(50% - 3px)',
                background: isResearch ? 'rgba(34,211,238,0.12)' : 'rgba(255,79,1,0.12)',
                border: `1px solid ${isResearch ? 'rgba(34,211,238,0.25)' : 'rgba(255,79,1,0.25)'}`
              }}
            />
          </div>
        </div>
      </div>

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5 scroll-smooth custom-scrollbar">
        {/* Always-visible user message */}
        <UserBubble text="Why am I consistently losing on USD/JPY on Fridays?" />

        {/* AI thinking 1 */}
        {step === 1 && <ThinkingIndicator label="Scanning MT5 execution logs…" />}

        {/* AI response 1 */}
        {step >= 2 && step < 9 && (
          <AIBubble label="JFX Mentor">
            <p className="text-[13px] text-zinc-300 leading-relaxed">
              {step === 2 ? (
                <TypewriterText text="I found a recurring pattern. On Fridays between 16:00–18:00 UTC, your average hold time drops 74% while spread impact peaks from late-week liquidity contraction." />
              ) : (
                'I found a recurring pattern. On Fridays between 16:00–18:00 UTC, your average hold time drops 74% while spread impact peaks from late-week liquidity contraction.'
              )}
            </p>
          </AIBubble>
        )}

        {/* User message 2 */}
        {step >= 3 && step < 9 && <UserBubble text="How many trades does this affect?" />}

        {/* AI thinking 2 */}
        {step === 4 && <ThinkingIndicator label="Counting affected entries…" />}

        {/* AI response 2 */}
        {step >= 5 && step < 9 && (
          <AIBubble label="JFX Mentor">
            <p className="text-[13px] text-zinc-300 leading-relaxed">
              {step === 5 ? (
                <TypewriterText text="Across the last 90 days, 34 of your 47 Friday USD/JPY entries fell inside that window." />
              ) : (
                'Across the last 90 days, 34 of your 47 Friday USD/JPY entries fell inside that window.'
              )}
            </p>
          </AIBubble>
        )}

        {/* User message 3 — switches to Research mode */}
        {step >= 6 && step < 9 && <UserBubble text="What market conditions cause this?" />}

        {/* AI thinking 3 (Research) */}
        {step === 7 && <ThinkingIndicator label="Scanning market structure…" />}

        {/* AI response 3 (Research) */}
        {step >= 8 && step < 9 && (
          <AIBubble label="JFX Research">
            <p className="text-[13px] text-zinc-300 leading-relaxed">
              <TypewriterText text="Late-week liquidity thins as dealers square books. The London–NY overlap is your cleanest window — breakouts hold better with stronger participation. After 15:00 UTC on Fridays, false moves increase sharply." speed={16} />
            </p>
          </AIBubble>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Frosted input bar */}
      <div className="shrink-0 px-4 py-3 border-t border-white/[0.05] bg-[#0C0C0F]/80 backdrop-blur-md">
        <div className="flex items-center gap-2.5 rounded-xl bg-white/[0.04] border border-white/[0.07] px-3.5 py-2.5">
          <span className="flex-1 text-[12px] text-zinc-600 font-medium">Reply to {isResearch ? 'JFX Research' : 'JFX Mentor'}…</span>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-white/[0.06] flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors">
              <Mic size={13} />
            </div>
            <div className="w-6 h-6 rounded-lg flex items-center justify-center text-white shadow-sm" style={{ background: accentColor }}>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14m-7-7l7 7-7 7" /></svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// MiniTradeHistory: compact trade overview matching the real Journal UI
const MiniTradeHistory: React.FC = () => {
  const [expandedTradeId, setExpandedTradeId] = React.useState<string | null>(null);
  const trades = MOCK_TRADES.slice(0, 8);
  const totalTrades = MOCK_TRADES.length;
  const wins = MOCK_TRADES.filter(t => t.result === 'Win').length;
  const netPnl = MOCK_TRADES.reduce((sum, t) => sum + t.pnl, 0);

  const safePnL = (value: unknown): number => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  const formatDuration = (openTime?: string, closeTime?: string) => {
    if (!openTime || !closeTime) return null;
    try {
      const startStr = openTime.includes(' ') && !openTime.includes('T') ? openTime.replace(' ', 'T') : openTime;
      const endStr = closeTime.includes(' ') && !closeTime.includes('T') ? closeTime.replace(' ', 'T') : closeTime;
      const start = new Date(startStr);
      const end = new Date(endStr);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
      const diff = end.getTime() - start.getTime();
      if (diff < 0) return '0s';
      const totalSeconds = Math.floor(diff / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      const parts: string[] = [];
      if (hours > 0) parts.push(`${hours}h`);
      if (minutes > 0) parts.push(`${minutes}m`);
      if (seconds > 0 || (hours === 0 && minutes === 0)) parts.push(`${seconds}s`);
      return parts.join(' ');
    } catch { return null; }
  };

  const toggleExpand = (id: string) => {
    setExpandedTradeId(prev => prev === id ? null : id);
  };

  return (
    <div className="w-full h-full flex flex-col text-zinc-200 font-sans overflow-hidden bg-[#0D0D10]">
      <div className="flex items-center gap-4 px-5 py-3.5 border-b border-white/[0.08] shrink-0 bg-gradient-to-r from-white/[0.02] to-transparent">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-500 font-medium">Trades</span>
          <span className="text-white text-sm font-bold">{totalTrades}</span>
        </div>
        <div className="w-px h-4 bg-white/[0.09]" />
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-500 font-medium">Win Rate</span>
          <span className="text-emerald-500 text-sm font-bold">{Math.round((wins / totalTrades) * 100)}%</span>
        </div>
        <div className="w-px h-4 bg-white/[0.09]" />
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-500 font-medium">Net P&L</span>
          <span className={`text-sm font-bold ${netPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
            {netPnl >= 0 ? '+' : ''}${netPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {trades.map((trade) => (
          <React.Fragment key={trade.id}>
            <div
              className={`grid grid-cols-[1.45fr_1fr_1.15fr_1.15fr_0.9fr_28px] px-4 py-3.5 border-b items-center transition-all rounded-2xl mt-0.5 cursor-pointer ${
                expandedTradeId === trade.id
                  ? 'bg-white/[0.04] border-white/10 border'
                  : 'border-white/[0.06] hover:bg-white/[0.025] border'
              }`}
              onClick={() => toggleExpand(trade.id)}
            >
              <div className="col-span-1 pl-1">
                <p className="font-semibold text-[15px] text-white tracking-[-0.02em]">{trade.date}</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">{trade.time}</p>
              </div>
              <div className="col-span-1 font-bold text-[16px] text-white tracking-[-0.02em]">{trade.pair}</div>
              <div className="col-span-1 text-[12px] text-zinc-400">{trade.session}</div>
              <div className="col-span-1">
                <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold ${
                  trade.direction === 'Long' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'
                }`}>
                  {trade.direction === 'Long' ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                  {trade.direction}
                </span>
              </div>
              <div className="col-span-1 text-right">
                <p className={`font-mono font-bold text-sm ${
                  safePnL(trade.pnl) > 0 ? 'text-emerald-500' : safePnL(trade.pnl) < 0 ? 'text-rose-500' : 'text-zinc-500'
                }`}>
                  {safePnL(trade.pnl) > 0 ? '+' : safePnL(trade.pnl) < 0 ? '-' : ''}${Math.abs(safePnL(trade.pnl)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className={`text-[10px] font-bold uppercase ${
                  trade.result === 'Win' ? 'text-emerald-500' : trade.result === 'Loss' ? 'text-rose-500' : 'text-zinc-500'
                }`}>
                  {trade.result} {trade.rr > 0 ? `(${trade.rr}R)` : ''}
                </p>
              </div>
              <div className="col-span-1 flex justify-center">
                <div className={`p-1 rounded-full transition-all ${expandedTradeId === trade.id ? 'rotate-180 bg-white/10 text-white' : 'text-zinc-500'}`}>
                  <ChevronDown size={16} />
                </div>
              </div>
            </div>

            {expandedTradeId === trade.id && (
              <div className="mx-3 mt-0.5 mb-3 rounded-[22px] overflow-hidden border border-white/[0.08] bg-[#111114] shadow-xl">
                <div className="px-5 py-3.5 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-3 bg-white/[0.02]">
                  <div className="flex items-center gap-4">
                    <div>
                      <div className={`text-2xl font-mono font-black tracking-tighter leading-none ${
                        safePnL(trade.pnl) > 0 ? 'text-emerald-400' : safePnL(trade.pnl) < 0 ? 'text-rose-500' : 'text-zinc-500'
                      }`}>
                        {safePnL(trade.pnl) > 0 ? '+' : safePnL(trade.pnl) < 0 ? '-' : ''}${Math.abs(safePnL(trade.pnl)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div className="text-[8px] font-black uppercase tracking-[0.2em] text-zinc-500 mt-1">Net P&L</div>
                    </div>
                    <div className="w-px h-8 bg-white/[0.08]" />
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-black tracking-tight text-white">{trade.pair}</h3>
                        <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${
                          trade.direction === 'Long' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'
                        }`}>{trade.direction}</span>
                        <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-indigo-500 text-white">{trade.assetType}</span>
                      </div>
                      <div className="flex items-center gap-2 text-zinc-500 text-[11px] font-medium mt-0.5">
                        <span>{trade.date}</span>
                        <span className="w-1 h-1 rounded-full bg-zinc-600" />
                        <span>{trade.time}</span>
                        <span className="w-1 h-1 rounded-full bg-zinc-600" />
                        <span>{trade.session}</span>
                        <span className="w-1 h-1 rounded-full bg-zinc-600" />
                        <span className="flex items-center gap-1 text-indigo-400 font-bold">
                          <Clock size={11} /> {formatDuration(trade.openTime, trade.closeTime) || '---'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => toggleExpand(trade.id)} className="p-1.5 rounded-lg bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white transition-all">
                    <X size={16} />
                  </button>
                </div>

                <div className="p-4">
                  <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-12 md:col-span-4 space-y-3">
                      <div className="p-3 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                        <h4 className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-2">Execution</h4>
                        <div className="space-y-2 text-xs">
                          <div className="flex justify-between"><span className="text-zinc-500">Entry</span><span className="font-mono font-bold text-white">{trade.entryPrice.toFixed(2)}</span></div>
                          <div className="flex justify-between"><span className="text-zinc-500">Exit</span><span className="font-mono font-bold text-white">{trade.exitPrice?.toFixed(2) || '---'}</span></div>
                          <div className="flex justify-between"><span className="text-zinc-500">Stop Loss</span><span className="font-mono font-bold text-rose-500">{trade.stopLoss.toFixed(2)}</span></div>
                          <div className="flex justify-between"><span className="text-zinc-500">Take Profit</span><span className="font-mono font-bold text-emerald-500">{trade.takeProfit.toFixed(2)}</span></div>
                          <div className="h-px bg-white/[0.06] my-1.5" />
                          <div className="flex justify-between"><span className="text-zinc-500">Volume</span><span className="font-bold text-white">{trade.lots} Lots</span></div>
                          <div className="flex justify-between"><span className="text-zinc-500">R:R Ratio</span><span className="font-bold text-indigo-500">1 : {trade.rr}</span></div>
                        </div>
                      </div>
                      <div className="p-3 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                        <h4 className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-2">Psychology</h4>
                        <div className="space-y-2 text-xs">
                          <div className="flex justify-between"><span className="text-zinc-500">Mindset</span><span className="font-bold text-white">{trade.mindset || 'Neutral'}</span></div>
                          <div className="flex justify-between"><span className="text-zinc-500">Plan</span><span className="font-bold text-white">{trade.planAdherence || 'N/A'}</span></div>
                          <div className="flex justify-between"><span className="text-zinc-500">Mistake</span><span className="font-bold text-rose-500">{trade.tradingMistake || 'None'}</span></div>
                        </div>
                      </div>
                      <div className="p-3 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Voice Note</h4>
                          <Mic size={11} className="text-zinc-500" />
                        </div>
                        <div className="flex items-center gap-2 text-zinc-600 text-[10px] font-bold uppercase tracking-widest">
                          <Mic size={10} />
                          No Voice Note
                        </div>
                      </div>
                    </div>

                    <div className="col-span-12 md:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {[{ id: 'before', label: 'Before Canvas' }, { id: 'after', label: 'After Canvas' }].map((slot) => (
                        <div key={slot.id} className="group h-[200px] rounded-xl border overflow-hidden bg-white/[0.03] border-dashed border-white/[0.08] flex flex-col">
                          <div className="px-3 py-1.5 border-b border-white/[0.08] bg-white/[0.03] flex items-center justify-between">
                            <div className="text-[8px] font-bold text-white uppercase tracking-wider px-2 py-0.5 bg-white/[0.08] rounded">{slot.label}</div>
                            <div className="flex items-center gap-1.5">
                              <div className="p-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-all cursor-pointer">
                                <Eye size={13} />
                              </div>
                              <div className="p-1.5 bg-rose-500/80 hover:bg-rose-500 text-white rounded-lg transition-all cursor-pointer">
                                <Trash2 size={13} />
                              </div>
                            </div>
                          </div>
                          <div className="relative flex-1 min-h-0 overflow-hidden flex items-center justify-center bg-white/[0.02]">
                            <div className="flex flex-col items-center justify-center text-zinc-600 text-center">
                              <ImageIcon size={18} className="mb-1.5" />
                              <span className="text-[8px] font-bold uppercase tracking-wider">No Image</span>
                            </div>
                          </div>
                        </div>
                      ))}
                      <div className="col-span-full p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Entry Note</h4>
                          <Edit3 size={11} className="text-zinc-500 cursor-pointer hover:text-zinc-300" />
                        </div>
                        <p className="text-xs text-zinc-500 italic">No entry comments recorded.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

const performanceStates = [
  {
    title: 'Centralized Trade History',
    description: 'Every trade logged, tagged, and searchable in one place.',
  },
  {
    title: 'AI Mentor',
    description: 'Ask your AI trading analyst anything — get instant, data-backed insights from your trade history.',
  },
  {
    title: 'Seamless Sync',
    description: 'Auto-import from MT4/MT5 via desktop bridge or broker VPS sync.',
  },
];

export const PerformanceSequence: React.FC = () => {
  const performanceSequenceRef = React.useRef<HTMLElement | null>(null);
  const [activePerformanceState, setActivePerformanceState] = React.useState(1);
  const [isPerformanceLocked, setIsPerformanceLocked] = React.useState(false);
  const performanceLockScrollYRef = React.useRef<number | null>(null);
  const performanceWheelDeltaRef = React.useRef(0);
  const activePerformanceStateRef = React.useRef(activePerformanceState);
  const performanceHasCompletedRef = React.useRef(false);
  const performanceLastStepAtRef = React.useRef(0);
  const performanceTouchStartYRef = React.useRef<number | null>(null);
  const bodyLockStylesRef = React.useRef<Partial<CSSStyleDeclaration> | null>(null);
  const [animatingState, setAnimatingState] = React.useState(activePerformanceState);

  React.useEffect(() => {
    activePerformanceStateRef.current = activePerformanceState;
    const timer = setTimeout(() => {
      setAnimatingState(activePerformanceState);
    }, 50);
    return () => clearTimeout(timer);
  }, [activePerformanceState]);

  React.useEffect(() => {
    const section = performanceSequenceRef.current;
    if (!section) return;

    let isUpdating = false;

    const updateLockState = () => {
      if (isUpdating) return;
      isUpdating = true;
      requestAnimationFrame(() => {
        if (isPerformanceLocked) {
          isUpdating = false;
          return;
        }

        const rect = section.getBoundingClientRect();
        const viewportHeight = window.innerHeight || 1;
        const lockTrigger = Math.min(80, viewportHeight * 0.12);
        const isEntering = rect.top <= lockTrigger && rect.bottom > viewportHeight * 0.65;

        if (performanceHasCompletedRef.current) {
          if (rect.top > viewportHeight * 0.45) {
            performanceHasCompletedRef.current = false;
          } else {
            isUpdating = false;
            return;
          }
        }

        if (!isEntering) {
          isUpdating = false;
          return;
        }

        const stageOffset = 0;
        const lockScrollY = Math.max(0, window.scrollY + rect.top - stageOffset);

        performanceLockScrollYRef.current = lockScrollY;
        performanceWheelDeltaRef.current = 0;
        performanceLastStepAtRef.current = 0;
        activePerformanceStateRef.current = 1;
        setActivePerformanceState(1);
        window.scrollTo({ top: lockScrollY, behavior: 'auto' });
        setIsPerformanceLocked(true);
        isUpdating = false;
      });
    };

    updateLockState();
    window.addEventListener('scroll', updateLockState, { passive: true });
    window.addEventListener('resize', updateLockState);

    return () => {
      window.removeEventListener('scroll', updateLockState);
      window.removeEventListener('resize', updateLockState);
    };
  }, [isPerformanceLocked]);

  React.useEffect(() => {
    const section = performanceSequenceRef.current;
    if (!isPerformanceLocked || !section) return;

    const lockScrollY = performanceLockScrollYRef.current ?? window.scrollY;

    bodyLockStylesRef.current = {
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      right: document.body.style.right,
      width: document.body.style.width,
      overflow: document.body.style.overflow,
    };

    document.body.style.position = 'fixed';
    document.body.style.top = `-${lockScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';

    const restoreBodyScroll = () => {
      const originalStyles = bodyLockStylesRef.current;

      if (originalStyles) {
        document.body.style.position = originalStyles.position ?? '';
        document.body.style.top = originalStyles.top ?? '';
        document.body.style.left = originalStyles.left ?? '';
        document.body.style.right = originalStyles.right ?? '';
        document.body.style.width = originalStyles.width ?? '';
        document.body.style.overflow = originalStyles.overflow ?? '';
      }

      bodyLockStylesRef.current = null;
    };

    const releaseLock = (direction: 'down' | 'up' = 'down') => {
      const releaseScrollY = direction === 'down'
        ? lockScrollY + 80
        : Math.max(0, lockScrollY - 120);

      restoreBodyScroll();
      performanceWheelDeltaRef.current = 0;
      performanceLockScrollYRef.current = null;
      performanceHasCompletedRef.current = direction === 'down';
      setIsPerformanceLocked(false);
      window.scrollTo({ top: releaseScrollY, behavior: 'auto' });
    };

    const stepSequence = (direction: 'down' | 'up') => {
      const now = window.performance.now();
      if (now - performanceLastStepAtRef.current < 420) return;
      performanceLastStepAtRef.current = now;

      const currentState = activePerformanceStateRef.current;

      if (direction === 'down') {
        if (currentState >= 3) {
          releaseLock('down');
          return;
        }

        const nextState = currentState + 1;
        activePerformanceStateRef.current = nextState;
        setActivePerformanceState(nextState);
        return;
      }

      if (currentState <= 1) {
        releaseLock('up');
        return;
      }

      const nextState = currentState - 1;
      activePerformanceStateRef.current = nextState;
      setActivePerformanceState(nextState);
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();

      performanceWheelDeltaRef.current += event.deltaY;
      const threshold = 120;

      performanceWheelDeltaRef.current = Math.max(-threshold * 2, Math.min(performanceWheelDeltaRef.current, threshold * 2));

      if (performanceWheelDeltaRef.current >= threshold) {
        performanceWheelDeltaRef.current = 0;
        stepSequence('down');
      }

      if (performanceWheelDeltaRef.current <= -threshold) {
        performanceWheelDeltaRef.current = 0;
        stepSequence('up');
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      performanceTouchStartYRef.current = event.touches[0]?.clientY ?? null;
    };

    const handleTouchMove = (event: TouchEvent) => {
      const startY = performanceTouchStartYRef.current;
      const currentY = event.touches[0]?.clientY;
      if (startY === null || currentY === undefined) return;

      const deltaY = startY - currentY;
      if (Math.abs(deltaY) < 48) {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      performanceTouchStartYRef.current = currentY;
      stepSequence(deltaY > 0 ? 'down' : 'up');
    };

    const handleTouchEnd = () => {
      performanceTouchStartYRef.current = null;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!['ArrowDown', 'PageDown', ' ', 'ArrowUp', 'PageUp'].includes(event.key)) return;

      event.preventDefault();

      const isBackward = event.key === 'ArrowUp' || event.key === 'PageUp';
      stepSequence(isBackward ? 'up' : 'down');
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('touchstart', handleTouchStart, { passive: false });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      restoreBodyScroll();
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPerformanceLocked]);

  const activePerformanceCopy = performanceStates[activePerformanceState - 1];

  const renderPerformanceCanvas = () => {
    if (activePerformanceState === 2) {
      return (
        <div key="performance-intelligence-canvas" className="w-full h-full rounded-[34px] overflow-hidden shadow-[0_24px_60px_rgba(17,17,17,0.16)] border border-[#1B1B1B]/10 bg-[#141419] flex flex-col transition-all duration-500 animate-in fade-in zoom-in-95">
          <div className="flex-1 bg-[#101013] min-h-0 relative">
            <AIChatDemo />
          </div>
        </div>
      );
    }

    if (activePerformanceState === 1) {
      return (
        <div key="trade-history-canvas" className="w-full h-full rounded-[34px] overflow-hidden shadow-[0_24px_60px_rgba(17,17,17,0.16)] border border-[#1B1B1B]/10 bg-[#141419] flex flex-col transition-all duration-500 animate-in fade-in zoom-in-95">
          <div className="flex-1 bg-[#101013] min-h-0 relative rounded-[34px] overflow-hidden">
            <MiniTradeHistory />
          </div>
        </div>
      );
    }

    return (
      <div key={`empty-canvas-${activePerformanceState}`} className="w-full h-full rounded-[34px] overflow-hidden shadow-[0_24px_60px_rgba(17,17,17,0.16)] border border-[#1B1B1B]/10 bg-[#141419] flex flex-col transition-all duration-500 animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-[#17171C]">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#FF4B2B]" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold tracking-[0.12em] uppercase text-white/70">
            {activePerformanceCopy?.title}
          </div>
          <div className="text-[11px] font-medium text-white/40">Canvas placeholder</div>
        </div>
        <div className="flex-1 bg-[#101013] p-5 sm:p-6 flex items-center justify-center">
          <div className="relative w-full h-full max-h-[560px] rounded-[22px] border border-dashed border-white/10 bg-[radial-gradient(circle_at_top,rgba(255,79,1,0.08),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0))] overflow-hidden">
            <div
              className="absolute inset-0 opacity-[0.28]"
              style={{
                backgroundImage: 'linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)',
                backgroundSize: '28px 28px',
              }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="rounded-full border border-white/8 bg-white/[0.05] px-4 py-2 text-[11px] font-semibold tracking-[0.18em] uppercase text-white/40">
                Empty canvas
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/5 bg-[#151519] text-[11px] text-white/55">
          <span>JFX JOURNAL</span>
          <span>{activePerformanceCopy?.title}</span>
        </div>
      </div>
    );
  };

  return (
    <section
      id="product"
      ref={performanceSequenceRef}
      className="relative w-full min-h-[100dvh] bg-[#FAF9F5] overflow-visible"
    >
      <div className="px-10 py-[120px] min-h-[100dvh] flex items-center">
        <div className="max-w-[1728px] mx-auto w-full">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] gap-[64px] items-center">
            <div className="bg-gradient-to-br from-[#F1EBDD] via-[#F7F3EA] to-[#EDE5D7] rounded-[40px] p-6 h-[540px] xl:h-[680px] flex items-center justify-center relative overflow-hidden border border-[#E7E0D4]/70 shadow-sm">
              <div className="absolute left-10 top-10 h-[240px] w-[240px] rounded-full bg-white/25 blur-3xl pointer-events-none" />
              <div className="absolute right-10 bottom-8 h-[180px] w-[180px] rounded-full bg-[#FF4B2B]/10 blur-3xl pointer-events-none" />
              {renderPerformanceCanvas()}
            </div>
            <div className="flex flex-col justify-center h-full ml-auto max-w-[560px]">
              <div className="mb-5 text-[11px] font-semibold uppercase tracking-[0.28em] text-[#8C867A]">
                Product narrative
              </div>
              <h3 className="text-[34px] leading-[1.08] tracking-[-0.04em] mb-5 font-bold text-[#1B1B1B] text-balance max-w-[11ch]">
                The intelligent foundation for your trading.
              </h3>
              <p className="text-[16px] leading-[1.65] text-[#6F695F] max-w-[40ch] mb-10">
                A single system for history, analysis, and execution context, so each trade compounds into a clearer decision.
              </p>
              <div className="relative pl-10 border-l border-[#D6D0C5] space-y-12">
                <div
                  className="absolute left-[-1px] top-0 w-[3px] bg-gradient-to-b from-[#FF416C] via-[#FF4B2B] to-[#FF8A3D] transition-all duration-300 rounded-full"
                  style={{
                    height: activePerformanceState === 1 ? '33.333%' : activePerformanceState === 2 ? '66.666%' : '100%',
                  }}
                />
                {performanceStates.map((state, index) => {
                  const isActive = activePerformanceState === index + 1;
                  const isAnimatingIn = animatingState === index + 1;

                  return (
                    <div
                      key={state.title}
                      className={clsx(
                        'relative transition-all duration-500',
                        isActive ? 'translate-x-0 opacity-100' : 'translate-x-1 opacity-50'
                      )}
                    >
                      <div
                        className={clsx(
                          'absolute left-[-47px] top-1 h-4 w-4 rounded-full border transition-all duration-300',
                          isActive ? 'scale-100 border-[#FF4B2B] bg-[#FF4B2B] shadow-[0_0_0_6px_rgba(255,75,43,0.12)]' : 'scale-75 border-[#D6D0C5] bg-[#FAF9F5]'
                        )}
                      />
                      <h4
                        className={clsx(
                          'text-[24px] leading-[1.25] tracking-[-0.02em] font-bold mb-1 text-[#1B1B1B] transition-all duration-500',
                          isActive ? 'text-[#111111] translate-y-0' : '-translate-y-1 opacity-85'
                        )}
                      >
                        {state.title}
                      </h4>
                      <div className="overflow-hidden">
                        <p className={clsx(
                          "text-[15px] leading-[1.65] text-[#7F796F] max-w-[430px] transition-all duration-500",
                          isActive && isAnimatingIn ? 'translate-y-0 opacity-100 max-h-24 mt-3' : '-translate-y-2 opacity-0 max-h-0 mt-0'
                        )}>
                          {state.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
