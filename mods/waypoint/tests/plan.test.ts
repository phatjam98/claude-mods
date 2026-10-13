import { test, expect } from 'claude-code/testing'
import { MAX_BYTES, cleanTitle, hashText, isNonStep, isStepLike, normalize, parsePlan, shortLabel } from '../hooks/plan'
import {
  CHECKBOX_ONLY,
  DUPLICATE_TITLES,
  MARKED_WP,
  NAUTILUS,
  NOBLE_TULIP,
  ORDERED_ONLY,
  PLATYPUS,
  SQUISHY,
  WAYPOINT_PLAN,
  ZERO_STEPS,
} from './fixtures'

const parse = (text: string, path = '/p/plan.md') => parsePlan(text, { path, mtimeMs: 1, now: 2 })

test('marked WP plan: statuses, counts, percent, currentIndex', () => {
  const p = parse(MARKED_WP)
  expect(p.mode).toBe('marked')
  expect(p.stepDepth).toBe(3)
  expect(p.steps.map(s => s.short)).toEqual(['WP0', 'WP1', 'WP2', 'WP3', 'WP4', 'WP5'])
  expect(p.steps.map(s => s.status)).toEqual(['done', 'active', 'blocked', 'pending', 'skipped', 'pending'])
  expect(p.steps[3]?.marked).toBe(false)
  expect(p.counts).toEqual({ total: 6, done: 1, active: 1, blocked: 1, pending: 2, skipped: 1 })
  expect(p.percent).toBe(33)
  expect(p.currentIndex).toBe(1)
  expect(p.steps.some(s => /Verification|Decisions/.test(s.title))).toBe(false)
  expect(p.title).toBe('Plan: ship the widget')
  expect(p.displayTitle).toBe('ship the widget')
})

test('marked: titles, lines, body and links', () => {
  const p = parse(MARKED_WP)
  const wp1 = p.steps[1]
  expect(wp1?.title).toBe('Parser (spec)')
  expect(wp1?.id).toBe('wp1-parser-spec')
  expect(wp1?.line).toBe(15)
  expect(wp1?.body).toContain('- [ ] not a child, inside a fence')
  expect(wp1?.links.map(l => l.href)).toEqual([
    'https://example.com/spec',
    'https://github.com/phatjam98/claude-mods/pull/7',
  ])
  expect(wp1?.links[0]?.line).toBe(15)
  // body stops at the next heading of depth <= 3
  expect(wp1?.endLine).toBe(24)
})

test('children: nested included, fenced excluded', () => {
  const kids = parse(MARKED_WP).steps[1]?.children ?? []
  expect(kids.map(k => [k.text, k.status])).toEqual([
    ['fences', 'done'],
    ['headings', 'pending'],
    ['nested child', 'active'],
  ])
  expect(kids[0]?.line).toBe(16)
})

test('blocked outranks pending for currentIndex; active outranks both', () => {
  const noActive = MARKED_WP.replace('### [~] WP1', '### [x] WP1')
  expect(parse(noActive).currentIndex).toBe(2)
  const onlyPending = noActive.replace('### [!] WP2', '### [x] WP2')
  expect(parse(onlyPending).currentIndex).toBe(3)
  const allDone = onlyPending.replace('### WP3', '### [x] WP3').replace('### [ ] WP5', '### [x] WP5')
  const p = parse(allDone)
  expect(p.currentIndex).toBeNull()
  expect(p.percent).toBe(100)
})

test('noble-tulip: pattern@3, Decisions under Context excluded, fenced # comments ignored', () => {
  const p = parse(NOBLE_TULIP)
  expect(p.mode).toBe('pattern')
  expect(p.stepDepth).toBe(3)
  expect(p.steps.map(s => s.short)).toEqual(['WP0', 'WP1', 'WP2', 'WP6a'])
  expect(p.steps.every(s => s.status === 'pending')).toBe(true)
  expect(p.steps[1]?.body).toContain('# throwaway Postgres')
  expect(p.steps[3]?.title).toBe('WP6b — Docs (sonnet, general-purpose)')
  expect(p.title).toStartWith('ECFX-18104 — re-baseline schema.sql')
})

