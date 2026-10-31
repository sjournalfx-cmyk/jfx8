import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const TOKEN_PATTERN = /^jfx_pat_[a-z0-9]{8}_[A-Za-z0-9]{32}$/
const APP_ORIGINS = new Set(['https://jfxjournal.site', 'https://www.jfxjournal.site', 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', 'http://127.0.0.1:3000'])

type ApiKey = { id: string; user_id: string; scopes: string[]; expires_at: string | null }

const json = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
})

const stripScheme = (v: string) => v.trim().replace(/^(Bearer|Token|ApiKey|APIKey)\s+/i, '').trim()

const extractRawKey = (req: Request) => {
  const fromHeader = req.headers.get('x-api-key')?.trim() ?? ''
  if (fromHeader) return stripScheme(fromHeader)
  // Accept Authorization: Bearer jfx_pat_... (harnesses vary; previously CORS-blocked)
  const auth = req.headers.get('authorization')?.trim() ?? ''
  if (auth) return stripScheme(auth)
  const legacy = req.headers.get('x-access-token')?.trim() ?? ''
  return stripScheme(legacy)
}

const CORS_ALLOW_HEADERS = 'content-type, x-api-key, authorization'
const CORS_ALLOW_METHODS = 'GET, POST, PATCH, DELETE, OPTIONS'

const cors = (req: Request) => {
  const origin = req.headers.get('origin') ?? ''
  if (APP_ORIGINS.has(origin)) {
    return { 'access-control-allow-origin': origin, 'vary': 'Origin', 'access-control-allow-headers': CORS_ALLOW_HEADERS, 'access-control-allow-methods': CORS_ALLOW_METHODS, 'access-control-max-age': '86400' }
  }
  // API-key routes are server-to-server (no Origin) or from arbitrary agent UIs.
  // Allow * for API consumers while keeping tight checks for browser cookie flows.
  // NB: check Authorization too — previously only X-API-Key got `*`, so browser
  // harnesses using `Authorization: Bearer jfx_pat_...` were CORS-blocked and
  // looked like "auth failed".
  const hasApiKey = Boolean(extractRawKey(req))
  if (!origin || hasApiKey) {
    return { 'access-control-allow-origin': '*', 'access-control-allow-headers': CORS_ALLOW_HEADERS, 'access-control-allow-methods': CORS_ALLOW_METHODS, 'access-control-max-age': '86400' }
  }
  // Preflight (OPTIONS) never carries the API key itself — it only advertises it
  // via Access-Control-Request-Headers. Without this, browsers block the real
  // request and fetch() throws "Failed to fetch" (what the in-app Test button saw).
  if (req.method === 'OPTIONS') {
    const requested = (req.headers.get('access-control-request-headers') ?? '').toLowerCase()
    if (requested.includes('x-api-key') || requested.includes('authorization')) {
      return { 'access-control-allow-origin': '*', 'access-control-allow-headers': CORS_ALLOW_HEADERS, 'access-control-allow-methods': CORS_ALLOW_METHODS, 'access-control-max-age': '86400' }
    }
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

// Postgres numerics arrive as JS floats with spilled precision artifacts
// (e.g. entry_price 0.000011158099999999999). Trim to 8 decimals — FX prices
// carry at most ~6 significant decimals (JPY 3, metals 2), so nothing
// meaningful is lost; 16-digit float noise disappears.
const roundFixed = (v: unknown) => {
  const n = Number(v)
  if (!Number.isFinite(n) || Number.isInteger(n as number)) return v
  return Number(n.toFixed(8))
}
const normalizeTrade = (t: any) => {
  if (!t || typeof t !== 'object') return t
  return {
    ...t,
    entry_price: roundFixed(t.entry_price),
    exit_price: roundFixed(t.exit_price),
    pnl: roundFixed(t.pnl),
  }
}

// ---------------------------------------------------------------------------
// Discipline (checklists) + trading-locks + economic-calendar helpers.
// ---------------------------------------------------------------------------
const CHECKLIST_PHASES = new Set(['pre-entry', 'in-trade', 'post-trade'])
const MAX_TEMPLATES = 50
const MAX_TEMPLATE_ITEMS = 200
const MAX_ITEM_TEXT = 500
const MAX_TEMPLATE_NAME = 100
const MAX_DISCIPLINE_PAYLOAD = 200 * 1024
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/
const LOCK_UNLOCK_COOLDOWN_MS = 24 * 60 * 60 * 1000
const CALENDAR_CACHE_TTL_MS = 15 * 60 * 1000

let calendarCache: { data: any[]; at: number } | null = null

const asTrimmedString = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s.length >= 1 && s.length <= max ? s : null
}

/** Whitelist-validate a checklist template array (ChecklistTemplate[] shape). */
const validateChecklistTemplates = (raw: unknown): { ok: boolean; templates?: any[]; error?: string } => {
  if (!Array.isArray(raw)) return { ok: false, error: 'templates_must_be_array' }
  if (raw.length > MAX_TEMPLATES) return { ok: false, error: 'too_many_templates' }
  const out: any[] = []
  for (const t of raw) {
    if (!t || typeof t !== 'object') return { ok: false, error: 'template_not_object' }
    const name = asTrimmedString(t.name, MAX_TEMPLATE_NAME) ?? (t.name === undefined || t.name === null ? 'My Checklist' : null)
    if (!name) return { ok: false, error: 'invalid_template_name' }
    let id = typeof t.id === 'string' && SAFE_ID.test(t.id) ? t.id : null
    if (!id) id = `tpl_${crypto.randomUUID()}`.slice(0, 64)
    if (!Array.isArray(t.items)) return { ok: false, error: 'items_must_be_array' }
    if (t.items.length > MAX_TEMPLATE_ITEMS) return { ok: false, error: 'too_many_items' }
    const items: any[] = []
    for (const item of t.items) {
      if (!item || typeof item !== 'object') return { ok: false, error: 'item_not_object' }
      const text = asTrimmedString(item.text, MAX_ITEM_TEXT)
      if (!text) return { ok: false, error: 'invalid_item_text' }
      if (!CHECKLIST_PHASES.has(item.phase)) return { ok: false, error: 'invalid_item_phase' }
      let itemId = typeof item.id === 'string' && SAFE_ID.test(item.id) ? item.id : null
      if (!itemId) itemId = `rule_${crypto.randomUUID()}`.slice(0, 64)
      items.push({ id: itemId, text, phase: item.phase })
    }
    out.push({
      id,
      name,
      isActive: t.isActive === true,
      createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items,
    })
  }
  return { ok: true, templates: out }
}

const normalizeUnlockAt = (v: unknown): string | null => {
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) return null
  return v
}

