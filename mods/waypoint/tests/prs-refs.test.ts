import { test, expect } from 'claude-code/testing'
import type { RepoRef } from '../types'
import {
  discoverFromBash,
  extractRefs,
  extractShortRefs,
  extractUrls,
  ghViewArgs,
  glabEnv,
  glabViewArgs,
  parseRemote,
  prId,
  prLabel,
  prUrl,
  resolveManualRef,
} from '../hooks/prs'
import { ghListText, ghViewText, gitPushGitlabText, gitPushText, glabListText, glabViewText } from './fixtures/prs'

const GH: RepoRef = { kind: 'github', host: 'github.com', path: 'phatjam98/eventhorizon' }
const GL: RepoRef = { kind: 'gitlab', host: 'gitlab.com', path: 'ecfx/ecfx-backend' }
const ids = (refs: { kind: 'github' | 'gitlab'; host: string; path: string; number: number }[]) => refs.map(prId)

test('parseRemote handles scp, ssh:// and https forms', () => {
  const cases: [string, RepoRef | undefined][] = [
    ['git@github.com:phatjam98/eventhorizon.git', GH],
    ['https://github.com/phatjam98/eventhorizon', GH],
    ['https://github.com/phatjam98/eventhorizon.git/', GH],
    ['git@gitlab.com:ecfx/ecfx-backend.git', GL],
    ['ssh://git@gitlab.example.com:2222/g/sub/p.git', { kind: 'gitlab', host: 'gitlab.example.com', path: 'g/sub/p' }],
    ['https://user@GitHub.Example.com/o/r', { kind: 'github', host: 'github.example.com', path: 'o/r' }],
    ['', undefined],
    ['not a remote', undefined],
    ['https://github.com/justowner', undefined],
  ]
  for (const [remote, want] of cases) expect(parseRemote(remote)).toEqual(want)
  expect(parseRemote(undefined)).toBeUndefined()
})

test('prId, prLabel and prUrl per kind', () => {
  const g = { ...GH, number: 13 }
  const l = { ...GL, number: 6677 }
  expect([prId(g), prLabel(g), prUrl(g)]).toEqual([
    'github.com/phatjam98/eventhorizon#13',
    '#13',
    'https://github.com/phatjam98/eventhorizon/pull/13',
  ])
  expect([prId(l), prLabel(l), prUrl(l)]).toEqual([
    'gitlab.com/ecfx/ecfx-backend!6677',
    '!6677',
    'https://gitlab.com/ecfx/ecfx-backend/-/merge_requests/6677',
  ])
})

test('extractUrls finds PR/MR URLs and ignores issues, push hints and new-MR links', () => {
  const text = [
    'https://github.com/o/r/pull/5/files',
    'https://github.com/o/r/issues/6',
    'https://gitlab.example.com/g/sub/p/-/merge_requests/7#note_1',
    'https://github.com/o/r/pull/5',
    gitPushText,
    gitPushGitlabText,
  ].join('\n')
  expect(ids(extractUrls(text))).toEqual(['github.com/o/r#5', 'gitlab.example.com/g/sub/p!7'])
})

test('extractUrls is stable across repeated calls (no shared regex state)', () => {
  const t = 'https://github.com/o/r/pull/1'
  expect(extractUrls(t)).toHaveLength(1)
  expect(extractUrls(t)).toHaveLength(1)
})

test('short refs need a repo of matching kind; #issuecomment fragments never yield refs', () => {
  const text = 'Fixes #12 and !34, see https://github.com/o/r/pull/13#issuecomment-1 and doc#99 and ecfx/other!5'
  expect(ids(extractShortRefs(text, GH))).toEqual(['github.com/phatjam98/eventhorizon#12'])
  expect(ids(extractShortRefs(text, GL))).toEqual(['gitlab.com/ecfx/other!5', 'gitlab.com/ecfx/ecfx-backend!34'])
  expect(ids(extractRefs(text))).toEqual(['github.com/o/r#13'])
  expect(ids(extractRefs(text, GH))).toEqual(['github.com/o/r#13', 'github.com/phatjam98/eventhorizon#12'])
})

test('short refs skip 7+ digit numbers and refs glued to words or paths', () => {
  expect(extractShortRefs('color #1234567 a#5 /#6 ##7', GH)).toEqual([])
  expect(ids(extractShortRefs('(#8)', GH))).toEqual(['github.com/phatjam98/eventhorizon#8'])
})

test('discoverFromBash: gh pr create picks the URL from the result text', () => {
  const refs = discoverFromBash({
    command: 'git push -u origin feat/x && gh pr create --fill',
    text: 'https://github.com/phatjam98/eventhorizon/pull/14\n',
    repo: GH,
  })
  expect(ids(refs)).toEqual(['github.com/phatjam98/eventhorizon#14'])
})

