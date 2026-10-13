// waypoint: the only `on()` site. Every function that touches `$` is declared
// top level here (the validator credits `$` calls only to those); the logic
// they call lives in the pure modules beside this file.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInput, RenderSurface } from 'claude-code'

import type { Layout, PlanSnapshot, PlanSource, PrEntry, PrsStore, PrsView, RepoRef, StoredPlan, Tracked, WaypointUi } from '../types'
import { drawBand, drawPane } from './pane'
import type { PaneActions } from './pane'
import { parsePlan } from './plan'
import { planSection, SECTION_ID } from './prompt'
import {
  applyPoll,
  dropPlanRefsNotIn,
  emptyStore,
  errorText,
  extractRefs,
  glabEnv,
  KICKOFF_MS,
  newToasts,
  parseGhPr,
  parseGlabMr,
  parseRemote,
  pickDue,
  pollIntervalMs,
  prId,
  prLabel,
  prune,
  repoNameOf,
  resolveManualRef,
  rowOf,
  STAGGER_MS,
  toastsFor,
  toView,
  upsert,
  viewArgs,
  discoverFromBash,
  classifyError,
} from './prs/index'
import type { PollOutcome, PrErrorClass, Toast } from './prs/index'
import { expandHome, nextSource, normalizePath, resolveUseArg, samePath, shouldResume, storeKey } from './track'
import { bandQuiet, buildBandModel, buildPaneModel, MAX_RECENT, rowBudget, statusText } from './view'
import type { RecentPlan } from './view'

// --- state -------------------------------------------------------------------

const PANE_ID = 'waypoint'
const PANE_TITLE = 'Waypoint'
const LAYOUT_KEY = 'layout'
const MAX_PLAN_BYTES = 4 * 1024 * 1024
const CLI_TIMEOUT_MS = 60_000
const REPO_TTL_MS = 60_000
const USAGE =
  'Usage: /waypoint [close|refresh|use <path|slug>|track <ref>|untrack <ref>|reset|layout <auto|compact|wide>|status]'

const EMPTY_UI: WaypointUi = { paneOpen: false, isPlaced: false, layout: 'auto', inPlanMode: false, lastReadAt: 0, lastError: null }
const EMPTY_PRS: PrsView = { entries: [], lastPolledAt: null, note: '' }

const tracked = atom({ plugin: 'waypoint', key: 'tracked' } as const, null as Tracked | null)
const plan = atom({ plugin: 'waypoint', key: 'plan' } as const, null as PlanSnapshot | null)
const ui = atom({ plugin: 'waypoint', key: 'ui' } as const, EMPTY_UI)
const prs = atom({ plugin: 'waypoint', key: 'prs' } as const, EMPTY_PRS)
const prsToasted = atom({ plugin: 'waypoint', key: 'prsToasted' } as const, [] as string[])

type Cfg = {
  openOnStart: boolean
  band: boolean
  statusLine: boolean
  layout: Layout
  planDir: string
  planPollMs: number
  resumeDays: number
  pollMs: number
  notify: boolean
}

const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : d)
const num = (v: unknown, d: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : d
}

export function parseOptions(o: Record<string, unknown>): Cfg {
  const layout = o.layout === 'compact' || o.layout === 'wide' ? o.layout : 'auto'
  const pp = num(o.planPollSeconds, 5)
  return {
    openOnStart: bool(o.openOnStart, true),
    band: bool(o.band, true),
    statusLine: bool(o.statusLine, true),
    layout,
    planDir: typeof o.planDir === 'string' && o.planDir.trim() !== '' ? o.planDir.trim() : '~/.claude/plans',
    planPollMs: pp <= 0 ? 0 : Math.max(2, pp) * 1000,
    resumeDays: Math.max(0, num(o.resumeDays, 14)),
    pollMs: pollIntervalMs(o.pollSeconds),
    notify: bool(o.notify, false),
  }
}

