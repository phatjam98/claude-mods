// waypoint: pure presentation. No `$`, no JSX, no I/O: everything the pane,
// band and status line draw is computed here from the atoms' values.

import type { Handoff, Layout, PlanCounts, PlanSnapshot, PrsView, Step, StepStatus, SubItem, Tracked, WaypointUi } from '../types'

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
  /** The PR/MR title, drawn first in the wide row. */
  title?: string
}

/** A PR row plus the short label of the step it belongs to, if any. */
export type PrLine = PrRow & { stepShort: string }

export type Row =
  | { kind: 'step'; step: Step; isCurrent: boolean }
  | { kind: 'done-summary'; count: number; shorts: string[] }
  | { kind: 'more'; count: number; position: 'before' | 'after' }
  /** The current step's checkbox items: one row (`perLine` false), or one row each (wide, when the rows allow). */
  | { kind: 'children'; items: SubItem[]; perLine: boolean }

export type RecentPlan = { name: string; path: string; mtimeMs: number }
export type RecentRow = { name: string; path: string; ago: string }

export type BarModel = { done: string; current: string; currentColor: 'planMode' | 'warning'; rest: string }

/** One item of the handoff note, ready to draw. `ref.href` is set when it resolves to a tracked PR or is a URL. */
export type HandoffLine = { blocking: boolean; kind: string; title: string; ref: { text: string; href: string | null } | null }

export type HandoffSection = {
  ago: string
  /** Left by another session (shown as a recap on resume): the header says so. */
  fromEarlier: boolean
  /** Drawn as `line` alone (compact layout, or wide out of rows). */
  compact: boolean
  /** The summary pre-wrapped to width − 2, at most 4 lines. */
  summary: string[]
  items: HandoffLine[]
  more: number
  /** Compact's one line: `! waiting on you · <first item>` (+n). */
  line: string
}

export type PrSection = {
  /** PRs that need you (all of them, not only the shown ones). */
  count: number
  /** Open PRs, all of them. */
  open: number
  /** The header after `Pull requests`: `· ` + `need` (warning when `hot`) + `after`. */
  head: { need: string; hot: boolean; before: string; after: string }
  rows: PrLine[]
  others: PrLine[]
  polled: string | null
  note: string
  /** Drawn as one line for the PR most in need, plus the note (compact layout, or wide out of rows). */
  compact: boolean
}

export type PaneModel =
  | {
      kind: 'plan'
      layout: 'compact' | 'wide'
      /** Wide at 44–63 columns: one-space indents, no PR buttons, the footer on two rows. */
      narrow: boolean
      width: number
      header: { title: string; right: string; lead: string; pct: string }
      bar: BarModel
      rows: Row[]
      /** Width the step shorts are padded to (wide). */
      shortWidth: number
      /** `rows` need attention; `others` are the remaining open PRs. Merged and closed PRs are never listed. */
      prSection: PrSection | null
      handoff: HandoffSection | null
      /** Wide: the blank rows between sections (dropped when rows are short). */
      gaps: boolean
      footer: { path: string; changedAgo: string; error: string | null }
    }
  | { kind: 'none-tracked'; recent: RecentRow[]; planDir: string; handoffLine: string | null }
  | { kind: 'planning'; handoffLine: string | null }
  | { kind: 'missing'; path: string; lastCounts: PlanCounts | null; handoffLine: string | null }
  | { kind: 'no-steps'; title: string; path: string; handoffLine: string | null }

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
  planDir?: string
  /** The model's handoff note, drawn as the "Waiting on you" section. */
  handoff?: Handoff | null
  /** The current session's id: a handoff from another session is marked as from an earlier one. */
  sessionId?: string
  /** $HOME, for `~` in the footer; absent → a `/Users/<x>/` or `/home/<x>/` prefix becomes `~/`. */
  home?: string
}