test('discoverFromBash: gh pr view <n> uses the session repo; text URLs only, not #refs', () => {
  const refs = discoverFromBash({ command: 'gh pr view 13', text: ghViewText, repo: GH })
  expect(ids(refs)).toEqual(['github.com/phatjam98/eventhorizon#13'])
})

test('discoverFromBash: list, search, api, cat and git log yield nothing', () => {
  const commands = [
    'gh pr list --state all',
    'gh search prs waypoint',
    'gh api repos/o/r/pulls/5',
    'glab mr list',
    'cat notes.md',
    'git log --oneline',
    'git push -u origin feat/x',
  ]
  const text = `${ghListText}\n${glabListText}\nhttps://github.com/o/r/pull/5\n${gitPushText}`
  for (const command of commands) expect(discoverFromBash({ command, text, repo: GH })).toEqual([])
})

test('discoverFromBash: --repo / -R values override the session repo', () => {
  const cases: [string, string[]][] = [
    ['gh pr view 5 --repo other/thing', ['github.com/other/thing#5']],
    ['gh pr checks --repo=other/thing 6', ['github.com/other/thing#6']],
    ['gh pr view 7 -R ghe.corp.com/o/r', ['ghe.corp.com/o/r#7']],
    ['glab mr view 8 -R g/sub/p', ['gitlab.com/g/sub/p!8']],
    ['glab mr view 9 -R https://gitlab.example.com/g/p', ['gitlab.example.com/g/p!9']],
  ]
  for (const [command, want] of cases) expect(ids(discoverFromBash({ command, repo: GH }))).toEqual(want)
})

test('discoverFromBash: first bare number wins; no repo of matching kind → nothing', () => {
  expect(ids(discoverFromBash({ command: 'gh pr comment 21 --body "see 22"', repo: GH }))).toEqual([
    'github.com/phatjam98/eventhorizon#21',
  ])
  expect(discoverFromBash({ command: 'glab mr view 6677', repo: GH })).toEqual([])
  expect(discoverFromBash({ command: 'gh pr view 13', repo: null })).toEqual([])
  expect(ids(discoverFromBash({ command: 'glab mr view 6677', text: glabViewText, repo: GL }))).toEqual([
    'gitlab.com/ecfx/ecfx-backend!6677',
  ])
})

test('discoverFromBash: URL argument and segments split on ; | || newline, deduped', () => {
  const refs = discoverFromBash({
    command: 'gh pr view https://github.com/o/r/pull/3; gh pr merge 3 -R o/r || true\ngh pr diff 4 | head',
    repo: GH,
  })
  expect(ids(refs)).toEqual(['github.com/o/r#3', 'github.com/phatjam98/eventhorizon#4'])
})

test('resolveManualRef accepts URLs, ids, group/proj!n and short refs against the session repo', () => {
  const ok = (arg: string, repo?: RepoRef) => {
    const r = resolveManualRef(arg, repo)
    return r.ok ? prId(r.ref) : `ERR ${r.error}`
  }
  expect(ok('https://github.com/o/r/pull/2')).toBe('github.com/o/r#2')
  expect(ok('#13', GH)).toBe('github.com/phatjam98/eventhorizon#13')
  expect(ok('!6677', GL)).toBe('gitlab.com/ecfx/ecfx-backend!6677')
  expect(ok('ecfx/ecfx-backend!1')).toBe('gitlab.com/ecfx/ecfx-backend!1')
  expect(ok('gitlab.example.com/g/p!4')).toBe('gitlab.example.com/g/p!4')
  expect(ok('github.com/o/r#9')).toBe('github.com/o/r#9')
  expect(ok('#13', GL)).toMatch(/^ERR no GitHub repo/)
  expect(ok('!5')).toMatch(/^ERR no GitLab repo/)
  expect(ok('banana')).toMatch(/^ERR not a PR/)
  expect(ok('  ')).toMatch(/^ERR usage/)
})

test('view argv and env per host', () => {
  expect(ghViewArgs({ ...GH, number: 13 }).slice(0, 6)).toEqual(['gh', 'pr', 'view', '13', '--repo', 'phatjam98/eventhorizon'])
  expect(ghViewArgs({ kind: 'github', host: 'ghe.corp.com', path: 'o/r', number: 1 })[5]).toBe('ghe.corp.com/o/r')
  expect(glabViewArgs({ ...GL, number: 6677 })).toEqual(['glab', 'mr', 'view', '6677', '-R', 'ecfx/ecfx-backend', '-F', 'json'])
  const self = { kind: 'gitlab' as const, host: 'gitlab.example.com', path: 'g/p', number: 2 }
  expect(glabViewArgs(self)[5]).toBe('https://gitlab.example.com/g/p')
  expect(glabEnv(self)).toEqual({ GITLAB_HOST: 'gitlab.example.com' })
  expect(glabEnv({ ...GL, number: 1 })).toBeUndefined()
})
