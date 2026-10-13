import { test, expect } from 'claude-code/testing'
import {
  bandQuiet,
  bandText,
  bar,
  buildBandModel,
  childLinesCost,
  buildPaneModel,
  chooseLayout,
  fitSteps,
  fmtAgo,
  headerLine,
  isNarrow,
  narrowPrHead,
  homePath,
  MAX_PR_ROWS,
  paneRows,
  resolveRef,
  ruleTail,
  wrapSummary,
  paneStatusLine,
  shorten,
  statusText,
} from '../hooks/view'
import type { PaneInput, PrRow, Row } from '../hooks/view'
import type { Handoff, PlanSnapshot, PrEntry, PrsView, Step, StepStatus, SubItem, Tracked, WaypointUi } from '../types'

const NOW = 1_800_000_000_000

function step(i: number, status: StepStatus, children: SubItem[] = []): Step {
  return {
    index: i,
    id: `wp${i}-title-${i}`,
    short: `WP${i}`,
    title: `Title ${i}`,
    status,
    marked: true,
    depth: 3,
    line: i * 10,
    endLine: i * 10 + 9,
    body: '',
    children,
    links: [],
  }
}

function snap(statuses: StepStatus[], extra: Partial<PlanSnapshot> = {}): PlanSnapshot {
  const steps = statuses.map((s, i) => step(i, s))
  const count = (s: StepStatus) => statuses.filter(x => x === s).length
  const counts = {
    total: statuses.length,
    done: count('done'),
    active: count('active'),
    blocked: count('blocked'),
    pending: count('pending'),
    skipped: count('skipped'),
  }
  const firstOf = (s: StepStatus) => statuses.indexOf(s)
  const cur = [firstOf('active'), firstOf('blocked'), firstOf('pending')].find(i => i >= 0)
  return {
    path: '/Users/me/.claude/plans/noble-tulip.md',
    title: 'Plan: ECFX-18104 — re-baseline schema.sql',
    displayTitle: 'ECFX-18104 — re-baseline schema.sql',
    steps,
    mode: 'marked',
    stepDepth: 3,
    counts,
    percent: counts.total === 0 ? 0 : Math.round((100 * (counts.done + counts.skipped)) / counts.total),
    currentIndex: cur ?? null,
    mtimeMs: NOW - 60_000,
    bytes: 1000,
    truncated: false,
    hash: 'abc',
    parsedAt: NOW,
    warnings: [],
    ...extra,
  }
}

const NINE: StepStatus[] = ['done', 'done', 'active', 'pending', 'blocked', 'pending', 'pending', 'pending', 'pending']
const UI: WaypointUi = { paneOpen: true, isPlaced: true, layout: 'auto', inPlanMode: false, lastReadAt: NOW - 12_000, lastError: null }
const TRACKED: Tracked = { path: '/Users/me/.claude/plans/noble-tulip.md', source: 'manual', since: NOW - 1000, cwd: '/repo', missing: false }
const NO_PRS: PrsView = { entries: [], lastPolledAt: null, note: '' }

function input(over: Partial<PaneInput> = {}): PaneInput {
  return {
    snap: snap(NINE),
    tracked: TRACKED,
    prs: NO_PRS,
    prRows: [],
    ui: UI,
    bodyColumns: 90,
    rows: 20,
    placement: 'dock',
    now: NOW,
    opts: { layout: 'auto' },
    ...over,
  }
}

const kinds = (rows: Row[]) => rows.map(r => r.kind)

const barLen = (b: ReturnType<typeof bar>) => b.done.length + b.current.length + b.rest.length

test('bar: three spans, exact width, done absorbs rounding', () => {
  const b = bar(5, 6, 'active', 92)
  expect(b).toEqual({ done: '█'.repeat(77), current: '▓'.repeat(15), currentColor: 'planMode', rest: '' })
  const mid = bar(2, 9, 'active', 90)
  expect(mid.current.length).toBe(10)
  expect(mid.rest.length).toBe(60)
  expect(mid.done.length).toBe(20)
  for (const w of [40, 41, 77, 92, 120]) for (const [f, t] of [[0, 9], [3, 9], [8, 9], [9, 9], [1, 7]] as const) {
    expect(barLen(bar(f, t, f < t ? 'active' : null, w))).toBe(w)
  }
})

test('bar: blocked current is a warning; nothing done leaves no done span; complete is all done', () => {
  expect(bar(3, 5, 'blocked', 50).currentColor).toBe('warning')
  const fresh = bar(0, 6, 'active', 44)
  expect(fresh.done).toBe('')
  expect(fresh.current.length).toBe(7)
  expect(barLen(fresh)).toBe(44)
  expect(bar(6, 6, null, 30)).toEqual({ done: '█'.repeat(30), current: '', currentColor: 'planMode', rest: '' })
  expect(bar(0, 0, null, 10).rest).toBe('░'.repeat(10))
  expect(bar(0, 200, 'active', 40).current.length).toBe(1)
})

