# Phase 09 — Competitive Moat: SubQ Provider + ACP Stub
# Status: [x] COMPLETE — 2026-05-28
# Prerequisite: Phase 08 complete (distribution done — v1.0 shipped)

## Objective
Add the two competitive moat features that differentiate Arbiter from AO and Routa.
SubQ as an optional Gate 5 provider (12M token context, no slicing needed).
ACP stub (interface types only — no implementation) so external agents can plug into
the Iron Funnel in v3 without a breaking type change.
After this phase: Arbiter v1.1. Power users can opt into SubQ for holistic repo review.
Third-party agents have a documented interface to implement.

---

## Deliverables

### 1. src/providers/SubQProvider.ts  [NEW]
Implements the `LLMProvider` interface.

```typescript
export class SubQProvider implements LLMProvider {
  constructor(private readonly config: SubQConfig) {}

  async run(request: LLMRequest): Promise<ServiceResult<LLMResponse>> {
    // POST to config.base_url + '/v1/messages'
    // Headers: Authorization: Bearer {config.api_key}
    // Body: { model: config.model, messages: [...], max_tokens: request.maxTokens }
    // Response shape: same as Anthropic SDK response (SubQ is API-compatible)
  }
}

interface SubQConfig {
  base_url: string;
  api_key: string;
  model: string;
  context_window: number;  // 12_000_000
}
```

Notes:
- SubQ claims Anthropic API compatibility — use same response parsing as AnthropicSdkProvider
- If SubQ API is not reachable: fallback to configured orchestrator model (Opus)
- Log: "SubQ unavailable — falling back to {fallback_model}"

### 2. src/conductor/IronFunnel.ts  [MODIFIED]
Gate 5 provider selection:
```typescript
// Gate 5: check if SubQ is configured for orchestrator role
const gate5Provider = this.resolveGate5Provider(config);
if (gate5Provider === 'subq') {
  // Skip Context Builder token budget for SubQ
  // Feed: full repo AST + PR diff (up to 12M tokens)
  const fullContext = await this.buildFullRepoContext(worktreePath);
  await orchestrator.wake(taskId, 'gate5_reached', { context: fullContext });
} else {
  // Standard path: madge-sliced context, 32k tokens
  await orchestrator.wake(taskId, 'gate5_reached', { prDiff, contracts });
}
```

`resolveGate5Provider()`:
- Reads `arbiter.config.json` roles.orchestrator.provider
- If 'subq' and SubQ configured in providers → return 'subq'
- Otherwise → return configured orchestrator provider (default: claude_max_cli)

### 3. arbiter.config.json  [MODIFIED]
Move `subq` from `planned_providers` to `providers` (it's now implemented):
```json
"providers": {
  "claude_max_cli": { ... },
  "anthropic_api": { ... },
  "local_mac_ollama": { ... },
  "subq": {
    "base_url": "https://api.subq.ai",
    "api_key": "{{SUBQ_API_KEY}}",
    "context_window": 12000000,
    "_note": "Premium Gate 5 provider. Opt-in via roles.orchestrator.provider = subq. Bypasses context slicing."
  }
},
```

### 4. src/acp/types.ts  [NEW]
ACP interface groundwork. Imported by nobody in MVP.

```typescript
export interface AgentCapability {
  id: string;
  name: string;
  version: string;
  description: string;
  input_schema: Record<string, unknown>;     // JSON Schema
  output_schema: Record<string, unknown>;
  supported_tiers: (1 | 2 | 3)[];
  gate_positions: (1 | 2 | 3 | 4 | 5)[];
  provider: string;
}

export interface AgentMessage {
  from: string;
  to: string;
  task_id: string;
  payload: Record<string, unknown>;
  ts: string;
  correlation_id: string;
}

export interface HandoffPayload {
  context_files: string[];
  contracts_path?: string;
  triage_result: import('../types/index').TriageResult;
  task_md: string;
}

export interface AcpHandshake {
  agent_id: string;
  capabilities: AgentCapability[];
  arbiter_version: string;
}
```

Exports from `src/index.ts` so it's available to consumers of the npm package:
```typescript
export * from './acp/types';
```

### 5. docs/ACP.md  [NEW]
Short documentation for third-party agent developers:
- What ACP is (2 paragraphs)
- How to implement an external agent for Arbiter v3
- The `AgentCapability` interface explained
- Which gate positions are available
- Expected input/output schema format
- Contact for v3 plugin registration

---

## Tests Required

### Unit tests
- tests/unit/SubQProvider.test.ts  [NEW]
  - Sends correct request format to SubQ API (mock fetch)
  - Parses Anthropic-compatible response correctly
  - Falls back to Opus when SubQ is unreachable (mock fetch throws)
  - Uses full context (no token budget) when provider is SubQ

- tests/unit/IronFunnel.subq.test.ts  [NEW]
  - Gate 5 uses SubQ context path when roles.orchestrator.provider = 'subq'
  - Gate 5 uses standard madge-sliced context when provider = 'claude_max_cli'

---

## Acceptance Criteria
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] SubQProvider implements LLMProvider interface (typecheck)
- [ ] SubQProvider falls back gracefully when API unreachable (unit test)
- [ ] Gate 5 uses full context for SubQ, sliced context for other providers (unit test)
- [ ] `src/acp/types.ts` exports all 4 interfaces
- [ ] `src/index.ts` exports ACP types
- [ ] `docs/ACP.md` exists and explains the interface
- [ ] `npm pack` tarball includes `src/acp/types.ts` compiled output
- [ ] All Playwright tests still pass

---

## Files Changed Summary
| Action | File |
|---|---|
| NEW | src/providers/SubQProvider.ts |
| NEW | src/acp/types.ts |
| NEW | docs/ACP.md |
| MODIFIED | src/conductor/IronFunnel.ts |
| MODIFIED | arbiter.config.json |
| MODIFIED | src/index.ts |
| NEW | tests/unit/SubQProvider.test.ts |
| NEW | tests/unit/IronFunnel.subq.test.ts |

---

## Phase 09 DONE when:
All acceptance criteria checked. Then update plan/README.md: Phase 09 → [x]
--- ARBITER v1.1 RELEASED ---
