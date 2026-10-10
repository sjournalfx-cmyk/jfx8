import React from 'react';
import { ArrowRight, BookOpenText, RefreshCw, BrainCircuit, Target, Code2 } from 'lucide-react';

interface PublicHomeProps {
  onSignUp: () => void;
  onLogIn: () => void;
}

const sections = [
  {
    icon: BookOpenText,
    title: 'Centralized trade history',
    desc: 'Every trade logged, tagged and searchable.',
  },
  {
    icon: RefreshCw,
    title: 'Seamless sync',
    desc: 'MT4/MT5 via Desktop Bridge or broker VPS sync, connect cTrader once, or manual entry.',
  },
  {
    icon: BrainCircuit,
    title: 'Performance intelligence',
    desc: "AI trade summaries, reviews against your rules, patterns you'd miss.",
  },
  {
    icon: Target,
    title: 'Discipline tools',
    desc: 'Goals and milestones, strategy rules and backtesting, trade psychology tracking.',
  },
  {
    icon: Code2,
    title: 'Developer API',
    desc: 'For AI agents: trades, analytics, candles, positions, demo/live cTrader orders behind portfolio locks and risk rules.',
  },
];

/**
 * Public landing page for logged-out visitors at /.
 * Light and fast: no charts, no video, no heavy deps.
 */
const PublicHome: React.FC<PublicHomeProps> = ({ onSignUp, onLogIn }) => {
  return (
    <div className="min-h-dvh w-full bg-[#000000] text-white flex flex-col">
      {/* Nav */}
      <header className="w-full max-w-5xl mx-auto flex items-center justify-between px-6 py-5">
        <span className="text-sm font-black uppercase tracking-[0.25em]">
          JFX<span className="text-[#FF4F01]">-</span>JOURNAL
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onLogIn}
            className="text-[12px] font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-colors px-3 py-2"
          >
            Log in
          </button>
          <button
            type="button"
            onClick={onSignUp}
            className="text-[12px] font-black uppercase tracking-widest bg-[#FF4F01] hover:bg-[#E64601] text-white rounded-xl px-4 py-2 transition-all"
          >
            Sign up
          </button>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-6 flex flex-col items-center text-center pt-10 sm:pt-16 pb-16">
        <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none" />
        <h1 className="relative text-4xl sm:text-6xl font-black tracking-tight leading-[1.05] max-w-3xl">
          JFX-JOURNAL: The Trading Journal for Serious Traders
        </h1>
        <p className="relative mt-6 text-base sm:text-lg text-zinc-400 max-w-2xl leading-relaxed">
          Every trade tells a story. JFX-JOURNAL listens, writes it down, and tells you what you&apos;re doing right and wrong, so you stop guessing and start improving.
        </p>
        <div className="relative mt-8 flex flex-col sm:flex-row items-center gap-3">
          <button
            type="button"
            onClick={onSignUp}
            className="inline-flex items-center gap-2 px-8 py-4 bg-[#FF4F01] hover:bg-[#E64601] text-white rounded-2xl font-black text-[14px] shadow-xl shadow-[#FF4F01]/25 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            Sign up <ArrowRight size={18} />
          </button>
          <button
            type="button"
            onClick={onLogIn}
            className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl border-2 border-white/10 hover:bg-white/5 text-white font-black text-[14px] transition-all"
          >
            Log in
          </button>
        </div>

        {/* Sections */}
        <div className="relative mt-16 grid gap-4 sm:grid-cols-2 w-full text-left">
          {sections.map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.title}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 flex gap-4"
              >
                <div className="rounded-xl bg-[#FF4F01]/10 text-[#FF4F01] p-2.5 h-fit shrink-0">
                  <Icon size={18} />
                </div>
                <div>
                  <h2 className="font-extrabold text-[15px]">{s.title}</h2>
                  <p className="mt-1 text-sm text-zinc-400 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            );
          })}
        </div>

        <p className="relative mt-12 text-lg sm:text-xl font-bold text-zinc-200">
          Track every trade, analyse every outcome, evolve your strategy.
        </p>
      </main>

      {/* Footer */}
      <footer className="w-full border-t border-white/10">
        <div className="max-w-5xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-[13px] text-zinc-500">
          <span>&copy; 2026 JFX-JOURNAL</span>
          <div className="flex items-center gap-5">
            <a href="/privacy" className="font-bold hover:text-zinc-200">Privacy Policy</a>
            <a href="/terms" className="font-bold hover:text-zinc-200">Terms of Service</a>
            <a href="mailto:sjournalfx@gmail.com" className="font-bold hover:text-zinc-200">sjournalfx@gmail.com</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default PublicHome;