test('wrapSummary: wraps on words to the width, at most maxLines lines (6 by default), the last cut with …', () => {
  expect(wrapSummary('one two three', 20)).toEqual(['one two three'])
  expect(wrapSummary('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc'])
  const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')
  const lines = wrapSummary(long, 30)
  expect(lines.length).toBe(6)
  expect(lines.every(l => Array.from(l).length <= 30)).toBe(true)
  expect(lines[5]!.endsWith('…')).toBe(true)
  const four = wrapSummary(long, 30, 4)
  expect(four.length).toBe(4)
  expect(four.slice(0, 3)).toEqual(lines.slice(0, 3))
  expect(four[3]!.endsWith('…')).toBe(true)
  expect(wrapSummary(long, 30, 1)).toHaveLength(1)
  expect(wrapSummary('x'.repeat(25), 10)).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)])
  expect(wrapSummary('  spaced\n\nout   text ', 40)).toEqual(['spaced out text'])
  expect(wrapSummary('', 40)).toEqual([])
})

test('homePath: $HOME → ~, else a /Users/<x>/ or /home/<x>/ prefix', () => {
  expect(homePath('/Users/me/.claude/plans/a.md', '/Users/me')).toBe('~/.claude/plans/a.md')
  expect(homePath('/Users/me/.claude/plans/a.md', '/Users/me/')).toBe('~/.claude/plans/a.md')
  expect(homePath('/srv/plans/a.md', '/Users/me')).toBe('/srv/plans/a.md')
  expect(homePath('/Users/meow/a.md', '/Users/me')).toBe('/Users/meow/a.md')
  expect(homePath('/Users/me/a.md')).toBe('~/a.md')
  expect(homePath('/home/t/.claude/plans/a.md')).toBe('~/.claude/plans/a.md')
  expect(homePath('/srv/a.md')).toBe('/srv/a.md')
})

test('resolveRef: tracked PR label/id/url → its link; other URLs link; plain refs do not', () => {
  const rows: PrRow[] = [{ glyph: '○', label: '#1', repoName: 'r', branch: 'b', status: 'draft', color: 'subtle', url: 'https://github.com/a/r/pull/1', id: 'github.com/a/r#1' }]
  expect(resolveRef('#1', rows)).toEqual({ text: '#1', href: 'https://github.com/a/r/pull/1' })
  expect(resolveRef('github.com/a/r#1', rows)).toEqual({ text: '#1', href: 'https://github.com/a/r/pull/1' })
  expect(resolveRef('https://gitlab.com/x/y/-/merge_requests/6677', rows)).toEqual({ text: '!6677', href: 'https://gitlab.com/x/y/-/merge_requests/6677' })
  expect(resolveRef('#9', rows)).toEqual({ text: '#9', href: null })
})

test('bandText: normal, with PRs, blocked, complete, planning, zero steps', () => {
  expect(bandText(snap(NINE), 0)).toBe('⚑ WP2 of 9 · 2 done')
  expect(bandText(snap(NINE), 1)).toBe('⚑ WP2 of 9 · 2 done · 1 PR needs you')
  expect(bandText(snap(NINE), 2)).toBe('⚑ WP2 of 9 · 2 done · 2 PRs need you')
  const blocked = snap(['done', 'done', 'done', 'blocked', 'pending'])
  expect(bandText(blocked, 0)).toBe('⚑ WP3 of 5 blocked on you · 3 done')
  expect(bandText(snap(['done', 'done', 'skipped']), 0)).toBe('⚑ plan complete · 3/3')
  expect(bandText(null, 0)).toBe('⚑ planning…')
  expect(bandText(snap([]), 0)).toBe('⚑ no steps found')
})

test('buildBandModel colours a blocked plan as a warning', () => {
  expect(buildBandModel(snap(NINE), NO_PRS).color).toBe('planMode')
  expect(buildBandModel(snap(['done', 'blocked']), NO_PRS).color).toBe('warning')
})

test('bandQuiet: survey, option off, placed pane, nothing tracked', () => {
  const base = { hasSurvey: false, bandOn: true, tracked: true, inPlanMode: false, isPlaced: false, handoff: false }
  expect(bandQuiet(base)).toBe(false)
  expect(bandQuiet({ ...base, hasSurvey: true })).toBe(true)
  expect(bandQuiet({ ...base, bandOn: false })).toBe(true)
  expect(bandQuiet({ ...base, isPlaced: true })).toBe(true)
  expect(bandQuiet({ ...base, tracked: false })).toBe(true)
  expect(bandQuiet({ ...base, tracked: false, inPlanMode: true })).toBe(false)
})

test('bandQuiet + band: a handoff with nothing tracked shows the band; survey, option off and a placed pane still quiet it', () => {
  const none = { hasSurvey: false, bandOn: true, tracked: false, inPlanMode: false, isPlaced: false, handoff: true }
  expect(bandQuiet(none)).toBe(false)
  expect(bandQuiet({ ...none, hasSurvey: true })).toBe(true)
  expect(bandQuiet({ ...none, bandOn: false })).toBe(true)
  expect(bandQuiet({ ...none, isPlaced: true })).toBe(true)
  const ho: Handoff = { summary: 's', items: [{ kind: 'decision', title: 'a', blocking: true }, { kind: 'action', title: 'b', blocking: false }], at: NOW, sessionId: 'S' }
  expect(buildBandModel(null, NO_PRS, ho)).toEqual({ text: '⚑ waiting on you (2)', color: 'warning' })
})

