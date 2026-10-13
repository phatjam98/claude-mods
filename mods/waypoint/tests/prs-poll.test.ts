import { test, expect } from 'claude-code/testing'
import type { PrEntry, PrFacts, PrRef, PrsStore } from '../types'
import {
  applyPoll,
  backoffMs,
  classifyError,
  dropPlanRefsNotIn,
  emptyStore,
  errorText,
  fmtAgo,
  MAX_ENTRIES,
  MAX_POLL_PER_TICK,
  newToasts,
  parseGhPr,
  pickDue,
  pollIntervalMs,
  prune,
  repoNameOf,
  rowOf,
  sanitizeStore,
  toastsFor,
  toView,
  upsert,
} from '../hooks/prs'
import { gh, stderr } from './fixtures/prs'

const R13: PrRef = { kind: 'github', host: 'github.com', path: 'phatjam98/eventhorizon', number: 13 }
const ref = (n: number): PrRef => ({ ...R13, number: n })
const ID13 = 'github.com/phatjam98/eventhorizon#13'
const DAY = 86_400_000
const facts = (json: unknown): PrFacts => {
  const f = parseGhPr(json)
  if (!f) throw new Error('fixture did not parse')
  return f
}
const entry13 = (): PrEntry => {
  const e = upsert(emptyStore(), R13, 'session', 1000).entries[ID13]
  if (!e) throw new Error('no entry')
  return e
}

test('pollIntervalMs: default, clamp to 30 s, strings accepted', () => {
  const cases: [unknown, number][] = [
    [undefined, 120_000],
    ['', 120_000],
    ['abc', 120_000],
    [-5, 120_000],
    [10, 30_000],
    [30, 30_000],
    ['300', 300_000],
    [90, 90_000],
  ]
  for (const [opt, want] of cases) expect(pollIntervalMs(opt)).toBe(want)
})

test('backoffMs doubles per failure and caps at 2^4', () => {
  expect([0, 1, 2, 3, 4, 5, 9].map((f) => backoffMs(f, 1000))).toEqual([1000, 2000, 4000, 8000, 16000, 16000, 16000])
})

test('upsert creates the default entry', () => {
  expect(entry13()).toEqual({
    kind: 'github', host: 'github.com', path: 'phatjam98/eventhorizon', number: 13, id: ID13,
    state: 'open', draft: false, checks: 'none', review: 'none', mergeable: 'unknown',
    title: '#13', url: 'https://github.com/phatjam98/eventhorizon/pull/13', attention: null,
    source: 'session', firstSeenAt: 1000, lastPolledAt: null, failures: 0,
  })
})

test('upsert precedence manual > session > plan; stepId recorded; unchanged → same object', () => {
  let s = upsert(emptyStore(), R13, 'plan', 1, 'wp4')
  expect(s.entries[ID13]?.source).toBe('plan')
  s = upsert(s, R13, 'session', 2)
  expect(s.entries[ID13]).toMatchObject({ source: 'session', stepId: 'wp4', firstSeenAt: 1 })
  s = upsert(s, R13, 'manual', 3)
  s = upsert(s, R13, 'plan', 4)
  expect(s.entries[ID13]?.source).toBe('manual')
  expect(upsert(s, R13, 'session', 5)).toBe(s)
  expect(upsert(s, R13, 'plan', 6, 'wp5').entries[ID13]?.stepId).toBe('wp5')
})

test('dropPlanRefsNotIn drops only plan-sourced entries not kept', () => {
  let s: PrsStore = emptyStore()
  s = upsert(s, ref(1), 'plan', 1, 'a')
  s = upsert(s, ref(2), 'plan', 1, 'a')
  s = upsert(s, ref(3), 'session', 1)
  s = upsert(s, ref(4), 'manual', 1)
  const keep = ['github.com/phatjam98/eventhorizon#2']
  expect(Object.keys(dropPlanRefsNotIn(s, keep).entries).sort()).toEqual([
    'github.com/phatjam98/eventhorizon#2', 'github.com/phatjam98/eventhorizon#3', 'github.com/phatjam98/eventhorizon#4',
  ])
  const all = Object.keys(s.entries)
  expect(dropPlanRefsNotIn(s, all)).toBe(s)
})