export const MIN_WIDTH = 40
export const WIDE_MIN_COLUMNS = 60
/** Auto layout: the sectioned (wide) layout from this many columns in a dock; compact below. */
export const SECTIONED_MIN_COLUMNS = 44
/** Below this the wide layout is narrow. */
export const NARROW_BELOW = 64
export const INLINE_ROW_CAP = 8
export const MAX_PR_ROWS = 5
export const MAX_RECENT = 5
export const MAX_HANDOFF_ITEMS = 5
export const MAX_SUMMARY_LINES = 4
export const MAX_CHILD_LINES = 8

/** Rows the current step's children take drawn one per line: up to 8, then one `+n more` row. */
export const childLinesCost = (n: number): number => Math.min(n, MAX_CHILD_LINES) + (n > MAX_CHILD_LINES ? 1 : 0)

/** The dim `─` tail of a section rule: one space, then `─` to exactly `width` after `used` (empty when no room). */
export function ruleTail(used: string, width: number): string {
  const room = Math.floor(width) - Array.from(used).length - 1
  return room >= 1 ? ' ' + '─'.repeat(room) : ''
}

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

/** auto → compact when inline or narrower than 44 columns, else wide (narrow below 64, see `isNarrow`). */
export function chooseLayout(pref: Layout, bodyColumns: number, placement: 'dock' | 'inline' | undefined): 'compact' | 'wide' {
  if (pref !== 'auto') return pref
  return placement === 'inline' || bodyColumns < SECTIONED_MIN_COLUMNS ? 'compact' : 'wide'
}

/** The wide layout's narrow variant: under 64 columns. */
export const isNarrow = (layout: 'compact' | 'wide', width: number): boolean => layout === 'wide' && width < NARROW_BELOW

/** Rows the pane may use: the engine's body rows, else viewport rows less 4 (at least 6). */
export function rowBudget(bodyRows: number | undefined, viewportRows: number | undefined): number {
  return bodyRows ?? Math.max(6, (viewportRows ?? 24) - 4)
}

/**
 * The three-span bar, exactly `width` cells: finished steps `█`, the current
 * step's own share `▓` (warning when blocked), the rest `░`. The done span takes
 * the rounding remainder (the rest span does when nothing is finished).
 */
export function bar(finishedCount: number, total: number, current: StepStatus | null, width: number): BarModel {
  const w = Math.max(0, Math.floor(width))
  const t = Math.max(0, Math.floor(total))
  const f = Math.min(t, Math.max(0, Math.floor(finishedCount)))
  const hasCur = current !== null && f < t && t > 0
  const currentColor = current === 'blocked' ? 'warning' : 'planMode'
  if (t === 0) return { done: '', current: '', currentColor, rest: '░'.repeat(w) }
  const cur = hasCur ? Math.min(w, Math.max(1, Math.floor(w / t))) : 0
  let rest = Math.floor((w * (t - f - (hasCur ? 1 : 0))) / t)
  let done = w - cur - rest
  if (f === 0) {
    rest += done
    done = 0
  }
  return { done: '█'.repeat(done), current: '▓'.repeat(cur), currentColor, rest: '░'.repeat(rest) }
}

const finished = (c: PlanCounts): number => c.done + c.skipped
const isClosed = (s: Step | undefined): boolean => s !== undefined && (s.status === 'done' || s.status === 'skipped')

const currentStep = (snap: PlanSnapshot): Step | undefined =>
  snap.currentIndex === null ? undefined : snap.steps[snap.currentIndex]

/**
 * Header: `⚑ <title>` cut to fit, and the progress on the right: `5/6 83%`
 * under 60 columns, `WP5 · 5 of 6 · 83%` wide, `WP5 · 5/6 · 83%` in the narrow
 * wide layout (`done · …` when complete). `lead` + `pct` = `right`.
 */