test('handoffBandText counts skipped steps as finished in every branch', () => {
  const ho: Handoff = { summary: 's', items: [], at: NOW, sessionId: 'S' }
  expect(buildBandModel(snap(['done', 'skipped', 'active', 'pending']), NO_PRS, ho).text).toBe('⚑ waiting on you (0) · WP2 of 4 · 2 done')
  expect(buildBandModel(snap(['done', 'skipped']), NO_PRS, ho).text).toBe('⚑ waiting on you (0) · plan complete · 2/2')
})

test('handoff: band says waiting on you in warning; status says needs you; blocked keeps !', () => {
  const ho: Handoff = { summary: 's', items: [{ kind: 'decision', title: 'a', blocking: true }, { kind: 'action', title: 'b', blocking: false }], at: NOW, sessionId: 'S' }
  expect(buildBandModel(snap(NINE), NO_PRS, ho)).toEqual({ text: '⚑ waiting on you (2) · WP2 of 9 · 2 done', color: 'warning' })
  expect(buildBandModel(snap(NINE), NO_PRS, null).text).toBe('⚑ WP2 of 9 · 2 done')
  expect(statusText(snap(NINE), false, ho)).toBe('⚑ 2/9 WP2 · needs you')
  expect(statusText(snap(['done', 'done', 'done', 'blocked']), false, ho)).toBe('⚑ 3/4 WP3!')
  expect(statusText(snap(['done', 'done']), false, ho)).toBe('⚑ 2/2 · needs you')
})

test('statusText: normal, blocked, done, planning, nothing', () => {
  expect(statusText(snap(NINE), false)).toBe('⚑ 2/9 WP2')
  expect(statusText(snap(['done', 'done', 'done', 'blocked']), false)).toBe('⚑ 3/4 WP3!')
  expect(statusText(snap(['done', 'done']), false)).toBe('⚑ 2/2 ✓')
  expect(statusText(null, true)).toBe('⚑ planning')
  expect(statusText(null, false)).toBe(undefined)
})

test('statusText with a handoff: nothing tracked → needs you; zero steps → no steps · needs you; planning unchanged', () => {
  const ho: Handoff = { summary: 's', items: [], at: NOW, sessionId: 'S' }
  expect(statusText(null, false, ho)).toBe('⚑ needs you')
  expect(statusText(null, true, ho)).toBe('⚑ planning')
  expect(statusText(snap([]), false, ho)).toBe('⚑ no steps · needs you')
  expect(statusText(snap([]), false, null)).toBe('⚑ no steps')
})

test('fitSteps(9, current=2, rows=5, wide): keeps current, collapses done, ends +n more', () => {
  const rows = fitSteps(snap(NINE).steps, 2, 5, 'wide')
  expect(rows.length).toBe(5)
  expect(kinds(rows)).toEqual(['done-summary', 'step', 'step', 'step', 'more'])
  expect(rows[0]).toEqual({ kind: 'done-summary', count: 2, shorts: ['WP0', 'WP1'] })
  const cur = rows.find(r => r.kind === 'step' && r.isCurrent)
  expect(cur?.kind === 'step' ? cur.step.short : '').toBe('WP2')
  expect(rows[4]).toEqual({ kind: 'more', count: 4, position: 'after' })
})

test('fitSteps compact: the trailing more row shares the last step line', () => {
  const rows = fitSteps(snap(NINE).steps, 2, 5, 'compact')
  expect(kinds(rows)).toEqual(['done-summary', 'step', 'step', 'step', 'step', 'more'])
  expect(rows.filter(r => r.kind !== 'more').length).toBe(5)
  expect(rows[5]).toEqual({ kind: 'more', count: 3, position: 'after' })
})

test('fitSteps: everything that fits is listed, done steps included', () => {
  const rows = fitSteps(snap(NINE).steps, 2, 12, 'wide')
  expect(rows.length).toBe(9)
  expect(rows.every(r => r.kind === 'step')).toBe(true)
})

