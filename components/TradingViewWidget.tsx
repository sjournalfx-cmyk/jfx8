import React, { useEffect, useRef, memo, useCallback, useState } from 'react';
import { AlertCircle, RefreshCcw } from 'lucide-react';
import { getDefaultTimezone } from '../lib/timeUtils';

interface TradingViewWidgetProps {
  symbol?: string;
  theme?: 'light' | 'dark';
  interval?: string;
  autosize?: boolean;
  /** Unique identifier for this chart instance to maintain stable DOM */
  chartId?: string;
  showLegend?: boolean;
  showGrid?: boolean;
  showToolbar?: boolean;
}

function TradingViewWidget({
  symbol = "IG:NASDAQ",
  theme = "dark",
  interval = "240",
  autosize = true,
  chartId = "default",
  showLegend = true,
  showGrid = false,
  showToolbar = true
}: TradingViewWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isInitializedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const currentConfigRef = useRef({ symbol: '', interval: '', theme: '', showToolbar: true, showLegend: true, showGrid: false });

  const initializeWidget = useCallback(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;

    // Only re-initialize if relevant props changed
    const needsReinit =
      !isInitializedRef.current ||
      currentConfigRef.current.symbol !== symbol ||
      currentConfigRef.current.interval !== interval ||
      currentConfigRef.current.theme !== theme ||
      currentConfigRef.current.showToolbar !== showToolbar ||
      currentConfigRef.current.showLegend !== showLegend ||
      currentConfigRef.current.showGrid !== showGrid;

    if (!needsReinit && !error) return;

    container.innerHTML = '';
    setError(null);

    const widgetId = `tradingview_${chartId.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const widgetDiv = document.createElement('div');
    widgetDiv.id = widgetId;
    widgetDiv.style.height = "100%";
    widgetDiv.style.width = "100%";
    container.appendChild(widgetDiv);

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/tv.js";
    script.type = "text/javascript";
    script.async = true;
    
    script.onerror = () => {
      setError("Failed to load TradingView chart. Please check your connection.");
      isInitializedRef.current = false;
    };

    script.onload = () => {
      if ((window as any).TradingView) {
        try {
          new (window as any).TradingView.widget({
            "autosize": autosize,
            "symbol": symbol,
            "interval": interval,
            "timezone": getDefaultTimezone(),
            "theme": theme,
            "style": "1",
            "locale": "en",
            "toolbar_bg": theme === 'dark' ? "#000000" : "#f1f3f6",
            "enable_publishing": false,
            "hide_side_toolbar": !showToolbar,
            "hide_volume": true,
            "disabled_features": [
              "create_volume_indicator_by_default",
              ...(!showGrid ? ["pane_context_menu"] : []),
            ],
            "enabled_features": [
              "side_toolbar_as_default_active",
              "drawing_templates",
              "header_settings",
              "header_indicators",
              "header_compare",
              "header_undo_redo"
            ],
            "allow_symbol_change": true,
            "container_id": widgetId,
            "save_image": true,
            "hide_legend": !showLegend,
            "withdateranges": true,
            "show_popup_button": true,
            "popup_height": "650",
            "popup_width": "1000",
            "studies_overrides": {},
            "overrides": {
              "paneProperties.backgroundType": "solid",
              "paneProperties.background": theme === 'dark' ? "#000000" : "#ffffff",
              "paneProperties.backgroundColor": theme === 'dark' ? "#000000" : "#ffffff",
              // Grid lines: set to exact background color to visually remove them
              "paneProperties.vertGridProperties.color": showGrid
                ? (theme === 'dark' ? "#1e2130" : "#e8ecf0")
                : (theme === 'dark' ? "#000000" : "#ffffff"),
              "paneProperties.vertGridProperties.style": 0,
              "paneProperties.horzGridProperties.color": showGrid
                ? (theme === 'dark' ? "#1e2130" : "#e8ecf0")
                : (theme === 'dark' ? "#000000" : "#ffffff"),
              "paneProperties.horzGridProperties.style": 0,
              "scalesProperties.backgroundColor": theme === 'dark' ? "#000000" : "#ffffff",
              "paneProperties.legendProperties.showLegend": showLegend
            }
          });
          setError(null);
        } catch (e) {
          console.error("TradingView Initialization Error:", e);
          setError("Error initializing chart. Retrying...");
          isInitializedRef.current = false;
        }
      } else {
        setError("TradingView library not found.");
        isInitializedRef.current = false;
      }
    };
    container.appendChild(script);

    currentConfigRef.current = { symbol, interval, theme, showToolbar, showLegend, showGrid };
    isInitializedRef.current = true;
  }, [symbol, interval, theme, autosize, chartId, showToolbar, showLegend, showGrid, error]);

  useEffect(() => {
    initializeWidget();
  }, [initializeWidget]);

  return (
    <div className="relative w-full h-full">
      <div
        className="tradingview-widget-container"
        ref={containerRef}
        style={{ height: "100%", width: "100%" }}
      />
      {error && (
        <div className={`absolute inset-0 flex flex-col items-center justify-center p-6 text-center backdrop-blur-sm z-10 ${
          theme === 'dark' ? 'bg-black/60' : 'bg-white/60'
        }`}>
          <AlertCircle className="w-10 h-10 text-rose-500 mb-4" />
          <p className={`text-sm font-bold uppercase tracking-tight mb-4 ${
            theme === 'dark' ? 'text-zinc-300' : 'text-slate-600'
          }`}>
            {error}
          </p>
          <button 
            onClick={() => {
              isInitializedRef.current = false;
              initializeWidget();
            }}
            className="flex items-center gap-2 px-4 py-2 bg-[#FF4F00] hover:bg-[#E64600] text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-[#FF4F00]/20 active:scale-95"
          >
            <RefreshCcw size={14} />
            Retry Chart Load
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(TradingViewWidget, (prevProps, nextProps) => {
  return (
    prevProps.symbol === nextProps.symbol &&
    prevProps.interval === nextProps.interval &&
    prevProps.theme === nextProps.theme &&
    prevProps.showToolbar === nextProps.showToolbar &&
    prevProps.showLegend === nextProps.showLegend &&
    prevProps.showGrid === nextProps.showGrid &&
    prevProps.chartId === nextProps.chartId
  );
});
