// waypoint: pure presentation. No `$`, no JSX, no I/O: everything the pane,
// band and status line draw is computed here from the atoms' values.

import type { Layout, PlanCounts, PlanSnapshot, PrsView, Step, StepStatus, SubItem, Tracked, WaypointUi } from '../types'

export type StatusColor = 'success' | 'planMode' | 'inactive' | 'warning' | 'subtle'

/** One PR/MR row as the PR subsystem's `rowOf(entry, now)` returns it. */
export type PrRow = {
  glyph: string
  label: string
  repoName: string
  branch: string
  status: string
  color: 'error' | 'warning' | 'success' | 'subtle' | undefined
  url: string
  id: string
  stepId?: string
}

/** A PR row plus the short label of the step it belongs to, if any. */
export type PrLine = PrRow & { stepShort: string }

export type Row =
  | { kind: 'step'; step: Step; isCurrent: boolean }
  | { kind: 'done-summary'; count: number; shorts: string[] }
  | { kind: 'more'; count: number; position: 'before' | 'after' }
  | { kind: 'children'; items: SubItem[] }

export type RecentPlan = { name: string; path: string; mtimeMs: number }
export type RecentRow = { name: string; path: string; ago: string }

export type PaneModel =
  | {
      kind: 'plan'
      layout: 'compact' | 'wide'
      width: number
      header: { title: string; right: string }
      bar: { on: string; off: string }
      rows: Row[]
      prSection: { count: number; rows: PrLine[] } | null
      footer: { path: string; readAgo: string; error: string | null }
    }
  | { kind: 'none-tracked'; recent: RecentRow[] }
  | { kind: 'planning' }
  | { kind: 'missing'; path: string; lastCounts: PlanCounts | null }
  | { kind: 'no-steps'; title: string; path: string }

export type PaneInput = {
  snap: PlanSnapshot | null
  tracked: Tracked | null
  prs: PrsView
  prRows: PrRow[]
  ui: WaypointUi
  bodyColumns: number
  rows: number
  placement: 'dock' | 'inline' | undefined
  now: number
  opts: { layout: Layout }
  recent?: RecentPlan[]
}

export const MIN_WIDTH = 40
export const WIDE_MIN_COLUMNS = 60
export const INLINE_ROW_CAP = 8
export const MAX_PR_ROWS = 5
export const MAX_RECENT = 5

const GLYPHS: Record<StepStatus, string> = { done: '✓', active: '▶', pending: '·', blocked: '!', skipped: '–' }
const COLORS: Record<StepStatus, StatusColor> = {
  done: 'success',
  active: 'planMode',
  pending: 'inactive',
  blocked: 'warning',
  skipped: 'subtle',
}

export const glyph = (status: StepStatus): string => GLYPHS[status]
export const colorOf = (status: StepStatus): StatusColor => COLORS[status]

/** Cuts `s` to at most `n` characters, the last one an ellipsis when cut. */
export function shorten(s: string, n: number): string {
  const chars = Array.from(s)
  if (chars.length <= n) return s
  if (n <= 0) return ''
  if (n === 1) return '…'
  return chars.slice(0, n - 1).join('').trimEnd() + '…'
}