test('fitSteps: a late current step stays visible behind an "earlier" row', () => {
  const statuses: StepStatus[] = ['done', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending', 'active', 'pending']
  const rows = fitSteps(snap(statuses).steps, 7, 4, 'wide')
  expect(rows.length <= 4).toBe(true)
  expect(rows.some(r => r.kind === 'step' && r.isCurrent && r.step.short === 'WP7')).toBe(true)
  expect(rows[0]).toEqual({ kind: 'more', count: 6, position: 'before' })
})

test('fitSteps wide: children row follows the current step only', () => {
  const s = snap(NINE)
  const kids: SubItem[] = [
    { text: 'drop the field', status: 'done', line: 1 },
    { text: 'fix the spec', status: 'pending', line: 2 },
  ]
  s.steps[2] = step(2, 'active', kids)
  const wide = fitSteps(s.steps, 2, 12, 'wide')
  expect(kinds(wide).indexOf('children')).toBe(3)
  expect(fitSteps(s.steps, 2, 12, 'compact').some(r => r.kind === 'children')).toBe(false)
})

test('chooseLayout thresholds', () => {
  expect(chooseLayout('auto', 43, 'dock')).toBe('compact')
  expect(chooseLayout('auto', 44, 'dock')).toBe('wide')
  expect(isNarrow(chooseLayout('auto', 44, 'dock'), 44)).toBe(true)
  expect(chooseLayout('auto', 63, 'dock')).toBe('wide')
  expect(isNarrow('wide', 63)).toBe(true)
  expect(chooseLayout('auto', 64, 'dock')).toBe('wide')
  expect(isNarrow('wide', 64)).toBe(false)
  expect(isNarrow('compact', 48)).toBe(false)
  expect(chooseLayout('auto', 48, 'inline')).toBe('compact')
  expect(chooseLayout('auto', 120, 'inline')).toBe('compact')
  expect(chooseLayout('auto', 120, undefined)).toBe('wide')
  expect(chooseLayout('wide', 40, 'inline')).toBe('wide')
  expect(chooseLayout('compact', 200, 'dock')).toBe('compact')
})

test('headerLine: narrow vs wide progress, title cut to fit', () => {
  const s = snap(NINE)
  expect(headerLine(s, 44).right).toBe('2/9 22%')
  expect(headerLine(s, 90).right).toBe('WP2 · 2 of 9 · 22%')
  expect(headerLine(s, 90).pct).toBe('22%')
  expect(headerLine(snap(['done', 'skipped']), 90).right).toBe('done · 2 of 2 · 100%')
  const h = headerLine({ ...s, displayTitle: 'x'.repeat(100) }, 44)
  expect(Array.from(h.title).length + h.right.length + 2 <= 44).toBe(true)
  expect(h.title.endsWith('…')).toBe(true)
})

test('buildPaneModel plan (wide): header, bar, footer, step rows within budget', () => {
  const m = buildPaneModel(input())
  expect(m.kind).toBe('plan')
  if (m.kind !== 'plan') return
  expect(m.layout).toBe('wide')
  expect(m.header.right).toBe('WP2 · 2 of 9 · 22%')
  expect(barLen(m.bar)).toBe(90)
  expect(m.rows.length).toBe(9)
  expect(m.shortWidth).toBe(3)
  expect(m.prSection).toBe(null)
  expect(m.handoff).toBe(null)
  expect(m.footer).toEqual({ path: '~/.claude/plans/noble-tulip.md', changedAgo: '1m ago', error: null })
  const homed = buildPaneModel(input({ home: '/Users/other' }))
  expect(homed.kind === 'plan' && homed.footer.path).toBe(TRACKED.path)
})

test('buildPaneModel plan (inline compact): capped at 8 rows, one PR line', () => {
  const entry = { id: 'gitlab:x/y!6402', attention: 'fix-ci' } as unknown as PrEntry
  const quiet = { id: 'github:a/b#31', attention: null } as unknown as PrEntry
  const prRows: PrRow[] = [
    { glyph: '·', label: '#31', repoName: 'b', branch: 'feat', status: 'awaiting review', color: 'subtle', url: 'https://x/31', id: quiet.id },
    { glyph: '!', label: '!6402', repoName: 'y', branch: 'wp7', status: 'pipeline failed', color: 'error', url: 'https://x/6402', id: entry.id, stepId: 'wp4-title-4' },
  ]
  const m = buildPaneModel(input({ placement: 'inline', bodyColumns: 44, rows: 30, prs: { entries: [entry, quiet], lastPolledAt: NOW, note: '' }, prRows }))
  if (m.kind !== 'plan') throw new Error(m.kind)
  expect(m.layout).toBe('compact')
  const lines = 2 + m.rows.filter(r => !(r.kind === 'more' && r.position === 'after')).length + 1
  expect(lines).toBe(8)
  expect(m.prSection?.count).toBe(1)
  expect(m.prSection?.rows.map(r => [r.label, r.stepShort])).toEqual([['!6402', 'WP4']])
})

test('buildPaneModel PR section (wide): attention first, other open PRs after, merged/closed hidden, polled + note', () => {
  const e = (id: string, attention: string | null, state = 'open') => ({ id, attention, state }) as unknown as PrEntry
  const row = (id: string): PrRow => ({ glyph: '○', label: id, repoName: 'r', branch: 'b', status: 's', color: 'subtle', url: `https://x/${id}`, id })
  const entries = [e('#1', null), e('#2', 'fix-ci'), e('#3', null, 'merged'), e('#4', null, 'closed'), e('#5', 'address-review')]
  const prs: PrsView = { entries, lastPolledAt: NOW - 120_000, note: 'gh not logged in — run gh auth login' }
  const m = buildPaneModel(input({ rows: 40, prs, prRows: entries.map(x => row(x.id)) }))
  if (m.kind !== 'plan') throw new Error(m.kind)
  expect(m.prSection).toEqual({
    count: 2,
    open: 3,
    head: { before: ' · ', need: '2 need you', hot: true, after: ' · 1 other · polled 2m ago' },
    rows: [expect.objectContaining({ id: '#2' }), expect.objectContaining({ id: '#5' })],
    others: [expect.objectContaining({ id: '#1' })],
    polled: '2m ago',
    note: 'gh not logged in — run gh auth login',
    compact: false,
  })
  const many = Array.from({ length: 8 }, (_, i) => e(`#${i + 10}`, i % 2 ? 'fix-ci' : null))
  const capped = buildPaneModel(input({ rows: 40, prs: { ...prs, entries: many }, prRows: many.map(x => row(x.id)) }))
  if (capped.kind !== 'plan') throw new Error(capped.kind)
  expect(capped.prSection!.rows.length + capped.prSection!.others.length).toBe(MAX_PR_ROWS)
  expect(capped.prSection!.rows.map(r => r.id)).toEqual(['#11', '#13', '#15', '#17'])
  const closedOnly = [e('#3', null, 'merged')]
  const none = buildPaneModel(input({ prs: { ...prs, entries: closedOnly }, prRows: closedOnly.map(x => row(x.id)) }))
  if (none.kind !== 'plan') throw new Error(none.kind)
  expect(none.prSection).toBe(null)
})

test('buildPaneModel none-tracked: up to 5 recent plans, newest first', () => {
  const recent = [1, 2, 3, 4, 5, 6].map(i => ({ name: `plan-${i}`, path: `/p/plan-${i}.md`, mtimeMs: NOW - i * 3_600_000 }))
  const m = buildPaneModel(input({ tracked: null, snap: null, recent: [...recent].reverse() }))
  if (m.kind !== 'none-tracked') throw new Error(m.kind)
  expect(m.recent.length).toBe(5)
  expect(m.recent[0]).toEqual({ name: 'plan-1', path: '/p/plan-1.md', ago: '1h ago' })
  expect(m.planDir).toBe('~/.claude/plans')
  const custom = buildPaneModel(input({ tracked: null, snap: null, planDir: '~/work/plans' }))
  expect(custom.kind === 'none-tracked' && custom.planDir).toBe('~/work/plans')
})

test('buildPaneModel planning: in plan mode with nothing tracked, or tracked before the file exists', () => {
  expect(buildPaneModel(input({ tracked: null, snap: null, ui: { ...UI, inPlanMode: true } })).kind).toBe('planning')
  expect(buildPaneModel(input({ snap: null, tracked: { ...TRACKED, source: 'plan_mode' } })).kind).toBe('planning')
})

test('buildPaneModel missing keeps the path and the last counts', () => {
  const m = buildPaneModel(input({ tracked: { ...TRACKED, missing: true } }))
  expect(m).toEqual({ kind: 'missing', path: TRACKED.path, lastCounts: snap(NINE).counts, handoffLine: null })
})

test('buildPaneModel no-steps', () => {
  const m = buildPaneModel(input({ snap: snap([], { mode: 'none' }) }))
  expect(m).toEqual({ kind: 'no-steps', title: 'ECFX-18104 — re-baseline schema.sql', path: TRACKED.path, handoffLine: null })
})

test('buildPaneModel: every non-plan state carries the compact handoff line', () => {
  const ho: Handoff = { summary: 'Line one of the summary.\nLine two.', items: [], at: NOW, sessionId: 'S' }
  const two: Handoff = { ...ho, items: [{ kind: 'decision', title: 'Merge?', blocking: true }, { kind: 'action', title: 'Look', blocking: false }] }
  const states: PaneInput[] = [
    input({ tracked: null, snap: null }),
    input({ tracked: null, snap: null, ui: { ...UI, inPlanMode: true } }),
    input({ tracked: { ...TRACKED, missing: true } }),
    input({ snap: snap([], { mode: 'none' }) }),
  ]
  for (const st of states) {
    const m = buildPaneModel({ ...st, handoff: two })
    if (m.kind === 'plan') throw new Error('plan')
    expect(m.handoffLine).toBe('! waiting on you · Merge? (+1)')
    const bare = buildPaneModel({ ...st, handoff: ho })
    expect(bare.kind !== 'plan' && bare.handoffLine).toBe('! waiting on you · Line one of the summary. Line two.')
    const none = buildPaneModel(st)
    expect(none.kind !== 'plan' && none.handoffLine).toBe(null)
  }
})

test('buildPaneModel: a handoff from another session is marked fromEarlier', () => {
  const ho: Handoff = { summary: 's', items: [], at: NOW, sessionId: 'OLD' }
  const other = buildPaneModel(input({ handoff: ho, sessionId: 'S1' }))
  expect(other.kind === 'plan' && other.handoff!.fromEarlier).toBe(true)
  const same = buildPaneModel(input({ handoff: ho, sessionId: 'OLD' }))
  expect(same.kind === 'plan' && same.handoff!.fromEarlier).toBe(false)
  const unknown = buildPaneModel(input({ handoff: ho }))
  expect(unknown.kind === 'plan' && unknown.handoff!.fromEarlier).toBe(false)
})

test('shorten cuts with an ellipsis and leaves short strings alone', () => {
  expect(shorten('hello', 10)).toBe('hello')
  expect(shorten('hello world', 6)).toBe('hello…')
  expect(shorten('abc', 1)).toBe('…')
  expect(shorten('abc', 0)).toBe('')
})

test('fmtAgo: seconds, minutes, hours, days; never negative', () => {
  expect(fmtAgo(NOW, NOW - 12_000)).toBe('12s ago')
  expect(fmtAgo(NOW, NOW - 5 * 60_000)).toBe('5m ago')
  expect(fmtAgo(NOW, NOW - 2 * 3_600_000)).toBe('2h ago')
  expect(fmtAgo(NOW, NOW - 3 * 86_400_000)).toBe('3d ago')
  expect(fmtAgo(NOW, NOW + 5000)).toBe('0s ago')
})

const HANDOFF: Handoff = {
  summary:
    'PR #1 is verified: 150 tests, strict validation, CI green on fba106a. Next: look at the pane, then mark #1 ready and merge. After the merge I tag waypoint--v0.1.0 and publish the marketplace entry for everyone.',
  items: [
    { kind: 'decision', title: 'Mark PR #1 ready and merge?', ref: '#1', blocking: true },
    { kind: 'action', title: 'Say how the pane looks on screen', blocking: false },
  ],
  at: NOW - 12 * 60_000,
  sessionId: 'S1',
}

test('buildPaneModel handoff (wide): ago, summary wrapped to width − 2 in ≤ 6 lines, items with refs', () => {
  const e = { id: 'github.com/a/r#1', attention: null, state: 'open' } as unknown as PrEntry
  const prRows: PrRow[] = [{ glyph: '○', label: '#1', repoName: 'r', branch: 'b', status: 'draft', color: 'subtle', url: 'https://github.com/a/r/pull/1', id: e.id, title: 'feat: x' }]
  const m = buildPaneModel(input({ handoff: HANDOFF, prs: { entries: [e], lastPolledAt: NOW - 3000, note: '' }, prRows }))
  if (m.kind !== 'plan') throw new Error(m.kind)
  const h = m.handoff!
  expect(h.ago).toBe('12m ago')
  expect(h.summary.length <= 6 && h.summary.length >= 2).toBe(true)
  expect(h.summary.every(l => Array.from(l).length <= 88)).toBe(true)
  expect(h.items[0]).toEqual({ blocking: true, kind: 'decision', title: 'Mark PR #1 ready and merge?', ref: { text: '#1', href: 'https://github.com/a/r/pull/1' } })
  expect(h.items[1]!.kind).toBe('action  ')
  expect(h.items[1]!.ref).toBe(null)
  expect(h.line).toBe('! waiting on you · Mark PR #1 ready and merge? (+1)')
  expect(m.prSection!.head).toEqual({ before: ' · 1 open · ', need: 'none need you', hot: false, after: ' · polled 3s ago' })
})

test('buildPaneModel summary at 76 columns: 6 lines with a generous budget, fewer when rows are tight, the cut line keeps …', () => {
  const long: Handoff = { ...HANDOFF, summary: Array.from({ length: 4 }, () => HANDOFF.summary).join(' ') }
  const roomy = buildPaneModel(input({ bodyColumns: 76, rows: 60, handoff: long }))
  if (roomy.kind !== 'plan') throw new Error(roomy.kind)
  expect(roomy.layout).toBe('wide')
  expect(roomy.handoff!.summary.length).toBe(6)
  expect(roomy.handoff!.summary.every(l => Array.from(l).length <= 74)).toBe(true)
  expect(roomy.handoff!.summary[5]!.endsWith('…')).toBe(true)
  const short = buildPaneModel(input({ bodyColumns: 76, rows: 60, handoff: { ...HANDOFF, summary: 'Two words.' } }))
  if (short.kind !== 'plan') throw new Error(short.kind)
  expect(short.handoff!.summary).toEqual(['Two words.'])
  for (let rows = 12; rows <= 20; rows++) {
    const m = buildPaneModel(input({ bodyColumns: 76, rows, handoff: long }))
    if (m.kind !== 'plan') throw new Error(m.kind)
    if (m.handoff!.compact) continue
    const n = m.handoff!.summary.length
    expect({ rows, ok: n >= 1 && n <= 6 && paneRows(m) <= rows }).toEqual({ rows, ok: true })
    expect({ rows, cut: m.handoff!.summary[n - 1]!.endsWith('…') }).toEqual({ rows, cut: true })
  }
  const tight = buildPaneModel(input({ bodyColumns: 76, rows: 14, handoff: long }))
  if (tight.kind !== 'plan') throw new Error(tight.kind)
  expect(tight.handoff!.summary.length <= 4).toBe(true)
})

test('buildPaneModel row budget: handoff and PRs keep their rows, steps shrink, current stays', () => {
  const many: Handoff = { ...HANDOFF, items: Array.from({ length: 8 }, (_, i) => ({ kind: 'action' as const, title: `do ${i}`, blocking: false })) }
  const m = buildPaneModel(input({ rows: 20, handoff: many }))
  if (m.kind !== 'plan') throw new Error(m.kind)
  expect(m.handoff!.items.length).toBe(5)
  expect(m.handoff!.more).toBe(3)
  const cost = 5 + 2 + m.handoff!.summary.length + 5 + 1
  const stepLines = m.rows.length
  expect(cost + stepLines <= 20).toBe(true)
  expect(m.rows.some(r => r.kind === 'step' && r.isCurrent)).toBe(true)
  const tight = buildPaneModel(input({ rows: 12, handoff: many }))
  if (tight.kind !== 'plan') throw new Error(tight.kind)
  expect(tight.rows.filter(r => r.kind !== 'more').length >= 1).toBe(true)
  expect(tight.handoff!.summary.length).toBe(1)
  const compact = buildPaneModel(input({ placement: 'inline', bodyColumns: 44, rows: 30, handoff: many }))
  if (compact.kind !== 'plan') throw new Error(compact.kind)
  expect(compact.layout).toBe('compact')
  const lines = 2 + compact.rows.filter(r => !(r.kind === 'more' && r.position === 'after')).length + 1
  expect(lines).toBe(8)
  expect(compact.handoff!.line).toBe('! waiting on you · do 0 (+7)')
})

test('fitSteps never exceeds its rows; one row is the current step alone, without children', () => {
  const s = snap(NINE)
  s.steps[2] = step(2, 'active', [{ text: 'kid', status: 'pending', line: 1 }])
  for (const layout of ['wide', 'compact'] as const) {
    for (let r = 1; r <= 12; r++) {
      const rows = fitSteps(s.steps, 2, r, layout)
      const drawn = rows.filter((x, i) => layout === 'wide' || !(x.kind === 'more' && x.position === 'after' && rows[i - 1]?.kind === 'step')).length
      expect({ r, layout, ok: drawn <= r }).toEqual({ r, layout, ok: true })
      expect(rows.some(x => x.kind === 'step' && x.isCurrent)).toBe(true)
    }
  }
  expect(fitSteps(s.steps, 2, 1, 'wide')).toEqual([{ kind: 'step', step: s.steps[2], isCurrent: true }])
  expect(kinds(fitSteps(s.steps, 2, 2, 'wide'))).toEqual(['step', 'more'])
  expect(fitSteps(s.steps, 2, 3, 'wide').some(x => x.kind === 'children')).toBe(false)
})

test('wide dock, budgets 10..30: model rows ≤ budget; sections degrade gaps → +n more → handoff line → PR line', () => {
  const s = snap(NINE)
  s.steps[2] = step(2, 'active', [{ text: 'a', status: 'done', line: 1 }, { text: 'b', status: 'pending', line: 2 }])
  const ho: Handoff = { ...HANDOFF, summary: `${HANDOFF.summary} ${HANDOFF.summary}`.slice(0, 230) }
  const e = { id: 'github.com/a/r#1', attention: 'fix-ci', state: 'open' } as unknown as PrEntry
  const prRows: PrRow[] = [{ glyph: '✗', label: '#1', repoName: 'r', branch: 'b', status: 'ci failed', color: 'error', url: 'https://github.com/a/r/pull/1', id: e.id }]
  const base = input({ snap: s, handoff: ho, prs: { entries: [e], lastPolledAt: NOW, note: 'gh rate-limited' }, prRows })
  const full = buildPaneModel({ ...base, rows: 40 })
  if (full.kind !== 'plan') throw new Error(full.kind)
  expect(full.handoff!.summary.length).toBe(3)
  expect(full.handoff!.items.length).toBe(2)
  const seen = new Set<string>()
  for (let rows = 10; rows <= 30; rows++) {
    const m = buildPaneModel({ ...base, rows })
    if (m.kind !== 'plan') throw new Error(m.kind)
    expect({ rows, n: paneRows(m) <= rows }).toEqual({ rows, n: true })
    expect(m.rows.some(r => r.kind === 'step' && r.isCurrent)).toBe(true)
    expect(m.handoff).not.toBe(null)
    expect(m.prSection).not.toBe(null)
    seen.add(`${m.gaps}/${m.handoff!.compact}/${m.prSection!.compact}`)
  }
  expect(seen.has('true/false/false')).toBe(true)
  expect(seen.has('false/false/false')).toBe(true)
  const ten = buildPaneModel({ ...base, rows: 10 })
  if (ten.kind !== 'plan') throw new Error(ten.kind)
  expect([ten.gaps, ten.handoff!.compact, ten.prSection!.compact]).toEqual([false, true, false])
  const nine = buildPaneModel({ ...base, rows: 9 })
  if (nine.kind !== 'plan') throw new Error(nine.kind)
  expect([nine.gaps, nine.handoff!.compact, nine.prSection!.compact]).toEqual([false, true, true])
  expect(paneRows(nine)).toBe(9)
  for (let rows = 6; rows <= 9; rows++) {
    const m = buildPaneModel({ ...base, rows })
    expect({ rows, n: paneRows(m) <= Math.max(rows, 7) }).toEqual({ rows, n: true })
  }
})

test('paneRows counts the non-plan states with their handoff line', () => {
  const ho: Handoff = { summary: 's', items: [], at: NOW, sessionId: 'S' }
  expect(paneRows(buildPaneModel(input({ tracked: null, snap: null })))).toBe(2)
  expect(paneRows(buildPaneModel(input({ tracked: null, snap: null, handoff: ho })))).toBe(3)
  expect(paneRows(buildPaneModel(input({ snap: snap([], { mode: 'none' }), handoff: ho })))).toBe(4)
})

test('ruleTail: one space then ─ to exactly the width; empty when there is no room', () => {
  const head = '── Pull requests · 1 open · none need you'
  expect(Array.from(head + ruleTail(head, 92)).length).toBe(92)
  expect(ruleTail(head, 92).startsWith(' ─')).toBe(true)
  expect(ruleTail(head, Array.from(head).length + 1)).toBe('')
  expect(ruleTail('x'.repeat(100), 92)).toBe('')
})

test('childLinesCost: one row per child up to 8, then one +n more row', () => {
  expect([0, 1, 6, 8, 9, 20].map(childLinesCost)).toEqual([0, 1, 6, 8, 9, 9])
})

test('children: one per line at budget 30 (9 steps, 6 children); one inline row at a tight budget; counted in paneRows', () => {
  const s = snap(NINE)
  const kids: SubItem[] = Array.from({ length: 6 }, (_, i) => ({ text: `child ${i}`, status: i < 2 ? 'done' : 'pending', line: i + 1 }))
  s.steps[2] = step(2, 'active', kids)
  const roomy = buildPaneModel(input({ snap: s, rows: 30 }))
  if (roomy.kind !== 'plan') throw new Error(roomy.kind)
  const k = roomy.rows.find(r => r.kind === 'children')
  expect(k).toEqual({ kind: 'children', items: kids, perLine: true })
  expect(roomy.rows.filter(r => r.kind === 'step').length).toBe(9)
  // header 2 + gap + 9 steps + 6 children + gap + footer rule + footer
  expect(paneRows(roomy)).toBe(2 + 1 + 9 + 6 + 3)
  const tight = buildPaneModel(input({ snap: s, rows: 12 }))
  if (tight.kind !== 'plan') throw new Error(tight.kind)
  expect(tight.rows.find(r => r.kind === 'children')).toEqual({ kind: 'children', items: kids, perLine: false })
  expect(tight.gaps).toBe(true)
  expect(paneRows(tight) <= 12).toBe(true)
  // Over 8 children: 8 rows and a `+n more` row.
  const many: SubItem[] = Array.from({ length: 11 }, (_, i) => ({ text: `c${i}`, status: 'pending', line: i + 1 }))
  s.steps[2] = step(2, 'active', many)
  const big = buildPaneModel(input({ snap: s, rows: 40 }))
  if (big.kind !== 'plan') throw new Error(big.kind)
  expect(paneRows(big)).toBe(2 + 1 + 9 + 9 + 3)
  expect(fitSteps(s.steps, 2, 10, 'wide', true).some(r => r.kind === 'children' && !r.perLine)).toBe(true)
  expect(fitSteps(s.steps, 2, 18, 'wide', true).some(r => r.kind === 'children' && r.perLine)).toBe(true)
})

test('footer rule: counted with the gaps, dropped with them', () => {
  const m = buildPaneModel(input({ rows: 40 }))
  if (m.kind !== 'plan') throw new Error(m.kind)
  expect(m.gaps).toBe(true)
  expect(paneRows(m)).toBe(2 + 1 + 9 + 3)
  expect(paneRows({ ...m, gaps: false })).toBe(2 + 9 + 1)
})

test('narrow (44–63 columns): header `WP2 · 2/9 · 22%`; PR head drops `none need you` and `n other`, then `polled` when the rule would not fit', () => {
  const s = snap(NINE)
  expect(headerLine(s, 48, true).right).toBe('WP2 · 2/9 · 22%')
  expect(headerLine(snap(['done', 'done']), 48, true).right).toBe('done · 2/2 · 100%')
  expect(narrowPrHead(0, 1, ' · polled 3s ago', 48)).toEqual({ before: ' · 1 open', need: '', hot: false, after: ' · polled 3s ago' })
  expect(narrowPrHead(2, 3, ' · polled 3s ago', 48)).toEqual({ before: ' · ', need: '2 need you', hot: true, after: ' · polled 3s ago' })
  expect(narrowPrHead(12, 13, ' · polled 59m ago', 44).after).toBe('')
  const m = buildPaneModel(input({ bodyColumns: 48, rows: 40 }))
  if (m.kind !== 'plan') throw new Error(m.kind)
  expect([m.layout, m.narrow]).toEqual(['wide', true])
  // header 2 + gap + 9 steps + gap + footer rule + path row + hotkey row
  expect(paneRows(m)).toBe(2 + 1 + 9 + 4)
  const roomy = buildPaneModel(input({ bodyColumns: 64, rows: 40 }))
  expect(roomy.kind === 'plan' && roomy.narrow).toBe(false)
})

test('paneStatusLine: placement, drawn width and the width asked; not placed otherwise', () => {
  expect(paneStatusLine({ placement: 'dock', bodyColumns: 76 }, true, 48)).toBe('pane: dock · 76 columns (asked 48)')
  expect(paneStatusLine({ placement: 'inline', bodyColumns: 80 }, true, undefined)).toBe('pane: inline · 80 columns (asked engine share)')
  expect(paneStatusLine({ placement: 'dock', bodyColumns: 76 }, false, 48)).toBe('pane: not placed')
  expect(paneStatusLine(null, true, 48)).toBe('pane: not placed')
})