/**
 * Validate one trading-lock rule from an API payload. Returns a normalized
 * shape (dropping any caller-supplied pendingChange — the server computes
 * that) or an error. Only fields the enforcement engine reads are kept.
 */
const validateLockRule = (
  raw: any,
  needsMaxPerDay: boolean
): { ok: boolean; rule?: any; error?: string } => {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'rule_not_object' }
  const enabled = raw.enabled === true
  const rule: any = { enabled, unlockRequestedAt: normalizeUnlockAt(raw.unlockRequestedAt) }
  if (raw.symbolIds !== undefined && raw.symbolIds !== null) {
    if (!Array.isArray(raw.symbolIds)) return { ok: false, error: 'symbolIds_must_be_array' }
    if (raw.symbolIds.length > 100) return { ok: false, error: 'too_many_symbol_ids' }
    const ids = raw.symbolIds.map((v: unknown) => Number(v)).filter((n: number) => Number.isSafeInteger(n) && n > 0)
    rule.symbolIds = [...new Set(ids)]
    if (raw.symbolNames && typeof raw.symbolNames === 'object' && !Array.isArray(raw.symbolNames)) {
      const names: Record<string, string> = {}
      let count = 0
      for (const [k, v] of Object.entries(raw.symbolNames)) {
        if (count >= 100) break
        if (Number.isSafeInteger(Number(k)) && Number(k) > 0 && typeof v === 'string' && v.length <= 64) {
          names[k] = v
          count++
        }
      }
      rule.symbolNames = names
    }
  }
  if (needsMaxPerDay) {
    if (raw.maxPerDay === undefined) return { ok: false, error: 'maxPerDay_required' }
    const n = Number(raw.maxPerDay)
    if (!Number.isFinite(n) || n < 1 || n > 100) return { ok: false, error: 'maxPerDay_out_of_range' }
    rule.maxPerDay = Math.floor(n)
  }
  if (raw.minLots !== undefined) {
    const n = Number(raw.minLots)
    if (!Number.isFinite(n) || n <= 0 || n > 100000) return { ok: false, error: 'minLots_out_of_range' }
    rule.minLots = n
  }
  if (raw.maxLots !== undefined) {
    const n = Number(raw.maxLots)
    if (!Number.isFinite(n) || n <= 0 || n > 100000) return { ok: false, error: 'maxLots_out_of_range' }
    rule.maxLots = n
  }
  if (rule.minLots !== undefined && rule.maxLots !== undefined && rule.minLots > rule.maxLots) {
    return { ok: false, error: 'minLots_above_maxLots' }
  }
  return { ok: true, rule }
}

// ---- Lock write semantics (server mirror of the app's discipline engine) ---
//
// Enable / tighten: immediate. Disable: starts (or preserves) the 24h
// cooling-off — the rule keeps enforcing until the countdown elapses.
// Loosen an active rule: queued as pendingChange, binds 24h later.

const finiteBound = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

const lockActive = (rule: any, now: number): boolean =>
  Boolean(rule && rule.enabled === true && (!rule.unlockRequestedAt || Date.parse(rule.unlockRequestedAt) + LOCK_UNLOCK_COOLDOWN_MS > now))

const lockBase = (rule: any, now: number): any => {
  if (!rule) return null
  if (!rule.enabled) return { ...rule, pendingChange: null }
  if (rule.unlockRequestedAt && Date.parse(rule.unlockRequestedAt) + LOCK_UNLOCK_COOLDOWN_MS <= now) {
    return { ...rule, enabled: false, unlockRequestedAt: null, pendingChange: null }
  }
  if (rule.pendingChange && !Number.isFinite(Date.parse(rule.pendingChange.requestedAt))) {
    return { ...rule, pendingChange: null }
  }
  return rule
}

/** Port of app editMaxTrades: tighten now, loosen after 24h. */
const putLockMaxTrades = (current: any, desired: any, now: number): any => {
  const base = lockBase(current, now)
  const wantOn = desired.enabled === true
  const desiredMax = Math.max(1, Math.floor(Number(desired.maxPerDay) || 1))

  if (!wantOn) {
    if (!base || !lockActive(base, now)) {
      return { enabled: false, unlockRequestedAt: null, pendingChange: null, maxPerDay: desiredMax }
    }
    return {
      enabled: true,
      unlockRequestedAt: normalizeUnlockAt(base.unlockRequestedAt) ?? new Date(now).toISOString(),
      pendingChange: null,
      maxPerDay: base.maxPerDay,
    }
  }

  if (!lockActive(base, now)) {
    return { enabled: true, maxPerDay: desiredMax, unlockRequestedAt: null, pendingChange: null }
  }

  const currentMax = Math.max(1, Math.floor(Number(base!.maxPerDay) || 1))
  if (desiredMax <= currentMax) {
    return { enabled: true, maxPerDay: desiredMax, unlockRequestedAt: null, pendingChange: null }
  }

  const previous = base!.pendingChange
  const previousValue = Math.max(1, Math.floor(Number(previous?.value?.maxPerDay) || currentMax))
  return {
    enabled: true,
    maxPerDay: currentMax,
    unlockRequestedAt: null,
    pendingChange: {
      value: { maxPerDay: desiredMax },
      requestedAt: desiredMax > previousValue ? new Date(now).toISOString() : (normalizeUnlockAt(previous?.requestedAt) ?? new Date(now).toISOString()),
    },
  }
}

