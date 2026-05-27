# Foederata Development Methodology — ALC Evidence Statement

**Prepared for:** AFTA Product Security Evaluation
**Product:** Foederata B2B Platform
**Version:** 1.0 (2026-05-27)
**Classification:** Submission Package — ALC Evidence

---

## 1. Overview of the Development Lifecycle

Foederata is developed using **Arbiter**, an automated development lifecycle management system built for auditability. Each feature moves through a controlled 14-stage pipeline before any code reaches the production branch. Every stage produces a digitally signed artifact that maps directly to an ALC evidence requirement.

The pipeline is deterministic in structure: the sequence of agents, the validators applied to each output, and the gates that block progression are fixed and version-controlled. No code enters the repository without passing a preflight check, a validation step, and at least one human review gate.

---

## 2. Human Oversight and Gate Controls

Three mandatory human review gates are positioned at the highest-leverage points in the feature lifecycle:

| Gate | Trigger | What the Reviewer Sees | Blocks |
|------|---------|------------------------|--------|
| **Gate 1 — Discovery** | After Research (impact analysis complete) | Research output + blast-radius manifest | Design, all subsequent stages |
| **Gate 2 — Design** | After Integrator (interface specification complete) | Design doc + independent critic review + interface spec | Plan, all implementation |
| **Gate 3 — Review** | After Reviewer (QA review complete) | Reviewer report + test coverage summary | Tech-Writer, merge |

A fourth gate (`debugger_major_rewrite`) fires conditionally when the Debugger agent rewrites more than 20% of a failed sub-task's output. This is documented in the decision log as a `debugger_constraint3_gate` event.

**No feature progresses past a gate without a documented, timestamped approval.**

Evidence location in AFTA-EVIDENCE-BUNDLE: `09-audit-trail/decision-log-excerpt.jsonl` — events `gate_created` and `gate_approved`.

---

## 3. Agent-to-ALC Control Mapping

Each pipeline agent is assigned a fixed model tier and produces exactly one ALC artifact. The mapping is enforced by the conductor's `ARTIFACT_SOURCE_MAP` and verified by `BundleAssembler.assemble()` before each bundle is signed.

| Stage | Agent | Model | ALC Control | Artifact in Bundle |
|-------|-------|-------|-------------|-------------------|
| 1 | Reframe | Sonnet | **ALC_REQ** — Requirements Specification | `01-requirements/reframe-output.md` |
| 2 | Research | Sonnet | **ALC_IMP.1** — Impact Analysis | `02-impact-analysis/research-output.md` |
| 3 | Design | Sonnet | **ALC_TDS.1** — Design Documentation | `03-design/design.md` |
| 4 | Design-Critic | Haiku | **ALC_TDS.2** — Independent Design Review | `03-design/design-critic.md` |
| 5 | Integrator | Opus | **ALC_TDS.3** — Interface Specification | `03-design/integrator-output.md` |
| 6 | Plan | Opus | **ALC_IMP.2** — Implementation Plan | `04-implementation-plan/plan-output.md` |
| 7–N | Backend / Frontend | Sonnet | **ALC_IMP** — Implementation | `05-implementation/receipts/*.json` |
| N+1 | Test-Writer | Haiku | **ALC_TEC** — Test Coverage & Design | `06-tests/test-writer-output.md` |
| N+2 | Reviewer | Opus | **ALC_QA** — Quality Assurance Review | `07-review/reviewer-report.md` |
| N+3 | Tech-Writer | Sonnet | **AGD_OPE** — Operational Guidance | `08-documentation/tech-writer-output.md` |

**Model independence invariants** (enforced by config validation at startup):

- **I6:** Test-Writer must be a different model family than Backend/Frontend — prevents blind-spot inheritance where a model checks its own work
- **I7:** Design-Critic must be a different model family than Design — prevents grading own homework

---

## 4. Cryptographic Chain of Custody

Every agent invocation produces a build receipt (`receipts.jsonl`). Each receipt contains:

- `receipt_id` — unique identifier (also embedded as a git commit trailer: `Arbiter-Receipt: <id>`)
- `context_hash` — SHA-256 of the assembled prompt — proves the agent received exactly the context it should have
- `output_hashes` — SHA-256 of each output file — proves the output was not modified after the agent wrote it
- `signature` — Ed25519 signature over the receipt payload — proves the receipt was not forged

