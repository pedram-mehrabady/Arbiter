# Security & {{COMPLIANCE_STANDARD}} (engineering KB)

Injected into: ALL build/audit agents (`design`, `frontend`, `backend`, `reviewer`).
{{COMPLIANCE_CONTEXT}} certification is existential — these are merge-blockers, enforced
mechanically by `.arbiter/scripts/check-security.sh` (Phase 4) before the `reviewer`
even sees the diff.

**Standing rules (apply to every change):**
- New endpoints default to `[Authorize]` (anonymous needs explicit justification).
- **No IDOR** — every `{id}` route verifies the caller owns the resource.
- Tokens **never** in `localStorage`.
- No `dangerouslySetInnerHTML` without DOMPurify.
- Only approved crypto: AES-256-GCM, RSA-2048+, SHA-256+, BCrypt/Argon2id.
- No hardcoded secrets — config/env only.
- Generic auth-failure messages (anti-enumeration).
- Module isolation is also a security boundary (no cross-module FK/transaction).

Canonical sources: `SECURITY_STANDARDS.md` (11 SFR classes + OWASP OTG),
`{{COMPLIANCE_DOC}}` (current pass/fail).
