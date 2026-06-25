-- Migration: Add RLS policy for ea_sessions to allow users to read their own session data
-- This fixes the Broker Connect balance display (frontend was blocked by RLS)

-- 1. Ensure RLS is enabled on ea_sessions
ALTER TABLE public.ea_sessions ENABLE ROW LEVEL SECURITY;

-- 2. Add policy for users to SELECT their own session
-- Users are identified by matching their profile's sync_key to the session's sync_key
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'ea_sessions' AND policyname = 'Users can read their own session'
    ) THEN
        CREATE POLICY "Users can read their own session" ON public.ea_sessions
            FOR SELECT USING (
                auth.uid() IN (
                    SELECT id FROM public.profiles 
                    WHERE sync_key = ea_sessions.sync_key
                )
            );
    END IF;
END
$$;

-- 3. Add index on profiles.sync_key for faster lookups
CREATE INDEX IF NOT EXISTS idx_profiles_sync_key ON public.profiles(sync_key);
