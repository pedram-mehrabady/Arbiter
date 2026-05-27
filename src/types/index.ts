// ─── Core result type ─────────────────────────────────────────────────────────

export type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; code?: string };

// ─── Agent roles ──────────────────────────────────────────────────────────────

export type AgentRole =
  | 'reframe'
  | 'research'
  | 'design'
  | 'design-critic'
  | 'integrator'
  | 'plan'
  | 'backend'
  | 'frontend'
  | 'test-writer'
  | 'reviewer'
  | 'tech-writer'
  | 'debugger'
  | 'report-formatter'
  | 'gate-poller'
  | 'surveyor'
  | 'question';

// ─── Task + sub-task state ────────────────────────────────────────────────────

export type SubTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
export type TaskPhaseStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
export type FailureClass = 'infrastructure' | 'stochastic' | 'scope_overload';
export type ComplexityTier = 1 | 2 | 3;

export interface SubTaskEntry {
  status: SubTaskStatus;
  agent_role: AgentRole;
  model: string;
  depends_on?: string[];
  completed_at?: string;
  output_hash?: string;
  receipt_id?: string;
  strike?: number;
  last_failure_class?: FailureClass;
  output_dir?: string;
}

export interface TaskState {
  task_id: string;
  phase: string;
  phase_status: TaskPhaseStatus;
  created_at: string;
  updated_at: string;
  complexity_score?: ComplexityScore;
  sub_tasks: Record<string, SubTaskEntry>;
}

// ─── Complexity scoring ───────────────────────────────────────────────────────

export interface ComplexityInputs {
  file_count: number;
  new_dependency_count: number;
  crypto_or_validation_logic: number;
  subprocess_or_migration: number;
  cross_module_integration: number;
}

export interface ComplexityScore extends ComplexityInputs {
  weighted_total: number;
  tier: ComplexityTier;
}

// ─── Decision log ─────────────────────────────────────────────────────────────

export interface DecisionLogEntry {
  ts: string;
  task_id: string;
  sub_task?: string;
  event: string;
  class?: FailureClass;
  agent_role?: AgentRole;
  model?: string;
  detail: string;
}

// ─── Build receipts ───────────────────────────────────────────────────────────

export interface BuildReceipt {
  receipt_id: string;
  task_id: string;
  sub_task: string;
  agent_role: AgentRole;
  model: string;
  invocation_ts: string;
  context_hash: string;
  output_hashes: Record<string, string>;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  failure_class: FailureClass | null;
  strike_count: number;
  debugger_invoked: boolean;
  debugger_diff_hash: string | null;
  debugger_diff_pct: number | null;
  signature: string;
  signer_public_key_fingerprint: string;
}

// ─── LLM provider ─────────────────────────────────────────────────────────────

export interface LLMRequest {
  model: string;
  assembledPrompt: string;
  maxTokens: number;
  timeoutMs: number;
  agentRole?: string;
}

export interface RateLimitInfo {
  requestsLimit?: number;
  requestsRemaining?: number;
  tokensLimit?: number;
  tokensRemaining?: number;
  resetAt?: string;
}

export interface LLMResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  rateLimitInfo: RateLimitInfo;
  exitCode: number;
}

// ─── Factory config ───────────────────────────────────────────────────────────

export interface AgentConfig {
  provider: string;
  model: string;
  _role?: string;
}

export interface ProviderConfig {
  cmd?: string;
  headless_flag?: string;
  base_url?: string;
  api_key?: string;
  api_key_env?: string;
  endpoint?: string;
}

export interface GatesConfig {
  design: boolean;
  plan: boolean;
  review: boolean;
}

export interface TemplateVarsConfig {
  PROJECT_NAME?: string;
  STACK_FRONTEND?: string;
  STACK_BACKEND?: string;
  STACK_DATABASE?: string;
  STACK_TEST_FRAMEWORK?: string;
  PROJECT_CONVENTIONS?: string;
}

export interface FactoryConfig {
  auto_merge: boolean;
  roles: Record<string, AgentConfig>;
  providers: Record<string, ProviderConfig>;
  gates?: GatesConfig;
  template_vars?: TemplateVarsConfig;
}

// ─── Blast radius ─────────────────────────────────────────────────────────────

export interface BlastRadius {
  modules_touched: string[];
  new_modules_created: string[];
  cross_module_contracts_changed: boolean;
  new_data_schemas: boolean;
  new_cryptographic_surfaces: boolean;
  new_external_integrations: boolean;
  architectural_boundary_crossed: boolean;
  files_changed: string[];
}

// ─── Gates ───────────────────────────────────────────────────────────────────

export type GateStatus = 'pending' | 'approved' | 'rejected';

export interface GateDefinition {
  gate_id: string;
  type: string;
  task_id: string;
  sub_task?: string;
  created_at: string;
  context: string;
  status: GateStatus;
  resolved_at?: string;
  resolved_by?: string;
  comment?: string;
}

// ─── Usage ledger ─────────────────────────────────────────────────────────────

export interface UsageLedgerEntry {
  ts: string;
  task_id: string;
  sub_task: string;
  agent_role: AgentRole;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  total_cost_today_usd: number;
  context_tokens?: number;
  context_warning?: boolean;
}

// ─── Context ──────────────────────────────────────────────────────────────────

export interface AssembledContext {
  prompt: string;
  tokenEstimate: number;
  contextHash: string;
  filesIncluded: string[];
  pruned: boolean;
  prunedTokensSaved: number;
}

// ─── Conductor options ────────────────────────────────────────────────────────

export interface ConductOptions {
  resume: boolean;
  shadow: boolean;
  workspaceRoot: string;
  maxParallel: number;
  dryRun: boolean;
  // Optional provider override — injected by integration tests via MockProvider
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  provider?: any;
  // Auto-approve all human gates — integration tests only, never use in production
  autoApproveGates?: boolean;
}
