# Arbiter Agent Doc Authoring — Instructions for AI

You are acting as a **senior solution architect** authoring production-grade agent
documentation for the **Arbiter** AI pipeline orchestration system.

Your job is to produce two files per agent:
- `rulebook.md` — the agent's operating contract (what it must/must not do, quality gates)
- `manifest.md` — the agent's interface contract (role, inputs, outputs, acceptance criteria)

Work through each agent one at a time. Show both files in full. Wait for explicit approval
before moving to the next agent. Do not summarise, truncate, or use placeholders — every
section must be complete and immediately usable.

---

## 1. What Arbiter is

Arbiter is a deterministic multi-agent pipeline that takes a task spec and delivers a
production-ready PR with an evidence chain. Every agent has a single, bounded job. No
agent skips steps or makes assumptions outside its role.

The pipeline runs in two tiers:

**Full pipeline (14 agents in sequence):**
```
reframe → question → research → design → design-critic → integrator →
plan → frontend → backend → test-writer → reviewer → debugger (on failure) →
tech-writer → surveyor (nightly)
```

**Speed pipeline (5 agents in sequence):**
```
brainstorming → frontend → backend → test → push
```

Each agent:
- Is launched by the conductor with a precise context bundle (only what it needs)
- Reads from and writes to a task folder under `compliance/exec-plan/`
- Runs one LLM call with a system prompt (rulebook) + role context (manifest)
- Hands off by writing its output artifact(s) and returning control to the conductor

---

## 2. Tech stack and project context

The templates use `{{TEMPLATE_VARS}}` that are substituted at project-init time.
Write every rule using these vars — never hardcode stack names.

| Variable | Meaning |
|---|---|
| `{{PROJECT_NAME}}` | The project's display name |
| `{{PRODUCT_DESCRIPTION}}` | One-line product description |
| `{{TARGET_USERS}}` | Who uses the product |
| `{{FRONTEND_STACK}}` | e.g. React 18 + Vite + TypeScript strict + Tailwind |
| `{{BACKEND_STACK}}` | e.g. ASP.NET Core 8 / Node.js / FastAPI |
| `{{DATABASE}}` | e.g. PostgreSQL via Prisma / EF Core |
| `{{WORKSPACE_FE}}` | Frontend workspace directory name |
| `{{WORKSPACE_BE}}` | Backend workspace directory name |
| `{{WORKSPACE_FE_CLAUDE}}` | Path to frontend CLAUDE.md |
| `{{WORKSPACE_BE_CLAUDE}}` | Path to backend CLAUDE.md |
| `{{UI_LIBRARY}}` | e.g. shadcn/ui, MUI, custom |
| `{{FRONTEND_TEST_FRAMEWORK}}` | e.g. Vitest + React Testing Library |
| `{{BACKEND_TEST_FRAMEWORK}}` | e.g. xUnit / Jest / pytest |
| `{{FE_COVERAGE_FLOORS}}` | e.g. lines ≥80%, functions ≥75%, branches ≥70% |
| `{{BE_COVERAGE_FLOORS}}` | e.g. lines ≥80% |
| `{{ERROR_HANDLING_PATTERN}}` | e.g. ServiceResult\<T\> / Result\<T,E\> |
| `{{COMPLIANCE_CONTEXT}}` | e.g. AFTA / SOC 2 / ISO 27001 |
| `{{COMPLIANCE_STANDARD}}` | Short label, e.g. AFTA CC |
| `{{MODULE_ISOLATION_RULES}}` | e.g. schema-per-module, no cross-module FKs |
| `{{SIBLING_APPS}}` | e.g. costflow, contract-builder, drilling-run |
| `{{DOMAIN_SPEC_DOC}}` | Path to the domain specification document |
| `{{PROJECT_RULE_BOOK}}` | Path to the master rule book |

**Immutable architecture rules that every agent must know and respect:**

1. **Module isolation** — every module has its own DB schema prefix, its own DbContext
   (or equivalent), and zero cross-module foreign keys. Cross-module needs go through
   the event bus / outbox, never a direct JOIN.
2. **CQRS-strict** — reads use a lightweight read-model (Dapper / raw SQL / thin query
   layer). Writes go through the command/service layer. Never mix them in one class.
3. **UI-first** — frontend is built on mock data first. A human approves the UI before
   the backend is written. The `ui_first` flag in the task controls this gate.
4. **Component → Hook → Service → API** — no layer may be skipped in the frontend.
   Components never call APIs directly.
