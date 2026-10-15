import { test, expect } from 'claude-code/testing'
import {
  PLAN_STYLE_GUIDE,
  PLAN_STYLE_RULES,
  conformInstruction,
  findingsKey,
  lintPlan,
  lintText,
  writeNote,
  type LintReport,
} from '../hooks/style'
import { CHECKBOX_ONLY, MARKED_WP, NAUTILUS, NOBLE_TULIP, ORDERED_ONLY, PLATYPUS, SQUISHY, WAYPOINT_PLAN, ZERO_STEPS } from './fixtures'

const plan = (...lines: string[]): string => lines.join('\n') + '\n'
const codes = (r: LintReport): string[] => r.findings.map(f => f.code)
const find = (r: LintReport, code: string) => r.findings.find(f => f.code === code)

const GOOD = plan(
  '# Ship the widget',
  '',
  '## Context',
  'Why we are doing this.',
  '',
  '### Decisions',
  '- small widget',
  '',
  '## Steps',
  '',
  '### [x] WP1 — Bootstrap the repo',
  '- [x] repo created',
  '- PR: https://github.com/a/b/pull/1',
  '',
  '### [~] WP2 — Write the parser',
  '- [ ] headings',
  '',
  '### [ ] WP3 — Release',
  '',
  '## Verification',
  'Run the tests.',
)

test('style guide constants', () => {
  expect(PLAN_STYLE_GUIDE).toContain('    ### [ ] WP1 — <short imperative title, about 45 characters>')
  expect(PLAN_STYLE_GUIDE.startsWith('# Waypoint: plan style\n')).toBe(true)
  expect(PLAN_STYLE_RULES).not.toContain('\n')
  expect(PLAN_STYLE_RULES).toContain('### [ ] WPn — Title')
})

test('a conforming plan has no findings and says Looks fine', () => {
  const r = lintPlan(GOOD)
  expect(r).toEqual({
    mode: 'marked',
    steps: 3,
    headings: [
      { line: 11, title: 'Bootstrap the repo', marked: true },
      { line: 15, title: 'Write the parser', marked: true },
      { line: 18, title: 'Release', marked: true },
    ],
    findings: [],
  })
  expect(lintText(r, { title: 'Ship the widget', file: 'good.md' })).toBe('Ship the widget (good.md): 3 steps from markers\nLooks fine.')
  expect(writeNote(r, { file: 'good.md', kind: 'write', inPlanMode: true })).toBeUndefined()
})

test('the guide skeleton itself, filled in, lints clean (steps directly under ## Context)', () => {
  const body = PLAN_STYLE_GUIDE.split('\n')
    .filter(l => l.startsWith('    '))
    .map(l => l.slice(4))
    .join('\n')
    .replace('<What this plan delivers, in plain words>', 'Deliver it')
    .replace('<short imperative title, about 45 characters>', 'Do the first thing')
    .replace('### [ ] WP2 — ...', '### [ ] WP2 — Do the second thing')
  const r = lintPlan(body)
  expect(r.mode).toBe('marked')
  expect(r.steps).toBe(2)
  expect(r.findings).toEqual([])
})

test('empty plan: mode none, no-title and no-steps', () => {
  const r = lintPlan('')
  expect(r.mode).toBe('none')
  expect(r.steps).toBe(0)
  expect(codes(r).sort()).toEqual(['no-steps', 'no-title'])
  expect(lintPlan('   \n\n').mode).toBe('none')
})

test('no-steps', () => {
  const r = lintPlan(ZERO_STEPS)
  expect(r.mode).toBe('none')
  expect(codes(r)).toEqual(['no-steps'])
  expect(find(r, 'no-steps')?.severity).toBe('fix')
})

