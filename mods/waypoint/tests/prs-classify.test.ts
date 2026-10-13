import { test, expect } from 'claude-code/testing'
import type { PrAttention, PrFacts } from '../types'
import { attentionOf, colorOf, parseGhPr, parseGlabMr, statusWord } from '../hooks/prs'
import { gh, glab } from './fixtures/prs'

type Row = [string, unknown, Partial<PrFacts>, PrAttention, string]

const ghRows: Row[] = [
  ['clean (live PR 13)', gh.clean, { checks: 'passing', review: 'none', mergeable: 'clean' }, 'ready-to-merge', 'ready to merge'],
  ['failing check', gh.failing, { checks: 'failing', mergeable: 'clean' }, 'fix-ci', 'ci failed'],
  ['in progress', gh.inProgress, { checks: 'pending' }, null, 'ci pending'],
  ['changes requested', gh.changesRequested, { review: 'changes_requested', mergeable: 'blocked' }, 'address-review', 'changes requested'],
  ['conflicting + failing', gh.conflictingFailing, { mergeable: 'conflicting', checks: 'failing' }, 'resolve-conflicts', 'conflicts'],
  ['draft + failing', gh.draftFailing, { draft: true, checks: 'failing' }, null, 'draft'],
  ['merged', gh.merged, { state: 'merged' }, null, 'merged'],
  ['StatusContext FAILURE', gh.statusContextFailure, { checks: 'failing' }, 'fix-ci', 'ci failed'],
  ['empty rollup + CLEAN', gh.emptyRollupClean, { checks: 'none', mergeable: 'clean' }, 'ready-to-merge', 'ready to merge'],
  ['approved but behind', gh.approvedBehind, { review: 'approved', mergeable: 'blocked' }, null, 'blocked'],
]

const glabRows: Row[] = [
  ['not_approved + manual (live !6677)', glab.notApprovedManual, { checks: 'none', review: 'review_required', mergeable: 'blocked' }, null, 'awaiting review'],
  ['mergeable', glab.mergeable, { checks: 'passing', review: 'approved', mergeable: 'clean' }, 'ready-to-merge', 'ready to merge'],
  ['mergeable, no pipeline', glab.mergeableNoPipeline, { checks: 'none', mergeable: 'clean' }, 'ready-to-merge', 'ready to merge'],
  ['has_conflicts', glab.hasConflicts, { mergeable: 'conflicting' }, 'resolve-conflicts', 'conflicts'],
  ['pipeline failed', glab.pipelineFailed, { checks: 'failing', mergeable: 'blocked' }, 'fix-ci', 'ci failed'],
  ['pipeline running', glab.pipelineRunning, { checks: 'pending' }, null, 'ci pending'],
  ['requested_changes', glab.requestedChanges, { review: 'changes_requested' }, 'address-review', 'changes requested'],
  ['discussions_not_resolved', glab.discussionsNotResolved, { review: 'changes_requested' }, 'address-review', 'changes requested'],
  ['draft', glab.draft, { draft: true }, null, 'draft'],
  ['merged', glab.merged, { state: 'merged' }, null, 'merged'],
]

test('gh classification table', () => {
  for (const [name, json, facts, attention, word] of ghRows) {
    const f = parseGhPr(json)
    expect({ name, ok: f !== undefined }).toEqual({ name, ok: true })
    if (!f) continue
    expect({ name, ...f }).toMatchObject({ name, ...facts })
    expect({ name, a: attentionOf(f), w: statusWord(f) }).toEqual({ name, a: attention, w: word })
  }
})

test('glab classification table', () => {
  for (const [name, json, facts, attention, word] of glabRows) {
    const f = parseGlabMr(json)
    expect({ name, ok: f !== undefined }).toEqual({ name, ok: true })
    if (!f) continue
    expect({ name, ...f }).toMatchObject({ name, ...facts })
    expect({ name, a: attentionOf(f), w: statusWord(f) }).toEqual({ name, a: attention, w: word })
  }
})

test('parseGhPr carries title, url, headRef, updatedAt and accepts a JSON string', () => {
  const f = parseGhPr(JSON.stringify(gh.clean))
  expect(f).toMatchObject({
    state: 'open',
    title: gh.clean.title,
    url: 'https://github.com/phatjam98/eventhorizon/pull/13',
    headRef: 'feat/phase4.7-nab',
    updatedAt: '2026-08-04T16:05:11Z',
  })
})

test('parseGlabMr carries web_url and source_branch', () => {
  expect(parseGlabMr(glab.notApprovedManual)).toMatchObject({
    url: 'https://gitlab.com/ecfx/ecfx-backend/-/merge_requests/6677',
    headRef: 'ginger/pennsylvania-package-reorg',
  })
})

test('garbage → undefined; missing optional fields tolerated', () => {
  for (const bad of [undefined, null, 42, '', 'not json', '[]', [], { state: 'weird' }, glab.garbage]) {
    expect(parseGhPr(bad)).toBeUndefined()
    expect(parseGlabMr(bad)).toBeUndefined()
  }
  expect(parseGhPr({ state: 'OPEN' })).toEqual({
    state: 'open', draft: false, checks: 'none', review: 'none', mergeable: 'unknown', title: '', url: '',
  })
  expect(parseGlabMr({ state: 'opened' })).toMatchObject({ checks: 'none', review: 'none', mergeable: 'unknown' })
})

test('closed beats everything; a pending check blocks ready-to-merge', () => {
  const base: PrFacts = { state: 'open', draft: false, checks: 'passing', review: 'none', mergeable: 'clean', title: '', url: '' }
  expect(attentionOf({ ...base, state: 'closed', checks: 'failing' })).toBeNull()
  expect(attentionOf({ ...base, checks: 'pending' })).toBeNull()
  expect(attentionOf({ ...base, review: 'review_required' })).toBeNull()
  expect(attentionOf({ ...base, mergeable: 'unknown' })).toBeNull()
  expect(statusWord({ ...base, state: 'closed' })).toBe('closed')
  expect(statusWord({ ...base, mergeable: 'unknown' })).toBe('open')
})

test('colorOf maps attention to theme keys; merged/closed dim', () => {
  const cases: [Parameters<typeof colorOf>[0], ReturnType<typeof colorOf>][] = [
    [{ state: 'open', attention: 'fix-ci' }, 'error'],
    [{ state: 'open', attention: 'resolve-conflicts' }, 'error'],
    [{ state: 'open', attention: 'address-review' }, 'warning'],
    [{ state: 'open', attention: 'ready-to-merge' }, 'success'],
    [{ state: 'open', attention: null }, 'subtle'],
    [{ state: 'merged', attention: null }, undefined],
    [{ state: 'closed', attention: null }, undefined],
  ]
  for (const [e, want] of cases) expect(colorOf(e)).toBe(want)
})
