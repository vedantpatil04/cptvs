# CPVTS Architecture

This document describes how the CPVTS code is organised and which rules the
backend enforces. The Master Blueprint remains the product reference; this file
explains _how_ the code delivers it. It covers the parking lifecycle, the
management modules, Student / Campus Staff / Visitor access, Security Staff
shifts and cash accountability.

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
  assignment, availability, duplicate checks, verification status, checkout or
  receipt validity.
- **One source of truth per fact.** Every fact (an account's verification status,
  who owns a vehicle, which shift took a payment, what a fee is) lives in one
  database column or one function. Other screens read it; nothing keeps a copy.
- **Provider independence.** Nothing outside `apps/api/src/db` and
  configuration knows the database host; nothing in application code knows
  about Vercel or Render.

## Shared package (`packages/shared`)

Only contracts that both sides must agree on:

- `USER_ROLES` (`ADMIN`, `SECURITY_STAFF`, `PARKING_USER`) — the backend asserts
  at compile time that the database enum matches. Student / Campus Staff are the
  one `PARKING_USER` role; their category lives on the server-side profile.
- `SUPPORTED_LOCALES` (`en`, `kn`, `hi`, `mr`).
- zod schemas (login, registration, vehicles, shifts, cash handovers, admin
  filters, …) used for server validation _and_ client form validation. Their
  messages are translation keys (`validation.*`), so the server and client report
  the same error in any language.
