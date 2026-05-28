# Project context — {{PROJECT_NAME}}
# Fill in every field below. Arbiter reads this file to hydrate all templates.
# The dashboard wizard generates this file on first connect; you can hand-edit it at any time.
# Leave a field as its {{PLACEHOLDER}} if not yet decided — agents will treat it as unknown.

---

## Identity

PROJECT_NAME:
# Short name of your product. Used in CLAUDE.md files and agent rule books.
# Example: MyApp

PRODUCT_DESCRIPTION:
# One paragraph describing what the product does and who it serves.
# Example: A B2B invoicing platform for small businesses in Europe.

TARGET_USERS:
# Who uses it. Used by reframe, question, design, and surveyor agents.
# Example: Small business owners and their accountants.

---

## Compliance

COMPLIANCE_CONTEXT:
# Any regulatory or certification requirement. Write "none" if not applicable.
# Example: SOC 2 Type II / ISO 27001 / GDPR / none

COMPLIANCE_STANDARD:
# Short abbreviation of the standard. Write "none" if not applicable.
# Example: SOC2 / ISO27001 / none

COMPLIANCE_DOC:
# Path to your live compliance gap tracker, or "none".
# Example: docs/security/SOC2_GAP_ANALYSIS.md

COMPLIANCE_TLDR_DOC:
# Path to a compact compliance summary loaded by question + research agents, or "none".
# Example: docs/security/SOC2_TLDR.md

COMPLIANCE_RETROFIT_PLAN:
# Path to your compliance retrofit roadmap, or "none".
# Example: docs/security/RETROFIT_PLAN.md

---

## Stack

FRONTEND_STACK:
# Full FE stack string. Used in workspace-frontend.CLAUDE.md and FE knowledge docs.
# Example: React 18 + Vite + TypeScript + Tailwind CSS

BACKEND_STACK:
# Full BE stack string. Used in workspace-backend.CLAUDE.md and BE knowledge docs.
# Example: Node.js + Express + Prisma + PostgreSQL

UI_LIBRARY:
# UI component library name. Used in design-system.md and frontend agent.
# Example: shadcn/ui / Ant Design 6 / MUI

DATABASE:
# Primary database. Used in backend standards docs.
# Example: PostgreSQL / MySQL / MongoDB

FRONTEND_TEST_FRAMEWORK:
# FE test runner. Used in test-patterns.md and test-writer agent.
# Example: Vitest / Jest

BACKEND_TEST_FRAMEWORK:
# BE test runner. Used in test-patterns.md and test-writer agent.
# Example: xUnit / Jest / Pytest

---

## Patterns

ERROR_HANDLING_PATTERN:
# How services return errors — never-throw rule.
# Example: ServiceResult<T> / Result<T, E> / { data, error } tuple

ASYNC_PATTERN:
# How cross-module async work is handled.
# Example: outbox pattern + domain events / message queue (RabbitMQ/SQS) / none

STATE_MANAGEMENT_APPROACH:
# FE state management library and conventions.
# Example: Zustand feature-scoped stores / Redux Toolkit slices / React Query only

MODULE_ISOLATION_RULES:
# Bullet list of module isolation rules.
# Example:
#   - Schema-per-module (each module owns its own DB schema)
#   - DbContext-per-module (no shared AppDbContext for business tables)
#   - No cross-module foreign keys in the DB
#   - No cross-module transactions — use outbox pattern + domain events
#   - Federate, don't absorb: call sibling apps via HTTP, don't replicate their tables

SIBLING_APPS:
# Other apps in the ecosystem that share data or components, or "none".
# Example: billing-service, notification-service, admin-portal

---

## Workspaces

WORKSPACE_FE:
# Frontend workspace folder name.
# Example: web / frontend / client

WORKSPACE_BE:
# Backend workspace folder name.
# Example: api / backend / server

WORKSPACE_FE_CLAUDE:
# Path to the FE workspace CLAUDE.md.
# Example: web/CLAUDE.md

WORKSPACE_BE_CLAUDE:
# Path to the BE workspace CLAUDE.md.
# Example: api/CLAUDE.md

---

## Coverage

FE_COVERAGE_FLOORS:
# FE coverage thresholds as a string.
# Example: lines 80 / branches 70 / functions 80 / statements 80

BE_COVERAGE_FLOORS:
# BE coverage aggregate threshold.
# Example: 75

FE_COVERAGE_CONFIG:
# Path to the FE coverage config file.
# Example: web/vitest.config.ts / frontend/jest.config.ts

BE_COVERAGE_CONFIG:
# Path to the BE coverage config file.
# Example: api/Directory.Build.props / api/jest.config.ts

---

## Documentation paths

MODULE_ARCHITECTURE_DOC:
# Path to your full module architecture document.
# Example: MODULE_ARCHITECTURE.md

MODULE_BRAINSTORM_DOC:
# Path to the pre-implementation brainstorm template.
# Default: project-templates/MODULE_BRAINSTORM_TEMPLATE.md

DMS_SPEC_DOC:
# Path to your document/file storage spec, or "none".
# Example: docs/modules/storage-spec.md

MODULE_MIGRATION_PLAYBOOK:
# Path to your module migration/port playbook, or "none".
# Example: docs/MODULE_MIGRATION_PLAYBOOK.md

PROJECT_RULE_BOOK:
# Path to your project rule book, or "none".
# Example: RULE_BOOK.md

DOMAIN_SPEC_DOC:
# Path to your product/domain spec document, or "none".
# Example: docs/domain/business.md

DOMAIN_SPEC_DIR:
# Directory containing domain spec files, or "none".
# Example: docs/domain/

SECURITY_DOC:
# Path to your security standards document, or "none".
# Example: SECURITY_STANDARDS.md

---

## Notifications

OWNER_CHAT_ID:
# Telegram chat ID for morning reports and gate alerts. Write "none" to disable.
# Example: 123456789

REPORT_HOUR:
# Hour (0–23) for daily morning reports.
# Example: 7

---

## Locale

LOCALE:
# Locale identifier for date/calendar handling.
# Example: en-US / fa-IR / de-DE