/** Port of app editLotGuard per-bound: tighten now, loosen after 24h. */
const putLockLotGuard = (current: any, desired: any, now: number): any => {
  const base = lockBase(current, now)
  const wantOn = desired.enabled === true
  const wantOffRestore = (rule: any, active: boolean) => {
    const r: any = {
      enabled: active ? true : false,
      unlockRequestedAt: active ? (normalizeUnlockAt(base?.unlockRequestedAt) ?? new Date(now).toISOString()) : null,
      pendingChange: null,
    }
    if (desired.minLots !== undefined) r.minLots = finiteBound(desired.minLots)
    if (desired.maxLots !== undefined) r.maxLots = finiteBound(desired.maxLots)
    return r
  }

  if (!wantOn) return wantOffRestore(base, Boolean(base && lockActive(base, now)))
  if (!lockActive(base, now)) return wantOffRestore(base, false)
  if (base && base.unlockRequestedAt) return wantOffRestore(base, true) // re-enable during cooldown clears it

  const rule: any = { ...base, enabled: true }
  const pendingValue: any = { ...(base!.pendingChange?.value || {}) }
  let requestedAt = normalizeUnlockAt(base!.pendingChange?.requestedAt)
  let resetTimer = false

  const updateBound = (
    field: 'minLots' | 'maxLots',
    tighter: (d: number, c: number) => boolean,
  ) => {
    if (desired[field] === undefined) return
    const c = finiteBound(base![field])
    const d = finiteBound(desired[field])
    if (d === c) { if (Object.prototype.hasOwnProperty.call(pendingValue, field)) delete pendingValue[field]; return }
    if (d !== undefined && (c === undefined || tighter(d, c))) {
      rule[field] = d
      if (Object.prototype.hasOwnProperty.call(pendingValue, field)) delete pendingValue[field]
      return
    }
    pendingValue[field] = d === undefined ? null : d
    resetTimer = true
  }

  updateBound('minLots', (d, c) => d > c)
  updateBound('maxLots', (d, c) => d < c)

  if (Object.keys(pendingValue).length === 0) rule.pendingChange = null
  else rule.pendingChange = { value: pendingValue, requestedAt: resetTimer || !requestedAt ? new Date(now).toISOString() : requestedAt }
  return rule
}

/** Port of app editPairWhitelist: removal now, additions after 24h. */
const putLockPairWhitelist = (current: any, desired: any, now: number): any => {
  const base = lockBase(current, now)
  const wantOn = desired.enabled === true
  const desiredIds = [...new Set((desired.symbolIds as unknown[] || []).map((v: unknown) => Number(v)).filter((n: number) => Number.isFinite(n) && n > 0))] as number[]

  const restore = (symbolIds: number[], symbolNames: any, active: boolean): any => ({
    enabled: active ? true : false,
    unlockRequestedAt: active ? (normalizeUnlockAt(base?.unlockRequestedAt) ?? new Date(now).toISOString()) : null,
    pendingChange: null,
    symbolIds,
    symbolNames,
  })

  if (!wantOn) return restore(desiredIds, desired.symbolNames || {}, Boolean(base && lockActive(base, now)))
  if (!lockActive(base, now)) {
    return restore(desiredIds, { ...(base?.symbolNames || {}), ...(desired.symbolNames || {}) }, false)
  }
  if (base && base.unlockRequestedAt) {
    return restore(desiredIds, { ...(base.symbolNames || {}), ...(desired.symbolNames || {}) }, true)
  }

  const currentIds = (base!.symbolIds || []).map((v: unknown) => Number(v)).filter((n: number) => Number.isFinite(n))
  const currentIdsUnique = [...new Set(currentIds)] as number[]
  const desiredSet = new Set<number>(desiredIds)
  const retained = currentIdsUnique.filter((id) => desiredSet.has(id))
  // A live rule must never end up emptier than "no pairs left" — that would
  // silently block every symbol.
  if (currentIdsUnique.length > 0 && retained.length === 0) return { ...base }
  const additions = desiredIds.filter((id) => !currentIdsUnique.includes(id))
  const names = { ...(base!.symbolNames || {}), ...(desired.symbolNames || {}) }
  const result: any = { enabled: true, unlockRequestedAt: null, symbolIds: retained, symbolNames: names, pendingChange: null }
  if (additions.length === 0) return result

  const previous = base!.pendingChange
  const previousIds = ((previous?.value?.symbolIds) || []).map((v: unknown) => Number(v)).filter((n: number) => Number.isFinite(n))
  const allPreviouslyPending = desiredIds.every((id: number) => previousIds.includes(id))
  result.pendingChange = {
    value: { symbolIds: desiredIds, symbolNames: names },
    requestedAt: previous && allPreviouslyPending ? normalizeUnlockAt(previous.requestedAt) : new Date(now).toISOString(),
  }
  return result
}

/** True when any lock rule is still enforcing (enabled or cooling down). */
const anyLockActive = (locks: any): boolean => {
  for (const key of ['pairWhitelist', 'maxTrades', 'lotGuard']) {
    const r = locks?.[key]
    if (!r || r.enabled !== true) continue
    const req = r.unlockRequestedAt ?? null
    if (!req) return true
    if (Date.parse(req) + LOCK_UNLOCK_COOLDOWN_MS > Date.now()) return true
  }
  return false
}

