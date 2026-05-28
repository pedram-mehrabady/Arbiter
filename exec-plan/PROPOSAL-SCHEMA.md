# PROPOSAL-SCHEMA — the contract for `exec-plan/00-proposed/<id>.md`

> Authored by: senior architect.
> Enforced by: `scripts/validate-survey-report.sh`. Read by: `plan` (when a
> proposal becomes a task), Jarvis (human triage UI), `run-surveyor.sh
> --safe-auto` (decides whether to auto-promote to `01-inbox/`), and
> `arbiter promote` (translates frontmatter + sections into
> the raw-ticket payload that `reframe` expects in `01-inbox/`).
>
> **Why this exists.** `surveyor` writes one `<id>.md` per proposal into
> `00-proposed/`. The frontmatter is the machine-readable contract; if it
> drifts from the pipeline's expectations the conductor crashes or
> silently mis-routes. Three classes of drift this schema kills:
>
> 1. **Pipeline-archetype mismatch.** `archetype` MUST be one of the 6 values
>    in `engine/TASK-ARCHETYPES.md` — the `plan` agent uses
>    that exact enum to pick a skip-profile. Granular business tags
>    (security-fix, lint, dep-patch, new-module, schema-change,
>    coverage-backfill) live in `category` instead (PROP15).
> 2. **Hallucinated multi-axis ranks.** LLMs are bad at stable sorting. Step
>    3 of the surveyor method mandates a numeric `priority_score` printed
>    in `## Why`, and PROP16 verifies the `rank` ordering strictly follows
>    descending scores (tiebreak: alphabetical id).
> 3. **Indefinite stale-sweep dodges.** PROP17 caps `expires_at` at
>    `proposed_at + 30 days` so the LLM can't write `expires_at: 2099-01-01`
>    to escape backlog grooming.

---

## 1. File location

```
exec-plan/00-proposed/<id>.md
```

Where `<id>` is the proposal id (e.g. `P-20260527-001`, `P-cov-contacts-2026-05-27`).

Written by `surveyor`. Read by `plan`, Jarvis, `run-surveyor.sh --safe-auto`,
and `arbiter promote` (which transforms it into the raw-ticket
payload `reframe` expects in `01-inbox/`).

Conductor `run-surveyor.sh` runs `validate-survey-report.sh` immediately
after surveyor writes; on fail → re-spawn (max 3) → on final fail →
quarantine to `.arbiter/surveyor-quarantine/<UTC-date>/` AND skip
`--safe-auto` entirely (NEVER auto-promote on a failed validator — bad
proposals would silently start the build pipeline).

## 2. Required structure

```
---
<yaml frontmatter — fields below, validated>
---

## What
<one paragraph — the proposed change>

## Why
<one paragraph — impact / urgency justification; cite {{COMPLIANCE_STANDARD}} gaps,
sequencing-policy bullet, registry-derived signal>

**Priority score:** Impact(<I>) + Urgency(<U>) + {{COMPLIANCE_STANDARD}}(<A>) = <total>
<one line — the mathematical scoring rubric; PROP16 parses this and
verifies `rank` matches descending order of scores>

## Files likely touched
- <repo-relative path>
- <repo-relative path> (new file)       # exempts from existence check
- <repo-relative path> (delete)          # exempts; file is being deleted
- <repo-relative path> (move)            # exempts; file is being renamed

## Acceptance
<one line — how we'll know it landed>
```

The 4 prose sections are mandatory and named exactly as shown.

**Path annotations** (PROP7 exemptions):
- ` (new file)` — path will be created
- ` (delete)` — path will be removed
- ` (move)` — path will be renamed (source no longer exists post-merge)

## 3. Frontmatter — required fields

```yaml
---
id: "P-<YYYYMMDD>-<NNN>" | "P-<category>-<slug>"
title: "<one-line human-readable title>"
proposed_at: "<ISO-8601 UTC>"
proposed_by: surveyor
rank: <int ≥ 1>                              # unique across the proposal set (PROP9); PROP16 enforces descending priority_score order
impact: high | medium | low                  # scored as 3 | 2 | 1 (Priority score block in ## Why)
urgency: high | medium | low                 # scored as 3 | 2 | 1
safe_class: auto-enqueue | propose-only      # NOT boolean — enum (PROP4)
archetype: feature | backend-fix | test-backfill | db-migration | refactor | docs   # PROP15: MUST match engine/TASK-ARCHETYPES.md exactly
category: coverage-backfill | doc-refresh | lint | dep-patch | new-module | schema-change | security-fix | feature | bugfix | other
phase_dependency: phase-1 | phase-1.5 | phase-2 | none
compliance_gap_id: "<id>" | null             # required when category=security-fix OR Why cites {{COMPLIANCE_STANDARD}} (PROP8)
expires_at: "<ISO-8601 date>"                # auto-stales after this date if not promoted; capped at proposed_at + 30 days (PROP17)
ui_first: true | false                        # interacts with PROP5 safe-class check
touches_sensitive: [auth, crypto, audit, idor, sessions, modules, schemas]  # array; empty if none
---
```

### Bi-conditionals (validator enforces)

