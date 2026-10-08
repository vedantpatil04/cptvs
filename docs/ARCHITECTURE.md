# CPVTS Architecture (Phase 2 — Core CPVTS)

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
  session per slot, one `PAID` payment per session, one open (`PENDING` /
  `PROCESSING`) payment per session;
- unique session numbers, entry references, transaction IDs, receipt numbers,
  verification references; one receipt per session and per payment;
- CHECK constraints: hours 0–23, exit ≥ entry, non-negative durations and
  amounts, paired GPS coordinates, `HELD` slots carry a hold token and expiry,
  completed sessions carry their checkout data and fee breakdown, paid
  payments carry `paid_at`, `NO_CHARGE` is used exactly for ₹0 payments;
- `RESTRICT` foreign keys on parking history so records cannot be orphaned.

Money is stored as integer paise. GPS coordinates belong to parking blocks and
are nullable — real coordinates must be collected, never invented.

### In-memory data structures

The problem statement asks for appropriate in-memory data structures. CPVTS
uses them where they help without becoming a second source of truth:

- **Allocation** loads the zone's slots once, then ranks candidates in memory
  (arrays with layout positions, a `Map<slotId, usesToday>` for balanced
  utilisation) before touching the database again.
- **Parking map and dashboards** group slots and statuses in memory
  (per block → zone → slot, counts per status and vehicle type).
- There is deliberately **no long-lived cache** of slots or sessions:
  PostgreSQL is the single source of truth and every state change is a
  conditional update inside a transaction. A per-process cache would be wrong
  as soon as two API instances (or two terminals) run at once.

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

### Public overview (no authentication)

`GET /api/v1/public/overview` powers the public landing page. It returns:

- free and total slot **counts** per vehicle type (active zones of active blocks);
- active parking **blocks**: name, description, accepted vehicle types and GPS
  coordinates when configured (null otherwise);
- the **fee schedule** from the `settings` table (`parking.feeSchedule`),
  validated against the shared `feeScheduleSchema`; withheld if invalid.

It never returns slot codes, vehicles, sessions, payments, receipts, revenue,
audit logs or users — an integration test inserts such records and asserts
that none of their identifiers appear in the response. Responses are
rate-limited per IP and cacheable for 15 seconds. The fee schedule is
configuration that the Phase 2 fee engine will read; nothing calculates a fee yet.

## Parking operations (Phase 2)

### Lifecycle

```text
Check-in ─ validate ─ duplicate check ─ zone ─ rank candidates ─ HOLD slot ─ final check ─ COMMIT session
   │                                                                                        (slot OCCUPIED)
   ▼
ACTIVE session ─ tracking / map / estimated fee
   │
   ▼
Quote (exit hour → duration → fee) ─ PENDING payment ─ PROCESSING ─┬─ FAILED (nothing changes)
                                                                   └─ FINALIZE (one transaction):
                                                                      payment PAID, session COMPLETED
                                                                      with frozen duration/fee/breakdown,
                                                                      receipt issued, slot AVAILABLE,
                                                                      audit events
```

### Allocation (`modules/parking/allocation.ts`)

Deterministic and rule-based. Candidates are only `AVAILABLE` slots in active
zones of active blocks for the vehicle's type; `OCCUPIED`, `BLOCKED` and
`HELD` slots never qualify, and another type's zone is never used, even when
the correct zone is full (`ZONE_FULL`).

```text
score = 1000 × priority − 10 × usesToday − layoutPosition
```

- `priority`: optional admin-configured slot preference (default 0).
- `usesToday`: sessions started in the slot today (balanced utilisation).
- `layoutPosition`: position in the configured layout (block → zone → slot).

Ties break by layout position, then slot code, so the same state always gives
the same slot. The response explains the decision (checks passed, score,
factors, candidates compared, fallbacks).

### Temporary slot hold

`AVAILABLE → HELD → OCCUPIED`, with `HELD → AVAILABLE` on failure or expiry.

1. **Hold**: a compare-and-set update (`status = AVAILABLE` → `HELD`, random
   `hold_token`, `hold_expires_at = now + SLOT_HOLD_SECONDS`). Only one
   terminal can win; the loser falls back to the next candidate.
2. **Final verification + commit** (one transaction): `HELD → OCCUPIED` only if
   the slot is still held with the same token, the hold has not expired and the
   zone still matches the vehicle type; then the vehicle, session and audit
   rows are written. If the final check fails, the next candidate is tried.
3. Errors release the hold; expired holds are reclaimed before every
   allocation and map read. A CHECK constraint guarantees `HELD` ⇔ token ⇔ expiry.

Duplicate check-ins of the same vehicle that race past the pre-check are
stopped by the unique indexes (`one active session per vehicle`,
`vehicles.vehicle_number`) and reported as `DUPLICATE_ACTIVE_VEHICLE`.

### Fee engine (`modules/fees/fee-engine.ts`)

The only code that calculates fees. Duration is `exit hour − entry hour`
(whole hours; exit before entry is rejected). Rules come from the fee
schedule in the `settings` table. The breakdown (`FREE` / `CHARGED` lines)
is shown before payment, re-calculated inside finalization (it must equal
the payment amount, otherwise the transaction rolls back with
`PAYMENT_AMOUNT_MISMATCH`), and frozen into `parking_sessions.fee_breakdown`.
Receipts, history and revenue read the frozen values — nothing recalculates.

### Mock payment