export function headerLine(snap: PlanSnapshot, width: number, narrow = false): { title: string; right: string; lead: string; pct: string } {
  const c = snap.counts
  const pct = `${snap.percent}%`
  const cur = currentStep(snap)
  const where = cur !== undefined ? `${cur.short} · ` : finished(c) >= c.total && c.total > 0 ? 'done · ' : ''
  let lead: string
  if (narrow) lead = `${where}${finished(c)}/${c.total} · `
  else if (width < WIDE_MIN_COLUMNS) lead = `${finished(c)}/${c.total} `
  else lead = `${where}${finished(c)} of ${c.total} · `
  const right = lead + pct
  const title = shorten(`⚑ ${snap.displayTitle}`, Math.max(4, width - Array.from(right).length - 2))
  return { title, right, lead, pct }
}

/** `/Users/me/x` → `~/x` with `home`; without it, any `/Users/<x>/` or `/home/<x>/` prefix. */
export function homePath(path: string, home?: string): string {
  if (home !== undefined && home !== '' && home !== '/') {
    const h = home.replace(/\/+$/, '')
    if (path === h) return '~'
    if (path.startsWith(h + '/')) return '~' + path.slice(h.length)
    return path
  }
  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/)/, '~')
}

/**
 * Word-wraps `text` (whitespace collapsed) to `width` columns, at most `maxLines`
 * lines; the last kept line ends in `…` when text was left over. Over-long words are cut.
 */
export function wrapSummary(text: string, width: number, maxLines = MAX_SUMMARY_LINES): string[] {
  const w = Math.max(1, Math.floor(width))
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const word0 of words) {
    let word = word0
    while (Array.from(word).length > w) {
      if (cur !== '') {
        lines.push(cur)
        cur = ''
      }
      const chars = Array.from(word)
      lines.push(chars.slice(0, w).join(''))
      word = chars.slice(w).join('')
    }
    if (word === '') continue
    const len = Array.from(cur).length
    if (cur === '') cur = word
    else if (len + 1 + Array.from(word).length <= w) cur += ' ' + word
    else {
      lines.push(cur)
      cur = word
    }
  }
  if (cur !== '') lines.push(cur)
  const max = Math.max(1, maxLines)
  if (lines.length <= max) return lines
  const kept = lines.slice(0, max)
  const last = Array.from(kept[max - 1] ?? '')
  kept[max - 1] = (last.length < w ? last.join('').trimEnd() : last.slice(0, w - 1).join('').trimEnd()) + '…'
  return kept
}

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
export function statusText(snap: PlanSnapshot | null, inPlanMode: boolean, handoff?: Handoff | null): string | undefined {
  if (snap === null) return inPlanMode ? '⚑ planning' : handoff != null ? '⚑ needs you' : undefined
  const total = snap.counts.total
  if (total === 0) return handoff != null ? '⚑ no steps · needs you' : '⚑ no steps'
  const n = `${finished(snap.counts)}/${total}`
  const cur = currentStep(snap)
  if (cur?.status === 'blocked') return `⚑ ${n} ${cur.short}!`
  if (handoff != null) return `⚑ ${n}${cur === undefined ? '' : ` ${cur.short}`} · needs you`
  if (cur === undefined) return `⚑ ${n} ✓`
  return `⚑ ${n} ${cur.short}`
}

/** The band's text while a handoff note is up: `⚑ waiting on you (2) · WP5 of 6 · 5 done`. */
export function handoffBandText(snap: PlanSnapshot | null, handoff: Handoff): string {
  const head = `⚑ waiting on you (${handoff.items.length})`
  if (snap === null || snap.counts.total === 0) return head
  const cur = currentStep(snap)
  const total = snap.counts.total
  if (cur === undefined) return `${head} · plan complete · ${finished(snap.counts)}/${total}`
  return `${head} · ${cur.short} of ${total} · ${finished(snap.counts)} done`
}

