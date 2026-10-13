import { test, expect } from 'claude-code/testing'
import { expandHome, nextSource, resolveUseArg, samePath, shouldResume, storeKey } from '../hooks/track'
import type { StoredPlan } from '../types'

const HOME = '/Users/me'
const DAY = 24 * 60 * 60 * 1000
const NOW = 1_800_000_000_000

test('expandHome', () => {
  expect(expandHome('~', HOME)).toBe(HOME)
  expect(expandHome('~/x/y.md', HOME)).toBe('/Users/me/x/y.md')
  expect(expandHome('~other/x', HOME)).toBe('~other/x')
  expect(expandHome('/abs', HOME)).toBe('/abs')
})

test('samePath: expansion, trailing slash, dot segments; empty never matches', () => {
  expect(samePath('~/.claude/plans/a.md', '/Users/me/.claude/plans/a.md', HOME)).toBe(true)
  expect(samePath('/a/b/', '/a/b')).toBe(true)
  expect(samePath('/a/./c/../b', '/a/b')).toBe(true)
  expect(samePath('/a/b', '/a/c')).toBe(false)
  expect(samePath('', '')).toBe(false)
  expect(samePath(null, '/a')).toBe(false)
})

test('resolveUseArg: absolute, ~/, relative-with-slash, bare slug', () => {
  const r = (a: string) => resolveUseArg(a, '/repo', '~/.claude/plans', HOME)
  expect(r('/tmp/p.md')).toBe('/tmp/p.md')
  expect(r('~/notes/p.md')).toBe('/Users/me/notes/p.md')
  expect(r('docs/plan.md')).toBe('/repo/docs/plan.md')
  expect(r('./docs/../plan.md')).toBe('/repo/plan.md')
  expect(r('we-need-to-get-noble-tulip')).toBe('/Users/me/.claude/plans/we-need-to-get-noble-tulip.md')
  expect(r('noble-tulip.md')).toBe('/Users/me/.claude/plans/noble-tulip.md')
  expect(r('  slug  ')).toBe('/Users/me/.claude/plans/slug.md')
  expect(resolveUseArg('s', '/repo', '/plans/', HOME)).toBe('/plans/s.md')
})

test('storeKey', () => {
  expect(storeKey('/repo')).toBe('last:/repo')
})

const rec = (percent: number): StoredPlan => ({ path: '/p.md', title: 'P', at: NOW - DAY, percent, sessionId: 's' })

test('shouldResume: unfinished and fresh resumes', () => {
  expect(shouldResume(rec(40), { mtimeMs: NOW - 3 * DAY }, NOW, 14)).toBe(true)
})

test('shouldResume: complete plan resumes only within 24 h', () => {
  expect(shouldResume(rec(100), { mtimeMs: NOW - DAY / 2 }, NOW, 14)).toBe(true)
  expect(shouldResume(rec(100), { mtimeMs: NOW - 2 * DAY }, NOW, 14)).toBe(false)
})

test('shouldResume: too old, missing file, no record, disabled window', () => {
  expect(shouldResume(rec(10), { mtimeMs: NOW - 15 * DAY }, NOW, 14)).toBe(false)
  expect(shouldResume(rec(10), null, NOW, 14)).toBe(false)
  expect(shouldResume(null, { mtimeMs: NOW }, NOW, 14)).toBe(false)
  expect(shouldResume(rec(10), { mtimeMs: NOW }, NOW, 0)).toBe(false)
  expect(shouldResume(rec(10), { mtimeMs: NOW - 14 * DAY }, NOW, 14)).toBe(true)
})

test('nextSource: precedence and same-path no-op', () => {
  const cur = (source: 'manual' | 'plan_mode' | 'exit_plan' | 'resume') => ({ path: '/a.md', source })
  expect(nextSource(null, { path: '/b.md', source: 'resume' })).toBe('replace')
  expect(nextSource(cur('manual'), { path: '/b.md', source: 'plan_mode' })).toBe('keep')
  expect(nextSource(cur('manual'), { path: '/b.md', source: 'manual' })).toBe('replace')
  expect(nextSource(cur('resume'), { path: '/b.md', source: 'plan_mode' })).toBe('replace')
  expect(nextSource(cur('exit_plan'), { path: '/b.md', source: 'plan_mode' })).toBe('replace')
  expect(nextSource(cur('plan_mode'), { path: '/b.md', source: 'plan_mode' })).toBe('replace')
  expect(nextSource(cur('plan_mode'), { path: '/b.md', source: 'resume' })).toBe('keep')
  expect(nextSource(cur('resume'), { path: '/b.md', source: 'exit_plan' })).toBe('replace')
  expect(nextSource(cur('manual'), { path: '/a.md/', source: 'resume' })).toBe('same')
  expect(nextSource({ path: '~/a.md', source: 'resume' }, { path: '/Users/me/a.md', source: 'manual' }, HOME)).toBe('same')
})