export function fmtAgo(now: number, at: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** auto → compact when inline or narrower than 60 columns, else wide. */
export function chooseLayout(pref: Layout, bodyColumns: number, placement: 'dock' | 'inline' | undefined): 'compact' | 'wide' {
  if (pref !== 'auto') return pref
  return placement === 'inline' || bodyColumns < WIDE_MIN_COLUMNS ? 'compact' : 'wide'
}

/** Rows the pane may use: the engine's body rows, else viewport rows less 4 (at least 6). */
export function rowBudget(bodyRows: number | undefined, viewportRows: number | undefined): number {
  return bodyRows ?? Math.max(6, (viewportRows ?? 24) - 4)
}

export function bar(pct: number, width: number): { on: string; off: string } {
  const w = Math.max(0, Math.floor(width))
  const p = Math.min(100, Math.max(0, Number.isFinite(pct) ? pct : 0))
  const on = Math.round((p / 100) * w)
  return { on: '█'.repeat(on), off: '░'.repeat(w - on) }
}

const finished = (c: PlanCounts): number => c.done + c.skipped
const isClosed = (s: Step | undefined): boolean => s !== undefined && (s.status === 'done' || s.status === 'skipped')

/** Header: `⚑ <title>` cut to fit, and the progress on the right (`3/9 33%` narrow, `3 of 9 · 33%` wide). */
export function headerLine(snap: PlanSnapshot, width: number): { title: string; right: string } {
  const c = snap.counts
  const right =
    width < WIDE_MIN_COLUMNS ? `${finished(c)}/${c.total} ${snap.percent}%` : `${finished(c)} of ${c.total} · ${snap.percent}%`
  const title = shorten(`⚑ ${snap.displayTitle}`, Math.max(4, width - right.length - 2))
  return { title, right }
}

const currentStep = (snap: PlanSnapshot): Step | undefined =>
  snap.currentIndex === null ? undefined : snap.steps[snap.currentIndex]

const prPhrase = (n: number): string => (n === 1 ? '1 PR needs you' : `${n} PRs need you`)

export function bandText(snap: PlanSnapshot | null, prsNeedingYou: number): string {
  if (snap === null) return '⚑ planning…'
  const total = snap.counts.total
  if (total === 0) return '⚑ no steps found'
  const prs = prsNeedingYou > 0 ? ` · ${prPhrase(prsNeedingYou)}` : ''
  const cur = currentStep(snap)
  if (cur === undefined) return `⚑ plan complete · ${finished(snap.counts)}/${total}${prs}`
  const done = `${snap.counts.done} done`
  if (cur.status === 'blocked') return `⚑ ${cur.short} of ${total} blocked on you · ${done}${prs}`
  return `⚑ ${cur.short} of ${total} · ${done}${prs}`
}

/** The status-line segment; undefined clears it (nothing tracked, not planning). */
export function statusText(snap: PlanSnapshot | null, inPlanMode: boolean): string | undefined {
  if (snap === null) return inPlanMode ? '⚑ planning' : undefined
  const total = snap.counts.total
  if (total === 0) return '⚑ no steps'
  const n = `${finished(snap.counts)}/${total}`
  const cur = currentStep(snap)
  if (cur === undefined) return `⚑ ${n} ✓`
  return `⚑ ${n} ${cur.short}${cur.status === 'blocked' ? '!' : ''}`
}

/**
 * The step rows for `rows` lines: the current step always visible, leading
 * finished steps collapsed into one summary row when everything does not fit,
 * and a `+n more` row when steps remain below. In `compact` the `more` row is
 * drawn on the last step's line, so it costs no line of its own.
 */
export function fitSteps(steps: Step[], currentIndex: number | null, rows: number, layout: 'compact' | 'wide'): Row[] {
  const n = steps.length
  if (n === 0) return []
  const budget = Math.max(1, Math.floor(rows))
  const cur = Math.min(n - 1, Math.max(0, currentIndex ?? n - 1))
  const curStep = steps[cur]
  const childCost = layout === 'wide' && currentIndex !== null && curStep !== undefined && curStep.children.length > 0 ? 1 : 0
  const moreCost = layout === 'compact' ? 0 : 1

  const emit = (s: number, e: number, withChildren: boolean): Row[] => {
    const out: Row[] = []
    if (s > 0) {
      const before = steps.slice(0, s)
      out.push(
        before.every(isClosed)
          ? { kind: 'done-summary', count: s, shorts: before.map(st => st.short) }
          : { kind: 'more', count: s, position: 'before' },
      )
    }
    for (let i = s; i < e; i++) {
      const step = steps[i]
      if (step === undefined) continue
      const isCurrent = currentIndex !== null && i === cur
      out.push({ kind: 'step', step, isCurrent })
      if (isCurrent && withChildren) out.push({ kind: 'children', items: step.children })
    }
    if (e < n) out.push({ kind: 'more', count: n - e, position: 'after' })
    return out
  }

  if (n + childCost <= budget) return emit(0, n, childCost > 0)

  // Children are dropped before the window shrinks to the current step alone.
  const windowEnd = (s: number, kids: number): number => {
    const room = budget - (s > 0 ? 1 : 0) - kids
    if (n - s <= room) return n
    return s + Math.max(1, room - moreCost)
  }

  let lead = 0
  while (lead < cur && isClosed(steps[lead])) lead++
  const starts = [lead >= 2 ? lead : 0, Math.max(0, cur - 1), cur]
  for (const kids of childCost > 0 ? [childCost, 0] : [0]) {
    for (const s of starts) {
      if (s > cur) continue
      const e = windowEnd(s, kids)
      if (e > cur) return emit(s, e, kids > 0)
    }
  }
  return emit(cur, cur + 1, false)
}

export const needsYouCount = (prs: PrsView): number => prs.entries.filter(p => p.attention !== null).length

const slugOf = (path: string): string => (path.split('/').pop() ?? path).replace(/\.md$/i, '')

export function buildPaneModel(input: PaneInput): PaneModel {
  const { snap, tracked, ui, now } = input

  if (tracked === null) {
    if (ui.inPlanMode) return { kind: 'planning' }
    const recent = [...(input.recent ?? [])]
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, MAX_RECENT)
      .map(r => ({ name: r.name || slugOf(r.path), path: r.path, ago: fmtAgo(now, r.mtimeMs) }))
    return { kind: 'none-tracked', recent }
  }
  if (tracked.missing) return { kind: 'missing', path: tracked.path, lastCounts: snap?.counts ?? null }
  if (snap === null) return { kind: 'planning' }
  if (snap.steps.length === 0) return { kind: 'no-steps', title: snap.displayTitle, path: snap.path }

  const width = Math.max(MIN_WIDTH, Math.floor(input.bodyColumns))
  const layout = chooseLayout(ui.layout !== 'auto' ? ui.layout : input.opts.layout, width, input.placement)
  const wide = layout === 'wide'
  const budget = input.placement === 'inline' ? Math.min(input.rows, INLINE_ROW_CAP) : input.rows

  // Fixed rows: header, bar, and in wide a blank line and the footer.
  const fixed = 2 + (wide ? 2 : 0)
  let prShown = input.prRows.length === 0 ? 0 : wide ? Math.min(input.prRows.length, MAX_PR_ROWS) : 1
  const prCost = (shown: number): number => (shown === 0 ? 0 : wide ? 1 + shown : 1)
  const minSteps = Math.min(snap.steps.length, 3)
  while (wide && prShown > 1 && budget - fixed - prCost(prShown) < minSteps) prShown--

  const stepRows = Math.max(1, budget - fixed - prCost(prShown))
  const shortOf = new Map(snap.steps.map(st => [st.id, st.short]))
  const prRows = (wide ? input.prRows.slice(0, prShown) : pickCompactPr(input.prRows)).map(r => ({
    ...r,
    stepShort: (r.stepId === undefined ? undefined : shortOf.get(r.stepId)) ?? '—',
  }))

  return {
    kind: 'plan',
    layout,
    width,
    header: headerLine(snap, width),
    bar: bar(snap.percent, width),
    rows: fitSteps(snap.steps, snap.currentIndex, stepRows, layout),
    prSection: prShown === 0 ? null : { count: needsYouCount(input.prs), rows: prRows },
    footer: {
      path: tracked.path,
      readAgo: ui.lastReadAt > 0 ? fmtAgo(now, ui.lastReadAt) : 'not read yet',
      error: ui.lastError,
    },
  }
}

