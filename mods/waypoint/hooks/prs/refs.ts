// waypoint PRs: discovering PR/MR references in remotes, text, Bash calls and
// `/waypoint track` arguments. Pure: no `$`, no I/O.

import type { PrKind, PrRef, RepoRef } from '../../types'

/** Parse a git remote (scp-like, ssh:// or https://) into a repo reference. */
export function parseRemote(remote: string | null | undefined): RepoRef | undefined {
  if (!remote) return undefined
  const r = remote.trim()
  let host: string | undefined
  let path: string | undefined
  const scp = /^[\w.-]+@([^:/\s]+):(?!\/)(.+)$/.exec(r)
  const url = /^(?:ssh|git|https?):\/\/(?:[^@/\s]+@)?([^/\s]+)\/(.+)$/i.exec(r)
  if (url) {
    host = url[1]
    path = url[2]
    // An ssh port is not the web port: drop it. Keep an https port.
    if (!/^https?:/i.test(r) && host) host = host.replace(/:\d+$/, '')
  } else if (scp) {
    host = scp[1]
    path = scp[2]
  }
  if (!host || !path) return undefined
  path = path.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '')
  if (!/^[\w.-]+(?:\/[\w.-]+)+$/.test(path)) return undefined
  host = host.toLowerCase()
  return { kind: host.includes('github') ? 'github' : 'gitlab', host, path }
}

export function prId(ref: PrRef): string {
  return `${ref.host}/${ref.path}${ref.kind === 'github' ? '#' : '!'}${ref.number}`
}

export function prLabel(ref: PrRef): string {
  return `${ref.kind === 'github' ? '#' : '!'}${ref.number}`
}

export function prUrl(ref: PrRef): string {
  return ref.kind === 'github'
    ? `https://${ref.host}/${ref.path}/pull/${ref.number}`
    : `https://${ref.host}/${ref.path}/-/merge_requests/${ref.number}`
}

function dedup(refs: PrRef[]): PrRef[] {
  const seen = new Set<string>()
  const out: PrRef[] = []
  for (const r of refs) {
    const id = prId(r)
    if (seen.has(id)) continue
    seen.add(id)
    out.push(r)
  }
  return out
}

function ref(kind: PrKind, host: string, path: string, n: string): PrRef {
  return { kind, host: host.toLowerCase(), path, number: Number(n) }
}

/** PR/MR web URLs in `text`. Kind is decided by the URL form, not the host. */
export function extractUrls(text: string): PrRef[] {
  const found: { at: number; ref: PrRef }[] = []
  for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+)\/([a-z0-9_.-]+\/[a-z0-9_.-]+)\/pull\/(\d+)\b/gi)) {
    if (m[1] && m[2] && m[3]) found.push({ at: m.index ?? 0, ref: ref('github', m[1], m[2], m[3]) })
  }
  for (const m of text.matchAll(
    /https?:\/\/([a-z0-9.-]+)\/((?:[a-z0-9_.-]+\/)+[a-z0-9_.-]+)\/-\/merge_requests\/(\d+)\b/gi,
  )) {
    if (m[1] && m[2] && m[3]) found.push({ at: m.index ?? 0, ref: ref('gitlab', m[1], m[2], m[3]) })
  }
  found.sort((a, b) => a.at - b.at)
  return dedup(found.map((f) => f.ref))
}

/** Replace every URL with spaces so fragments like `#issuecomment-1` or `page#12` never read as refs. */
function blankUrls(text: string): string {
  return text.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, (u) => ' '.repeat(u.length))
}

