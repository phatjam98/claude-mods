// waypoint: the state contract. Self-contained: no imports or references.

export type StepStatus = 'pending' | 'active' | 'done' | 'blocked' | 'skipped'
export type SubItem = { text: string; status: StepStatus; line: number }
export type PlanLink = { label: string; href: string; line: number }
export type Step = {
  index: number
  id: string
  short: string
  title: string
  status: StepStatus
  marked: boolean
  depth: number
  line: number
  endLine: number
  body: string
  children: SubItem[]
  links: PlanLink[]
}
export type PlanMode = 'marked' | 'pattern' | 'sections' | 'checkboxes' | 'ordered' | 'none'
export type PlanCounts = { total: number; done: number; active: number; blocked: number; pending: number; skipped: number }
export type PlanSnapshot = {
  path: string
  title: string
  displayTitle: string
  steps: Step[]
  mode: PlanMode
  stepDepth: number | null
  counts: PlanCounts
  percent: number
  currentIndex: number | null
  mtimeMs: number
  bytes: number
  truncated: boolean
  hash: string
  parsedAt: number
  warnings: string[]
}
export type PlanSource = 'manual' | 'plan_mode' | 'exit_plan' | 'resume'
export type Tracked = { path: string; source: PlanSource; since: number; cwd: string; missing: boolean }
export type Layout = 'auto' | 'compact' | 'wide'
export type WaypointUi = {
  paneOpen: boolean
  isPlaced: boolean
  /** The `/waypoint layout` choice; null = none stored, the `layout` option applies. */
  layout: Layout | null
  inPlanMode: boolean
  lastReadAt: number
  lastError: string | null
}
export type StoredPlan = { path: string; title: string; at: number; percent: number; sessionId: string }

export type PrKind = 'github' | 'gitlab'
export type PrSource = 'session' | 'plan' | 'manual'
export type PrState = 'open' | 'merged' | 'closed'
export type PrChecks = 'passing' | 'failing' | 'pending' | 'none'
export type PrReview = 'approved' | 'changes_requested' | 'review_required' | 'none'
export type PrMergeable = 'clean' | 'conflicting' | 'blocked' | 'unknown'
export type PrAttention = 'fix-ci' | 'address-review' | 'resolve-conflicts' | 'ready-to-merge' | null
export type RepoRef = { kind: PrKind; host: string; path: string }
export type PrRef = RepoRef & { number: number }
export type PrFacts = {
  state: PrState
  draft: boolean
  checks: PrChecks
  review: PrReview
  mergeable: PrMergeable
  title: string
  url: string
  headRef?: string
  updatedAt?: string
}
export type PrEntry = PrRef &
  PrFacts & {
    id: string
    attention: PrAttention
    source: PrSource
    stepId?: string
    firstSeenAt: number
    lastPolledAt: number | null
    closedAt?: number
    error?: string
    failures: number
  }
export type PrsStore = { version: 1; entries: Record<string, PrEntry> }
export type PrsView = { entries: PrEntry[]; lastPolledAt: number | null; note: string }

// --- Handoff: the note the model leaves when only the person can move the plan ---

export type HandoffKind = 'decision' | 'action' | 'answer'
export type HandoffItem = {
  kind: HandoffKind
  /** One line: what the person must do, decide or answer. */
  title: string
  /** A PR/MR url, `#n`, `!n` or a tracked PR id this item is about, if any. */
  ref?: string
  /** True when the plan cannot move until this is resolved. */
  blocking: boolean
}
export type Handoff = {
  /** 2–4 sentences: where things stand and what happens after the person acts. */
  summary: string
  items: HandoffItem[]
  /** When the model set it (ms). */
  at: number
  /** The session that set it. */
  sessionId: string
}

declare module 'claude-code' {
  interface PluginState {
    waypoint: {
      tracked: Tracked | null
      plan: PlanSnapshot | null
      ui: WaypointUi
      prs: PrsView
      prsToasted: string[]
      handoff: Handoff | null
      /** Plan file (absolute path) → key of the findings in the last lint note left after a write. */
      lintNoted: Record<string, string>
    }
  }
}
