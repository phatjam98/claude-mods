// waypoint PRs: public surface for register.tsx. Pure.

import type { PrEntry, RepoRef } from '../../types'
import { colorOf, statusWord, type PrColor } from './classify'
import { prLabel } from './refs'

export * from './refs'
export * from './commands'
export * from './classify'
export * from './poll'

/** Last path segment: `ecfx/ecfx-backend` → `ecfx-backend`. */
export function repoNameOf(ref: Pick<RepoRef, 'path'>): string {
  return ref.path.split('/').filter(Boolean).pop() ?? ref.path
}

export type PrRow = {
  glyph: string
  label: string
  repoName: string
  branch: string
  status: string
  color: PrColor
  url: string
  id: string
  stepId: string | undefined
}

function glyphOf(e: PrEntry): string {
  if (e.state === 'merged') return '●'
  if (e.state === 'closed') return '⊘'
  if (e.draft) return '◌'
  switch (e.attention) {
    case 'fix-ci':
    case 'resolve-conflicts':
      return '✗'
    case 'address-review':
      return '✎'
    case 'ready-to-merge':
      return '✓'
    default:
      return '○'
  }
}

/** Pane row data (no JSX). Errored entries show `⚠ <class>` as their status. */
export function rowOf(entry: PrEntry, _now: number): PrRow {
  return {
    glyph: glyphOf(entry),
    label: prLabel(entry),
    repoName: repoNameOf(entry),
    branch: entry.headRef ?? '',
    status: entry.error ? `⚠ ${entry.error}` : statusWord(entry),
    color: colorOf(entry),
    url: entry.url,
    id: entry.id,
    stepId: entry.stepId,
  }
}
