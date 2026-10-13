// waypoint PRs: polling schedule, store updates, toasts, view. Pure.

import type { PrAttention, PrEntry, PrFacts, PrRef, PrSource, PrsStore, PrsView } from '../../types'
import { attentionOf } from './classify'
import { prId, prLabel, prUrl } from './refs'

export const MIN_POLL_S = 30
export const DEFAULT_POLL_S = 120
export const MAX_POLL_PER_TICK = 10
export const STAGGER_MS = 1500
export const MAX_ENTRIES = 50
export const PRUNE_DAYS = 7
export const KICKOFF_MS = 750
export const TOASTED_MAX = 200
const MAX_BACKOFF_EXP = 4
const NOT_FOUND_GIVE_UP = 3
const DAY_MS = 86_400_000

export type PrErrorClass = 'auth' | 'rate-limit' | 'not-found' | 'missing-binary' | 'other'
export type PollOutcome = { ok: true; facts: PrFacts } | { ok: false; error: PrErrorClass }
export type Toast = { key: string; text: string }

/** Poll interval option (seconds, number or string) → ms, default 120 s, at least 30 s. */
export function pollIntervalMs(option: unknown): number {
  const n = typeof option === 'number' ? option : typeof option === 'string' ? Number(option.trim()) : NaN
  const s = Number.isFinite(n) && n > 0 ? n : DEFAULT_POLL_S
  return Math.max(MIN_POLL_S, s) * 1000
}

export function backoffMs(failures: number, interval: number): number {
  return interval * 2 ** Math.min(Math.max(0, failures), MAX_BACKOFF_EXP)
}

/** Open entries due a poll: never polled first, then the longest-waiting; at most MAX_POLL_PER_TICK. */
export function pickDue(entries: Iterable<PrEntry>, now: number, interval: number): PrEntry[] {
  const due: PrEntry[] = []
  for (const e of entries) {
    if (e.state !== 'open') continue
    if (e.error === 'not-found' && e.failures >= NOT_FOUND_GIVE_UP) continue
    if (e.lastPolledAt === null || now >= e.lastPolledAt + backoffMs(e.failures, interval)) due.push(e)
  }
  due.sort((a, b) => (a.lastPolledAt ?? -Infinity) - (b.lastPolledAt ?? -Infinity) || a.firstSeenAt - b.firstSeenAt)
  return due.slice(0, MAX_POLL_PER_TICK)
}

/** Merge a poll result into an entry: facts + attention, or a failure bump keeping the old facts. */
export function applyPoll(prev: PrEntry, outcome: PollOutcome, now: number): PrEntry {
  if (!outcome.ok) {
    return { ...prev, error: outcome.error, failures: prev.failures + 1, lastPolledAt: now }
  }
  const f = outcome.facts
  const next: PrEntry = {
    ...prev,
    ...f,
    title: f.title || prev.title,
    url: f.url || prev.url,
    attention: attentionOf(f),
    lastPolledAt: now,
    failures: 0,
  }
  delete next.error
  if (f.state === 'open') delete next.closedAt
  else next.closedAt = prev.closedAt ?? now
  return next
}

/** stderr (and whether the spawn itself rejected) → error class. */
export function classifyError(stderr: string, rejected?: boolean): PrErrorClass {
  const s = stderr || ''
  if (rejected || /ENOENT|command not found|executable file not found|no such file or directory/i.test(s)) {
    return 'missing-binary'
  }
  if (/rate limit|\b429\b|too many requests/i.test(s)) return 'rate-limit'
  if (/\b401\b|bad credentials|unauthorized|auth login|not logged in|authentication|token .*(invalid|expired)/i.test(s)) {
    return 'auth'
  }
  if (/could not resolve to a|\b404\b|not found/i.test(s)) return 'not-found'
  return 'other'
}

/** The once-per-session note/toast for an error class, or null when it is per-entry only. */
export function errorText(cls: PrErrorClass, cli: 'gh' | 'glab'): string | null {
  switch (cls) {
    case 'auth':
      return `${cli} not logged in — run ${cli} auth login`
    case 'rate-limit':
      return `${cli} rate-limited, backing off`
    case 'missing-binary':
      return `${cli} not installed`
    case 'other':
      return `${cli} failed — see the row for details`
    default:
      return null
  }
}

const PHRASE: Record<Exclude<PrAttention, null>, string> = {
  'fix-ci': 'CI failed',
  'address-review': 'changes requested',
  'resolve-conflicts': 'has conflicts',
  'ready-to-merge': 'ready to merge',
}

/** One toast per transition into a non-null attention. Key `<id>:<attention>`. */
export function toastsFor(prev: PrEntry | undefined, next: PrEntry, repoName: string): Toast[] {
  const a = next.attention
  if (!a || prev?.attention === a) return []
  return [{ key: `${next.id}:${a}`, text: `waypoint: ${prLabel(next)} ${PHRASE[a]} · ${repoName}` }]
}

/** Drop toasts already shown this session; returns the fresh ones and the bounded seen-list. */
export function newToasts(toasts: Toast[], toasted: readonly string[]): { fresh: Toast[]; toasted: string[] } {
  const seen = new Set(toasted)
  const fresh = toasts.filter((t) => !seen.has(t.key) && (seen.add(t.key), true))
  const all = [...toasted, ...fresh.map((t) => t.key)]
  return { fresh, toasted: all.slice(Math.max(0, all.length - TOASTED_MAX)) }
}

