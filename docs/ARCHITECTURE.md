# CPVTS Architecture (Phase 3 — Smart & Management)

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
`INTEGRITY_REJECTED`; Phase 3 adds `SLOT_BLOCKED`, `SLOT_UNBLOCKED`,
`SLOT_PRIORITY_CHANGED`, `BLOCK_LOCATION_UPDATED` and `REPORT_EXPORTED`. The
codes live in `@cpvts/shared` (`audit.ts`) so the web app can translate them.

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
| GET    | `/api/v1/parking/alerts`                  | Staff, Admin — rule-based alerts               |
| GET    | `/api/v1/parking/sessions/:n/timeline`    | Staff, Admin — session audit replay            |
| GET    | `/api/v1/admin/layout`                    | Admin — blocks, zones, slots with priority     |
| POST   | `/api/v1/admin/slots/:code/block`         | Admin — `{ reason }`; AVAILABLE slots only     |
| POST   | `/api/v1/admin/slots/:code/unblock`       | Admin — BLOCKED slots only                     |
| PATCH  | `/api/v1/admin/slots/:code/priority`      | Admin — `{ priority }` 0–100                   |
| PATCH  | `/api/v1/admin/blocks/:code/location`     | Admin — `{ latitude, longitude }` or both null |
| GET    | `/api/v1/admin/history`                   | Admin — filters + `page`, `pageSize`           |
| GET    | `/api/v1/admin/reports/:kind`             | Admin — CSV; `from`, `to`                      |
| GET    | `/api/v1/admin/analytics?date=`           | Admin — one campus day (default today)         |
| GET    | `/api/v1/admin/integrity`                 | Admin — integrity report                       |
| GET    | `/api/v1/admin/audit-logs`                | Admin — filters + pagination                   |

## Management (Phase 3)

Admin-only endpoints live in `modules/management` behind one router
(`admin.routes.ts`: `authenticate` + `authorize('ADMIN')`). Alerts and session
timelines are operational, so they sit in `modules/parking` and are open to
both roles. Request schemas and response types are shared with the web app
(`packages/shared/src/management.ts`).

### Parking Integrity Engine (`integrity.service.ts`)

Read-only consistency checks, each returning `passed` and up to 50 findings:

| Check                              | Rule                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `OCCUPIED_SLOT_HAS_ACTIVE_SESSION` | An OCCUPIED slot has an ACTIVE session                                    |
| `ACTIVE_SESSION_SLOT_OCCUPIED`     | An ACTIVE session's slot is OCCUPIED                                      |
| `ONE_ACTIVE_SESSION_PER_VEHICLE`   | No vehicle has two ACTIVE sessions                                        |
| `NO_EXPIRED_SLOT_HOLDS`            | No HELD slot is past its hold expiry                                      |
| `COMPLETED_SESSION_HAS_RECEIPT`    | Every COMPLETED session has a receipt                                     |
| `PAID_PAYMENT_HAS_RECEIPT`         | Every PAID payment (including ₹0 no-charge) has a receipt                 |
| `RECEIPT_MATCHES_TRANSACTION`      | Receipt, PAID payment and COMPLETED session agree on amount and exit hour |
| `NO_STUCK_PAYMENTS`                | No payment has been PROCESSING for more than 5 minutes                    |

The report also lists the 20 most recent `INTEGRITY_REJECTED` audit entries —
operations refused by a validation or security rule. Prevention stays where it
was (transactions, CAS updates, database constraints); this module observes.

### Session timeline (`timeline.service.ts`)

Audit entries whose entity is the session, or whose metadata carries its
session number (slot assignment, payment, receipt, slot release), ordered by
time and mapped to a fixed set of display details (slot and score, hours,
amount, method, transaction ID, receipt number, reason).

### Alerts (`alerts.service.ts`)

Recomputed on each request from live state — no stored alerts:

- **Zone full** (critical): occupied (including HELD) ≥ usable (non-blocked) slots.
- **Zone nearly full** (warning): occupancy ≥ `ALERT_NEARLY_FULL_PERCENT` (default 90); lists the free slots.
- **Long duration** (warning): active session ≥ `ALERT_LONG_DURATION_HOURS` (default 8) at the current campus hour.
- **Slot blocked** (info): with its reason.

### History, analytics and reports