- `academic.ts`: programs, `batchOf`, `parseBatchLabel`, `maxSemesterOf` (see
  [Academic profile](#academic-profile)).
- `shifts.ts`: shift states, cash states, request schemas and views.
- `parkNowEligibilityOf` — the one rule for "may this account use the
  verified-only features".
- API response and error types (`ApiErrorBody`, `ApiErrorCode`, …), audit
  action names and notification kinds.

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

Modules follow the same folder shape and are registered in `src/routes/api-v1.ts`:
`auth`, `accounts`, `users` (Admin user management), `portal` (Student / Campus
Staff), `visitor`, `parking`, `fees`, `shifts`, `notifications`, `management`
(Admin), `dashboard`, `public`, `audit`, `settings`, `system`, `health`.

### Transactions

`withTransaction(work, { isolationLevel })` runs several repository calls
atomically. Repositories take an optional `db` argument (`DbClient`) so the
same function works inside or outside a transaction. Allocation, check-in,
checkout finalization, shift check-in and cash handover all use it; state
changes that can race are conditional updates (`UPDATE … WHERE status = …`) or
take a lock (see [Shift conflicts](#shift-conflicts)).

### Database-level integrity

The schema enforces invariants even if application code has a bug:

- partial unique indexes: one `ACTIVE` session per vehicle, one `ACTIVE`
  session per slot, one `PAID` payment per session, one open (`PENDING` /
  `PROCESSING`) payment per session, one primary vehicle per owner, one open
  Park Now offer per user;
- unique session numbers, entry references, transaction IDs, receipt numbers,
  verification references, one active owner per normalized vehicle plate (the
  plate is the vehicle row's unique key), one cash handover per shift, unique
  shift template names;
- CHECK constraints: hours 0–23, exit ≥ entry, non-negative durations and
  amounts, paired GPS coordinates, `HELD` slots carry a hold token and expiry,
  completed sessions carry their checkout data and fee breakdown, paid
  payments carry `paid_at`, `NO_CHARGE` is used exactly for ₹0 payments;
  the academic profile is all-or-nothing, Students only, with a valid
  semester for the program; shifts end after they start and carry the
  timestamps their status implies; a cash handover difference equals
  actual − expected, a mismatch carries a note, and a resolution is complete;
- `RESTRICT` foreign keys on parking history so records cannot be orphaned.

Money is stored as integer paise. GPS coordinates belong to parking blocks and
are nullable — real coordinates must be collected, never invented.

### Development database and migrations

The shared Supabase PostgreSQL database is the normal development database:
`apps/api/.env` points `DATABASE_URL` at it. Consequently:

- **Prisma is the only way its structure changes.** `schema.prisma` plus the
  committed SQL migrations are the source of truth; nothing is created by hand
  in the Supabase dashboard. Constraints the schema language cannot express
  (CHECKs, partial indexes) are SQL inside a migration.
- **Its data is development data and is never reset, dropped or truncated.**
  Migrations that add NOT NULL data or constraints backfill existing rows first
  (the `backend_finalization` migration backfills `parking_sessions.owner_user_id`
  and `payments.processed_by_id`) and were rehearsed on a scratch database with
  legacy-shaped rows before being applied.
- **Tests never touch it.** The API tests truncate every table, so they use a
  disposable local database named `*test*` (`TEST_DATABASE_URL`). The guard in
  `test/test-env.ts` refuses a remote host, a managed provider or a database
  whose name does not contain `test`, and `test/helpers.ts` re-checks the
  connected database name before truncating. The test run pins both
  `DATABASE_URL` and `DIRECT_URL`, so `apps/api/.env` is never used.
- Checks that are safe against Supabase (read-only): `prisma validate`,
  `prisma migrate status`, `prisma migrate diff --from-config-datasource
--to-schema prisma/schema.prisma --exit-code` (drift) and `GET /health/ready`.

### In-memory data structures

The problem statement asks for appropriate in-memory data structures. CPVTS
uses them where they help without becoming a second source of truth:

- **Allocation** loads the zone's slots once, then ranks candidates in memory
  (arrays with layout positions, a `Map<slotId, usesToday>` for balanced
  utilisation) before touching the database again.
- **Parking map and dashboards** group slots and statuses in memory
  (per block → zone → slot, counts per status and vehicle type).
- **Cash summaries** aggregate a shift's payments into a `Map<shiftId, summary>`
  in one query for any number of shifts.
- There is deliberately **no long-lived cache** of slots, sessions, accounts or
  shifts: PostgreSQL is the single source of truth and every state change is a
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
  version) claim. Default lifetime 8 hours. **The token carries identity only**
  (`sub`, `tv`, standard claims): never a role, a verification status or a
  permission.
- `authenticate` re-loads the user **and the parking profile** on every request,
  so deactivation, role changes, verification decisions and logout take effect
  immediately. Logout increments the user's `token_version`, revoking all of
  that user's tokens.
- Authenticated and visitor responses carry `Cache-Control: no-store` and
  `Vary: Authorization`, so a proxy or browser cache cannot serve one person's
  state (or yesterday's verification status) to another request.
- `authorize(...)` restricts routes by role. The matrix is tested exhaustively:
  `test/authorization-matrix.test.ts` calls every API route as seven kinds of
  caller (anonymous, visitor, a pending parking user, a verified Student, a
  verified Campus Staff member, Security Staff, Admin) and fails if the number of
  routes registered in the source differs from the number it has expectations for.
- Login attempts are rate-limited per IP (failed attempts only). Sign-in
  successes, failures and logouts are written to `audit_logs`.
- Tokens are sent as `Authorization: Bearer` headers rather than cookies. This
  works identically on the website and inside an Android WebView, avoids
  cross-site cookie restrictions between Vercel and Render, and is immune to CSRF.
  The client keeps the token in `localStorage`; the risk is mitigated by short
  token lifetime, server-side revocation and React's output escaping.

### Public overview (no authentication)

`GET /api/v1/public/overview` powers the public landing page. It returns:

- free and total slot **counts** per vehicle type (in-service slots of active
  zones of active blocks; expired holds are reclaimed first);
- active parking **blocks**: name, description, accepted vehicle types and GPS
  coordinates when configured (null otherwise);
- the **fee schedule** from the `settings` table (`parking.feeSchedule`),
  validated against the shared `feeScheduleSchema`; withheld if invalid.

It never returns slot codes, vehicles, sessions, payments, receipts, revenue,
audit logs or users — an integration test inserts such records and asserts
that none of their identifiers appear in the response. Responses are
rate-limited per IP and cacheable for 15 seconds. The public receipt
verification (`GET /public/receipts/:reference`) shows a safe summary with the
plate masked (`KA22AB1234` → `KA****1234`).

## Parking operations

### Lifecycle

```text
Entry ─ validate ─ duplicate check ─ zone ─ rank candidates ─ HOLD slot ─ final check ─ COMMIT session
 │  (Security desk check-in, or the owner's Park Now confirm — one session factory)    (slot OCCUPIED)
 ▼
ACTIVE session ─ tracking / map / estimated fee ─ (owner/visitor may flag EXIT_REQUESTED: nothing else changes)
 │
 ▼   gate only: Security Staff / Admin scan the session QR or look the vehicle up
Quote (exit hour → duration → fee) ─ PENDING payment ─ PROCESSING ─┬─ FAILED (nothing changes)
                                                                   └─ FINALIZE (one transaction):
                                                                      payment PAID by the guard + shift,
                                                                      session COMPLETED with frozen
                                                                      duration/fee/breakdown, receipt
                                                                      issued, slot AVAILABLE, audit events
```

The session `lifecycle` shown to clients is derived: `ACTIVE`, `EXIT_REQUESTED`
(an ACTIVE session whose owner or visitor said they are ready to leave) or
`COMPLETED`. It is not a separate stored status, so it cannot disagree with the
session.

### Allocation (`modules/parking/allocation.ts`)

Deterministic and rule-based. Candidates are only `AVAILABLE` slots in active
zones of active blocks for the vehicle's type; `OCCUPIED`, `BLOCKED`, `HELD`,
disabled and archived slots never qualify, and another type's zone is never
used, even when the correct zone is full (`ZONE_FULL`).

```text
score = 1000 × priority − 10 × usesToday − layoutPosition
```

- `priority`: optional admin-configured slot preference (default 0).
- `usesToday`: sessions started in the slot today (balanced utilisation).
- `layoutPosition`: position in the configured layout (block → zone → slot).

Ties break by layout position, then slot code, so the same state always gives
the same slot. The response explains the decision ("why this slot": checks
passed, score, factors, candidates compared, fallbacks). `loadRankedCandidates`
is the only source of candidates for the desk and for Park Now, so a slot an
administrator adds joins allocation without a code change.

### Temporary slot hold

`AVAILABLE → HELD → OCCUPIED`, with `HELD → AVAILABLE` on failure, cancellation
or expiry.

1. **Hold**: a compare-and-set update (`status = AVAILABLE` → `HELD`, random
   `hold_token`, `hold_expires_at = now + SLOT_HOLD_SECONDS`). Only one
   terminal can win; the loser falls back to the next candidate.
2. **Final verification + commit** (one transaction): `HELD → OCCUPIED` only if
   the slot is still held with the same token, the hold has not expired and the
   zone still matches the vehicle type; then the vehicle, session and audit
   rows are written. If the final check fails, the next candidate is tried.
3. Errors release the hold; expired holds are reclaimed before every
   allocation, map read and public overview. A CHECK constraint guarantees
   `HELD` ⇔ token ⇔ expiry.

Duplicate check-ins of the same vehicle that race past the pre-check are
stopped by the unique indexes (`one active session per vehicle`,
`vehicles.vehicle_number`) and reported as `DUPLICATE_ACTIVE_VEHICLE`.

### One session factory

`modules/parking/session-factory.ts` (`createActiveSession`) is the only code
that creates an ACTIVE parking session. The Security desk check-in and the
Student / Campus Staff Park Now confirmation both end in it, so a session — its
number, its session QR reference, its owner snapshot, its audit trail, the
owner's notification — is identical however the vehicle arrived. The entry
channel (`SECURITY` or `SELF_SERVICE`) is recorded in the audit metadata only.

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
else and can be retried. Every payment row has `is_simulated = true`; no
gateway is called and no money moves.

### Identifiers and QR codes

| Identifier                     | Format                                                            | Generated            |
| ------------------------------ | ----------------------------------------------------------------- | -------------------- |
| Parking Session Number         | `CPVTS-P-XXXXXXXX` (8 × Crockford base32, CSPRNG)                 | at check-in          |
| Session QR reference           | 256-bit random, base64url; QR text `cpvts:session:<ref>`          | at check-in          |
| Transaction ID                 | `TXN-XXXXXXXXXX`                                                  | at payment creation  |
| Receipt Number                 | `CPVTS-R-<year>-XXXXXXXX`                                         | only at finalization |
| Receipt verification reference | 256-bit random, base64url; QR encodes `<web origin>/verify/<ref>` | at finalization      |

There are **two different QR codes and they are never interchangeable**:

|                | Session QR                                                                     | Receipt QR                                       |
| -------------- | ------------------------------------------------------------------------------ | ------------------------------------------------ |
| Created        | when the session starts                                                        | when the payment is finalized                    |
| Purpose        | identifies the _active_ session at the gate                                    | lets anyone verify a _finished_ receipt          |
| Accepted by    | `POST /parking/checkouts/scan`, and optionally as proof on quote/payment calls | `GET /public/receipts/:reference` only           |
| After checkout | refused (`SESSION_NOT_ACTIVE`)                                                 | keeps working                                    |
| Carries        | an opaque random reference only                                                | an opaque random reference in a verification URL |
| Never contains | a name, plate, phone, USN/ID, slot, fee or token                               | a name, plate, phone, USN/ID, slot, fee or token |

The server looks each reference up and applies its own checks; vehicle, slot
and amount in a QR are never trusted. A receipt reference is never accepted at
checkout. Public verification also cross-checks the receipt, payment and
session (status, amounts, exit hour) and reports `INVALID` if they disagree.

### Validation and integrity (server-side)

Duplicate active vehicle, invalid hours, exit before entry, full zone, wrong
zone/type, occupied/blocked slots, unknown vehicle/session, completed session,
vehicle↔session and session↔slot mismatch, payment↔session mismatch and
receipt↔transaction consistency are all enforced by the API (and, where
possible, by database constraints). Refusals are written to the audit log as
`INTEGRITY_REJECTED` with the error code.

Audit actions live in `@cpvts/shared` (`audit.ts`) so the web app can translate
them. They cover the parking lifecycle (`VEHICLE_CHECKED_IN`, `SLOT_ASSIGNED`,
`CHECKOUT_INITIATED`, `PAYMENT_*`, `TRANSACTION_FINALIZED`, `RECEIPT_GENERATED`,
`SLOT_RELEASED`, `INTEGRITY_REJECTED`), management (`SLOT_BLOCKED`,
`SLOT_PRIORITY_CHANGED`, `BLOCK_LOCATION_UPDATED`, `REPORT_EXPORTED`, …), users
(`USER_VERIFIED`, `IDENTITY_DOCUMENT_VIEWED`, `IDENTITY_DOCUMENT_DOWNLOADED`,
`VEHICLE_REGISTERED`, `VEHICLE_RELEASED`), the gate (`EXIT_REQUESTED`,
`EXIT_REQUEST_CANCELLED`, `CHECKOUT_QR_SCANNED`) and shifts
(`SHIFT_TEMPLATE_CREATED`, `SHIFT_ASSIGNED`, `SHIFT_CHECKED_IN`,
`SHIFT_CHECKED_OUT`, `SHIFT_MISSED`, `CASH_HANDOVER_RECORDED`,
`CASH_DISCREPANCY_RESOLVED`, …).

### Time

Entry and exit are whole hours (competition model). At the security desk the
guard enters the entry hour at check-in and the exit hour on the checkout quote;
a user's or visitor's fee preview uses the current campus hour. The current
campus hour (`CAMPUS_TIMEZONE`) is also used for live durations and estimates of
active sessions; "today" on dashboards is the campus day. Shift times are real
instants converted from campus time, so a shift that crosses midnight (Evening
16:00–00:00) is one continuous interval.

## Management

Admin-only endpoints live behind one router (`admin.routes.ts`: `authenticate` +
`authorize('ADMIN')`), which also mounts the user-management and shift routers.
Alerts and session timelines are operational, so they sit in `modules/parking`
and are open to Security Staff and Admin. Request schemas and response types are
shared with the web app.

### Parking Integrity Engine (`integrity.service.ts`)

Read-only consistency checks, each returning `passed` and up to 50 findings:

| Check                              | Rule                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `OCCUPIED_SLOT_HAS_ACTIVE_SESSION` | An OCCUPIED slot has an ACTIVE session                                            |
| `ACTIVE_SESSION_SLOT_OCCUPIED`     | An ACTIVE session's slot is OCCUPIED                                              |
| `ONE_ACTIVE_SESSION_PER_VEHICLE`   | No vehicle has two ACTIVE sessions                                                |
| `NO_EXPIRED_SLOT_HOLDS`            | No HELD slot is past its hold expiry                                              |
| `COMPLETED_SESSION_HAS_RECEIPT`    | Every COMPLETED session has a receipt                                             |
| `PAID_PAYMENT_HAS_RECEIPT`         | Every PAID payment (including ₹0 no-charge) has a receipt                         |
| `RECEIPT_MATCHES_TRANSACTION`      | Receipt, PAID payment and COMPLETED session agree on amount and exit hour         |
| `NO_STUCK_PAYMENTS`                | No payment has been PROCESSING for more than 5 minutes                            |
| `PAID_PAYMENT_HAS_OPERATOR`        | Every PAID payment names the staff member who finalized it (visitor-free of gate) |
| `SHIFT_CASH_MATCHES_HANDOVER`      | A recorded handover still equals its shift's cash payments; CLOSED ⇒ handover     |
| `NO_OVERLAPPING_SHIFTS`            | No Security Staff member has two overlapping shifts                               |

The report also lists the 20 most recent `INTEGRITY_REJECTED` audit entries —
operations refused by a validation or security rule. Prevention stays where it
was (transactions, CAS updates, database constraints); this module observes.

### Session timeline (`timeline.service.ts`)

Audit entries whose entity is the session, or whose metadata carries its
session number (slot assignment, payment, receipt, slot release, exit request,
QR scan), ordered by time and mapped to a fixed set of display details (slot
and score, hours, amount, method, transaction ID, receipt number, reason).

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

### Slot inventory (Admin)

`modules/management/slot-management.service.ts` and `block-management.service.ts`.
Capacity is the set of **in-service** slots (`IN_SERVICE`: enabled and not
archived, in an active zone of an active block); allocation, holds, public
counts, dashboards, alerts and analytics all use it.

- **Create** `T-11+` / `F-06+` into a zone: vehicle type must equal the zone's,
  the ID must carry the type's prefix (`T-`/`F-`), IDs are unique forever
  (archived ones included).
- **Edit** priority and layout order any time; rename/move only an idle slot
  with no parking history (`SLOT_HAS_HISTORY`); blocked reason only while blocked.
- **Block/unblock** (a reason; `AVAILABLE` slots only) and **disable/enable**
  (out of service: not allocated, not counted) never touch an occupied or held slot.
- **Delete is safe**: an unused idle slot is removed; one with history is
  **archived** (soft delete) so sessions, receipts and reports stay intact;
  occupied/held slots are refused (`SLOT_IN_USE`). Archived slots can be
  restored. A database CHECK keeps archived slots idle.
- **Blocks and zones** can be created, renamed, reordered and retyped (an empty
  zone), and carry the block's real coordinates (never invented).
- **Deactivating a block or zone drains it.** Vehicles already parked there keep
  their ACTIVE sessions and can be checked out normally (the slot is released
  afterwards); only _new_ allocation stops. Held slots and open Park Now offers
  there are cancelled at once, the public counts exclude it, and the parking map
  still shows a deactivated block that has parked vehicles (`isActive: false`) so
  they remain findable.

## Parking users: Student, Campus Staff and Visitor

Three kinds of people use CPVTS without being operators. They share the same
parking sessions, fee engine, finalization, receipts and audit log as the
security desk — nothing is duplicated — and differ only in **who may start an
action and how they authenticate**.

| Who                   | Account | Sign-in door                     | Token                                                  |
| --------------------- | ------- | -------------------------------- | ------------------------------------------------------ |
| Admin, Security Staff | yes     | `POST /auth/login` (username)    | account token (`aud = cpvts-web`)                      |
| Student, Campus Staff | yes     | `POST /auth/user-login` (e-mail) | account token, `PARKING_USER` role                     |
| Visitor               | **no**  | `POST /visitor/access` (slip)    | session token (`aud = cpvts-web:visitor`), one session |

The doors are separate: an account is rejected at the wrong door exactly like
an unknown one. A visitor token has its own audience, so it is rejected by
`authenticate` everywhere and an account token is rejected by
`authenticateVisitor`; the visitor token carries only a session id and expires
after `VISITOR_ACCESS_HOURS`. Security Staff accounts are created by an
Administrator (`POST /admin/security-staff`); nobody registers as staff or admin.

### Registration and verification

`POST /auth/register/student` and `/staff` (the **category comes from the
endpoint, never the body**) create a `PENDING` account with its identity
document and sign the user in. A pending or rejected account can read its
profile and notifications and resubmit, but every parking feature returns
`VERIFICATION_REQUIRED` (`requireVerified`). An administrator approves, or
rejects with a mandatory reason, exactly once (a conditional update); the user
is notified either way. A rejected user resubmits a new document and returns to
`PENDING`. An institutional ID (a USN or a staff ID, trimmed and upper-cased) can
be registered once per category, and an e-mail address (trimmed and lower-cased)
once; duplicates are refused by unique indexes, so a race cannot create two.

#### One verification state

The Admin screen and the user's own screens must never disagree about whether an
account is verified. The rule that guarantees it:

- The only stored verification state is `parking_user_profiles.verification_status`
  — the record the Admin decision updates.
- It is **never copied** into a token, a session, a cache or a second column.
  The JWT holds `sub` and `tv`; `authenticate` loads the user and profile from the
  database for each request.
- Every consumer derives its answer from the same function,
  `parkNowEligibilityOf(verificationStatus, isActive)`: the `parkNow` block of
  `GET /auth/me`, `GET /portal/account`, `GET /portal/profile`, `requireVerified`
  and the desk's owner-category lookup. Eligible means **VERIFIED and active**;
  otherwise `blockedBy` is `VERIFICATION_PENDING`, `VERIFICATION_REJECTED` or
  `ACCOUNT_INACTIVE`.
- Responses are `no-store`, so no cache can serve an old answer.

The sequences this guarantees (and that `verification-consistency.test.ts`
asserts over HTTP): register → `PENDING` (Park Now refused) → Admin verifies → the
_same, old_ session token now sees `VERIFIED` and Park Now works; Admin rejects →
rejected with the reason; Admin deactivates a verified account → its token stops
working at once and the desk stops billing its vehicles in that account's
category; Campus Staff behave identically.

A client must therefore re-read `GET /portal/account` (or `/auth/me`) when it
needs the status — after sign-in, on focus, on a 403 `VERIFICATION_REQUIRED` —
and not keep the object it received when the user signed in.

### Academic profile

Students (not Campus Staff) register with an academic profile, stored as four
columns on their parking profile: **Program** (`BCA`, `B.Com`, `BBA`, `MCA`,
`MBA`), **Department** (free text with whitespace collapsed, 2–80 characters; the
Admin filter matches it case-insensitively), **Admission Year** (2000 up to the
current year) and **Current Semester** (1–6 for BCA/B.Com/BBA, 1–4 for MCA/MBA). The **Batch is derived, never
stored**: admission year + program duration, e.g. BCA admitted 2024 → `2024–2027`,
MBA admitted 2024 → `2024–2026`. A database CHECK keeps the profile
all-or-nothing, Students only, with a semester valid for the program.

Students cannot edit these fields themselves; the legitimate change path is the
Admin (`PATCH /admin/users/:id` with `academic`, merged with the stored values
and re-validated, audited with the before/after values). A student registered
before this was collected has no academic profile (`academic: null`) until an
Admin fills it. `GET /admin/users` filters by `program`, `department`, `batch`
(`2024–2027`, a hyphen works too), `semester`, `verification`, `status`
(active/inactive) and `parking` (parked/not parked); `GET /admin/users/facets`
returns the departments and batches that exist, to populate the filters. There
is no ERP integration and no automatic semester promotion.

### Identity documents

Stored in the database (JPEG/PNG/PDF, at most 2 MB, type recognised from the
file signature, not the declared type). They are never in a list or detail
response and never served statically: the only way out is
`GET /admin/users/:id/documents/:documentId` — Admin only, one document at a
time, `Cache-Control: no-store`, sandboxed (a PDF is served with a
`default-src 'none'` CSP). Viewing is audited as `IDENTITY_DOCUMENT_VIEWED`;
adding `?download=1` returns an attachment with a safe RFC 6266 file name and is
audited as `IDENTITY_DOCUMENT_DOWNLOADED`. Only the registration/resubmission
routes accept the larger (4 MB) JSON body.

### Owner category

The **owner category is authoritative**: a vehicle registered to an active,
verified account is billed in that account's category at check-in no matter
what the desk selects (`categorySource: ACCOUNT`). `GET /parking/vehicle-lookup`
tells the entry desk the category before it chooses one, revealing nothing else
about the owner. A deactivated or unverified account falls back to the desk's
category.

### Vehicles and ownership

There is one vehicle registry — the `vehicles` table the security desk already
uses — and no second one. A normalized plate (upper case, no spaces or hyphens)
is unique, so it has **at most one active owner**.

- A user may register up to 5. The first is primary; one primary per owner is
  enforced by a partial unique index, and removing the primary promotes the oldest
  remaining one.
- A plate the desk has seen before can be claimed once, if it is unowned and of
  the same type. A plate owned by someone else is refused
  (`VEHICLE_ALREADY_REGISTERED`).
- Label is always editable; number and type only while the vehicle has no parking
  history (`VEHICLE_IDENTITY_LOCKED`). Category, fee, slot, session, payment and
  receipt are not vehicle fields at all.
- **Removing** a vehicle (`DELETE /portal/vehicles/:id`, or an Admin
  `POST /admin/vehicles/:id/release`) never destroys history: a vehicle with no
  sessions is deleted, one with sessions is _released_ (owner, primary flag and
  label cleared) so the plate can be registered by its next real owner. A parked
  vehicle cannot be released (`VEHICLE_PARKED`); a Park Now hold for it is
  cancelled.
- Admin looks up ownership with `GET /admin/vehicles?q=&owned=&vehicleType=`
  (partial plate search → owner, verification state, session count, current
  parking) and `GET /admin/vehicles/:id`.

### Session ownership snapshot

`parking_sessions.owner_user_id` records which account owned the vehicle when
the session was created. A user's history, receipts, active sessions and
notifications are the sessions carrying _their_ id — so the previous owner of a
released plate keeps their history, the new owner does not inherit it, and a
vehicle that changes hands mid-session cannot move that session to someone else.
The migration backfilled existing sessions from the vehicle's owner at the time.

### Park Now (no advance reservation)

```text
POST /portal/park-now/offers   validate ownership + account → duplicate check
                               → same ranking as the desk → HOLD the slot → offer
POST /portal/park-now/confirm  OFFERED → CONFIRMED (conditional), final check
                               HELD → OCCUPIED, create the ACTIVE session (session factory)
POST /portal/park-now/cancel   HELD → AVAILABLE at once
```

Park Now is _not_ a reservation: it is for a user who is at the gate, and the
slot is held only for `PARK_NOW_HOLD_SECONDS` (default 90) while they confirm.
The user never picks a slot. An unconfirmed offer lapses (`releaseExpired` frees
the slot and marks the offer `EXPIRED`, whichever request comes first). The
`park_now_offers` table records each offer, and a partial unique index allows
**one open offer per user**, so Park Now cannot hoard slots. Races are settled by
conditional updates and unique indexes: simultaneous users get different slots, a
double confirm creates one session, simultaneous starts leave one held slot.

### Ready to exit, and gate-controlled checkout

**A user cannot finalize their own checkout.** Final checkout — the exit hour,
the payment and the release of the slot — happens at the gate, by Security Staff
or an Administrator. This keeps the money, the receipt and the slot under the
control of a person who can see the vehicle leave.

What a Student, Campus Staff member or Visitor can do:

- see the session, its QR, its timeline and an **estimated fee**
  (`POST /portal/checkout/quote`, `POST /visitor/checkout/quote` — a preview that
  records nothing and creates no payment);
- say **"I'm ready to exit"** (`POST /portal/sessions/:n/exit-request`,
  `POST /visitor/exit-request`; `DELETE` withdraws it). This sets
  `exit_requested_at` on the ACTIVE session and writes an audit entry. It
  changes nothing else: the slot stays OCCUPIED, no fee is frozen, no payment
  exists. Security sees these sessions with
  `GET /parking/sessions/active?exitRequested=true`.

What they cannot do: create, process or cancel a payment, or finalize. Every
`/portal/checkout/payments*` and `/visitor/checkout/payments*` route answers
`403 GATE_CHECKOUT_REQUIRED`, and the checkout service itself refuses any actor
that is not Security Staff or an Administrator (`assertGateChannel`), so the rule
holds even if a new route were added by mistake.

At the gate:

1. The guard scans the session QR (`POST /parking/checkouts/scan`), or looks the
   vehicle up by number, session number or slot.
2. `quote` computes the fee from the fee engine; `payments` creates the payment;
   `process` finalizes it (payment `PAID`, session `COMPLETED`, receipt, slot
   `AVAILABLE`, notification to the owner) in one transaction.
3. The payment records `processed_by_id` (the guard) and `shift_id` (their shift).
   An Administrator may do the same as an **override**: no shift, and the audit
   entry says `override: true`. Vehicle _entry_ stays a Security Staff action.

### QR checkout (backend)

`POST /parking/checkouts/scan` takes the text a camera scanned (the full
`cpvts:session:<reference>` or the bare reference) and returns the authoritative
ACTIVE session for the guard to continue with. The server:

1. requires an authenticated Security Staff member or Administrator — **a QR
   alone is never enough**;
2. extracts the opaque reference and looks it up; unknown and malformed
   references are indistinguishable (`INVALID_QR_REFERENCE`);
3. refuses a session that is not ACTIVE;
4. checks that the vehicle, the session and the slot agree
   (`SESSION_INCONSISTENT`) and returns the `checks` it ran;
5. audits the scan (`CHECKOUT_QR_SCANNED`), and refusals as `INTEGRITY_REJECTED`.

`quote` and `payments` accept an optional `entryReference`; when given, it must
belong to the same session (`QR_SESSION_MISMATCH`), which protects a guard who
scanned one vehicle and then paid for another. A receipt reference is never
accepted. The web camera scanner is a front-end task; the contract is complete.

### Visitors

A visitor has no account. `POST /visitor/access` takes the vehicle number and the
session number from the slip and returns a token valid for that one session
(`VISITOR_ACCESS_HOURS`, also the time after checkout during which the receipt can
be opened). The token carries only the session id, and every visitor route
resolves that one session — another visitor's session looks like one that does
not exist. A visitor can view the session, the layout and timeline, preview the
fee, request exit and open the receipt. Every mismatch at the door (unknown
session, wrong plate, not a visitor's session, too long after checkout) gets the
same answer, so neither number can be probed separately.

### Notifications

`notifications` stores a `kind` and `params`; the client translates. They are
written in the same transaction as the event they announce. Kinds:

| Audience       | Kinds                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Parking users  | `VERIFICATION_APPROVED`, `VERIFICATION_REJECTED`, `PARKING_STARTED`, `RECEIPT_GENERATED`, `PARKING_NOTICE` (Admin notice) |
| Security Staff | `SHIFT_ASSIGNED`                                                                                                          |
| Administrators | `SHIFT_CASH_DUE` (a guard checked out, cash to collect), `CASH_DISCREPANCY`, `SHIFT_MISSED`                               |

Every signed-in role reads its own through `GET /notifications` (parking users
also keep the original `/portal/notifications`); nobody can read or mark another
person's.

## Security shifts and cash

Security Staff work in **shifts**, so that every vehicle entered and every
payment taken is traceable to _who_ did it and _when they were on duty_:

```text
payment → processed_by (staff) → shift → gate / time window
```

This is operational gate-duty management — who is on duty, what they collected,
whether the cash they hand over matches — not HR, attendance or payroll.

### Shift model

- **Templates** (`shift_templates`: name, start, end as campus time of day) are
  edited by an Admin; `db:seed` creates _Morning_ 08:00–16:00, _Evening_
  16:00–00:00 and _Night_ 00:00–08:00 when there are no templates (a template that
  ends at or before its start crosses midnight). Editing a template never changes
  shifts already assigned from it.
- **Shifts** (`security_shifts`) assign a Security Staff member to a template on a
  campus date, with an optional gate and note. They store real `starts_at` /
  `ends_at` instants and a copy of the template's name, so they are unaffected by
  later template changes. Admin lists a **daily roster** (shifts, templates and
  unassigned staff) and the **history** (filter by date range, person, status,
  cash status), and can correct a shift's gate, note and window (extend a shift) or
  remove one nobody has started.
- **States**: `SCHEDULED → CHECKED_IN` (early) `/ ACTIVE → CHECKED_OUT → CLOSED`,
  or `MISSED`. The status you read is _effective_: an early check-in reads
  `ACTIVE` once its start time passes, and a scheduled shift whose end has passed
  reads `MISSED`; a background sweep stores both. `LATE` (checked in more than 10
  minutes after the start) and `EARLY_CHECKOUT` (checked out more than 10 minutes
  before the end) are derived flags on the shift, not separate states.
- **On duty** means: checked in, the shift has started, and it is not past its end
  plus `SHIFT_OVERRUN_MINUTES`.
- **Check-in/out** (`POST /security/shift/check-in`, `/check-out`): a guard may
  check in `SHIFT_EARLY_CHECK_IN_MINUTES` before the start (`SHIFT_TOO_EARLY`
  otherwise), only to a scheduled shift, and only one at a time. An Admin can check
  a forgotten guard out (`POST /admin/shifts/:id/check-out`).
- `GET /security/shift` returns the guard's own context — the current shift
  ("Security 1 · 08:00–16:00 · Main Gate · ON DUTY"), their upcoming shifts and
  the enforcement mode.

#### Shift conflicts

Two shifts of the same person may not overlap (`SHIFT_CONFLICT`). The check and
the insert run under a per-person Postgres advisory transaction lock
(`pg_advisory_xact_lock`), so two Admins assigning at the same moment cannot both
succeed; the `NO_OVERLAPPING_SHIFTS` integrity check watches for any that slip
through (a missed shift does not count).

### Gate operations and accountability

`SHIFT_ENFORCEMENT` chooses how strictly the gate depends on shifts:

- `required` (default): Security Staff need an on-duty shift to **enter a vehicle**
  or **create a payment**; otherwise `SHIFT_REQUIRED` (or `SHIFT_ENDED` when their
  open shift ran past its end and the grace period).
- `optional`: they may work without one; what they do is still attributed to their
  shift when they have one, and the cash taken outside any shift is reported
  separately (below).

An Administrator is never blocked: the action is an **override**, audited with
`override: true`, with no shift. A payment gets its `shift_id` when it is
**created** and `processed_by_id` when it is **finalized**. A shift ending while a
payment is in flight does not break it: finalization needs the payment's own shift
(or an active one), so a payment created during the shift can still be completed
or cancelled after the shift's end. Only a shift whose cash has been reconciled
(`CLOSED`) refuses further payments (`SHIFT_INVALID_STATE`), and a shift that
still has an open payment cannot be handed over (`SHIFT_HAS_OPEN_PAYMENTS`).

### Cash handover and reconciliation

Payments are simulated, but the accounting is real: a guard "collects" cash and
must hand it over.

1. The guard checks out (or an Admin does it, or the sweeper closes the shift at
   its scheduled end after the grace period). The shift becomes `CHECKED_OUT` and
   Admins are notified (`SHIFT_CASH_DUE`).
2. The Admin — the **cash custodian** — counts the cash and records it
   (`POST /admin/shifts/:id/handover` with `actualCashPaise` and an optional
   note). The system computes the **expected** cash itself from the shift's PAID
   cash payments; the request cannot supply it.
   - `difference = actual − expected`. A difference of zero closes the shift.
   - A non-zero difference **requires a reason** (`CASH_NOTE_REQUIRED`), notifies
     the Admins (`CASH_DISCREPANCY`), and leaves the shift `CHECKED_OUT`: it is
     **not financially closed** until an Admin reviews the difference
     (`POST /admin/shifts/:id/handover/resolve` with a note), which closes it.
3. A handover is recorded once per shift (unique index).

`cashStatus` on a shift reads `NOT_DUE` → `AWAITING_HANDOVER` → `DISCREPANCY` or
`RECONCILED`. **Cash and digital collections are never mixed**: a shift reports
cash transactions and expected cash separately from UPI and card totals and the
number of ₹0 no-charge transactions. `GET /admin/cash/summary` shows, for a date
range, expected vs received cash, digital totals, unresolved differences,
shifts awaiting handover, and two separate lines for cash that belongs to no
handover: **unattributed cash** (taken by Security Staff outside any shift, only
possible while shifts are optional) and **administrator cash** (taken directly by
an Admin, which nobody hands over). `GET /admin/cash/discrepancies` lists what
still needs review, and `GET /admin/shifts/:id/transactions` lists the payments
behind a shift's figures.

### Housekeeping

`shiftService.sweep` settles shifts the clock has overtaken, idempotently: a
scheduled shift nobody checked in to becomes `MISSED` (Admins are notified), and an
open shift past its end plus the grace period is checked out at its scheduled end
so its cash can be collected. It runs every 30 seconds in the server process and
opportunistically when shifts are listed, so a second API instance, a restart or a
quiet period only delays the bookkeeping — the effective status is computed from
the clock regardless.

## Authorization model

| Caller                            | May                                                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anonymous                         | Public overview, receipt verification, login, registration, visitor access                                                                                                                        |
| Visitor (session token)           | Their one session: view, layout, timeline, fee preview, exit request, receipt                                                                                                                     |
| Parking user, not verified        | Own profile, account state, notifications, resubmission after a rejection                                                                                                                         |
| Parking user, verified and active | Everything above plus vehicles, Park Now, own sessions/history/receipts, fee preview, exit request                                                                                                |
| Security Staff                    | Gate: vehicle entry (shift), QR scan/lookup, quote, payments (shift), tracking, map, alerts, own shift, notifications                                                                             |
| Administrator                     | The gate's lookup, scan, quote and payment actions as an audited override (not vehicle entry), plus users, verification, documents, vehicles, slots, shifts, cash, reports, integrity, audit logs |

A user can only reach their own records: someone else's session, payment,
receipt or vehicle looks exactly like one that does not exist (404). Public and
visitor responses never contain another party's personal data.

## Endpoints by area

Prefix `/api/v1` unless noted. "Verified" means a parking user whose account is
`VERIFIED` and active.

### Public, health and auth

| Method | Path                                             | Access                                    |
| ------ | ------------------------------------------------ | ----------------------------------------- |
| GET    | `/health` (no prefix), `/health/ready`           | Public — liveness; database readiness     |
| GET    | `/public/overview`                               | Public, rate-limited — aggregate overview |
| GET    | `/public/receipts/:reference`                    | Public, rate-limited — receipt QR check   |
| POST   | `/auth/login`                                    | Public, rate-limited — Admin, Security    |
| POST   | `/auth/user-login`                               | Public, rate-limited — Student, Staff     |
| POST   | `/auth/register/student`, `/auth/register/staff` | Public, rate-limited                      |
| POST   | `/auth/logout`                                   | Authenticated                             |
| GET    | `/auth/me`                                       | Authenticated — includes `parkNow`        |
| GET    | `/system/status`                                 | Admin                                     |

### Parking operations (Security Staff and Admin)

| Method | Path                                            | Access                                           |
| ------ | ----------------------------------------------- | ------------------------------------------------ |
| POST   | `/parking/check-ins`                            | Security Staff (on-duty shift unless `optional`) |
| GET    | `/parking/vehicle-lookup?vehicleNumber=`        | Security, Admin — owner category only            |
| GET    | `/parking/tracking?q=`                          | Security, Admin                                  |
| GET    | `/parking/map`, `/parking/alerts`               | Security, Admin                                  |
| GET    | `/parking/sessions/active[?exitRequested=true]` | Security, Admin                                  |
| GET    | `/parking/sessions/:n`, `/:n/timeline`          | Security, Admin                                  |
| POST   | `/parking/checkouts/scan`                       | Security, Admin — session QR → ACTIVE session    |
| POST   | `/parking/checkouts/quote`                      | Security, Admin                                  |
| POST   | `/parking/payments`                             | Security (on-duty shift), Admin (override)       |
| POST   | `/parking/payments/:id/process`, `/:id/cancel`  | Security, Admin                                  |
| GET    | `/parking/receipts/:receiptNumber`              | Security, Admin                                  |
| GET    | `/dashboard/summary`                            | Security, Admin (revenue for Admin only)         |

### Student and Campus Staff (`/portal`) and Visitor (`/visitor`)

| Method       | Path                                                                   | Access                                       |
| ------------ | ---------------------------------------------------------------------- | -------------------------------------------- |
| GET          | `/portal/account`, `/portal/profile`                                   | Parking user (any verification state)        |
| PATCH        | `/portal/profile`                                                      | Name, phone, language only                   |
| POST         | `/portal/verification/resubmit`                                        | Rejected parking user                        |
| GET/POST     | `/portal/notifications`, `/notifications/read-all`, `/:id/read`        | Parking user                                 |
| GET          | `/portal/overview`, `/layout`, `/history`                              | Verified — own data only                     |
| GET          | `/portal/receipts`, `/receipts/:receiptNumber`                         | Verified — own receipts                      |
| GET          | `/portal/sessions/active`, `/sessions/:n`, `/sessions/:n/timeline`     | Verified — own sessions                      |
| GET/POST     | `/portal/vehicles`                                                     | Verified — own vehicles                      |
| PATCH/DELETE | `/portal/vehicles/:id`                                                 | Verified                                     |
| POST         | `/portal/vehicles/:id/primary`                                         | Verified                                     |
| GET/POST     | `/portal/park-now/offer`, `/offers`, `/confirm`, `/cancel`             | Verified                                     |
| POST         | `/portal/checkout/quote`                                               | Verified — fee preview, records nothing      |
| POST/DELETE  | `/portal/sessions/:n/exit-request`                                     | Verified — own session                       |
| ALL          | `/portal/checkout/payments*`                                           | **403 `GATE_CHECKOUT_REQUIRED`**             |
| POST         | `/visitor/access`                                                      | Public, rate-limited (vehicle + session no.) |
| GET          | `/visitor/session`, `/layout`, `/timeline`, `/receipt`                 | Visitor token                                |
| POST         | `/visitor/checkout/quote`                                              | Visitor token — fee preview                  |
| POST/DELETE  | `/visitor/exit-request`                                                | Visitor token                                |
| ALL          | `/visitor/checkout/payments*`                                          | **403 `GATE_CHECKOUT_REQUIRED`**             |
| GET/POST     | `/notifications`, `/notifications/read-all`, `/notifications/:id/read` | Any signed-in role                           |

### Security Staff shifts (`/security`)

| Method | Path                        | Access         |
| ------ | --------------------------- | -------------- |
| GET    | `/security/shift`           | Security Staff |
| POST   | `/security/shift/check-in`  | Security Staff |
| POST   | `/security/shift/check-out` | Security Staff |

### Administrator (`/admin`)

| Method                | Path                                                                                                      | Notes                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| GET                   | `/admin/users`, `/users/counts`, `/users/facets`, `/users/:id`                                            | Filters: program, department, batch, semester, verification, status, parking   |
| PATCH/POST            | `/admin/users/:id`, `/users/:id/status`, `/users/:id/verification`                                        | Edit incl. `academic`; activate; verify/reject                                 |
| GET                   | `/admin/users/:id/documents/:documentId[?download=1]`                                                     | Audited view / download, private                                               |
| GET                   | `/admin/users/:id/history`, `/users/:id/receipts`, `/admin/visitors`                                      |                                                                                |
| GET/POST              | `/admin/vehicles`, `/vehicles/:id`, `/vehicles/:id/release`                                               | Ownership lookup and release                                                   |
| POST                  | `/admin/notices`                                                                                          | Notice to a user or an audience                                                |
| GET/POST              | `/admin/security-staff`, `/security-staff/:id/password`                                                   | List, create gate accounts, reset passwords                                    |
| GET/POST/PATCH        | `/admin/shift-templates`, `/shift-templates/:id`                                                          |                                                                                |
| GET/POST              | `/admin/shifts`, `/shifts/roster`, `/shifts/:id`                                                          | Assign, roster, history                                                        |
| PATCH/DELETE/POST     | `/admin/shifts/:id`, `/shifts/:id/check-out`                                                              | Correct, remove (unstarted), check a guard out                                 |
| GET/POST              | `/admin/shifts/:id/transactions`, `/shifts/:id/handover`, `/shifts/:id/handover/resolve`                  | Receive cash; review a difference                                              |
| GET                   | `/admin/cash/summary`, `/cash/discrepancies`                                                              |                                                                                |
| GET/POST/PATCH/DELETE | `/admin/layout`, `/slots`, `/slots/:code[...]`, `/blocks`, `/blocks/:code[...]`, `/zones`, `/zones/:code` | Slot inventory (create, edit, block, enable/disable, archive, restore, delete) |
| GET                   | `/admin/history`, `/analytics`, `/reports/:kind`, `/integrity`, `/audit-logs`                             |                                                                                |

## Web (`apps/web`)

### Routing and guards

```text
/             PublicLayout → PublicHomePage   (no sign-in; aggregate overview only)
/help         PublicLayout → HelpPage         (static Help & FAQ)
/verify/:ref  PublicLayout → ReceiptVerificationPage (receipt QR target)
/login        PublicOnlyRoute                 (signed-in users are sent to their requested page or role home)
/admin/*      RequireAuth → AppShell → RequireRole(ADMIN)
              dashboard, live, finder, sessions/:n, receipts/:n, account,
              slots, history, analytics, reports, integrity, audit-logs
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

The screens for Student / Campus Staff / Visitor access, shifts, cash handover,
the Admin users area and the camera QR scanner are a separate step. They must
follow the contracts above: read the verification status from the server each
time it matters, never keep the object received at sign-in; do not offer payment to
users or visitors; use the session QR (never the receipt QR) at the gate.

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

### Charts

Analytics charts are hand-built SVG (`src/components/charts`) — no chart
library. Series colours are the `--chart-1` / `--chart-2` tokens, a
categorical pair validated for colour-vision deficiency on light surfaces.
Columns are thin with a rounded data end and a 2 px gap between stacked
segments; only the peak is labelled. Every chart has a legend (two or more
series), a tooltip on hover and on keyboard focus (arrow keys, Home, End) and
a "Show as table" view, so no value depends on colour or hovering.

## Testing

`npm test` runs the API integration tests (Vitest + Supertest against a real
PostgreSQL) and the web tests. The suites that protect the rules above:

| Suite                                    | Protects                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `verification-consistency`               | Admin decision ⇒ the old session sees the new status; Park Now allowed/blocked; staff too |
| `academic`                               | Program/semester/batch rules, filters, duplicate USN, Admin-only changes                  |
| `vehicle-ownership`                      | One owner per plate, claim/release/primary, history stays with the right owner            |
| `gate-checkout`                          | Users and visitors cannot pay/finalize; exit request never frees the slot; QR scan rules  |
| `shifts`, `shifts-optional`              | Templates, roster, check-in/out, conflicts, MISSED/sweeper, enforcement modes             |
| `cash`                                   | Payment → staff → shift, cash vs digital, handover, mismatch note, review, closing        |
| `slots-lifecycle`                        | New slots join allocation, disabled blocks drain, seed idempotence                        |
| `documents`, `privacy-and-notifications` | Audited document view/download, masked public data, notification delivery                 |
| `authorization-matrix`                   | Every route × every kind of caller                                                        |

Each test run uses the disposable `TEST_DATABASE_URL` database described above.

## Scope boundary

Implemented: the parking lifecycle, the smart and management modules,
Student / Campus Staff / Visitor access, gate-controlled checkout with the
session QR, Security Staff shifts and cash reconciliation, all behind the
API described above.

Not implemented: the web screens for Student / Campus Staff / Visitor access, shifts,
cash handover and the camera scanner (a separate step); demo-data tools and the
Android WebView APK (Phase 4). No real payment gateway, ML/AI, chatbot, advance
reservation, ERP integration, automatic semester promotion or turn-by-turn
navigation exist, by design.
