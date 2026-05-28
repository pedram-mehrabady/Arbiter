// ── Agent doc templates ───────────────────────────────────────────────────────
// Default rule book and manifest markdown for each pipeline agent.
// Used by AgentDocModal to populate new files when they don't exist in the repo.

export interface AgentTemplates {
  rulebook: string;
  manifest: string;
}

// ── Full pipeline (14 agents) ─────────────────────────────────────────────────

export const FULL_TEMPLATES: Record<string, AgentTemplates> = {

  reframe: {
    rulebook: `# REFRAME — Rule Book

## Must do
- Read spec.md, MASTER-DIRECTIVES.md, product-sense.md, and core-beliefs.md before forming a verdict
- Challenge the premise: could an existing feature handle this without changes?
- Produce a single verdict: proceed | simplify | redirect
- Include brief reasoning (≤3 sentences) for each verdict
- Flag scope that is clearly too broad before anyone writes code

## Must not do
- Write any code or implementation details
- Answer questions — only challenge the premise
- Mark "proceed" if a simpler solution exists in the codebase
- Skip reading MASTER-DIRECTIVES.md

## Quality gates
- 0-reframe.md exists and contains a top-level verdict field
- Verdict is one of: proceed | simplify | redirect
- Reasoning is present and ≤ 10 lines
`,
    manifest: `# REFRAME — Manifest

## Role
Challenges the task premise before anyone writes code — decides whether to proceed, simplify, or redirect.

## Inputs
- spec.md (the feature brief to evaluate)
- MASTER-DIRECTIVES.md (project-wide constraints)
- product-sense.md (product philosophy)
- core-beliefs.md (engineering beliefs)

## Outputs
- 0-reframe.md (verdict: proceed | simplify | redirect + reasoning)

## Acceptance criteria
- Verdict field is present and machine-readable (lowercase, one word)
- Reasoning is concise and references at least one input file
- File is written before any downstream agent starts
`,
  },

  question: {
    rulebook: `# QUESTION — Rule Book

## Must do
- Read spec.md, 0-reframe.md, and MASTER-DIRECTIVES.md before generating questions
- Surface only questions that, if unanswered, would change the design or scope
- Rank questions by impact: highest-impact first
- Mark each question with a category: scope | schema | ux | security | integration

## Must not do
- Answer any question — only interrogate
- Generate questions about implementation style or preference
- Skip questions that could change the DB schema
- Include more than 15 questions per run

## Quality gates
- 1-questions.md exists and contains at least 1 question
- Every question is categorised
- No question is answered inline
`,
    manifest: `# QUESTION — Manifest

## Role
Surfaces ambiguities and edge cases that would change design or scope; never answers, only interrogates.

## Inputs
- spec.md (the feature brief)
- 0-reframe.md (reframe verdict and reasoning)
- MASTER-DIRECTIVES.md (project-wide constraints)
- product-sense.md (product philosophy)

## Outputs
- 1-questions.md (ranked open questions — input to research agent)

## Acceptance criteria
- Questions are ranked by scope-impact (highest first)
- No question implies its own answer
- At least one question covers auth/security implications if the feature touches user data
`,
  },

  research: {
    rulebook: `# RESEARCH — Rule Book

## Must do
- Read 1-questions.md and answer every question with codebase evidence
- Search sibling apps (costflow, contract-builder, drilling-run, debt-ledger) before proposing anything new
- Consult .arbiter/registry.json for existing components, hooks, and services
- Mark questions that remain genuinely unanswerable as "open" with an explanation
- Prefer reuse over invention — cite the file path when an existing solution exists

## Must not do
- Propose new components when an existing one covers ≥80% of the need
- Skip registry.json lookup
- Answer questions with opinions — use codebase evidence only
- Remove unanswerable questions; mark them "open" instead

## Quality gates
- 2-research.md exists and contains one answer block per question from 1-questions.md
- Every proposed reuse includes a file path
- Open items are explicitly labelled "open: <reason>"
`,
    manifest: `# RESEARCH — Manifest

## Role
Answers every open question from the question agent with codebase evidence; flags genuinely unanswerable items.

## Inputs
- 1-questions.md (open questions from question agent)
- .arbiter/registry.json (component and service registry)
- MASTER-DIRECTIVES.md (project-wide constraints)

## Outputs
- 2-research.md (evidence-backed answers; open items explicitly flagged)

## Acceptance criteria
- Every question from 1-questions.md has a corresponding answer block
- At least one codebase file path is cited per answer where a component exists
- Open items include an explanation of why they cannot be resolved from the codebase
`,
  },

  design: {
    rulebook: `# DESIGN — Rule Book

## Must do
- Define WHAT to build, not HOW to code it
- Produce UX flows, OpenAPI 3.1 contracts, Mermaid ER diagrams, and MSW mock payloads
- Stay within the module boundary — no cross-module foreign keys
- Read and incorporate 0-reframe.md verdict before designing
- Output a 11-section 3-design.md following DESIGN-SCHEMA.md

## Must not do
- Write any implementation code or suggest specific libraries (beyond the established stack)
- Create cross-module DB relationships
- Skip sequence diagrams for any async or webhook flow
- Contradict the reframe verdict without recording why

## Quality gates
- 3-design.md passes DESIGN-SCHEMA.md validation
- generated/api-contracts/<task>.json is valid OpenAPI 3.1
- generated/db-schema/<task>.mmd is valid Mermaid ER
- MSW mock payloads match OpenAPI schema shapes
`,
    manifest: `# DESIGN — Manifest

## Role
Defines what to build and produces the locked API/DB contract that frontend and backend are both bound by.

## Inputs
- spec.md (feature brief)
- 0-reframe.md (reframe verdict)
- 2-research.md (research answers)
- MASTER-DIRECTIVES.md (project constraints)
- MODULE_ARCHITECTURE_TLDR.md (module isolation rules)
- CQRS_API_CHEATSHEET.md (query/command patterns)
- design-system.md (UI component conventions)
- security.md (security requirements)
- .arbiter/db-schema-snapshot.md (current schema)

## Outputs
- 3-design.md (11-section human spec)
- generated/api-contracts/<task>.json (OpenAPI 3.1)
- generated/db-schema/<task>.mmd (Mermaid ER diagram)
- generated/sequence-diagrams/<task>.mmd (async flows)
- generated/mocks/<task>.json (MSW payloads)

## Acceptance criteria
- 3-design.md has all 11 required sections
- OpenAPI contract is valid and all endpoints match UX flows
- No cross-module foreign keys in ER diagram
- Sequence diagrams present for every async or webhook flow
`,
  },

  'design-critic': {
    rulebook: `# DESIGN-CRITIC — Rule Book

## Must do
- Use a different model family than the design agent (cross-model invariant)
- Audit exactly 3 dimensions: AFTA/security compliance, module isolation, contract-vs-prose consistency
- Produce structured pass/fail JSON with ≤5 findings per dimension
- Reference the specific section, line, or field that caused each finding
- Emit a top-level "pass" boolean — false if any dimension fails

## Must not do
- Generate new design suggestions — only audit what was produced
- Accept cross-module foreign keys as a pass
- Skip security dimension even if the feature seems read-only
- Produce more than 5 findings per dimension

## Quality gates
- design-critic-report.json is valid JSON matching DESIGN-SCHEMA.md critic schema
- "pass" field is present and boolean
- Each finding includes dimension, severity, and a reference to the source line/section
`,
    manifest: `# DESIGN-CRITIC — Manifest

## Role
Cross-model structural audit of the design output across AFTA security compliance, module isolation, and contract-prose consistency.

## Inputs
- 3-design.md (human spec from design agent)
- generated/api-contracts/<task>.json (OpenAPI contract)
- generated/db-schema/<task>.mmd (Mermaid ER)
- MASTER-DIRECTIVES.md (project constraints)
- MODULE_ARCHITECTURE_TLDR.md (isolation rules)
- security.md (security requirements)
- DESIGN-SCHEMA.md (schema for validation)

## Outputs
- design-critic-report.json (pass/fail per dimension; ≤5 findings each)

## Acceptance criteria
- All 3 dimensions are evaluated
- Each finding has: dimension, severity (error|warn), reference, and description
- Overall pass = true only if all 3 dimensions pass with no errors
`,
  },

  integrator: {
    rulebook: `# INTEGRATOR — Rule Book

## Must do
- List every existing component, hook, service, and store the new feature must reuse (new → existing)
- List every existing consumer that must be updated to integrate the new feature (existing → new)
- Specify the transport pattern for each connection (props | zustand | event | API call | hook)
- Read .arbiter/registry-scoped.json and 19-MODULE-INTEGRATION-MAP.md before writing
- Validate that all reused components exist in the codebase

## Must not do
- Propose duplicate components when existing ones can be extended
- Skip bidirectional wiring — both directions are required
- Omit the transport pattern for any connection
- Make up component paths — verify against registry

## Quality gates
- integration.md contains all 8 required sections per INTEGRATION-SCHEMA.md
- Every reused item includes a verified file path
- Bidirectional wiring arrays are present (new-uses-existing AND existing-updated-for-new)
`,
    manifest: `# INTEGRATOR — Manifest

## Role
Produces the definitive list of what to reuse and how new code wires to existing modules — kills integration amnesia.

## Inputs
- 3-design.md (design spec)
- generated/api-contracts/<task>.json (OpenAPI contract)
- generated/db-schema/<task>.mmd (Mermaid ER)
- MASTER-DIRECTIVES.md (project constraints)
- INTEGRATION-SCHEMA.md (integration map schema)
- REGISTRY-SCHEMA.md (registry entry schema)
- .arbiter/registry-scoped.json (scoped component registry)
- 19-MODULE-INTEGRATION-MAP.md (existing module integration map)

## Outputs
- integration.md (8 required sections with JSON wiring arrays)

## Acceptance criteria
- All 8 sections are present per INTEGRATION-SCHEMA.md
- Every reused component has a verified file path from the registry
- Both new→existing and existing→new wiring arrays are populated
`,
  },

  plan: {
    rulebook: `# PLAN — Rule Book

## Must do
- Generate one task file per coder agent: frontend.task.md, backend.task.md, test-writer.task.md
- Each task file must be self-contained: objective, file allowlist, reusable components, acceptance tests, Definition of Done
- Produce 5-plan.json validated against TASK-SCHEMA.md
- Reference integration.md's reuse list in each task file
- Keep the Traceability Matrix in 5-plan.md linking each design requirement to a task

## Must not do
- Create task files without a bounded file allowlist
- Leave acceptance tests out of any task file
- Cross-reference task files — each must be independently readable
- Produce 5-plan.json without validating against TASK-SCHEMA.md

## Quality gates
- All three task files exist and contain the 5 required sections
- 5-plan.json passes TASK-SCHEMA.md validation
- 5-plan.md is ≤500 words with a Traceability Matrix
`,
    manifest: `# PLAN — Manifest

## Role
Turns the design and integration plan into self-contained per-agent task files — the coders' exact instructions.

## Inputs
- 3-design.md (design spec)
- integration.md (reuse and wiring map)
- MASTER-DIRECTIVES.md (project constraints)
- TASK-SCHEMA.md (task file schema)
- TASK-ARCHETYPES.md (task archetypes)
- 2-research.md (research evidence)
- .arbiter/codebase-tree.md (current file tree)

## Outputs
- 5-plan.md (≤500-word human summary with Traceability Matrix)
- 5-plan.json (machine manifest; validated against TASK-SCHEMA)
- tasks/frontend.task.md (self-contained FE task)
- tasks/backend.task.md (self-contained BE task)
- tasks/test-writer.task.md (self-contained test task)

## Acceptance criteria
- Each task file contains: objective, file allowlist, reuse list, acceptance tests, Definition of Done
- 5-plan.json is valid per TASK-SCHEMA.md
- Traceability Matrix links every design requirement to at least one task
`,
  },

  frontend: {
    rulebook: `# FRONTEND — Rule Book

## Must do
- Implement exactly what tasks/frontend.task.md specifies — no more, no fewer files
- Stay within the file allowlist in the task file
- Reuse every component listed in integration.md's reuse section
- Match the OpenAPI contract and MSW mock payloads from design exactly
- Produce vision snapshots (.arbiter/vision/<task>/*.png) for the UI gate
- Pass gate-web.sh on the first attempt

## Must not do
- Create files outside the task file allowlist
- Bypass the service layer — Component → Hook → Service → API always
- Hard-code values that belong in environment variables
- Skip the Zustand store if the task requires shared state

## Quality gates
- scripts/gate-web.sh passes (typecheck + lint + coverage + build)
- frontend-report.json exists with gate results
- Vision snapshots generated for all routes in the task
`,
    manifest: `# FRONTEND — Manifest

## Role
Builds React UI components, Zustand stores, hooks, and service layer from the task file — bounded by the allowlist.

## Inputs
- tasks/frontend.task.md (self-contained build instructions)
- 3-design.md (design spec)
- generated/api-contracts/<task>.json (OpenAPI contract)
- generated/mocks/<task>.json (MSW payloads)
- integration.md (reuse and wiring map)
- frontend-standards.md (FE coding standards)
- design-system.md (UI component library)
- ui-component-registry.md (available components)
- web/CLAUDE.md (project-specific FE context)

## Outputs
- web/src/** (bounded by task file allowlist)
- frontend-report.json (gate results)
- .arbiter/vision/<task>/*.png (route screenshots for UI gate)

## Acceptance criteria
- All acceptance tests in tasks/frontend.task.md pass
- gate-web.sh exits 0
- No files created outside the allowlist
- Every API call matches the OpenAPI contract shape
`,
  },

  backend: {
    rulebook: `# BACKEND — Rule Book

## Must do
- Implement exactly what tasks/backend.task.md specifies — no more, no fewer files
- Stay within the file allowlist in the task file
- Use ServiceResult<T> for all service returns — never throw
- Use schema-per-module: all tables prefixed with the module name
- Separate EF Core (writes) from Dapper (reads) per CQRS-strict rules
- Pass gate-api.sh including check-db-isolation.sh and check-security.sh

## Must not do
- Create cross-module foreign keys
- Touch web/ or any frontend file
- Use a single DbContext for both reads and writes
- Throw exceptions from service methods

## Quality gates
- scripts/gate-api.sh passes (build + db-isolation + security)
- No cross-module FK in any migration
- All service methods return ServiceResult<T>
`,
    manifest: `# BACKEND — Manifest

## Role
Builds ASP.NET Core controllers, services, and EF Core migrations from the task file — module-isolated and security-first.

## Inputs
- tasks/backend.task.md (self-contained build instructions)
- 3-design.md (design spec)
- generated/api-contracts/<task>.json (OpenAPI contract)
- backend-standards.md (BE coding standards)
- reliability.md (reliability requirements)
- security.md (security requirements)
- api/CLAUDE.md (project-specific BE context)
- MASTER-DIRECTIVES.md (project constraints)

## Outputs
- api/src/** (bounded by task file allowlist)

## Acceptance criteria
- All acceptance tests in tasks/backend.task.md pass
- gate-api.sh exits 0
- No cross-module foreign keys in any migration
- All endpoints match the OpenAPI contract exactly
`,
  },

  'test-writer': {
    rulebook: `# TEST-WRITER — Rule Book

## Must do
- Write Vitest tests for web/ and xUnit tests for api/ covering the task diff
- Hit real code paths — no mocks of business logic
- Meet the coverage floors defined in web/vitest.config.ts and api/Directory.Build.props
- Use the task file's acceptance tests as the primary test specification
- Follow patterns in test-patterns.md

## Must not do
- Mock business logic — only mock external I/O (HTTP, filesystem, time)
- Write tests for code outside the task file's diff
- Lower coverage floors to make tests pass
- Duplicate tests that already exist for unchanged code

## Quality gates
- Coverage floors pass for both web/ and api/
- All new acceptance tests pass
- No business-logic mocks
`,
    manifest: `# TEST-WRITER — Manifest

## Role
Writes Vitest (FE) and xUnit (BE) tests that hit real code paths and meet the project's coverage floors.

## Inputs
- tasks/test-writer.task.md (test specification and acceptance criteria)
- MASTER-DIRECTIVES.md (project constraints)
- quality-score-coder.md (quality scoring criteria)
- test-patterns.md (testing patterns and conventions)
- COVERAGE-POLICY.md (coverage floor policy)
- git diff (the code diff to cover)

## Outputs
- web/**/*.test.ts (Vitest unit and integration tests)
- api/**/*Tests.cs (xUnit Fact and Theory tests)

## Acceptance criteria
- All acceptance tests from tasks/test-writer.task.md pass
- Coverage floors met per web/vitest.config.ts and api/Directory.Build.props
- No mocks of business logic — only external I/O mocked
`,
  },

  reviewer: {
    rulebook: `# REVIEWER — Rule Book

## Must do
- Use a different model family than the coders (cross-model invariant)
- Perform exactly 4 semantic passes: business logic, architectural adherence, semantic security, plan fidelity
- Produce a final verdict: APPROVE | REJECT | NEEDS_REWORK
- Reference specific line numbers or file paths for every finding
- Check IDOR, auth context, and crypto usage in the security pass

## Must not do
- Act as a syntax or linting checker — deterministic gates already cover that
- APPROVE if any IDOR, broken auth, or cross-module FK is found
- Skip the plan fidelity pass
- Produce a verdict without completing all 4 passes

## Quality gates
- review.md contains 4 prose passes and 2 JSON blocks (findings + verdict)
- Verdict field is one of: APPROVE | REJECT | NEEDS_REWORK
- Every REJECT or NEEDS_REWORK finding has a file path reference
`,
    manifest: `# REVIEWER — Manifest

## Role
Cross-model semantic audit of the built code — checks business logic correctness, architectural adherence, security, and plan fidelity.

## Inputs
- MASTER-DIRECTIVES.md (project constraints)
- REVIEW-SCHEMA.md (review output schema)
- 0-reframe.md (original premise challenge)
- 3-design.md (locked design spec)
- generated/api-contracts/<task>.json (OpenAPI contract)
- integration.md (wiring map)
- 5-plan.json (machine manifest)
- tasks/*.task.md (per-agent task files)
- git diff (the full code diff)
- AFTA_TLDR.md (security standard summary)
- security.md (security requirements)

## Outputs
- review.md (4 prose passes + 2 JSON blocks; verdict: APPROVE | REJECT | NEEDS_REWORK)

## Acceptance criteria
- All 4 passes completed and documented
- Verdict is present and unambiguous
- REJECT verdict includes specific file paths and line references for each issue
`,
  },

  debugger: {
    rulebook: `# DEBUGGER — Rule Book

## Must do
- Read error logs, the diff, vision snapshots, and review rejections before proposing a fix
- Produce a root-cause analysis — not just a symptom fix
- Use a different model family than the coder being debugged (cross-model invariant)
- Limit fixes to ≤3 files unless an architectural flaw is found
- Write generalizable lessons to debug-notes.md
- Outcome must be one of: fixed | quarantined | architectural-flaw

## Must not do
- Skip root-cause analysis and jump straight to patching
- Modify more than 3 files without declaring an architectural flaw
- Quarantine without a written explanation
- Touch files outside the original task's allowlist unless architectural-flaw

## Quality gates
- debug-notes.md exists with outcome field: fixed | quarantined | architectural-flaw
- Gate passes after fix (if outcome is "fixed")
- If quarantined, task folder moves to 07-failed/ with explanation
`,
    manifest: `# DEBUGGER — Manifest

## Role
Escalated on second gate failure — root-cause analysis with fresh context; outcome: fixed, quarantined, or architectural-flaw.

## Inputs
- .arbiter/error-logs/<task>/<coder>.truncated.log (gate failure logs)
- <coder>-report.json (gate results)
- debug-errors.md (error summary)
- review-rejection.md (reviewer findings if applicable)
- git diff (the full code diff)
- 3-design.md (design spec)
- integration.md (wiring map)
- MODULE_ARCHITECTURE.md (module architecture)
- .arbiter/vision/<task>/*.png (UI screenshots if FE failure)
- MASTER-DIRECTIVES.md (project constraints)
- DEBUG-NOTES-SCHEMA.md (output schema)
- RECOVERY-POLICY.md (recovery policy)

## Outputs
- debug-notes.md (outcome: fixed | quarantined | architectural-flaw)
- Code fixes (≤3 files for non-architectural issues)

## Acceptance criteria
- Root cause is documented (not just symptom)
- Outcome field is present and one of the three valid values
- If fixed: gate passes on the next run
- Lessons are generalizable and written in plain language
`,
  },

  'tech-writer': {
    rulebook: `# TECH-WRITER — Rule Book

## Must do
- Read the full task history before writing: design, plan, review, debug notes, error logs
- APPEND-ONLY: never edit or delete existing content in lessons files
- Write one task summary (summary.md) for every completed task
- Append lessons only when the task had failures or reviewer friction
- Classify lessons as SAFE (auto-append) or UNSAFE (create proposal, needs Pedram review)

## Must not do
- Edit or delete existing lesson entries
- Write lessons for tasks with no failures or friction
- Append UNSAFE rules without creating a proposal entry
- Run before the PR is merged

## Quality gates
- summary.md is written for every completed task
- lessons-ledger.json has a new entry for this task (dedup check passes)
- CLI-LESSONS-LEARNED.md has no deleted or modified existing lines
`,
    manifest: `# TECH-WRITER — Manifest

## Role
Post-merge memory agent: distills failures and friction into permanent append-only lessons that improve future runs.

## Inputs
- MASTER-DIRECTIVES.md (project constraints)
- LESSONS-SCHEMA.md (lessons output schema)
- lessons-ledger.json (dedup ledger)
- CLI-LESSONS-LEARNED.md (existing lessons file)
- git diff (merged code diff)
- 0-reframe.md (reframe outcome)
- 5-plan.json (machine plan manifest)
- review.md (reviewer verdict and findings)
- debug-notes.md (debug outcome, if present)
- .arbiter/error-logs/<task>/*.truncated.log (gate error logs, if present)

## Outputs
- <task-folder>/summary.md (always written)
- compliance/automation/lessons-ledger.json (task_id appended)
- compliance/automation/CLI-LESSONS-LEARNED.md (APPEND-ONLY on failure/friction)
- compliance/knowledge/automated-lessons.md (APPEND-ONLY, SAFE-class rules)
- compliance/automation/proposals/<task-id>.md (UNSAFE-class proposals)

## Acceptance criteria
- summary.md written for every task
- No existing lesson line is modified or deleted
- Lessons-ledger dedup check passes (no duplicate task_id)
`,
  },

  surveyor: {
    rulebook: `# SURVEYOR — Rule Book

## Must do
- Run on the nightly schedule only — not as part of per-task pipeline
- Audit coverage trends, AFTA gap analysis, tech debt, and pending proposals
- Rank proposed next tasks by impact and urgency per SEQUENCING-POLICY.md
- Auto-enqueue ONLY safe work: coverage backfill, doc refresh, dep-patch
- Write one proposal file per proposal in exec-plan/00-proposed/

## Must not do
- Auto-execute risky, new-module, or schema-change work
- Propose tasks already in the pipeline or completed
- Modify any existing task files
- Skip reading AFTA_GAP_ANALYSIS.md

## Quality gates
- survey-report.md written on every run
- Each proposal file follows the proposal schema
- Auto-enqueued work is only from the safe-work allowlist
`,
    manifest: `# SURVEYOR — Manifest

## Role
Scheduled nightly repo audit — proposes next tasks ranked by impact and auto-enqueues safe maintenance work.

## Inputs
- .arbiter/registry.json (component and service registry)
- 19-MODULE-INTEGRATION-MAP.md (module integration map)
- AFTA_GAP_ANALYSIS.md (AFTA compliance gap analysis)
- SEQUENCING-POLICY.md (task sequencing policy)
- lessons-ledger.json (completed task ledger)
- exec-plan/00-proposed/*.md (existing proposals)
- git log (recent commit history)

## Outputs
- survey-report.md (nightly audit summary)
- exec-plan/00-proposed/<n>.md (one file per new proposal)

## Acceptance criteria
- survey-report.md written on every run
- Proposals ranked by impact score (highest first)
- No proposal for work already active or completed
- Auto-enqueued items are only safe-work types (coverage, docs, dep-patch)
`,
  },
};