test('nautilus: pattern@2, Branch / release before Step 1 excluded', () => {
  const p = parse(NAUTILUS)
  expect(p.mode).toBe('pattern')
  expect(p.stepDepth).toBe(2)
  expect(p.steps.map(s => s.short)).toEqual(['Step 1', 'Step 2', 'Step 3', 'Step 4', 'Step 5', 'Step 6'])
  expect(p.steps[0]?.title).toBe('Prove the proxy bug first (RED)')
  expect(p.steps[4]?.title).toBe('JaCoCo gate and CI (build.gradle:315-368)')
})

test('platypus: pattern@2, prose before and after the PR run excluded', () => {
  const p = parse(PLATYPUS)
  expect(p.mode).toBe('pattern')
  expect(p.stepDepth).toBe(2)
  expect(p.steps.map(s => s.short)).toEqual(['PR 1', 'PR 2', 'PR 3'])
})

test('unmarked sibling between two step-like siblings is a step', () => {
  const text = NAUTILUS.replace('## Step 3 — One contract spec for every mapped type', '## Contract specs')
  const p = parse(text)
  expect(p.steps.map(s => s.short)).toEqual(['Step 1', 'Step 2', '3', 'Step 4', 'Step 5', 'Step 6'])
  expect(p.steps[2]?.title).toBe('Contract specs')
})

test('squishy-puddle: ### 1. numbered steps -> shorts 1..4', () => {
  const p = parse(SQUISHY)
  expect(p.mode).toBe('pattern')
  expect(p.stepDepth).toBe(3)
  expect(p.steps.map(s => s.short)).toEqual(['1', '2', '3', '4'])
  expect(p.steps[3]?.title).toBe('Fix the guidance that misleads')
})

test("the waypoint plan's own excerpt: marked@3 with 6 steps", () => {
  const p = parse(WAYPOINT_PLAN)
  expect(p.mode).toBe('marked')
  expect(p.stepDepth).toBe(3)
  expect(p.steps).toHaveLength(6)
  expect(p.steps.map(s => s.status)).toEqual(['done', 'active', 'pending', 'pending', 'active', 'pending'])
  expect(p.currentIndex).toBe(1)
  expect(p.percent).toBe(17)
})

test('cleanTitle: trailing link, bold, backticks, bare and auto links', () => {
  expect(cleanTitle('**Fix** the `parser` — https://github.com/a/b/pull/1')).toEqual({
    text: 'Fix the parser',
    links: [{ label: 'https://github.com/a/b/pull/1', href: 'https://github.com/a/b/pull/1' }],
  })
  expect(cleanTitle('See [the MR](https://gitlab.com/g/p/-/merge_requests/3) and <https://x.dev/a>')).toEqual({
    text: 'See the MR and',
    links: [
      { label: 'the MR', href: 'https://gitlab.com/g/p/-/merge_requests/3' },
      { label: 'https://x.dev/a', href: 'https://x.dev/a' },
    ],
  })
  expect(cleanTitle('__a__   b').text).toBe('a b')
})

test('closing ### sequence is not part of the title', () => {
  const p = parse('# T\n\n## Work\n\n### [x] WP1 — Done ###\n\n### [ ] WP2 — Next ##\n')
  expect(p.steps.map(s => s.title)).toEqual(['Done', 'Next'])
})

test('CRLF + BOM parses the same as LF, with the same hash', () => {
  const crlf = '﻿' + MARKED_WP.replace(/\n/g, '\r\n')
  const a = parse(MARKED_WP)
  const b = parse(crlf)
  expect(b.hash).toBe(a.hash)
  expect(b).toEqual(a)
})

