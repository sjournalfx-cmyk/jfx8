import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const TOKEN_PATTERN = /^jfx_pat_[a-z0-9]{8}_[A-Za-z0-9]{32}$/
const APP_ORIGINS = new Set(['https://jfxjournal.site', 'https://www.jfxjournal.site', 'http://localhost:5173'])

type ApiKey = { id: string; user_id: string; scopes: string[]; expires_at: string | null }

const json = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
})

const cors = (req: Request) => {
  const origin = req.headers.get('origin') ?? ''
  if (APP_ORIGINS.has(origin)) {
    return { 'access-control-allow-origin': origin, 'vary': 'Origin', 'access-control-allow-headers': 'content-type, x-api-key', 'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS' }
  }
  // API-key routes are server-to-server (no Origin) or from arbitrary agent UIs.
  // Allow * for API consumers while keeping tight checks for browser cookie flows.
  const hasApiKey = Boolean(req.headers.get('x-api-key')?.trim())
  if (!origin || hasApiKey) {
    return { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, x-api-key, authorization', 'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS' }
  }
  return {}
}

const fingerprint = async (token: string) => {
  const bytes = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

const page = (url: URL) => {
  const requestedPage = Number(url.searchParams.get('page') ?? 1)
  const requestedLimit = Number(url.searchParams.get('limit') ?? 20)
  return { page: Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1), limit: Math.min(100, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 20)) }
}

const cleanBody = (body: Record<string, unknown>) => {
  const { id: _id, user_id: _userId, created_at: _created, updated_at: _updated, deleted_at: _deleted, ...safe } = body
  return safe
}

const isUuid = (value: string | undefined) => Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))

