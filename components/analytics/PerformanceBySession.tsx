import React from 'react';
import { Trade } from '../../types';
import { MarketSessionWidget, HourlyPerformanceWidget, DailyActivityHeatmap } from './SessionWidgets';

interface PerformanceBySessionProps {
  trades: Trade[];
  isDarkMode: boolean;
  currencySymbol: string;
  onMarketSessionsInfoClick?: () => void;
  onHourlyPerformanceInfoClick?: () => void;
  onDailyActivityInfoClick?: () => void;
}

export const PerformanceBySession: React.FC<PerformanceBySessionProps> = ({ trades, isDarkMode, currencySymbol, onMarketSessionsInfoClick, onHourlyPerformanceInfoClick, onDailyActivityInfoClick }) => {
  return (
    <div className="space-y-8">
      {/* Bento Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
        
        {/* Market Sessions - Main Feature */}
        <div className="md:col-span-12 lg:col-span-8 h-full">
          <MarketSessionWidget 
            trades={trades} 
            isDarkMode={isDarkMode} 
            currencySymbol={currencySymbol} 
            onInfoClick={onMarketSessionsInfoClick}
          />
        </div>

        {/* Day of Week Heatmap */}
        <div className="md:col-span-12 lg:col-span-4 h-full">
          <DailyActivityHeatmap 
            trades={trades} 
            isDarkMode={isDarkMode} 
            currencySymbol={currencySymbol} 
            onInfoClick={onDailyActivityInfoClick}
          />
        </div>

        {/* Hourly Breakdown - Bottom Span */}
        <div className="md:col-span-12 h-full">
          <HourlyPerformanceWidget 
            trades={trades} 
            isDarkMode={isDarkMode} 
            currencySymbol={currencySymbol} 
            onInfoClick={onHourlyPerformanceInfoClick}
          />
        </div>

      </div>
    </div>
  );
};