test('pickDue: never-polled first, then oldest; skips closed, backed-off and given-up not-found', () => {
  const base = entry13()
  const mk = (n: number, over: Partial<PrEntry>): PrEntry => ({ ...base, number: n, id: `x#${n}`, ...over })
  const I = 1000
  const list = [
    mk(1, { lastPolledAt: 5000 }), // due at 6000
    mk(2, { lastPolledAt: null }),
    mk(3, { lastPolledAt: 2000 }),
    mk(4, { lastPolledAt: 9500 }), // not due
    mk(5, { lastPolledAt: null, state: 'merged' }),
    mk(6, { lastPolledAt: 8000, failures: 2 }), // due at 12000
    mk(7, { lastPolledAt: 0, failures: 3, error: 'not-found' }),
    mk(8, { lastPolledAt: 0, failures: 2, error: 'not-found' }),
  ]
  expect(pickDue(list, 10_000, I).map((e) => e.number)).toEqual([2, 8, 3, 1])
  const many = Array.from({ length: 15 }, (_, i) => mk(i, { lastPolledAt: null }))
  expect(pickDue(many, 0, I)).toHaveLength(MAX_POLL_PER_TICK)
})

test('applyPoll merges facts, recomputes attention, clears error, sets closedAt once', () => {
  const failed = applyPoll(entry13(), { ok: false, error: 'auth' }, 2000)
  expect(failed).toMatchObject({ error: 'auth', failures: 1, lastPolledAt: 2000, title: '#13', attention: null })
  const ok = applyPoll(failed, { ok: true, facts: facts(gh.failing) }, 3000)
  expect(ok).toMatchObject({ attention: 'fix-ci', failures: 0, lastPolledAt: 3000, title: gh.failing.title })
  expect('error' in ok).toBe(false)
  const merged1 = applyPoll(ok, { ok: true, facts: facts(gh.merged) }, 4000)
  const merged2 = applyPoll(merged1, { ok: true, facts: facts(gh.merged) }, 5000)
  expect([merged1.closedAt, merged2.closedAt, merged2.attention]).toEqual([4000, 4000, null])
  const keepFacts = applyPoll(ok, { ok: false, error: 'rate-limit' }, 6000)
  expect([keepFacts.attention, keepFacts.checks]).toEqual(['fix-ci', 'failing'])
})

test('classifyError on real and documented stderr strings', () => {
  const cases: [string, boolean | undefined, string][] = [
    [stderr.ghAuth, undefined, 'auth'],
    [stderr.glabAuth, undefined, 'auth'],
    [stderr.ghNotFoundPr, undefined, 'not-found'],
    [stderr.ghNotFoundRepo, undefined, 'not-found'],
    [stderr.glabNotFound, undefined, 'not-found'],
    [stderr.ghRateLimit, undefined, 'rate-limit'],
    [stderr.glabRateLimit, undefined, 'rate-limit'],
    [stderr.missing, undefined, 'missing-binary'],
    ['', true, 'missing-binary'],
    ['something odd happened', undefined, 'other'],
  ]
  for (const [s, rejected, want] of cases) expect(classifyError(s, rejected)).toBe(want)
  expect(errorText('auth', 'gh')).toBe('gh not logged in — run gh auth login')
  expect(errorText('rate-limit', 'glab')).toBe('glab rate-limited, backing off')
  expect(errorText('missing-binary', 'gh')).toBe('gh not installed')
  expect(errorText('not-found', 'gh')).toBeNull()
})

test('toastsFor fires on a transition into attention only; newToasts never repeats a key', () => {
  const prev = entry13()
  const next = applyPoll(prev, { ok: true, facts: facts(gh.failing) }, 2000)
  const t = toastsFor(prev, next, 'eventhorizon')
  expect(t).toEqual([{ key: `${ID13}:fix-ci`, text: 'waypoint: #13 CI failed · eventhorizon' }])
  expect(toastsFor(next, next, 'eventhorizon')).toEqual([])
  expect(toastsFor(next, prev, 'eventhorizon')).toEqual([])
  const first = newToasts(t, [])
  expect(first.fresh).toHaveLength(1)
  expect(newToasts(t, first.toasted).fresh).toEqual([])
  const bounded = newToasts([{ key: 'new', text: '' }], Array.from({ length: 200 }, (_, i) => `k${i}`))
  expect([bounded.toasted.length, bounded.toasted[199], bounded.toasted[0]]).toEqual([200, 'new', 'k1'])
})

