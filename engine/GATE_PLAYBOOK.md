# Gate playbook — how to operate the 2 human gates

The factory has exactly two points where a human must decide before the pipeline continues.
Everything else is autonomous. This playbook explains what you see, what to check, and how to act.

---

## Gate 1 — Schema gate

**Triggers:** any task whose `5-plan.json` has a DB layer (`layers` includes `backend` and
the design agent produced a `generated/db-schema/` diff).

**Runs between:** design/integrator → backend build.

### What you see in the dashboard

A mermaid ER diagram showing only the diff — new tables highlighted green, modified columns
highlighted yellow, no unchanged tables shown. The full schema is available on demand.

### What to check

- [ ] No cross-module foreign keys (verify against `{{MODULE_ISOLATION_RULES}}`)
- [ ] New table and column names follow your naming convention
- [ ] No personally-identifiable columns missing encryption or masking
- [ ] `{{COMPLIANCE_STANDARD}}` hard constraints satisfied — or write "none"
- [ ] The design-of-record (`3-design.md`) matches what the diagram shows

### Approve

```
arbiter approve <task-id> schema
```

The conductor proceeds to the backend build step.

### Reject

```
arbiter reject <task-id> schema "reason"
```

The task moves back to the design agent with your reason. The design agent rewrites
`3-design.md` and the conductor re-runs the gate.

---

## Gate 2 — UI gate

**Triggers:** any task where `5-plan.json` has `ui_first: true` (i.e. a frontend feature
where you want to approve the UI before the backend is built).

**Runs between:** frontend build → backend build.

### What you see in the dashboard

Vision-capture screenshots of every route the frontend agent touched, rendered in your
connected project's dev server. The gate card shows a before/after diff if a route already existed.

### What to check

- [ ] Routes render without console errors
- [ ] Layout matches the design doc (`3-design.md` mockup or description)
- [ ] Mobile breakpoint is usable (check the mobile screenshot)
- [ ] Empty states and loading states are handled
- [ ] No hardcoded placeholder text, lorem ipsum, or `TODO` UI left in
- [ ] The feature is actually clickable/usable — not just visually present

### Approve

```
arbiter approve <task-id> ui
```

The conductor proceeds to the backend build step.

### Reject

```
arbiter reject <task-id> ui "reason"
```

The task returns to the frontend agent — **strike 1**. The frontend agent retries
with your reason as additional context.

Two rejections trigger the **debugger agent** (fresh context, error logs + screenshots).
If the debugger cannot resolve it, the task moves to `exec-plan/07-failed/` for manual inspection.

---

## Zero-gate tasks

Tasks with archetype `refactor`, `docs`, or `test-backfill` skip both gates automatically.
The conductor runs headlessly — no human touchpoint required.

Pure backend fixes (`archetype: backend-fix`) skip the UI gate but may trigger the schema gate
if the fix involves a migration.

---

## Gate timeout

If a gate is not approved or rejected within `GATE_TIMEOUT_HOURS` (default: 48 hours),
the conductor pauses the task and notifies `{{OWNER_CHAT_ID}}` (if configured).
The task remains in `exec-plan/04-human-gate/` until you act — it does not auto-approve or auto-fail.

---

## Operating via CLI vs dashboard

Both are equivalent. Use whichever is faster:

| Action | CLI | Dashboard |
|--------|-----|-----------|
| See pending gates | `arbiter status` | Gate card on Board tab |
| Approve schema | `arbiter approve <id> schema` | Click "Approve" on gate card |
| Approve UI | `arbiter approve <id> ui` | Click "Approve" on gate card |
| Reject with reason | `arbiter reject <id> schema "reason"` | Click "Reject", type reason |
