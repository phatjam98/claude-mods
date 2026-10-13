// Live-shaped gh/glab fixtures (captured 2026-10-12 with gh 2.102.0 and glab 1.72.0,
// trimmed to the fields the classifier reads; no tokens or secrets were present).

const run = (name: string, conclusion: string, status = 'COMPLETED') => ({
  __typename: 'CheckRun',
  completedAt: status === 'COMPLETED' ? '2026-08-04T16:10:54Z' : '0001-01-01T00:00:00Z',
  conclusion: status === 'COMPLETED' ? conclusion : '',
  detailsUrl: 'https://github.com/phatjam98/eventhorizon/actions/runs/30927429139/job/92053247974',
  name,
  startedAt: '2026-08-04T16:05:21Z',
  status,
  workflowName: 'CI',
})

const ghBase = {
  headRefName: 'feat/phase4.7-nab',
  isDraft: false,
  mergeStateStatus: 'CLEAN',
  mergeable: 'MERGEABLE',
  number: 13,
  reviewDecision: '',
  state: 'OPEN',
  statusCheckRollup: [run('Flink Jobs', 'SUCCESS'), run('Services', 'SUCCESS'), run('E2E Tests', 'SUCCESS')],
  title: 'feat(phase4.7+4.8): NAB ingestion, windowed ML features, cannabis collector, dashboard + CI hardening',
  updatedAt: '2026-08-04T16:05:11Z',
  url: 'https://github.com/phatjam98/eventhorizon/pull/13',
}

