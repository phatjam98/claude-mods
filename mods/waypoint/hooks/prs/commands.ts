// waypoint PRs: argv builders for polling one PR/MR. Pure.

import type { PrRef } from '../../types'

export const GH_FIELDS =
  'number,title,url,state,isDraft,reviewDecision,mergeable,mergeStateStatus,statusCheckRollup,headRefName,updatedAt'

/** `gh pr view <n> --repo [host/]owner/repo --json <fields>` */
export function ghViewArgs(ref: PrRef): string[] {
  const repo = ref.host === 'github.com' ? ref.path : `${ref.host}/${ref.path}`
  return ['gh', 'pr', 'view', String(ref.number), '--repo', repo, '--json', GH_FIELDS]
}

/** `glab mr view <n> -R <path | https://host/path> -F json` */
export function glabViewArgs(ref: PrRef): string[] {
  const repo = ref.host === 'gitlab.com' ? ref.path : `https://${ref.host}/${ref.path}`
  return ['glab', 'mr', 'view', String(ref.number), '-R', repo, '-F', 'json']
}

/**
 * Env for a self-managed GitLab host. Whether glab needs GITLAB_HOST as well as
 * the URL-form `-R` is unverified (only gitlab.com is testable); both are sent.
 */
export function glabEnv(ref: PrRef): Record<string, string> | undefined {
  return ref.host === 'gitlab.com' ? undefined : { GITLAB_HOST: ref.host }
}

/** The view argv for any ref. */
export function viewArgs(ref: PrRef): string[] {
  return ref.kind === 'github' ? ghViewArgs(ref) : glabViewArgs(ref)
}