function expired(e: PrEntry, now: number): boolean {
  return e.state !== 'open' && e.closedAt !== undefined && now - e.closedAt > PRUNE_DAYS * DAY_MS
}

/** Drop closed entries older than PRUNE_DAYS, then keep at most MAX_ENTRIES (open first, newest first). */
export function prune(entries: Record<string, PrEntry>, now: number): Record<string, PrEntry> {
  const kept = Object.values(entries)
    .filter((e) => !expired(e, now))
    .sort((a, b) => Number(b.state === 'open') - Number(a.state === 'open') || b.firstSeenAt - a.firstSeenAt)
    .slice(0, MAX_ENTRIES)
  return Object.fromEntries(kept.map((e) => [e.id, e]))
}

/**
 * Another session's unmigrated store, left behind: its newest activity (seen,
 * polled or closed) is over a day old. A store still in use stays. Empty is stale.
 */
export function idleSessionStore(store: PrsStore, now: number): boolean {
  const all = Object.values(store.entries)
  const newest = Math.max(0, ...all.map((e) => Math.max(e.firstSeenAt, e.lastPolledAt ?? 0, e.closedAt ?? 0)))
  return now - newest > DAY_MS
}

/**
 * A plan's store nobody needs: no open entry, and the newest entry (seen or
 * closed) is older than PRUNE_DAYS. An empty store is stale.
 */
export function staleStore(store: PrsStore, now: number): boolean {
  const all = Object.values(store.entries)
  if (all.some((e) => e.state === 'open')) return false
  const newest = Math.max(0, ...all.map((e) => Math.max(e.firstSeenAt, e.closedAt ?? 0)))
  return now - newest > PRUNE_DAYS * DAY_MS
}

export function fmtDur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export function fmtAgo(now: number, at: number): string {
  return now - at < 5000 ? 'just now' : `${fmtDur(now - at)} ago`
}

const RANK: Record<PrSource, number> = { plan: 0, session: 1, manual: 2 }

/**
 * Add or refresh a ref. Source precedence manual > session > plan; a given
 * stepId is recorded. Returns the same store object when nothing changed.
 */
export function upsert(store: PrsStore, ref: PrRef, source: PrSource, now: number, stepId?: string): PrsStore {
  const id = prId(ref)
  const cur = store.entries[id]
  if (cur) {
    const src = RANK[source] > RANK[cur.source] ? source : cur.source
    const step = stepId ?? cur.stepId
    if (src === cur.source && step === cur.stepId) return store
    const next: PrEntry = { ...cur, source: src }
    if (step !== undefined) next.stepId = step
    return { ...store, entries: { ...store.entries, [id]: next } }
  }
  const entry: PrEntry = {
    kind: ref.kind,
    host: ref.host,
    path: ref.path,
    number: ref.number,
    id,
    state: 'open',
    draft: false,
    checks: 'none',
    review: 'none',
    mergeable: 'unknown',
    title: prLabel(ref),
    url: prUrl(ref),
    attention: null,
    source,
    firstSeenAt: now,
    lastPolledAt: null,
    failures: 0,
  }
  if (stepId !== undefined) entry.stepId = stepId
  return { ...store, entries: { ...store.entries, [id]: entry } }
}

/** Drop plan-sourced entries whose id is not in `keepIds` (session/manual stay). Same object when unchanged. */
export function dropPlanRefsNotIn(store: PrsStore, keepIds: Iterable<string>): PrsStore {
  const keep = new Set(keepIds)
  const drop = Object.values(store.entries).filter((e) => e.source === 'plan' && !keep.has(e.id))
  if (!drop.length) return store
  const entries = { ...store.entries }
  for (const e of drop) delete entries[e.id]
  return { ...store, entries }
}

function bucket(e: PrEntry): number {
  return e.state !== 'open' ? 2 : e.attention ? 0 : 1
}

/** The pane atom: attention first, then open, then closed; each newest first. Expired closed entries hidden. */
export function toView(store: PrsStore, now: number, note: string): PrsView {
  const entries = Object.values(store.entries)
    .filter((e) => !expired(e, now))
    .sort((a, b) => bucket(a) - bucket(b) || b.firstSeenAt - a.firstSeenAt)
  let last: number | null = null
  for (const e of entries) if (e.lastPolledAt !== null && (last === null || e.lastPolledAt > last)) last = e.lastPolledAt
  return { entries, lastPolledAt: last, note }
}

const KINDS = new Set(['github', 'gitlab'])
const STATES = new Set(['open', 'merged', 'closed'])

/** A stored value as a store: not a v1 store → empty; entries missing what rows draw from are dropped. */
export function sanitizeStore(v: unknown): PrsStore {
  if (typeof v !== 'object' || v === null) return emptyStore()
  const s = v as { version?: unknown; entries?: unknown }
  if (s.version !== 1 || typeof s.entries !== 'object' || s.entries === null) return emptyStore()
  const entries: Record<string, PrEntry> = {}
  for (const [k, e] of Object.entries(s.entries as Record<string, unknown>)) {
    if (typeof e !== 'object' || e === null) continue
    const x = e as Record<string, unknown>
    const strings = [x.id, x.path, x.host, x.url].every(f => typeof f === 'string' && f !== '')
    if (strings && KINDS.has(x.kind as string) && STATES.has(x.state as string)) entries[k] = e as PrEntry
  }
  return { version: 1, entries }
}

export function emptyStore(): PrsStore {
  return { version: 1, entries: {} }
}