// ── Speed / compact pipeline (5 agents) ──────────────────────────────────────

export const SPEED_TEMPLATES: Record<string, AgentTemplates> = {

  brainstorming: {
    rulebook: `# BRAINSTORMING — Rule Book

## Must do
- Read spec.md and MASTER-DIRECTIVES.md before writing approach.md
- Challenge the spec: is the scope minimal and correct?
- Define the FE/BE split explicitly (what each agent will build)
- List key data shapes (request/response types)
- Produce acceptance criteria and file allowlists for each coder
- Keep approach.md under 300 lines

## Must not do
- Write any code
- Over-engineer: prefer the simplest correct approach
- Leave the file allowlist empty — coders must be bounded
- Skip acceptance criteria

## Quality gates
- approach.md exists and contains all 6 required sections
- FE and BE file allowlists are present
- Acceptance criteria are testable (not vague)
`,
    manifest: `# BRAINSTORMING — Manifest

## Role
Single planning agent for the speed pipeline — clarifies scope, surfaces edge cases, and produces a concise build plan for all downstream agents.

## Inputs
- spec.md (the feature brief)
- MASTER-DIRECTIVES.md (project-wide constraints)

## Outputs
- approach.md (scope, FE/BE split, data shapes, acceptance criteria, file allowlists)

## Acceptance criteria
- approach.md has: scope summary, FE/BE split, data shapes, acceptance criteria, FE allowlist, BE allowlist
- File allowlists bound each coder to specific files
- Acceptance criteria are specific and testable
`,
  },

  frontend: {
    rulebook: `# FRONTEND (Speed) — Rule Book

## Must do
- Implement exactly what approach.md specifies
- Stay within the FE file allowlist in approach.md
- Reuse existing components from the project before creating new ones
- Pass typecheck and lint before finishing

## Must not do
- Create files outside the FE allowlist
- Bypass the service layer — Component → Hook → Service → API
- Hard-code values that belong in environment variables

## Quality gates
- npm run typecheck passes
- npm run lint passes
- All acceptance criteria in approach.md are met
`,
    manifest: `# FRONTEND (Speed) — Manifest

## Role
Builds all UI components, hooks, state, and service layer from approach.md — bounded by the FE file allowlist.

## Inputs
- approach.md (build plan with FE allowlist)
- MASTER-DIRECTIVES.md (project constraints)

## Outputs
- src/features/<module>/** (bounded by approach.md FE allowlist)

## Acceptance criteria
- All FE acceptance criteria in approach.md pass
- Typecheck and lint pass
- No files created outside the allowlist
`,
  },

  backend: {
    rulebook: `# BACKEND (Speed) — Rule Book

## Must do
- Implement exactly what approach.md specifies
- Stay within the BE file allowlist in approach.md
- Use ServiceResult<T> for all service returns — never throw
- No cross-module foreign keys
- Pass build before finishing

## Must not do
- Create files outside the BE allowlist
- Create cross-module foreign keys
- Touch web/ or any frontend file

## Quality gates
- Build passes (dotnet build or npm run build)
- All acceptance criteria in approach.md are met
- No cross-module FKs
`,
    manifest: `# BACKEND (Speed) — Manifest

## Role
Builds API endpoints, services, and DB layer from approach.md — bounded by the BE file allowlist.

## Inputs
- approach.md (build plan with BE allowlist)
- MASTER-DIRECTIVES.md (project constraints)

## Outputs
- api/src/** (bounded by approach.md BE allowlist)

## Acceptance criteria
- All BE acceptance criteria in approach.md pass
- Build passes
- No cross-module foreign keys
`,
  },

  test: {
    rulebook: `# TEST (Speed) — Rule Book

## Must do
- Write tests for both FE (Vitest) and BE (xUnit / Jest) in one pass
- Hit real code paths — no mocks of business logic
- Meet coverage floors defined in project config
- Focus on the code introduced in the current task

## Must not do
- Mock business logic — only mock external I/O
- Write tests for unchanged code
- Lower coverage floors to make tests pass

## Quality gates
- Coverage floors met per project vitest/jest config
- All new tests pass
- No business-logic mocks
`,
    manifest: `# TEST (Speed) — Manifest

## Role
Writes FE and BE tests combined in one pass — hits real code paths and meets the project's coverage floors.

## Inputs
- approach.md (acceptance criteria)
- MASTER-DIRECTIVES.md (project constraints)
- git diff (the code to cover)

## Outputs
- **/*.test.ts (Vitest FE tests)
- **/*Tests.cs or **/*.test.ts (xUnit / Jest BE tests)

## Acceptance criteria
- Coverage floors met for FE and BE
- All acceptance criteria from approach.md are covered by tests
- No mocks of business logic
`,
  },

  push: {
    rulebook: `# PUSH — Rule Book

## Must do
- Run the full build one final time before pushing
- Verify all tests pass
- Write a clear PR description: change summary, acceptance criteria, test plan
- Push the branch and output the branch name

## Must not do
- Push if the build is red
- Push if any test is failing
- Skip the PR description

## Quality gates
- Full build passes
- All tests pass
- PR description written (.arbiter/pr-description.md)
- Branch pushed successfully
`,
    manifest: `# PUSH — Manifest

## Role
Final sanity check, PR description writer, and branch pusher — the last agent in the speed pipeline.

## Inputs
- approach.md (original plan and acceptance criteria)
- git diff (full changeset)
- MASTER-DIRECTIVES.md (project constraints)

## Outputs
- .arbiter/pr-description.md (PR description)
- git push (branch pushed)

## Acceptance criteria
- Build is green before push
- All tests pass before push
- PR description includes: change summary, acceptance criteria, test plan
- Branch name is output clearly
`,
  },
};
