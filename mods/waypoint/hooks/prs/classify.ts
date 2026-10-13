// waypoint PRs: gh/glab JSON → facts → attention, status word, colour. Pure.

import type { PrAttention, PrChecks, PrEntry, PrFacts, PrMergeable, PrReview, PrState } from '../../types'

type Obj = Record<string, unknown>

function toObj(json: unknown): Obj | undefined {
  let v = json
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      return undefined
    }
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const up = (v: unknown): string => str(v).toUpperCase()

function opt(facts: PrFacts, headRef: string, updatedAt: string): PrFacts {
  if (headRef) facts.headRef = headRef
  if (updatedAt) facts.updatedAt = updatedAt
  return facts
}

// --- GitHub ---

const GH_FAIL = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'])

function ghChecks(rollup: unknown): PrChecks {
  if (!Array.isArray(rollup) || rollup.length === 0) return 'none'
  let failing = false
  let pending = false
  for (const item of rollup) {
    const c = toObj(item)
    if (!c) continue
    const isStatus = c['__typename'] === 'StatusContext' || (c['__typename'] === undefined && 'state' in c)
    if (isStatus) {
      const s = up(c['state'])
      if (s === 'FAILURE' || s === 'ERROR') failing = true
      else if (s === 'PENDING' || s === 'EXPECTED') pending = true
    } else if (up(c['status']) !== 'COMPLETED') pending = true
    else if (GH_FAIL.has(up(c['conclusion']))) failing = true
  }
  return failing ? 'failing' : pending ? 'pending' : 'passing'
}

function ghReview(v: unknown): PrReview {
  switch (up(v)) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'changes_requested'
    case 'REVIEW_REQUIRED':
      return 'review_required'
    default:
      return 'none' // "" is what solo repos return
  }
}

function ghMergeable(mergeable: unknown, mergeState: unknown): PrMergeable {
  const m = up(mergeable)
  const s = up(mergeState)
  if (m === 'CONFLICTING' || s === 'DIRTY') return 'conflicting'
  if (s === 'CLEAN' || s === 'HAS_HOOKS' || s === 'UNSTABLE') return 'clean'
  if (s === 'BLOCKED' || s === 'BEHIND' || s === 'DRAFT') return 'blocked'
  return 'unknown'
}

/** `gh pr view --json GH_FIELDS` output (string or parsed) → facts; garbage → undefined. */
export function parseGhPr(json: unknown): PrFacts | undefined {
  const o = toObj(json)
  if (!o) return undefined
  const st = up(o['state'])
  const state: PrState | undefined =
    st === 'OPEN' ? 'open' : st === 'MERGED' ? 'merged' : st === 'CLOSED' ? 'closed' : undefined
  if (!state) return undefined
  return opt(
    {
      state,
      draft: o['isDraft'] === true,
      checks: ghChecks(o['statusCheckRollup']),
      review: ghReview(o['reviewDecision']),
      mergeable: ghMergeable(o['mergeable'], o['mergeStateStatus']),
      title: str(o['title']),
      url: str(o['url']),
    },
    str(o['headRefName']),
    str(o['updatedAt']),
  )
}

// --- GitLab ---

function glabChecks(pipeline: unknown): PrChecks {
  const s = str(toObj(pipeline)?.['status']).toLowerCase()
  if (s === 'success') return 'passing'
  if (s === 'failed' || s === 'canceled' || s === 'cancelled') return 'failing'
  if (['running', 'pending', 'created', 'preparing', 'waiting_for_resource', 'scheduled'].includes(s)) return 'pending'
  return 'none' // manual, skipped, missing: a manual head pipeline is normal
}

function glabReview(dms: string): PrReview {
  if (dms === 'requested_changes' || dms === 'discussions_not_resolved') return 'changes_requested'
  if (dms === 'not_approved') return 'review_required'
  if (dms === 'mergeable') return 'approved'
  return 'none'
}

function glabMergeable(dms: string, hasConflicts: unknown): PrMergeable {
  if (hasConflicts === true || dms === 'has_conflicts' || dms === 'conflict' || dms === 'need_rebase') return 'conflicting'
  if (dms === 'mergeable') return 'clean'
  if (dms === '' || ['checking', 'unchecked', 'preparing', 'approvals_syncing'].includes(dms)) return 'unknown'
  return 'blocked'
}

/** `glab mr view -F json` output (string or parsed) → facts; garbage → undefined. */
export function parseGlabMr(json: unknown): PrFacts | undefined {
  const o = toObj(json)
  if (!o) return undefined
  const st = str(o['state']).toLowerCase()
  const state: PrState | undefined =
    st === 'opened' || st === 'locked' ? 'open' : st === 'merged' ? 'merged' : st === 'closed' ? 'closed' : undefined
  if (!state) return undefined
  const dms = str(o['detailed_merge_status']).toLowerCase()
  return opt(
    {
      state,
      draft: o['draft'] === true || o['work_in_progress'] === true,
      checks: glabChecks(o['head_pipeline']),
      review: glabReview(dms),
      mergeable: glabMergeable(dms, o['has_conflicts']),
      title: str(o['title']),
      url: str(o['web_url']),
    },
    str(o['source_branch']),
    str(o['updated_at']),
  )
}

// --- Derived ---

/** First match wins; see the plan's priority table. */
export function attentionOf(f: PrFacts): PrAttention {
  if (f.state !== 'open') return null
  if (f.draft) return null
  if (f.mergeable === 'conflicting') return 'resolve-conflicts'
  if (f.checks === 'failing') return 'fix-ci'
  if (f.review === 'changes_requested') return 'address-review'
  if (
    (f.review === 'approved' || f.review === 'none') &&
    f.mergeable === 'clean' &&
    (f.checks === 'passing' || f.checks === 'none')
  ) {
    return 'ready-to-merge'
  }
  return null
}

export function statusWord(e: PrFacts & { attention?: PrAttention }): string {
  if (e.state === 'merged') return 'merged'
  if (e.state === 'closed') return 'closed'
  if (e.draft) return 'draft'
  if (e.mergeable === 'conflicting') return 'conflicts'
  if (e.checks === 'failing') return 'ci failed'
  if (e.review === 'changes_requested') return 'changes requested'
  if ((e.attention ?? attentionOf(e)) === 'ready-to-merge') return 'ready to merge'
  if (e.checks === 'pending') return 'ci pending'
  if (e.review === 'review_required') return 'awaiting review'
  if (e.mergeable === 'blocked') return 'blocked'
  return 'open'
}

export type PrColor = 'error' | 'warning' | 'success' | 'subtle' | undefined

/** Theme key for a row; undefined = dim (merged/closed). */
export function colorOf(e: Pick<PrEntry, 'state' | 'attention'>): PrColor {
  if (e.state !== 'open') return undefined
  switch (e.attention) {
    case 'fix-ci':
    case 'resolve-conflicts':
      return 'error'
    case 'address-review':
      return 'warning'
    case 'ready-to-merge':
      return 'success'
    default:
      return 'subtle'
  }
}
