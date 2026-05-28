# {{PROJECT_NAME}} — Environment reference
# FILL IN: This file is the reference for infrastructure, ports, credentials, and branching.
# Keep CLAUDE.md files clean by linking here instead of embedding reference data in instructions.

---

## Dev stack services

<!--
  FILL IN: List all services in your local dev stack (Docker compose or equivalent),
  their ports, and what they do.
-->

| Service | Port | Purpose |
|---------|------|---------|
| <!-- example: postgres --> | <!-- 5432 --> | <!-- Primary database --> |
| <!-- example: redis --> | <!-- 6379 --> | <!-- Session cache / rate limiting --> |
| <!-- example: minio --> | <!-- 9000 / 9001 --> | <!-- Object storage / storage console --> |
| <!-- Add more rows --> | | |

---

## Demo / seed credentials

<!--
  FILL IN: Dev and staging login credentials used by the seed script.
  Source of truth: <path to your seed file, e.g. src/seed.ts>
-->

| Role | Email | Password |
|------|-------|----------|
| Admin | <!-- admin@example.com --> | <!-- changeme --> |
| User | <!-- user@example.com --> | <!-- changeme --> |

---

## Database connection (dev)

<!--
  FILL IN: Local connection string.
  Example: postgresql://postgres:postgres@localhost:5432/myapp_dev
-->

---

## Environment variables

<!--
  FILL IN: All required environment variables and where they come from.
  Example:
-->

| Variable | Source | Description |
|----------|--------|-------------|
| DATABASE_URL | .env.local | Primary DB connection |
| JWT_SECRET | .env.local | JWT signing key |
| STORAGE_ENDPOINT | .env.local | Object storage URL |
| <!-- Add more --> | | |

---

## Branching strategy

<!--
  FILL IN: Your branch naming convention and protection rules.
  Example:
    - Feature branches: feat/<task-id>-short-name
    - Hotfix branches: fix/<task-id>-short-name
    - main: protected; requires PR + CI green + reviewer approval
    - Squash merge only; linear history
-->

---

## Tags and releases

<!--
  FILL IN: How you tag and release.
  Example:
    - Tags: v<major>.<minor>.<patch> (semantic versioning)
    - Releases cut from main; tagged manually or by CI on merge to main
-->

---

## Domain and deployment

<!--
  FILL IN: Domain names, staging URLs, and deployment targets.
  Example:
    - Production: https://app.myproject.com
    - Staging: https://staging.myproject.com
    - API base (prod): https://api.myproject.com
-->

---

## Ops runbooks

<!--
  FILL IN: Links to operational runbooks.
  Example:
    - Deploy: ops/runbooks/deploy.md
    - Rollback: ops/runbooks/rollback.md
    - Incident response: ops/runbooks/incident.md
-->