test('heuristic-steps names the mode', () => {
  const sections = lintPlan(plan('# T', '', '## Build it', '', '## Ship it'))
  expect(sections.mode).toBe('sections')
  expect(find(sections, 'heuristic-steps')?.message).toContain('`##` heading')
  const pattern = lintPlan(NAUTILUS)
  expect(pattern.mode).toBe('pattern')
  expect(find(pattern, 'heuristic-steps')?.message).toContain('`[ ]`')
  const boxes = lintPlan(CHECKBOX_ONLY)
  expect(boxes.mode).toBe('checkboxes')
  expect(find(boxes, 'heuristic-steps')?.message).toContain('checkboxes')
  expect(find(boxes, 'loose-checkboxes')).toBeUndefined()
  const ordered = lintPlan(ORDERED_ONLY)
  expect(ordered.mode).toBe('ordered')
  expect(find(ordered, 'heuristic-steps')?.message).toStartWith('Mode ordered:')
  expect(find(sections, 'heuristic-steps')?.message).toStartWith('Mode sections:')
  expect(find(pattern, 'heuristic-steps')?.message).toStartWith('Mode pattern:')
  expect(find(boxes, 'heuristic-steps')?.message).toStartWith('Mode checkboxes:')
  for (const r of [ordered, boxes]) for (const c of ['loose-checkboxes', 'unmarked-step', 'unnumbered']) expect(codes(r)).not.toContain(c)
})

test('loose-checkboxes: before the first step and under a closing section, not inside fences or steps', () => {
  const r = lintPlan(
    plan(
      '# T',
      '- [ ] stray before',
      '```',
      '- [ ] fenced, ignored',
      '```',
      '### [ ] WP1 — One',
      '- [ ] child',
      '## Verification',
      '  - [x] stray after',
    ),
  )
  const f = find(r, 'loose-checkboxes')
  expect(f?.line).toBe(2)
  expect(f?.message).toStartWith('2 checkbox lines')
  expect(f?.severity).toBe('fix')
})

test('mixed-depth', () => {
  const r = lintPlan(plan('# T', '## [ ] WP1 — One', '### [ ] WP2 — Two', '## [ ] WP3 — Three'))
  const f = find(r, 'mixed-depth')
  expect(f?.line).toBe(3)
  expect(f?.message).toContain('## and ###')
})

test('unmarked-step: one per heading, excluded names and prose sub-sections skipped', () => {
  const r = lintPlan(
    plan(
      '# T',
      '## Context',
      '### Background notes',
      '## Work',
      '### [ ] WP1 — One',
      '### Deploy to prod',
      '### [ ] WP2 — Two',
      '### Something else',
      '### Verification',
    ),
  )
  const fs = r.findings.filter(f => f.code === 'unmarked-step')
  expect(fs.map(f => f.line)).toEqual([6, 8])
  expect(fs[0]?.message).toBe('Add `[ ]` to "### Deploy to prod" or move it under a closing section.')
  expect(fs.every(f => f.severity === 'nit')).toBe(true)
  expect(fs.map(f => f.anchor)).toEqual(['Deploy to prod', 'Something else'])
})

test('unmarked-step: flagged under ## Context when the steps live there too', () => {
  const r = lintPlan(plan('# T', '## Context', 'why', '### [ ] WP1 — One', '### Stray work'))
  expect(r.findings.filter(f => f.code === 'unmarked-step').map(f => f.line)).toEqual([5])
})

test('no-title and title-prefix', () => {
  expect(codes(lintPlan(plan('### [ ] WP1 — One')))).toEqual(['no-title'])
  const r = lintPlan(plan('# PLAN: do it', '### [ ] WP1 — One'))
  expect(codes(r)).toEqual(['title-prefix'])
  expect(find(r, 'title-prefix')?.line).toBe(1)
  expect(find(r, 'title-prefix')?.severity).toBe('nit')
})

test('long-title counts the title after the marker and WP label', () => {
  const t45 = 'x'.repeat(45)
  const t46 = 'é'.repeat(46)
  const r = lintPlan(plan('# T', `### [ ] WP1 — ${t45}`, `### [ ] WP2 — ${t46}`))
  expect(r.findings.map(f => [f.code, f.line])).toEqual([['long-title', 3]])
  expect(find(r, 'long-title')?.message).toContain('46 characters')
})

