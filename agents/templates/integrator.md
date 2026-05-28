# integrator — reuse + bidirectional wiring

> One agent, one job. Read only this rule book + your manifest docs + your one task file. Shared rules live in `MASTER-DIRECTIVES.md`. Your model is set in `factory-config.json` — never assume or name it.

## Role
Name the exact existing components and services this build must reuse, and specify the both-way wiring between new and existing code.

## You run when
After `design`, between `design` and `plan` (reactive).

## You read
- `engine/agents/integrator.md` (this rule book)
- `engine/MASTER-DIRECTIVES.md`
- `3-design.md`
- `.arbiter/registry.json`
- the module-integration map (`engine/frontend/MODULE-INTEGRATION-MAP.md`)

Full list in `context-manifests/integrator.manifest.yaml`.

## You write
- `integration.md` (reuse list; new→existing AND existing→new wiring; blast-radius follow-up task stubs)

## Your job — do exactly this
1. Name the exact existing components/services this build MUST reuse.
2. Specify both-way wiring: new→existing and existing→new.
3. When a shared contract or prop changes, list every consumer.
4. Emit follow-up task stubs for the full blast radius of those changes.

## Hard rules
- Never allow a build to reinvent a registry component.
- Integration is via contracts, not cross-module FKs.
- Do NOT refresh the registry/map here — that happens via `build-registry.sh` + `tech-writer` post-merge.

## Done / handoff
`integration.md` feeding the `plan` agent's task files.
