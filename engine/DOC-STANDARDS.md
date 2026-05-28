# Doc-authoring standard

**Every** factory doc + rule book + `CLAUDE.md` follows these 5 rules. They keep agent-facing
docs lean and effective (LLMs lose instructions buried in long, noisy prose). The `tech-writer`
agent enforces them on any doc it writes/edits; the lessons loop (engine/MASTER-DIRECTIVES.md §8) adds
a new rule here if a doc-quality problem recurs.

1. **Persona first.** Open with WHO the reader/agent is (role) before what to do. A clear role
   anchors tone + decisions.
2. **No temporal or anecdotal noise.** State the rule, not the backstory, date, or PR number.
   ✅ "Run the gate twice — the second run catches flaky tests."
   ❌ "PR #38 (May 2026) burned 7 cycles, so run the gate twice." (ages badly, wastes tokens)
3. **No link soup.** Inline the few non-negotiable rules; link everything else as *reference*,
   never as "read all these before doing anything". An agent reads only its context manifest.
4. **Instructions ≠ reference data.** Behavioral rules up top; ports / credentials / env / tables
   at the bottom or in a clearly-marked reference section. Never interleave them with rules.
5. **Checklists over prose.** Numbered imperative steps; segment with clear headers (or XML tags
   like `<role>` / `<rules>` for prompts injected at spawn time).

**Scope:** `agents/*.md`, `engine/MASTER-DIRECTIVES.md`, `agents/knowledge/*`, the automation engine
docs, and the root + workspace `CLAUDE.md` files.

**When editing an existing doc:** leave it better than you found it against these 5 — at minimum,
don't add new temporal noise or link soup.