| Condition | Required |
| --------- | -------- |
| `archetype` value | MUST be in the 6-value pipeline enum from `engine/TASK-ARCHETYPES.md` (PROP15 — pipeline mismatch crashes `plan`'s skip-profile picker) |
| `archetype ∈ {feature, db-migration}` OR `category ∈ {new-module, schema-change, security-fix}` | `safe_class == propose-only` (PROP5 — never auto-enqueue high-blast-radius work) |
| `ui_first == true` | `safe_class == propose-only` (PROP5 — UI work needs human sign-off) |
| `touches_sensitive` non-empty | `safe_class == propose-only` (PROP5) |
| `category == security-fix` OR Why prose contains `{{COMPLIANCE_STANDARD}}`/`OWASP`/`CC ` | `compliance_gap_id` non-null AND resolves to a real row in the compliance gap analysis (PROP8 — ghost-gap-id rejection) |
| `expires_at` | MUST be valid ISO date AND ≥ today AND ≤ `proposed_at + 30 days` (PROP10 + PROP17) |
| each path in `## Files likely touched` without `(new file)`/`(delete)`/`(move)` annotation | MUST exist on disk (PROP7 — ghost-file rejection) |
| `## Why` section | MUST contain a `**Priority score:** Impact(<i>) + Urgency(<u>) + {{COMPLIANCE_STANDARD}}(<a>) = <total>` line where total = i+u+a (PROP16 — mandates mathematical rubric) |
| `rank` ordering across all proposals | MUST be strictly descending by `priority_score` (extracted from each Why); ties resolved alphabetically by `id` (PROP16) |
| `rank` across all 00-proposed/ files | MUST be unique (PROP9) |
| count of 00-proposed/ files written in a single surveyor run | ≤ 12 (PROP11 — daily-cap, drown-the-human prevention) |
| `id` | MUST match `^P-[A-Za-z0-9._\-]+$` (PROP12) |

## 4. Idempotency — the carry-over rule

Surveyor runs nightly. When today's run encounters an existing
`00-proposed/<id>.md` from a prior day:

- **Carry-over (default):** leave the file untouched.
- **Stale sweep:** if `expires_at ≤ today`, move to `_stale/<id>.md`.
- **Supersede:** frontmatter `supersedes: "<old-id>"`; old file moves to
  `_stale/`, new file adds `replaces: "<old-id>"` in `## What`.

PROP17 caps `expires_at` at `proposed_at + 30 days` so stale-sweep
actually fires — the LLM cannot dodge by setting `expires_at: 2099-01-01`.

## 5. Validation failures (what `validate-survey-report.sh` rejects, PROP1-PROP17)

| Code   | Message |
| ------ | ------- |
| PROP1  | missing required frontmatter field: `<name>` |
| PROP2  | (deprecated — replaced by PROP15; was archetype enum) |
| PROP3  | `impact` or `urgency` not in `high|medium|low` |
| PROP4  | `safe_class` not in `auto-enqueue|propose-only` (boolean `true`/`false` rejected — was the legacy de-facto shape) |
| PROP5  | safe-class safety violation: `archetype ∈ {feature, db-migration}` OR `category ∈ {new-module, schema-change, security-fix}` OR `ui_first` OR `touches_sensitive` triggers `propose-only` but frontmatter has `safe_class: auto-enqueue` |
| PROP6  | `phase_dependency` not in `phase-1|phase-1.5|phase-2|none` |
| PROP7  | a path in `## Files likely touched` does not exist AND is not annotated `(new file)`, `(delete)`, or `(move)` |
| PROP8  | `compliance_gap_id` does not resolve to a row in the compliance gap analysis (ghost gap id) |
| PROP9  | `rank` value collides with another proposal in `00-proposed/` (ranks must be unique 1..N) |
| PROP10 | `expires_at` is not a valid ISO date OR is in the past |
| PROP11 | (cap) more than 12 proposals were written in this surveyor run |
| PROP12 | `id` does not match the regex `^P-[A-Za-z0-9._\-]+$` |
| PROP13 | missing required prose section "## What" / "## Why" / "## Files likely touched" / "## Acceptance" |
| PROP14 | `## What` / `## Why` / `## Acceptance` sections are empty (placeholder reject) |
| PROP15 | `archetype` value not in `engine/TASK-ARCHETYPES.md` pipeline enum (feature\|backend-fix\|test-backfill\|db-migration\|refactor\|docs) — would crash `plan`'s skip-profile picker |
| PROP16 | `## Why` lacks the `**Priority score:** Impact(i) + Urgency(u) + {{COMPLIANCE_STANDARD}}(a) = total` line OR the arithmetic is wrong OR the `rank` ordering across proposals does not strictly follow descending `priority_score` (tiebreak: alphabetical `id`) — LLM hallucinated the ranking |
| PROP17 | `expires_at` is more than 30 days from `proposed_at` — would dodge stale-sweep |

On failure: conductor (`run-surveyor.sh`) writes `surveyor-errors.md` next
to the surveyor's outputs, re-spawns (max 3). Final failure → quarantine
to `.arbiter/surveyor-quarantine/<UTC-date>/` AND `--safe-auto` is
unconditionally skipped (no proposal from a failed run is ever
auto-promoted).
