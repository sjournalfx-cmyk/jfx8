"use client"

import * as React from "react"
import { Label, Pie, PieChart, Sector } from "recharts"
import { PieSectorShapeProps } from "recharts/types/polar/Pie"
import { Trade } from "../../types"
import { HelpCircle } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/Card"
import {
  ChartContainer,
  type ChartConfig,
} from "../ui/chart"
import { Select } from "../Select"
import { Tooltip } from "../ui/Tooltip"

interface StrategyEfficiencyMinimalProps {
  trades: Trade[]
  isDarkMode: boolean;
  currencySymbol: string;
  onInfoClick?: () => void;
}

export function StrategyPerformancePieChart({ trades = [], isDarkMode, currencySymbol = '$', onInfoClick }: StrategyEfficiencyMinimalProps) {
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

  if (strategyData.length === 0) {
    return (
      <Card className="flex h-[320px] flex-col items-center justify-center !bg-[#0a0a0a] !border-0 text-white" isDarkMode={isDarkMode}>
        <CardHeader className="text-center">
          <CardTitle>Strategy Distribution</CardTitle>
          <CardDescription>No strategy data available. Tag your trades to see performance.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card data-chart={id} className="relative flex h-full min-h-[320px] flex-col !border-0 !bg-[#0a0a0a] !shadow-none text-white rounded-[20px] overflow-visible" isDarkMode={isDarkMode}>
      <CardHeader className="flex-row items-center space-y-0 pb-1 pt-1 px-4 !justify-between pr-[132px]">
        <div className="flex flex-col gap-0.5 justify-center justify-items-start text-left">
          <div className="flex items-center gap-1.5">
            <CardTitle className="text-[13px] font-semibold tracking-tight text-left leading-none">Strategy Distribution</CardTitle>
            <Tooltip content="Breaks down your trade count and cumulative P/L by trading strategy tag. Click a slice or use the dropdown to focus." isDarkMode={isDarkMode} onInfoClick={onInfoClick}>
              <HelpCircle size={12} className="opacity-40 cursor-help hover:opacity-100" />
            </Tooltip>
          </div>
          <CardDescription className="text-[11px] leading-none opacity-70">Performance by Strategy</CardDescription>
        </div>
        <div className="absolute top-2 right-3 w-[118px] scale-[0.88] origin-top-right z-10">
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
          className="mx-auto aspect-square w-full max-w-[230px] scale-[0.75]"
        >
          <PieChart>
            <Pie
              data={strategyData}
              dataKey="trades"
              nameKey="strategy"
              innerRadius={50}
              strokeWidth={4}
              stroke={isDarkMode ? "#000000" : "#e2e8f0"}
              shape={renderPieShape}
              onClick={(_, index) => setActiveStrategy(strategyData[index].strategy)}
              onMouseEnter={(_, index) => setActiveStrategy(strategyData[index].strategy)}
              isAnimationActive={false}
              className="cursor-pointer"
            >
              <Label
                content={({ viewBox }) => {
                  if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                    const currentData = strategyData[activeIndex];
                    if (!currentData) return null;
                    const cx = viewBox.cx;
                    const cy = viewBox.cy || 0;
                    const displayName = currentData.strategy.length > 10
                      ? `${currentData.strategy.slice(0, 9)}…`
                      : currentData.strategy;
                    return (
                      <text
                        x={cx}
                        y={cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        <tspan
                          x={cx}
                          y={cy - 22}
                          className={`${isDarkMode ? 'fill-slate-400' : 'fill-slate-500'} text-[10px] font-semibold uppercase tracking-wider`}
                        >
                          {displayName}
                        </tspan>
                        <tspan
                          x={cx}
                          y={cy + 4}
                          className={`${isDarkMode ? 'fill-white' : 'fill-slate-900'} text-2xl font-bold`}
                        >
                          {currentData.trades.toLocaleString()}
                        </tspan>
                        <tspan
                          x={cx}
                          y={cy + 28}
                          className={`${currentData.pnl >= 0 ? 'fill-emerald-500' : 'fill-rose-500'} text-[11px] font-bold`}
                        >
                          {currentData.pnl >= 0 ? '+' : '-'}
                          {currencySymbol}{Math.abs(Math.round(currentData.pnl)).toLocaleString()}
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