test('prune drops closed entries after 7 days and caps the store', () => {
  const now = 100 * DAY
  const base = entry13()
  const old = { ...base, id: 'old', state: 'merged' as const, closedAt: now - 8 * DAY }
  const recent = { ...base, id: 'recent', state: 'closed' as const, closedAt: now - 6 * DAY }
  const open = { ...base, id: 'open', lastPolledAt: 5 }
  expect(Object.keys(prune({ old, recent, open }, now)).sort()).toEqual(['open', 'recent'])
  const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`e${i}`, { ...base, id: `e${i}`, firstSeenAt: i }]))
  const kept = prune(many, now)
  expect(Object.keys(kept)).toHaveLength(MAX_ENTRIES)
  expect(kept['e59']).toBeDefined()
  expect(kept['e0']).toBeUndefined()
})

test('toView sorts attention, open, closed (newest first) and reports last poll', () => {
  let s = emptyStore()
  for (const n of [1, 2, 3, 4]) s = upsert(s, ref(n), 'session', n * 10)
  const id = (n: number) => `github.com/phatjam98/eventhorizon#${n}`
  const set = (n: number, f: PrFacts, at: number) => {
    const e = s.entries[id(n)]
    if (e) s = { ...s, entries: { ...s.entries, [id(n)]: applyPoll(e, { ok: true, facts: f }, at) } }
  }
  set(1, facts(gh.failing), 500)
  set(2, facts(gh.merged), 700)
  set(3, facts(gh.inProgress), 600)
  const v = toView(s, 1000, 'note')
  expect(v.entries.map((e) => e.number)).toEqual([1, 4, 3, 2])
  expect([v.lastPolledAt, v.note]).toEqual([700, 'note'])
  expect(toView(emptyStore(), 0, '').lastPolledAt).toBeNull()
})

test('fmtAgo', () => {
  const cases: [number, string][] = [[0, 'just now'], [4_000, 'just now'], [45_000, '45s ago'], [120_000, '2m ago'], [3 * 3600_000, '3h ago'], [3 * DAY, '3d ago']]
  for (const [d, want] of cases) expect(fmtAgo(1e9 + d, 1e9)).toBe(want)
})

test('rowOf builds pane data; errors show ⚠ class', () => {
  const e = applyPoll(entry13(), { ok: true, facts: facts(gh.failing) }, 2000)
  expect(rowOf(e, 3000)).toEqual({
    glyph: '✗', label: '#13', repoName: 'eventhorizon', branch: 'feat/phase4.7-nab', status: 'ci failed',
    color: 'error', url: 'https://github.com/phatjam98/eventhorizon/pull/13', id: ID13, stepId: undefined,
  })
  expect(rowOf(applyPoll(e, { ok: false, error: 'auth' }, 4000), 5000).status).toBe('⚠ auth')
  expect(repoNameOf({ path: 'ecfx/sub/ecfx-backend' })).toBe('ecfx-backend')
})

test('sanitizeStore drops entries a row cannot draw and rejects non-stores', () => {
  const good = { id: 'h/p#1', kind: 'github', state: 'open', host: 'h', path: 'p', url: 'https://h/p/pull/1' }
  const v = { version: 1, entries: { a: good, b: { ...good, path: undefined }, c: { ...good, kind: 'bitbucket' }, d: { ...good, state: 'gone' }, e: null } }
  expect(Object.keys(sanitizeStore(v).entries)).toEqual(['a'])
  expect(sanitizeStore({ version: 2, entries: {} })).toEqual(emptyStore())
  expect(sanitizeStore('nope')).toEqual(emptyStore())
})