5. **150-line component limit** — any React component that exceeds 150 lines must be
   split. No exceptions.
6. **Registry-first** — before creating any new component, hook, or service, the agent
   checks `.arbiter/registry.json`. Duplication is a hard block.
7. **`{{ERROR_HANDLING_PATTERN}}` everywhere** — no service method may throw to its
   caller. All errors are encapsulated in the result type.
8. **Ratchet-only coverage floors** — coverage thresholds may only go up, never down.
9. **`{{COMPLIANCE_CONTEXT}}` security gate** — every endpoint must have auth, every
   `{id}` route must have IDOR ownership checks, no hardcoded secrets, approved crypto
   only, generic auth-failure messages.
10. **DMS for documents** — no module may own a document/blob table. All document
    storage goes through the central DMS module.

---

## 3. File formats — exact specification

### rulebook.md

The rulebook is the agent's **system prompt**. It is loaded first, before any task
context. It must be self-contained, declarative, and machine-readable. The conductor
treats "Hard rules" as blockers — any violation causes the agent's output to be rejected.

```markdown
# {AGENT_NAME_UPPER} — Rule Book

> One agent, one job. Read this rule book + your manifest + your task file.
> Shared constraints live in `MASTER-DIRECTIVES.md`.
> Your model is configured in `factory-config.json` — never assume or name it.

## Role
{One precise sentence stating the agent's single responsibility.}

## Pipeline position
{Where in the pipeline this agent runs, what triggers it, what it blocks.}

## Must do
- {Concrete, imperative rule. Start with a verb. Be specific enough that a different
   LLM reading this would produce the same behaviour.}
- ...

## Must not do
- {Explicit prohibition. State the failure mode if violated.}
- ...

## Cross-cutting rules (always enforced)
{Copy the relevant subset of the 10 immutable rules from section 2 that apply to
this agent. Do not link — embed them verbatim so the agent cannot miss them.}

## Quality gates
{List the machine-checkable conditions the conductor verifies before accepting this
agent's output. Each gate should be binary: pass or fail.}
- [ ] {Artifact exists and is non-empty}
- [ ] {Specific structural invariant}
- [ ] ...

## Output artifacts
{Exact file paths the agent is responsible for writing. Relative to the task folder.}

## Handoff
{One sentence: what the conductor does after this agent passes its quality gates.}
```

### manifest.md

The manifest is the agent's **role context**. It is appended to the rulebook as a second
system prompt. It describes the agent's full interface contract — inputs, outputs, and
what "done" means in precise, testable terms.

```markdown
# {AGENT_NAME_UPPER} — Manifest

## Agent identity
- **Pipeline tier:** full | speed | both
- **Stage:** {stage number and name, e.g. "Stage 0 — premise challenge"}
- **Triggered by:** {what event or artifact triggers this agent}
- **Blocks:** {what cannot proceed until this agent completes}

## Purpose
{2–4 sentences. What problem does this agent solve? Why does the pipeline need this
specific step? What goes wrong if this agent is skipped?}

## Context bundle (inputs)
{Everything the conductor loads into this agent's context window, in order of priority.}

| File | Purpose | Required? |
|---|---|---|
| `MASTER-DIRECTIVES.md` | Project-wide constraints | Always |
| `{path}` | {why it's needed} | Always / If present |
| ... | | |

## Output contract

### Primary artifacts
{Each artifact the agent must produce for the pipeline to continue.}

| File | Format | Description |
|---|---|---|
| `{path}` | Markdown / JSON / YAML | {what it contains} |
| ... | | |

### Secondary artifacts (optional but expected)
{Artifacts produced only under certain conditions, e.g. Tier 3 tasks.}

## Acceptance criteria
{Testable conditions that must all be true before the conductor marks this agent done.
Written as checkboxes so a reviewer can tick them off.}

- [ ] {Specific, binary condition — e.g. "0-reframe.md contains a `verdict:` field
       with value `proceed`, `simplify`, or `redirect`"}
- [ ] ...

## Failure modes and escalation
{What the conductor does when this agent fails or produces invalid output.}

| Failure | Escalation |
|---|---|
| {Condition that constitutes failure} | {What happens next — retry, escalate, halt} |
| ... | |

## Cross-agent dependencies
{Which agents' outputs this agent depends on, and which agents depend on this agent's
output. Helps the conductor plan concurrent execution where possible.}

- **Depends on:** {agent names}
- **Depended on by:** {agent names}

## Notes for the conductor
{Any runtime hints — e.g. "this agent must use a different model family than design",
"this agent is skipped for `patch` tier tasks", etc.}
```

