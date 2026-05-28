# Phase 04 — Machine-Enforceable Contracts + Context Intelligence
# Status: [x] COMPLETE — 2026-05-28
# Prerequisite: Phase 03 (Iron Funnel — Gate 1 must be live to enforce contracts)

## Objective
For Tier 3 tasks, Phase 1's Design agent now outputs actual compilable files
(schema.prisma, api.ts Zod schemas, events.ts interfaces) in addition to design-output.md.
These files are locked at Phase 1 approval — Gate 1 enforces no mutation by generators.
Context Builder gains package version injection and the madge dependency trace.
After this phase: Tier 3 tasks have typed, compiler-enforced contracts. Generators
cannot drift from the agreed API shape. Gate 1 catches violations in milliseconds.

---

## Deliverables

### 1. agents/templates/design.md  [MODIFIED]
Add Section: "Tier 3 Contract Generation" at the end of the rule book.

Instructions to add:
- After writing design-output.md, if TIER=3 in context, write THREE additional files:
  - `contracts/schema.prisma` — actual Prisma schema (or SQL DDL if no Prisma)
  - `contracts/api.ts` — Zod schemas for every request + response shape
  - `contracts/events.ts` — TypeScript interfaces for FE-BE events
- These files must compile. Use ONLY versions from the injected "Package versions" block.
- Write compilable code, not pseudo-code. The compiler validates these.
- If the task does not require new DB tables: schema.prisma = empty file with a comment.
- If the task does not require new API endpoints: api.ts = empty file with a comment.

### 2. src/contracts/ContractValidator.ts  [NEW]
Runs after Design agent completes for Tier 3 tasks.

Steps:
1. Validate `contracts/api.ts` compiles: `tsc --noEmit --strict contracts/api.ts`
2. Validate `contracts/events.ts` compiles: same
3. Validate `contracts/schema.prisma` if Prisma project: `prisma validate`
4. If any validation fails: return error to Conductor → Conductor sends back to Design with exact error + one retry

Returns:
```typescript
interface ContractValidationResult {
  passed: boolean;
  errors: Array<{ file: string; error: string }>;
}
```

On pass: Conductor writes `contracts_locked: true` to tasks table.

### 3. src/contracts/ContractFreezeEnforcer.ts  [NEW]
For Tier 2 tasks: adds `contracts/` to the forbidden write list.

Used by CompilerAirlockGate to detect contract mutations:
```typescript
class ContractFreezeEnforcer {
  getLockedPaths(tier: 1 | 2 | 3): string[] {
    if (tier === 2) return ['contracts/'];
    return [];  // Tier 1 and Tier 3 (before lock): no freeze
  }

  async checkMutations(worktreePath: string, lockedPaths: string[]): Promise<string[]> {
    // git diff --name-only HEAD -- returns list of changed files
    // Check if any changed file matches a locked path
  }
}
```

Gate 1 calls this for Tier 2 tasks. If any contract file was modified:
→ Fail with: `CONTRACT_MUTATION_ON_TIER2: {filename} is locked for Tier 2 tasks`
→ Conductor auto-reclassifies to Tier 3, triggers Phase 1

### 4. src/context/PackageVersionInjector.ts  [NEW]
Reads package.json and .csproj files. Injects version block into Design agent context.

```typescript
class PackageVersionInjector {
  async inject(workspaceRoot: string): Promise<string> {
    // Returns a string block like:
    // "# Package versions in this project (injected by Arbiter):\n# zod: 3.22.4\n..."
  }
}
```

Sources:
- `package.json` → direct dependencies + devDependencies
- `**/*.csproj` → PackageReference elements
- `**/requirements.txt` → Python packages (if present)

Injected at the TOP of the Design agent context, before any other content.
This is added to ContextAssembler for 'design' role.

### 5. src/context/ContextAssembler.ts  [MODIFIED]
Two changes:
1. For `design` role: prepend PackageVersionInjector output to assembled context
2. Add `buildContextWithMadge()` method (used by Phase 05+ agents):
   - Runs `npx madge --json <targetFiles>`
   - Intersects with role allowlist
   - Appends locked contracts
   - Enforces token budget per agent role
   - Falls back to existing glob if madge not installed (log warning, don't block)

Token budget constants (add to ContextAssembler):
```typescript
const TOKEN_BUDGETS: Record<AgentRole, number> = {
  'triage':       4_000,
  'investigator': 12_000,
  'backend':      24_000,
  'frontend':     24_000,
  'test-writer':  16_000,
  'orchestrator': 32_000,
  // existing roles: use existing pruner limits
};
```

### 6. src/conductor/Conductor.ts  [MODIFIED]
After Design agent completes (Tier 3 only):
1. Run ContractValidator
2. If validation fails: retry Design agent once with exact errors in context
3. If still fails: halt task with 'contract_generation_failed' status
4. If passes: write contracts_locked:true to SqliteStore
5. Inject locked contracts folder into all Generator agent contexts

For Tier 2 tasks:
- ContractFreezeEnforcer provides locked paths to CompilerAirlockGate

---

## Tests Required

### Unit tests
- tests/unit/ContractValidator.test.ts  [NEW]
  - Passes for valid Zod schema file
  - Fails and returns specific error for type-invalid api.ts
  - Passes empty file (optional schema)

- tests/unit/ContractFreezeEnforcer.test.ts  [NEW]
  - Returns empty locked paths for Tier 1 and Tier 3
  - Returns ['contracts/'] for Tier 2
  - Detects mutation in contracts/ via git diff output (mock)

- tests/unit/PackageVersionInjector.test.ts  [NEW]
  - Correctly parses package.json dependencies
  - Correctly parses .csproj PackageReference
  - Returns empty block when no package files found
  - Injects versions in correct format

- tests/unit/ContextAssembler.test.ts  [MODIFIED]
  - Design role: version injection prepended to context
  - madge fallback: when madge not installed, returns existing glob results

---

## Acceptance Criteria
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] Design agent rule book has Tier 3 contract generation section
- [ ] ContractValidator rejects invalid Zod types
- [ ] ContractFreezeEnforcer blocks contract mutation in Tier 2 task (test)
- [ ] PackageVersionInjector reads package.json and formats version block
- [ ] ContextAssembler prepends version block for 'design' role
- [ ] madge fallback works when madge is not installed
- [ ] Playwright smoke test still passes

---

## Files Changed Summary
| Action | File |
|---|---|
| MODIFIED | agents/templates/design.md |
| NEW | src/contracts/ContractValidator.ts |
| NEW | src/contracts/ContractFreezeEnforcer.ts |
| NEW | src/context/PackageVersionInjector.ts |
| MODIFIED | src/context/ContextAssembler.ts |
| MODIFIED | src/conductor/Conductor.ts |
| NEW | tests/unit/ContractValidator.test.ts |
| NEW | tests/unit/ContractFreezeEnforcer.test.ts |
| NEW | tests/unit/PackageVersionInjector.test.ts |
| MODIFIED | tests/unit/ContextAssembler.test.ts |

---

## Phase 04 DONE when:
All acceptance criteria checked. Then update plan/README.md: Phase 04 → [x]
