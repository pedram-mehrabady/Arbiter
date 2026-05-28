# Sequencing policy — how `surveyor` decides what to propose next

The `surveyor` runs on a schedule, audits repo health, and writes ranked proposals to
`exec-plan/00-proposed/`. It **proposes**, it does not execute. These rules decide
ordering and what (if anything) may auto-enqueue.

## Ordering rules (highest priority first)
1. **Respect phase order.** Don't propose a Phase-2 business module before Phase-1.5
   foundations are done. Follow `exec-plan/` sequencing.
2. **Honor freezes.** If a freeze/merge-window is in effect, propose nothing that would
   merge during it.
3. **Dependencies must be merged.** Never propose work whose prerequisites aren't in `main`.
4. **{{COMPLIANCE_DOC}} items rank high.** Open gaps that block the
   certificate outrank feature work.
5. **Tech-debt with blast radius** (a shared contract drifting) outranks isolated polish.
6. **Quick wins when idle.** If the queue is empty, surface small safe-class items.

## Safe class — may AUTO-enqueue (no human promote needed)
- test-backfill (coverage below the ratchet floor)
- docs refresh / dead-link fixes
- lint / formatting / dependency patch (non-major)

Everything else — new modules, schema changes, anything `ui_first`, anything touching
auth/crypto/audit — is **proposal-only**. The human promotes it from `00-proposed/`
into the Up-Next queue in Jarvis.

## Output
- `survey-report.md` — the ranked rationale (what, why, when-appropriate).
- `exec-plan/00-proposed/<n>.md` — one proposal per file, each ready to become a task.