Deno.serve(async (req) => {
  const started = performance.now()
  const responseHeaders = cors(req)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: responseHeaders })
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: 'server_not_configured' }, 500, responseHeaders)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const rawToken = req.headers.get('x-api-key')?.trim() ?? ''
  const url = new URL(req.url)
  const routeIndex = url.pathname.indexOf('/v1/')
  const path = routeIndex >= 0 ? url.pathname.slice(routeIndex) : ''
  let key: ApiKey | null = null

  const audit = async (status: number) => {
    if (!key) return
    await admin.from('api_key_audit').insert({
      key_id: key.id, user_id: key.user_id, method: req.method, path,
      status, duration_ms: Math.round(performance.now() - started),
      user_agent: req.headers.get('user-agent'),
    })
  }
  const respond = async (body: unknown, status = 200, extra: HeadersInit = {}) => {
    await audit(status)
    return json(body, status, { ...responseHeaders, ...extra })
  }

  if (!TOKEN_PATTERN.test(rawToken)) return json({ error: 'malformed_token' }, 401, responseHeaders)
  const keyHash = await fingerprint(rawToken)
  const { data: foundKey } = await admin.from('api_keys').select('id,user_id,scopes,expires_at').eq('key_hash', keyHash).maybeSingle()
  key = foundKey as ApiKey | null
  if (!key) return json({ error: 'invalid_token' }, 401, responseHeaders)
  if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) return respond({ error: 'expired_token' }, 401)

  const { data: allowed, error: rateError } = await admin.rpc('consume_api_key_rate_limit', { p_user_id: key.user_id, p_key_id: key.id })
  if (rateError || !allowed) return respond({ error: 'rate_limited' }, 429, { 'retry-after': '60' })

  const hasScope = (need: string) => {
    const scopes = key!.scopes || []
    if (scopes.includes(need)) return true
    // Imply read from write for ergonomic keys (trades:write => trades:read, notes:write => notes:read)
    if (need === 'trades:read' && scopes.includes('trades:write')) return true
    if (need === 'notes:read' && scopes.includes('notes:write')) return true
    return false
  }
  const requireScope = async (scope: string) => hasScope(scope)
    ? null
    : respond({ error: 'insufficient_scope', need: scope, have: key!.scopes }, 403)
  const touch = () => admin.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', key!.id)

  try {
    if (path === '/v1/me' && req.method === 'GET') {
      const denied = await requireScope('me:read'); if (denied) return denied
      const { data, error } = await admin.from('profiles').select('id,name,plan,created_at').eq('id', key.user_id).maybeSingle()
      if (error) throw error
      void touch()
      return respond(data ?? { id: key.user_id })
    }
    if (path === '/v1/me/keys' && req.method === 'GET') {
      const denied = await requireScope('me:read'); if (denied) return denied
      const { data, error } = await admin.from('api_keys').select('id,name,key_prefix,scopes,last_used_at,expires_at,created_at').eq('user_id', key.user_id).order('created_at', { ascending: false })
      if (error) throw error
      void touch()
      return respond({ data })
    }

    const tradeMatch = path.match(/^\/v1\/trades(?:\/([^/]+))?$/)
    if (tradeMatch) {
      const id = tradeMatch[1]
      const isWrite = req.method !== 'GET'
      const denied = await requireScope(isWrite ? 'trades:write' : 'trades:read'); if (denied) return denied
      if (id && !isUuid(id)) return respond({ error: 'not_found' }, 404)
      if (req.method === 'GET') {
        if (id) {
          const { data, error } = await admin.from('trades').select('*').eq('id', id).eq('user_id', key.user_id).is('deleted_at', null).maybeSingle()
          if (error) throw error
          if (!data) return respond({ error: 'not_found' }, 404)
          void touch(); return respond(data)
        }
        const { page: pageNumber, limit } = page(url)
        let query = admin.from('trades').select('*', { count: 'exact' }).eq('user_id', key.user_id).is('deleted_at', null).order('date', { ascending: false }).range((pageNumber - 1) * limit, pageNumber * limit - 1)
        const from = url.searchParams.get('from'); const to = url.searchParams.get('to'); const pair = url.searchParams.get('pair')
        if (from) query = query.gte('date', from); if (to) query = query.lte('date', to); if (pair) query = query.eq('pair', pair)
        const { data, count, error } = await query; if (error) throw error
        void touch(); return respond({ data, page: pageNumber, limit, total: count ?? 0 })
      }
      const body = cleanBody(await req.json().catch(() => ({})))
      if (req.method === 'POST') {
        const { data, error } = await admin.from('trades').insert({ ...body, user_id: key.user_id }).select('*').single(); if (error) throw error
        void touch(); return respond(data, 201)
      }
      if (req.method === 'PATCH' && id) {
        const { data, error } = await admin.from('trades').update(body).eq('id', id).eq('user_id', key.user_id).select('*').maybeSingle(); if (error) throw error
        if (!data) return respond({ error: 'not_found' }, 404); void touch(); return respond(data)
      }
      if (req.method === 'DELETE' && id) {
        const { data, error } = await admin.from('trades').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('user_id', key.user_id).select('id').maybeSingle(); if (error) throw error
        if (!data) return respond({ error: 'not_found' }, 404); void touch(); return respond({ deleted: true })
      }
    }

    const noteMatch = path.match(/^\/v1\/notes(?:\/([^/]+))?$/)
    if (noteMatch) {
      const id = noteMatch[1]; const isWrite = req.method !== 'GET'
      const denied = await requireScope(isWrite ? 'notes:write' : 'notes:read'); if (denied) return denied
      if (id && !isUuid(id)) return respond({ error: 'not_found' }, 404)
      if (req.method === 'GET') {
        if (id) {
          const { data, error } = await admin.from('notes').select('*').eq('id', id).eq('user_id', key.user_id).maybeSingle(); if (error) throw error
          if (!data) return respond({ error: 'not_found' }, 404); void touch(); return respond(data)
        }
        const { page: pageNumber, limit } = page(url)
        const { data, count, error } = await admin.from('notes').select('*', { count: 'exact' }).eq('user_id', key.user_id).order('updated_at', { ascending: false }).range((pageNumber - 1) * limit, pageNumber * limit - 1)
        if (error) throw error; void touch(); return respond({ data, page: pageNumber, limit, total: count ?? 0 })
      }
      const body = cleanBody(await req.json().catch(() => ({})))
      if (req.method === 'POST') {
        const { data, error } = await admin.from('notes').insert({ ...body, user_id: key.user_id }).select('*').single(); if (error) throw error
        void touch(); return respond(data, 201)
      }
      if (req.method === 'PATCH' && id) {
        const { data, error } = await admin.from('notes').update(body).eq('id', id).eq('user_id', key.user_id).select('*').maybeSingle(); if (error) throw error
        if (!data) return respond({ error: 'not_found' }, 404); void touch(); return respond(data)
      }
      if (req.method === 'DELETE' && id) {
        const { data, error } = await admin.from('notes').delete().eq('id', id).eq('user_id', key.user_id).select('id').maybeSingle(); if (error) throw error
        if (!data) return respond({ error: 'not_found' }, 404); void touch(); return respond({ deleted: true })
      }
    }

    if (path === '/v1/analytics/summary' && req.method === 'GET') {
      const denied = await requireScope('trades:read'); if (denied) return denied
      let query = admin.from('trades').select('pnl,result').eq('user_id', key.user_id).is('deleted_at', null)
      const from = url.searchParams.get('from'); const to = url.searchParams.get('to'); if (from) query = query.gte('date', from); if (to) query = query.lte('date', to)
      const { data, error } = await query; if (error) throw error
      const trades = data ?? []; const wins = trades.filter(t => Number(t.pnl) > 0); const losses = trades.filter(t => Number(t.pnl) < 0)
      const grossProfit = wins.reduce((sum, trade) => sum + Number(trade.pnl ?? 0), 0); const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + Number(trade.pnl ?? 0), 0))
      void touch(); return respond({ total_trades: trades.length, win_rate: trades.length ? wins.length / trades.length : 0, pnl: grossProfit - grossLoss, profit_factor: grossLoss ? grossProfit / grossLoss : null })
    }

    if (path === '/v1/analytics/equity' && req.method === 'GET') {
      const denied = await requireScope('trades:read'); if (denied) return denied
      const { data, error } = await admin.from('trades').select('id,date,close_time,pnl').eq('user_id', key.user_id).is('deleted_at', null).order('date', { ascending: true }); if (error) throw error
      let equity = 0; const points = (data ?? []).map(trade => ({ id: trade.id, date: trade.close_time ?? trade.date, pnl: Number(trade.pnl ?? 0), equity: equity += Number(trade.pnl ?? 0) }))
      void touch(); return respond({ data: points })
    }

    if (path === '/v1/bridge/status' && req.method === 'GET') {
      const denied = await requireScope('bridge:read'); if (denied) return denied
      const { data, error } = await admin.from('user_sync_state').select('*').eq('user_id', key.user_id).maybeSingle(); if (error) throw error
      void touch(); return respond(data ?? { phase: 'disconnected' })
    }
    if (path === '/v1/positions' && req.method === 'GET') {
      // MT5 bridge positions: allow bridge:read primary, but also accept trades:read/write for convenience
      // (agents often granted trading scopes and expect positions to work)
      if (!hasScope('bridge:read') && !hasScope('trades:read')) {
        return respond({ error: 'insufficient_scope', need: 'bridge:read', have: key!.scopes, hint: 'bridge:read or trades:read required' }, 403)
      }
      const { data, error } = await admin.from('mt_trades').select('*').eq('user_id', key.user_id).eq('is_open', true).order('open_time', { ascending: false }); if (error) throw error
      void touch(); return respond({ data })
    }
    return respond({ error: 'not_found' }, 404)
  } catch (error) {
    console.error('jfx-api request failed', error instanceof Error ? error.message : 'unknown error')
    return respond({ error: 'internal_error' }, 500)
  }
})
