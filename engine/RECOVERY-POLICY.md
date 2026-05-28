# Recovery policy — how the conductor handles failure

The conductor (`factory.sh`) follows this on every failure. Principle:
**resume from the last good step, never blind-restart.** Each agent writes its own
committed artifacts and the conductor checkpoints to `.arbiter/state.json`, so a restart
picks up where it stopped — it does NOT redo planning or re-run a migration.

## Retry / escalate table

| Failure | Conductor action |
|---|---|
| An agent step errors / times out | retry the **same step once**; capture stderr+stdout to `.arbiter/error-logs/<task>/<agent>.log` |
| Gate fails after a coder (frontend/backend) | coder retries — **strike 1**, then **strike 2** |
| Two strikes on the same gate | spawn **`debugger`** (fresh context + the error-log + vision); not the coder again |
| Debugger can't make the gate pass | move task → **`07-failed/`** (dead-letter), notify, await human |
| Conductor daemon dies / stalls | **`watchdog.sh`** restarts it → **resume from `.arbiter/state.json`** (committed artifacts intact) |
| Laptop reboot / budget pause | resume from `state.json` when back / when the 5h window clears (`budget-governor.sh`) |
| Agent proposes a destructive command | **`bash-guard.sh`** blocks it → step fails → `07-failed/` + alert |
| Post-merge canary fails | auto-revert + alert + auto-create a follow-up fix task |
| State corrupt / unrecoverable | quarantine to `07-failed/`; manual: re-run from the last good committed artifact, or re-inbox |

## Hard limits
- **Max retries per step:** 1 (then escalate). **Max strikes before debugger:** 2.
- **Per-task timeout:** configurable (`FACTORY_TASK_TIMEOUT`, default 4h); on timeout → `07-failed/`.
- **Never** disable a test, lower a coverage threshold, or `--no-verify` to make a gate pass.

## Idempotency (what makes resume safe)
- Coders work on the task's branch/worktree, which can be reset — re-running a build step
  does not duplicate work.
- Planning artifacts (`0-reframe.md` … `5-plan.json`) are written once; if present on
  resume, the conductor does not regenerate them — it continues from the next missing step.
- `state.json` records `{task, phase, agent, strike}`; the conductor reads it on start and
  jumps to that point.

## Dead-letter (`07-failed/`)
A quarantined task keeps its full folder (all artifacts + `.arbiter/error-logs/<task>/`).
A human inspects, fixes or re-scopes, and either moves it back to `01-inbox/` or deletes it.
The conductor never auto-retries a dead-lettered task.
