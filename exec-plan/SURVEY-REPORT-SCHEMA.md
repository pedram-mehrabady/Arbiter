# SURVEY-REPORT-SCHEMA — the contract for `00-proposed/survey-report.md`

> Authored by: senior architect.
> Enforced by: `scripts/validate-survey-report.sh`. Read by: humans
> (triage), `surveyor` (idempotency — tomorrow's run reads yesterday's
> report to compute net-new), Jarvis (renders the ranked list).
>
> **Why this exists.** The proposal files (`PROPOSAL-SCHEMA.md`) are
> machine-readable, one per ticket. The survey-report is the daily
> *rationale* document: ranked overview, net-new vs yesterday, stale
> sweep, {{COMPLIANCE_STANDARD}} gap deltas. Without a schema, the surveyor produced free
> prose and yesterday's report couldn't be mechanically diff'd against
> today's — so the "emit only NET-NEW" idempotency rule had no teeth.
>
> Scope discipline (Pedram's section 2): the surveyor cannot read
> `01-inbox/` / `02-incubating/` (manifest `never:` block — would bias
> ranking toward loud current work). So the report focuses purely on
> BACKLOG state, not execution state. The "promoted since yesterday"
> count was removed precisely because surveyor can't see the inbox to
> calculate it. The human checks the inbox.

---

## 1. File location

```
exec-plan/00-proposed/survey-report.md
```

Single file, overwritten each surveyor run. Idempotency is via
frontmatter `run_id` (timestamped) + the bookkeeping counts (new /
carried-over / stale-swept).

## 2. Required structure

```
---
<yaml frontmatter — fields below, validated>
---

## 1. Today's ranked proposals
<numbered list — each entry = one proposal id + one-line summary; rank 1..N matches PROPOSAL-SCHEMA frontmatter `rank` AND descending priority_score (PROP16)>

## 2. Net-new vs yesterday
<numbered list of NEW proposal ids written in this run; `(none)` if all are carry-overs>

## 3. Stale sweep
<numbered list of carry-over ids moved to `_stale/` this run (their `expires_at` was ≤ today); `(none)` if no expirations>

## 4. {{COMPLIANCE_STANDARD}} gap deltas
<numbered list of compliance gap ids whose status changed since yesterday's report (NOT_STARTED → PARTIAL, PARTIAL → DONE, etc.); `(none)` if no deltas>

## 5. Sequencing policy honored
- [x] Phase order respected — no Phase-2 proposals while Phase-1.5 foundations open
- [x] Freezes honored — no proposals targeting a current merge window
- [x] Dependencies merged — every proposal's prerequisites are in `main`
- [x] {{COMPLIANCE_STANDARD}}-deadline items ranked above feature work
- [x] Tech-debt with blast radius outranks isolated polish
- [x] Quick wins only surfaced when queue is otherwise empty

(Every box MUST be checked OR the line MUST carry an explicit `(deferred — see proposal P-...)` annotation.)
```

The 5 prose sections are mandatory and named EXACTLY as shown.

## 3. Frontmatter — required fields

```yaml
---
schema_version: "1"
run_id: "<YYYYMMDD-HHMMSS>"                       # timestamped run anchor; SR5 enforces the YYYYMMDD prefix == today UTC
surveyor_model: "<model-id>"
attempt: <int ≥ 1>
status: completed | blocked
proposals_total: <int ≥ 0>                        # = count of *.md files in 00-proposed/ excluding _stale/ + survey-report.md (SR6)
proposals_new: <int ≥ 0>                          # entries in § 2 (SR7)
proposals_carried_over: <int ≥ 0>                 # SR9: == proposals_total - proposals_new
proposals_stale_swept: <int ≥ 0>                  # entries in § 3 (SR8)
compliance_gap_deltas_count: <int ≥ 0>            # entries in § 4
sequencing_policy_honored: true | false           # false ONLY if § 5 has an explicit deferred annotation (SR14)
freeze_active: true | false                       # if true, status MUST be blocked OR proposals_new == 0 (SR13)
blockers: []                                      # required non-empty IFF status == blocked
---
```

**Field removed in v3:** `proposals_promoted_since_yesterday` — surveyor's
manifest forbids reading `01-inbox/` (would bias ranking), so it can't
mechanically compute this. The human checks the inbox to see what was
promoted.

**Field replaced in v3:** `report_date` → `run_id`. A timestamped run anchor
prevents the UTC-midnight race condition (a run starting at 23:55 UTC
finishing at 00:05 the next day) while still preventing stale reports —
SR5 checks the `YYYYMMDD` prefix matches today (UTC).

### Bi-conditionals (validator enforces)

| Condition | Required |
| --------- | -------- |
| `status == completed` | `freeze_active` honored: if true, `proposals_new == 0` (SR13) |
| `status == blocked` | `blockers[]` non-empty in numbered-questionnaire format (SR15) |
| `run_id` YYYYMMDD prefix | MUST equal today (UTC) — stale-report reject (SR5) |
| `proposals_total` | MUST equal count of `*.md` files in `00-proposed/` excluding `_stale/`, `survey-report.md`, `surveyor-errors.md` (SR6) |
| `proposals_new` | MUST equal count of entries in `## 2. Net-new vs yesterday` (SR7) |
| `proposals_stale_swept` | MUST equal count of entries in `## 3. Stale sweep` AND each cited id MUST exist in `00-proposed/_stale/` (SR8) |
| `proposals_carried_over` | MUST equal `proposals_total - proposals_new` (SR9 — bookkeeping identity) |
| ranks across § 1 | MUST form 1..N with no gaps and no dupes (SR10); same ordering enforced by PROP16 priority_score |
| every proposal id in § 1 | MUST have a corresponding file in `00-proposed/<id>.md` (SR11 — ghost-proposal) |
| every proposal file in `00-proposed/` | MUST appear in § 1 (SR12 — orphaned proposal) |

## 4. Idempotency — the carry-over rule

Surveyor reads yesterday's `survey-report.md` (if any) BEFORE writing
today's. The carry-over math:

1. Enumerate `00-proposed/*.md` (excluding `survey-report.md`,
   `surveyor-errors.md`, and `_stale/`).
2. For each existing proposal: if `expires_at ≤ today`, move to `_stale/`
   and add to today's `proposals_stale_swept`. (PROP17 caps `expires_at`
   at proposed_at + 30 days so this fires regularly.)
