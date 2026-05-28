# Phase 08 — Distribution: arbiter sync, visible folder, npm polish
# Status: [x] COMPLETE — 2026-05-28
# Prerequisite: All phases 01–07 complete and passing

## Objective
Make Arbiter downloadable and usable by anyone from GitHub. `npm install -g @arbiter-pipeline/cli`
then `arbiter init` then `arbiter run task.md`. Rename `.arbiter/` → `arbiter/` (visible).
Add `arbiter sync` command for template updates. Polish npm package, README, and CI.
After this phase: Arbiter ships as a public open-source tool.

---

## Deliverables

### 1. `arbiter sync` CLI command  [NEW in src/cli/index.ts]
```
arbiter sync [--check] [--workspace <path>]
```

Behavior:
1. Find Arbiter installation dir (where the npm package lives)
2. Copy from installation to `{workspaceRoot}/arbiter/`:
   - `agents/templates/` → `arbiter/agents/templates/`
   - `agents/templates-speed/` → `arbiter/agents/templates-speed/`
   - `agents/manifests/` → `arbiter/agents/manifests/`
   - `agents/manifests-speed/` → `arbiter/agents/manifests-speed/`
   - `agents/orchestrator/` → `arbiter/agents/orchestrator/`
   - `agents/triage/` → `arbiter/agents/triage/`
   - `agents/investigator/` → `arbiter/agents/investigator/`
   - `agents/knowledge/` → `arbiter/agents/knowledge/`
   - `engine/` → `arbiter/engine/`
3. Substitute `{{TEMPLATE_VAR}}` placeholders using `arbiter.config.json` template_vars
4. Idempotent: use SHA-256 hash comparison — only write files that changed
5. `--check` flag: show diff without writing (dry run)
6. Print summary: "Synced 14 files. 3 updated. 11 unchanged."

### 2. Folder rename `.arbiter/` → `arbiter/`  [PROJECT-WIDE]
Migrate all code that reads/writes `.arbiter/` to use `arbiter/`.

Files to update (search for `.arbiter`):
- `src/state/SqliteStore.ts` — DB path
- `src/decisions/DecisionLog.ts`
- `src/receipts/BuildReceipt.ts`
- `src/evidence/EvidenceCache.ts`
- `src/bootstrap/` — all files
- `src/conductor/Conductor.ts`
- `dashboard/src/api/serverApi.ts` — ALL `.arbiter/` path references → `arbiter/`
- `dashboard/src/api/live.ts` — if it exists
- `src/task/TaskInitializer.ts`
- `src/task/TaskArchiver.ts`

Migration strategy:
- Add `ARBITER_DIR` constant to `src/constants.ts` [NEW]:
  ```typescript
  export const ARBITER_DIR = 'arbiter';
  ```
- Replace all hardcoded `.arbiter` string literals with `ARBITER_DIR`
- Single PR — do the rename atomically (all files in one commit)

### 3. Developer identity to `~/.arbiter/`  [MODIFIED]
Current: `.arbiter/developer-identity.json` (project-level, gets committed by accident)
New: `~/.arbiter/identity.json` (user home, never committed)

Update `src/bootstrap/ProjectRegistry.ts` and `dashboard/src/api/serverApi.ts`
to read/write from `~/.arbiter/identity.json`.

Create `~/.arbiter/` directory on first `arbiter init` if it doesn't exist.
Add `~/.arbiter/` to system gitignore documentation (not in project .gitignore).

### 4. `arbiter init` updated flow  [MODIFIED]
After init completes:
1. Scan project (already works)
2. Run interview (already works)
3. Write `arbiter.config.json` (already works)
4. Create `arbiter/` directory structure (new)
5. Run `arbiter sync` automatically
6. Initialize SqliteStore at `arbiter/state.db`
7. Write developer identity to `~/.arbiter/identity.json`
8. Print: "\n✓ Arbiter initialised.\n\nNext steps:\n  Create a task: echo 'Add login feature' > task.md\n  Run it: arbiter run task.md\n  Open dashboard: arbiter dashboard\n"

### 5. src/constants.ts  [NEW]
```typescript
export const ARBITER_DIR = 'arbiter';
export const ARBITER_STATE_DB = 'arbiter/state.db';
export const ARBITER_TASKS_DIR = 'arbiter/tasks';
export const ADMIN_CONFIG_PATH = `${process.env['HOME'] ?? '~'}/.arbiter/admin.config.json`;
export const IDENTITY_PATH = `${process.env['HOME'] ?? '~'}/.arbiter/identity.json`;
```

