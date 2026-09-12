"use client"

import * as React from "react"
import { AlertTriangle, TriangleAlert, HelpCircle } from "lucide-react"
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts"
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
import { Tooltip } from "../ui/Tooltip"

interface TradingMistakesBarChartWidgetProps {
  trades: Trade[]
  isDarkMode: boolean
  onInfoClick?: () => void
}

const MISTAKE_COLORS = [
  "#f43f5e", // Rose
  "#3b82f6", // Blue
  "#10b981", // Emerald
  "#eab308", // Amber
  "#a855f7", // Purple
  "#f97316", // Orange
  "#06b6d4", // Cyan
  "#ec4899", // Pink
  "#14b8a6", // Teal
  "#6366f1"  // Indigo
]

const chartConfig = {
  mistakes: {
    label: "Mistakes",
    color: "#f43f5e",
  },
} satisfies ChartConfig

const isNonMistakeLabel = (value: string) =>
  /^(none|n\/a|na|no mistake|no mistakes|none recorded|clean)$/i.test(value.trim())

export function TradingMistakesBarChartWidget({ trades = [], isDarkMode, onInfoClick }: TradingMistakesBarChartWidgetProps) {
  // All mistake lines render together (Top mistakes footer removed).

  // Sort trades chronologically to build the line chart timeline (Optimized & Stable)
  const chronologicalTrades = React.useMemo(() => {
    return trades
      .filter((trade) => trade.result !== "Pending")
      .map((trade, index) => {
        const timeStr = trade.time || "00:00:00"
        const timestamp = new Date(`${trade.date}T${timeStr}`).getTime()
        return { trade, timestamp, index }
      })
      .sort((a, b) => {
        if (a.timestamp !== b.timestamp) {
          return a.timestamp - b.timestamp
        }
        return a.index - b.index
      })
      .map((item) => item.trade)
  }, [trades])

  // Get total statistics for the widgets and top list
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

    return sorted
  }, [trades])

  // Unique mistake types present in the data
  const mistakeTypes = React.useMemo(() => {
    return mistakeData.map(item => item.mistake)
  }, [mistakeData])

  // Build the cumulative count line chart data
  const lineChartData = React.useMemo(() => {
    const data: any[] = []
    const currentCounts: Record<string, number> = {}

    mistakeTypes.forEach((type) => {
      currentCounts[type] = 0
    })

    chronologicalTrades.forEach((trade, index) => {
      const rawMistake = (trade.tradingMistake || "").trim()
      if (rawMistake && !isNonMistakeLabel(rawMistake)) {
        const label = rawMistake.replace(/\s+/g, " ")
        if (currentCounts[label] !== undefined) {
          currentCounts[label]++
        }
      }

      data.push({
        name: `Trade #${index + 1}`,
        date: trade.date,
        ...currentCounts,
      })
    })

    return data
  }, [chronologicalTrades, mistakeTypes])

  const totalMistakes = React.useMemo(
    () => mistakeData.reduce((sum, item) => sum + item.count, 0),
    [mistakeData]
  )

  const mostCommonMistake = mistakeData[0]

  const tooltipContent = React.useCallback(({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null

    const tradeData = payload[0].payload
    const dateStr = tradeData.date ? ` (${tradeData.date})` : ""

    return (
      <div className={`rounded-2xl border p-4 shadow-2xl backdrop-blur ${isDarkMode ? 'bg-[#000000] border-zinc-800 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'}`}>
        <div className="flex items-center gap-2 pb-2 mb-2 border-b border-zinc-500/10">
          <span className="text-[11px] font-black uppercase tracking-[0.18em]">{label}{dateStr}</span>
        </div>
        <div className="space-y-1.5 min-w-[180px]">
          {payload.map((entry: any) => (
            <div key={entry.name} className="flex items-center justify-between gap-8">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.stroke || entry.color }} />
                <span className="text-[10px] font-bold uppercase tracking-widest opacity-60">{entry.name}</span>
              </div>
              <span className="text-xs font-black">{entry.value}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }, [isDarkMode])

  return (
    <Card
      data-chart="trading-mistakes-bar"
      className="relative flex h-full min-h-[320px] flex-col overflow-hidden !border-0 !bg-[#0a0a0a] !shadow-none text-white rounded-[20px]"
      isDarkMode={isDarkMode}
    >
      <ChartStyle id="trading-mistakes-bar" config={chartConfig} />
      <CardHeader className="flex-row items-start gap-3 space-y-0 pb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <CardTitle className="text-[15px] font-semibold tracking-tight text-left">Trading Mistakes</CardTitle>
            <Tooltip content="Tracks the frequency and accumulation of self-reported trading mistakes over time. Click legend items to toggle lines." isDarkMode={isDarkMode} onInfoClick={onInfoClick}>
              <HelpCircle size={13} className="opacity-40 cursor-help hover:opacity-100" />
            </Tooltip>
          </div>
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
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <div className="rounded-xl border-0 p-1.5 px-3 bg-white/[0.06]">
            <div className="text-[9px] font-black uppercase tracking-widest opacity-50">Total mistakes</div>
            <div className="mt-0.5 text-base font-black">{totalMistakes}</div>
          </div>
          <div className="rounded-xl border-0 p-1.5 px-3 bg-white/[0.06]">
            <div className="text-[9px] font-black uppercase tracking-widest opacity-50">Unique types</div>
            <div className="mt-0.5 text-base font-black">{mistakeData.length}</div>
          </div>
          <div className="rounded-xl border-0 p-1.5 px-3 bg-white/[0.06]">
            <div className="text-[9px] font-black uppercase tracking-widest opacity-50">Most common</div>
            <div className="flex items-baseline justify-between gap-2 mt-0.5">
              <div className="truncate text-xs font-black">{mostCommonMistake?.mistake || 'None'}</div>
              <div className="text-[9px] font-bold uppercase tracking-widest opacity-50 shrink-0">
                {mostCommonMistake ? `(${mostCommonMistake.count})` : ''}
              </div>
            </div>
          </div>
        </div>

        {mistakeData.length === 0 ? (
          <div className={`flex flex-1 min-h-[160px] items-center justify-center rounded-[28px] border border-dashed text-center ${isDarkMode ? 'border-zinc-800 bg-black text-zinc-500' : 'border-slate-200 bg-slate-50 text-slate-400'}`}>
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
            <LineChart
              accessibilityLayer
              data={lineChartData}
              margin={{
                left: 0,
                right: 8,
                top: 10,
                bottom: 5,
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)'} />
              <XAxis 
                dataKey="name" 
                tickLine={false}
                axisLine={false}
                tick={{ fill: isDarkMode ? '#a1a1aa' : '#475569', fontSize: 10, fontWeight: 700 }}
              />
              <YAxis
                allowDecimals={false}
                width={32}
                tickLine={false}
                axisLine={false}
                tick={{ fill: isDarkMode ? '#a1a1aa' : '#475569', fontSize: 10, fontWeight: 700 }}
              />
              <ChartTooltip
                cursor={{ stroke: isDarkMode ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.05)', strokeWidth: 1 }}
                content={tooltipContent}
              />
              {mistakeTypes.map((type, idx) => {
                const color = MISTAKE_COLORS[idx % MISTAKE_COLORS.length]

                return (
                  <Line
                    key={type}
                    type="monotone"
                    dataKey={type}
                    stroke={color}
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                )
              })}
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}


