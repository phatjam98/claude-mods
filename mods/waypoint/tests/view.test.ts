import { test, expect } from 'claude-code/testing'
import {
  bandQuiet,
  bandText,
  bar,
  buildBandModel,
  buildPaneModel,
  chooseLayout,
  fitSteps,
  fmtAgo,
  headerLine,
  shorten,
  statusText,
} from '../hooks/view'
import type { PaneInput, PrRow, Row } from '../hooks/view'
import type { PlanSnapshot, PrEntry, PrsView, Step, StepStatus, SubItem, Tracked, WaypointUi } from '../types'

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

test('bar(33, 24): 8 on, 16 off; clamps out-of-range input', () => {
  const b = bar(33, 24)
  expect(b.on).toBe('█'.repeat(8))
  expect(b.off).toBe('░'.repeat(16))
  expect(bar(150, 10).on.length).toBe(10)
  expect(bar(-5, 10).off.length).toBe(10)
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
  const base = { hasSurvey: false, bandOn: true, tracked: true, inPlanMode: false, isPlaced: false }
  expect(bandQuiet(base)).toBe(false)
  expect(bandQuiet({ ...base, hasSurvey: true })).toBe(true)
  expect(bandQuiet({ ...base, bandOn: false })).toBe(true)
  expect(bandQuiet({ ...base, isPlaced: true })).toBe(true)
  expect(bandQuiet({ ...base, tracked: false })).toBe(true)
  expect(bandQuiet({ ...base, tracked: false, inPlanMode: true })).toBe(false)
})

test('statusText: normal, blocked, done, planning, nothing', () => {
  expect(statusText(snap(NINE), false)).toBe('⚑ 2/9 WP2')
  expect(statusText(snap(['done', 'done', 'done', 'blocked']), false)).toBe('⚑ 3/4 WP3!')
  expect(statusText(snap(['done', 'done']), false)).toBe('⚑ 2/2 ✓')
  expect(statusText(null, true)).toBe('⚑ planning')
  expect(statusText(null, false)).toBe(undefined)
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
  expect(chooseLayout('auto', 59, 'dock')).toBe('compact')
  expect(chooseLayout('auto', 60, 'dock')).toBe('wide')
  expect(chooseLayout('auto', 120, 'inline')).toBe('compact')
  expect(chooseLayout('auto', 120, undefined)).toBe('wide')
  expect(chooseLayout('wide', 40, 'inline')).toBe('wide')
  expect(chooseLayout('compact', 200, 'dock')).toBe('compact')
})

test('headerLine: narrow vs wide progress, title cut to fit', () => {
  const s = snap(NINE)
  expect(headerLine(s, 44).right).toBe('2/9 22%')
  expect(headerLine(s, 90).right).toBe('2 of 9 · 22%')
  const h = headerLine({ ...s, displayTitle: 'x'.repeat(100) }, 44)
  expect(Array.from(h.title).length + h.right.length + 2 <= 44).toBe(true)
  expect(h.title.endsWith('…')).toBe(true)
})

test('buildPaneModel plan (wide): header, bar, footer, step rows within budget', () => {
  const m = buildPaneModel(input())
  expect(m.kind).toBe('plan')
  if (m.kind !== 'plan') return
  expect(m.layout).toBe('wide')
  expect(m.header.right).toBe('2 of 9 · 22%')
  expect(m.bar.on.length + m.bar.off.length).toBe(90)
  expect(m.rows.length).toBe(9)
  expect(m.prSection).toBe(null)
  expect(m.footer).toEqual({ path: TRACKED.path, readAgo: '12s ago', error: null })
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

test('buildPaneModel none-tracked: up to 5 recent plans, newest first', () => {
  const recent = [1, 2, 3, 4, 5, 6].map(i => ({ name: `plan-${i}`, path: `/p/plan-${i}.md`, mtimeMs: NOW - i * 3_600_000 }))
  const m = buildPaneModel(input({ tracked: null, snap: null, recent: [...recent].reverse() }))
  if (m.kind !== 'none-tracked') throw new Error(m.kind)
  expect(m.recent.length).toBe(5)
  expect(m.recent[0]).toEqual({ name: 'plan-1', path: '/p/plan-1.md', ago: '1h ago' })
})

test('buildPaneModel planning: in plan mode with nothing tracked, or tracked before the file exists', () => {
  expect(buildPaneModel(input({ tracked: null, snap: null, ui: { ...UI, inPlanMode: true } })).kind).toBe('planning')
  expect(buildPaneModel(input({ snap: null, tracked: { ...TRACKED, source: 'plan_mode' } })).kind).toBe('planning')
})

test('buildPaneModel missing keeps the path and the last counts', () => {
  const m = buildPaneModel(input({ tracked: { ...TRACKED, missing: true } }))
  expect(m).toEqual({ kind: 'missing', path: TRACKED.path, lastCounts: snap(NINE).counts })
})

test('buildPaneModel no-steps', () => {
  const m = buildPaneModel(input({ snap: snap([], { mode: 'none' }) }))
  expect(m).toEqual({ kind: 'no-steps', title: 'ECFX-18104 — re-baseline schema.sql', path: TRACKED.path })
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
