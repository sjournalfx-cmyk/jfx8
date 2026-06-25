import React from 'react';
import { ArrowRight } from 'lucide-react';

interface BetaSplashProps {
  onContinue: () => void;
}

const BetaSplash: React.FC<BetaSplashProps> = ({ onContinue }) => {
  const [showTelegram, setShowTelegram] = React.useState(false);

  const handleContinueToApp = () => {
    setShowTelegram(true);
  };

  const handleFinalize = (joinLink?: string) => {
    if (joinLink) {
      window.open(joinLink, '_blank');
    }
    onContinue();
  };

  return (
    <div className="relative min-h-dvh w-full bg-[#000000] text-white flex items-center justify-center overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0">
        <div className="absolute top-[-20%] right-[-10%] w-[800px] h-[800px] bg-indigo-600/15 rounded-full blur-[160px] animate-pulse" />
        <div className="absolute bottom-[-15%] left-[-10%] w-[700px] h-[700px] bg-[#FF4F01]/8 rounded-full blur-[140px]" />
        <div className="absolute top-[40%] left-[50%] -translate-x-1/2 w-[600px] h-[600px] bg-indigo-500/5 rounded-full blur-[120px]" />
      </div>

      {/* Beta Badge - Top Left */}
      <div className="fixed top-5 left-5 sm:top-6 sm:left-6 z-20 text-white/70 text-[14px] font-black uppercase tracking-[0.3em]">
        BETA
      </div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-5xl mx-auto px-8 py-14 flex flex-col items-center text-center animate-in fade-in duration-700">

        {/* Brand */}
        <h1 className="text-[56px] sm:text-[72px] font-black tracking-tight leading-[0.95] mb-7">
          JFX JOURNAL
        </h1>

        {/* Hero Message — one concise line */}
        <p className="text-[23px] sm:text-[28px] font-semibold text-zinc-100 max-w-3xl leading-snug mb-16">
          Your early feedback shapes what this tool becomes.
        </p>

        {/* CTA */}
        {!showTelegram ? (
          <button
            onClick={handleContinueToApp}
            className="inline-flex items-center gap-3 px-12 py-5 bg-[#FF4F01] hover:bg-[#E64601] text-white rounded-2xl font-black text-[16px] shadow-xl shadow-[#FF4F01]/25 transition-all hover:scale-[1.03] hover:shadow-[#FF4F01]/40 active:scale-[0.97]"
          >
            Continue to App
            <ArrowRight size={24} />
          </button>
        ) : (
          <div className="flex flex-col items-center gap-4 animate-in fade-in slide-in-from-bottom-3 duration-500">
            <button
              onClick={() => handleFinalize('https://t.me/+w_KvKM5HESYyMTdk')}
              className="inline-flex items-center gap-3 px-12 py-5 bg-[#0088cc] hover:bg-[#0077b3] text-white rounded-2xl font-black text-[16px] shadow-xl shadow-[#0088cc]/25 transition-all hover:scale-[1.03] hover:shadow-[#0088cc]/40 active:scale-[0.97]"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="shrink-0"
              >
                <path d="M20.665 3.717l-17.73 6.837c-1.21.486-1.203 1.161-.222 1.462l4.552 1.42 10.532-6.645c.498-.303.953-.14.578.192l-8.533 7.701-.33 4.955c.488 0 .702-.223.974-.485l2.338-2.27 4.861 3.59c.896.494 1.54.24 1.763-.829l3.185-15.01c.326-1.309-.5-1.902-1.356-1.513z" />
              </svg>
              Join Telegram Channel
            </button>
            <button
              onClick={() => handleFinalize()}
              className="text-[13px] font-bold text-zinc-400 hover:text-zinc-200 transition-colors uppercase tracking-widest cursor-pointer underline underline-offset-4"
            >
              Skip
            </button>
          </div>
        )}

      </div>
    </div>
  );
};

export default BetaSplash;
