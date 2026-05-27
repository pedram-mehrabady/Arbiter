# Contributing to Arbiter

## Prerequisites

- Node.js 18+
- npm 9+
- Git

## Setup

```bash
git clone https://github.com/pedram-mehrabady/Arbiter.git
cd Arbiter
npm install
```

## Development workflow

```bash
npm run dev          # run CLI from source (tsx)
npm run typecheck    # TypeScript strict check
npm test             # run all tests (vitest)
npm run test:watch   # watch mode
npm run build        # compile to dist/
```

## Branch naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feat/<short-description>` | `feat/ollama-streaming` |
| Bug fix | `fix/<short-description>` | `fix/gate-race-condition` |
| Docs | `docs/<short-description>` | `docs/provider-guide` |
| Test | `test/<short-description>` | `test/bundle-assembler` |
| Chore | `chore/<short-description>` | `chore/bump-sdk` |

## Pull request checklist

- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm test` passes (all existing tests green)
- [ ] New behaviour is covered by a test
- [ ] No new `any` casts without a comment explaining why
- [ ] `ServiceResult<T>` pattern used — no `throw` from service/data layers
- [ ] Atomic file writes use the `tmp → rename` pattern (see `StateStore.write`)

## Code style

- TypeScript strict mode — `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- `ServiceResult<T>` everywhere: `{ ok: true; value: T } | { ok: false; error: string; code?: string }`
- No comments explaining what code does — only *why* (hidden constraints, workarounds)
- 150-line limit on any single class method
- No default exports

## Adding a new provider

1. Create `src/providers/YourProvider.ts` implementing `LLMProvider`
2. Export from `src/index.ts`
3. Wire into `Conductor.loadConfig()` under a new provider key
4. Add unit tests in `tests/unit/YourProvider.test.ts` (mock the network call)

## Adding a new agent role

1. Add the role to `AgentRole` in `src/types/index.ts`
2. Add its context manifest to `AGENT_CONTEXT_MANIFESTS` in `src/context/ContextAssembler.ts`
3. Create `agents/templates/<role>.md`
4. Handle it in `Conductor.runSubTask()` if it needs special post-processing (like `plan` or `design-critic`)

## Reporting bugs

Open an issue at <https://github.com/pedram-mehrabady/Arbiter/issues> with:
- Arbiter version (`arbiter --version`)
- Node version (`node --version`)
- Minimal reproduction steps
- Relevant output from `.arbiter/decision-log.jsonl`

## License

By contributing you agree that your contributions will be licensed under the MIT License.