// Module state. A hot reload runs `register` (and `session.start`) again with
// fresh module variables; the engine cancels the old environment's waits, and
// handles kept here are cancelled before re-arming. Atoms and `$.store` persist.
let cfg: Cfg = parseOptions({})
let interactive = false
let generation = 0
let home: string | null = null
let planTimer: { cancel: () => void } | undefined
let prTimer: { cancel: () => void } | undefined
let kickTimer: { cancel: () => void } | undefined
let inflight: Promise<void> | null = null
let queued: Promise<void> | null = null
let seen: { path: string; mtimeMs: number } | null = null
let lastStatus: string | undefined | null = null // null: never sent
let repoCache: { at: number; repo: RepoRef | null } | null = null
let ticking = false
let recentPlans: RecentPlan[] = []

const bg = (p: Promise<unknown>): void => {
  p.catch(() => {})
}
const basename = (p: string): string => p.split('/').pop() ?? p
const doneOf = (s: PlanSnapshot): string => `${s.counts.done + s.counts.skipped}/${s.counts.total} done`

// --- helpers that touch `$` ----------------------------------------------------

async function homeDir($: EngineInterface): Promise<string> {
  if (home !== null) return home
  try {
    home = (await $.env.get('HOME')) ?? ''
  } catch {
    home = ''
  }
  return home
}

async function setUi($: EngineInterface, patch: Partial<WaypointUi>): Promise<void> {
  await update($, ui, prev => {
    const keys = Object.keys(patch) as (keyof WaypointUi)[]
    return keys.every(k => prev[k] === patch[k]) ? prev : { ...prev, ...patch }
  })
}

async function setStatus($: EngineInterface): Promise<void> {
  if (!cfg.statusLine) return
  try {
    const t = await read($, tracked)
    const s = await read($, plan)
    const u = await read($, ui)
    const text = statusText(t && s && samePath(s.path, t.path) ? s : null, u.inPlanMode)
    if (text === lastStatus) return
    lastStatus = text
    $.ui.status(text)
  } catch {
    // the status line is cosmetic
  }
}

/**
 * Track `path` from `source` under the precedence rules. Returns what happened;
 * the caller decides whether to refresh (a plan file in plan mode may not exist yet).
 */
async function track($: EngineInterface, path: string, source: PlanSource): Promise<'replace' | 'same' | 'keep'> {
  const h = await homeDir($)
  const p = normalizePath(expandHome(path, h))
  const cur = await read($, tracked)
  const d = nextSource(cur, { path: p, source }, h)
  if (d === 'keep') return d
  if (d === 'same') {
    if (cur && source === 'manual' && cur.source !== 'manual') await update($, tracked, t => (t ? { ...t, source } : t))
    return d
  }
  const now = await $.clock.now()
  const cwd = await $.session.cwd()
  await update($, tracked, () => ({ path: p, source, since: now, cwd, missing: false }))
  await update($, plan, s => (s && samePath(s.path, p) ? s : null))
  seen = null
  await prsSetPlanPath($, p)
  await setStatus($)
  return d
}

/** Re-read the tracked plan: coalesced, stat-gated (unless forced), hash-gated. Never throws. */
function refresh($: EngineInterface, reason: 'event' | 'poll' | 'force'): Promise<void> {
  if (!inflight) {
    inflight = refreshOnce($, reason).finally(() => {
      inflight = null
    })
    return inflight
  }
  if (reason !== 'force') return inflight
  if (!queued) {
    queued = inflight.then(() => {
      queued = null
      return refresh($, 'force')
    })
  }
  return queued
}

