-- Add Firehose market monitoring tables
-- Allows users to define web monitoring rules and receive real-time events

CREATE TABLE IF NOT EXISTS public.firehose_rules (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) NOT NULL,
    name TEXT NOT NULL,
    lucene_query TEXT NOT NULL,
    active BOOLEAN DEFAULT true NOT NULL,
    created_by TEXT NOT NULL CHECK (created_by IN ('ai', 'manual')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    last_event_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.firehose_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own rules" ON public.firehose_rules
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own rules" ON public.firehose_rules
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own rules" ON public.firehose_rules
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own rules" ON public.firehose_rules
    FOR DELETE
    USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.firehose_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) NOT NULL,
    rule_id UUID REFERENCES public.firehose_rules(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    source TEXT,
    summary TEXT,
    published_at TIMESTAMP WITH TIME ZONE,
    seen BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.firehose_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own events" ON public.firehose_events
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own events" ON public.firehose_events
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own events" ON public.firehose_events
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own events" ON public.firehose_events
    FOR DELETE
    USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_firehose_events_user_id ON public.firehose_events (user_id);
CREATE INDEX IF NOT EXISTS idx_firehose_events_rule_id ON public.firehose_events (rule_id);
CREATE INDEX IF NOT EXISTS idx_firehose_events_seen ON public.firehose_events (user_id, seen);
CREATE INDEX IF NOT EXISTS idx_firehose_rules_user_id ON public.firehose_rules (user_id);
