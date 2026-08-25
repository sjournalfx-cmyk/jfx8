import React from 'react';
import { motion } from 'framer-motion';
import { Play, Zap } from 'lucide-react';

interface StartScreenProps {
    isDarkMode: boolean;
    defaultSymbol: string;
    defaultTimeframe: string;
    onOpenWatchlist: () => void;
}

const StartScreen: React.FC<StartScreenProps> = ({
    isDarkMode,
    onOpenWatchlist
}) => {
    const sub = isDarkMode ? 'text-zinc-500' : 'text-slate-400';

    return (
        <div className={`absolute inset-0 z-[60] overflow-y-auto ${isDarkMode ? 'bg-black' : 'bg-slate-50'}`}>
            <div className="min-h-full flex items-center justify-center p-6 sm:p-10">
                <div className="w-full max-w-2xl space-y-6">

                    {/* Header */}
                    <div className="text-center space-y-2">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#FF4F01]/30 bg-[#FF4F01]/10 text-[#FF4F01] text-[9px] font-black uppercase tracking-[0.2em]">
                            <Zap size={11} fill="currentColor" /> Backtest Lab
                        </div>
                        <h1 className={`text-3xl font-black uppercase tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                            Replay real market history
                        </h1>
                        <p className={`text-xs font-bold uppercase tracking-widest ${sub}`}>
                            Start a backtest — pick a pair from the watchlist
                        </p>
                    </div>

                    {/* Start button */}
                    <button
                        onClick={onOpenWatchlist}
                        className="w-full py-4 rounded-2xl text-xs font-black uppercase tracking-[0.15em] flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-xl bg-[#FF4F01] text-white shadow-[#FF4F01]/30 hover:bg-[#e64700]"
                    >
                        <Play size={15} fill="currentColor" />
                        Start Backtest
                    </button>
                </div>
            </div>
        </div>
    );
};

export default StartScreen;
