# REFRAME — Manifest

## Role
Challenges the task premise before anyone writes code — decides whether to proceed, simplify, or redirect.

## Inputs
- spec.md (the feature brief to evaluate)
- MASTER-DIRECTIVES.md (project-wide constraints)
- product-sense.md (product philosophy)
- core-beliefs.md (engineering beliefs)

## Outputs
- 0-reframe.md (verdict: proceed | simplify | redirect + reasoning)

## Acceptance criteria
- Verdict field is present and machine-readable (lowercase, one word)
- Reasoning is concise and references at least one input file
- File is written before any downstream agent starts
