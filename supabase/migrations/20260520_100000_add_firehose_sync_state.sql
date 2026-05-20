-- Add table to track global Firehose sync state
CREATE TABLE IF NOT EXISTS public.firehose_sync_state (
    id INT PRIMARY KEY CHECK (id = 1),
    last_sync_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Initialize with a default row if it doesn't exist
INSERT INTO public.firehose_sync_state (id, last_sync_at) 
VALUES (1, '2000-01-01T00:00:00Z') 
ON CONFLICT DO NOTHING;

ALTER TABLE public.firehose_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can select sync state" ON public.firehose_sync_state
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can update sync state" ON public.firehose_sync_state
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Also allow insert just in case upsert tries to insert
CREATE POLICY "Authenticated users can insert sync state" ON public.firehose_sync_state
    FOR INSERT TO authenticated WITH CHECK (true);
