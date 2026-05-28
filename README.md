# Arbiter — AI Pipeline Orchestration Engine

> Runs a full 14-agent pipeline on any coding task — triage, design, implementation, testing, review — and delivers a PR.

## What is Arbiter?

Arbiter is an open-source AI pipeline orchestration engine. You give it a task description; it automatically:

1. **Triages** the task (Simple / Localized Fix / Full Feature)
2. **Designs** a solution with machine-enforceable contracts
3. **Implements** frontend and backend in a git worktree (never touches your main branch)
4. **Tests** with an Iron Funnel gate system (5 sequential quality gates)
5. **Reviews** via an Orchestrator agent that checks the full diff
6. **Delivers** a clean PR with receipts

## Quick Start (3 commands)

```bash
npm install -g @arbiter-pipeline/cli
cd your-project
arbiter init
```

Then run a task:
```bash
echo "Add a login page with email + password" > task.md
arbiter run task.md
```

Open the dashboard:
```bash
arbiter dashboard
```

## Requirements

- Node.js ≥ 20
- Claude API key (Anthropic) OR Claude Max subscription (CLI mode)
- Git

## Pipeline Tiers

Arbiter automatically routes tasks to the right pipeline:

| Tier | Profile | Agents | Use when |
|------|---------|--------|----------|
| 1 | Speed | 5 agents | Trivial changes (typo, config tweak) |
| 2 | Investigator | 7 agents | Localized bug fix |
| 3 | Full | 14 agents | New feature, refactor |

## Iron Funnel Quality Gates

Every task passes through 5 gates before a PR is opened:

| Gate | Type | What it checks |
|------|------|----------------|
| 1 | Deterministic | TypeScript / compiler — zero errors |
| 2 | LLM | Test writer generates coverage |
| 3 | Deterministic | All tests pass, coverage floors met |
| 4 | LLM | Debugger fixes failures (if Gate 3 failed) |
| 5 | LLM | Orchestrator semantic review |

Gate 4 is skipped when Gate 3 passes on the first try.

## Dashboard

```bash
arbiter dashboard              # Start at http://localhost:3070
arbiter dashboard --port 4000  # Custom port
```

The dashboard shows:
- Live pipeline progress with Iron Funnel gate status
- Tier badges (T1/T2/T3) on job cards
- Critical path flags
- Gate timeout warnings (4h warn, 8h escalate)
- AI assistant chat (routes to Orchestrator when running)

## Configuration

`arbiter init` generates `arbiter.config.json` in your project root. Key fields:

```json
{
  "project": "my-project",
  "arbiter_dir": "arbiter",
  "branch_prefix": "feat/arbiter-",
  "stack": {
    "language": "TypeScript",
    "framework": "React",
    "test_runner": "vitest"
  },
  "coverage_floors": {
    "statements": 70,
    "branches": 65,
    "functions": 70
  }
}
```

## `arbiter sync`

Sync agent templates after updating the package:

```bash
arbiter sync           # Update templates in arbiter/ folder
arbiter sync --check   # Preview changes without writing
```

## Provider Setup

### Option A: Claude Max (CLI mode — no API key needed)
```json
{
  "provider": "claude_max_cli",
  "roles": {
    "triage":    { "model": "claude-opus-4-7" },
    "design":    { "model": "claude-opus-4-7" },
    "frontend":  { "model": "claude-sonnet-4-6" },
    "backend":   { "model": "claude-sonnet-4-6" },
    "orchestrator": { "model": "claude-opus-4-7" }
  }
}
```

### Option B: Anthropic API
```json
{
  "provider": "anthropic_api",
  "anthropic_api_key": "sk-ant-...",
  "roles": { ... }
}
```

## Contributing

PRs welcome. Please run `npm run typecheck && npm test` before submitting.

## License

MIT
