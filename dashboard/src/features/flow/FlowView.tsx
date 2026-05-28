import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { shellCmd, osifyProse } from '../../lib/osCmd';
import type { OsType } from '../../api/types';
import { AgentDocModal } from './AgentDocModal';
import css from './FlowView.module.css';

// ── Types ────────────────────────────────────────────────────────────────────

type StepMode = 'auto' | 'gate' | 'conditional';

interface Step {
  phase: string;
  title: string;
  mode: StepMode;
  description: string;
  reads: string[];
  writes: string[];
  gate?: string;
  notes?: string;
}

interface Agent {
  key: string;
  label: string;
  emoji: string;
  color: string;
  model: string;
  role: string;
  ruleBook: string;
  manifest: string;
  steps: Step[];
  terminalCmd: string;
  terminalNote: string;
}

interface PhaseGroup {
  phase: string;
  color: string;
  agents: Agent[];
}

// ── Agent data ────────────────────────────────────────────────────────────────

function buildPhaseGroups(
  execPlanDir: string,
  agentsDir: string,
  manifestsDir: string,
): PhaseGroup[] {
  const taskPath = `${execPlanDir}/02-active/<task-id>`;
  return [
  {
    phase: 'Phase 1 — Understand',
    color: '#8b5cf6',
    agents: [
      {
        key: 'reframe',
        label: 'REFRAME',
        emoji: '🔍',
        color: '#8b5cf6',
        model: 'claude-opus-4-7',
        role: 'Challenges the premise before anyone writes code — simplify, redirect, or proceed',
        ruleBook: `${agentsDir}/reframe.md`,
        manifest: `${manifestsDir}/reframe.manifest.yaml`,
        terminalCmd: `scripts/spawn-agent.sh reframe ${taskPath}`,
        terminalNote: 'Run by conductor automatically. Produces 0-reframe.md — verdict: proceed / simplify / redirect.',
        steps: [
          {
            phase: 'Step 0',
            title: 'Challenge the premise',
            mode: 'auto',
            description: 'Reads spec.md and asks: does this task need to exist as written? Could an existing feature handle it? Is the scope too broad?',
            reads: ['spec.md', 'MASTER-DIRECTIVES.md', 'product-sense.md', 'core-beliefs.md'],
            writes: ['0-reframe.md (verdict: proceed | simplify | redirect + reasoning)'],
            notes: 'Advisory only — design reads the verdict but is not blocked by it.',
          },
        ],
      },
      {
        key: 'question',
        label: 'QUESTION',
        emoji: '❓',
        color: '#7c3aed',
        model: 'claude-sonnet-4-6',
        role: 'Surfaces ambiguities and edge cases that would change design or scope',
        ruleBook: 'compliance/automation/agents/question.md',
        manifest: 'compliance/automation/context-manifests/question.manifest.yaml',
        terminalCmd: 'scripts/spawn-agent.sh question compliance/exec-plan/02-active/<task-id>',
        terminalNote: 'Fully automated. Asks but never answers — questions become input to research agent.',
        steps: [
          {
            phase: 'Step 1',
            title: 'Identify open questions',
            mode: 'auto',
            description: 'Reads the spec + reframe verdict. Generates ranked must-resolve questions that change scope, schema, or UX. Never answers — purely interrogates.',
            reads: ['spec.md', '0-reframe.md', 'MASTER-DIRECTIVES.md', 'product-sense.md'],
            writes: ['1-questions.md (ranked open questions — input to research)'],
          },
        ],
      },
      {
        key: 'research',
        label: 'RESEARCH',
        emoji: '📚',
        color: '#6d28d9',
        model: 'claude-sonnet-4-6',
        role: 'Answers every open question with evidence from the codebase and sibling apps',
        ruleBook: 'compliance/automation/agents/research.md',
        manifest: 'compliance/automation/context-manifests/research.manifest.yaml',
        terminalCmd: 'scripts/spawn-agent.sh research compliance/exec-plan/02-active/<task-id>',
        terminalNote: 'Reuse over invent — searches registry, costflow, contract-builder, drilling-run, debt-ledger before proposing anything new.',
        steps: [
          {
            phase: 'Step 2',
            title: 'Answer open questions',
            mode: 'auto',
            description: 'Takes every question from 1-questions.md and answers it with evidence: existing components, sibling app patterns, registry entries. Marks genuinely unanswerable ones as "open".',
            reads: ['1-questions.md', 'MASTER-DIRECTIVES.md', '.arbiter/registry.json'],
            writes: ['2-research.md (evidence-backed answers; open items flagged)'],
          },
          {
            phase: 'Gate 1 — Discovery',
            title: 'Discovery review',
            mode: 'gate',
            description: 'The Conductor briefs you on what the agents understood: the reframe verdict, every open question, and the research findings. Chat until every item is resolved, then approve to let design begin.',
            reads: ['0-reframe.md', '1-questions.md', '2-research.md'],
            writes: ['.arbiter/gate-approvals/<id>-discovery.json'],
            notes: 'Approve via the Arbiter dashboard — Conductor chat activates automatically when this gate is reached.',
          },
        ],
      },
    ],
  },
  {
    phase: 'Phase 2 — Design',
    color: '#0ea5e9',
    agents: [
      {
        key: 'design',
        label: 'DESIGN',
        emoji: '🎨',
        color: '#0ea5e9',
        model: 'claude-sonnet-4-6',
        role: 'Defines WHAT to build and the API/DB contract — never HOW to code it',
        ruleBook: 'compliance/automation/agents/design.md',
        manifest: 'compliance/automation/context-manifests/design.manifest.yaml',
        terminalCmd: 'scripts/spawn-agent.sh design compliance/exec-plan/02-active/<task-id>',
        terminalNote: 'Outputs the locked contract. Frontend and backend are both bound by what this agent writes.',
        steps: [
          {
            phase: 'Step 3',
            title: 'Write UX + API + DB spec',
            mode: 'auto',
            description: 'Translates research answers into concrete UX flows, OpenAPI 3.1 contracts, Mermaid ER diagrams, MSW mock payloads, and sequence diagrams for async flows.',
            reads: ['spec.md', '0-reframe.md', '2-research.md', 'MASTER-DIRECTIVES.md', 'MODULE_ARCHITECTURE_TLDR.md', 'CQRS_API_CHEATSHEET.md', 'design-system.md', 'security.md', '.arbiter/db-schema-snapshot.md'],
            writes: [
              '3-design.md (11-section human spec)',
              'generated/api-contracts/<task>.json (OpenAPI 3.1)',
              'generated/db-schema/<task>.mmd (Mermaid ER)',
              'generated/sequence-diagrams/<task>.mmd',
              'generated/mocks/<task>.json (MSW payloads)',
            ],
            notes: 'Goes through design-critic immediately after. If critic finds issues, conductor re-spawns design with 3-design-errors.md.',
          },
        ],
      },
      {
        key: 'design-critic',
        label: 'DESIGN-CRITIC',
        emoji: '🧐',
        color: '#0284c7',
        model: 'claude-haiku-4-5-20251001',
        role: 'Cross-model audit: AFTA security, module isolation, contract-vs-prose consistency',
        ruleBook: 'compliance/automation/agents/design-critic.md',
        manifest: 'compliance/automation/context-manifests/design-critic.manifest.yaml',
        terminalCmd: 'scripts/spawn-agent.sh design-critic compliance/exec-plan/02-active/<task-id>',
        terminalNote: 'Uses a different model family (Haiku) than design (Sonnet) — cannot grade its own homework. Strict pass/fail on 3 dimensions.',
        steps: [
          {
            phase: 'Step 3b',
            title: 'Second-opinion structural audit',
            mode: 'auto',
            description: 'Audits 3 dimensions: AFTA/security compliance, module isolation (no cross-module FKs, schema-per-module), and contract-vs-prose consistency. Outputs structured pass/fail JSON. If fail → conductor loops back to design.',
            reads: ['3-design.md', 'generated/api-contracts/<task>.json', 'generated/db-schema/<task>.mmd', 'MASTER-DIRECTIVES.md', 'MODULE_ARCHITECTURE_TLDR.md', 'security.md', 'DESIGN-SCHEMA.md'],
            writes: ['design-critic-report.json (pass/fail per dimension; ≤5 findings each)'],
            gate: 'Conductor re-spawns design with errors if fail',
            notes: 'Cross-model invariant: critic model ≠ design model family (validator enforced).',
          },
        ],
      },
    ],
  },
  {
    phase: 'Phase 3 — Plan',
    color: '#f59e0b',
    agents: [
      {
        key: 'integrator',
        label: 'INTEGRATOR',
        emoji: '🔌',
        color: '#f59e0b',
        model: 'claude-opus-4-7',
        role: 'Definitive list of what to reuse and how new code wires to existing modules',
        ruleBook: 'compliance/automation/agents/integrator.md',
        manifest: 'compliance/automation/context-manifests/integrator.manifest.yaml',
        terminalCmd: 'scripts/spawn-agent.sh integrator compliance/exec-plan/02-active/<task-id>',
        terminalNote: 'Kills integration amnesia — coders cannot claim they didn\'t know a component existed.',
        steps: [
          {
            phase: 'Step 4',
            title: 'Map reuse + bidirectional wiring',
            mode: 'auto',
            description: 'Lists every existing component/service/hook/store the new feature must reuse (new→existing), AND every existing consumer that must be updated to use the new feature (existing→new). Explicit transport patterns per connection.',
            reads: ['3-design.md', 'generated/api-contracts/<task>.json', 'generated/db-schema/<task>.mmd', 'MASTER-DIRECTIVES.md', 'INTEGRATION-SCHEMA.md', 'REGISTRY-SCHEMA.md', '.arbiter/registry-scoped.json', '19-MODULE-INTEGRATION-MAP.md'],
            writes: ['integration.md (8 required sections; JSON wiring arrays)'],
            notes: 'Passes through validator. If discrepancies found vs design, triggers design-rework loop.',
          },
          {
            phase: 'Gate 2 — Design',
            title: 'Design review',
            mode: 'gate',
            description: 'The Conductor walks you through the design and integration plan: the UX flows, API contracts, DB schema, and every reuse decision. Chat to challenge or refine anything before a single line of code is written.',
            reads: ['3-design.md', 'integration.md', 'generated/api-contracts/<task>.json', 'generated/db-schema/<task>.mmd'],
            writes: ['.arbiter/gate-approvals/<id>-design.json'],
            notes: 'This is the point-of-no-return for architecture. Approve via the Arbiter dashboard.',
          },
        ],
      },
      {
        key: 'plan',
        label: 'PLAN',
        emoji: '📋',
        color: '#d97706',
        model: 'claude-opus-4-7',
        role: 'Generates self-contained per-agent task files — the coders\' exact instructions',
        ruleBook: 'compliance/automation/agents/plan.md',
        manifest: 'compliance/automation/context-manifests/plan.manifest.yaml',
        terminalCmd: 'scripts/spawn-agent.sh plan compliance/exec-plan/02-active/<task-id>',
        terminalNote: 'Output task files are self-contained — each coder reads only its own task file + bounded file list.',
        steps: [
          {
            phase: 'Step 5',
            title: 'Generate task files + machine manifest',
            mode: 'auto',
            description: 'Turns design + integration into per-agent task files (frontend.task.md, backend.task.md, test-writer.task.md). Each task file contains: Objective, file allowlist, reusable components (from integrator), acceptance tests, and Definition of Done.',
            reads: ['3-design.md', 'integration.md', 'MASTER-DIRECTIVES.md', 'TASK-SCHEMA.md', 'TASK-ARCHETYPES.md', '2-research.md', '.arbiter/codebase-tree.md'],
            writes: [
              '5-plan.md (≤500-word human summary with Traceability Matrix)',
              '5-plan.json (machine manifest; validated against TASK-SCHEMA)',
              'tasks/frontend.task.md',
              'tasks/backend.task.md',
              'tasks/test-writer.task.md',
            ],
          },
        ],
      },
    ],
  },
  {
    phase: 'Phase 4 — Build',
    color: '#10b981',
    agents: [
      {
        key: 'frontend',
        label: 'FRONTEND',
        emoji: '⚛️',
        color: '#10b981',
        model: 'claude-sonnet-4-6',
        role: 'React 19 + AntD component builder — matches design contract exactly',
        ruleBook: 'compliance/automation/agents/frontend.md',
        manifest: 'compliance/automation/context-manifests/frontend.manifest.yaml',
        terminalCmd: 'scripts/spawn-agent.sh frontend compliance/exec-plan/02-active/<task-id>',
        terminalNote: 'Bounded by tasks/frontend.task.md file allowlist. Produces vision snapshots for UI gate. Must turn gate-web.sh green.',
        steps: [
          {
            phase: 'Step 6',
            title: 'Build React components, hooks, stores',
            mode: 'auto',
            description: 'Implements the full FE module: components, Zustand stores, hooks, service layer (mock + live API), types — all bounded by the task file\'s allowlist. Matches the OpenAPI contract and MSW mocks from design exactly.',
            reads: ['tasks/frontend.task.md', '3-design.md', 'generated/api-contracts/<task>.json', 'generated/mocks/<task>.json', 'integration.md', 'frontend-standards.md', 'design-system.md', 'ui-component-registry.md', 'web/CLAUDE.md', 'CLI-LESSONS-LEARNED.md'],
            writes: ['web/src/** (bounded by task file)', 'frontend-report.json', '.arbiter/vision/<task>/*.png (route screenshots for UI gate)'],
            gate: 'scripts/gate-web.sh (typecheck + lint + coverage + build)',
            notes: 'On 2nd gate failure → debugger escalated. If ui_first=true → UI gate runs here before backend starts.',
          },
          {
            phase: 'Gate 3 — Frontend',
            title: 'Frontend review',
            mode: 'gate',
            description: 'The Conductor presents the built UI for your sign-off. You test the rendered screens, chat about anything that needs adjusting, and approve only when the UI fully matches the design spec. Backend does not start until this gate clears.',
            reads: ['.arbiter/vision/<task>/*.png', '3-design.md', '8-frontend.md'],
            writes: ['.arbiter/gate-approvals/<id>-frontend.json'],
            notes: 'Approve via the Arbiter dashboard conductor chat. If the UI needs rework, the conductor issues a [RERUN:frontend] signal and the frontend agent re-runs.',
          },
        ],
      },
      {
        key: 'backend',
        label: 'BACKEND',
        emoji: '⚙️',
        color: '#059669',
        model: 'claude-sonnet-4-6',
        role: 'ASP.NET Core + EF Core + Dapper builder — module-isolated, security-first',
        ruleBook: 'compliance/automation/agents/backend.md',
        manifest: 'compliance/automation/context-manifests/backend.manifest.yaml',
        terminalCmd: 'scripts/spawn-agent.sh backend compliance/exec-plan/02-active/<task-id>',
        terminalNote: 'Schema gate may pause execution before this runs. Never touches web/. Must turn gate-api.sh green including db-isolation and security checks.',
        steps: [
          {
            phase: 'Schema Gate',
            title: 'Schema approval',
            mode: 'gate',
            description: 'If the design includes DB changes, you review and approve the Mermaid ER diagram and migration plan before any code is written. This is the point-of-no-return for the DB schema.',
            reads: ['generated/db-schema/<task>.mmd', '3-design.md'],
            writes: ['.arbiter/gates/<task>/schema-approved (approval signal)'],
            notes: 'Approve via the Arbiter dashboard or: scripts/foederata-cli approve <id> schema — skipped if no DB changes.',
          },
          {
            phase: 'Step 7',
            title: 'Build controllers, services, migrations',
            mode: 'auto',
            description: 'Builds the full backend: controller, service layer (ServiceResult<T>), EF Core migration (schema-per-module), Dapper read queries. No cross-module FKs. Bounded by backend.task.md file allowlist.',
            reads: ['tasks/backend.task.md', '3-design.md', 'generated/api-contracts/<task>.json', 'backend-standards.md', 'reliability.md', 'security.md', 'api/CLAUDE.md', 'MASTER-DIRECTIVES.md'],
            writes: ['api/src/** (bounded by task file)'],
            gate: 'scripts/gate-api.sh (includes check-db-isolation.sh + check-security.sh)',
            notes: 'On 2nd gate failure → debugger escalated.',
          },
        ],
      },
      {
        key: 'test-writer',
        label: 'TEST-WRITER',
        emoji: '🧪',
        color: '#047857',
        model: 'claude-sonnet-4-6',
        role: 'Vitest (FE) + xUnit (BE) test author — hits real logic, not mocks',
        ruleBook: 'compliance/automation/agents/test-writer.md',
        manifest: 'compliance/automation/context-manifests/test-writer.manifest.yaml',
        terminalCmd: 'scripts/spawn-agent.sh test-writer compliance/exec-plan/02-active/<task-id>',
        terminalNote: 'Tests must hit real code paths. Coverage floors non-negotiable: thresholds in web/vitest.config.ts and api/Directory.Build.props.',
        steps: [
          {
            phase: 'Step 8',
            title: 'Write tests to coverage floors',
            mode: 'auto',
            description: 'Writes Vitest tests for web/ and xUnit tests for api/. Tests hit actual logic — no mocks of business code. Coverage must meet the ratchet floors defined in config.',
            reads: ['tasks/test-writer.task.md', 'MASTER-DIRECTIVES.md', 'quality-score-coder.md', 'test-patterns.md', 'COVERAGE-POLICY.md', 'git diff'],
            writes: ['web/**/*.test.ts (Vitest)', 'api/**/*Tests.cs (xUnit Fact/Theory)'],
            gate: 'Coverage floors: web/vitest.config.ts + api/Directory.Build.props',
          },
        ],
      },
    ],
  },
  {
    phase: 'Phase 5 — Review & Ship',
    color: '#ec4899',
    agents: [
      {
        key: 'reviewer',
        label: 'REVIEWER',
        emoji: '🔬',
        color: '#ec4899',
        model: 'claude-opus-4-7',
        role: 'Cross-model semantic audit — business logic, IDOR, auth, plan fidelity',
        ruleBook: 'compliance/automation/agents/reviewer.md',
        manifest: 'compliance/automation/context-manifests/reviewer.manifest.yaml',
        terminalCmd: 'scripts/spawn-agent.sh reviewer compliance/exec-plan/02-active/<task-id>',
        terminalNote: 'Different model family (Opus) from coders (Sonnet) — enforced by validator F10. Verdict blocks merge-on-green.',
        steps: [
          {
            phase: 'Step 9',
            title: 'Semantic review (4 passes)',
            mode: 'auto',
            description: 'NOT a syntax check — deterministic gates already passed. Reviews: 1) business logic correctness, 2) architectural adherence (module isolation, CQRS), 3) semantic security (IDOR, auth context, crypto), 4) plan/integration fidelity. Verdict: APPROVE / REJECT / NEEDS_REWORK.',
            reads: ['MASTER-DIRECTIVES.md', 'REVIEW-SCHEMA.md', '0-reframe.md', '3-design.md', 'generated/api-contracts/<task>.json', 'integration.md', '5-plan.json', 'tasks/*.task.md', 'git diff', 'AFTA_TLDR.md', 'security.md', 'AFTA_GAP_ANALYSIS.md', '.arbiter/registry.json'],
            writes: ['review.md (4 prose passes + 2 JSON blocks; verdict: APPROVE | REJECT | NEEDS_REWORK)'],
            notes: 'REJECT → conductor loops back to failed coder. NEEDS_REWORK → debug cycle. Cross-model invariant enforced.',
          },
        ],
      },
      {
        key: 'debugger',
        label: 'DEBUGGER',
        emoji: '🐛',
        color: '#db2777',
        model: 'claude-opus-4-7',
        role: 'Escalated on 2nd gate failure — root-cause analysis with fresh context',
        ruleBook: 'compliance/automation/agents/debugger.md',
        manifest: 'compliance/automation/context-manifests/debugger.manifest.yaml',
        terminalCmd: 'scripts/spawn-agent.sh debugger compliance/exec-plan/02-active/<task-id>',
        terminalNote: 'NOT part of happy path — triggered only on 2nd coder gate failure. Different model family (Opus) from coders (Sonnet), enforced by validator D9.',
        steps: [
          {
            phase: 'Conditional',
            title: 'Root-cause analysis + fix',
            mode: 'conditional',
            description: 'Triggered when a coder (frontend or backend) fails its gate twice. Reads fresh context: error logs, the diff, vision snapshots, review rejections. Outcome: fixed (gate passes) or quarantined (moved to 07-failed/).',
            reads: ['.arbiter/error-logs/<task>/<coder>.truncated.log', '<coder>-report.json', 'debug-errors.md', 'review-rejection.md', 'git diff', '3-design.md', 'integration.md', 'MODULE_ARCHITECTURE.md', '.arbiter/vision/<task>/*.png', 'MASTER-DIRECTIVES.md', 'DEBUG-NOTES-SCHEMA.md', 'RECOVERY-POLICY.md'],
            writes: ['debug-notes.md (outcome: fixed | quarantined | architectural-flaw)', 'Code fixes (≤3 files heuristic)'],
            notes: 'Last line before 07-failed/. Produces generalizable lessons. Cross-model invariant: debugger model ≠ coder model family.',
          },
        ],
      },
      {
        key: 'tech-writer',
        label: 'TECH-WRITER',
        emoji: '📝',
        color: '#be185d',
        model: 'claude-sonnet-4-6',
        role: 'Post-merge memory: distills failures + friction into permanent lessons',
        ruleBook: 'compliance/automation/agents/tech-writer.md',
        manifest: 'compliance/automation/context-manifests/tech-writer.manifest.yaml',
        terminalCmd: 'scripts/spawn-agent.sh tech-writer compliance/exec-plan/02-active/<task-id>',
        terminalNote: 'APPEND-ONLY invariant — never edits or deletes existing rule books. Runs post-merge. Closes the lessons loop.',
        steps: [
          {
            phase: 'Step 10',
            title: 'Distill lessons + refresh registry',
            mode: 'auto',
            description: 'Reads the full task history (design, plan, review, debug notes, error logs). Writes a task summary. If the task had failures or reviewer friction, appends one-line lessons to CLI-LESSONS-LEARNED.md. For rule-changing proposals, creates a Pedram-review queue entry. Never edits existing content.',
            reads: ['MASTER-DIRECTIVES.md', 'LESSONS-SCHEMA.md', 'lessons-ledger.json', 'CLI-LESSONS-LEARNED.md', 'git diff', '0-reframe.md', '5-plan.json', 'review.md', 'debug-notes.md (if present)', '.arbiter/error-logs/<task>/*.truncated.log'],
            writes: [
              '<task-folder>/summary.md (always)',
              'compliance/automation/lessons-ledger.json (append task_id)',
              'compliance/automation/CLI-LESSONS-LEARNED.md (APPEND-ONLY if had failure/friction)',
              'compliance/knowledge/automated-lessons.md (APPEND-ONLY, SAFE-class rules)',
              'compliance/automation/proposals/<task-id>.md (UNSAFE-class proposals — Pedram queue)',
            ],
            notes: 'Best-effort — never blocks merged PR. Lessons-ledger dedup prevents double processing.',
          },
        ],
      },
    ],
  },
];

}

