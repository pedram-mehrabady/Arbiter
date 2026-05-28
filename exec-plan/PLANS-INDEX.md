# Plans — one roof (index)

The single entry point to **every plan** in the repo for {{PROJECT_NAME}}. New factory tasks live
as their own `exec-plan/<state>/<task-id>/` folder (the conductor's state machine); the
surveyor's proposals live in `00-proposed/`. This index gives the "one roof" view; the Jarvis
board reads the live `exec-plan/` states + `.arbiter/board.json`.

## Live (conductor state machine)
- `00-proposed/` — surveyor proposals awaiting triage
- `01-inbox/` → `02-incubating/` → `03-building/` → `04-human-gate/` → `05-review/` → `06-completed/` / `07-failed/`
- `tech-debt-tracker.md` — reviewer-populated debt

## Roadmap
_No plans yet._

## Incubating
_No plans yet._

## Building
_No plans yet._

## Completed
_No plans yet._

## Archive
_No plans yet._

## Parking lot
_No plans yet._
