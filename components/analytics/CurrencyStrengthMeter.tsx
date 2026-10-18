import React, { useMemo, useState } from 'react';
import { Trade } from '../../types';
import { HelpCircle } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip';

interface CurrencyStrengthMeterProps {
    isDarkMode: boolean;
    trades: Trade[];
    onInfoClick?: () => void;
}

export const CurrencyStrengthMeter: React.FC<CurrencyStrengthMeterProps> = ({ isDarkMode, trades = [], onInfoClick }) => {
    const [hoveredCur, setHoveredCur] = useState<string | null>(null);
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

    const handleMouseMove = (e: React.MouseEvent) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setMousePos({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        });
    };

    const strengths = useMemo(() => {
        const safeTrades = trades || [];
        const scores: Record<string, number> = {};
        const currencies = new Set<string>();
        const commonQuotes = ['USD', 'EUR', 'JPY', 'GBP', 'AUD', 'CAD', 'CHF', 'NZD', 'USDT', 'BTC', 'ETH'];

        safeTrades.forEach(trade => {
            let base = '';
            let quote = '';

            let pair = trade.pair ? trade.pair.trim().toUpperCase() : '';
            if (!pair) return;

            const separatorMatch = pair.match(/^([A-Z0-9]+)[\/\-\s]([A-Z0-9]+)$/);
            if (separatorMatch) {
                base = separatorMatch[1];
                quote = separatorMatch[2];
            } else {
                const cleanPair = pair.replace(/[^A-Z0-9]/g, '');

                if (cleanPair.length === 6) {
                    base = cleanPair.substring(0, 3);
                    quote = cleanPair.substring(3, 6);
                } else {
                    for (const q of commonQuotes) {
                        if (cleanPair.endsWith(q) && cleanPair.length > q.length) {
                            quote = q;
                            base = cleanPair.substring(0, cleanPair.length - q.length);
                            break;
                        }
                    }
                }
            }

            if (!base || !quote) return;

            currencies.add(base);
            currencies.add(quote);

            if (!scores[base]) scores[base] = 0;
            if (!scores[quote]) scores[quote] = 0;

            const pnl = trade.pnl || 0;
            const direction = trade.direction?.toLowerCase() || '';

            if (direction === 'long' || direction === 'buy') {
                scores[base] += pnl;
                scores[quote] -= pnl;
            } else if (direction === 'short' || direction === 'sell') {
                scores[base] -= pnl;
                scores[quote] += pnl;
            }
        });

        const currencyList = Array.from(currencies);
        if (currencyList.length === 0) return [];

        const vals = Object.values(scores);
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        const range = max - min;

        return currencyList.map(cur => {
            const val = scores[cur];
            const strength = range === 0 ? 5 : ((val - min) / range) * 10;
            return { cur, val: strength, raw: val };
        }).sort((a, b) => b.val - a.val).slice(0, 8);
    }, [trades]);

    const hoveredData = strengths.find(s => s.cur === hoveredCur);

    return (
        <div 
            onMouseMove={handleMouseMove}
            className="p-4 rounded-[20px] border-0 flex flex-col h-full relative bg-[#0a0a0a] text-white"
        >
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <h3 className="text-[15px] font-semibold tracking-tight text-left">Currency Strength</h3>
                    <Tooltip content="Ranks currencies by their aggregate P/L impact across all your trades. Green = stronger, Red = weaker." isDarkMode={isDarkMode} onInfoClick={onInfoClick}>
                        <HelpCircle size={13} className="opacity-40 cursor-help hover:opacity-100" />
                    </Tooltip>
                </div>
            </div>

            {strengths.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center opacity-30 text-center">
                    <p className="text-sm">No currency data available</p>
                    <p className="text-xs mt-2 max-w-[200px]">Add trades with standard pairs (e.g. EURUSD) to see data.</p>
                </div>
            ) : (
                <div className="space-y-4 flex-1 justify-center flex flex-col">
                    {strengths.map((item) => (
                        <div
                            key={item.cur}
                            className="flex items-center gap-3 group cursor-pointer"
                            onMouseEnter={() => setHoveredCur(item.cur)}
                            onMouseLeave={() => setHoveredCur(null)}
                        >
                            <div className="w-12 flex flex-col items-center">
                                <span className={`text-xs font-black ${hoveredCur === item.cur ? 'text-indigo-500' : ''}`}>{item.cur}</span>
                            </div>
                            <div className={`flex-1 h-2 rounded-full overflow-hidden bg-white/10 ${hoveredCur === item.cur ? 'h-3' : ''}`}>
                                <div
                                    className={`h-full rounded-full ${item.val > 7 ? 'bg-emerald-500' :
                                        item.val > 4 ? 'bg-blue-500' :
                                            item.val > 2 ? 'bg-amber-500' : 'bg-rose-500'
                                        } ${hoveredCur === item.cur ? 'brightness-110 shadow-lg' : ''}`}
                                    style={{ width: `${Math.max(5, item.val * 10)}%` }}
                                />
                            </div>
                            <span className="text-[10px] font-mono font-bold opacity-50 w-8 text-right">
                                {item.val.toFixed(1)}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {hoveredData && (
                <div 
                    className="absolute pointer-events-none z-50"
                    style={{ 
                        left: mousePos.x + 20, 
                        top: mousePos.y - 40
                    }}
                >
                    <div className={`p-4 rounded-xl shadow-2xl border backdrop-blur-md min-w-[140px] ${isDarkMode ? 'bg-black/90 border-zinc-700' : 'bg-white/90 border-slate-200'}`}>
                        <div className="font-bold text-sm mb-2 border-b border-white/10 pb-1">{hoveredData.cur} Strength</div>
                        <div className="flex justify-between items-center text-xs">
                            <span className="opacity-60">Score</span>
                            <span className="font-bold">{hoveredData.val.toFixed(2)} / 10</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