test('many-children', () => {
  const kids = (n: number) => Array.from({ length: n }, (_, i) => `- [ ] k${i}`)
  const r = lintPlan(plan('# T', '### [ ] WP1 — Eight', ...kids(8), '### [ ] WP2 — Nine', ...kids(9)))
  expect(r.findings.map(f => [f.code, f.line])).toEqual([['many-children', 11]])
})

test('multiple-active', () => {
  const r = lintPlan(plan('# T', '### [~] WP1 — One', '### [~] WP2 — Two', '### [~] WP3 — Three'))
  expect(r.findings.map(f => [f.code, f.line])).toEqual([['multiple-active', 3]])
  expect(find(r, 'multiple-active')?.message).toStartWith('3 steps')
})

test('unnumbered, and any label (WP1, Step 1, 1., 1)) counts', () => {
  const r = lintPlan(plan('# T', '### [ ] Build it', '### [ ] Ship it'))
  expect(codes(r)).toEqual(['unnumbered'])
  for (const label of ['WP1 — ', 'Step 1 — ', '1. ', '1) '])
    expect(codes(lintPlan(plan('# T', `### [ ] ${label}Build it`, '### [ ] Ship it')))).toEqual([])
})

test('findings ordered by line, unlined first, stable', () => {
  const r = lintPlan(plan('## [ ] Alpha', '### [ ] Beta', '## Gamma', '## [~] Delta', '## [~] Epsilon'))
  const lines = r.findings.map(f => f.line ?? 0)
  expect([...lines].sort((a, b) => a - b)).toEqual(lines)
  expect(r.findings[0]?.line).toBeUndefined()
  expect(codes(r)).toContain('no-title')
  expect(codes(r)).toContain('unnumbered')
})

test('fixtures: modes', () => {
  expect(lintPlan(MARKED_WP).mode).toBe('marked')
  expect(lintPlan(WAYPOINT_PLAN).mode).toBe('marked')
  expect(lintPlan(NOBLE_TULIP).mode).toBe('pattern')
  expect(lintPlan(PLATYPUS).mode).toBe('pattern')
  expect(lintPlan(SQUISHY).mode).toBe('pattern')
  const m = lintPlan(MARKED_WP)
  expect(m.steps).toBe(6)
  expect(m.findings.filter(f => f.code === 'unmarked-step').map(f => f.line)).toEqual([28])
  expect(codes(m)).toContain('title-prefix')
  // `### Reuse` under `## Context` is prose, not an unmarked step
  expect(codes(lintPlan(WAYPOINT_PLAN))).not.toContain('unmarked-step')
})

test('lintText groups Fix and Nits and ends with the conform hint', () => {
  const r = lintPlan(MARKED_WP)
  const t = lintText(r, { title: 'ship the widget', file: 'a.md' })
  const lines = t.split('\n')
  expect(lines[0]).toBe('ship the widget (a.md): 6 steps from markers')
  expect(lines).not.toContain('Fix')
  expect(lines).toContain('Nits')
  expect(t).toContain('  line 28  unmarked-step     Add `[ ]` to "### WP3 — Unmarked sibling"')
  expect(lines[lines.length - 1]).toStartWith('Run /waypoint conform')
  const nitsOnly = lintText(lintPlan(plan('# Plan: x', '### [ ] WP1 — One')), { title: 'x', file: 'b.md' })
  expect(nitsOnly.split('\n')).not.toContain('Fix')
  const both = lintText(lintPlan(plan('## [ ] WP1 — One', '### [ ] WP2 — Two')), { title: 'x', file: 'c.md' }).split('\n')
  expect(both.indexOf('Fix')).toBeGreaterThan(0)
  expect(both.indexOf('Nits')).toBeGreaterThan(both.indexOf('Fix'))
})

