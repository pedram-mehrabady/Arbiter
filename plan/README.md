# Arbiter — Implementation Plan Index
# Updated: 2026-05-28

Each phase ships a usable, stable checkpoint. Nothing breaks on phase completion.
Mark status: [ ] TODO  [~] IN PROGRESS  [x] COMPLETE

## Phase Status

| Phase | Name | Status | Blocks |
|---|---|---|---|
| 01 | Foundation — SQLite + WorktreeManager + Playwright | [x] | All phases |
| 02 | Triage Agent + 3-Tier Routing | [x] | 03, 04 |
| 03 | Iron Funnel Gates (1–5) | [x] | 04, 06 |
| 04 | Machine-Enforceable Contracts + Context Intelligence | [x] | 05 |
| 05 | Orchestrator Agent + Event-Driven Dispatch | [x] | 06, 07 |
| 06 | Webhook Loop + PR Comment Reactions | [x] | — |
| 07 | Dashboard Upgrades (Tier badges, Iron Funnel UI, Critical Path) | [x] | — |
| 08 | Distribution — arbiter sync, visible folder, npm polish | [x] | — |
| 09 | Competitive Moat — SubQ + ACP Stub | [x] | — |

## Rules
1. Never start a phase until all prerequisites are ✓ in the previous phase.
2. All tests must pass before marking a phase complete.
3. `npm run typecheck` must pass after every file change.
4. Playwright runs on phases with UI changes (07+) and distribution smoke tests (08).
5. No phase removes existing functionality — only extends.