3. Today's `proposals_carried_over` = (count of carry-over files that
   survived step 2).
4. Today's `proposals_new` = brand-new proposal files written in this
   run.
5. Today's `proposals_total` = carry-over + new.

The bookkeeping identity `proposals_carried_over = proposals_total -
proposals_new` (SR9) is mechanically how "emit only NET-NEW" is enforced
— the model can't punt ("nothing new today") if the counts must
reconcile against the file system.

## 5. Validation failures (what `validate-survey-report.sh` rejects, SR1-SR15)

| Code  | Message |
| ----- | ------- |
| SR1   | missing required frontmatter field: `<name>` |
| SR2   | `status` not one of `completed|blocked` |
| SR3   | `attempt` < 1 or non-integer |
| SR4   | missing prose section "## N. ..." (need all 5) |
| SR5   | `run_id` YYYYMMDD prefix is not today (UTC) — stale report (timestamped suffix prevents the UTC-midnight race) |
| SR6   | `proposals_total` ≠ count of `*.md` in `00-proposed/` (excluding `_stale/` + `survey-report.md` + `surveyor-errors.md`) |
| SR7   | `proposals_new` ≠ count of entries in `## 2. Net-new vs yesterday` |
| SR8   | `proposals_stale_swept` ≠ count of entries in `## 3. Stale sweep`, OR a cited id is not in `_stale/` |
| SR9   | bookkeeping identity broken: `proposals_carried_over` ≠ `proposals_total - proposals_new` |
| SR10  | ranks in `## 1.` do not form 1..N without gaps/dupes |
| SR11  | a proposal id in `## 1.` has no corresponding file in `00-proposed/<id>.md` (ghost-proposal) |
| SR12  | a proposal file in `00-proposed/` is NOT listed in `## 1.` (orphaned proposal) |
| SR13  | freeze contradiction: `freeze_active: true` but `proposals_new > 0` (must HALT on freezes per engine/SEQUENCING-POLICY.md) |
| SR14  | `## 5. Sequencing policy honored` has an unchecked box without a `(deferred — ...)` annotation |
| SR15  | `status == blocked` but `blockers[]` empty OR not in numbered-questionnaire format (`^[0-9]+\. .+\?$`) |

On failure: `run-surveyor.sh` writes `surveyor-errors.md`, re-spawns
(max 3). Final failure → quarantine to
`.arbiter/surveyor-quarantine/<UTC-date>/` AND `--safe-auto` is
unconditionally skipped.