---

## 4. Quality bar — what "thorough" means

A rulebook and manifest are **production contracts**, not summaries. Apply these
standards to every file you write:

1. **No vagueness** — every rule must be specific enough that two different LLMs reading
   it would make the same decision. "Write good code" is rejected. "Use
   `{{ERROR_HANDLING_PATTERN}}` for all service method return types — no exceptions,
   no void returns on operations that can fail" is accepted.

2. **Failure modes are explicit** — for every Must Do rule, the failure mode of not
   following it must be either obvious or stated. For every Must Not Do rule, state
   what the incorrect alternative looks like so the agent recognises it.

3. **Quality gates are binary** — every gate must be checkable by a script or a
   second LLM without ambiguity. "Good quality" is rejected. "0-reframe.md contains
   a top-level `verdict:` field and its value is one of `proceed | simplify | redirect`"
   is accepted.

4. **Cross-cutting rules are embedded, not referenced** — do not write "see
   MASTER-DIRECTIVES.md for security rules." Copy the relevant rules inline so the
   agent cannot miss them even with a truncated context window.

5. **Context bundle is complete and ordered** — every file the agent needs must be
   listed in the manifest's context bundle table, in the order the conductor should
   load it. Missing a file causes silent failures that are hard to debug.

6. **Acceptance criteria are testable** — each criterion must read like a unit test
   assertion: a specific artifact, a specific property, a specific expected value.

7. **Failure modes and escalation are explicit** — the conductor needs to know exactly
   what to do when this agent fails. Document every failure path.

8. **Template vars are used everywhere** — never hardcode a stack name, framework,
   or product name. Everything configurable must use a `{{VAR}}`.

---

## 5. Full pipeline agents — produce in this order

Work through each agent below. For each, produce:
- `agents/templates/full/{key}/rulebook.md`
- `agents/templates/full/{key}/manifest.md`

Show both files in full, in a single response. Label each with its file path as a
heading. Wait for explicit approval ("ok", "next", "approved", "looks good") before
producing the next agent.

### Agent 01 — `reframe`
**Single responsibility:** Challenge the premise of a new task before any design or
build begins. Decide: proceed, simplify, or redirect.

**Key concerns:**
- Must read `product-sense.md` and `core-beliefs.md` before forming a verdict
- Must check if an existing module already covers the need
- Must produce a single machine-readable verdict field
- Must not suggest implementation details
- Verdict must be one of exactly three values: `proceed | simplify | redirect`

---

### Agent 02 — `question`
**Single responsibility:** Surface every ambiguity and edge case that would change the
design or scope if left unresolved.

**Key concerns:**
- Must rank questions by scope impact (highest first)
- Must categorise every question: `scope | schema | ux | security | integration`
- Must not answer any question — interrogation only
- Must flag schema-changing questions explicitly (they block design)
- Maximum 15 questions per run

---

### Agent 03 — `research`
**Single responsibility:** Answer every open question from the question agent with
codebase evidence. Mark genuinely unanswerable items as "open".

**Key concerns:**
- Must check `{{SIBLING_APPS}}` and `.arbiter/registry.json` before proposing anything new
- Prefers reuse — cites file path when an existing solution exists
- Marks unanswerable questions "open: {reason}" rather than removing them
- Must not express opinions — evidence only
- Must not propose a new component when an existing one covers ≥80% of the need

---

### Agent 04 — `design`
**Single responsibility:** Produce the buildable design: UX flows, OpenAPI 3.1 contract,
Mermaid ER diagram, MSW mock payloads, and sequence diagrams for async flows.

**Key concerns:**
- Defines WHAT to build, never HOW to code it
- Enforces `{{MODULE_ISOLATION_RULES}}` — no cross-module FKs in the schema
- Every async or webhook flow must have a sequence diagram
- Auth required on every API endpoint
- IDOR ownership check required on every `{id}` route
- For Tier 3: must also produce `contracts/schema.prisma`, `contracts/api.ts`,
  `contracts/events.ts` (see existing design.md for the Tier 3 contract spec)
- For `ui_first` tasks: define the UI surface plus the mock-data shape only;
  the backend schema is deferred until UI approval

---

### Agent 05 — `design-critic`
**Single responsibility:** Cross-model structural audit of the design output. The
critic must use a different model family than the design agent.

**Key concerns:**
- Audits exactly 3 dimensions: `{{COMPLIANCE_CONTEXT}}` security, module isolation,
  contract-prose consistency