async function refreshOnce($: EngineInterface, reason: 'event' | 'poll' | 'force'): Promise<void> {
  try {
    const t = await read($, tracked)
    if (!t) return
    let st: { mtimeMs: number; size: number }
    try {
      st = await $.fs.stat(t.path)
    } catch {
      // In plan mode the file may not be written yet: that is planning, not missing.
      const u = await read($, ui)
      if (!t.missing && !u.inPlanMode) {
        await update($, tracked, cur => (cur && samePath(cur.path, t.path) ? { ...cur, missing: true } : cur))
        await setStatus($)
      }
      return
    }
    const prev = await read($, plan)
    const prevSame = prev !== null && samePath(prev.path, t.path) ? prev : null
    if (seen === null && prevSame) seen = { path: t.path, mtimeMs: prevSame.mtimeMs }
    if (reason !== 'force' && !t.missing && seen?.path === t.path && seen.mtimeMs === st.mtimeMs) return
    if (st.size > MAX_PLAN_BYTES) {
      await setUi($, { lastError: `plan file over 4 MiB: ${basename(t.path)}` })
      seen = { path: t.path, mtimeMs: st.mtimeMs }
      return
    }
    let raw: string
    try {
      raw = await $.fs.read(t.path)
    } catch (err) {
      await setUi($, { lastError: `could not read ${basename(t.path)}: ${String((err as Error)?.message ?? err)}` })
      return
    }
    const now = await $.clock.now()
    seen = { path: t.path, mtimeMs: st.mtimeMs }
    if (t.missing) await update($, tracked, cur => (cur && samePath(cur.path, t.path) ? { ...cur, missing: false } : cur))
    await setUi($, { lastReadAt: now, lastError: null })
    const snap = parsePlan(raw, { path: t.path, mtimeMs: st.mtimeMs, now })
    if (prevSame && prevSame.hash === snap.hash && !t.missing) return
    await update($, plan, () => snap)
    try {
      await onPlanParsed($, snap)
    } catch {
      // PR extraction never breaks the plan refresh
    }
    try {
      const rec: StoredPlan = { path: t.path, title: snap.displayTitle, at: now, percent: snap.percent, sessionId: await $.session.id() }
      await $.store.set(storeKey(t.cwd), rec)
    } catch {
      // resume is best effort
    }
    await setStatus($)
    if (prevSame && prevSame.percent < 100 && snap.percent >= 100 && snap.counts.total > 0) $.ui.toast('⚑ plan complete')
  } catch {
    // a refresh never breaks the hook that asked for it
  }
}

async function planTick($: EngineInterface, gen: number): Promise<void> {
  if (gen !== generation || inflight) return
  if (await read($, tracked)) await refresh($, 'poll')
  // The pane may be placed later (the terminal widened); the band yields then.
  try {
    const u = await read($, ui)
    if (!u.paneOpen) return
    const pane = (await $.ui.panes()).find(p => p.id === PANE_ID)
    if (!pane) await setUi($, { paneOpen: false, isPlaced: false })
    else if (pane.isPlaced !== u.isPlaced) await setUi($, { isPlaced: pane.isPlaced })
  } catch {
    // cosmetic
  }
}

async function openPane($: EngineInterface): Promise<boolean> {
  try {
    const r = await $.ui.open({ id: PANE_ID, title: PANE_TITLE, rows: 10 })
    await setUi($, { paneOpen: true, isPlaced: r.isPlaced })
    return r.isPlaced
  } catch {
    return false
  }
}

/** An open the person did not ask for: placed only in wide terminals; the band covers the rest. */
async function maybeAutoOpen($: EngineInterface): Promise<void> {
  if (!cfg.openOnStart || !interactive) return
  if (!(await read($, tracked))) return
  await openPane($)
}

async function listRecent($: EngineInterface): Promise<RecentPlan[]> {
  try {
    const dir = normalizePath(expandHome(cfg.planDir, await homeDir($)))
    const entries = await $.fs.list(dir)
    return entries
      .filter(f => f.kind === 'file' && /\.md$/i.test(f.name))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, MAX_RECENT)
      .map(f => ({ name: f.name.replace(/\.md$/i, ''), path: `${dir}/${f.name}`, mtimeMs: f.mtimeMs }))
  } catch {
    return []
  }
}

async function resetTracking($: EngineInterface): Promise<void> {
  const t = await read($, tracked)
  const cwd = t?.cwd ?? (await $.session.cwd())
  await update($, tracked, () => null)
  await update($, plan, () => null)
  await setUi($, { lastError: null })
  seen = null
  try {
    await $.store.delete(storeKey(cwd))
  } catch {
    // nothing stored
  }
  await prsSetPlanPath($, null)
  lastStatus = null
  if (cfg.statusLine) {
    lastStatus = undefined
    $.ui.status(undefined)
  }
}