/** The one PR shown in compact: the first that needs attention, else the first. */
function pickCompactPr(rows: PrRow[]): PrRow[] {
  const hot = rows.find(r => r.color === 'error' || r.color === 'warning') ?? rows[0]
  return hot === undefined ? [] : [hot]
}

/** `2/5` for the current step's checkbox children, or '' when it has none. */
export function childProgress(step: Step): string {
  if (step.children.length === 0) return ''
  const done = step.children.filter(c => c.status === 'done' || c.status === 'skipped').length
  return `${done}/${step.children.length}`
}

export type BandModel = { text: string; color: 'planMode' | 'warning' }

/** The band's one row; the wiring decides whether the band shows at all (`bandQuiet`). */
export function buildBandModel(snap: PlanSnapshot | null, prs: PrsView): BandModel {
  const cur = snap === null ? undefined : currentStep(snap)
  return { text: bandText(snap, needsYouCount(prs)), color: cur?.status === 'blocked' ? 'warning' : 'planMode' }
}

/** The band yields to a survey, the option, an empty tracker and a placed pane. */
export function bandQuiet(q: { hasSurvey: boolean; bandOn: boolean; tracked: boolean; inPlanMode: boolean; isPlaced: boolean }): boolean {
  return q.hasSurvey || !q.bandOn || q.isPlaced || (!q.tracked && !q.inPlanMode)
}
