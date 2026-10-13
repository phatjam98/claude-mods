// waypoint: pure tracking helpers (paths, resume rule, source precedence). No `$`, no I/O.
import type { PlanSource, StoredPlan } from '../types'

const DAY_MS = 24 * 60 * 60 * 1000

/** `~` and `~/x` expand against `home`; anything else is returned as is. */
export function expandHome(p: string, home: string): string {
  if (p === '~') return home
  if (p.startsWith('~/')) return `${home.replace(/\/+$/, '')}/${p.slice(2)}`
  return p
}

/** Collapse `//`, `.` and `..` segments; strip a trailing slash (root stays `/`). */
export function normalizePath(p: string): string {
  const abs = p.startsWith('/')
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
      else if (!abs) out.push('..')
      continue
    }
    out.push(seg)
  }
  const s = out.join('/')
  return abs ? `/${s}` : s || '.'
}

/** Same file after `~` expansion (when `home` is given) and path normalization. Empty paths never match. */
export function samePath(a: string | null | undefined, b: string | null | undefined, home?: string): boolean {
  if (!a || !b) return false
  const x = home === undefined ? a : expandHome(a, home)
  const y = home === undefined ? b : expandHome(b, home)
  return normalizePath(x) === normalizePath(y)
}

/**
 * `/waypoint use <arg>`: absolute and `~/` paths as given; anything containing `/` is cwd-relative;
 * a bare name is a slug in `planDir` (`<planDir>/<slug>.md`, a trailing `.md` on the slug is not doubled).
 */
export function resolveUseArg(arg: string, cwd: string, planDir: string, home: string): string {
  const a = arg.trim()
  if (a.startsWith('/')) return normalizePath(a)
  if (a === '~' || a.startsWith('~/')) return normalizePath(expandHome(a, home))
  if (a.includes('/')) return normalizePath(`${cwd}/${a}`)
  const dir = normalizePath(expandHome(planDir, home))
  return `${dir === '/' ? '' : dir}/${a.replace(/\.md$/i, '')}.md`
}

/** `$.store` key holding the last plan tracked in this cwd. */
export const storeKey = (cwd: string): string => `last:${cwd}`

/**
 * Resume a stored plan at session start when the file exists (`stat` non-null), was modified within
 * `resumeDays`, and is either unfinished or modified within the last 24 h. False means: delete the key.
 */
export function shouldResume(
  rec: StoredPlan | null | undefined,
  stat: { mtimeMs: number } | null | undefined,
  now: number,
  resumeDays: number,
): boolean {
  if (!rec || !rec.path || !stat) return false
  if (!(resumeDays > 0)) return false
  const age = now - stat.mtimeMs
  if (age > resumeDays * DAY_MS) return false
  return rec.percent < 100 || age <= DAY_MS
}

const RANK: Record<PlanSource, number> = { resume: 0, exit_plan: 1, plan_mode: 2, manual: 3 }

/** What `track(path, source)` should do given what is tracked now. */
export type TrackDecision = 'replace' | 'same' | 'keep'

/**
 * Source precedence: manual > plan_mode > exit_plan > resume. An incoming source replaces the current one
 * when it ranks the same or higher (so manual is only replaced by manual). The same path is `same`
 * (refresh only, source unchanged), whatever the source.
 */
export function nextSource(
  current: { path: string; source: PlanSource } | null | undefined,
  incoming: { path: string; source: PlanSource },
  home?: string,
): TrackDecision {
  if (!current) return 'replace'
  if (samePath(current.path, incoming.path, home)) return 'same'
  return RANK[incoming.source] >= RANK[current.source] ? 'replace' : 'keep'
}
