import React from 'react';
import { Trade, UserProfile } from '../../types';
import { TrendingUp, Activity, BarChart2, Calendar, Clock, Target, Scale, Brain, ShieldCheck, Table } from 'lucide-react';

import { PerformanceBySession } from './PerformanceBySession';
import { PerformanceByPairWidget } from './PerformanceByPairWidget';
import { ExecutionPerformanceTable } from './ExecutionPerformanceTable';
import { CurrencyStrengthMeter } from './CurrencyStrengthMeter';
import { EquityCurveWidget } from './EquityCurveWidget';
import { MomentumStreakWidget } from './MomentumStreakWidget';
import { SymbolPerformanceWidget } from './SymbolPerformanceWidget';
import { DrawdownOverTimeWidget } from './DrawdownOverTimeWidget';
import { TiltScoreWidget } from './TiltScoreWidget';
import { PLByMindsetWidget } from './PLByMindsetWidget';
import { StrategyPerformancePieChart } from './StrategyPerformancePieChart';
import { DetailedStatistics } from './DetailedStatistics';

interface ReportViewProps {
    trades: Trade[];
    userProfile: UserProfile;
    monthStr: string;
    selectedWidgets: string[];
    equityData: number[];
    stats: any;
    isDarkMode: boolean;
}

export const ReportView: React.FC<ReportViewProps> = ({ 
    trades, 
    userProfile, 
    monthStr, 
    selectedWidgets,
    equityData,
    stats,
    isDarkMode
}) => {
    const currencySymbol = userProfile?.currencySymbol || '$';

    const isVisible = (id: string) => selectedWidgets.includes(id);

    return (
        <div className="print-container print-section bg-white text-black p-8 sm:p-12 w-full max-w-[210mm] mx-auto hidden print:block overflow-visible">
            <style dangerouslySetInnerHTML={{ __html: `
                @media print {
                    @page {
                        size: A4;
                        margin: 10mm;
                    }
                    html, body {
                        height: auto !important;
                        overflow: visible !important;
                        background: white !important;
                        color: black !important;
                    }
                    /* Force hide EVERYTHING */
                    body > * {
                        display: none !important;
                    }
                    /* Except the parent of print-container and the container itself */
                    body > div#root, 
                    body > div#root > div,
                    body > div#root > div > main,
                    body > div#root > div > main > div.print-container-parent,
                    .print-container {
                        display: block !important;
                        position: static !important;
                        height: auto !important;
                        overflow: visible !important;
                        width: 100% !important;
                        max-width: none !important;
                        margin: 0 !important;
                        padding: 0 !important;
                    }
                    
                    .page-break {
                        page-break-before: always !important;
                        break-before: page !important;
                        break-after: page !important;
                        height: 0;
                        margin: 0;
                        border: none;
                    }

                    .avoid-break {
                        display: block !important;
                        width: 100% !important;
                        break-inside: avoid !important;
                        break-inside: avoid-page !important;
                        page-break-inside: avoid !important;
                    }

                    .print-section {
                        width: 100% !important;
                        max-width: none !important;
                    }

                    /* Ensure charts and widgets render colors */
                    * {
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }

                    /* Hide interactive elements */
                    .lucide-circle-question-mark, 
                    .lucide-info,
                    button:not(.print-only) {
                        display: none !important;
                    }
                }
            ` }} />
            {/* Header */}
            <div className="flex justify-between items-start border-b-4 border-black pb-8 mb-10">
                <div>
                    <h1 className="text-5xl font-black tracking-tight mb-3 italic">Trading Performance Report</h1>
                    <div className="flex items-center gap-4">
                        <p className="text-lg font-mono uppercase tracking-[0.3em] bg-black text-white px-3 py-1">{monthStr}</p>
                        <div className="h-px w-12 bg-black opacity-20" />
                        <p className="text-sm font-bold opacity-40 uppercase tracking-widest">{new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
                    </div>
                </div>
                <div className="text-right">
                    <h2 className="text-2xl font-black uppercase tracking-tight">{userProfile.accountName}</h2>
                    <p className="text-base font-bold opacity-60 uppercase tracking-widest">{userProfile.name}</p>
                    <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 rounded-full border border-black/10 text-[10px] font-black uppercase tracking-[0.2em]">
                        <div className="w-2 h-2 rounded-full bg-emerald-500" /> Verified Statement
                    </div>
                </div>
            </div>

            {/* Key Stats Grid (Conditional) */}
            {(isVisible('winRate') || isVisible('profitFactor') || isVisible('grossProfit') || isVisible('grossLoss')) && (
                <div className="grid grid-cols-4 gap-6 mb-12">
                    {isVisible('grossProfit') && (
                        <div className="p-6 border-2 border-black rounded-3xl bg-emerald-50/30">
                            <div className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40 mb-2">Net P&L</div>
                            <div className={`text-3xl font-black ${stats.netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {userProfile.currencySymbol}{stats.netProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </div>
                        </div>
                    )}
                    {isVisible('profitFactor') && (
                        <div className="p-6 border-2 border-black rounded-3xl">
                            <div className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40 mb-2">Profit Factor</div>
                            <div className="text-3xl font-black">{stats.profitFactor}</div>
                        </div>
                    )}
                    {isVisible('winRate') && (
                        <div className="p-6 border-2 border-black rounded-3xl">
                            <div className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40 mb-2">Win Rate</div>
                            <div className="text-3xl font-black">{stats.winRate}%</div>
                        </div>
                    )}
                    <div className="p-6 border-2 border-black rounded-3xl">
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40 mb-2">Total Trades</div>
                        <div className="text-3xl font-black">{stats.totalTrades}</div>
                    </div>
                </div>
            )}

            {/* Detailed Statistics Table */}
            <div className="avoid-break mb-12">
                <h3 className="text-xl font-black uppercase tracking-widest mb-6 flex items-center gap-3">
                    <Table size={24} strokeWidth={3} /> Performance Metrics Detail
                </h3>
                <DetailedStatistics stats={stats} userProfile={userProfile} isDarkMode={false} />
            </div>

            {/* Main Visual Insights */}
            <div className="space-y-12">
                {isVisible('equityCurve') && (
                    <div className="avoid-break mb-12">
                        <h3 className="text-xl font-black uppercase tracking-widest mb-6 flex items-center gap-3">
                            <TrendingUp size={24} strokeWidth={3} /> Account Equity Growth
                        </h3>
                        <div className="h-[320px] w-full p-6 border-2 border-black rounded-[32px]">
                            <EquityCurveWidget 
                                trades={trades} 
                                equityData={equityData} 
                                isDarkMode={false} 
                                currencySymbol={currencySymbol} 
                            />
                        </div>
                    </div>
                )}

                <div className="page-break" />

                <div className="avoid-break grid grid-cols-2 gap-8">
                    {isVisible('drawdown') && (
                        <div className="avoid-break">
                            <h3 className="text-sm font-black uppercase tracking-widest mb-4 opacity-60">Drawdown Exposure</h3>
                            <div className="h-[240px] p-4 border-2 border-black rounded-3xl">
                                <DrawdownOverTimeWidget 
                                    trades={trades} 
                                    isDarkMode={false} 
                                    userProfile={userProfile} 
                                    startingBalance={equityData[0]} 
                                />
                            </div>
                        </div>
                    )}
                    {isVisible('streakMomentum') && (
                        <div className="avoid-break">
                            <h3 className="text-sm font-black uppercase tracking-widest mb-4 opacity-60">Trade Momentum</h3>
                            <div className="h-[240px] p-4 border-2 border-black rounded-3xl">
                                <MomentumStreakWidget trades={trades} isDarkMode={false} />
                            </div>
                        </div>
                    )}
                </div>

                {isVisible('timeAnalysis') && (
                    <div className="avoid-break pt-8 border-t border-black/10">
                        <h3 className="text-xl font-black uppercase tracking-widest mb-6 flex items-center gap-3">
                            <Clock size={24} strokeWidth={3} /> Time Performance Analysis
                        </h3>
                        <div className="p-2 border-2 border-black rounded-[32px] overflow-hidden">
                            <PerformanceBySession trades={trades} isDarkMode={false} currencySymbol={currencySymbol} />
                        </div>
                    </div>
                )}

                <div className="page-break" />

                <div className="avoid-break grid grid-cols-1 gap-8">
                    {isVisible('symbolPerformance') && (
                        <div className="avoid-break">
                            <h3 className="text-sm font-black uppercase tracking-widest mb-4 opacity-60">Symbol Breakdown</h3>
                            <div className="p-6 border-2 border-black rounded-3xl h-full">
                                <SymbolPerformanceWidget trades={trades} isDarkMode={false} currencySymbol={currencySymbol} />
                            </div>
                        </div>
                    )}
                </div>

                {isVisible('perfByPair') && (
                    <div className="avoid-break pt-8 border-t border-black/10">
                        <h3 className="text-xl font-black uppercase tracking-widest mb-6">Performance By Instrument</h3>
                        <div className="h-[300px] p-6 border-2 border-black rounded-[32px]">
                            <PerformanceByPairWidget trades={trades} isDarkMode={false} currencySymbol={currencySymbol} />
                        </div>
                    </div>
                )}

                <div className="avoid-break grid grid-cols-2 gap-8">
                    {isVisible('tiltScore') && (
                        <div className="avoid-break">
                            <h3 className="text-sm font-black uppercase tracking-widest mb-4 opacity-60">Discipline Score</h3>
                            <div className="p-6 border-2 border-black rounded-3xl h-full">
                                <TiltScoreWidget trades={trades} isDarkMode={false} />
                            </div>
                        </div>
                    )}
                    {isVisible('riskReward') && (
                        <div className="avoid-break">
                            <h3 className="text-sm font-black uppercase tracking-widest mb-4 opacity-60">Efficiency Metrics</h3>
                            <div className="p-8 border-2 border-black rounded-3xl bg-indigo-50/30 h-full flex flex-col justify-center">
                                <div className="space-y-6">
                                    <div className="flex justify-between items-end">
                                        <span className="text-[10px] font-black uppercase tracking-widest opacity-40">Avg Win</span>
                                        <span className="text-xl font-black text-emerald-600">{currencySymbol}{Math.round(stats.avgWin).toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between items-end">
                                        <span className="text-[10px] font-black uppercase tracking-widest opacity-40">Avg Loss</span>
                                        <span className="text-xl font-black text-rose-600">{currencySymbol}{Math.round(stats.avgLoss).toLocaleString()}</span>
                                    </div>
                                    <div className="pt-6 border-t-2 border-black flex justify-between items-end">
                                        <span className="text-xs font-black uppercase tracking-[0.2em]">Expectancy (R:R)</span>
                                        <span className="text-2xl font-black text-indigo-600">1 : {stats.rrRatio}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="page-break" />

                {isVisible('plMindset') && (
                    <div className="avoid-break">
                        <h3 className="text-sm font-black uppercase tracking-widest mb-4 opacity-60">Psychology & P/L</h3>
                        <div className="h-[280px] p-6 border-2 border-black rounded-[32px]">
                            <PLByMindsetWidget trades={trades} isDarkMode={false} currencySymbol={currencySymbol} />
                        </div>
                    </div>
                )}



                {isVisible('strategyPerf') && (
                    <div className="avoid-break pt-8 border-t border-black/10">
                        <h3 className="text-xl font-black uppercase tracking-widest mb-6 flex items-center gap-3">
                            <Target size={24} strokeWidth={3} /> Strategic Edge Analysis
                        </h3>
                        <div className="h-[400px] p-6 border-2 border-black rounded-[32px]">
                            <StrategyPerformancePieChart trades={trades} isDarkMode={false} currencySymbol={currencySymbol} />
                        </div>
                    </div>
                )}

            </div>

            <div className="page-break" />

            {/* Trade Log Table (Full Page if long) */}
            {isVisible('executionTable') && (
                <div className="pt-12">
                    <h3 className="text-2xl font-black uppercase tracking-tight mb-8 flex items-center gap-3">
                        <Activity size={28} strokeWidth={3} /> Detailed Execution Log
                    </h3>
                    <div className="overflow-x-auto border-2 border-black rounded-3xl">
                        <table className="w-full min-w-[560px] text-left text-[10px]">
                            <thead className="bg-black text-white">
                                <tr className="font-black uppercase tracking-widest">
                                    <th className="p-4">Date / Time</th>
                                    <th className="p-4">Instrument</th>
                                    <th className="p-4">Side</th>
                                    <th className="p-4 text-right">Size</th>
                                    <th className="p-4 text-right">Result</th>
                                    <th className="p-4 text-right">Net P&L</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-black/10">
                                {trades.map(t => (
                                    <tr key={t.id} className="font-bold">
                                        <td className="p-4 font-mono opacity-60 whitespace-nowrap">{t.date} <span className="opacity-30">{t.time}</span></td>
                                        <td className="p-4 font-black text-sm">{t.pair}</td>
                                        <td className="p-4">
                                            <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${t.direction === 'Long' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'}`}>
                                                {t.direction}
                                            </span>
                                        </td>
                                        <td className="p-4 text-right font-mono opacity-60">{t.lots}</td>
                                        <td className="p-4 text-right uppercase tracking-tighter italic">{t.result}</td>
                                        <td className={`p-4 text-right font-black text-sm ${t.pnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                            {t.pnl >= 0 ? '+' : ''}{userProfile.currencySymbol}{Math.abs(t.pnl).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Footer */}
            <div className="mt-20 border-t-2 border-black pt-8 flex justify-between items-center text-[10px] font-black uppercase tracking-[0.3em]">
                <div>JFX-JOURNAL Analytics Engine v2.0</div>
                <div className="opacity-40">{new Date().getFullYear()} © All Rights Reserved</div>
            </div>
        </div>
    );
};