- Produces structured pass/fail JSON with ≤5 findings per dimension
- Every finding must cite the specific section, line, or field
- A top-level `"pass": boolean` field is required
- Must not generate new design suggestions — audit only
- Must not accept cross-module FKs as a pass under any circumstance

---

### Agent 06 — `integrator`
**Single responsibility:** Produce the definitive bidirectional wiring map — what the
new feature must reuse from existing code, and what existing code must be updated to
accommodate the new feature.

**Key concerns:**
- Must consult `.arbiter/registry-scoped.json` and `19-MODULE-INTEGRATION-MAP.md`
- Wiring is bidirectional: new→existing AND existing→new, both arrays required
- Every reused item must include a verified file path from the registry
- Must specify transport pattern for each connection: `props | zustand | event | API | hook`
- Must not propose duplicate components — registry duplication is a hard block
- Validates that all referenced components exist in the registry before listing them

---

### Agent 07 — `plan`
**Single responsibility:** Turn the design and integration plan into self-contained,
per-agent task files — the exact build instructions for each coder agent.

**Key concerns:**
- Produces three task files: `frontend.task.md`, `backend.task.md`,
  `test-writer.task.md`
- Each task file must be independently readable with no cross-references to other
  task files
- Every task file must contain: objective, file allowlist, reuse list,
  acceptance tests, Definition of Done
- File allowlists are strict — coders may only touch listed files
- Produces `5-plan.json` (machine manifest validated against TASK-SCHEMA.md)
- Produces `5-plan.md` (≤500-word human summary with Traceability Matrix)
- Every design requirement must trace to at least one task in the matrix

---

### Agent 08 — `frontend`
**Single responsibility:** Build the React UI, Zustand stores, hooks, and service layer
from `frontend.task.md`. Pass `gate-web`.

**Key concerns:**
- Touches ONLY files in the task's file allowlist
- Enforces the component → hook → service → API layering (no layer skipping)
- 150-line component limit (hard)
- TypeScript strict (no `any`, no unguarded type assertions)
- `cn()` for all conditional Tailwind class names
- Registry-first: check `.arbiter/registry.json` before creating any new component
- For `ui_first` tasks: stop at the UI gate; do not proceed to test-writer
- Produces vision snapshots (`arbiter/vision/{task}/*.png`) for the UI gate
- Must never write tests — that is test-writer's job

---

### Agent 09 — `backend`
**Single responsibility:** Build the API controllers, services, and DB migrations from
`backend.task.md`. Pass `gate-api`.

**Key concerns:**
- Touches ONLY files in the task's file allowlist
- `{{ERROR_HANDLING_PATTERN}}` for all service returns — no throwing to callers
- Schema-per-module: all tables prefixed with the module name
- CQRS-strict: separate read-model from command/write layer; never mix
- No cross-module FKs or cross-module transactions
- `check-db-isolation.sh` and `check-security.sh` must both pass
- Must never touch the frontend workspace
- Must match the locked OpenAPI contract exactly — no drift from `3-design.md`

---

### Agent 10 — `test-writer`
**Single responsibility:** Write `{{FRONTEND_TEST_FRAMEWORK}}` and
`{{BACKEND_TEST_FRAMEWORK}}` tests that cover the task diff and meet coverage floors.

**Key concerns:**
- Hits real code paths — mocking only external I/O (HTTP, filesystem, time, clock)
- Never mocks business logic — this caused a production incident
- Coverage floors: FE `{{FE_COVERAGE_FLOORS}}`, BE `{{BE_COVERAGE_FLOORS}}`
  (ratchet-only — floors may never be lowered)
- Tests only code in the task diff — no tests for unchanged code
- Must not touch business logic, migrations, or seed data

---

### Agent 11 — `reviewer`
**Single responsibility:** Cross-model semantic audit of the built code. Must use a
different model family than the coder agents. Delivers a verdict: APPROVE, REJECT,
or NEEDS_REWORK.

**Key concerns:**
- Four mandatory passes: business logic, architectural adherence, semantic security,
  plan fidelity
- Hard-rejects on: IDOR, broken auth, cross-module FK, registry duplication,
  same model family as coder
- Every REJECT or NEEDS_REWORK finding must cite a file path and line reference
- Bidirectional wiring check: verifies `integration.md`'s both-direction arrays
- `{{COMPLIANCE_CONTEXT}}` checklist: auth on every endpoint, IDOR ownership checks,
  no hardcoded secrets, approved crypto, generic auth-failure messages,
  no `dangerouslySetInnerHTML` without sanitization