// ── Compact template (5-agent) ────────────────────────────────────────────────

function buildCompactPhaseGroups(
  execPlanDir: string,
  agentsDir: string,
  manifestsDir: string,
): PhaseGroup[] {
  const taskPath = `${execPlanDir}/02-active/<task-id>`;
  return [
    {
      phase: 'Phase 1 — Brainstorm',
      color: '#8b5cf6',
      agents: [
        {
          key: 'brainstorming',
          label: 'BRAINSTORMING',
          emoji: '💡',
          color: '#8b5cf6',
          model: 'claude-opus-4-7',
          role: 'Clarifies scope, surfaces edge cases, and produces a concise build plan for all downstream agents',
          ruleBook: `${agentsDir}/brainstorming.md`,
          manifest: `${manifestsDir}/brainstorming.manifest.yaml`,
          terminalCmd: `scripts/spawn-agent.sh brainstorming ${taskPath}`,
          terminalNote: 'Single planning agent — replaces the reframe/question/research/design/plan chain. Produces approach.md which the build agents use as their sole instruction.',
          steps: [
            {
              phase: 'Step 1',
              title: 'Understand spec + write build plan',
              mode: 'auto',
              description: 'Reads spec.md, challenges assumptions, identifies the minimal correct solution, and writes approach.md: what to build, how to split FE/BE work, key data shapes, acceptance criteria, and file allowlists for each coder.',
              reads: ['spec.md', 'MASTER-DIRECTIVES.md'],
              writes: ['approach.md (scope, FE/BE split, data shapes, acceptance criteria, file allowlists)'],
            },
            {
              phase: 'Gate — Plan review',
              title: 'Review the plan before building',
              mode: 'gate',
              description: 'The Conductor walks you through approach.md. Chat about scope, approach, or anything unclear before any code is written. Approve to start the build.',
              reads: ['approach.md'],
              writes: ['.arbiter/gate-approvals/<id>-plan.json'],
              notes: 'Approve via the Arbiter dashboard conductor chat.',
            },
          ],
        },
      ],
    },
    {
      phase: 'Phase 2 — Build',
      color: '#10b981',
      agents: [
        {
          key: 'frontend',
          label: 'FRONTEND',
          emoji: '⚛️',
          color: '#10b981',
          model: 'claude-sonnet-4-6',
          role: 'Builds all UI components, hooks, state, and service layer from approach.md',
          ruleBook: `${agentsDir}/frontend.md`,
          manifest: `${manifestsDir}/frontend.manifest.yaml`,
          terminalCmd: `scripts/spawn-agent.sh frontend ${taskPath}`,
          terminalNote: 'Bounded by the file allowlist in approach.md. Must pass typecheck + lint before finishing.',
          steps: [
            {
              phase: 'Step 2',
              title: 'Build frontend',
              mode: 'auto',
              description: 'Implements all UI components, Zustand stores, hooks, and service calls exactly as described in approach.md. Stays within the file allowlist.',
              reads: ['approach.md', 'MASTER-DIRECTIVES.md'],
              writes: ['src/features/<module>/** (bounded by approach.md allowlist)'],
              gate: 'npm run typecheck && npm run lint',
            },
          ],
        },
        {
          key: 'backend',
          label: 'BACKEND',
          emoji: '⚙️',
          color: '#059669',
          model: 'claude-sonnet-4-6',
          role: 'Builds API endpoints, services, and DB layer from approach.md',
          ruleBook: `${agentsDir}/backend.md`,
          manifest: `${manifestsDir}/backend.manifest.yaml`,
          terminalCmd: `scripts/spawn-agent.sh backend ${taskPath}`,
          terminalNote: 'Runs in parallel with frontend after gate approval. Bounded by approach.md file allowlist. Must pass the API gate.',
          steps: [
            {
              phase: 'Step 3',
              title: 'Build backend',
              mode: 'auto',
              description: 'Implements controllers, services (ServiceResult<T>), and any DB migrations described in approach.md. No cross-module foreign keys. Bounded by file allowlist.',
              reads: ['approach.md', 'MASTER-DIRECTIVES.md'],
              writes: ['api/src/** (bounded by approach.md allowlist)'],
              gate: 'npm run build (or dotnet build)',
            },
          ],
        },
      ],
    },
    {
      phase: 'Phase 3 — Quality',
      color: '#f59e0b',
      agents: [
        {
          key: 'test',
          label: 'TEST',
          emoji: '🧪',
          color: '#f59e0b',
          model: 'claude-sonnet-4-6',
          role: 'Writes tests for both frontend and backend to coverage floors',
          ruleBook: `${agentsDir}/test.md`,
          manifest: `${manifestsDir}/test.manifest.yaml`,
          terminalCmd: `scripts/spawn-agent.sh test ${taskPath}`,
          terminalNote: 'Covers both FE (Vitest) and BE (xUnit / Jest) in one pass. Tests hit real logic — no mocks of business code.',
          steps: [
            {
              phase: 'Step 4',
              title: 'Write tests to coverage floors',
              mode: 'auto',
              description: 'Writes unit + integration tests for the code produced in Steps 2 and 3. Tests must reach the coverage floors defined in the project config.',
              reads: ['approach.md', 'MASTER-DIRECTIVES.md', 'git diff'],
              writes: ['**/*.test.ts (Vitest)', '**/*Tests.cs or **/*.test.ts (xUnit/Jest)'],
              gate: 'Coverage floors per project vitest/jest config',
            },
          ],
        },
      ],
    },
    {
      phase: 'Phase 4 — Ship',
      color: '#ec4899',
      agents: [
        {
          key: 'push',
          label: 'PUSH',
          emoji: '🚀',
          color: '#ec4899',
          model: 'claude-opus-4-7',
          role: 'Final sanity check, PR description, and branch push',
          ruleBook: `${agentsDir}/push.md`,
          manifest: `${manifestsDir}/push.manifest.yaml`,
          terminalCmd: `scripts/spawn-agent.sh push ${taskPath}`,
          terminalNote: 'Last agent in the pipeline. Verifies the build is green, writes a clear PR description, and pushes the branch.',
          steps: [
            {
              phase: 'Step 5',
              title: 'Verify, describe, and push',
              mode: 'auto',
              description: 'Runs the full build one final time, writes a concise PR description summarising the change, acceptance criteria, and test plan, then pushes the branch.',
              reads: ['approach.md', 'git diff', 'MASTER-DIRECTIVES.md'],
              writes: ['PR description (.arbiter/pr-description.md)', 'git push (branch)'],
              notes: 'If the build is red, push is blocked and the failure is reported back to the conductor for a debugger escalation.',
            },
          ],
        },
      ],
    },
  ];
}

