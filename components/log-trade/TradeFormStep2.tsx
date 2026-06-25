import React from 'react';
import { TrendingUp, TrendingDown, Hash, Clock, CheckCircle2, XCircle, MinusCircle, AlertTriangle } from 'lucide-react';
import { Input } from '../ui/Input';
import { cn } from '../../lib/utils';

interface TradeFormStep2Props {
    formData: any;
    handleInputChange: (field: string, value: any) => void;
    isDarkMode: boolean;
    isDesktopBridgeTrade?: boolean;
}

const resultColorMap: Record<string, string> = {
    Win: 'bg-teal-500/10 border-teal-500 text-teal-600 dark:text-teal-400',
    Loss: 'bg-rose-500/10 border-rose-500 text-rose-600 dark:text-rose-400',
    BE: 'bg-violet-500/10 border-violet-500 text-violet-600 dark:text-violet-400',
    Pending: 'bg-violet-500/10 border-violet-500 text-violet-600 dark:text-violet-400',
};

export const TradeFormStep2: React.FC<TradeFormStep2Props> = ({
    formData,
    handleInputChange,
    isDarkMode,
    isDesktopBridgeTrade = false,
}) => {
    const entry = parseFloat(formData.entryPrice);
    const exit = parseFloat(formData.exitPrice);
    const direction = formData.direction;
    const result = formData.result;

    const hasWarning = React.useMemo(() => {
        if (isNaN(entry) || isNaN(exit) || !direction || !result) return null;
        if (result !== 'Win' && result !== 'Loss') return null;

        const isLong = direction === 'Long';
        const isWinPrice = isLong ? exit > entry : exit < entry;
        const isLossPrice = isLong ? exit < entry : exit > entry;

        if (isWinPrice && result === 'Loss') {
            return "Based on entry and exit prices, this is a winning trade, but you selected 'Loss'. Saving will sync the PNL sign to negative.";
        }
        if (isLossPrice && result === 'Win') {
            return "Based on entry and exit prices, this is a losing trade, but you selected 'Win'. Saving will sync the PNL sign to positive.";
        }
        return null;
    }, [entry, exit, direction, result]);

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="grid grid-cols-2 gap-6">
                <div className="col-span-2 md:col-span-1">
                    <label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-2">
                        Trade Direction
                    </label>
                    <div className={cn(
                        "p-1.5 rounded-xl flex border",
                        isDarkMode ? 'bg-[#000000] border-[#27272a]' : 'bg-slate-100 border-slate-200'
                    )}>
                        <button
                            type="button"
                            disabled={isDesktopBridgeTrade}
                            onClick={() => handleInputChange('direction', 'Long')}
                            className={cn(
                                "flex-1 py-3 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all",
                                isDesktopBridgeTrade && "cursor-not-allowed opacity-60",
                                formData.direction === 'Long' ? 'bg-teal-500 text-white shadow-md' : 'text-zinc-500 hover:text-zinc-300'
                            )}
                        >
                            <TrendingUp size={16} /> Long
                        </button>
                        <button
                            type="button"
                            disabled={isDesktopBridgeTrade}
                            onClick={() => handleInputChange('direction', 'Short')}
                            className={cn(
                                "flex-1 py-3 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all",
                                isDesktopBridgeTrade && "cursor-not-allowed opacity-60",
                                formData.direction === 'Short' ? 'bg-rose-500 text-white shadow-md' : 'text-zinc-500 hover:text-zinc-300'
                            )}
                        >
                            <TrendingDown size={16} /> Short
                        </button>
                    </div>
                </div>
                <div className="col-span-2 md:col-span-1">
                    <Input
                        label="Position Size (Lots)"
                        leftIcon={<Hash size={16} />}
                        type="number"
                        placeholder="1.00"
                        step="0.01"
                        value={formData.lots}
                        onChange={(e) => handleInputChange('lots', e.target.value)}
                        isDarkMode={isDarkMode}
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Input
                    label="Entry Price"
                    type="number"
                    placeholder="0.00000"
                    className="font-mono tracking-wide"
                    value={formData.entryPrice}
                    onChange={(e) => handleInputChange('entryPrice', e.target.value)}
                    disabled={isDesktopBridgeTrade}
                    isDarkMode={isDarkMode}
                />
                <Input
                    label="Exit Price"
                    type="number"
                    placeholder="0.00000"
                    className="font-mono tracking-wide"
                    value={formData.exitPrice}
                    onChange={(e) => handleInputChange('exitPrice', e.target.value)}
                    disabled={isDesktopBridgeTrade}
                    isDarkMode={isDarkMode}
                />
            </div>
            {isDesktopBridgeTrade && (
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500 -mt-2">
                    Entry price and exit price are locked for desktop bridge trades
                </p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Input
                    label="Stop Loss"
                    type="number"
                    placeholder="0.00000"
                    className="font-mono tracking-wide text-rose-500"
                    value={formData.stopLoss}
                    onChange={(e) => handleInputChange('stopLoss', e.target.value)}
                    isDarkMode={isDarkMode}
                />
                <Input
                    label="Take Profit"
                    type="number"
                    placeholder="0.00000"
                    className="font-mono tracking-wide text-teal-500"
                    value={formData.takeProfit}
                    onChange={(e) => handleInputChange('takeProfit', e.target.value)}
                    isDarkMode={isDarkMode}
                />
            </div>

            <div className="pt-6 border-t border-dashed border-slate-200 dark:border-[#27272a]">
                <label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-2">
                    Trade Outcome
                </label>
                <div className="grid grid-cols-4 gap-4">
                    {[
                        { id: 'Win', icon: CheckCircle2, color: 'teal' },
                        { id: 'Loss', icon: XCircle, color: 'rose' },
                        { id: 'BE', icon: MinusCircle, color: 'violet' },
                        { id: 'Pending', icon: Clock, color: 'violet' }
                    ].map(({ id, icon: Icon }) => (
                        <button
                            key={id}
                            type="button"
                            disabled={isDesktopBridgeTrade}
                            onClick={() => handleInputChange('result', id)}
                            className={cn(
                                "py-4 px-2 rounded-xl border font-bold text-sm transition-all flex flex-col items-center gap-2",
                                isDesktopBridgeTrade && "cursor-not-allowed opacity-60",
                                formData.result === id
                                    ? resultColorMap[id]
                                    : `border-transparent ${isDarkMode ? 'bg-[#000000] text-zinc-500 hover:bg-[#27272a]' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`
                            )}
                        >
                            <Icon size={20} />
                            {id}
                        </button>
                    ))}
                </div>
                {isDesktopBridgeTrade && (
                    <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-amber-500">
                        Trade outcome is locked for desktop bridge trades
                    </p>
                )}
                {hasWarning && (
                    <div className={cn(
                        "mt-4 p-3.5 rounded-xl border flex items-start gap-3 text-xs font-medium",
                        isDarkMode 
                            ? 'bg-amber-500/10 border-amber-500/20 text-amber-300' 
                            : 'bg-amber-50 border-amber-200 text-amber-700'
                    )}>
                        <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-500" />
                        <div>
                            <p className="font-bold mb-0.5">Outcome Mismatch</p>
                            <p className="opacity-90">{hasWarning}</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