async function startSession($: EngineInterface, cwd: string, isInteractive: boolean): Promise<void> {
  generation++
  const gen = generation
  interactive = isInteractive
  await $.command.register({
    name: 'waypoint',
    description: 'Plan progress pane',
    argumentHint: '[close|refresh|use <path>|track <ref>|untrack <ref>|reset|layout <auto|compact|wide>|status]',
  })
  try {
    const l = await $.store.get(LAYOUT_KEY)
    if (l === 'auto' || l === 'compact' || l === 'wide') await setUi($, { layout: l })
  } catch {
    // default layout
  }
  // Resume only on a fresh start: after a hot reload the atoms still hold what was tracked.
  let resumed = false
  if (!(await read($, tracked))) {
    try {
      const rec = (await $.store.get(storeKey(cwd))) as StoredPlan | undefined
      if (rec && typeof rec.path === 'string') {
        let st: { mtimeMs: number } | null = null
        try {
          st = await $.fs.stat(rec.path)
        } catch {
          st = null
        }
        if (shouldResume(rec, st, await $.clock.now(), cfg.resumeDays)) {
          resumed = (await track($, rec.path, 'resume')) === 'replace'
          await refresh($, 'force')
        } else {
          await $.store.delete(storeKey(cwd))
        }
      }
    } catch {
      // resume is best effort
    }
  } else {
    await prsPublish($)
  }
  planTimer?.cancel()
  prTimer?.cancel()
  kickTimer?.cancel()
  planTimer = prTimer = kickTimer = undefined
  if (isInteractive) {
    if (cfg.planPollMs > 0) planTimer = $.clock.every(cfg.planPollMs, () => bg(planTick($, gen)))
    prTimer = $.clock.every(Math.max(15_000, Math.floor(cfg.pollMs / 4)), () => bg(prsTick($, gen)))
    kickoff($)
  }
  lastStatus = null
  await setStatus($)
  if (resumed) await maybeAutoOpen($)
}

async function onPlanModeAttachment($: EngineInterface, path: string | undefined, hasPlan: boolean): Promise<void> {
  try {
    await setUi($, { inPlanMode: true })
    if (path) {
      await track($, path, 'plan_mode')
      if (hasPlan) await refresh($, 'event')
    }
    await setStatus($)
  } catch {
    // observe only
  }
}

async function onPlanModeExit($: EngineInterface, path: string | undefined, hasPlan: boolean): Promise<void> {
  try {
    await setUi($, { inPlanMode: false })
    if (path && hasPlan) await track($, path, 'plan_mode')
    await refresh($, 'force')
    await setStatus($)
    const t = await read($, tracked)
    if (t) await prsSetPlanPath($, t.path)
    await maybeAutoOpen($)
  } catch {
    // observe only
  }
}

async function onExitPlanTool($: EngineInterface, filePath: string | undefined): Promise<void> {
  try {
    if (filePath) await track($, filePath, 'exit_plan')
    await setUi($, { inPlanMode: false })
    await refresh($, 'force')
    await setStatus($)
  } catch {
    // observe only
  }
}

async function isTrackedPath($: EngineInterface, path: string | undefined): Promise<boolean> {
  const t = await read($, tracked)
  return t !== null && samePath(path, t.path, await homeDir($))
}

async function onTurnComplete($: EngineInterface): Promise<void> {
  if (await read($, tracked)) await refresh($, 'event')
}

async function composeSection($: EngineInterface): Promise<{ id: string; text: string; scope: 'session' } | null> {
  const t = await read($, tracked)
  const u = await read($, ui)
  if (!t && !u.inPlanMode) return null
  return { id: SECTION_ID, text: planSection(t?.path ?? '', u.inPlanMode), scope: 'session' }
}

async function summary($: EngineInterface): Promise<string> {
  const t = await read($, tracked)
  if (!t) return 'waypoint: no plan tracked'
  const s = await read($, plan)
  const p = await read($, prs)
  const needs = p.entries.filter(e => e.attention !== null).length
  const prPart = (needs > 0 ? ` · ${needs} PR${needs === 1 ? ' needs' : 's need'} you` : '') + (p.note ? ` · ${p.note}` : '')
  if (t.missing) return `waypoint: plan file missing: ${t.path}`
  if (!s) return `waypoint: ${basename(t.path)} · not read yet${prPart}`
  const cur = s.currentIndex === null ? undefined : s.steps[s.currentIndex]
  const curPart = cur ? ` · ${cur.status === 'blocked' ? 'blocked on' : 'current'} ${cur.short}` : s.counts.total > 0 ? ' · complete' : ''
  return `waypoint: ${s.displayTitle} · ${doneOf(s)}${curPart}${prPart}`
}

