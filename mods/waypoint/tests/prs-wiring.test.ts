// WP4 wiring: Bash discovery → store → kick-off poll → classify → toasts; errors; migration; plan refs; track/untrack.
import { test, expect, mock } from 'claude-code/testing'
import { gh, ghViewText, ghListText, stderr } from './fixtures/prs'

const HOME = '/home/t'
const PLAN = `${HOME}/.claude/plans/purring-origami.md`
const NOW = 1_800_000_000_000
const SESSION_KEY = 'waypoint:prs:session/S1'
const PLAN_KEY = `waypoint:prs:plan/${PLAN}`
const PR13 = 'github.com/phatjam98/eventhorizon#13'

type Run = { exitCode: number; stdout: string; stderr: string }
const ok = (json: unknown): Run => ({ exitCode: 0, stdout: JSON.stringify(json), stderr: '' })
const fail = (err: string): Run => ({ exitCode: 1, stdout: '', stderr: err })

function world(on: any, opts: { run?: (argv: string[]) => Run; repo?: boolean; files?: Record<string, string> } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const files: Record<string, { text: string; mtimeMs: number }> = {}
  for (const [p, t] of Object.entries(opts.files ?? {})) files[p] = { text: t, mtimeMs: NOW - 1000 }
  const store: Record<string, any> = {}
  const runs: string[][] = []
  const toasts: string[] = []
  const notifies: string[] = []
  let bashText = ''
  on('env.get', (_: any, e: any) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.id', () => ({ value: 'S1' }))
  on('session.repo', () => ({
    value: opts.repo === false ? null : { root: '/work', remote: 'git@github.com:phatjam98/eventhorizon.git', internal: false, name: null },
  }))
  on('store.get', (_: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_: any, e: any) => {
    store[e.key] = structuredClone(e.value)
    return { value: undefined }
  })
  on('store.delete', (_: any, e: any) => {
    delete store[e.key]
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('fs.stat', (_: any, e: any) => {
    const f = files[e.path]
    return f ? { value: { kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs, isLink: false } } : { deny: 'ENOENT' }
  })
  on('fs.read', (_: any, e: any) => (files[e.path] ? { value: files[e.path]!.text } : { deny: 'ENOENT' }))
  on('fs.exists', (_: any, e: any) => ({ value: e.path in files }))
  on('process.run', (_: any, e: any) => {
    runs.push([...e.argv])
    const r = opts.run ? opts.run(e.argv) : ok(gh.clean)
    if (r.exitCode === 127) return { deny: 'spawn gh ENOENT' }
    return { value: { ...r, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', (_: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', (_: any, e: any) => {
    notifies.push(e.text)
    return { value: { isSent: true, channel: 'terminal' } }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('command.register', () => ({ value: { command: 'waypoint' } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('prompt.attachment', (_: any, e: any) => ({ text: e.text }))
  on('tool.call', (_: any, e: any) => ({ ref: 1, result: {}, text: e.tool === 'Bash' ? bashText : 'ok' }))
  const bash = async ($: any, command: string, text: string) => {
    bashText = text
    await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command })
    await clock.settle()
  }
  const write = (p: string, text: string) => {
    files[p] = { text, mtimeMs: clock.now() }
  }
  return { clock, store, runs, toasts, notifies, bash, write }
}

const start = ($: any) => $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
const command = async ($: any, args: string) =>
  (await $.command.run({ command: 'waypoint', args, origin: { kind: 'person' }, presentation: 'text' })).text as string
const views = (w: { runs: string[][] }) => w.runs.filter(a => a[0] === 'gh' && a[2] === 'view')

test('Bash `gh pr view` stores a session entry and kicks off one poll after 750 ms', async ($, on) => {
  const w = world(on)
  await start($)
  await w.bash($, 'gh pr view 13 --repo phatjam98/eventhorizon', ghViewText)
  expect(Object.keys(w.store[SESSION_KEY].entries)).toEqual([PR13])
  expect(w.store[SESSION_KEY].entries[PR13]).toMatchObject({ source: 'session', lastPolledAt: null })
  expect(views(w)).toHaveLength(0)
  await w.clock.advance(750)
  expect(views(w)).toEqual([
    ['gh', 'pr', 'view', '13', '--repo', 'phatjam98/eventhorizon', '--json', expect.stringContaining('statusCheckRollup')],
  ])
  expect(w.store[SESSION_KEY].entries[PR13]).toMatchObject({ attention: 'ready-to-merge', checks: 'passing', lastPolledAt: NOW + 750 })
  expect(w.toasts).toEqual(['waypoint: #13 ready to merge · eventhorizon'])
})

test('`gh pr list`, `git push` hints and non-gh commands discover nothing', async ($, on) => {
  const w = world(on)
  await start($)
  await w.bash($, 'gh pr list --repo phatjam98/eventhorizon', ghListText)
  await w.bash($, 'cat notes.md', 'see https://github.com/phatjam98/eventhorizon/pull/13')
  expect(w.store[SESSION_KEY]).toBeUndefined()
  await w.clock.advance(1000)
  expect(w.runs).toHaveLength(0)
})

test('a failing PR becomes fix-ci with exactly one toast across polls', async ($, on) => {
  const w = world(on, { run: () => ok(gh.failing) })
  await start($)
  await w.bash($, 'gh pr checks 13', '')
  await w.clock.advance(750)
  expect(w.store[SESSION_KEY].entries[PR13].attention).toBe('fix-ci')
  await command($, 'refresh')
  await w.clock.settle()
  expect(views(w)).toHaveLength(2)
  expect(w.toasts).toEqual(['waypoint: #13 CI failed · eventhorizon'])
  expect(await command($, 'status')).toBe('waypoint: no plan tracked\npane: not placed\nstyle guide: on')
})

test('notify on: a new attention also raises a native notification', { options: { notify: true } }, async ($, on) => {
  const w = world(on, { run: () => ok(gh.failing) })
  await start($)
  await w.bash($, 'gh pr view 13', '')
  await w.clock.advance(750)
  expect(w.notifies).toEqual(['waypoint: #13 CI failed · eventhorizon'])
})

test('gh auth failure: one error toast per session and a note until a poll succeeds', async ($, on) => {
  let authed = false
  const w = world(on, { run: () => (authed ? ok(gh.clean) : fail(stderr.ghAuth)) })
  await start($)
  await w.bash($, 'gh pr view 13', '')
  await w.clock.advance(750)
  expect(w.store[SESSION_KEY].entries[PR13]).toMatchObject({ error: 'auth', failures: 1 })
  await command($, 'refresh')
  await w.clock.settle()
  expect(views(w)).toHaveLength(2)
  expect(w.toasts).toEqual(['waypoint: gh not logged in — run gh auth login'])
  authed = true
  await command($, 'refresh')
  await w.clock.settle()
  expect(w.store[SESSION_KEY].entries[PR13].error).toBeUndefined()
})

test('the auth note shows in /waypoint status while it lasts', async ($, on) => {
  const w = world(on, { run: () => fail(stderr.ghAuth), files: { [PLAN]: '# P\n\n### [~] WP1 — One\n' } })
  await start($)
  await command($, 'use purring-origami')
  await w.bash($, 'gh pr view 13', '')
  await w.clock.advance(750)
  expect(await command($, 'status')).toContain('gh not logged in — run gh auth login')
})

test('a missing gh binary (spawn rejects) is classified, toasted once', async ($, on) => {
  const w = world(on, { run: () => ({ exitCode: 127, stdout: '', stderr: '' }) })
  await start($)
  await w.bash($, 'gh pr view 13', '')
  await w.clock.advance(750)
  expect(w.toasts).toEqual(['waypoint: gh not installed'])
})

test('session entries migrate into the plan key when the plan path becomes known', async ($, on) => {
  const w = world(on, { files: { [PLAN]: '# P\n\n### [~] WP1 — One\n' } })
  await start($)
  await w.bash($, 'gh pr create --fill', 'https://github.com/phatjam98/eventhorizon/pull/13\n')
  expect(w.store[SESSION_KEY]).toBeDefined()
  await $.prompt.attachment({ type: 'plan_mode_exit', text: 'exit', origin: { kind: 'engine' }, detail: { planFilePath: PLAN, hasPlan: true } } as any)
  expect(w.store[SESSION_KEY]).toBeUndefined()
  expect(w.store[PLAN_KEY].entries[PR13]).toMatchObject({ source: 'session' })
})

const planWith = (prLine: string) =>
  `# P\n\n## Work packages\n\n### [x] WP1 — One\n\n### [~] WP2 — Two\n${prLine}\n\n### [ ] WP3 — Three\n`

test('plan refs get source plan + stepId; a re-parse drops vanished plan refs only', async ($, on) => {
  const w = world(on, { files: { [PLAN]: planWith('- PR: https://github.com/phatjam98/eventhorizon/pull/13') } })
  await start($)
  await command($, 'use purring-origami')
  const entry = w.store[PLAN_KEY].entries[PR13]
  expect(entry).toMatchObject({ source: 'plan', stepId: expect.stringContaining('wp2') })
  await w.bash($, 'gh pr view 14', '')
  expect(Object.keys(w.store[PLAN_KEY].entries).sort()).toEqual([PR13, 'github.com/phatjam98/eventhorizon#14'])
  w.write(PLAN, planWith('- (PR merged; line removed)'))
  await $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: PLAN, old_string: 'a', new_string: 'b' } as any)
  expect(Object.keys(w.store[PLAN_KEY].entries)).toEqual(['github.com/phatjam98/eventhorizon#14'])
})

test('plan prose numbers track nothing; a `- PR:` line tracks one ref on its step', async ($, on) => {
  const prose = 'Examples: #2, #3 and #5 were noisy; see #13, #31 and #123456 (#31).'
  const w = world(on, { files: { [PLAN]: planWith(prose) } })
  await start($)
  await command($, 'use purring-origami')
  expect(w.store[PLAN_KEY]).toBeUndefined()
  w.write(PLAN, planWith(`${prose}\n- PR: #13`))
  await $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: PLAN, old_string: 'a', new_string: 'b' } as any)
  expect(Object.keys(w.store[PLAN_KEY].entries)).toEqual([PR13])
  expect(w.store[PLAN_KEY].entries[PR13]).toMatchObject({ source: 'plan', stepId: expect.stringContaining('wp2') })
})

test('/waypoint track and untrack', async ($, on) => {
  const w = world(on)
  await start($)
  expect(await command($, 'track #21')).toBe('Tracking #21 (phatjam98/eventhorizon).')
  expect(w.store[SESSION_KEY].entries['github.com/phatjam98/eventhorizon#21']).toMatchObject({ source: 'manual' })
  expect(await command($, 'track https://gitlab.com/ecfx/ecfx-backend/-/merge_requests/6677')).toBe('Tracking !6677 (ecfx/ecfx-backend).')
  expect(await command($, 'untrack #21')).toBe('Untracked #21 (phatjam98/eventhorizon).')
  expect(await command($, 'untrack !6677')).toBe('Untracked !6677 (ecfx/ecfx-backend).')
  expect(w.store[SESSION_KEY]).toBeUndefined() // an empty store is deleted, never written
  expect(await command($, 'untrack #99')).toBe('Not tracked: #99')
})

test('/waypoint track #n with no session repo is an error', async ($, on) => {
  world(on, { repo: false })
  await start($)
  expect(await command($, 'track #5')).toContain('no GitHub repo for this session')
})

test('non-interactive sessions never poll', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  await w.bash($, 'gh pr view 13', '')
  await w.clock.advance(300_000)
  expect(w.runs).toHaveLength(0)
  expect(w.store[SESSION_KEY].entries[PR13]).toBeDefined()
})

const DAY = 86_400_000
/** A complete stored entry for PR `n` (the store drops entries missing what rows draw from). */
const full = (n: number, state: 'open' | 'merged' | 'closed', at: number) => ({
  kind: 'github', host: 'github.com', path: 'phatjam98/eventhorizon', number: n,
  id: `github.com/phatjam98/eventhorizon#${n}`, state, draft: false, checks: 'none', review: 'none', mergeable: 'unknown',
  title: `#${n}`, url: `https://github.com/phatjam98/eventhorizon/pull/${n}`, attention: null, source: 'session',
  firstSeenAt: at, lastPolledAt: null as number | null, failures: 0, ...(state === 'open' ? {} : { closedAt: at }),
})
const storeOf = (...es: ReturnType<typeof full>[]) => ({ version: 1, entries: Object.fromEntries(es.map(e => [e.id, e])) })

test('session start sweeps idle session keys and stale plan stores; keeps live ones', async ($, on) => {
  const w = world(on)
  w.store['waypoint:prs:session/IDLE'] = storeOf(full(1, 'open', NOW - 2 * DAY))
  w.store['waypoint:prs:session/RUNNING'] = storeOf({ ...full(1, 'open', NOW - 3 * DAY), lastPolledAt: NOW - 60_000 })
  w.store[SESSION_KEY] = storeOf(full(1, 'open', NOW))
  w.store['waypoint:prs:plan/old.md'] = storeOf(full(2, 'merged', NOW - 8 * DAY))
  w.store['waypoint:prs:plan/recent.md'] = storeOf(full(3, 'merged', NOW - 2 * DAY))
  w.store['waypoint:prs:plan/open.md'] = storeOf(full(4, 'open', NOW - 30 * DAY))
  w.store['waypoint:prs:plan/corrupt.md'] = { version: 1, entries: { x: { id: 'x', state: 'open' } } }
  w.store['layout'] = 'wide'
  await start($)
  expect(Object.keys(w.store).sort()).toEqual([
    'layout',
    'waypoint:prs:plan/open.md',
    'waypoint:prs:plan/recent.md',
    'waypoint:prs:session/RUNNING', // a concurrent session's PRs, polled a minute ago, stay
    SESSION_KEY,
  ])
})

test('session start prunes kept stores: a not-found entry after 3 failures goes', async ($, on) => {
  const w = world(on)
  const phantom = { ...full(5, 'open', NOW - DAY), error: 'not-found', failures: 3 }
  w.store['waypoint:prs:plan/live.md'] = storeOf(full(4, 'open', NOW - DAY), phantom)
  w.store['waypoint:prs:plan/only-phantom.md'] = storeOf(phantom)
  await start($)
  expect(Object.keys(w.store['waypoint:prs:plan/live.md'].entries)).toEqual(['github.com/phatjam98/eventhorizon#4'])
  expect(w.store['waypoint:prs:plan/only-phantom.md']).toBeUndefined()
})

test('every PR store write prunes: a closed entry older than 7 days goes on the next discovery', async ($, on) => {
  const w = world(on)
  w.store[SESSION_KEY] = storeOf(full(2, 'merged', NOW - 8 * DAY), full(3, 'merged', NOW - DAY))
  await start($)
  await w.bash($, 'gh pr view 13', '')
  expect(Object.keys(w.store[SESSION_KEY].entries).sort()).toEqual(['github.com/phatjam98/eventhorizon#13', 'github.com/phatjam98/eventhorizon#3'])
})

test('discovery false positives: flag values and other PR URLs in the output are not tracked', async ($, on) => {
  const w = world(on)
  await start($)
  await w.bash($, 'gh pr checks --watch --interval 10', '')
  await w.bash($, 'gh pr comment --body "fixed in 3 places"', '')
  expect(w.store[SESSION_KEY]).toBeUndefined()
  await w.bash($, 'gh pr view 5 --comments', 'see https://github.com/x/y/pull/99 and https://github.com/o/r/pull/7')
  expect(Object.keys(w.store[SESSION_KEY].entries)).toEqual(['github.com/phatjam98/eventhorizon#5'])
})
