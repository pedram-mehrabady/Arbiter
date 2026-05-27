# Arbiter Agent Manifest

**Version:** 1.0 (2026-05-27)
**Purpose:** Single-table reference covering all 14 pipeline agents. Serves as the P3-3 ADR substitute — one document an AFTA evaluator can read in 5 minutes.

---

## Pipeline Agents

| Agent | Purpose | Model | ALC Evidence | Output Artifact | Cacheable? | Key Constraints |
|-------|---------|-------|--------------|-----------------|-----------|-----------------|
| **Reframe** | Reformulates raw task into pipeline-ready spec | Sonnet | ALC_REQ — Requirements Specification | `reframe-output.md` | No | Must not change scope; only clarify ambiguity |
| **Research** | Reads codebase; produces blast-radius + context summary | Sonnet | ALC_IMP.1 — Impact Analysis | `research-output.md` | No | Read-only; secrets scanner applied before spawn |
| **Design** | Architectural design for feature | Sonnet | ALC_TDS.1 — Design Documentation | `design-output.md` | Yes — key: `modules_touched` set hash | P-CRYPTO rule applies; I7: must differ from Design-Critic |
| **Design-Critic** | Independent security + quality review of design | Haiku | ALC_TDS.2 — Independent Design Review | `design-critic-output.md` | Yes — same key as Design | **I7 invariant:** must be different model family from Design (Sonnet≠Haiku); prevents grading own homework |
| **Integrator** | Resolves cross-module contracts; produces interface specs | Opus | ALC_TDS.3 — Interface Specification | `integrator-output.md` | No | Cannot introduce new modules; cross-module synthesis requires Opus-class reasoning |
| **Plan** | Generates sub-task breakdown with complexity scores | Opus | ALC_IMP.2 — Implementation Plan | `plan-output.md` | No | Complexity score required; scored output enforced ≤ 9; granular sub-tasks injected into state |
| **Backend** | Writes .NET C# source code | Sonnet | ALC_IMP — Implementation | `src/**/*.cs` | No | P-CRYPTO enforced at preflight; compile gate before receipt |
| **Frontend** | Writes TypeScript/React source code | Sonnet | ALC_IMP — Implementation | `src/**/*.tsx` | No | Compile gate (`tsc --noEmit`) before receipt |
| **Test-Writer** | Writes unit + integration tests | Haiku | ALC_TEC — Test Coverage & Design | `*.Tests.cs`, `*.test.ts` | No | **I6 invariant:** must be different model family from Backend/Frontend (Haiku≠Sonnet); prevents blind-spot inheritance |
| **Reviewer** | Independent QA review of code + tests | Opus | ALC_QA — Quality Assurance Review | `reviewer-output.md` | No | Final quality gate; must not see prior reviewer outputs; Sonnet insufficient for this role |
| **Tech-Writer** | Produces feature documentation | Sonnet | AGD_OPE — Operational Guidance | `tech-writer-output.md` | No | Haiku produced unacceptable doc quality (FEAT-52 finding) |
| **Debugger** | Repairs failed validation output | Opus | — (internal; not ALC evidence) | Modified existing output files only | No | **P1-5 constraints (all four mandatory):** (1) same validators as original, (2) diff hash+pct in receipt, (3) >20% rewrite triggers 4th human gate, (4) no new files or public abstractions |
| **Report-Formatter** | Formats human-gate summary reports | Haiku | — (internal) | `gate-report.md` | No | Formatting only; no reasoning |
| **Gate-Poller** | Polls `pending-gates.json` for human approvals | Haiku | — (internal) | None | No | Read-only; no output files written |

---

## Model Invariants

| Invariant | Rule | Reason |
|-----------|------|--------|
| **I6** | Test-Writer must be a different model family than Backend and Frontend | Prevents blind-spot inheritance — a Sonnet-authored test checking Sonnet-authored code may share the same reasoning blind spots |
| **I7** | Design-Critic must be a different model family than Design | Prevents grading own homework — a model reviewing its own architectural reasoning class cannot provide independent assurance |

---

## Failure Mode Reference

Applies to all agents.

| Class | Trigger | Strike Cost | Resolution |
|-------|---------|-------------|------------|
| `infrastructure` | Wrong template, missing context file, manifest error, secrets detected | 0 strikes | Fix conductor configuration. Immediate retry without penalty. |
| `stochastic` | Output violates schema but semantically close; transient API error | 1 strike per occurrence | Retry (max 2 strikes → debugger escalation). |
| `scope_overload` | Complexity score > 9; consistent failure across all retries | 0 strikes (rejection) | Reject sub-task to `failed`. Split parent task. Notify operator. |

---

## Human Gate Positions

| Gate | Position | Type | Blocks |
|------|----------|------|--------|
| **Gate 1 — Discovery** | After Research | `design_approval` | Design, Design-Critic, Integrator, Plan, all implementation |
| **Gate 2 — Design** | After Integrator | `plan_approval` | Plan, all implementation |
| **Gate 3 — Review** | After Reviewer | `review_approval` | Tech-Writer |
| **Gate 4 — Debugger Rewrite** | After Debugger (conditional) | `debugger_major_rewrite` | Reviewer | Fires only when debugger changed >20% of original output |

---

## ALC Controls Coverage

| ALC Control | Pipeline Agent | Artifact |
|-------------|---------------|---------|
| ALC_REQ — Requirements Specification | Reframe | `01-requirements/reframe-output.md` |
| ALC_IMP.1 — Impact Analysis | Research | `02-impact-analysis/research-output.md` |
| ALC_TDS.1 — Design Documentation | Design | `03-design/design.md` |
| ALC_TDS.2 — Independent Design Review | Design-Critic | `03-design/design-critic.md` |
| ALC_TDS.3 — Interface Specification | Integrator | `03-design/integrator-output.md` |
| ALC_IMP.2 — Implementation Plan | Plan | `04-implementation-plan/plan-output.md` |
| ALC_IMP — Implementation | Backend / Frontend | `05-implementation/git-commits.json` + signed receipts |
| ALC_TEC — Test Coverage & Design | Test-Writer | `06-tests/test-writer-output.md` |
| ALC_QA — Quality Assurance Review | Reviewer | `07-review/reviewer-report.md` |
| AGD_OPE — Operational Guidance | Tech-Writer | `08-documentation/tech-writer-output.md` |
