# CPVTS Architecture (Phase 1 — Foundation)

This document describes the foundation that later CPVTS phases build on. The
Master Blueprint remains the product reference; this file explains _how_ the
code is organised to deliver it.

## Overview

```text
 Browser / Android WebView
            │  HTTPS, JSON, Authorization: Bearer <JWT>
            ▼
   apps/web (static SPA) ──────────► apps/api (Express REST, /api/v1)
                                          │
                                          ▼  Prisma + node-postgres
                                   PostgreSQL (Supabase)
```

- **One frontend** serves the website and the future Android WebView APK.
- **The backend is authoritative.** The client never decides fees, slot
  assignment, availability, duplicate checks, checkout or receipt validity.
- **Provider independence.** Nothing outside `apps/api/src/db` and
  configuration knows the database host; nothing in application code knows
  about Vercel or Render.

## Shared package (`packages/shared`)

Only contracts that both sides must agree on:

- `USER_ROLES` (`ADMIN`, `SECURITY_STAFF`) — the backend asserts at compile time
  that the database enum matches.
- `SUPPORTED_LOCALES` (`en`, `kn`, `hi`, `mr`).
- zod schemas (`loginRequestSchema`, `passwordPolicySchema`) used for server
  validation _and_ client form validation. Their messages are translation keys
  (`validation.*`), so the server and client report the same error in any language.
- API response and error types (`ApiErrorBody`, `ApiErrorCode`, `LoginResponse`, …).

## API (`apps/api`)

### Layering

```text
routes  →  middleware (authenticate, authorize, validate)  →  controller  →  service  →  repository  →  Prisma
```

| Layer                   | Responsibility                                           |
| ----------------------- | -------------------------------------------------------- |
| `modules/*/*.routes.ts` | URL + HTTP method, middleware chain                      |
| `*.controller.ts`       | Translate HTTP ⇄ service call; no business rules         |
| `*.service.ts`          | Business rules, transactions, audit events               |
| `*.repository.ts`       | Data access only; accepts an optional transaction client |
| `db/`                   | Prisma client, `withTransaction`, connectivity check     |

New modules (e.g. `parking`, `sessions`, `payments`) follow the same folder
shape and are registered in `src/routes/api-v1.ts`.

### Transactions

`withTransaction(work, { isolationLevel })` runs several repository calls
atomically. Repositories take an optional `db` argument (`DbClient`) so the
same function works inside or outside a transaction. Login already uses this
(update `last_login_at` + audit entry). Allocation and checkout in later phases
should use `Serializable` isolation or row locks (`SELECT … FOR UPDATE`) for
read-then-write logic.

### Database-level integrity

The schema enforces invariants even if application code has a bug:

- partial unique indexes: one `ACTIVE` session per vehicle, one `ACTIVE`
  session per slot, one `PAID` payment per session;
- unique session numbers, entry references, transaction IDs, receipt numbers,
  verification references; one receipt per session and per payment;
- CHECK constraints: hours 0–23, exit ≥ entry, non-negative durations and
  amounts, paired GPS coordinates, `HELD` slots carry a hold expiry, completed
  sessions carry their checkout data, paid payments carry `paid_at`;
- `RESTRICT` foreign keys on parking history so records cannot be orphaned.

Money is stored as integer paise. GPS coordinates belong to parking blocks and
are nullable — real coordinates must be collected, never invented.

### In-memory structures (prepared, not implemented)

The problem statement asks for appropriate in-memory data structures (slot
collections, active-vehicle lookup, session collections). The intended design
for Phase 2:

- PostgreSQL stays the **source of truth**; every state change is committed
  there first, inside a transaction.
- A per-process in-memory index (e.g. `Map<slotCode, Slot>`,
  `Map<vehicleNumber, ActiveSession>`) lives in the parking module, is hydrated
  from the database at startup and updated **after** a successful commit.
- Reads that must be authoritative (allocation, checkout) re-check the database
  inside the transaction; the in-memory index serves fast lookups and views.

This keeps the API horizontally safe: multiple instances may hold different
caches, but the database constraints above prevent double allocation.

### Errors and validation

- `validate({ body, query, params })` parses with zod and replaces the request
  data with the parsed values.
- Expected failures throw `AppError(status, code, message)`. The central
  handler returns `{ error: { code, message, requestId, details? } }`; unknown
  errors are logged with stack traces and returned as a generic 500.
- Clients translate errors by `code`; `message` is an English fallback.

