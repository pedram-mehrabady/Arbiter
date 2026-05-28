# RESEARCH-SCHEMA — the contract for `2-research.md`

> Authored by: senior architect.
> Enforced by: `scripts/validate-2research.sh`. Read by: `design` (anchors
> API/DB decisions on the answered questions), `integrator` (cross-checks
> reuse-list claims against research's citations), `plan` (uses
> `requires-broader-research` to scope follow-up tasks), `debugger` (when a
> design choice trips a bug, research's evidence trail is the audit log).
>
> **Why this exists.** Research is the third agent and the ONLY agent
> licensed to read source files. Its blast radius is the
> largest in the pipeline: bad research → design picks wrong patterns →
> integrator gives wrong reuse signal → plan dispatches coders on a wrong
> premise → coders write wrong code → reviewer catches → debugger spins →
> quarantine. The most expensive upstream failure.
>
> LLMs are notoriously bad at spatial reasoning (line numbers) and lazy when
> faced with large context windows. This schema is engineered against the
> "silent killers" of RAG pipelines: ghost-citations (RS14), out-of-bounds
> line numbers (RS16), ghost JSON pointers (RS17), and lazy-researcher
> punting on >50% of questions (RS18). Every cited `<path>:<line>` is
> physically verified to exist AND to fit inside the file's actual line
> count. Every registry json-path is dereferenced with `jq -e`. Every
> existence-claim verb (`exists`/`handles`/`implements`/`uses`) MUST be
> backed by a citation in the same Q-block. The output is engineered so
> design can `grep '### Q<N>:'` to extract a specific answer with zero
> prose-skim cost.

---

## 1. File location

```
<task-folder>/2-research.md
```

Written by `research`. Read by `design`, `integrator`, `plan`, `debugger`.
Conductor runs `validate-2research.sh` immediately after spawn; on fail →
re-spawn (max 3) → on final fail → quarantine to `07-failed/` (research is
upstream of design+integrator+plan+coders; bad research poisons the entire
build chain — NOT best-effort).

## 2. Required structure

```
---
<yaml frontmatter — fields below, validated>
---

## 1. Must-resolve answers
### Q1: <verbatim question text from 1-questions.md § 1 #1, trailing [seeds: ...] stripped>
**Answer:** <one-paragraph evidence-backed answer>
**Evidence:**
- <path>:<line> — <what this file/line proves>
- .arbiter/registry.json#<dot-path> — <reuse signal>

### Q2: <verbatim question text from 1-questions.md § 1 #2>
**Answer:** ...
**Evidence:**
- ...

## 2. Nice-to-have answers
### Q1: <verbatim question text from 1-questions.md § 2 #1>
**Answer:** ...
**Evidence:** ...

## 3. Open / requires broader research
### Q<N> (must-resolve | nice-to-have): <verbatim question text>
**Open:** <reason this couldn't be answered with the bounded scope — needs human input>
   — OR —
**Requires-broader-research:** <reason this would need >15 files or cross-team knowledge — design or human decides whether to escalate>

(use `(none)` if everything was answered)

## 4. Sources consulted
- registry: <N> entries scanned
- sibling-apps: <list — {{SIBLING_APPS}} | (none)>
- codebase: <ordered list of file paths actually opened, MUST equal source_files_read_count>
- domain-spec: <list of domain-spec docs read | (none)>
- web: <list of URLs fetched | (none)>
```

The 4 prose sections are mandatory and named EXACTLY as shown. Each
answered Q-anchor MUST follow `### Q<N>: <verbatim question>` then the
`**Answer:**` and `**Evidence:**` blocks. § 3 entries use `**Open:**` or
`**Requires-broader-research:**` instead of `**Answer:**` (no
`**Evidence:**` required).

### Verbatim-question rule (with normalization)

Each `### Q<N>:` heading text MUST match the corresponding numbered bullet
in `1-questions.md` (after stripping any trailing `[seeds: ...]`
attribution). The validator NORMALIZES both sides before comparison:
- smart quotes (`" " ' '`) → straight quotes (`" '`)
- em-dash / en-dash (`— –`) → hyphen (`-`)
- collapse runs of whitespace
- trim leading/trailing whitespace

This kills false-positive mismatches from typography drift; semantic
hallucination still fails RS6.

§ 1 of `2-research.md` mirrors § 1 of `1-questions.md` 1:1; § 2 mirrors
§ 2 1:1. A question may appear in § 3 INSTEAD of § 1/§ 2 (when open or
requires-broader-research); the bookkeeping is enforced by the count
identity in RS11.

## 3. Frontmatter — required fields

```yaml
---
schema_version: "1"
task_id: "<id>"
research_model: "<model-id>"
attempt: <int ≥ 1>
status: completed | blocked
reframe_verdict_seen: proceed | simplify    # MUST match upstream 0-reframe.md frontmatter (RS5)
questions_total_count: <int ≥ 0>             # = MR + NTH from 1-questions.md (must equal upstream)
questions_answered_count: <int ≥ 0>          # entries with **Answer:** across § 1 + § 2
questions_open_count: <int ≥ 0>              # entries with **Open:** in § 3
questions_requires_broader_research_count: <int ≥ 0>  # entries with **Requires-broader-research:** in § 3
sources_consulted: [registry|sibling-apps|codebase|web|domain-spec]   # non-empty array; at least "registry" expected
source_files_read_count: <int ≥ 0 and ≤ 15>  # hard cap (RS9); WARN at >10 (RS10)
blockers: []                                  # required non-empty IFF status == blocked (numbered-questionnaire format)
---
```

### Bi-conditionals (validator enforces)

| Condition | Required |
| --------- | -------- |
| `status == completed` | `questions_total_count > 0` AND identity in next row holds |
| identity | `questions_answered_count + questions_open_count + questions_requires_broader_research_count == questions_total_count` (RS11) |
| `status == blocked` | `blockers[]` non-empty AND each entry follows numbered-questionnaire format (RS15) |
| `questions_total_count != count(MR + NTH) from upstream 1-questions.md` | reject (RS7-A) |
| every must-resolve question from upstream | MUST appear in 2-research.md § 1 OR § 3 (RS7-B) |
| every nice-to-have question from upstream | MUST appear in 2-research.md § 2 OR § 3 (RS7-C) |
| each `### Q<N>:` heading text (normalized) | MUST match the corresponding upstream bullet (RS6) |
| each `**Answer:**` entry | MUST be followed (within the same `### Q<N>:` block) by `**Evidence:**` containing ≥1 `<path>:<line>` citation (RS8) |
| `source_files_read_count > 15` | reject (RS9 hard cap) |
| `source_files_read_count > 10` | WARN (RS10 approaching cap) |
| any answer body contains an architectural-decision pattern | reject (RS12 — `we should use`, `the design should`, `let's go with`, `decision:`, `the best approach is`, `obviously`, `recommend using`) |
| any Q-block contains an existence-claim verb (`exists`, `handles`, `implements`, `uses`) | MUST contain ≥1 `<path>:<line>` citation in the same Q-block (RS13 — positive structural rule replaces vague-pointer regex) |
| `reframe_verdict_seen` ≠ upstream `0-reframe.md` verdict | reject (RS5 — stale or fabricated reframe) |
| any cited `<path>:<line>` references a path that does not exist | reject (RS14 ghost-citation) |
| any cited `<path>:<line>` references a line beyond the file's actual length | reject (RS16 out-of-bounds — "Line 999" hallucination) |
| any cited `.arbiter/registry.json#<dot-path>` does not resolve via `jq -e` | reject (RS17 ghost JSON pointer — registry hallucination) |
| `questions_total_count > 2` AND `questions_answered_count < questions_total_count / 2` | reject (RS18 — lazy-researcher; punted on >50% of questions) |

## 4. Idempotency — the re-spawn rule

Research is a CLEAN RESTART (same pattern as reframe + question). On re-spawn:
- `attempt` MUST increment.
- Prior `2-research.md` is DELETED by the conductor before re-spawn.
- Conductor preserves `2-research-errors.md` (validator's specific RS-code
  violations); `scripts/assemble-context.sh` injects ALL `*-errors.md`
  files in the task folder into the agent's system prompt under a loud
  `===== VALIDATOR ERRORS FROM PRIOR ATTEMPT — READ THIS =====` header.
- The agent writes FRESH every time, addressing the SPECIFIC RS-codes from
  the prior attempt — no carry-forward of prior answers.

> **Why clean restart, not patch.** At temp=0 with the same anchor context,
> Sonnet/Haiku deterministically reproduce the same prose with the same
> citation gaps. Deleting the prior artifact + injecting the validator's
> RS-code list forces the model to RE-DO the question-answering loop with
> the specific defects in view, not patch around them.

## 5. Validation failures (what `validate-2research.sh` rejects)

| Code  | Message |
| ----- | ------- |
| RS1   | missing required frontmatter field: `<name>` |
| RS2   | `status` not one of `completed|blocked` |
| RS3   | `attempt < 1` or non-integer |
| RS4   | missing required prose section "## N. ..." (need all 4) |
| RS5   | `reframe_verdict_seen` ≠ upstream `0-reframe.md` frontmatter verdict (stale or fabricated reframe) |
| RS6   | a `### Q<N>:` heading does NOT match (after normalization: smart→straight quotes, dash→hyphen, ws collapsed) any upstream bullet in `1-questions.md` — research is hallucinating the question text |
| RS7-A | `questions_total_count` ≠ MR + NTH from upstream `1-questions.md` |
| RS7-B | a must-resolve question from upstream is NOT addressed in § 1 OR § 3 (dropped question) |
| RS7-C | a nice-to-have question from upstream is NOT addressed in § 2 OR § 3 (dropped question) |
| RS8   | a `### Q<N>:` block with `**Answer:**` has NO `**Evidence:**` block OR the `**Evidence:**` block contains zero `<path>:<line>` citations |
| RS9   | `source_files_read_count > 15` — hard cap; over-reading triggers "Lost in the Middle" hallucination (model cites file #3 when answer was in file #14). If a question needs more breadth, mark it `**Requires-broader-research:**` |
| RS10  | (WARN) `source_files_read_count > 10` — approaching cap; consider whether the question truly needs that breadth |
| RS11  | `questions_answered_count + questions_open_count + questions_requires_broader_research_count` ≠ `questions_total_count` — the bookkeeping identity must hold |
| RS12  | an answer body contains an architectural-decision pattern: `we should use`, `the design should`, `let's go with`, `decision:`, `the best approach is`, `obviously`, `recommend using`. Research ANSWERS (with evidence); design DECIDES. (`we will use` was removed — false-positive prone in factual descriptions like "the canonical pattern we will use for the outbox is …".) |
| RS13  | a Q-block contains an existence-claim verb (`exists`, `handles`, `implements`, `uses`) but has ZERO `<path>:<line>` citations in the same block. Existence claims MUST be proven by citation — no evidence = no claim. (Replaces the prior vague-pointer regex with a positive structural rule.) |
| RS14  | a cited `<path>:<line>` references a file that does not exist (ghost-citation). |
| RS15  | `status == blocked` but `blockers[]` empty OR not in numbered-questionnaire format (`^[0-9]+\. .+\?$`) |
| RS16  | a cited `<path>:<line>` references a line BEYOND the file's actual line count (out-of-bounds — "Line 999 of a 80-line file" hallucination). Computed via `wc -l < <path>`; rejected when `<line>` > file length. |
| RS17  | a cited `.arbiter/registry.json#<dot-path>` does not resolve — `jq -e '.<dot-path>' .arbiter/registry.json` exits non-zero. The LLM invented a registry path that doesn't exist. |
| RS18  | `questions_total_count > 2` AND `questions_answered_count < questions_total_count / 2` — lazy-researcher heuristic; you're punting on >50% of questions instead of doing the work. `Requires-broader-research` is for genuinely out-of-scope items, not an escape hatch. |

On failure: conductor writes `2-research-errors.md`, deletes prior
`2-research.md`, re-spawns (max 3). Final failure → quarantine to
`07-failed/` with the SPECIFIC failed RS-codes surfaced in the notification
(human reviewer instantly knows whether it's a format defect or a
hallucination defect). NOT best-effort — same posture as reframe + question.