/** Normalize an existing stored lock doc: expired cooling → off, elapsed pending → applied. */
const normalizeStoredLockDoc = (locks: any, now = Date.now()): any => {
  if (!locks || typeof locks !== 'object') return locks
  const out: any = { ...locks }
  const pw = locks.pairWhitelist
  if (pw) {
    const base = lockBase(pw, now)
    if (base?.pendingChange && base.pendingChange.requestedAt && Date.parse(base.pendingChange.requestedAt) + LOCK_UNLOCK_COOLDOWN_MS <= now) {
      const value = base.pendingChange.value || {}
      const ids = Array.isArray(value.symbolIds)
        ? [...new Set(value.symbolIds.map((v: unknown) => Number(v)).filter((n: number) => Number.isFinite(n) && n > 0))]
        : base.symbolIds
      out.pairWhitelist = {
        ...base,
        symbolIds: Array.isArray(ids) && ids.length === 0 && base.symbolIds?.length > 0 ? base.symbolIds : ids,
        symbolNames: value.symbolNames && typeof value.symbolNames === 'object' && !Array.isArray(value.symbolNames)
          ? { ...base.symbolNames, ...value.symbolNames }
          : base.symbolNames,
        pendingChange: null,
      }
    } else {
      out.pairWhitelist = base
    }
  }
  const mx = locks.maxTrades
  if (mx) {
    const base = lockBase(mx, now)
    if (base?.pendingChange && base.pendingChange.requestedAt && Date.parse(base.pendingChange.requestedAt) + LOCK_UNLOCK_COOLDOWN_MS <= now) {
      const pendingMax = Number(base.pendingChange.value?.maxPerDay)
      out.maxTrades = { ...base, maxPerDay: Number.isFinite(pendingMax) ? Math.max(1, Math.floor(pendingMax)) : base.maxPerDay, pendingChange: null }
    } else {
      out.maxTrades = base
    }
  }
  const lg = locks.lotGuard
  if (lg) {
    const base = lockBase(lg, now)
    if (base?.pendingChange && base.pendingChange.requestedAt && Date.parse(base.pendingChange.requestedAt) + LOCK_UNLOCK_COOLDOWN_MS <= now) {
      const value = base.pendingChange.value || {}
      out.lotGuard = { ...base, pendingChange: null }
      if (Object.prototype.hasOwnProperty.call(value, 'minLots')) out.lotGuard.minLots = finiteBound(value.minLots)
      if (Object.prototype.hasOwnProperty.call(value, 'maxLots')) out.lotGuard.maxLots = finiteBound(value.maxLots)
    } else {
      out.lotGuard = base
    }
  }
  return out
}