- **History** filters sessions by normalised partial vehicle number, slot,
  type, owner category, status and campus-date range of entry, newest first,
  paginated (≤ 100 per page). Fees come from the finalized transaction only.
- **Analytics** covers one campus day. A session occupies hour _h_ when
  entry ≤ _h_ < exit (active sessions through the current hour today, or the
  end of a past day). Revenue counts receipts issued that day.
- **Reports** produce CSV (UTF-8 BOM, CRLF, at most 50 000 rows): history and
  transactions by date, daily revenue with per-type/category totals, and all
  vehicles. Cells starting with `= + - @` are prefixed with `'` to prevent
  spreadsheet formula injection. Ranges default to the last 30 days and are
  limited to 366 days (`DATE_RANGE_TOO_LARGE`). Each export is audited.
  `Content-Disposition` is exposed through CORS so the web app can keep the
  server's file name.

### Slot management

Blocking uses a compare-and-set on `status = AVAILABLE` (an occupied or held
slot cannot be blocked: `SLOT_NOT_AVAILABLE`); unblocking requires BLOCKED.
Priority (0–100) feeds the allocation score directly. Block coordinates are
set only from real, entered values (both or neither); removing them disables
the map link everywhere. Every change writes an audit entry (block reason,
priority from/to, new coordinates).

## Students, Campus Staff and visitors

Three kinds of people use CPVTS besides Security Staff and Administrators.
They are kept apart at every layer.

| Who                                    | Door                                                                   | Credential                        | Reaches                                               |
| -------------------------------------- | ---------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------- |
| Administrator, Security Staff          | `POST /auth/login` (username)                                          | account token                     | `/parking/*`, `/dashboard/*`, `/admin/*`, `/system/*` |
| Student, Campus Staff (`PARKING_USER`) | `POST /auth/user-login` (e-mail)                                       | account token                     | `/portal/*` only                                      |
| Visitor                                | `POST /visitor/access` (vehicle number + session number from the slip) | visitor token for **one session** | `/visitor/*` only                                     |

- Each sign-in door treats accounts of the other door exactly like unknown
  ones (same error, same timing), so the doors reveal nothing about each other.
- Visitor tokens use their own JWT audience and carry a session id, never a
  user id. `authenticate` rejects them (401) and `authenticateVisitor`
  rejects account tokens, so neither can stand in for the other. A visitor can
  only reach the session whose slip they hold, and only `VISITOR`-category
  sessions are reachable this way.
- Category and verification status live on the server-side
  `parking_user_profiles` row. They are chosen by the registration endpoint
  (`/auth/register/student` or `/auth/register/staff`) and changed only by an
  administrator; no request body can set them.

### Registration and verification

`POST /auth/register/{student|staff}` creates the account in status `PENDING`
with an identity document (JPEG, PNG or PDF, at most 2 MB; the file type is
recognised from its content, not from the declared type). The account can sign
in and see its status, but every parking page and endpoint answers
`VERIFICATION_REQUIRED` until an administrator approves it.

Administrators review pending accounts under `/admin/users` (counts, filters,
detail, `PATCH` for permitted fields, `POST …/status`, `POST …/verification`).
A rejection needs a reason; the user then sees it and may resubmit
(`POST /portal/verification/resubmit`), which returns the account to `PENDING`.
Only a `PENDING` verification can be decided, and decisions are audited.

Identity documents are stored in the database (`identity_documents.content`)
and are **never** served from a static or public path. The only route is
`GET /admin/users/:id/documents/:docId` for administrators: `no-store`,
`nosniff`, a sandboxing CSP, and an `IDENTITY_DOCUMENT_VIEWED` audit entry for
every view. The web client fetches it with the administrator's token and shows
it from a temporary blob URL. Registration and re-submission are the only
routes with a larger JSON body limit (3.5 MB).

### Vehicles and billing category

A verified user registers vehicles (`/portal/vehicles`). An unowned vehicle
that has parked before (for example as a visitor) can be claimed, but the new
owner sees only sessions that began after `owner_since` — earlier history never
becomes visible. Number and type are editable only while the vehicle has no
parking history. Owner category, fees, slots and sessions are never accepted
from the client.

At check-in the vehicle's owner is looked up. If it belongs to an **active,
verified** parking user, that account's category (`STUDENT` or `STAFF`) is the
billing category whatever the operator selected, and the response says so
(`categorySource: 'ACCOUNT'`). Otherwise the operator's mandatory selection
applies as before.

