-- Migration: Add chart_candles and chart_timeframe columns to trades table
-- Allows persisting fetched cTrader candlestick data directly to Supabase cloud.

ALTER TABLE public.trades 
ADD COLUMN IF NOT EXISTS chart_candles JSONB DEFAULT NULL,
ADD COLUMN IF NOT EXISTS chart_timeframe TEXT DEFAULT NULL;