test('duplicate titles get -2 / -3 ids', () => {
  expect(parse(DUPLICATE_TITLES).steps.map(s => s.id)).toEqual([
    'wp1-write-tests',
    'wp1-write-tests-2',
    'wp1-write-tests-3',
  ])
})

test('checkbox-only plan: mode checkboxes with nested children', () => {
  const p = parse(CHECKBOX_ONLY)
  expect(p.mode).toBe('checkboxes')
  expect(p.stepDepth).toBeNull()
  expect(p.steps.map(s => [s.title, s.status])).toEqual([
    ['milk', 'done'],
    ['eggs', 'pending'],
    ['bread', 'active'],
  ])
  expect(p.steps[1]?.children.map(c => c.text)).toEqual(['free range'])
  expect(p.percent).toBe(33)
})

test('ordered-only plan: first ordered list becomes the steps', () => {
  const p = parse(ORDERED_ONLY)
  expect(p.mode).toBe('ordered')
  expect(p.steps.map(s => s.title)).toEqual(['Build the image', 'Push it', 'Roll the deployment'])
  expect(p.steps[0]?.body).toBe('   with jib')
  expect(p.counts.pending).toBe(3)
})

test('zero steps: mode none with a warning, title fallbacks', () => {
  const p = parse(ZERO_STEPS)
  expect(p.mode).toBe('none')
  expect(p.steps).toEqual([])
  expect(p.percent).toBe(0)
  expect(p.currentIndex).toBeNull()
  expect(p.warnings).toHaveLength(1)
  expect(parse('A short first line\n\nmore\n').title).toBe('A short first line')
  expect(parse('', '/x/y/my-plan.md').title).toBe('my-plan')
})

test('truncation cuts at a newline and still parses the head', () => {
  const head = '# Big\n\n## Work\n\n### [x] WP1 — One\n\n### [ ] WP2 — Two\n\n'
  const filler = ('x'.repeat(99) + '\n').repeat(Math.ceil(MAX_BYTES / 100) + 10)
  const p = parse(head + filler + '### [ ] WP3 — Lost\n')
  expect(p.truncated).toBe(true)
  expect(p.warnings.length).toBeGreaterThan(0)
  expect(p.steps.map(s => s.short)).toEqual(['WP1', 'WP2'])
  const n = normalize(head + filler)
  expect(n.text.endsWith('\n')).toBe(true)
  expect(n.text.length).toBeLessThanOrEqual(MAX_BYTES)
})

test('non-step and step-like name rules', () => {
  for (const t of ['Context', 'Decisions (made with the user)', 'Out of scope', 'Risks and mitigations', 'Verification (per PR)', 'Needs your call', 'Follow-ups', 'tl;dr'])
    expect(isNonStep(t)).toBe(true)
  for (const t of ['Contextual help', 'Step 1 — Context', 'Plan: one MR'])
    expect(isNonStep(t)).toBe(false)
  for (const t of ['WP0 — Prep', 'Step 3', 'PR 1: x', 'Phase 0: y', 'D0 — z', '1. Fix', '2) Do', '3 — Go'])
    expect(isStepLike(t)).toBe(true)
  for (const t of ['ECFX-18104 — thing', 'Branch / release', '2026 roadmap'])
    expect(isStepLike(t)).toBe(false)
})

test('shortLabel and hashText', () => {
  expect(shortLabel('WP2 — State', 0)).toEqual({ short: 'WP2', title: 'State' })
  expect(shortLabel('Step 3: Thing', 0)).toEqual({ short: 'Step 3', title: 'Thing' })
  expect(shortLabel('1. Fix it', 0)).toEqual({ short: '1', title: 'Fix it' })
  expect(shortLabel('Write docs', 4)).toEqual({ short: '5', title: 'Write docs' })
  expect(hashText('')).toBe('811c9dc5')
  expect(hashText('a')).toBe('e40c292c')
})
