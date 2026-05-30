import React, { useState } from 'react';
import { 
  Smartphone, Monitor, Sparkles, Share2, 
  CheckCircle2, TrendingUp, Bot, Zap, ShieldCheck 
} from 'lucide-react';
import { motion } from 'motion/react';

interface MobileBlockerProps {
  isDarkMode?: boolean;
}

export const MobileBlocker: React.FC<MobileBlockerProps> = ({ isDarkMode = true }) => {
  const [copied, setCopied] = useState(false);
  const [notified, setNotified] = useState(false);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleNotifyMe = () => {
    setNotified(true);
    setTimeout(() => setNotified(false), 3000);
  };

  // Mock data for the phone preview screen
  const upcomingFeatures = [
    { icon: <Bot className="text-indigo-400" size={16} />, title: "Pocket AI Analyst", desc: "Real-time trading psychology feedback on the go." },
    { icon: <Zap className="text-amber-400" size={16} />, title: "Headless MT5 Bridge", desc: "Instant sync with your running MT5 terminals." },
    { icon: <TrendingUp className="text-emerald-400" size={16} />, title: "Optimized Performance Charts", desc: "High-framerate charts scaled perfectly for mobile." },
  ];

  return (
    <div className="min-h-screen w-full bg-[#000000] text-zinc-100 flex flex-col justify-between p-6 relative overflow-hidden font-sans select-none">
      {/* Background Orbs */}
      <div className="absolute top-[-10%] left-[-20%] w-[300px] h-[300px] bg-[#FF4F01]/10 rounded-full blur-[100px] pointer-events-none animate-pulse" />
      <div className="absolute bottom-[-15%] right-[-20%] w-[350px] h-[350px] bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between w-full max-w-lg mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#FF4F01] to-orange-600 flex items-center justify-center text-white font-black shadow-lg shadow-[#FF4F01]/20">
            J
          </div>
          <span className="font-extrabold text-sm tracking-wider uppercase bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-400">
            JournalFX
          </span>
        </div>
        <div className="px-2.5 py-1 rounded-full border border-zinc-800/80 bg-black/50 backdrop-blur-md text-[10px] font-black uppercase tracking-widest text-[#FF4F01]">
          v1.0.0-Beta
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center max-w-md mx-auto w-full my-6">
        
        {/* Interactive Simulated Phone Mockup */}
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-[210px] h-[390px] bg-black border-[5px] border-zinc-800 rounded-[38px] p-2.5 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] overflow-hidden mb-6 flex flex-col justify-between"
        >
          {/* Speaker Notch */}
          <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-16 h-4 bg-black rounded-full z-20 flex items-start justify-center">
            <div className="w-8 h-1 bg-black rounded-full mt-1" />
          </div>

          {/* Simulated App Screen */}
          <div className="flex-1 rounded-[28px] bg-[#000000] p-3 pt-5 flex flex-col gap-2.5 relative overflow-hidden select-none">
            {/* Ambient inner glow */}
            <div className="absolute -top-10 -right-10 w-24 h-24 bg-[#FF4F01]/10 rounded-full blur-2xl pointer-events-none" />
            <div className="absolute -bottom-10 -left-10 w-24 h-24 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

            {/* Mock Header */}
            <div className="flex items-center justify-between border-b border-zinc-900 pb-1.5 mt-1">
              <div className="flex items-center gap-1">
                <div className="w-4 h-4 rounded-full bg-indigo-500/20 flex items-center justify-center text-[7px] text-indigo-400 font-bold">M</div>
                <div className="text-[7px] font-black tracking-wider text-zinc-400">MY JOURNAL</div>
              </div>
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
            </div>

            {/* Mock Chart & Balance */}
            <div className="bg-black/40 border border-zinc-900/60 rounded-xl p-2 flex flex-col gap-1">
              <span className="text-[8px] text-zinc-500 font-bold uppercase tracking-wider">Account Balance</span>
              <div className="flex items-baseline gap-1">
                <span className="text-xs font-black text-white">$14,842</span>
                <span className="text-[7px] font-extrabold text-emerald-400 bg-emerald-500/10 px-1 py-0.2 rounded">+6.4%</span>
              </div>
              
              {/* Mini SVG Chart Path */}
              <div className="h-10 w-full mt-1.5 relative overflow-hidden">
                <svg className="w-full h-full" viewBox="0 0 100 40">
                  <defs>
                    <linearGradient id="chartGlow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FF4F01" stopOpacity="0.2"/>
                      <stop offset="100%" stopColor="#FF4F01" stopOpacity="0"/>
                    </linearGradient>
                  </defs>
                  {/* Fill */}
                  <path 
                    d="M0,40 Q15,35 30,22 T60,25 T85,8 T100,5 L100,40 L0,40 Z" 
                    fill="url(#chartGlow)"
                  />
                  {/* Line */}
                  <motion.path 
                    d="M0,40 Q15,35 30,22 T60,25 T85,8 T100,5" 
                    fill="none" 
                    stroke="#FF4F01" 
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 1.5, repeat: Infinity, repeatType: "reverse", ease: "easeInOut" }}
                  />
                </svg>
              </div>
            </div>

            {/* Mock Live Trades */}
            <div className="flex flex-col gap-1 flex-1">
              <div className="flex justify-between items-center px-0.5">
                <span className="text-[7px] text-zinc-400 font-black uppercase tracking-wider">Active Positions</span>
                <span className="text-[6px] text-indigo-400 hover:underline cursor-pointer">View All</span>
              </div>
              <div className="bg-black/35 border border-zinc-950 rounded-xl p-1.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 bg-[#FF4F01]/10 text-[#FF4F01] rounded-lg flex items-center justify-center text-[8px] font-black">X</div>
                  <div className="flex flex-col">
                    <span className="text-[8px] font-black text-white">XAUUSD</span>
                    <span className="text-[6px] text-zinc-500">Sell @ 2420.50</span>
                  </div>
                </div>
                <div className="text-[8px] font-black text-emerald-400 font-mono">+$310.00</div>
              </div>
              <div className="bg-black/35 border border-zinc-950 rounded-xl p-1.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 bg-indigo-500/10 text-indigo-400 rounded-lg flex items-center justify-center text-[8px] font-black">E</div>
                  <div className="flex flex-col">
                    <span className="text-[8px] font-black text-white">EURUSD</span>
                    <span className="text-[6px] text-zinc-500">Buy @ 1.08500</span>
                  </div>
                </div>
                <div className="text-[8px] font-black text-rose-500 font-mono">-$45.20</div>
              </div>
            </div>

            {/* Mock Navigation Menu */}
            <div className="border-t border-zinc-900/80 pt-1.5 flex items-center justify-around text-zinc-600 text-[6px]">
              <div className="flex flex-col items-center gap-0.5 text-[#FF4F01]"><Smartphone size={8} /><span>Home</span></div>
              <div className="flex flex-col items-center gap-0.5"><TrendingUp size={8} /><span>Analytics</span></div>
              <div className="flex flex-col items-center gap-0.5"><Bot size={8} /><span>AI Chat</span></div>
            </div>
          </div>

          {/* Under Construction Glass Overlay */}
          <div className="absolute inset-0 bg-[#000000]/60 backdrop-blur-[2px] flex flex-col items-center justify-center p-4 z-30">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="bg-black/85 border border-[#FF4F01]/30 rounded-2xl p-3 flex flex-col items-center text-center shadow-lg"
            >
              <div className="w-8 h-8 rounded-full bg-[#FF4F01]/10 text-[#FF4F01] flex items-center justify-center mb-1.5 animate-bounce">
                <Sparkles size={14} />
              </div>
              <h4 className="text-[10px] font-black uppercase tracking-wider text-white">Previewing Beta</h4>
              <p className="text-[7.5px] text-zinc-400 mt-1 leading-normal">
                Staging mobile experience. Interactive interface in progress.
              </p>
            </motion.div>
          </div>
        </motion.div>

        {/* Headline */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.5 }}
          className="text-center px-4"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/20 rounded-full text-xs font-black text-amber-400 uppercase tracking-widest mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
            Under Construction
          </div>

          <h2 className="text-2xl font-black tracking-tight mb-3">
            Mobile Companion App <br/>
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#FF4F01] via-pink-500 to-indigo-400">
              Coming Soon
            </span>
          </h2>
          
          <p className="text-zinc-400 text-xs leading-relaxed max-w-2xl mx-auto whitespace-normal break-normal mb-6">
            We are building a highly customized, ultra-low latency mobile trading journal. 
            For now, please switch to a <strong>desktop or laptop browser</strong> to access your trading suite, charts, and MT5 Desktop Bridge.
          </p>
        </motion.div>

        {/* Feature List (Sleek cards) */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="w-full space-y-2 px-4"
        >
          {upcomingFeatures.map((feat, index) => (
            <div 
              key={index}
              className="flex items-start gap-3 p-3 rounded-2xl bg-black border border-zinc-900/80 hover:border-zinc-800 transition-colors"
            >
              <div className="p-2 rounded-xl bg-black border border-zinc-800 flex items-center justify-center shrink-0">
                {feat.icon}
              </div>
              <div className="flex-1">
                <h4 className="text-xs font-bold text-white">{feat.title}</h4>
                <p className="text-[10px] text-zinc-500 leading-normal mt-0.5">{feat.desc}</p>
              </div>
            </div>
          ))}
        </motion.div>

        {/* Actions */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="w-full flex flex-col gap-2 mt-6 px-4"
        >
          <button 
            onClick={handleCopyLink}
            className={`w-full py-3.5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all duration-300 ${
              copied 
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20' 
                : 'bg-white text-black hover:bg-zinc-100 hover:scale-[1.01] active:scale-[0.99]'
            }`}
          >
            {copied ? (
              <>
                <CheckCircle2 size={14} />
                Link Copied!
              </>
            ) : (
              <>
                <Share2 size={14} />
                Copy Dashboard Link
              </>
            )}
          </button>
          
          <button 
            onClick={handleNotifyMe}
            className="w-full py-3.5 rounded-xl text-xs font-black uppercase tracking-wider border border-zinc-800 bg-black text-zinc-300 hover:bg-black/60 hover:text-white transition-colors"
          >
            {notified ? '✓ Notification Request Saved' : 'Notify Me on Release'}
          </button>
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 flex flex-col items-center gap-2 pt-4 border-t border-dashed border-zinc-900 max-w-lg mx-auto w-full">
        <div className="flex items-center gap-2 text-zinc-500 text-[10px] font-medium">
          <Monitor size={10} />
          <span>Requires Screen Width &ge; 768px</span>
        </div>
        <p className="text-zinc-600 text-[9px] font-bold tracking-widest uppercase">
          © {new Date().getFullYear()} JournalFX. All Rights Reserved.
        </p>
      </footer>
    </div>
  );
};