export const gh = {
  /** Real PR 13 as returned live: open, CLEAN, all SUCCESS, reviewDecision "". */
  clean: ghBase,
  failing: { ...ghBase, mergeStateStatus: 'UNSTABLE', statusCheckRollup: [run('Services', 'SUCCESS'), run('ML', 'FAILURE')] },
  inProgress: { ...ghBase, statusCheckRollup: [run('Services', 'SUCCESS'), run('E2E Tests', '', 'IN_PROGRESS')] },
  changesRequested: { ...ghBase, reviewDecision: 'CHANGES_REQUESTED', mergeStateStatus: 'BLOCKED' },
  conflictingFailing: {
    ...ghBase,
    mergeable: 'CONFLICTING',
    mergeStateStatus: 'DIRTY',
    statusCheckRollup: [run('ML', 'FAILURE')],
  },
  draftFailing: { ...ghBase, isDraft: true, mergeStateStatus: 'DRAFT', statusCheckRollup: [run('ML', 'FAILURE')] },
  merged: { ...ghBase, state: 'MERGED', mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' },
  statusContextFailure: {
    ...ghBase,
    statusCheckRollup: [
      run('Services', 'SUCCESS'),
      { __typename: 'StatusContext', context: 'ci/jenkins', state: 'FAILURE', targetUrl: 'https://ci.example/1' },
    ],
  },
  emptyRollupClean: { ...ghBase, statusCheckRollup: [] },
  approvedBehind: { ...ghBase, reviewDecision: 'APPROVED', mergeStateStatus: 'BEHIND' },
}

const glabBase = {
  iid: 6677,
  title: 'refactor(pennsylvania): move PA court processors under providers/pennsylvania (pure package move)',
  state: 'opened',
  draft: false,
  work_in_progress: false,
  detailed_merge_status: 'not_approved',
  has_conflicts: false,
  blocking_discussions_resolved: true,
  web_url: 'https://gitlab.com/ecfx/ecfx-backend/-/merge_requests/6677',
  source_branch: 'ginger/pennsylvania-package-reorg',
  updated_at: '2026-10-13T01:14:40.91Z',
  head_pipeline: { id: 2940595138, status: 'manual' } as { id: number; status: string } | null,
}

export const glab = {
  /** Real MR !6677 as returned live: not_approved with a manual head pipeline. */
  notApprovedManual: glabBase,
  mergeable: { ...glabBase, detailed_merge_status: 'mergeable', head_pipeline: { id: 1, status: 'success' } },
  mergeableNoPipeline: { ...glabBase, detailed_merge_status: 'mergeable', head_pipeline: null },
  hasConflicts: { ...glabBase, detailed_merge_status: 'conflict', has_conflicts: true },
  pipelineFailed: { ...glabBase, detailed_merge_status: 'ci_must_pass', head_pipeline: { id: 2, status: 'failed' } },
  pipelineRunning: { ...glabBase, detailed_merge_status: 'ci_still_running', head_pipeline: { id: 3, status: 'running' } },
  requestedChanges: { ...glabBase, detailed_merge_status: 'requested_changes' },
  discussionsNotResolved: {
    ...glabBase,
    detailed_merge_status: 'discussions_not_resolved',
    blocking_discussions_resolved: false,
  },
  draft: { ...glabBase, draft: true, work_in_progress: true, detailed_merge_status: 'draft_status' },
  merged: { ...glabBase, state: 'merged', detailed_merge_status: 'not_open' },
  garbage: { message: '404 Not Found' },
}

/** Non-TTY `gh pr view 13 --repo phatjam98/eventhorizon` (head of output). */
export const ghViewText = [
  'title:\tfeat(phase4.7+4.8): NAB ingestion, windowed ML features, cannabis collector, dashboard + CI hardening',
  'state:\tOPEN',
  'author:\tphatjam98 (Travis Carter)',
  'labels:\t',
  'number:\t13',
  'url:\thttps://github.com/phatjam98/eventhorizon/pull/13',
  'additions:\t8709',
  'deletions:\t341',
  'auto-merge:\tdisabled',
  '--',
  'Closes #7. See https://github.com/phatjam98/eventhorizon/pull/13#issuecomment-1 and https://github.com/phatjam98/eventhorizon/issues/9',
].join('\n')

/** Non-TTY `gh pr list --repo phatjam98/eventhorizon --state all -L 2` (TSV, no URLs). */
export const ghListText = [
  '13\tfeat(phase4.7+4.8): NAB ingestion, windowed ML features\tfeat/phase4.7-nab\tOPEN\t2026-08-04T16:05:11Z',
  '12\tfeat(collector): cannabis dispensary metrics\tfeat/collector\tMERGED\t2026-07-30T10:00:00Z',
].join('\n')

/** `git push -u origin feat/x` stderr with GitHub's create-PR hint. */
export const gitPushText = [
  'remote: ',
  "remote: Create a pull request for 'feat/x' on GitHub by visiting:",
  'remote:      https://github.com/phatjam98/eventhorizon/pull/new/feat/x',
  'remote: ',
  'To github.com:phatjam98/eventhorizon.git',
  ' * [new branch]      feat/x -> feat/x',
].join('\n')

/** `git push` to GitLab with its create-MR hint. */
export const gitPushGitlabText = [
  'remote: To create a merge request for feat/x, visit:',
  'remote:   https://gitlab.com/ecfx/ecfx-backend/-/merge_requests/new?merge_request%5Bsource_branch%5D=feat%2Fx',
].join('\n')

/** Non-TTY `glab mr view 6677 -R ecfx/ecfx-backend` (head of output). */
export const glabViewText = [
  'title:\trefactor(pennsylvania): move PA court processors under providers/pennsylvania (pure package move)',
  'state:\topen',
  'author:\tgingerjin',
  'number:\t6677',
  'url:\thttps://gitlab.com/ecfx/ecfx-backend/-/merge_requests/6677',
  '--',
].join('\n')

/** `glab mr list -R ecfx/ecfx-backend` (contains refs but no URLs; must yield nothing). */
export const glabListText = [
  'Showing 2 open merge requests on ecfx/ecfx-backend. (Page 1)',
  '',
  '!6677\tecfx/ecfx-backend!6677\trefactor(pennsylvania): move PA court processors\t(master) ← (ginger/pennsylvania-package-reorg)',
  '!6676\tecfx/ecfx-backend!6676\tECFX-2648: daily digest outsiders\t(master) ← (shoha/ECFX-2648_daily-outsiders-per-case)',
].join('\n')

/** Real stderr strings captured live. */
export const stderr = {
  ghNotFoundPr: 'GraphQL: Could not resolve to a PullRequest with the number of 99999. (repository.pullRequest)',
  ghNotFoundRepo: "GraphQL: Could not resolve to a Repository with the name 'phatjam98/nope-nope-xyz'. (repository)",
  ghAuth: 'HTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login -h github.com',
  glabNotFound: 'ERROR: failed to get merge request 999999: 404 Not Found',
  glabAuth:
    'ERROR: failed to get merge request 6677: GET https://gitlab.com/api/v4/projects/ecfx%2Fecfx-backend/merge_requests/6677: 401 {message: 401 Unauthorized}',
  missing: 'zsh:1: command not found: gh',
  // Not captured live (would need exhausting the quota); documented gh/GitLab wording.
  ghRateLimit: 'HTTP 403: API rate limit exceeded for user ID 1. (https://api.github.com/graphql)',
  glabRateLimit: 'ERROR: 429 Too Many Requests',
}