The bundle manifest (`manifest.json` inside every ZIP) is also Ed25519-signed. The sidecar file (`.zip.sig`) signs the final ZIP bytes — covering all artifacts including the manifest.

**The evaluator can verify the complete evidence chain from a single command:**

```bash
arbiter bundle verify <bundle_path> --workspace <project_root>
```

This verifies:
1. The sidecar signature over the ZIP bytes
2. The bundle hash stored in `manifest.json`
3. Individual receipt signatures via `09-audit-trail/receipt-chain-verify.txt`

All signing uses Ed25519. All hashing uses SHA-256. The developer key pair is generated with `generateKeyPairSync('ed25519')` from Node.js `crypto` — no custom cryptographic implementations exist anywhere in Arbiter or Foederata.

---

## 5. Repeatability Statement

Given the same specification document and the same codebase state, Arbiter produces Foederata code that:

1. Passes the full preflight validator suite (P-CRYPTO, secrets scan, complexity cap)
2. Compiles without errors (TypeScript and .NET compile gates)
3. Passes all generated tests
4. Receives human gate approval at all three mandatory checkpoints

**Repeatability is defined as semantic equivalence under these checks, not byte-identical output.** Large language models are stochastic by design. The industry standard for evaluating LLM-based processes (ISO 42001, NIST AI RMF) defines repeatability as consistent outcomes under consistent evaluation criteria.

The validators, compile gates, complexity scorer, and human gates together constrain the solution space. A second run of the same task on the same codebase will produce output with identical public API surfaces, identical test coverage targets, and identical validator outcomes — even if variable names or comment phrasing differ.

Signed build receipts prove what inputs were provided. Output hashes prove what was committed. The append-only decision log proves the complete event chain is non-repudiable.

---

## 6. Development Process Threat Overview

Three material threat vectors exist in the Arbiter-based development process. Each has a documented technical mitigation that is enforced at the pipeline level — not at the application level.

| Threat | Description | Mitigation | Evidence |
|--------|-------------|-----------|---------|
| **Spec injection** | A malicious or misconfigured `task.md` instructs agents to embed backdoors, exfiltrate data, or bypass validators | Preflight validates task file structure before any API call; plan output is schema-validated and complexity-scored; human gates review every design and review output | `preflight_spawn` events in decision log; Gate 1 approval records |
| **Secret exfiltration** | Research agent reads the full codebase; `.env` files, connection strings, and signing keys can enter Claude's context window and be echoed in agent output | Secrets scanner (`SecretsScanner.ts`) blocks the API call before spawn if any secret pattern is detected in the assembled context; `preflight_halt` event is logged | `secrets_scan` check in `PreflightCheck.run()` |
| **Debugger rewrite path** | The Debugger agent, which runs with elevated Opus-class reasoning, could introduce unreviewed Foederata code — an unconstrained auto-fix path is an AFTA red flag | **P1-5 four hard constraints:** (1) same P-CRYPTO validators as original agent, (2) diff hash + percentage in receipt, (3) >20% rewrite triggers mandatory human gate, (4) new files or new public abstractions halt the pipeline entirely | `debugger_diff` and `debugger_constraint*` events in decision log; receipts contain `debugger_invoked`, `debugger_diff_hash`, `debugger_diff_pct` |

---

## 7. Cryptographic Primitives Used

| Usage | Algorithm | Implementation |
|-------|-----------|---------------|
| Receipt signing / verification | Ed25519 | `node:crypto` — `sign(null, data, key)` / `verify(null, data, key, sig)` |
| Bundle hash | SHA-256 | `node:crypto` — `createHash('sha256')` |
| Context hash (preflight) | SHA-256 | `node:crypto` — `createHash('sha256')` |
| Output file hashing | SHA-256 | `node:crypto` — `createHash('sha256')` |

**No LLM-authored cryptographic implementations exist in the Foederata codebase.**

This is enforced at the pipeline level by the P-CRYPTO preflight rule, which scans every context file for forbidden patterns (`AesManaged`, `RijndaelManaged`, custom `*Encryptor`/`*Cipher`/`*Crypto` classes, manual XOR-key operations, non-standard PBKDF classes) before any API call is made. A P-CRYPTO violation returns verdict `halt` — the sub-task cannot proceed, the pipeline stops, and the event is logged in the decision log.

All Foederata cryptographic code uses `System.Security.Cryptography` primitives only.