### Authentication and authorisation

- Passwords: bcrypt (12 rounds). Unknown usernames run a dummy comparison so
  response timing does not reveal which accounts exist.
- Access tokens: HS256 JWT with issuer, audience, expiry and a `tv` (token
  version) claim. Default lifetime 8 hours.
- `authenticate` re-loads the user on **every request**, so deactivation, role
  changes and logout take effect immediately. Logout increments the user's
  `token_version`, revoking all of that user's tokens.
- `authorize('ADMIN')` restricts routes by role; Security Staff receive 403 on
  admin routes.
- Login attempts are rate-limited per IP (failed attempts only). Sign-in
  successes, failures and logouts are written to `audit_logs`.
- Tokens are sent as `Authorization: Bearer` headers rather than cookies. This
  works identically on the website and inside an Android WebView, avoids
  cross-site cookie restrictions between Vercel and Render, and is immune to CSRF.
  The client keeps the token in `localStorage`; the risk is mitigated by short
  token lifetime, server-side revocation and React's output escaping.

### Endpoints (Phase 1)

| Method | Path                    | Access                                      |
| ------ | ----------------------- | ------------------------------------------- |
| GET    | `/health`               | Public — liveness                           |
| GET    | `/health/ready`         | Public — database readiness (503 when down) |
| POST   | `/api/v1/auth/login`    | Public, rate-limited                        |
| POST   | `/api/v1/auth/logout`   | Authenticated                               |
| GET    | `/api/v1/auth/me`       | Authenticated                               |
| GET    | `/api/v1/system/status` | Admin                                       |

## Web (`apps/web`)

### Routing and guards

```text
/login        PublicOnlyRoute   (signed-in users are sent to their requested page or role home)
/             RequireAuth → RoleHomeRedirect
/admin/*      RequireAuth → AppShell → RequireRole(ADMIN)
/staff/*      RequireAuth → AppShell → RequireRole(SECURITY_STAFF)
*             NotFound inside the shell
```

`AuthProvider` restores a stored session by calling `GET /auth/me`; a 401
anywhere ends the session locally and the sign-in page explains why. Network
failures during restoration show a retry screen instead of signing the user out.

Role navigation lives in `src/app/navigation.ts`. Only real pages are listed;
each later module adds its entry when it ships.

### Design system

- Tailwind CSS v4 with semantic design tokens in `src/styles/index.css`
  (`primary`, `muted`, `destructive`, plus `success`, `warning`, `info`, and
  `sidebar-*`). Components never use raw palette colours.
- shadcn/ui components in `src/components/ui` (button, input, label, form,
  card, table, dialog, sheet, alert, badge, dropdown menu, avatar, separator,
  skeleton, typography, description list). `components.json` lets the shadcn CLI
  add more.
- Feedback components: `LoadingState`/`FullPageLoader`, `ErrorState`,
  `EmptyState`, and `StatusBadge` (semantic tones — domain states such as slot or
  payment status map to a tone).
- Layout: `AppShell` (fixed sidebar ≥ 1024 px, drawer below), `PageHeader`.
- Fonts: self-hosted Noto Sans, Noto Sans Kannada and Noto Sans Devanagari
  (no third-party font requests; reliable rendering in WebViews).

### Internationalisation

- i18next with bundled catalogues: `src/i18n/locales/{en,kn,hi,mr}.json`.
  English is the reference; translation keys are type-checked.
- A test verifies every locale has identical keys and placeholders, and that
  every shared validation message, API error code and role is translated.
- The chosen language persists in `localStorage` and sets `<html lang>`.
- Dates and numbers use Indian regional formats with Latin digits in every
  language, so times and vehicle numbers read the same everywhere.
- Rule for all future work: **no user-facing literal strings** in components —
  add a key to all four catalogues.

Kannada, Hindi and Marathi translations should be reviewed by native speakers
before production use.

### Branding

All brand text comes from `src/config/branding.ts`, which reads `VITE_BRAND_*`
variables with defaults in `branding-defaults.ts`. The institution notice states
that the deployment is an independent demonstration unless
`VITE_BRAND_SHOW_DEMO_NOTICE=false` (only when officially authorised).

## Scope boundary

Phase 1 intentionally contains **no** parking workflows: no vehicle entry/exit,
allocation, tracking, parking map, duration or fee logic, slot holds, payments,
receipts, QR codes, history, analytics, alerts, CSV export, Google Maps or
Android packaging. The schema and module structure are ready for them.