/**
 * The step rows for `rows` lines: the current step always visible, leading
 * finished steps collapsed into one summary row when everything does not fit,
 * and a `+n more` row when steps remain below. In `compact` the `more` row is
 * drawn on the last step's line, so it costs no line of its own. In `wide` the
 * current step's children follow it, one per line when `perLine` and they fit,
 * else in one row, else not at all.
 */
export function fitSteps(steps: Step[], currentIndex: number | null, rows: number, layout: 'compact' | 'wide', perLine = false): Row[] {
  const n = steps.length
  if (n === 0) return []
  const budget = Math.max(1, Math.floor(rows))
  const cur = Math.min(n - 1, Math.max(0, currentIndex ?? n - 1))
  const curStep = steps[cur]
  const hasKids = layout === 'wide' && currentIndex !== null && curStep !== undefined && curStep.children.length > 0
  type Kids = { cost: number; perLine: boolean | null }
  const options: Kids[] = !hasKids
    ? [{ cost: 0, perLine: null }]
    : [...(perLine ? [{ cost: childLinesCost(curStep.children.length), perLine: true }] : []), { cost: 1, perLine: false }, { cost: 0, perLine: null }]
  const moreCost = layout === 'compact' ? 0 : 1

  const emit = (s: number, e: number, kids: Kids): Row[] => {
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
      if (isCurrent && kids.perLine !== null) out.push({ kind: 'children', items: step.children, perLine: kids.perLine })
    }
    if (e < n) out.push({ kind: 'more', count: n - e, position: 'after' })
    return out
  }

  // Children go to one row, then are dropped, before the window shrinks to the current step alone.
  // A window that cannot hold one step plus its `more` row is not tried (-1).
  const windowEnd = (s: number, kids: number): number => {
    const room = budget - (s > 0 ? 1 : 0) - kids
    if (n - s <= room) return n
    return room - moreCost >= 1 ? s + room - moreCost : -1
  }

  let lead = 0
  while (lead < cur && isClosed(steps[lead])) lead++
  const starts = [lead >= 2 ? lead : 0, Math.max(0, cur - 1), cur]
  for (const kids of options) {
    if (n + kids.cost <= budget) return emit(0, n, kids)
    for (const s of starts) {
      if (s > cur) continue
      const e = windowEnd(s, kids.cost)
      if (e > cur) return emit(s, e, kids)
    }
  }
  // One or two rows: the current step, then what follows (else what precedes) when there is room.
  const step: Row = { kind: 'step', step: steps[cur] as Step, isCurrent: currentIndex !== null }
  if (budget < 2) return [step]
  if (cur < n - 1) return [step, { kind: 'more', count: n - cur - 1, position: 'after' }]
  if (cur > 0) return [emit(cur, n, { cost: 0, perLine: null })[0] as Row, step]
  return [step]
}

export const needsYouCount = (prs: PrsView): number => prs.entries.filter(p => p.attention !== null).length

const slugOf = (path: string): string => (path.split('/').pop() ?? path).replace(/\.md$/i, '')

/** Rows a drawn step list takes: in compact a trailing `+n more` shares the last step's line; children one per line take a row each. */
function stepRowsDrawn(rows: Row[], wide: boolean): number {
  let n = 0
  rows.forEach((r, i) => {
    if (!wide && r.kind === 'more' && r.position === 'after' && rows[i - 1]?.kind === 'step') return
    n += r.kind === 'children' && r.perLine ? childLinesCost(r.items.length) : 1
  })
  return n
}