test('writeNote: write shows all, edit shows fixes only, undefined when nothing to show', () => {
  const nitOnly = lintPlan(plan('# Plan: x', '### [ ] WP1 — One'))
  expect(writeNote(nitOnly, { file: 'p.md', kind: 'write', inPlanMode: true })).toContain('Drop the `Plan:` prefix')
  expect(writeNote(nitOnly, { file: 'p.md', kind: 'edit', inPlanMode: true })).toBeUndefined()
  const sections = lintPlan(plan('# T', '## Build it', '## Ship it', '## Tidy up', '## Announce', '## Rest'))
  const note = writeNote(sections, { file: 'p.md', kind: 'edit', inPlanMode: true }) ?? ''
  expect(note.split('\n')[0]).toBe('Waypoint read p.md after that edit: 5 steps from ## sections, none marked.')
  expect(note).toContain('Fix the shape now while the plan is in hand;')
  expect(writeNote(lintPlan(''), { file: 'p.md', kind: 'write', inPlanMode: true })?.split('\n')[0]).toBe('Waypoint read p.md after that write: 0 steps found.')
})

test('writeNote caps at 6 finding lines', () => {
  const r: LintReport = {
    mode: 'marked',
    steps: 9,
    headings: [],
    findings: Array.from({ length: 9 }, (_, i) => ({ code: 'long-title', severity: 'nit' as const, line: i + 1, message: `m${i}` })),
  }
  const lines = (writeNote(r, { file: 'p.md', kind: 'write', inPlanMode: true }) ?? '').split('\n')
  expect(lines.filter(l => l.startsWith('- '))).toHaveLength(6)
  expect(lines).toContain('- m0 (line 1)')
  expect(lines).toContain('… and 3 more')
})

test('conformInstruction: additive and rewrite', () => {
  const r = lintPlan(NAUTILUS)
  const add = conformInstruction(r, { path: '/home/u/.claude/plans/x.md', title: 'Raise coverage', rewrite: false })
  for (const s of ['/home/u/.claude/plans/x.md', 'Edit tool', 'never rewrite the file with Write', 'Keep every existing prose line and its order', 'Only add a marker to these existing step headings', 'leave every existing bullet exactly as it is', 'Do not change the title', 'at most one step `[~]`', '`[x]`', 'heuristic-steps', 'Show the diff', 'the pane re-reads the file by itself', '- line 9: Prove the proxy bug first (RED) (unmarked)'])
    expect(add).toContain(s)
  expect(add).not.toContain('Rewrite mode')
  const rw = conformInstruction(r, { path: '/p/x.md', title: 'T', rewrite: true })
  for (const s of ['/p/x.md', 'Edit tool', 'never rewrite the file with Write', 'Rewrite mode', 'one depth', 'Move checkbox lines', '`Plan:` prefix', 'never delete a line of prose', 'Show the diff', 'the pane re-reads the file by itself'])
    expect(rw).toContain(s)
  expect(rw).not.toContain('its order')
  expect(rw).not.toContain('Additive mode')
  expect(rw.split('\n').pop()).toContain('the pane re-reads the file by itself')
})

test('findingsKey: stable for equal reports, different when findings change', () => {
  expect(findingsKey(lintPlan(MARKED_WP))).toBe(findingsKey(lintPlan(MARKED_WP)))
  expect(findingsKey(lintPlan(GOOD))).toBe(findingsKey(lintPlan(GOOD + '\nMore prose.\n')))
  expect(findingsKey(lintPlan(MARKED_WP))).not.toBe(findingsKey(lintPlan(GOOD)))
  expect(findingsKey(lintPlan(plan('# T', '### [ ] Build it')))).not.toBe(findingsKey(lintPlan(plan('# T', '### [ ] WP1 Build it'))))
  expect(findingsKey(lintPlan(GOOD))).toMatch(/^[0-9a-f]{8}$/)
})

