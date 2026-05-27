# Arbiter Development Methodology — Audit Evidence Statement

**Version:** 1.0
**Applies to:** Any project managed with the Arbiter pipeline

---

## 1. Overview

Arbiter is a human-in-the-loop AI development pipeline designed for auditability. Every feature moves through a controlled 13-stage pipeline before code reaches the production branch. Each stage produces a digitally signed artifact that maps to an assurance evidence requirement (Common Criteria ALC class, SOC 2 change management, ISO 27001 A.14, or equivalent).

The output of every completed task is an **AUDIT-EVIDENCE-BUNDLE.zip** — a signed ZIP file containing all agent outputs, a receipt chain, the decision log, and a manifest. The bundle is self-verifying: the Ed25519 signature on the sidecar `.sig` file can be verified against the public key in `.arbiter/signing-key-pub.pem` without access to the Arbiter installation.

---

## 2. Human Gate Controls

Arbiter enforces three mandatory human review gates per task:

| Gate | Triggered after | What you review | Effect of rejection |
|---|---|---|---|
| **Design Gate** | design-critic completes | Design document + critic assessment | Pipeline halts; task returns to design |
| **Plan Gate** | plan agent completes | Sub-task breakdown + complexity score | Pipeline halts; plan must be revised |
| **Review Gate** | test-writer completes | All implementation + test outputs | Pipeline halts; reviewer lists required changes |

Gates are recorded in the decision log with timestamp, gate ID, resolver identity, and optional comment. No pipeline stage may begin after a gate until the gate is explicitly approved via `arbiter gate approve <gate-id>`.

---

## 3. Agent-to-Evidence Mapping (Common Criteria ALC)

Each agent output maps to an Assurance Lifecycle (ALC) control from ISO/IEC 15408 Common Criteria:

| Bundle directory | Agent | CC ALC control | Evidence content |
|---|---|---|---|
| `01-requirements/spec.md` | (input) | ALC_REQ | Original feature specification |
| `01-requirements/reframe-output.md` | reframe | ALC_REQ | Challenged / reframed requirements |
| `02-impact-analysis/research-output.md` | research | ALC_IMP.1 | Blast-radius analysis, files impacted |
| `03-design/design.md` | design | ALC_TDS.1 | Architectural design document |
| `03-design/design-critic.md` | design-critic | ALC_TDS.2 | Independent design review |
| `03-design/integrator-output.md` | integrator | ALC_TDS.3 | Cross-module integration specification |
| `04-implementation-plan/plan-output.md` | plan | ALC_IMP.2 | Complexity-scored implementation plan |
| `05-implementation/git-commits.json` | (generated) | ALC_IMP | Git commit hashes for each sub-task |
| `06-tests/test-writer-output.md` | test-writer | ALC_TEC | Test specifications and results |
| `07-review/reviewer-report.md` | reviewer | ALC_QA | Final QA review verdict |
| `08-documentation/tech-writer-output.md` | tech-writer | (AGD_OPE) | User-facing feature documentation |
| `09-audit-trail/decision-log-excerpt.jsonl` | (generated) | ALC_QA | Full event log for this task |
| `09-audit-trail/receipt-chain-verify.txt` | (generated) | ALC_IMP | Ed25519 verification report |

---

## 4. Cryptographic Chain of Custody

### Signing key
Generated once per workspace: `arbiter.generateKeyPairSync('ed25519')` from Node.js `crypto`. No custom cryptographic implementations. Private key stored at `.arbiter/signing-key.pem` (gitignored, workspace-local).

### Per-agent receipts
Every agent invocation produces a receipt (`BuildReceipt`) containing:
- SHA-256 hash of every output file
- Input token count, output token count, cost
- Invocation timestamp and context hash
- Ed25519 signature over the receipt payload

### Bundle hash
The AUDIT-EVIDENCE-BUNDLE.zip is hashed (SHA-256) after assembly. The hash is signed with the same Ed25519 key and stored in a sidecar `.sig` file. The manifest inside the ZIP also contains the hash and signature.

Verification:
```bash
arbiter bundle verify .arbiter/bundles/<task-id>-AUDIT-EVIDENCE-BUNDLE.zip
arbiter audit verify
```

---

## 5. Repeatability

Given the same specification document and the same codebase state, Arbiter produces outputs that:
1. Traverse the same pipeline stages in the same order
2. Apply the same human gate controls
3. Produce receipts with the same structural schema
4. Produce a bundle with the same 9-directory structure

The non-deterministic element is LLM output content, which is why every output is captured and signed rather than regenerated. The audit trail is the actual outputs, not a claim about them.

---

## 6. Threat Model

| Threat | Mitigation |
|---|---|
| Agent produces incorrect output | design-critic (independent model) + reviewer (Opus-class) + human gates |
| Agent introduces unapproved cryptography | P-CRYPTO rule enforced at preflight; pipeline halts on violation |
| Debugger introduces unreviewed code | P1-5 constraints: diff logged in receipt; >20% rewrite triggers human gate; new public abstractions halt pipeline |
| Receipt tampered after signing | Ed25519 signature on each receipt; `arbiter audit verify` detects any modification |
| Bundle contents altered | SHA-256 bundle hash in sidecar `.sig`; `arbiter bundle verify` detects any alteration |

---

## 7. Approved Cryptographic Primitives

The P-CRYPTO rule enforced by Arbiter's preflight check permits only:

| Purpose | Approved |
|---|---|
| Symmetric encryption | AES-256-GCM |
| Asymmetric encryption | RSA-2048+ |
| Hashing | SHA-256, SHA-384, SHA-512 |
| Password hashing | bcrypt, Argon2id |
| Digital signatures | Ed25519, RSA-PSS |

Explicitly prohibited: MD5, SHA-1 (for security purposes), DES, 3DES, RC4, ECB mode.

Any agent output containing disallowed primitives triggers a `halt` verdict and the task does not proceed until the violation is resolved.