### 6. .gitignore  [MODIFIED]
Replace `.arbiter/state.db` → `arbiter/state.db`
Add: `arbiter/state.db`
Keep: `arbiter/tasks/` is NOT gitignored (task artifacts belong in repo)

### 7. package.json  [MODIFIED]
- `engines.node`: bump to `>=20.0.0` (was 18)
- `files` array: add `project-templates/` (needed for `arbiter init`)
- `scripts.prepublishOnly`: ensure it runs build + typecheck + test

### 8. README.md  [REWRITE]
Structured as:
```
# Arbiter — AI Pipeline Orchestration Engine

## What is Arbiter?
## Quick Start (3 commands)
## Requirements
## Pipeline Selection: Full vs Speed
## Dashboard
## Configuration Reference
## Telegram Setup (optional)
## Contributing
## License
```

Quick Start section:
```bash
npm install -g @arbiter-pipeline/cli
cd your-project
arbiter init
echo "Add a login page with email + password" > task.md
arbiter run task.md
```

### 9. .github/workflows/ci.yml  [MODIFIED]
Add:
- `smoke-test` job after `test`:
  - Creates temp dir
  - Runs `npm install -g .` (local install)
  - Runs `arbiter init --non-interactive`
  - Verifies `arbiter/` folder created
  - Verifies `arbiter.config.json` written
  - Verifies `arbiter/agents/templates/` synced
- Node version matrix: 20.x and 22.x
- Dashboard e2e job: `npm run test:e2e` in `dashboard/`

### 10. `arbiter dashboard` CLI command  [NEW or verify existing]
Start the Vite dev server for the dashboard.
```
arbiter dashboard [--port <port>] [--workspace <path>]
```

If `dashboard/` is not built, run `npm run build` in dashboard/ first.
Then: `npx serve dashboard/dist --port {port}` (or use built-in http server).
Print: "Dashboard running at http://localhost:3070"

---

## Tests Required (Playwright)

### dashboard/e2e/smoke.spec.ts  [MODIFIED]
Add: verify `.arbiter/` references are gone (no console errors about missing paths).

### dashboard/e2e/init-flow.spec.ts  [NEW]
Uses Playwright to verify the DeveloperSetupModal flow works after folder rename.
- Open dashboard
- If no identity: DeveloperSetupModal appears
- Enter name → submit → modal closes
- Identity file written to `~/.arbiter/identity.json` path (mock via serverApi)

### Integration test: smoke-test in CI
The `arbiter init --non-interactive` CI job verifies the full init flow without a browser.

---

## Acceptance Criteria
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] `arbiter sync` copies templates to `arbiter/` folder
- [ ] `arbiter sync --check` prints diff without writing
- [ ] `arbiter init` creates `arbiter/` (not `.arbiter/`) and auto-runs sync
- [ ] All dashboard serverApi calls use `arbiter/` path prefix (grep confirms zero `.arbiter/` refs)
- [ ] Developer identity written to `~/.arbiter/identity.json` not project folder
- [ ] `npm pack` produces clean tarball (no src/, tests/, docs/ included)
- [ ] CI smoke test passes: init + verify arbiter/ folder
- [ ] All Playwright tests pass
- [ ] `arbiter dashboard` starts dashboard server

---

## Files Changed Summary
| Action | File |
|---|---|
| NEW | src/constants.ts |
| NEW CLI command | src/cli/index.ts (arbiter sync, arbiter dashboard) |
| MODIFIED | src/cli/index.ts (arbiter init updated flow) |
| MODIFIED | src/state/SqliteStore.ts (use ARBITER_DIR) |
| MODIFIED | src/decisions/DecisionLog.ts |
| MODIFIED | src/receipts/BuildReceipt.ts |
| MODIFIED | src/evidence/EvidenceCache.ts |
| MODIFIED | src/bootstrap/* |
| MODIFIED | src/conductor/Conductor.ts |
| MODIFIED | src/task/TaskInitializer.ts |
| MODIFIED | src/task/TaskArchiver.ts |
| MODIFIED | dashboard/src/api/serverApi.ts (all .arbiter/ → arbiter/) |
| MODIFIED | .gitignore |
| MODIFIED | package.json |
| REWRITE | README.md |
| MODIFIED | .github/workflows/ci.yml |
| NEW | dashboard/e2e/init-flow.spec.ts |
| MODIFIED | dashboard/e2e/smoke.spec.ts |

---

## Phase 08 DONE when:
All acceptance criteria checked. Then update plan/README.md: Phase 08 → [x]
