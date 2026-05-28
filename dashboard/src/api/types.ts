export type JobStatus = 'planned' | 'plan-ready' | 'queued' | 'building' | 'paused' | 'done' | 'merged' | 'shipped' | 'failed';
export type AgentKey = 'reframe' | 'question' | 'research' | 'design' | 'design-critic' | 'plan' | 'integrator' | 'frontend' | 'backend' | 'test-writer' | 'debugger' | 'reviewer' | 'tech-writer' | 'surveyor';
export type OsType = 'mac' | 'win';
export type TabKey = 'arbiter' | 'flowmap' | 'graph' | 'traces' | 'mcp';

// exec-plan board projection (.arbiter/board.json, written by scripts/write-board.sh)
export interface BoardItem { id: string; title: string; archetype: string; }
export interface BoardData {
  generated: string;
  states: Record<string, BoardItem[]>;
  queue: string[];
  pending_gates?: PendingGate[];
}

// ── Conductor / Gate system ──────────────────────────────────────────────────
export type GateName = 'discovery' | 'design' | 'frontend' | 'schema';

export interface PendingGate {
  task_id: string;
  gate: GateName;
  since: string; // ISO timestamp
}

export interface ConductorMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: string;
}

export interface ConductorOpenItem {
  id: string;
  text: string;
  resolved: boolean;
}

export interface ConductorSession {
  task_id: string;
  current_gate: GateName;
  gate_status: 'waiting' | 'approved' | 'rejected';
  messages: ConductorMessage[];
  open_items: ConductorOpenItem[];
  all_resolved: boolean;
  context_token_estimate?: number;
}

export interface StageHistoryEntry {
  stage: string;
  duration_s: number;
  outcome: string;
  tokens_used?: number;
}

export interface ReworkEntry {
  to_stage: string;
  reason: string;
}

export interface PlanSections {
  requirements: string;
  acceptance: string;
  edgeCases: string;
  technical: string;
  openQuestions: string;
}

export interface Job {
  id: string;
  ticket?: string;
  title: string;
  app?: string;
  status: JobStatus;
  stage_label?: string;
  requirements?: string;
  complexity?: string;
  estimated_stages?: Record<string, string>;
  planSections?: PlanSections;
  rework_history?: ReworkEntry[];
  stage_history?: StageHistoryEntry[];
  stage_started_at?: string | null;
  queued_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  last_activity_ms?: number;
  tokens_used?: number;
  pr_url?: string;
  explanation?: string;
}

export interface ApprovalItem {
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail?: string;
}

export interface ApprovalDetails {
  database?: string;
  api_endpoints?: string[];
  complexity?: string;
  [key: string]: string | string[] | undefined;
}

export interface ApprovalLinks {
  brief?: string | null;
  pr?: string | null;
  pr_number?: number | null;
}

export interface PendingApproval {
  id: string;
  job_id: string;
  // mock shape
  stage?: string;
  summary?: string;
  items?: ApprovalItem[];
  approve_label?: string;
  // live shape
  ticket?: string;
  title?: string;
  gate?: string;
  gate_title?: string;
  details?: ApprovalDetails;
  links?: ApprovalLinks;
  warning?: string | null;
  // shared
  explanation?: string;
}

export interface PendingQuestion {
  id: string;
  job_id: string;
  question: string;
  why_asking: string;
  options?: { label: string; value: string }[];
  allow_free_text?: boolean;
}

export interface ImprovementItem {
  id: string;
  description: string;
  status: 'pending' | 'done' | 'rejected';
  affects?: string;
}

export interface AgentData {
  status: 'working' | 'idle' | 'unknown';
  task?: string;
  module?: string;
  phase?: string;
  started_at?: string;
}

export interface CliStatEntry {
  total_sessions: number;
  total_duration_s: number;
  total_context_in_chars: number;
  total_context_out_chars: number;
}

export type CliStats = Record<string, CliStatEntry>;

export interface ArbiterState {
  jobs: Job[];
  active_job?: Job | null;
  pending_approval?: PendingApproval | null;
  question?: PendingQuestion | null;
  improvements?: ImprovementItem[];
  pending_gates?: PendingGate[];
}

export interface ArbiterGate {
  key: GateName;
  label: string;
  description: string;
  after_agent: string;
}

export interface ArbiterConfig {
  project: string;
  arbiter_dir: string;
  exec_plan_dir: string;
  factory_config_path: string;
  agents_config_path: string;
  lessons_dir: string;
  worktree_prefix: string;
  branch_prefix: string;
  stack: Record<string, string>;
  gates: ArbiterGate[];
}