/** The rows `drawPane` draws for `m`, one per line. The row budget is spent against this count. */
export function paneRows(m: PaneModel): number {
  if (m.kind !== 'plan') {
    const lead = m.handoffLine === null ? 0 : 1
    if (m.kind === 'planning') return lead + 1
    if (m.kind === 'none-tracked') return lead + 1 + Math.max(1, m.recent.length)
    if (m.kind === 'missing') return lead + 2 + (m.lastCounts === null ? 0 : 1)
    return lead + 3
  }
  const wide = m.layout === 'wide'
  const gap = wide && m.gaps ? 1 : 0
  let n = 2 + gap + stepRowsDrawn(m.rows, wide)
  const ho = m.handoff
  if (ho !== null) n += ho.compact ? 1 : gap + 1 + ho.summary.length + ho.items.length + (ho.more > 0 ? 1 : 0)
  const pr = m.prSection
  if (pr !== null) {
    const note = pr.note === '' ? 0 : 1
    n += pr.compact ? 1 + note : gap + 1 + note + pr.rows.length + pr.others.length
  }
  // Wide: the footer (two rows when narrow), with its gap row and full-width rule above it when there are gaps.
  if (wide) n += 2 * gap + (m.narrow ? 2 : 1)
  return n
}

/** Compact's one handoff line: `! waiting on you · <first item title> (+n)`, or the summary when there are no items. */
export function handoffLine(h: Handoff, width: number): string {
  const first = h.items[0]
  const extra = h.items.length > 1 ? ` (+${h.items.length - 1})` : ''
  const what = first?.title ?? h.summary.replace(/\s+/g, ' ').trim()
  const head = `! waiting on you${what === '' ? '' : ' · '}`
  return head + shorten(what, Math.max(4, width - Array.from(head).length - extra.length)) + extra
}