/** `#n` (GitHub) or `!n` / `group/project!n` (GitLab) refs, resolved against `repo`. URLs are ignored. */
export function extractShortRefs(text: string, repo: RepoRef): PrRef[] {
  let t = blankUrls(text)
  const out: PrRef[] = []
  if (repo.kind === 'github') {
    for (const m of t.matchAll(/(?<![\w/#])#(\d{1,6})\b/g)) {
      if (m[1]) out.push(ref('github', repo.host, repo.path, m[1]))
    }
  } else {
    t = t.replace(/(?<![\w/.-])((?:[a-z0-9_.-]+\/)+[a-z0-9_.-]+)!(\d{1,6})\b/gi, (whole, path: string, n: string) => {
      out.push(ref('gitlab', repo.host, path, n))
      return ' '.repeat(whole.length)
    })
    for (const m of t.matchAll(/(?<![\w/!])!(\d{1,6})\b/g)) {
      if (m[1]) out.push(ref('gitlab', repo.host, repo.path, m[1]))
    }
  }
  return dedup(out)
}

/** URLs plus, when a repo is known, short refs. Deduplicated by id, URLs first. */
export function extractRefs(text: string, repo?: RepoRef | null): PrRef[] {
  const urls = extractUrls(text)
  return repo ? dedup([...urls, ...extractShortRefs(text, repo)]) : urls
}

const GH_SUBS = new Set(['create', 'view', 'checks', 'merge', 'edit', 'ready', 'review', 'comment', 'diff', 'close', 'reopen'])
const GLAB_SUBS = new Set([
  'create', 'view', 'approve', 'revoke', 'merge', 'update', 'note', 'diff', 'close', 'reopen', 'rebase', 'checkout',
])

function unquote(tok: string): string {
  return tok.replace(/^['"]|['"]$/g, '')
}

/** The repo named by a `--repo` / `-R` value, for the CLI's kind. */
function repoFromFlag(value: string, kind: PrKind, session: RepoRef | null | undefined): RepoRef | undefined {
  const v = value.trim()
  if (!v) return undefined
  if (/:\/\/|^[\w.-]+@/.test(v)) {
    const r = parseRemote(v)
    return r ? { ...r, kind } : undefined
  }
  const segs = v.replace(/\/+$/, '').split('/').filter(Boolean)
  if (segs.length < 2) return undefined
  const defHost = session?.kind === kind ? session.host : kind === 'github' ? 'github.com' : 'gitlab.com'
  // gh takes [HOST/]OWNER/REPO; glab takes GROUP/NAMESPACE/REPO (a host needs a URL).
  if (kind === 'github' && segs.length >= 3) {
    return { kind, host: (segs[0] ?? '').toLowerCase(), path: segs.slice(1).join('/') }
  }
  return { kind, host: defHost, path: segs.join('/') }
}

type Scan = { scanned: boolean; named: boolean; refs: PrRef[] }

function scanSegment(seg: string, session: RepoRef | null | undefined): Scan {
  const toks = seg.trim().split(/\s+/).map(unquote).filter(Boolean)
  let at = -1
  let kind: PrKind = 'github'
  for (let i = 0; i + 2 < toks.length; i++) {
    const bin = (toks[i] ?? '').split('/').pop()
    const noun = toks[i + 1]
    const sub = toks[i + 2] ?? ''
    if (bin === 'gh' && noun === 'pr' && GH_SUBS.has(sub)) {
      at = i + 3
      kind = 'github'
      break
    }
    if (bin === 'glab' && noun === 'mr' && GLAB_SUBS.has(sub)) {
      at = i + 3
      kind = 'gitlab'
      break
    }
  }
  if (at < 0) return { scanned: false, named: false, refs: [] }
  let repo: RepoRef | undefined = session?.kind === kind ? session : undefined
  // Only the first positional counts, and only if no other flag precedes it:
  // a flag's value (`--interval 10`, `--body "3 places"`) is never the PR.
  let positional: string | undefined
  let done = false
  for (let i = at; i < toks.length; i++) {
    const t = toks[i] ?? ''
    if (t === '--repo' || t === '-R') {
      const r = repoFromFlag(toks[i + 1] ?? '', kind, session)
      if (r) repo = r
      i++
      continue
    }
    const eq = /^(?:--repo=|-R=?)(.+)$/.exec(t)
    if (eq && eq[1]) {
      const r = repoFromFlag(eq[1], kind, session)
      if (r) repo = r
      continue
    }
    if (done) continue
    done = true
    if (!t.startsWith('-')) positional = t
  }
  if (positional !== undefined) {
    const urls = extractUrls(positional)
    if (urls[0]) return { scanned: true, named: true, refs: [urls[0]] }
    if (/^[#!]?\d+$/.test(positional)) {
      const refs = repo ? [{ ...repo, number: Number(positional.replace(/^[#!]/, '')) }] : []
      return { scanned: true, named: true, refs }
    }
  }
  return { scanned: true, named: false, refs: [] }
}

/**
 * Refs touched by one Bash call: only single-PR `gh pr` / `glab mr` subcommands
 * count; list/search/api calls and anything else yield nothing. The output is
 * read only when a segment named no PR (`create`, bare `view`), and then only
 * its first PR/MR URL.
 */
export function discoverFromBash(input: {
  command: string
  text?: string | null
  repo?: RepoRef | null
}): PrRef[] {
  const out: PrRef[] = []
  let unnamed = false
  for (const seg of input.command.split(/&&|\|\||;|\||\n/)) {
    const r = scanSegment(seg, input.repo)
    if (!r.scanned) continue
    if (!r.named) unnamed = true
    out.push(...r.refs)
  }
  if (unnamed && input.text) {
    const have = new Set(out.map(prId))
    const first = extractUrls(input.text).find((r) => !have.has(prId(r)))
    if (first) out.push(first)
  }
  return dedup(out)
}

export type ManualRef = { ok: true; ref: PrRef } | { ok: false; error: string }

/**
 * `/waypoint track|untrack` argument: a URL, an id (`host/path#n`,
 * `host/path!n`), `group/proj!n`, or `#n` / `!n` against the session repo.
 */
export function resolveManualRef(arg: string, repo?: RepoRef | null): ManualRef {
  const a = arg.trim()
  if (!a) return { ok: false, error: 'usage: /waypoint track <url | #n | !n | group/project!n>' }
  const urls = extractUrls(a)
  if (urls[0]) return { ok: true, ref: urls[0] }
  const short = /^([#!])(\d{1,7})$/.exec(a)
  if (short && short[2]) {
    const kind: PrKind = short[1] === '#' ? 'github' : 'gitlab'
    if (repo?.kind !== kind) {
      const name = kind === 'github' ? 'GitHub' : 'GitLab'
      return { ok: false, error: `no ${name} repo for this session; give a full URL for ${a}` }
    }
    return { ok: true, ref: { ...repo, number: Number(short[2]) } }
  }
  const full = /^((?:[\w.-]+\/)+[\w.-]+)([#!])(\d+)$/.exec(a)
  if (full && full[1] && full[3]) {
    const kind: PrKind = full[2] === '#' ? 'github' : 'gitlab'
    const segs = full[1].split('/')
    const first = segs[0] ?? ''
    if (first.includes('.') && segs.length >= 3) {
      return { ok: true, ref: { kind, host: first.toLowerCase(), path: segs.slice(1).join('/'), number: Number(full[3]) } }
    }
    const host = repo?.kind === kind ? repo.host : kind === 'github' ? 'github.com' : 'gitlab.com'
    return { ok: true, ref: { kind, host, path: full[1], number: Number(full[3]) } }
  }
  return { ok: false, error: `not a PR/MR reference: ${a}` }
}
