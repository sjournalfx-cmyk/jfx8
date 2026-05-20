"use client"

import * as React from "react"
import { Label, Pie, PieChart, Sector } from "recharts"
import { PieSectorShapeProps } from "recharts/types/polar/Pie"
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
  ChartTooltipContent,
  type ChartConfig,
} from "../ui/chart"
import { Select } from "../Select"

interface StrategyEfficiencyMinimalProps {
  trades: Trade[]
  isDarkMode: boolean;
  currencySymbol: string;
}

export function StrategyPerformancePieChart({ trades = [], isDarkMode, currencySymbol = '$' }: StrategyEfficiencyMinimalProps) {
  const id = "strategy-performance-pie"
  
  // 1. Get all unique strategies to establish consistent colors
  const allStrategies = React.useMemo(() => {
    const strategies = new Set<string>();
    trades.forEach(t => {
      const tags = t.tags || ["Untagged"];
      tags.forEach(tag => strategies.add(tag.trim()));
    });
    return Array.from(strategies).sort();
  }, [trades]);

  // 2. Create a stable color mapping with MUTED professional colors
  const colorMap = React.useMemo(() => {
    // desaturated professional palette
    const lightColors = ['#6366f1cc', '#10b981cc', '#f59e0bcc', '#f43f5ecc', '#8b5cf6cc'];
    const darkColors = ['#818cf8aa', '#34d399aa', '#fbbf24aa', '#f87171aa', '#a78bfaaa'];
    const colors = isDarkMode ? darkColors : lightColors;
    
    const map: Record<string, string> = {};
    allStrategies.forEach((strat, index) => {
      map[strat] = colors[index % colors.length];
    });
    // Add "Others" to the map
    map["Others"] = colors[4]; 
    return map;
  }, [allStrategies, isDarkMode]);

  // 3. Aggregate data from trades with "Others" logic
  const strategyData = React.useMemo(() => {
    const strategyMap: Record<string, { pnl: number, count: number }> = {};
    
    trades.forEach(t => {
      const tags = t.tags || ["Untagged"];
      tags.forEach(tag => {
        const name = tag.trim();
        if (!strategyMap[name]) strategyMap[name] = { pnl: 0, count: 0 };
        strategyMap[name].pnl += t.pnl;
        strategyMap[name].count += 1;
      });
    });

    const sortedEntries = Object.entries(strategyMap)
      .map(([name, data]) => ({
        strategy: name,
        trades: data.count,
        pnl: data.pnl
      }))
      .sort((a, b) => b.trades - a.trades);

    if (sortedEntries.length <= 8) {
      return sortedEntries.map(d => ({
        ...d,
        fill: colorMap[d.strategy]
      }));
    }

    // Aggregate into Top 7 + Others
    const top7 = sortedEntries.slice(0, 7);
    const others = sortedEntries.slice(7).reduce((acc, curr) => {
      acc.trades += curr.trades;
      acc.pnl += curr.pnl;
      return acc;
    }, { strategy: "Others", trades: 0, pnl: 0 });

    return [
      ...top7.map(d => ({ ...d, fill: colorMap[d.strategy] })),
      { ...others, fill: colorMap["Others"] }
    ];
  }, [trades, colorMap]);

  const [activeStrategy, setActiveStrategy] = React.useState("")

  // Update active strategy when data changes or if none selected
  React.useEffect(() => {
    if (strategyData.length > 0 && (!activeStrategy || !strategyData.find(d => d.strategy === activeStrategy))) {
      setActiveStrategy(strategyData[0].strategy);
    }
  }, [strategyData, activeStrategy]);

  const chartConfig = React.useMemo(() => {
    const config: ChartConfig = {
      trades: { label: "Trades" }
    };
    strategyData.forEach((d) => {
      config[d.strategy] = {
        label: d.strategy,
        color: d.fill
      };
    });
    return config;
  }, [strategyData]);

  const activeIndex = React.useMemo(
    () => strategyData.findIndex((item) => item.strategy === activeStrategy),
    [activeStrategy, strategyData]
  )

  const renderPieShape = React.useCallback(
    ({ index, outerRadius = 0, fill, ...props }: PieSectorShapeProps) => {
      if (index === activeIndex) {
        return (
          <g>
            <Sector {...props} outerRadius={outerRadius + 10} fill={fill} />
            <Sector
              {...props}
              outerRadius={outerRadius + 25}
              innerRadius={outerRadius + 12}
              fill={fill}
              fillOpacity={0.6}
            />
          </g>
        )
      }
      return <Sector {...props} outerRadius={outerRadius} fill={fill} />
    },
    [activeIndex]
  )

  const totalPnl = React.useMemo(() => 
    strategyData.reduce((acc, curr) => acc + curr.pnl, 0), 
  [strategyData]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const pnlPercentage = totalPnl > 0 ? (data.pnl / totalPnl) * 100 : 0;
      
      return (
        <div className={`p-4 rounded-xl border shadow-2xl ${isDarkMode ? 'bg-[#18181b] border-zinc-800 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'}`}>
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-zinc-500/10">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: data.fill }} />
            <span className="font-black text-sm uppercase tracking-tight">{data.strategy}</span>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between gap-10 text-[11px]">
              <span className={`${isDarkMode ? 'text-zinc-400' : 'text-slate-500'} font-bold uppercase tracking-wider`}>Trades</span>
              <span className="font-black">{data.trades}</span>
            </div>
            <div className="flex justify-between gap-10 text-[11px]">
              <span className={`${isDarkMode ? 'text-zinc-400' : 'text-slate-500'} font-bold uppercase tracking-wider`}>Net P&L</span>
              <span className={`font-black ${data.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                {data.pnl >= 0 ? '+' : ''}{currencySymbol}{data.pnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            {totalPnl > 0 && data.pnl > 0 && (
              <div className="flex justify-between gap-10 text-[11px] pt-2 border-t border-zinc-500/20">
                <span className={`${isDarkMode ? 'text-zinc-400' : 'text-slate-500'} font-bold uppercase tracking-wider`}>Profit Share</span>
                <span className="font-black text-indigo-500">{pnlPercentage.toFixed(1)}%</span>
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  if (strategyData.length === 0) {
    return (
      <Card className="flex h-[320px] flex-col items-center justify-center" isDarkMode={isDarkMode}>
        <CardHeader className="text-center">
          <CardTitle>Strategy Distribution</CardTitle>
          <CardDescription>No strategy data available. Tag your trades to see performance.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card data-chart={id} className="flex h-full min-h-[320px] flex-col border border-zinc-900 bg-[#000000]" isDarkMode={isDarkMode}>
      <CardHeader className="flex-row items-start space-y-0 pb-0">
        <div className="grid gap-1">
          <CardTitle>Strategy Distribution</CardTitle>
          <CardDescription>Performance by Strategy</CardDescription>
        </div>
        <div className="ml-auto w-[150px]">
          <Select 
            value={activeStrategy} 
            onChange={setActiveStrategy}
            isDarkMode={isDarkMode}
            options={strategyData.map(d => ({ value: d.strategy, label: d.strategy }))}
          />
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 justify-center pb-0">
        <ChartContainer
          config={chartConfig}
          className="mx-auto aspect-square w-full max-w-[230px]"
        >
          <PieChart>
            <ChartTooltip
              cursor={false}
              allowEscapeViewBox={{ x: true, y: true }}
              position={{ x: 246, y: 18 }}
              wrapperStyle={{ pointerEvents: 'none', zIndex: 30 }}
              content={<CustomTooltip />}
            />
            <Pie
              data={strategyData}
              dataKey="trades"
              nameKey="strategy"
              innerRadius={50}
              strokeWidth={4}
              stroke={isDarkMode ? "#000000" : "#e2e8f0"}
              shape={renderPieShape}
              onClick={(_, index) => setActiveStrategy(strategyData[index].strategy)}
              isAnimationActive={false}
              className="cursor-pointer"
            >
              <Label
                content={({ viewBox }) => {
                  if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                    const currentData = strategyData[activeIndex];
                    if (!currentData) return null;
                    return (
                      <text
                        x={viewBox.cx}
                        y={viewBox.cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        <tspan
                          x={viewBox.cx}
                          y={viewBox.cy}
                          className={`${isDarkMode ? 'fill-white' : 'fill-slate-900'} text-3xl font-bold`}
                        >
                          {currentData.trades.toLocaleString()}
                        </tspan>
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy || 0) + 24}
                          className={`${isDarkMode ? 'fill-slate-500' : 'fill-slate-400'} text-xs uppercase tracking-wider`}
                        >
                          Trades
                        </tspan>
                      </text>
                    )
                  }
                }}
              />
            </Pie>
          </PieChart>
        </ChartContainer>
      </CardContent>
      <div className="p-6 pt-0 mt-auto flex flex-wrap justify-center gap-4 text-xs">
        {strategyData.map((d) => (
          <div key={d.strategy} className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: d.fill }} />
            <span className="opacity-70">{d.strategy}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}
