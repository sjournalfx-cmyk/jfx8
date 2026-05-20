"use client"

import * as React from "react"
import { AlertTriangle, BarChart3, TriangleAlert } from "lucide-react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Trade } from "../../types"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/Card"
import {
  ChartContainer,
  ChartStyle,
  ChartTooltip,
  type ChartConfig,
} from "../ui/chart"

interface TradingMistakesBarChartWidgetProps {
  trades: Trade[]
  isDarkMode: boolean
}

const chartConfig = {
  mistakes: {
    label: "Mistakes",
    color: "#f43f5e",
  },
} satisfies ChartConfig

const isNonMistakeLabel = (value: string) =>
  /^(none|n\/a|na|no mistake|no mistakes|none recorded|clean)$/i.test(value.trim())

export function TradingMistakesBarChartWidget({ trades = [], isDarkMode }: TradingMistakesBarChartWidgetProps) {
  const mistakeData = React.useMemo(() => {
    const mistakeMap = new Map<string, number>()

    trades.forEach((trade) => {
      const rawMistake = (trade.tradingMistake || "").trim()
      if (!rawMistake || isNonMistakeLabel(rawMistake)) return

      const label = rawMistake.replace(/\s+/g, " ")
      mistakeMap.set(label, (mistakeMap.get(label) || 0) + 1)
    })

    const sorted = Array.from(mistakeMap.entries())
      .map(([mistake, count]) => ({ mistake, count }))
      .sort((a, b) => b.count - a.count)

    if (sorted.length <= 7) return sorted

    const topSix = sorted.slice(0, 6)
    const othersCount = sorted.slice(6).reduce((sum, item) => sum + item.count, 0)

    return [
      ...topSix,
      { mistake: "Others", count: othersCount },
    ]
  }, [trades])

  const totalMistakes = React.useMemo(
    () => mistakeData.reduce((sum, item) => sum + item.count, 0),
    [mistakeData]
  )

  const topMistakes = React.useMemo(() => mistakeData.slice(0, 3), [mistakeData])

  const mostCommonMistake = mistakeData[0]

  const truncatedTick = React.useCallback((value: string) => {
    if (value.length <= 18) return value
    return `${value.slice(0, 18)}...`
  }, [])

  const tooltipContent = React.useCallback(({ active, payload }: any) => {
    if (!active || !payload?.length) return null

    const data = payload[0].payload as { mistake: string; count: number }

    return (
      <div className={`rounded-2xl border p-4 shadow-2xl backdrop-blur ${isDarkMode ? 'bg-[#111114] border-zinc-800 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'}`}>
        <div className="flex items-center gap-2 pb-3 mb-3 border-b border-zinc-500/10">
          <div className="h-2.5 w-2.5 rounded-full bg-rose-500" />
          <span className="text-[11px] font-black uppercase tracking-[0.18em]">{data.mistake}</span>
        </div>
        <div className="flex items-center justify-between gap-8">
          <span className="text-[10px] font-bold uppercase tracking-widest opacity-50">Occurrences</span>
          <span className="text-sm font-black">{data.count}</span>
        </div>
      </div>
    )
  }, [isDarkMode])

  return (
    <Card
      data-chart="trading-mistakes-bar"
      className={`relative flex h-full min-h-[320px] flex-col overflow-hidden border shadow-sm ${isDarkMode ? 'border-zinc-800 bg-[#0d1117]' : 'border-slate-200 bg-white'}`}
      isDarkMode={isDarkMode}
    >
      <ChartStyle id="trading-mistakes-bar" config={chartConfig} />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-rose-500/50 to-transparent" />
      <CardHeader className="flex-row items-start gap-3 space-y-0 pb-2">
        <div className={`flex h-8 w-8 items-center justify-center rounded-2xl border ${isDarkMode ? 'border-rose-500/20 bg-rose-500/10' : 'border-rose-500/15 bg-rose-50'}`}>
          <BarChart3 size={16} className="text-rose-500" />
        </div>
        <div className="min-w-0 flex-1">
          <CardTitle className="text-base tracking-tight">Trading Mistakes</CardTitle>
          <CardDescription className="mt-1 max-w-[24rem] text-sm">
            Patterns that keep repeating in your journal
          </CardDescription>
        </div>
        <div className="ml-auto flex flex-col items-end gap-2">
          <div className="flex items-center gap-2 rounded-full border border-rose-500/20 bg-rose-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-rose-500">
            <TriangleAlert size={13} />
            {totalMistakes} total
          </div>
          <div className={`text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>
            {mistakeData.length} unique types
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2 pt-0 pb-0">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className={`rounded-2xl border p-2.5 ${isDarkMode ? 'border-zinc-800 bg-white/5' : 'border-slate-200 bg-slate-50'}`}>
            <div className="text-[10px] font-black uppercase tracking-widest opacity-50">Total mistakes</div>
            <div className="mt-1 text-lg font-black">{totalMistakes}</div>
          </div>
          <div className={`rounded-2xl border p-2.5 ${isDarkMode ? 'border-zinc-800 bg-white/5' : 'border-slate-200 bg-slate-50'}`}>
            <div className="text-[10px] font-black uppercase tracking-widest opacity-50">Unique types</div>
            <div className="mt-1 text-lg font-black">{mistakeData.length}</div>
          </div>
          <div className={`rounded-2xl border p-2.5 ${isDarkMode ? 'border-zinc-800 bg-white/5' : 'border-slate-200 bg-slate-50'}`}>
            <div className="text-[10px] font-black uppercase tracking-widest opacity-50">Most common</div>
            <div className="mt-1 truncate text-sm font-black">{mostCommonMistake?.mistake || 'None'}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-widest opacity-50">
              {mostCommonMistake ? `${mostCommonMistake.count} occurrences` : 'No data'}
            </div>
          </div>
        </div>

        {mistakeData.length === 0 ? (
          <div className={`flex flex-1 min-h-[160px] items-center justify-center rounded-[28px] border border-dashed text-center ${isDarkMode ? 'border-zinc-800 bg-white/5 text-zinc-500' : 'border-slate-200 bg-slate-50 text-slate-400'}`}>
            <div className="space-y-3 px-6">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-500/20 bg-rose-500/10 text-rose-500">
                <AlertTriangle size={22} />
              </div>
              <div className="text-sm font-black uppercase tracking-widest">No trading mistakes logged</div>
              <div className="text-[11px] font-medium normal-case tracking-normal opacity-70">
                Add a mistake label to trades to reveal the most common errors.
              </div>
            </div>
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[200px] w-full">
            <BarChart
              accessibilityLayer
              data={mistakeData}
                layout="vertical"
                margin={{
                left: 8,
                right: 16,
                top: 0,
                bottom: 0,
                }}
              >
              <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke={isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)'} />
              <XAxis type="number" dataKey="count" hide />
              <YAxis
                dataKey="mistake"
                type="category"
                tickLine={false}
                axisLine={false}
                tickMargin={10}
                width={128}
                tick={{ fill: isDarkMode ? '#a1a1aa' : '#475569', fontSize: 11, fontWeight: 700 }}
                tickFormatter={truncatedTick}
              />
              <ChartTooltip
                cursor={false}
                content={tooltipContent}
              />
              <Bar
                dataKey="count"
                fill="var(--color-mistakes)"
                radius={[0, 10, 10, 0]}
                barSize={18}
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
      <div className="mt-auto border-t border-zinc-500/10 p-3 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[10px] font-black uppercase tracking-widest opacity-50">
            Top mistakes
          </div>
          <div className="flex flex-wrap gap-2">
            {topMistakes.length > 0 ? topMistakes.map((item) => (
              <div
                key={item.mistake}
                className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'border-zinc-800 bg-white/5 text-zinc-200' : 'border-slate-200 bg-slate-50 text-slate-700'}`}
              >
                {item.mistake} <span className="opacity-50">({item.count})</span>
              </div>
            )) : (
              <div className="text-[10px] font-black uppercase tracking-widest opacity-40">No breakdown yet</div>
            )}
          </div>
        </div>
      </div>
      <div className="absolute bottom-0 left-0 h-px w-full bg-gradient-to-r from-transparent via-rose-500/30 to-transparent" />
    </Card>
  )
}
