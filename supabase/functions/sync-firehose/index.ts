import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const ALLOWED_ORIGINS = new Set([
  'https://jfxjournal.site',
  'https://www.jfxjournal.site',
  'http://localhost:5173',
  'http://localhost:3000',
])

// Origin-aware CORS: the wildcard is replaced so only the app's own origins
// can read responses cross-origin.
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || req.headers.get('Origin') || ''
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
  if (ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

// In-memory cooldown per caller so a single account cannot hammer the paid
// Firehose API by invoking this function directly (the client already throttles
// itself to one sync per 60s; this enforces the same bound server-side).
const lastTriggerAt = new Map<string, number>()
const MIN_TRIGGER_INTERVAL_MS = 60_000

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) })
  }

  if (req.method === 'GET') {
    return new Response(JSON.stringify({ status: 'ok' }), {
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
      status: 200,
    })
  }

  try {
    const firehoseApiKey = Deno.env.get('FIREHOSE_API_KEY')
    if (!firehoseApiKey) {
      throw new Error('FIREHOSE_API_KEY not configured')
    }

    const authHeader = req.headers.get('Authorization') || ''
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!bearer) {
      return new Response(JSON.stringify({ success: false, error: 'Missing Authorization header' }), {
        headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
        status: 401,
      })
    }

    // Two authorized trigger paths:
    //   1. Server-to-server (cron): Authorization is the CRON_SECRET.
    //   2. Client: Authorization is the caller's Supabase JWT (verified below).
    const cronSecret = Deno.env.get('CRON_SECRET')
    let callerId: string
    let useServiceRole = false
    if (cronSecret && bearer === cronSecret) {
      callerId = 'cron'
      useServiceRole = true
    } else {
      const verifier = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        {
          global: { headers: { Authorization: authHeader } },
          auth: { persistSession: false, autoRefreshToken: false },
        }
      )
      const { data: session, error: sessionError } = await verifier.auth.getUser()
      if (sessionError || !session?.user) {
        return new Response(JSON.stringify({ success: false, error: 'Invalid or expired session' }), {
          headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
          status: 401,
        })
      }
      callerId = session.user.id
    }

    // Enforce one Firehose poll per caller per minute.
    const now = Date.now()
    const last = lastTriggerAt.get(callerId) || 0
    if (now - last < MIN_TRIGGER_INTERVAL_MS) {
      return new Response(JSON.stringify({ success: false, error: 'Rate limit exceeded. Try again in a minute.' }), {
        headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
        status: 429,
      })
    }
    lastTriggerAt.set(callerId, now)

    // Reads: cron uses the service role (all users); client triggers stay
    // scoped to the caller via their own JWT + RLS.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      useServiceRole
        ? (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '')
        : (Deno.env.get('SUPABASE_ANON_KEY') ?? ''),
      useServiceRole
        ? { auth: { persistSession: false, autoRefreshToken: false } }
        : { global: { headers: { Authorization: authHeader } } }
    )

    const { data: rules, error: rulesError } = await supabase
      .from('firehose_rules')
      .select('id, user_id, lucene_query, last_event_at')
      .eq('active', true)

    if (rulesError) {
      console.error('Error fetching rules:', rulesError)
      return new Response(JSON.stringify({ success: false, error: rulesError.message }), {
        headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
        status: 500,
      })
    }

    if (!rules || rules.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No active rules', rulesChecked: 0 }), {
        headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    let totalEventsStored = 0

    for (const rule of rules) {
      try {
        const events = await pollFirehose(firehoseApiKey, rule.lucene_query)
        if (events.length === 0) continue

        const existingResult = await supabase
          .from('firehose_events')
          .select('url')
          .eq('user_id', rule.user_id)
          .in('url', events.map(e => e.url))

        const existingUrls = new Set((existingResult.data || []).map(e => e.url))
        const newEvents = events
          .filter(e => !existingUrls.has(e.url))
          .map(e => ({
            user_id: rule.user_id,
            rule_id: rule.id,
            title: e.title,
            url: e.url,
            source: e.source || null,
            summary: e.summary || null,
            published_at: e.publishedAt || null,
          }))

        if (newEvents.length === 0) continue

        const { error: insertError } = await supabase
          .from('firehose_events')
          .insert(newEvents)

        if (insertError) {
          console.error(`Error inserting events for rule ${rule.id}:`, insertError)
          continue
        }

        await supabase
          .from('firehose_rules')
          .update({ last_event_at: new Date().toISOString() })
          .eq('id', rule.id)

        totalEventsStored += newEvents.length
        console.log(`Stored ${newEvents.length} events for rule ${rule.id}`)
      } catch (ruleError) {
        console.error(`Error polling rule ${rule.id}:`, ruleError)
      }
    }

    return new Response(JSON.stringify({
      success: true,
      rulesChecked: rules.length,
      eventsStored: totalEventsStored,
    }), {
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    console.error('Global error:', error)
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})

interface FirehoseRawEvent {
  title: string
  url: string
  source?: string
  summary?: string
  publishedAt?: string
}

async function pollFirehose(apiKey: string, luceneQuery: string): Promise<FirehoseRawEvent[]> {
  const url = new URL('https://api.firehose.com/v1/stream')
  url.searchParams.set('rules', luceneQuery)
  url.searchParams.set('limit', '20')
  url.searchParams.set('format', 'events')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'text/event-stream',
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      console.error(`Firehose API error: ${response.status} ${response.statusText}`)
      return []
    }

    const text = await response.text()
    const events = parseSSE(text)
    return events
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.error('Firehose poll timed out')
      return []
    }
    console.error('Firehose fetch error:', error)
    return []
  } finally {
    clearTimeout(timeout)
  }
}

function parseSSE(text: string): FirehoseRawEvent[] {
  const events: FirehoseRawEvent[] = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const data = line.slice(6).trim()
    if (!data) continue
    try {
      const parsed = JSON.parse(data)
      if (parsed.title && parsed.url) {
        events.push({
          title: parsed.title,
          url: parsed.url,
          source: parsed.source || parsed.domain,
          summary: parsed.summary || parsed.description,
          publishedAt: parsed.publish_time || parsed.published_at,
        })
      }
    } catch { /* skip malformed data lines */ }
  }
  return events
}