test('headings: the parser step list with line, title and marked', () => {
  const r = lintPlan(MARKED_WP)
  expect(r.headings).toHaveLength(r.steps)
  expect(r.headings[0]).toEqual({ line: 11, title: 'Bootstrap', marked: true })
  expect(r.headings[3]).toEqual({ line: 28, title: 'Unmarked sibling', marked: false })
  expect(lintPlan('').headings).toEqual([])
  expect(lintPlan(CHECKBOX_ONLY).headings.map(h => h.title)).toEqual(['milk', 'eggs', 'bread'])
})

test('findingsKey ignores line shifts (a - PR: line above a heading) but not new findings', () => {
  const base = plan('# Plan: x', '## Work', '### [ ] WP1 — One', '### Stray', '### [ ] WP2 — ' + 'y'.repeat(50))
  const shifted = base.replace('### Stray', '- PR: https://github.com/a/b/pull/1\n\n### Stray')
  expect(lintPlan(shifted).findings.map(f => f.line)).not.toEqual(lintPlan(base).findings.map(f => f.line))
  expect(findingsKey(lintPlan(shifted))).toBe(findingsKey(lintPlan(base)))
  expect(findingsKey(lintPlan(base.replace('### Stray', '### Other stray')))).not.toBe(findingsKey(lintPlan(base)))
  expect(lintPlan(base).findings.find(f => f.code === 'title-prefix')?.anchor).toBe('Plan: x')
})

test('writeNote: plan mode orders, outside plan mode points; both end with the rules, no plan-mode reminder', () => {
  const r = lintPlan(plan('# T', '## Build it', '## Ship it'))
  const inPlan = writeNote(r, { file: 'p.md', kind: 'write', inPlanMode: true }) ?? ''
  const outside = writeNote(r, { file: 'p.md', kind: 'write', inPlanMode: false }) ?? ''
  expect(inPlan).toContain('Fix the shape now while the plan is in hand')
  expect(outside).not.toContain('Fix the shape now')
  expect(outside).toContain('If this shape is intentional, ignore this note. /waypoint conform applies the guide without touching prose; /waypoint lint repeats this report.')
  for (const n of [inPlan, outside]) {
    expect(n).not.toContain('plan-mode reminder')
    expect(n.split('\n').pop()).toBe(PLAN_STYLE_RULES)
  }
})

test('conformInstruction: additive on guessed headings allows a ## Steps section instead; marked wording unchanged', () => {
  const guessed = conformInstruction(lintPlan(NAUTILUS), { path: '/p/n.md', title: 'N', rewrite: false })
  expect(guessed).toContain('or, if these headings are not units of work, leave them alone and add a `## Steps` section before any closing section whose `### [ ] WPn — Title` entries name the sections or paragraphs they execute.')
  const marked = conformInstruction(lintPlan(MARKED_WP), { path: '/p/m.md', title: 'M', rewrite: false })
  expect(marked).toContain('- Only add a marker to these existing step headings (the lines listed above); do not reword or move them.')
  expect(marked).not.toContain('not units of work')
})

test('conformInstruction: additive with no step headings asks for a ## Steps section', () => {
  const t = conformInstruction(lintPlan(ZERO_STEPS), { path: '/p/z.md', title: 'Notes', rewrite: false })
  expect(t).toContain('add a `## Steps` section before any closing section')
  expect(t).not.toContain('Only add a marker')
})

test('long-title only in marked mode; label with a suffix letter counts as numbered', () => {
  const long = 'z'.repeat(50)
  expect(codes(lintPlan(plan('# T', `## ${long}`, '## Other')))).not.toContain('long-title')
  for (const label of ['WP6b — ', 'Step 2a — ', 'Step 2a: '])
    expect(codes(lintPlan(plan('# T', `### [ ] ${label}Build it`, '### [ ] Ship it')))).not.toContain('unnumbered')
})