export const DEFAULT_ARBITER_CONFIG: ArbiterConfig = {
  project: 'foederata',
  arbiter_dir: '.arbiter',
  exec_plan_dir: 'compliance/exec-plan',
  factory_config_path: 'compliance/automation/factory-config.json',
  agents_config_path: 'compliance/automation/agents.config.json',
  lessons_dir: 'compliance/automation',
  worktree_prefix: 'foederata-wt',
  branch_prefix: 'feat/factory-',
  stack: {},
  gates: [
    { key: 'discovery', label: 'Gate 1 — Discovery Review', description: 'Review what the agents understood about this task before design begins.',          after_agent: 'research'    },
    { key: 'design',    label: 'Gate 2 — Design Review',    description: 'Review the design and schema decisions before implementation starts.',            after_agent: 'integrator'  },
    { key: 'frontend',  label: 'Gate 3 — Frontend Review',  description: 'Test the UI and confirm it is ready before backend and tests run.', after_agent: 'frontend'    },
  ],
};

export interface AgentConfigEntry {
  key: string;
  label: string;
  phase: string;
  emoji: string;
  color: string;
  role: string;
  rule_book: string;
  manifest: string;
  template: string;
  reads: string[];
  writes: string[];
  gate_before: string | null;
  gate_after: string | null;
}

export interface AgentsConfig {
  agents: AgentConfigEntry[];
}

export interface AppSettings {
  repoPath: string;
  os: OsType;
  anthropicApiKey: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  repoPath: '',
  os: 'mac',
  anthropicApiKey: '',
};

export interface PlanAnalysis {
  ticket: string;
  title: string;
  complexity: 'Simple' | 'Medium' | 'Complex' | 'Epic';
  requirements: string;
  estimated_stages?: Record<string, string>;
}

// ── Plans backlog (dashboard-owned, persisted locally + mirrored to .arbiter/plans/*.md) ──
export type PlanStatus = 'draft' | 'ready';
export type PlanType = 'feature' | 'bug' | 'refactor' | 'chore';

export interface PlanItem {
  id: string;
  ticket: string;
  title: string;
  planType: PlanType;
  complexity?: string;
  priority: number;            // 0 = top of the queue
  status: PlanStatus;          // draft = editing brief, ready = submitted to factory
  md: string;                  // raw markdown brief — editable before factory picks it up
  estimated_stages?: Record<string, string>;
  deferred?: boolean;          // skipped during extraction — kept as future idea
  extraDocs?: string;          // extra reference docs handed to factory alongside the brief
  created_at: string;
}

// Two-way chat log between the dashboard (Pedram) and the CLIs (.arbiter/messages.json)
export interface CliMessage {
  from: string;    // 'pedram' for the user, or an agent key: 'babysitter' | 'front' | 'backend' | 'push'
  to?: string;     // target agent key when from === 'pedram'
  ticket?: string; // plan this message belongs to (so the dashboard shows it on the plan)
  text: string;
  ts: string;
}

// Coordinator babysitter → dashboard: "open this CLI for me" (.arbiter/launch-requests/{agent}.json)
export interface LaunchRequest {
  agent: string;     // babysitter | front | backend | push | review
  ticket?: string;
  prompt?: string;   // the exact first message for that CLI
}

// Dashboard → babysitter: "order these so they don't overlap"
export interface PlanOrderRequest {
  requested_at: string;
  plans: { ticket: string; title: string; md: string }[];
}

// babysitter → dashboard: recommended non-overlapping order
export interface PlanOrderResult {
  ordered_tickets: string[];
  reasons?: Record<string, string>;
  computed_at: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type WidgetId =
  | 'quick-actions'
  | 'agents'
  | 'cli-stats'
  | 'worklog'
  | 'active-jobs'
  | 'improvements'
  | 'done-jobs';

export interface WidgetDef {
  title: string;
  defaultSpan: number; // 1–5 (columns in a 5-col grid)
}

export const WIDGET_DEFS: Record<WidgetId, WidgetDef> = {
  'quick-actions': { title: 'Quick Actions',  defaultSpan: 1 },
  'cli-stats':     { title: 'CLI Stats',       defaultSpan: 1 },
  'worklog':       { title: 'Work Log',        defaultSpan: 1 },
  'agents':        { title: 'Agent Activity',  defaultSpan: 2 },
  'active-jobs':   { title: 'Active Jobs',     defaultSpan: 3 },
  'improvements':  { title: 'Improvements',    defaultSpan: 2 },
  'done-jobs':     { title: 'Merged Jobs',     defaultSpan: 5 },
};

export const DEFAULT_WIDGET_SIZES: Record<WidgetId, number> = Object.fromEntries(
  Object.entries(WIDGET_DEFS).map(([k, v]) => [k, v.defaultSpan])
) as Record<WidgetId, number>;

export const DEFAULT_WIDGET_ORDER: WidgetId[] = [
  'quick-actions', 'cli-stats', 'worklog', 'agents',
  'active-jobs', 'improvements',
  'done-jobs',
];
