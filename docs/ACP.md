# Agent Capability Protocol (ACP)

ACP is Arbiter's interface contract for external agents. It defines the types an agent must implement to plug into the Iron Funnel in Arbiter v3 without requiring a breaking change. In v1 and v2, all agents are built-in; ACP ships as type-only groundwork so third-party agent authors can build against a stable interface today.

ACP is intentionally minimal. It describes *what an agent can do* (`AgentCapability`), *how agents exchange messages* (`AgentMessage`), *what context Arbiter hands off at each gate* (`HandoffPayload`), and *how agents announce themselves* (`AcpHandshake`). No runtime SDK is included — agents bring their own execution environment.

## Interfaces

### `AgentCapability`

Declares what an external agent can do and where in the pipeline it may be inserted.

```typescript
interface AgentCapability {
  id: string;                          // unique agent identifier, e.g. "acme-security-scanner"
  name: string;                        // human-readable display name
  version: string;                     // semver string
  description: string;                 // one-line capability description
  input_schema: Record<string, unknown>;  // JSON Schema of the HandoffPayload fields this agent reads
  output_schema: Record<string, unknown>; // JSON Schema of the structured output this agent produces
  supported_tiers: (1 | 2 | 3)[];     // which pipeline tiers this agent supports
  gate_positions: (1 | 2 | 3 | 4 | 5)[];  // which gates the agent may occupy
  provider: string;                    // provider key from arbiter.config.json
}
```

### `AgentMessage`

Used for intra-pipeline communication between Arbiter and external agents.

```typescript
interface AgentMessage {
  from: string;           // sender agent ID
  to: string;             // recipient agent ID or "arbiter"
  task_id: string;        // Arbiter task ID
  payload: Record<string, unknown>;
  ts: string;             // ISO 8601 timestamp
  correlation_id: string; // links request/response pairs
}
```

### `HandoffPayload`

The context Arbiter hands to an external agent when it is invoked at a gate.

```typescript
interface HandoffPayload {
  context_files: string[];       // relative paths of files the agent should read
  contracts_path?: string;       // path to contracts/ directory if available
  triage_result: TriageResult;   // tier, profile, complexity hint
  task_md: string;               // the original task description
}
```

### `AcpHandshake`

Sent by an external agent on startup to announce itself to Arbiter.

```typescript
interface AcpHandshake {
  agent_id: string;
  capabilities: AgentCapability[];
  arbiter_version: string;  // minimum Arbiter version required
}
```

## Implementing an External Agent

1. Import the ACP types from the npm package:
   ```typescript
   import type { AgentCapability, HandoffPayload, AcpHandshake } from '@arbiter-pipeline/cli';
   ```

2. Declare your capabilities in a `capabilities.json` (same shape as `AgentCapability[]`).

3. On startup, send an `AcpHandshake` to the Arbiter socket (v3 feature — not yet active).

4. When invoked, receive a `HandoffPayload` via stdin and write a structured result to stdout with `ok: true | false` and an optional `reason` string.

## Available Gate Positions

| Gate | Type | When invoked |
|------|------|-------------|
| 1 | deterministic | After compile — before tests are written |
| 2 | llm | Test writer slot — generate or augment tests |
| 3 | deterministic | After test run — before debugger |
| 4 | llm | Debugger slot — fix failing tests |
| 5 | llm | Semantic review — final approval gate |

External agents may occupy gate positions 2, 4, or 5. Deterministic gates (1, 3) are reserved for Arbiter's built-in runners.

## Contact

To register a v3 plugin or discuss the ACP spec, open an issue at `https://github.com/arbiter-pipeline/arbiter`.
