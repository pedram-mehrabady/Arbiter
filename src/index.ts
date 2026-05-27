// Public API — use these when embedding arbiter-core as a library

export { Conductor } from './conductor/Conductor';
export { StateStore } from './state/StateStore';
export { DecisionLog } from './decisions/DecisionLog';
export { FailureClassifier } from './classifiers/FailureClassifier';
export { PreflightCheck } from './preflight/PreflightCheck';
export { SecretsScanner } from './preflight/SecretsScanner';
export { ComplexityScorer } from './preflight/ComplexityScorer';
export { BuildReceiptStore } from './receipts/BuildReceipt';
export { GatePoller } from './gates/GatePoller';
export { GateRegistry } from './gates/GateRegistry';
export { RateLimiter } from './queue/RateLimiter';
export { TaskQueue } from './queue/TaskQueue';
export { ContextAssembler } from './context/ContextAssembler';
export { ContextPruner } from './context/ContextPruner';
export { AnthropicProvider } from './providers/AnthropicProvider';
export { estimateCost, estimateTokenCount, MODEL_COSTS } from './providers/LLMProvider';

export type {
  ServiceResult,
  AgentRole,
  SubTaskStatus,
  SubTaskEntry,
  TaskState,
  FailureClass,
  ComplexityTier,
  ComplexityScore,
  ComplexityInputs,
  DecisionLogEntry,
  BuildReceipt,
  LLMRequest,
  LLMResponse,
  RateLimitInfo,
  FactoryConfig,
  AgentConfig,
  BlastRadius,
  GateDefinition,
  GateStatus,
  UsageLedgerEntry,
  AssembledContext,
  ConductOptions,
} from './types/index';

export { TaskInitializer } from './task/TaskInitializer';
export { PlanValidator, formatPlanScore } from './plan/PlanValidator';
export { DECOMPOSABLE_ROLES, GENERIC_IMPL_IDS, FIXED_PIPELINE_IDS } from './plan/PlanOutput';
export { BundleAssembler } from './bundle/BundleAssembler';
export { BundleManifestBuilder, ALC_ARTIFACT_MAP, ALC_CONTROLS } from './bundle/BundleManifest';
export { GitCommitReader } from './bundle/GitCommitReader';

export type { LLMProvider } from './providers/LLMProvider';
export type { GateType, GateSpec } from './gates/GateRegistry';
export type { InitOptions, InitResult } from './task/TaskInitializer';
export type { BundleResult } from './bundle/BundleAssembler';
export type { BundleManifest, ALCControl } from './bundle/BundleManifest';
export type { GitCommit } from './bundle/GitCommitReader';
