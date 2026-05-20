-- Drop the old global sync state table
DROP TABLE IF EXISTS public.firehose_sync_state;

-- Create a new user-specific sync state table
CREATE TABLE public.firehose_sync_state (
    user_id UUID REFERENCES public.profiles(id) PRIMARY KEY,
    last_sync_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.firehose_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own sync state" ON public.firehose_sync_state
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