// Surveyor — scheduled, outside the pipeline
function buildSurveyor(execPlanDir: string, agentsDir: string, manifestsDir: string): Agent {
  return {
    key: 'surveyor',
    label: 'SURVEYOR',
    emoji: '🗺️',
    color: '#64748b',
    model: 'claude-opus-4-7',
    role: 'Proactive repo audit — proposes next tasks ranked by impact, auto-enqueues safe work',
    ruleBook: `${agentsDir}/surveyor.md`,
    manifest: `${manifestsDir}/surveyor.manifest.yaml`,
    terminalCmd: `scripts/spawn-agent.sh surveyor ${execPlanDir}/02-active/<task-id>`,
    terminalNote: 'Runs on a schedule (nightly launchd). NOT part of per-task pipeline. Proposals land in exec-plan/00-proposed/ — Pedram promotes via foederata-cli.',
    steps: [
      {
        phase: 'Scheduled',
        title: 'Audit repo + propose next tasks',
        mode: 'auto',
        description: 'Proactively audits coverage trends, AFTA gap analysis, tech debt, pending proposals. Ranks next tasks by impact/urgency per SEQUENCING-POLICY. Auto-enqueues safe work (coverage backfill, doc refresh, dep-patch) without approval.',
        reads: ['.arbiter/registry.json', '19-MODULE-INTEGRATION-MAP.md', 'AFTA_GAP_ANALYSIS.md', 'SEQUENCING-POLICY.md', 'lessons-ledger.json', 'exec-plan/00-proposed/*.md', 'git log'],
        writes: ['survey-report.md', 'exec-plan/00-proposed/<n>.md (one per proposal)'],
        notes: 'Proposes but never auto-executes risky/new-module/schema work — those need Pedram approval via scripts/foederata-cli promote <id>.',
      },
    ],
  };
}