/** Normalize a ForexFactory CDN row into the calendar shape. */
const normalizeCalendarRow = (item: any): any | null => {
  try {
    const d = new Date(item?.date)
    if (Number.isNaN(d.getTime())) return null
    return {
      event: String(item?.title || ''),
      currency: String(item?.country || ''),
      date: d.toISOString().split('T')[0],
      time: d.toISOString().split('T')[1].slice(0, 8),
      impact: String(item?.impact || 'Low').toLowerCase(),
      forecast: String(item?.forecast || ''),
      previous: String(item?.previous || ''),
      actual: String(item?.actual || ''),
      source: 'forexfactory-cdn',
    }
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  const started = performance.now()
  const responseHeaders = cors(req)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: responseHeaders })
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: 'server_not_configured' }, 500, responseHeaders)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const rawToken = extractRawKey(req)
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

  if (!rawToken) return json({ error: 'missing_api_key', message: 'Missing X-API-Key or Authorization header. Send X-API-Key: jfx_pat_... or Authorization: Bearer jfx_pat_...' }, 401, responseHeaders)
  if (!TOKEN_PATTERN.test(rawToken)) return json({ error: 'malformed_token', message: 'Malformed API key. Copy the full key from Settings → Developer Tools (it starts with jfx_pat_); do not truncate or URL-encode it.' }, 401, responseHeaders)
  const keyHash = await fingerprint(rawToken)
  const { data: foundKey } = await admin.from('api_keys').select('id,user_id,scopes,expires_at').eq('key_hash', keyHash).maybeSingle()
  key = foundKey as ApiKey | null
  if (!key) return json({ error: 'invalid_token', message: 'API key not recognised (revoked or never issued). Create a new one in Settings → Developer Tools.' }, 401, responseHeaders)
  if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) return respond({ error: 'expired_token', message: 'This API key has expired. Create a new one in Settings → Developer Tools.' }, 401)

  // 429 only when the limiter explicitly denies; RPC/transport errors are 503
  // so a missing migration is never misreported as "rate limited".
  const { data: allowed, error: rateError } = await admin.rpc('consume_api_key_rate_limit', { p_user_id: key.user_id, p_key_id: key.id })
  if (rateError) return respond({ error: 'rate_limiter_unavailable', message: 'Rate-limiter check failed on the server. Try again shortly.' }, 503)
  if (!allowed) return respond({ error: 'rate_limited', message: 'Too many requests for this key. Wait 60s and retry.', retry_after: 60 }, 429, { 'retry-after': '60' })

  const hasScope = (need: string) => {
    const scopes = key!.scopes || []
    if (scopes.includes(need)) return true
    // Imply read from write for ergonomic keys (trades:write => trades:read,
    // notes:write => notes:read, checklists:write => checklists:read, …)
    if (need.endsWith(':read') && scopes.includes(need.slice(0, -5) + ':write')) return true
    return false
  }
  const requireScope = async (scope: string) => hasScope(scope)
    ? null
    : respond({ error: 'insufficient_scope', need: scope, have: key!.scopes, message: scope === 'trades:write' ? 'This key lacks trades:write. Recreate it in Settings → Developer Tools with trades:write enabled.' : `This key lacks ${scope}. Recreate it with the required scope.`, hint: scope === 'trades:write' ? 'Recreate the key in Settings → Developer Tools with trades:write enabled' : `Requires ${scope}` }, 403)
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
          // Response slimming ( PostgREST can't EXCEPT columns, so we project
          // in JS): ?include=candles:false drops embedded candle arrays (the
          // bulk of each row), ?fields=csv keeps only those fields on top.
          const includeParam = url.searchParams.get('include') ?? ''
          const fieldsParam = url.searchParams.get('fields') ?? ''
          const wantsCandlesOff = includeParam
            .split(',').map((s) => s.trim().toLowerCase())
            .some((s) => s === 'candles:false' || s === 'candles=0')
          const fieldList = fieldsParam
            ? fieldsParam.split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s))
            : null
          const shape = (row: any) => {
            if (!row || typeof row !== 'object') return row
            let out = row
            if (wantsCandlesOff) {
              const { candles: _candles, ...rest } = row
              out = rest
            }
            if (fieldList && fieldList.length > 0) {
              out = Object.fromEntries(Object.entries(out).filter(([k]) => fieldList.includes(k)))
            }
            return out
          }
          if (id) {
            const { data, error } = await admin.from('trades').select('*').eq('id', id).eq('user_id', key.user_id).is('deleted_at', null).maybeSingle()
            if (error) throw error
            if (!data) return respond({ error: 'not_found' }, 404)
            void touch(); return respond(shape(normalizeTrade(data)))
          }
          const { page: pageNumber, limit } = page(url)
          let query = admin.from('trades').select('*', { count: 'exact' }).eq('user_id', key.user_id).is('deleted_at', null).order('date', { ascending: false }).range((pageNumber - 1) * limit, pageNumber * limit - 1)
          const from = url.searchParams.get('from'); const to = url.searchParams.get('to'); const pair = url.searchParams.get('pair')
          if (from) query = query.gte('date', from); if (to) query = query.lte('date', to); if (pair) query = query.eq('pair', pair)
          // ?status=open|closed (accepted alias: is_open=true|false) — every
          // closed trade carries exit_price; open ones have exit_price null.
          const statusParam = (url.searchParams.get('status') || '').toLowerCase()
          const isOpenParam = url.searchParams.get('is_open')
          if (statusParam === 'open' || isOpenParam === 'true') query = query.is('exit_price', null)
          else if (statusParam === 'closed' || isOpenParam === 'false') query = query.not('exit_price', 'is', null)
          const { data, count, error } = await query; if (error) throw error
          void touch(); return respond({ data: (data ?? []).map((t: any) => shape(normalizeTrade(t))), page: pageNumber, limit, total: count ?? 0 })
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

    // --- Portfolio registry ---------------------------------------------------
    // Canonical listing the UI, trades.portfolio_id and /v1/locks all agree
    // on. Agents use this to enumerate valid targets for /v1/locks/:id and to
    // spot trades filed under ids that are not registered here (orphans).
    if (path === '/v1/portfolios' && req.method === 'GET') {
      // Dual gate: trades:read (journal inventory) or locks:read (targets for
      // /v1/locks/:id) — mirrors /v1/positions' convenience pattern.
      if (!hasScope('trades:read') && !hasScope('locks:read')) {
        return respond({ error: 'insufficient_scope', need: 'trades:read', have: key!.scopes, hint: 'trades:read or locks:read required' }, 403)
      }
      const { data: portfolios, error } = await admin.from('portfolios').select('id,name,is_default,is_archived,accounts,created_at,updated_at').eq('user_id', key.user_id).order('created_at', { ascending: true }); if (error) throw error
      // Tally live trades per portfolio_id (bounded read; enough for labels,
      // not a warehouse). alert_needed flags ids referenced by trades but not
      // present in the registry.
      const { data: tradeRefs, error: tradeErr } = await admin.from('trades').select('id,portfolio_id,exit_price').eq('user_id', key.user_id).is('deleted_at', null).limit(10000); if (tradeErr) throw tradeErr
      const counts = new Map<string, { total: number; open: number }>()
      for (const t of tradeRefs ?? []) {
        const pid = t.portfolio_id === null || t.portfolio_id === undefined ? '__unassigned__' : String(t.portfolio_id)
        const c = counts.get(pid) ?? { total: 0, open: 0 }
        c.total++
        if (t.exit_price === null || t.exit_price === undefined) c.open++
        counts.set(pid, c)
      }
      const known = new Set((portfolios ?? []).map((p: any) => String(p.id)))
      known.add('__unassigned__')
      const orphaned: Array<{ portfolioId: string; trades: number }> = []
      for (const [pid, c] of counts) {
        if (!known.has(pid)) orphaned.push({ portfolioId: pid, trades: c.total })
      }
      const data = (portfolios ?? []).map((p: any) => {
        const c = counts.get(String(p.id)) ?? { total: 0, open: 0 }
        const accounts = Array.isArray(p.accounts) ? p.accounts : []
        return {
          id: p.id,
          name: p.name,
          isDefault: p.is_default === true,
          isArchived: p.is_archived === true,
          createdAt: p.created_at,
          updatedAt: p.updated_at,
          linkedAccounts: (accounts || [])
            .filter((a: any) => a && typeof a === 'object')
            .map((a: any) => ({ provider: a.provider ?? null, accountId: a.externalAccountId ?? a.accountId ?? null })),
          tradeCount: c.total,
          openTradeCount: c.open,
        }
      })
      const unassigned = counts.get('__unassigned__')
      void touch()
      return respond({
        data,
        orphaned,
        unassigned: unassigned ? { trades: unassigned.total, open: unassigned.open } : { trades: 0, open: 0 },
      })
    }

    if (path === '/v1/bridge/status' && req.method === 'GET') {
      const denied = await requireScope('bridge:read'); if (denied) return denied
      const { data, error } = await admin.from('user_sync_state').select('*').eq('user_id', key.user_id).maybeSingle(); if (error) throw error
      const status = data ?? { phase: 'disconnected' }
      // Stale-state watchdog: the bridge has been seen to park forever in
      // "provisioning/starting" with months-old timestamps and zero push
      // events. Agents must not treat such a snapshot as a live connection.
      const STALE_AFTER_MS = 6 * 60 * 60 * 1000
      const now = Date.now()
      const stampMs = (v: unknown): number | null => {
        const t = Date.parse(String(v ?? ''))
        return Number.isFinite(t) ? t : null
      }
      const newestStamp = [status.last_snapshot_at, status.updated_at, status.connected_at]
        .map(stampMs).filter((t: number | null): t is number => t !== null)
        .reduce((a, b) => Math.max(a, b), 0)
      const ageMs = newestStamp ? now - newestStamp : null
      const neverPushed = Number(status.total_push_events ?? 0) === 0
      const stale = (ageMs === null || ageMs > STALE_AFTER_MS) &&
        ['provisioning', 'provisioned', 'starting', 'connected'].includes(String(status.phase))
      void touch()
      return respond({
        ...status,
        stale,
        ...(stale
          ? {
              stale_reason: neverPushed ? 'no_push_events_ever' : `no_fresh_state_for_${STALE_AFTER_MS / 3600000}h`,
              phase_age_ms: ageMs,
            }
          : {}),
      })
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

    // --- Strategy Rules & Checklists (single document row per user) --------
    const checklistMatch = path.match(/^\/v1\/checklists(?:\/([^/]+))?(?:\/items(?:\/([^/]+))?)?$/)
    if (checklistMatch) {
      const templateId = checklistMatch[1]
      const itemId = checklistMatch[2]
      const denied = await requireScope(req.method === 'GET' ? 'checklists:read' : 'checklists:write'); if (denied) return denied
      if (templateId && !SAFE_ID.test(templateId)) return respond({ error: 'not_found' }, 404)
      if (itemId && !SAFE_ID.test(itemId)) return respond({ error: 'not_found' }, 404)

      const readDoc = async () => {
        const { data, error } = await admin.from('discipline_settings').select('checklist_templates,active_checklist_template_id').eq('user_id', key.user_id).maybeSingle()
        if (error) throw error
        return {
          templates: Array.isArray(data?.checklist_templates) ? data!.checklist_templates : [],
          activeTemplateId: data?.active_checklist_template_id ?? null,
        }
      }
      const saveDoc = async (templates: any[], activeTemplateId: string | null) => {
        const { error } = await admin.from('discipline_settings').upsert(
          { user_id: key.user_id, checklist_templates: templates, active_checklist_template_id: activeTemplateId, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' },
        )
        if (error) throw error
      }
      const findTemplate = (templates: any[], id: string) => templates.find((t: any) => t?.id === id)

      if (req.method === 'GET') {
        const doc = await readDoc(); void touch()
        if (templateId) {
          const tpl = findTemplate(doc.templates, templateId)
          return tpl ? respond(tpl) : respond({ error: 'not_found' }, 404)
        }
        return respond({ templates: doc.templates, activeTemplateId: doc.activeTemplateId })
      }

      const rawBody = await req.json().catch(() => ({}))
      const body = cleanBody(rawBody)
      if (JSON.stringify(body).length > MAX_DISCIPLINE_PAYLOAD) {
        return respond({ error: 'payload_too_large', message: `Discipline payload must be <= ${MAX_DISCIPLINE_PAYLOAD} bytes.` }, 413)
      }

      // PUT — full document replace (what the app's own sync sends).
      if (path === '/v1/checklists' && req.method === 'PUT') {
        const checked = validateChecklistTemplates(body.templates)
        if (!checked.ok) return respond({ error: checked.error, message: 'Checklist document failed validation.' }, 400)
        let templates = checked.templates!
        let activeTemplateId = typeof body.activeTemplateId === 'string' && SAFE_ID.test(body.activeTemplateId) && templates.some((t: any) => t.id === body.activeTemplateId)
          ? body.activeTemplateId
          : (templates.find((t: any) => t.isActive)?.id ?? templates[0]?.id ?? null)
        templates = templates.map((t: any) => ({ ...t, isActive: t.id === activeTemplateId }))
        await saveDoc(templates, activeTemplateId); void touch()
        return respond({ templates, activeTemplateId }, 200)
      }

      const doc = await readDoc()

      // POST /v1/checklists — create a template.
      if (!templateId && req.method === 'POST') {
        const checked = validateChecklistTemplates([{ id: body.id, name: body.name, isActive: false, items: body.items ?? [] }])
        if (!checked.ok) return respond({ error: checked.error, message: 'Checklist template failed validation.' }, 400)
        const template = checked.templates![0]
        if (doc.templates.length >= MAX_TEMPLATES) return respond({ error: 'too_many_templates' }, 400)
        const activeTemplateId = doc.activeTemplateId ?? template.id
        const templates = doc.templates.map((t: any) => ({ ...t, isActive: t.id === activeTemplateId }))
        templates.push({ ...template, isActive: template.id === activeTemplateId })
        await saveDoc(templates, activeTemplateId); void touch()
        return respond(template, 201)
      }

      if (templateId && !findTemplate(doc.templates, templateId)) {
        return respond({ error: 'not_found' }, 404)
      }

      // PATCH /v1/checklists/:templateId — rename and/or set active.
      if (templateId && itemId === undefined && req.method === 'PATCH') {
        let templates = doc.templates
        if (body.name !== undefined) {
          const name = asTrimmedString(body.name, MAX_TEMPLATE_NAME)
          if (!name) return respond({ error: 'invalid_template_name' }, 400)
          templates = templates.map((t: any) => (t.id === templateId ? { ...t, name, updatedAt: new Date().toISOString() } : t))
        }
        let activeTemplateId = doc.activeTemplateId
        if (body.isActive === true) {
          activeTemplateId = templateId
          templates = templates.map((t: any) => ({ ...t, isActive: t.id === templateId }))
        }
        await saveDoc(templates, activeTemplateId); void touch()
        return respond(findTemplate(templates, templateId))
      }

      // DELETE /v1/checklists/:templateId
      if (templateId && itemId === undefined && req.method === 'DELETE') {
        let templates = doc.templates.filter((t: any) => t.id !== templateId)
        let activeTemplateId = doc.activeTemplateId === templateId ? (templates.find((t: any) => t.isActive)?.id ?? templates[0]?.id ?? null) : doc.activeTemplateId
        templates = templates.map((t: any) => ({ ...t, isActive: t.id === activeTemplateId }))
        await saveDoc(templates, activeTemplateId); void touch()
        return respond({ deleted: true })
      }

      // Items: POST /v1/checklists/:templateId/items
      if (templateId && itemId === undefined && req.method === 'POST') {
        const phase = String(body.phase ?? '')
        if (!CHECKLIST_PHASES.has(phase as string)) return respond({ error: 'invalid_item_phase' }, 400)
        const text = asTrimmedString(body.text, MAX_ITEM_TEXT)
        if (!text) return respond({ error: 'invalid_item_text' }, 400)
        let templates = JSON.parse(JSON.stringify(doc.templates))
        const tpl = findTemplate(templates, templateId)
        if (!Array.isArray(tpl.items)) tpl.items = []
        if (tpl.items.length >= MAX_TEMPLATE_ITEMS) return respond({ error: 'too_many_items' }, 400)
        const item = { id: typeof body.id === 'string' && SAFE_ID.test(body.id) ? body.id : `rule_${crypto.randomUUID()}`.slice(0, 64), text, phase }
        tpl.items.push(item)
        tpl.updatedAt = new Date().toISOString()
        await saveDoc(templates, doc.activeTemplateId); void touch()
        return respond(item, 201)
      }

      if (!itemId) return respond({ error: 'not_found' }, 404)

      // PATCH /v1/checklists/:templateId/items/:itemId
      if (req.method === 'PATCH') {
        let templates = JSON.parse(JSON.stringify(doc.templates))
        const tpl = findTemplate(templates, templateId)!
        const idx = tpl.items.findIndex((i: any) => i.id === itemId)
        if (idx < 0) return respond({ error: 'not_found' }, 404)
        if (body.text !== undefined) {
          const text = asTrimmedString(body.text, MAX_ITEM_TEXT)
          if (!text) return respond({ error: 'invalid_item_text' }, 400)
          tpl.items[idx].text = text
        }
        if (body.phase !== undefined) {
          if (!CHECKLIST_PHASES.has(String(body.phase))) return respond({ error: 'invalid_item_phase' }, 400)
          tpl.items[idx].phase = body.phase
        }
        tpl.updatedAt = new Date().toISOString()
        await saveDoc(templates, doc.activeTemplateId); void touch()
        return respond(tpl.items[idx])
      }

      // DELETE /v1/checklists/:templateId/items/:itemId
      if (req.method === 'DELETE') {
        let templates = JSON.parse(JSON.stringify(doc.templates))
        const tpl = findTemplate(templates, templateId)!
        const before = tpl.items.length
        tpl.items = tpl.items.filter((i: any) => i.id !== itemId)
        if (tpl.items.length === before) return respond({ error: 'not_found' }, 404)
        tpl.updatedAt = new Date().toISOString()
        await saveDoc(templates, doc.activeTemplateId); void touch()
        return respond({ deleted: true })
      }
      return respond({ error: 'not_found' }, 404)
    }

    // --- Trading locks (24h cooling-off enforced server-side) ---------------
    const lockMatch = path.match(/^\/v1\/locks(?:\/([^/]+))?$/)
    if (lockMatch) {
      const portfolioId = lockMatch[1]
      if (portfolioId && !SAFE_ID.test(portfolioId)) return respond({ error: 'not_found' }, 404)
      if (req.method === 'GET') {
        const denied = await requireScope('locks:read'); if (denied) return denied
        let query = admin.from('portfolio_locks').select('portfolio_id,locks,updated_at').eq('user_id', key.user_id)
        if (portfolioId) query = query.eq('portfolio_id', portfolioId).limit(1)
        const { data, error } = await query; if (error) throw error
        const rows = data ?? []
        if (portfolioId) {
          if (rows.length === 0) return respond({ error: 'not_found' }, 404)
        }
        const names = new Map<string, string>()
        const { data: pflio } = await admin.from('portfolios').select('id,name').eq('user_id', key.user_id)
        for (const p of pflio ?? []) names.set(String(p.id), p.name ?? null)
        const summarize = (locks: any) => {
          const one = (rule: any) => ({
            active: Boolean(rule && rule.enabled === true && (!rule.unlockRequestedAt || Date.parse(rule.unlockRequestedAt) + LOCK_UNLOCK_COOLDOWN_MS > Date.now())),
            cooldownMsRemaining: rule?.unlockRequestedAt ? Math.max(0, Date.parse(rule.unlockRequestedAt) + LOCK_UNLOCK_COOLDOWN_MS - Date.now()) : 0,
          })
          return {
            pairWhitelist: one(locks?.pairWhitelist),
            maxTrades: one(locks?.maxTrades),
            lotGuard: one(locks?.lotGuard),
          }
        }
        void touch()
        return respond({
          data: rows.map((r: any) => ({
            portfolioId: r.portfolio_id,
            portfolioName: names.get(String(r.portfolio_id)) ?? null,
            // One rule-cooldown left may have elapsed since the last write —
            // normalize so agents see what is actually enforced right now.
            locks: normalizeStoredLockDoc(r.locks ?? {}, Date.now()),
            summary: summarize(normalizeStoredLockDoc(r.locks ?? {}, Date.now())),
            updatedAt: r.updated_at,
          })),
        })
      }

      const denied = await requireScope('locks:write'); if (denied) return denied
      if (!portfolioId) return respond({ error: 'portfolio_id_required' }, 400)

      if (req.method === 'PUT') {
        // The portfolio must exist and belong to this key's user.
        const { data: owner } = await admin.from('portfolios').select('id').eq('id', portfolioId).eq('user_id', key.user_id).maybeSingle()
        if (!owner) return respond({ error: 'not_found', message: 'No portfolio with that id belongs to this user.' }, 404)
        const body = cleanBody(await req.json().catch(() => ({})))
        if (JSON.stringify(body).length > MAX_DISCIPLINE_PAYLOAD) {
          return respond({ error: 'payload_too_large', message: `Locks payload must be <= ${MAX_DISCIPLINE_PAYLOAD} bytes.` }, 413)
        }
        const doc = (body?.locks && typeof body.locks === 'object' ? body.locks : body) as Record<string, any>
        const editors: Record<string, (cur: any, desired: any, t: number) => any> = {
          pairWhitelist: putLockPairWhitelist,
          maxTrades: putLockMaxTrades,
          lotGuard: putLockLotGuard,
        }
        // Validate every provided rule first (400 on the first failure), then
        // write once. pendingChange is always server-computed.
        const desiredRules: Record<string, any> = {}
        for (const ruleKey of ['pairWhitelist', 'maxTrades', 'lotGuard']) {
          if (doc[ruleKey] === undefined) continue
          const checked = validateLockRule(doc[ruleKey], ruleKey === 'maxTrades')
          if (!checked.ok) return respond({ error: checked.error, message: `${ruleKey} failed validation.` }, 400)
          desiredRules[ruleKey] = checked.rule
        }
        if (Object.keys(desiredRules).length === 0) return respond({ error: 'no_rules_provided', message: 'Provide pairWhitelist, maxTrades or lotGuard.' }, 400)
        const { data: existingRow } = await admin.from('portfolio_locks').select('locks').eq('user_id', key.user_id).eq('portfolio_id', portfolioId).maybeSingle()
        const now = Date.now()
        const currentDoc = normalizeStoredLockDoc(existingRow?.locks ?? null, now)
        const nextDoc: any = { ...(currentDoc || {}) }
        const updatedAtIso = new Date(now).toISOString()
        for (const ruleKey of ['pairWhitelist', 'maxTrades', 'lotGuard']) {
          if (desiredRules[ruleKey] === undefined) continue
          nextDoc[ruleKey] = editors[ruleKey](currentDoc?.[ruleKey] ?? null, desiredRules[ruleKey], now)
        }
        nextDoc.updatedAt = updatedAtIso
        const { error } = await admin.from('portfolio_locks').upsert(
          { user_id: key.user_id, portfolio_id: portfolioId, locks: nextDoc, updated_at: updatedAtIso },
          { onConflict: 'user_id,portfolio_id' },
        )
        if (error) throw error
        void touch()
        return respond({ portfolioId, locks: nextDoc })
      }

      if (req.method === 'DELETE') {
        const { data: row } = await admin.from('portfolio_locks').select('locks').eq('user_id', key.user_id).eq('portfolio_id', portfolioId).maybeSingle()
        if (!row) return respond({ error: 'not_found' }, 404)
        const normalized = normalizeStoredLockDoc(row.locks || {}, Date.now())
        if (anyLockActive(normalized)) {
          // Cooling-off: a live/cooling lock cannot be hard-deleted. Convert
          // the delete into an unlock request is NOT done silently — the
          // agent must PUT a disable instead, which starts (or keeps) the
          // 24h countdown before deletion becomes possible.
          let unlockAt = Date.now()
          for (const k of ['pairWhitelist', 'maxTrades', 'lotGuard']) {
            const req2 = normalized[k]?.unlockRequestedAt
            if (normalized[k]?.enabled === true && req2) unlockAt = Math.max(unlockAt, Date.parse(req2) + LOCK_UNLOCK_COOLDOWN_MS)
          }
          return respond({ error: 'unlock_in_progress', message: 'A rule is still enforcing (24h cooling-off). Disable it via PUT first, then delete after the cooldown.', unlock_available_at: new Date(unlockAt).toISOString() }, 409)
        }
        const { error } = await admin.from('portfolio_locks').delete().eq('user_id', key.user_id).eq('portfolio_id', portfolioId)
        if (error) throw error
        void touch()
        return respond({ deleted: true })
      }
      return respond({ error: 'method_not_allowed' }, 405)
    }

    // --- Economic calendar (view only) --------------------------------------
    if (path === '/v1/calendar' && req.method === 'GET') {
      const denied = await requireScope('calendar:read'); if (denied) return denied
      if (!calendarCache || Date.now() - calendarCache.at > CALENDAR_CACHE_TTL_MS) {
        const res2 = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json' },
        })
        if (!res2.ok) throw new Error(`calendar_upstream_${res2.status}`)
        const raw = await res2.json().catch(() => [])
        const events = (Array.isArray(raw) ? raw : []).map(normalizeCalendarRow).filter(Boolean)
        if (events.length > 0) calendarCache = { data: events, at: Date.now() }
      }
      let events = calendarCache?.data ?? []
      const from = url.searchParams.get('from'); const to = url.searchParams.get('to')
      if (from || to) {
        events = events.filter((e: any) => e.date && (!from || e.date >= from) && (!to || e.date <= to))
      }
      void touch()
      return respond({ data: events, source: calendarCache ? 'forexfactory-cdn' : 'unavailable', cached: Boolean(calendarCache), timestamp: Date.now() })
    }

    return respond({ error: 'not_found' }, 404)
  } catch (error) {
    console.error('jfx-api request failed', error instanceof Error ? error.message : 'unknown error')
    return respond({ error: 'internal_error' }, 500)
  }
})