async function runCommand($: EngineInterface, args: string): Promise<string> {
  const [sub = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')
  try {
    switch (sub) {
      case '': {
        await refresh($, 'force')
        if (!(await read($, tracked))) recentPlans = await listRecent($)
        await openPane($)
        return 'Waypoint opened.'
      }
      case 'close':
        await $.ui.close({ id: PANE_ID })
        await setUi($, { paneOpen: false, isPlaced: false })
        return 'Waypoint closed.'
      case 'refresh': {
        await refresh($, 'force')
        await prsRepoll($)
        const t = await read($, tracked)
        const s = await read($, plan)
        if (!t) return 'No plan tracked.'
        if (t.missing) return `Plan file missing: ${t.path}`
        return s ? `Re-read ${basename(t.path)}: ${doneOf(s)}.` : `Re-read ${basename(t.path)}.`
      }
      case 'use': {
        if (!arg) return 'Usage: /waypoint use <path|slug>'
        const p = resolveUseArg(arg, await $.session.cwd(), cfg.planDir, await homeDir($))
        if (!(await $.fs.exists(p))) return `No plan file at ${p}`
        await track($, p, 'manual')
        await refresh($, 'force')
        await openPane($)
        const s = await read($, plan)
        return s ? `Tracking ${basename(p)}: ${doneOf(s)}.` : `Tracking ${basename(p)}.`
      }
      case 'track':
        return await prsTrackCommand($, arg)
      case 'untrack':
        return await prsUntrackCommand($, arg)
      case 'reset':
        await resetTracking($)
        return 'Waypoint reset: no plan tracked.'
      case 'layout': {
        if (arg !== 'auto' && arg !== 'compact' && arg !== 'wide') return 'Usage: /waypoint layout <auto|compact|wide>'
        await setUi($, { layout: arg })
        await $.store.set(LAYOUT_KEY, arg)
        return `Waypoint layout: ${arg}.`
      }
      case 'status':
        return await summary($)
      default:
        return USAGE
    }
  } catch (err) {
    return `waypoint: ${String((err as Error)?.message ?? err)}`
  }
}

// --- PRs ---------------------------------------------------------------------

const planPrsKey = (path: string): string => `waypoint:prs:plan/${path}`
const sessionPrsKey = (id: string): string => `waypoint:prs:session/${id}`
const isStore = (v: unknown): v is PrsStore =>
  typeof v === 'object' && v !== null && (v as PrsStore).version === 1 && typeof (v as PrsStore).entries === 'object'

async function prsKey($: EngineInterface): Promise<string> {
  const t = await read($, tracked)
  return t ? planPrsKey(t.path) : sessionPrsKey(await $.session.id())
}

async function prsLoad($: EngineInterface, key: string): Promise<PrsStore> {
  try {
    const v = await $.store.get(key)
    return isStore(v) ? v : emptyStore()
  } catch {
    return emptyStore()
  }
}

/** Write the store (when given) and publish the current key's store into the `prs` atom. */
async function prsPublish($: EngineInterface, write?: { key: string; store: PrsStore }, note?: string): Promise<void> {
  if (write) await $.store.set(write.key, write.store)
  const key = await prsKey($)
  const store = write && write.key === key ? write.store : await prsLoad($, key)
  const now = await $.clock.now()
  await update($, prs, prev => toView(store, now, note ?? prev.note))
}

async function sessionRepo($: EngineInterface): Promise<RepoRef | null> {
  const now = await $.clock.now()
  if (repoCache && now - repoCache.at < REPO_TTL_MS) return repoCache.repo
  let repo: RepoRef | null = null
  try {
    repo = parseRemote((await $.session.repo())?.remote) ?? null
  } catch {
    repo = null
  }
  repoCache = { at: now, repo }
  return repo
}

/** The plan path became known (or was cleared): fold the session's entries into the plan's store. */
async function prsSetPlanPath($: EngineInterface, path: string | null): Promise<void> {
  try {
    if (path) {
      const sKey = sessionPrsKey(await $.session.id())
      const sess = await prsLoad($, sKey)
      const ids = Object.keys(sess.entries)
      if (ids.length > 0) {
        const pKey = planPrsKey(path)
        let merged = await prsLoad($, pKey)
        const now = await $.clock.now()
        for (const e of Object.values(sess.entries)) {
          merged = merged.entries[e.id]
            ? upsert(merged, e, e.source, now, e.stepId)
            : { ...merged, entries: { ...merged.entries, [e.id]: e } }
        }
        await $.store.set(pKey, merged)
        await $.store.delete(sKey)
      }
    }
    await prsPublish($)
  } catch {
    // PR wiring never breaks tracking
  }
}

/** Debounced first poll shortly after a discovery. */
function kickoff($: EngineInterface): void {
  if (!interactive) return
  kickTimer?.cancel()
  const gen = generation
  kickTimer = $.clock.after(KICKOFF_MS, () => bg(prsTick($, gen)))
}

async function prsObserveBash($: EngineInterface, command: string | undefined, text: string | undefined): Promise<void> {
  try {
    if (!command || !/\b(gh|glab)\b/.test(command)) return
    const repo = await sessionRepo($)
    const refs = discoverFromBash({ command, text: text ?? null, repo })
    if (refs.length === 0) return
    const key = await prsKey($)
    const before = await prsLoad($, key)
    const now = await $.clock.now()
    let store = before
    for (const r of refs) store = upsert(store, r, 'session', now)
    if (store === before) return
    await prsPublish($, { key, store })
    kickoff($)
  } catch {
    // observe only
  }
}

async function onPlanParsed($: EngineInterface, snap: PlanSnapshot): Promise<void> {
  const repo = await sessionRepo($)
  const key = planPrsKey(snap.path)
  const before = await prsLoad($, key)
  const now = await $.clock.now()
  let store = before
  const keep: string[] = []
  for (const step of snap.steps) {
    for (const ref of extractRefs(step.body, repo)) {
      store = upsert(store, ref, 'plan', now, step.id)
      keep.push(prId(ref))
    }
  }
  store = dropPlanRefsNotIn(store, keep)
  if (store === before) return
  await prsPublish($, { key, store })
  if (Object.values(store.entries).some(e => e.lastPolledAt === null)) kickoff($)
}

type CliResult = { ok: true; stdout: string } | { ok: false; error: PrErrorClass }

/** Runs a read-only gh/glab view; never throws. */
async function cli($: EngineInterface, argv: string[], env?: Record<string, string>): Promise<CliResult> {
  try {
    const r = await $.process.run(argv, env ? { timeoutMs: CLI_TIMEOUT_MS, env } : { timeoutMs: CLI_TIMEOUT_MS })
    if (r.exitCode === 0) return { ok: true, stdout: r.stdout }
    return { ok: false, error: classifyError(r.stderr) }
  } catch (err) {
    const msg = String((err as Error)?.message ?? err)
    return { ok: false, error: classifyError(msg, /ENOENT|not found|no such file/i.test(msg)) }
  }
}

function outcomeOf(entry: PrEntry, r: CliResult): PollOutcome {
  if (!r.ok) return { ok: false, error: r.error }
  let json: unknown
  try {
    json = JSON.parse(r.stdout)
  } catch {
    return { ok: false, error: 'other' }
  }
  const facts = entry.kind === 'github' ? parseGhPr(json) : parseGlabMr(json)
  return facts ? { ok: true, facts } : { ok: false, error: 'other' }
}

async function showToasts($: EngineInterface, toasts: Toast[], native: boolean): Promise<void> {
  if (toasts.length === 0) return
  let fresh: Toast[] = []
  await update($, prsToasted, prev => {
    const r = newToasts(toasts, prev)
    fresh = r.fresh
    return r.toasted
  })
  for (const t of fresh) {
    $.ui.toast(t.text, { timeoutMs: 6000 })
    if (native && cfg.notify) {
      try {
        await $.ui.notify(t.text, { title: 'waypoint' })
      } catch {
        // notifications are optional
      }
    }
  }
}

/** One poll pass: due entries in sequence, staggered; single-flight; never throws. */
async function prsTick($: EngineInterface, gen: number): Promise<void> {
  if (gen !== generation || ticking) return
  ticking = true
  try {
    const key = await prsKey($)
    const due = pickDue(Object.values((await prsLoad($, key)).entries), await $.clock.now(), cfg.pollMs)
    if (due.length === 0) return
    let note: string | null = null
    let anyOk = false
    for (const [i, entry] of due.entries()) {
      if (i > 0) await $.clock.sleep(STAGGER_MS)
      if (gen !== generation) return
      const outcome = outcomeOf(entry, await cli($, viewArgs(entry), entry.kind === 'gitlab' ? glabEnv(entry) : undefined))
      const now = await $.clock.now()
      // Re-read: a discovery or untrack may have landed during the call.
      const store = await prsLoad($, key)
      const prev = store.entries[entry.id]
      if (!prev) continue
      const next = applyPoll(prev, outcome, now)
      await $.store.set(key, { ...store, entries: { ...store.entries, [entry.id]: next } })
      await showToasts($, toastsFor(prev, next, repoNameOf(next)), true)
      if (outcome.ok) {
        anyOk = true
      } else {
        const cliName = entry.kind === 'github' ? 'gh' : 'glab'
        const text = errorText(outcome.error, cliName)
        if (text !== null) {
          note = text
          await showToasts($, [{ key: `err:${cliName}:${outcome.error}`, text: `waypoint: ${text}` }], false)
        }
      }
    }
    const now = await $.clock.now()
    const store = await prsLoad($, key)
    const pruned = { ...store, entries: prune(store.entries, now) }
    const prevNote = (await read($, prs)).note
    await prsPublish($, { key, store: pruned }, note ?? (anyOk ? '' : prevNote))
  } catch {
    // polling is best effort
  } finally {
    ticking = false
  }
}

/** `/waypoint refresh`: every entry due now. */
async function prsRepoll($: EngineInterface): Promise<void> {
  const key = await prsKey($)
  const store = await prsLoad($, key)
  if (Object.keys(store.entries).length === 0) return
  const entries: Record<string, PrEntry> = {}
  for (const [id, e] of Object.entries(store.entries)) entries[id] = { ...e, lastPolledAt: null }
  await prsPublish($, { key, store: { ...store, entries } })
  if (interactive) bg(prsTick($, generation))
}

async function prsTrackCommand($: EngineInterface, arg: string): Promise<string> {
  const r = resolveManualRef(arg, await sessionRepo($))
  if (!r.ok) return r.error
  const key = await prsKey($)
  const store = upsert(await prsLoad($, key), r.ref, 'manual', await $.clock.now())
  await prsPublish($, { key, store })
  kickoff($)
  return `Tracking ${prLabel(r.ref)} (${r.ref.path}).`
}

async function prsUntrackCommand($: EngineInterface, arg: string): Promise<string> {
  const a = arg.trim()
  if (!a) return 'Usage: /waypoint untrack <id | #n | !n | url>'
  const key = await prsKey($)
  const store = await prsLoad($, key)
  const r = resolveManualRef(a, await sessionRepo($))
  const all = Object.values(store.entries)
  const hit =
    (r.ok ? store.entries[prId(r.ref)] : undefined) ?? all.find(e => e.id === a) ?? all.find(e => prLabel(e) === a)
  if (!hit) return `Not tracked: ${a}`
  await prsDrop($, hit.id)
  return `Untracked ${prLabel(hit)} (${hit.path}).`
}

async function prsDrop($: EngineInterface, id: string): Promise<void> {
  const key = await prsKey($)
  const store = await prsLoad($, key)
  if (!store.entries[id]) return
  const entries = { ...store.entries }
  delete entries[id]
  await prsPublish($, { key, store: { ...store, entries } })
}

// --- pane, band ----------------------------------------------------------------

async function pickPlan($: EngineInterface, path: string): Promise<void> {
  await track($, path, 'manual')
  await refresh($, 'force')
}

async function copyText($: EngineInterface, text: string, surface: RenderSurface): Promise<void> {
  await $.ui.copy({ text, surface })
}

async function copyPlanPath($: EngineInterface, surface: RenderSurface): Promise<void> {
  const t = await read($, tracked)
  if (t) await copyText($, t.path, surface)
}

async function closePane($: EngineInterface): Promise<void> {
  await $.ui.close({ id: PANE_ID })
  await setUi($, { paneOpen: false, isPlaced: false })
}

function makeActions($: EngineInterface): PaneActions {
  return {
    refresh: () => bg(refresh($, 'force')),
    copyPath: p => bg(copyPlanPath($, p.surface)),
    close: () => bg(closePane($)),
    open: () => bg(openPane($)),
    pick: path => bg(pickPlan($, path)),
    copyUrl: (url, p) => bg(copyText($, url, p.surface)),
    untrack: id => bg(prsDrop($, id)),
  }
}

async function paneHook($: EngineInterface, e: RenderInput<'Pane'>): Promise<RenderElement> {
  const el = $.ui.resolve(e)
  const t = await read($, tracked)
  const s = await read($, plan)
  const u = await read($, ui)
  const p = await read($, prs)
  const now = await $.clock.now()
  const model = buildPaneModel({
    snap: t && s && samePath(s.path, t.path) ? s : null,
    tracked: t,
    prs: p,
    prRows: p.entries.map(x => rowOf(x, now)),
    ui: u,
    bodyColumns: e.props.bodyColumns || e.viewport?.columns || 80,
    rows: rowBudget(e.props.scroll?.bodyRows, e.viewport?.rows),
    placement: e.props.placement,
    now,
    opts: { layout: cfg.layout },
    recent: recentPlans,
  })
  return drawPane(el, e, model, makeActions($))
}

async function bandHook($: EngineInterface, e: RenderInput<'AbovePrompt'>): Promise<RenderElement | null> {
  const t = await read($, tracked)
  const u = await read($, ui)
  if (bandQuiet({ hasSurvey: e.props.hasSurvey, bandOn: cfg.band, tracked: t !== null && !t.missing, inPlanMode: u.inPlanMode, isPlaced: u.paneOpen && u.isPlaced })) {
    return null
  }
  const s = await read($, plan)
  const p = await read($, prs)
  const model = buildBandModel(t && s && samePath(s.path, t.path) ? s : null, p)
  return drawBand($.ui.resolve(e), e, model, makeActions($))
}

// --- hooks ---------------------------------------------------------------------

// Observe-only sites fail open: a `.catch` replays what ran beneath (or runs it once), never refuses.

export const register: Register = (on, options) => {
  cfg = parseOptions((options ?? {}) as Record<string, unknown>)

  on('session.start', async ($, e, next) => {
    try {
      await startSession($, e.cwd, e.isInteractive)
    } catch {
      // never break the session start
    }
    return next(e)
  })

  on('prompt.attachment', { type: 'plan_mode' }, async ($, e, next) => {
    if (!e.agentId) await onPlanModeAttachment($, e.detail?.planFilePath, e.detail?.hasPlan === true)
    return next(e)
  })

  on('prompt.attachment', { type: 'plan_mode_reentry' }, async ($, e, next) => {
    if (!e.agentId) await onPlanModeAttachment($, e.detail?.planFilePath, true)
    return next(e)
  })

  on('prompt.attachment', { type: 'plan_mode_exit' }, async ($, e, next) => {
    if (!e.agentId) await onPlanModeExit($, e.detail?.planFilePath, e.detail?.hasPlan === true)
    return next(e)
  })

  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    const ran = await next(e)
    if (!e.agentId && !('deny' in ran && ran.deny) && !ran.isError) {
      const filePath = (ran.result as { filePath?: string } | undefined)?.filePath
      await onExitPlanTool($, filePath)
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    try {
      if (!e.agentId && !('deny' in ran && ran.deny) && !ran.isError && (await isTrackedPath($, e.file_path))) await refresh($, 'force')
    } catch {
      // observe only
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    try {
      if (!e.agentId && !('deny' in ran && ran.deny) && !ran.isError && (await isTrackedPath($, e.file_path))) await refresh($, 'force')
    } catch {
      // observe only
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (!('deny' in ran && ran.deny)) bg(prsObserveBash($, e.command, ran.text))
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    try {
      if (!e.agentId) await onTurnComplete($)
    } catch {
      // observe only
    }
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    try {
      const section = await composeSection($)
      return section ? { ...r, sections: [...r.sections, section] } : r
    } catch {
      return r
    }
  })

  on('command.run', { command: 'waypoint' }, async ($, e) => ({ text: await runCommand($, e.args ?? '') }))

  on('ui.close', { id: PANE_ID }, async ($, e, next) => {
    const r = await next(e)
    try {
      await setUi($, { paneOpen: false, isPlaced: false })
    } catch {
      // observe only
    }
    return r
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => paneHook($, e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => (await bandHook($, e)) ?? next(e))
}