// ── Doc viewer popup ──────────────────────────────────────────────────────────

interface DocPopupProps {
  path: string;
  content: string | null;
  loading: boolean;
  onClose: () => void;
}

function DocPopup({ path, content, loading, onClose }: DocPopupProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fileName = path.split('/').pop() ?? path;
  const isYaml   = fileName.endsWith('.yaml') || fileName.endsWith('.yml');
  const isJson   = fileName.endsWith('.json');

  return (
    <div className={css.docPopupOverlay} onClick={onClose}>
      <div className={css.docPopup} onClick={(e) => e.stopPropagation()}>
        <div className={css.docPopupHeader}>
          <div className={css.docPopupTitle}>
            <span className={css.docPopupIcon}>{isYaml ? '⚙' : isJson ? '{}' : '📄'}</span>
            <span className={css.docPopupName}>{fileName}</span>
          </div>
          <div className={css.docPopupPath}>{path}</div>
          <button className={css.docPopupClose} onClick={onClose}>✕</button>
        </div>
        <div className={css.docPopupBody}>
          {loading && (
            <div className={css.docPopupLoading}>
              <div className={css.docSpinner} />
              <span>Reading from repo…</span>
            </div>
          )}
          {!loading && content === null && (
            <div className={css.docPopupMissing}>
              File not found — connect the repo first, or this file may not exist yet (task-specific paths are generated at runtime).
            </div>
          )}
          {!loading && content !== null && (
            <pre className={`${css.docPopupContent}${isYaml || isJson ? ' ' + css.docPopupCode : ''}`}>
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

const MODE_META: Record<StepMode, { label: string; cls: string }> = {
  auto:        { label: 'AUTOMATED',   cls: css.modeAuto },
  gate:        { label: 'HUMAN GATE',  cls: css.modeGate },
  conditional: { label: 'CONDITIONAL', cls: css.modeCond },
};

// A path is "readable" (clickable) if it has no template placeholders or wildcards
function isReadablePath(p: string) {
  return !p.includes('<') && !p.includes('*') && !p.includes(' ');
}

function FilePath({ path, onOpen, connected }: { path: string; onOpen: (p: string) => void; connected: boolean }) {
  const readable = isReadablePath(path);
  if (readable && connected) {
    return (
      <button className={css.filePathBtn} onClick={() => onOpen(path)} title="Click to read file">
        {path} <span className={css.filePathArrow}>↗</span>
      </button>
    );
  }
  return <code className={css.filePathStatic}>{path}</code>;
}

function StepCard({ step, agentColor, connected, onOpenDoc, os }: {
  step: Step;
  agentColor: string;
  connected: boolean;
  onOpenDoc: (path: string) => void;
  os: OsType;
}) {
  const [open, setOpen] = useState(false);
  const meta = MODE_META[step.mode];

  return (
    <div className={`${css.stepCard}${step.mode === 'gate' ? ' ' + css.stepCardGate : step.mode === 'conditional' ? ' ' + css.stepCardCond : ''}`}>
      <div className={css.stepHeader}>
        <div className={css.stepPhase}>{step.phase}</div>
        <span className={`${css.modeBadge} ${meta.cls}`}>{meta.label}</span>
      </div>

      <div className={css.stepTitle}>{step.title}</div>
      <div className={css.stepDesc}>{step.description}</div>

      {step.gate && (
        <div className={css.gateTag}>
          <span className={css.gateIcon}>⛨</span>
          <code>{shellCmd(step.gate, os)}</code>
        </div>
      )}

      <button
        className={css.expandBtn}
        onClick={() => setOpen((v) => !v)}
        style={{ borderColor: open ? agentColor : undefined, color: open ? agentColor : undefined }}
      >
        {open ? '− Less' : '+ Docs & files'}
      </button>

      {open && (
        <div className={css.stepDetail}>
          {step.reads.length > 0 && (
            <div className={css.detailSection}>
              <div className={css.detailLabel}>📥 Reads</div>
              <ul className={css.fileList}>
                {step.reads.map((f) => (
                  <li key={f}>
                    <FilePath path={f} onOpen={onOpenDoc} connected={connected} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {step.writes.length > 0 && (
            <div className={css.detailSection}>
              <div className={css.detailLabel}>📤 Writes</div>
              <ul className={css.fileList}>
                {step.writes.map((f) => (
                  <li key={f}>
                    <FilePath path={f} onOpen={onOpenDoc} connected={connected} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {step.notes && (
            <div className={css.detailNote}>{osifyProse(step.notes, os)}</div>
          )}
        </div>
      )}
    </div>
  );
}

function AgentSection({ agent, connected, onOpenDoc, onOpenDocs, template, os }: {
  agent: Agent;
  connected: boolean;
  onOpenDoc: (path: string) => void;
  onOpenDocs: (agent: Agent, tab: 'rulebook' | 'manifest' | 'terminal') => void;
  template: FlowTemplate;
  os: OsType;
}) {
  return (
    <div className={css.agentSection}>
      <div className={css.agentLabel} style={{ background: agent.color }}>
        {agent.emoji} {agent.label}
      </div>

      <div className={css.agentBody}>
        {/* Agent header */}
        <div className={css.agentHead}>
          <span className={css.agentRole}>{agent.role}</span>
          <span className={css.agentModel}>{agent.model}</span>
        </div>

        {/* Steps */}
        <div className={css.stepsRow}>
          {agent.steps.map((s, i) => (
            <div key={i} className={css.stepWrap}>
              <StepCard step={s} agentColor={agent.color} connected={connected} onOpenDoc={onOpenDoc} os={os} />
              {i < agent.steps.length - 1 && <div className={css.arrow}>→</div>}
            </div>
          ))}
        </div>

        {/* Docs + Terminal — open the AgentDocModal on the relevant tab */}
        <div className={css.agentFooter}>
          <button className={css.footerToggle} onClick={() => onOpenDocs(agent, 'rulebook')}>
            <span>📄 Rule book &amp; manifest</span>
            <span className={css.toggleCaret}>↗</span>
          </button>
          <button className={css.footerToggle} onClick={() => onOpenDocs(agent, 'terminal')}>
            <span>⌨ Terminal command</span>
            <span className={css.toggleCaret}>↗</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

type FlowTemplate = 'full' | 'compact';

export function FlowView() {
  const isConnected  = useAppStore((s) => s.isConnected);
  const readRepoFile = useAppStore((s) => s.readRepoFile);
  const os           = useAppStore((s) => s.settings.os);
  const arbiterConfig = useAppStore((s) => s.arbiterConfig);

  const [template, setTemplate] = useState<FlowTemplate>('full');

  const execPlanDir  = arbiterConfig.exec_plan_dir;
  const agentsDir    = 'compliance/automation/agents';
  const manifestsDir = 'compliance/automation/context-manifests';

  const PHASE_GROUPS = useMemo(
    () => buildPhaseGroups(execPlanDir, agentsDir, manifestsDir),
    [execPlanDir, agentsDir, manifestsDir],
  );
  const COMPACT_PHASE_GROUPS = useMemo(
    () => buildCompactPhaseGroups(execPlanDir, agentsDir, manifestsDir),
    [execPlanDir, agentsDir, manifestsDir],
  );
  const SURVEYOR = useMemo(
    () => buildSurveyor(execPlanDir, agentsDir, manifestsDir),
    [execPlanDir, agentsDir, manifestsDir],
  );

  const activeGroups = template === 'compact' ? COMPACT_PHASE_GROUPS : PHASE_GROUPS;

  const [docModal, setDocModal] = useState<{
    agentKey:   string;
    agentLabel: string;
    agentEmoji: string;
    agentModel: string;
    template:   FlowTemplate;
    initialTab: 'rulebook' | 'manifest' | 'terminal';
  } | null>(null);

  const openAgentDocs = useCallback((agent: Agent, tab: 'rulebook' | 'manifest' | 'terminal', tpl: FlowTemplate) => {
    setDocModal({ agentKey: agent.key, agentLabel: agent.label, agentEmoji: agent.emoji, agentModel: agent.model, template: tpl, initialTab: tab });
  }, []);

  const [docPath,    setDocPath]    = useState<string | null>(null);
  const [docContent, setDocContent] = useState<string | null>(null);
  const [docLoading, setDocLoading] = useState(false);

  const openDoc = useCallback(async (path: string) => {
    setDocPath(path);
    setDocContent(null);
    setDocLoading(true);
    const content = await readRepoFile(path);
    setDocContent(content);
    setDocLoading(false);
  }, [readRepoFile]);

  const closeDoc = useCallback(() => {
    setDocPath(null);
    setDocContent(null);
  }, []);

  return (
    <div className={css.shell}>
      {docModal && (
        <AgentDocModal
          agentKey={docModal.agentKey}
          agentLabel={docModal.agentLabel}
          agentEmoji={docModal.agentEmoji}
          agentModel={docModal.agentModel}
          template={docModal.template}
          initialTab={docModal.initialTab}
          onClose={() => setDocModal(null)}
        />
      )}

      {docPath && (
        <DocPopup
          path={docPath}
          content={docContent}
          loading={docLoading}
          onClose={closeDoc}
        />
      )}

      <div className={css.header}>
        <div className={css.headerTitle}>Factory Pipeline</div>
        <div className={css.headerSub}>
          {template === 'full'
            ? <>13 agents · serial execution · <strong>3 human gates</strong> · persistent Conductor · cross-model audits · <code>{shellCmd('scripts/factory.sh run', os)}</code> starts the factory</>
            : <>5 agents · brainstorm → build → test → push · <strong>1 human gate</strong> · fast iteration · <code>{shellCmd('scripts/factory.sh run', os)}</code> starts the factory</>
          }
          {isConnected && <span className={css.connectedHint}> · click any file path to read it</span>}
        </div>
        <div className={css.templateRow}>
          <span className={css.templateLabel}>Template:</span>
          <button
            className={`${css.templateBtn}${template === 'full' ? ' ' + css.templateBtnActive : ''}`}
            onClick={() => setTemplate('full')}
          >
            🏭 Full pipeline <span className={css.templateCount}>13 agents</span>
          </button>
          <button
            className={`${css.templateBtn}${template === 'compact' ? ' ' + css.templateBtnActive : ''}`}
            onClick={() => setTemplate('compact')}
          >
            ⚡ Compact <span className={css.templateCount}>5 agents</span>
          </button>
        </div>
      </div>

      <div className={css.content}>
        {/* Entry point */}
        <div className={css.userNode}>
          <div className={css.userCircle}>👤</div>
          <div className={css.userLabel}>You describe the feature</div>
          <div className={css.userSub}>
            Write in the Plan modal → Submit to Factory → drops a task brief in{' '}
            <code>{execPlanDir}/01-inbox/</code>
          </div>
          <div className={css.entryCmd}>
            <code>{shellCmd('scripts/factory.sh run', os)}</code>
            <span className={css.entryCmdNote}>— start the conductor daemon (picks up inbox automatically)</span>
          </div>
        </div>

        {/* Explainer cards — full pipeline only */}
        {template === 'full' && <div className={css.factoryExplainer} style={{ width: '100%', maxWidth: 980, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Row 1 — runtime mechanics: two side-by-side columns */}
          <div className={css.explainerRow} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className={css.explainerBlock}>
              <div className={css.explainerIcon}>💓</div>
              <div className={css.explainerTitle}>Agent heartbeat</div>
              <div className={css.explainerBody}>
                Every agent writes a <code>.arbiter/agents/&lt;name&gt;.json</code> heartbeat every ~30 s while it runs — recording the agent name, current task, last-active timestamp, and its latest status line. If the heartbeat goes stale for more than 90 s the conductor marks it timed-out, kills the process, and retries once before moving the task to <code>07-failed/</code>. Dashboard agent cards colour live from these files: green = active, grey = idle, amber = stale.
              </div>
            </div>
            <div className={css.explainerBlock}>
              <div className={css.explainerIcon}>🎼</div>
              <div className={css.explainerTitle}>How the conductor works</div>
              <div className={css.explainerBody}>
                <code>factory.sh</code> is the conductor — a long-running bash daemon that owns one task at a time. It moves the task folder through numbered stage directories, spawns each agent as a sub-process, and waits for its output file before starting the next. One task builds end-to-end before the next starts. When a gate is reached it writes to <code>.arbiter/pending-gates.json</code>, pauses, and polls for your approval file. Once that file appears the conductor unblocks and continues automatically.
              </div>
            </div>
          </div>

          {/* Row 2 — human-in-the-loop: three horizontal cards */}
          <div className={css.explainerRow3} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div className={css.explainerBlock}>
              <div className={css.explainerIcon}>💬</div>
              <div className={css.explainerTitle}>Chatting with the Conductor</div>
              <div className={css.explainerBody}>
                When a gate is reached the dashboard opens a full-screen chat overlay automatically. The Conductor — a persistent Claude claude-opus-4-7 session — reads all relevant agent outputs for that gate and briefs you in plain language: what was found, what was decided, what is still open. You chat naturally; it tracks open items and resolves them one by one as you discuss. The same session carries context across all three gates for a task so it remembers earlier decisions. If you ask for a change that needs an agent re-run, the Conductor issues a <code>[RERUN:agent-name]</code> signal, the overlay closes, and the factory re-spawns that agent before returning to the gate.
              </div>
            </div>
            <div className={css.explainerBlock}>
              <div className={css.explainerIcon}>📂</div>
              <div className={css.explainerTitle}>Stage progression</div>
              <div className={css.explainerBody}>
                Each task lives in exactly one stage directory at a time inside <code>compliance/exec-plan/</code>:{' '}
                <code>01-inbox</code> → <code>02-incubating</code> (agents writing) → <code>03-building</code> (active build) → <code>04-human-gate</code> (waiting for you) → <code>05-review</code> (reviewer + tech-writer) → <code>06-completed</code> → <code>07-failed</code>. The conductor moves the folder; agents never touch the stage themselves. The dashboard probes these directories every 5 s and derives the current status directly from which folder the task lives in — no cache, always live.
              </div>
            </div>
            <div className={css.explainerBlock}>
              <div className={css.explainerIcon}>✅</div>
              <div className={css.explainerTitle}>Approval process</div>
              <div className={css.explainerBody}>
                The Approve button is locked until the Conductor sends <code>[ALL_RESOLVED]</code> — it only emits that token once every open item has been genuinely discussed and settled. Clicking Approve shows a confirmation dialog; confirming writes <code>.arbiter/gate-approvals/&lt;task-id&gt;-&lt;gate&gt;.json</code>. The conductor is polling for that exact filename in a tight loop — the moment it appears the task folder moves back to <code>02-incubating</code> and the next agent starts. No terminal action needed. One approval file per gate, named to prevent collisions between concurrent tasks.
              </div>
            </div>
          </div>
        </div>}

        <div className={css.downArrow}>↓</div>

        {/* Phase groups — driven by active template */}
        {activeGroups.map((group, gi) => (
          <div key={group.phase} className={css.phaseGroup}>
            <div className={css.phaseLabel} style={{ borderColor: group.color, color: group.color }}>
              {group.phase}
            </div>
            <div className={css.phaseAgents}>
              {group.agents.map((agent, ai) => (
                <div key={agent.key} className={css.agentWithArrow}>
                  <AgentSection agent={agent} connected={isConnected} onOpenDoc={openDoc} onOpenDocs={(a, tab) => openAgentDocs(a, tab, template)} template={template} os={os} />
                  {ai < group.agents.length - 1 && <div className={css.rightArrow}>→</div>}
                </div>
              ))}
            </div>
            {gi < activeGroups.length - 1 && <div className={css.downArrow}>↓</div>}
          </div>
        ))}

        <div className={css.downArrow}>↓</div>

        {/* Merge + Surveyor */}
        <div className={css.mergeNode}>
          <span className={css.mergeIcon}>✓</span>
          <span className={css.mergeLabel}>PR merged · lessons loop closes</span>
        </div>

        {template === 'full' && (
          <>
            <div className={css.downArrow} style={{ opacity: 0.4 }}>↓ nightly</div>
            <div className={css.surveyorWrap}>
              <div className={css.surveyorBadge}>SCHEDULED</div>
              <AgentSection agent={SURVEYOR} connected={isConnected} onOpenDoc={openDoc} onOpenDocs={(a, tab) => openAgentDocs(a, tab, 'full')} template="full" os={os} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