export function buildPaneModel(input: PaneInput): PaneModel {
  const { snap, tracked, ui, now } = input
  const width = Math.max(MIN_WIDTH, Math.floor(input.bodyColumns))
  const h = input.handoff ?? null
  const hLine = h === null ? null : handoffLine(h, width)

  if (tracked === null) {
    if (ui.inPlanMode) return { kind: 'planning', handoffLine: hLine }
    const recent = [...(input.recent ?? [])]
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, MAX_RECENT)
      .map(r => ({ name: r.name || slugOf(r.path), path: r.path, ago: fmtAgo(now, r.mtimeMs) }))
    return { kind: 'none-tracked', recent, planDir: input.planDir ?? '~/.claude/plans', handoffLine: hLine }
  }
  if (tracked.missing) return { kind: 'missing', path: tracked.path, lastCounts: snap?.counts ?? null, handoffLine: hLine }
  if (snap === null) return { kind: 'planning', handoffLine: hLine }
  if (snap.steps.length === 0) return { kind: 'no-steps', title: snap.displayTitle, path: snap.path, handoffLine: hLine }

  const layout = chooseLayout(ui.layout ?? input.opts.layout, width, input.placement)
  const wide = layout === 'wide'
  const narrow = isNarrow(layout, width)
  const budget = input.placement === 'inline' ? Math.min(input.rows, INLINE_ROW_CAP) : input.rows

  const byId = new Map(input.prs.entries.map(e => [e.id, e]))
  const open = input.prRows.filter(r => {
    const st = byId.get(r.id)?.state
    return st !== 'merged' && st !== 'closed'
  })
  const hot = open.filter(r => (byId.get(r.id)?.attention ?? null) !== null)
  const cold = open.filter(r => (byId.get(r.id)?.attention ?? null) === null)
  const ordered = [...hot, ...cold]
  const allSummary = h === null ? [] : wrapSummary(h.summary, narrow ? width - 1 : width - 2)

  // What the sections may take; given up step by step (below) to keep a few steps in view.
  const fit = {
    prShown: ordered.length === 0 ? 0 : wide ? Math.min(ordered.length, MAX_PR_ROWS) : 1,
    summaryShown: allSummary.length,
    itemsShown: h === null ? 0 : Math.min(h.items.length, MAX_HANDOFF_ITEMS),
    gaps: wide,
    childLines: wide && (currentStep(snap)?.children.length ?? 0) > 0,
    handoffMore: true,
    handoffCompact: !wide,
    prCompact: !wide,
  }

  const shortOf = new Map(snap.steps.map(st => [st.id, st.short]))
  const line = (r: PrRow): PrLine => ({
    ...r,
    stepShort: (r.stepId === undefined ? undefined : shortOf.get(r.stepId)) ?? '—',
  })
  const hotIds = new Set(hot.map(r => r.id))
  const count = needsYouCount(input.prs)
  const polled = input.prs.lastPolledAt === null ? null : fmtAgo(now, input.prs.lastPolledAt)
  const polledPart = polled === null ? '' : ` · polled ${polled}`
  const otherCount = open.length - hot.length
  const cur = currentStep(snap)
  const fromEarlier = h !== null && input.sessionId !== undefined && h.sessionId !== input.sessionId
  const wideHead: PrSection['head'] =
    count > 0
      ? { before: ' · ', need: count === 1 ? '1 needs you' : `${count} need you`, hot: true, after: (otherCount > 0 ? ` · ${otherCount} other` : '') + polledPart }
      : { before: ` · ${open.length} open · `, need: 'none need you', hot: false, after: polledPart }

  const assemble = (rows: Row[]): PaneModel => {
    const shown = ordered.slice(0, fit.prShown)
    let ho: HandoffSection | null = null
    if (h !== null) {
      ho = handoffSection(h, now, width, allSummary.slice(0, fit.summaryShown), fit.itemsShown, input.prRows, fromEarlier, narrow)
      if (fit.handoffCompact) ho = { ...ho, compact: true, summary: [], items: [], more: 0 }
      else if (!fit.handoffMore) ho = { ...ho, more: 0 }
    }
    return {
      kind: 'plan',
      layout,
      narrow,
      width,
      header: headerLine(snap, width, narrow),
      bar: bar(finished(snap.counts), snap.counts.total, cur?.status ?? null, width),
      rows,
      shortWidth: Math.max(0, ...snap.steps.map(st => Array.from(st.short).length)),
      prSection:
        fit.prShown === 0
          ? null
          : {
              count,
              open: open.length,
              head: narrow ? narrowPrHead(count, open.length, polledPart, width) : wideHead,
              rows: shown.filter(r => hotIds.has(r.id)).map(line),
              others: shown.filter(r => !hotIds.has(r.id)).map(line),
              polled,
              note: input.prs.note,
              compact: fit.prCompact,
            },
      handoff: ho,
      gaps: fit.gaps,
      footer: {
        path: homePath(tracked.path, input.home),
        changedAgo: snap.mtimeMs > 0 ? fmtAgo(now, snap.mtimeMs) : 'unknown',
        error: ui.lastError,
      },
    }
  }

  // The sections come first; they give up rows, in this order, only to keep a few steps in view:
  // the current step's children to one row, PR rows, summary lines, items, the gap rows (and the
  // footer rule), the `+n more` item row, then each section to one line.
  const minSteps = Math.min(snap.steps.length, 3)
  const kidLines = childLinesCost(cur?.children.length ?? 0)
  const left = (): number => budget - paneRows(assemble([]))
  while (wide && left() < minSteps + (fit.childLines ? kidLines : 0)) {
    if (fit.childLines) fit.childLines = false
    else if (fit.prShown > 1) fit.prShown--
    else if (fit.summaryShown > 1) fit.summaryShown--
    else if (fit.itemsShown > 1) fit.itemsShown--
    else if (fit.gaps) fit.gaps = false
    else if (fit.handoffMore && h !== null && h.items.length > fit.itemsShown) fit.handoffMore = false
    else if (!fit.handoffCompact && h !== null) fit.handoffCompact = true
    else if (!fit.prCompact && fit.prShown > 0) fit.prCompact = true
    else break
  }
  return assemble(fitSteps(snap.steps, snap.currentIndex, Math.max(1, left()), layout, fit.childLines))
}

