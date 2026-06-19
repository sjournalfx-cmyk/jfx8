
import React, { useMemo } from "react"
import { Pie, PieChart } from "recharts"
import { Trade } from "../../types"
import { 
  ChartContainer, 
  ChartTooltip, 
  ChartTooltipContent, 
  type ChartConfig 
} from "../ui/chart"
import { PieChart as PieChartIcon, HelpCircle } from "lucide-react"
import { clsx } from "clsx"
import { Tooltip } from "../ui/Tooltip"

interface OutcomeDistributionWidgetProps {
  trades: Trade[]
  isDarkMode: boolean
}

const chartConfig = {
  value: {
    label: "Trades",
  },
  win: {
    label: "Wins",
    color: "#00B69B",
  },
  loss: {
    label: "Losses",
    color: "#FF202D",
  },
  be: {
    label: "BE",
    color: "#71717a",
  },
} satisfies ChartConfig

export const OutcomeDistributionWidget: React.FC<OutcomeDistributionWidgetProps> = ({ trades = [], isDarkMode }) => {
  const safeTrades = trades || []
  const total = safeTrades.length || 1
  
  const winCount = safeTrades.filter(t => t.result === 'Win').length
  const lossCount = safeTrades.filter(t => t.result === 'Loss').length
  const beCount = safeTrades.filter(t => t.result === 'BE').length

  const chartData = useMemo(() => [
    { result: "win", value: winCount, fill: "#00B69B" },
    { result: "loss", value: lossCount, fill: "#FF202D" },
    { result: "be", value: beCount, fill: "#71717a" },
  ], [winCount, lossCount, beCount])

  return (
    <div className={clsx(
      "h-full p-6 rounded-[32px] border flex flex-col justify-between",
      isDarkMode ? "bg-black border-zinc-900 shadow-2xl" : "bg-white border-slate-200 shadow-sm"
    )}>
      <div className="flex items-center gap-3 mb-4 self-start">
        <div className={clsx("p-2 rounded-xl", isDarkMode ? "bg-black" : "bg-slate-100")}>
          <PieChartIcon size={20} className="text-teal-500" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-black tracking-tight italic uppercase">Outcome Distribution</h3>
            <Tooltip content="Pie chart showing the proportion of Wins, Losses, and Break-Even trades across your journal." isDarkMode={isDarkMode}>
              <HelpCircle size={13} className="opacity-40 cursor-help hover:opacity-100" />
            </Tooltip>
          </div>
          <p className="text-[10px] font-bold opacity-40 uppercase tracking-widest mt-0.5">Trade Result Mix</p>
        </div>
      </div>

      <div className="flex-1 pb-0">
        <ChartContainer
          config={chartConfig}
          className="mx-auto aspect-square max-h-[250px]"
        >
          <PieChart>
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel />}
            />
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="result"
              innerRadius={70}
              outerRadius={100}
              strokeWidth={5}
              stroke={isDarkMode ? "#09090b" : "#fff"}
              animationDuration={1500}
            />
          </PieChart>
        </ChartContainer>
      </div>

      <div className="grid grid-cols-3 gap-4 mt-6 border-t border-zinc-500/10 pt-6">
        {[
          { label: "Wins", count: winCount, color: "bg-[#00B69B]" },
          { label: "Losses", count: lossCount, color: "bg-[#FF202D]" },
          { label: "BE", count: beCount, color: "bg-zinc-500" },
        ].map((item, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-1.5">
              <div className={clsx("w-2 h-2 rounded-full", item.color)} />
              <span className="text-[10px] font-black uppercase tracking-wider opacity-40">{item.label}</span>
            </div>
            <span className="text-sm font-black">{item.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