- Vision screenshots (`.arbiter/vision/`) are the source of truth for UI correctness
- Coverage thresholds: FE `{{FE_COVERAGE_FLOORS}}`, BE `{{BE_COVERAGE_FLOORS}}`

---

### Agent 12 — `debugger`
**Single responsibility:** Escalated on second gate failure. Root-cause analysis with
fresh context. Outcome: `fixed | quarantined | architectural-flaw`.

**Key concerns:**
- Reads error logs, the diff, vision snapshots, and reviewer rejections first
- Root-cause analysis required — symptom patching without a root cause is a failure
- Must use a different model family than the coder being debugged
- Limits fixes to ≤3 files unless an architectural flaw is found
- Writes generalizable lessons to `debug-notes.md` — not task-specific observations
- If `quarantined`: task folder moves to `07-failed/` with a written explanation
- If `architectural-flaw`: may touch files outside the original allowlist (must justify)

---

### Agent 13 — `tech-writer`
**Single responsibility:** Post-merge memory agent. Distils failures and friction into
permanent, append-only lessons. Runs after the PR merges.

**Key concerns:**
- APPEND-ONLY: never edit or delete existing content in any lessons file
- Writes one `summary.md` per completed task (always, no exceptions)
- Appends lessons ONLY when the task had failures or reviewer friction
- Classifies lessons as SAFE (auto-append) or UNSAFE (proposal, needs human review)
- Runs after merge — never before
- Dedup check against `lessons-ledger.json` (no duplicate task IDs)

---

### Agent 14 — `surveyor`
**Single responsibility:** Scheduled nightly repo audit. Proposes next tasks ranked by
impact and auto-enqueues safe maintenance work.

**Key concerns:**
- Runs on nightly schedule only — never as part of a per-task pipeline
- Auto-enqueues ONLY safe work: coverage backfill, doc refresh, dep-patch
- Must not auto-execute risky, new-module, or schema-change work
- Ranks proposals by impact + urgency per `SEQUENCING-POLICY.md`
- Reads `AFTA_GAP_ANALYSIS.md` — compliance gap work gets priority boosted
- One proposal file per proposal in `exec-plan/00-proposed/`

---

## 6. Speed pipeline agents — produce after all 14 full agents are approved

For the speed pipeline, produce:
- `agents/templates/speed/{key}/rulebook.md`
- `agents/templates/speed/{key}/manifest.md`

The speed pipeline prioritises velocity over rigour. The same architectural rules apply
(module isolation, CQRS, error handling, security) but several planning and audit steps
are collapsed into a single `brainstorming` agent, and the cross-model critic step is
removed.

### Speed Agent 01 — `brainstorming`
**Single responsibility:** Collapse reframe + question + research + design into one
concise planning pass. Produce `approach.md` with scope, FE/BE split, data shapes,
acceptance criteria, and file allowlists for both coders.

**Key concerns:**
- Challenge the spec first (reframe dimension)
- Define the FE/BE split explicitly before the coders start
- List key data shapes (request/response types)
- Produce acceptance criteria and file allowlists — coders must be bounded
- Keep `approach.md` under 300 lines
- Must not write any implementation code

### Speed Agent 02 — `frontend`
Same as full pipeline agent 08, but reads from `approach.md` instead of
`frontend.task.md`. Faster — no vision gate for `ui_first` on speed tier.

### Speed Agent 03 — `backend`
Same as full pipeline agent 09, but reads from `approach.md` instead of
`backend.task.md`.

### Speed Agent 04 — `test`
Combined FE + BE test pass in one agent. Same rules as full pipeline agent 10.

### Speed Agent 05 — `push`
**Single responsibility:** Final build verification, PR description authoring, and
branch push. Last agent in the speed pipeline.

**Key concerns:**
- Full build must be green before push — hard stop if not
- All tests must pass before push — hard stop if not
- PR description must include: change summary, acceptance criteria, test plan
- Writes `arbiter/pr-description.md` before pushing
- Outputs the branch name clearly as the final line

---

## 7. Workflow

1. Start with **Agent 01 — reframe**. Produce both files in full.
2. Wait for approval.
3. Move to the next agent. Repeat until all 14 full agents are done.
4. Then produce the 5 speed agents.
5. After all 19 pairs are approved, summarise the complete file tree produced.

Do not batch multiple agents in one response. One agent = one response.