### Portal API (`/api/v1/portal`, `PARKING_USER` only)

| Route                                                                     | Needs verification | Purpose                                                                |
| ------------------------------------------------------------------------- | :----------------: | ---------------------------------------------------------------------- |
| `GET/PATCH /profile`                                                      |                    | name, phone, preferred language (never category, ID, e-mail or status) |
| `POST /verification/resubmit`                                             |                    | new document after a rejection                                         |
| `GET /overview`                                                           |         ✔          | active sessions, live availability, recent activity                    |
| `GET/POST /vehicles`, `PATCH /vehicles/:id`, `POST /vehicles/:id/primary` |         ✔          | own vehicles                                                           |
| `GET /sessions/current`, `GET /sessions/:n`                               |         ✔          | own sessions only (others look like 404)                               |
| `GET /layout`                                                             |         ✔          | slot layout; only the user's own slots carry vehicle details           |
| `GET /history`                                                            |         ✔          | own history with date / vehicle / type filters                         |
| `GET /receipts`, `GET /receipts/:n`                                       |         ✔          | own receipts (same receipt format as staff)                            |

Every figure — duration, estimated fee, final fee, receipt — comes from the
same server code as the staff screens; the web app never calculates a fee.

## Web (`apps/web`)

### Routing and guards

```text
/             PublicLayout → PublicHomePage   (no sign-in; aggregate overview only)
/help         PublicLayout → HelpPage         (static Help & FAQ)
/verify/:ref  PublicLayout → ReceiptVerificationPage (receipt QR target)
/login        PublicOnlyRoute                 (signed-in users are sent to their requested page or role home)
/user/login   PublicOnlyRoute                 (Student / Campus Staff sign-in, e-mail + password)
/register/:category  PublicOnlyRoute          (student | staff; two steps, ID upload)
/visitor      VisitorLayout                   (no account: slip details → /visitor/parking, /visitor/receipt)
/user/*       RequireAuth → RequireRole(PARKING_USER) → UserShell
              verified only (RequireVerified): home, my-parking, locate, vehicles, parking,
              history, sessions/:n, receipts, receipts/:n
              any parking user: profile, more (pending/rejected accounts see the verification page instead)
/admin/*      RequireAuth → RequireOperational → AppShell → RequireRole(ADMIN)
              dashboard, live, finder, sessions/:n, receipts/:n, account,
              slots, history, analytics, reports, integrity, audit-logs,
              users, users/:id (verification, documents, vehicles, history)
/staff/*      RequireAuth → RequireOperational → AppShell → RequireRole(SECURITY_STAFF)
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
  Students and Campus Staff never see it: `UserShell` is a slim top bar on
  desktop and a bottom tab bar (Home, Parking, History, Receipts, More) on
  phones, tablets and the Android WebView, with safe-area padding.
- Resident visual language: one dark brand surface per page for the
  vehicle's answer (`CurrentParkingPanel`: plate, block, slot, entry, duration,
  fee), flat sections separated by hairlines instead of grids of cards,
  parking-bay lines as the only decoration, and the same status colours
  everywhere (`slot-tone.ts`).
- Photography: `ImageSlot` fills from `VITE_IMAGE_*` variables and otherwise
  draws a designed placeholder. No images are bundled or invented.
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

### Charts

Analytics charts are hand-built SVG (`src/components/charts`) — no chart
library. Series colours are the `--chart-1` / `--chart-2` tokens, a
categorical pair validated for colour-vision deficiency on light surfaces.
Columns are thin with a rounded data end and a 2 px gap between stacked
segments; only the peak is labelled. Every chart has a legend (two or more
series), a tooltip on hover and on keyboard focus (arrow keys, Home, End) and
a "Show as table" view, so no value depends on colour or hovering.

## Scope boundary

Implemented through Phase 3: the parking lifecycle plus the smart and
management modules described above.

Student / Campus Staff accounts with ID verification, the resident portal and
visitor access are implemented (see above).

Not implemented (Phase 4): demo-data tools and the Android WebView APK. No
real payment gateway, ML/AI, chatbot, moving-vehicle GPS or turn-by-turn
navigation exists, by design: Google Maps shows a parking _block_, the CPVTS
layout shows the exact slot.