A simulated provider: `PENDING → PROCESSING → PAID | FAILED`, or
`PENDING → CANCELLED`. `PENDING → PROCESSING` is a compare-and-set, so a
payment can be processed only once. The amount always comes from the fee
engine; ₹0 checkouts must use `NO_CHARGE` (enforced in code and by a CHECK
constraint). A declined test payment (`outcome: FAILURE`) changes nothing
else and can be retried. Every payment row has `is_simulated = true`.

### Identifiers and QR codes

| Identifier                     | Format                                                            | Generated            |
| ------------------------------ | ----------------------------------------------------------------- | -------------------- |
| Parking Session Number         | `CPVTS-P-XXXXXXXX` (8 × Crockford base32, CSPRNG)                 | at check-in          |
| Entry QR reference             | 256-bit random, base64url; QR text `cpvts:session:<ref>`          | at check-in          |
| Transaction ID                 | `TXN-XXXXXXXXXX`                                                  | at payment creation  |
| Receipt Number                 | `CPVTS-R-<year>-XXXXXXXX`                                         | only at finalization |
| Receipt verification reference | 256-bit random, base64url; QR encodes `<web origin>/verify/<ref>` | at finalization      |

QR codes carry only opaque references. The server looks each one up and
applies its own checks; vehicle, slot and amount in a QR are never trusted.
Public verification also cross-checks the receipt, payment and session
(status, amounts, exit hour) and reports `INVALID` if they disagree.

### Validation and integrity (server-side)

Duplicate active vehicle, invalid hours, exit before entry, full zone, wrong
zone/type, occupied/blocked slots, unknown vehicle/session, completed session,
vehicle↔session and session↔slot mismatch, payment↔session mismatch and
receipt↔transaction consistency are all enforced by the API (and, where
possible, by database constraints). Refusals are written to the audit log as
`INTEGRITY_REJECTED` with the error code.

Audit actions: `VEHICLE_CHECKED_IN`, `SLOT_ASSIGNED`, `CHECKOUT_INITIATED`,
`PAYMENT_INITIATED`, `PAYMENT_SUCCEEDED`, `PAYMENT_FAILED`, `PAYMENT_CANCELLED`,
`TRANSACTION_FINALIZED`, `RECEIPT_GENERATED`, `SLOT_RELEASED`,
`INTEGRITY_REJECTED`.

### Time

Entry and exit are whole hours entered by staff (competition model). The
current campus hour (`CAMPUS_TIMEZONE`) is used only for live durations and
estimates of active sessions; "today" on dashboards is the campus day.

### Endpoints

| Method | Path                                      | Access                                         |
| ------ | ----------------------------------------- | ---------------------------------------------- |
| GET    | `/health`                                 | Public — liveness                              |
| GET    | `/health/ready`                           | Public — database readiness (503 when down)    |
| GET    | `/api/v1/public/overview`                 | Public, rate-limited — aggregate overview      |
| POST   | `/api/v1/auth/login`                      | Public, rate-limited                           |
| POST   | `/api/v1/auth/logout`                     | Authenticated                                  |
| GET    | `/api/v1/auth/me`                         | Authenticated                                  |
| GET    | `/api/v1/system/status`                   | Admin                                          |
| GET    | `/api/v1/public/receipts/:reference`      | Public, rate-limited — receipt QR verification |
| POST   | `/api/v1/parking/check-ins`               | Security Staff                                 |
| GET    | `/api/v1/parking/tracking?q=`             | Staff, Admin                                   |
| GET    | `/api/v1/parking/map`                     | Staff, Admin                                   |
| GET    | `/api/v1/parking/sessions/active`         | Staff, Admin                                   |
| GET    | `/api/v1/parking/sessions/:sessionNumber` | Staff, Admin                                   |
| POST   | `/api/v1/parking/checkouts/quote`         | Security Staff                                 |
| POST   | `/api/v1/parking/payments`                | Security Staff                                 |
| POST   | `/api/v1/parking/payments/:id/process`    | Security Staff                                 |
| POST   | `/api/v1/parking/payments/:id/cancel`     | Security Staff                                 |
| GET    | `/api/v1/parking/receipts/:receiptNumber` | Staff, Admin                                   |
| GET    | `/api/v1/dashboard/summary`               | Staff, Admin (revenue for Admin only)          |

## Web (`apps/web`)

### Routing and guards

```text
/             PublicLayout → PublicHomePage   (no sign-in; aggregate overview only)
/help         PublicLayout → HelpPage         (static Help & FAQ)
/verify/:ref  PublicLayout → ReceiptVerificationPage (receipt QR target)
/login        PublicOnlyRoute                 (signed-in users are sent to their requested page or role home)
/admin/*      RequireAuth → AppShell → RequireRole(ADMIN)
              dashboard, live, finder, sessions/:n, receipts/:n, account
/staff/*      RequireAuth → AppShell → RequireRole(SECURITY_STAFF)
              dashboard, entry, exit, finder, live, sessions/:n, receipts/:n, account
*             PublicLayout → NotFound
```

Unauthenticated requests for anything under `/admin` or `/staff` redirect to
`/login` and return to the requested page after sign-in. Public pages call
only `GET /api/v1/public/overview` and, on `/verify`, the receipt verification
endpoint — never sessions, tracking, the map, payments or revenue.

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

Implemented through Phase 2: the complete parking lifecycle described above.

Not implemented yet (Phase 3+): the Parking Integrity Engine as a separate
management module, session timeline / audit replay UI, analytics, alerts,
history and reporting UI, CSV export, admin slot-management UI, demo-data
tools and the Android WebView APK. No real payment gateway, ML/AI or
student/visitor logins exist, by design.
