import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const ALLOWED_ORIGINS = new Set([
    'https://jfxjournal.site',
    'https://www.jfxjournal.site',
    'http://localhost:5173',
    'http://localhost:3000',
])

// Origin-aware CORS: the wildcard is replaced so only the app's own origins
// can read responses cross-origin. The EA bridge posts without an Origin
// header, which CORS does not apply to.
function corsHeaders(req: Request): Record<string, string> {
    const origin = req.headers.get('origin') || req.headers.get('Origin') || ''
    const headers: Record<string, string> = {
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, sync-key, Sync-Key',
    }
    if (ALLOWED_ORIGINS.has(origin)) {
        headers['Access-Control-Allow-Origin'] = origin
    }
    return headers
}

const toFiniteNumber = (value: unknown, fallback = 0) => {
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) ? n : fallback
}

const getSessionFromTime = (time: string): string => {
    const [hours] = time.split(':').map(Number)
    if (!Number.isFinite(hours)) return 'London Session'
    if (hours >= 15 && hours < 18) return 'London/NY Overlap'
    if (hours >= 9 && hours < 15) return 'London Session'
    if (hours >= 18) return 'New York Session'
    if (hours >= 0 && hours < 9) return 'Asian Session'
    return 'London Session'
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders(req) })
    }

    try {
        const body = await req.json().catch(() => ({}));

        // Extract the sync key (the caller's bridge identifier).
        const syncKey = req.headers.get('sync-key') ||
            req.headers.get('Sync-Key') ||
            body.sync_key ||
            body.SyncKey;

        if (!syncKey) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Missing sync key',
                details: 'No sync-key found in headers or body'
            }), {
                headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
                status: 400,
            })
        }

        // ── Security: require an authenticated user JWT ────────────────────────
        // The sync key is a client-known secret and must NEVER authorize
        // service-role writes on its own. Only a verified Supabase user whose
        // profile sync_key matches may write here.
        const authHeader = req.headers.get('Authorization') || '';
        const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
        if (!jwt) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Unauthorized',
                details: 'Missing user session (Authorization header required)'
            }), {
                headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
                status: 401,
            })
        }

        const userClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            {
                global: { headers: { Authorization: `Bearer ${jwt}` } },
                auth: { persistSession: false, autoRefreshToken: false },
            }
        );

        const { data: userData, error: userError } = await userClient.auth.getUser();
        if (userError || !userData?.user) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Invalid or expired session',
                details: userError?.message || 'Could not verify the user session'
            }), {
                headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
                status: 401,
            })
        }

        // Verify the sync key belongs to the authenticated user's profile.
        const { data: profile, error: profileError } = await userClient
            .from('profiles')
            .select('id, name, auto_journal, ea_connected, sync_key')
            .eq('id', userData.user.id)
            .maybeSingle();

        if (profileError || !profile) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Profile not found',
                details: profileError?.message || 'No profile exists for this user'
            }), {
                headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
                status: 401,
            })
        }

        if (profile.sync_key !== syncKey) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Invalid sync key',
                details: 'The provided sync key does not match the authenticated user'
            }), {
                headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
                status: 401,
            })
        }

        // ── Internal writes ────────────────────────────────────────────────────
        // Only reached after the user is verified above; scoped to profile.id.
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        const { trades, account, openPositions, isHeartbeat, isReconciliation } = body;

        // Check if the user has disconnected the bridge via the UI
        if (profile.ea_connected === false) {
            return new Response(JSON.stringify({
                success: false,
                command: 'STOP',
                error: 'Session terminated by user',
                details: 'The bridge connection was disabled in the dashboard.'
            }), {
                headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
                status: 403, // Forbidden
            })
        }

        // 3. Persist session data (Always for heartbeats/regular sync, optional for reconciliation)
        if (!isReconciliation) {
            const sessionData = {
                trades: trades || [],
                account: account || null,
                openPositions: openPositions || [],
                lastHeartbeat: new Date().toISOString(),
                isHeartbeat: !!isHeartbeat,
                userName: profile.name
            };

            const { error: upsertError } = await supabaseClient
                .from('ea_sessions')
                .upsert({
                    sync_key: syncKey,
                    data: sessionData,
                    last_updated: new Date().toISOString()
                }, { onConflict: 'sync_key' });

            if (upsertError) {
                console.error('Error upserting session:', upsertError);
            }
        }

        // 4. Sync Trades History to 'trades' table
        // We sync if auto_journal is ON OR if it's a manual reconciliation request
        if ((profile.auto_journal || isReconciliation) && trades && trades.length > 0) {
            // Get ALL existing trade ticket IDs for this user to avoid duplicates
            // For large history, we fetch them in a single query
            const { data: existingTradesData } = await supabaseClient
                .from('trades')
                .select('ticket_id')
                .eq('user_id', profile.id)
                .not('ticket_id', 'is', null);

            const existingTickets = new Set(existingTradesData?.map((t: any) => String(t.ticket_id)));
            const newTrades = [];

            for (const trade of trades) {
                // Skip if we already processed this ticket
                if (existingTickets.has(String(trade.ticket))) continue;

                // Map MT5 trade to DB schema
                // Calculate Net PnL (Profit + Swap + Commission)
                const netPnL = Number((trade.profit + (trade.swap || 0) + (trade.commission || 0)).toFixed(2));

                // Determine Status/Tags based on whether it's reconciliation
                const tags = ['MT5_Auto_Journal'];
                if (isReconciliation) {
                    tags.push('Reconciled');
                }

                const closeDate = new Date((trade.time || Date.now() / 1000) * 1000)
                const openDate = new Date((trade.entry_time || trade.time || Date.now() / 1000) * 1000)
                const closeDateIso = Number.isNaN(closeDate.getTime()) ? new Date().toISOString() : closeDate.toISOString()
                const openDateIso = Number.isNaN(openDate.getTime()) ? closeDateIso : openDate.toISOString()
                const closeTime = closeDateIso.split('T')[1]?.slice(0, 8) || '00:00:00'

                const dbTrade = {
                    user_id: profile.id,
                    ticket_id: String(trade.ticket),
                    pair: trade.symbol,
                    asset_type: 'Forex',
                    date: closeDateIso.split('T')[0],
                    time: closeTime,
                    open_time: openDateIso,
                    close_time: closeDateIso,
                    session: getSessionFromTime(closeTime),
                    direction: trade.type === 'BUY' ? 'Long' : 'Short',
                    entry_price: toFiniteNumber(trade.entry_price, toFiniteNumber(trade.price, 0)),
                    exit_price: toFiniteNumber(trade.price, 0),
                    stop_loss: toFiniteNumber(trade.sl, 0),
                    take_profit: toFiniteNumber(trade.tp, 0),
                    lots: toFiniteNumber(trade.volume, 0),
                    result: netPnL > 0 ? 'Win' : netPnL < 0 ? 'Loss' : 'BE',
                    pnl: netPnL,
                    commissions: toFiniteNumber(trade.commission, 0),
                    swap: toFiniteNumber(trade.swap, 0),
                    rr: 0,
                    rating: 0,
                    tags: tags,
                    notes: `Auto-journaled from MT5. Deal #${trade.ticket} | Order #${trade.order}${isReconciliation ? ' | Found during reconciliation.' : ''}`,
                    plan_adherence: 'No Plan',
                    trading_mistake: 'None',
                    mindset: 'Neutral',
                };

                // Only insert if it's an exit deal (entry = 1 or 2)
                if (trade.entry === 1 || trade.entry === 2) {
                    newTrades.push(dbTrade);
                }
            }

            if (newTrades.length > 0) {
                // Batch insert new trades
                const { error: insertError } = await supabaseClient
                    .from('trades')
                    .insert(newTrades);

                if (insertError) {
                    console.error('Error syncing history:', insertError);
                } else {
                    console.log(`Synced ${newTrades.length} new trades for user ${profile.id}.`);
                }
            }
        }

        return new Response(JSON.stringify({
            success: true,
            message: isReconciliation ? 'Reconciliation complete' : (isHeartbeat ? 'Heartbeat received' : 'Data synced successfully'),
            user: profile.name,
            synced_count: trades?.length || 0
        }), {
            headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
            status: 200,
        })

    } catch (error) {
        console.error('Global error:', error);
        return new Response(JSON.stringify({
            success: false,
            error: 'Internal server error',
            details: error.message
        }), {
            headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
            status: 500,
        })
    }
})