/** Narrow PR rule header: `· n need(s) you` or `· n open`, then `· polled …` while the rule still fits. */
export function narrowPrHead(count: number, open: number, polledPart: string, width: number): PrSection['head'] {
  const head: PrSection['head'] =
    count > 0
      ? { before: ' · ', need: count === 1 ? '1 needs you' : `${count} need you`, hot: true, after: polledPart }
      : { before: ` · ${open} open`, need: '', hot: false, after: polledPart }
  const used = Array.from(`── Pull requests${head.before}${head.need}${head.after}`).length
  return used + 2 > width ? { ...head, after: '' } : head
}

const KIND_PAD = 8

/** `#1` / `!6677` / an id / a URL → a Link target when a tracked PR matches or it is a URL. */
export function resolveRef(ref: string, prRows: PrRow[]): { text: string; href: string | null } {
  const r = ref.trim()
  const hit = prRows.find(p => p.id === r || p.url === r || p.label === r)
  if (hit !== undefined) return { text: hit.label, href: hit.url || null }
  if (/^https?:\/\//i.test(r)) {
    const num = /\/(?:pull|merge_requests)\/(\d+)/.exec(r)
    const text = num === null ? shorten(r, 24) : `${r.includes('merge_requests') ? '!' : '#'}${num[1]}`
    return { text, href: r }
  }
  return { text: shorten(r, 16), href: null }
}

function handoffSection(
  h: Handoff,
  now: number,
  width: number,
  summary: string[],
  itemsShown: number,
  prRows: PrRow[],
  fromEarlier: boolean,
  narrow = false,
): HandoffSection {
  const items = h.items.slice(0, itemsShown).map(it => {
    const ref = it.ref === undefined || it.ref.trim() === '' ? null : resolveRef(it.ref, prRows)
    // wide: indent 2, mark 1, gap 2, kind 8, gap 2, title, gap 2, ref; narrow: indent 1, mark 1, gap 1, kind 8, gap 1, title, gap 2, ref
    const fixed = narrow ? 1 + 1 + 1 + KIND_PAD + 1 : 2 + 1 + 2 + KIND_PAD + 2
    const room = width - fixed - (ref === null ? 0 : 2 + Array.from(ref.text).length)
    return { blocking: it.blocking, kind: it.kind.padEnd(KIND_PAD), title: shorten(it.title, Math.max(4, room)), ref }
  })
  return {
    ago: fmtAgo(now, h.at),
    fromEarlier,
    compact: false,
    summary,
    items,
    more: h.items.length - items.length,
    // Narrow draws the line after a one-space indent.
    line: handoffLine(h, narrow ? width - 1 : width),
  }
}

/** `2/5` for the current step's checkbox children, or '' when it has none. */
export function childProgress(step: Step): string {
  if (step.children.length === 0) return ''
  const done = step.children.filter(c => c.status === 'done' || c.status === 'skipped').length
  return `${done}/${step.children.length}`
}

export type BandModel = { text: string; color: 'planMode' | 'warning' }

/** The band's one row; the wiring decides whether the band shows at all (`bandQuiet`). */
export function buildBandModel(snap: PlanSnapshot | null, prs: PrsView, handoff?: Handoff | null): BandModel {
  if (handoff != null) return { text: handoffBandText(snap, handoff), color: 'warning' }
  const cur = snap === null ? undefined : currentStep(snap)
  return { text: bandText(snap, needsYouCount(prs)), color: cur?.status === 'blocked' ? 'warning' : 'planMode' }
}

/** The band yields to a survey, the option and a placed pane; with nothing tracked it shows only for planning or a handoff note. */
export function bandQuiet(q: { hasSurvey: boolean; bandOn: boolean; tracked: boolean; inPlanMode: boolean; isPlaced: boolean; handoff: boolean }): boolean {
  return q.hasSurvey || !q.bandOn || q.isPlaced || (!q.tracked && !q.inPlanMode && !q.handoff)
}
