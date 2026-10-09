# CPVTS — Campus Parking & Vehicle Tracking System

CPVTS is a rule-driven campus parking and parked-vehicle tracking system. This
repository is prepared for **Bharatesh Institute of Technology, Belagavi** as an
independent demonstration — it is not an official institutional deployment.
Branding and the institution name are configurable per deployment.

> **Status: Phase 3 — Smart & Management.** On top of the Phase 1 foundation
> (authentication, schema, design system, four languages, hosting setup) and
> the Phase 2 parking lifecycle (vehicle entry → explainable automatic slot
> allocation with a temporary hold → tracking and parking map → checkout →
> official fee → simulated payment → finalization → receipt with verification
> QR → slot release), administrators now have the Parking Integrity Engine,
> session timelines (audit replay), rule-based alerts, searchable parking
> history, daily analytics, CSV reports, slot management (block / unblock,
> allocation priority, block coordinates) and audit logs. The Android WebView
> APK and demo-data tooling (Phase 4) are **not** part of this phase.
>
> **Parking Users, Security shifts and the finalized backend.** Students
> (with Program, Department, Admission Year and Semester) and Campus Staff
> register with an identity document, are verified by an administrator, add
> their vehicles and use **Park Now** (the server picks and holds the slot with
> the same deterministic allocation as the security desk, the user confirms).
> They can tell the gate they are _ready to exit_, but **checkout is
> gate-controlled**: only Security Staff or an Administrator scans the session
> QR, takes the (simulated) payment, finalizes the session and releases the
> slot. Visitors get a short-lived token for their one session from the number
> on their slip. Security Staff work in **shifts**: every payment is tied to the
> guard and the shift that took it, and an Administrator, as cash custodian,
> receives and reconciles each shift's cash. Administrators manage users,
> verification, vehicles, shifts, cash and the whole slot inventory. A user's
> verification status has one source of truth — the database row, read on every
> request — so Admin and the user always see the same state. See
> `docs/ARCHITECTURE.md`; the web screens for these flows are a separate step.

The app opens on a **public parking overview** at `/` — free two-wheeler and
four-wheeler space counts, parking blocks (with Google Maps links once real
coordinates are configured), fee rules, Help & FAQ and a language selector. It
shows aggregate information only: no vehicle numbers, slot assignments,
sessions, revenue, audit logs or users. Admin and Security Staff sign in at
`/login`; everything under `/admin` and `/staff` requires sign-in.

---

## Contents

- [Parking workflow](#parking-workflow)
- [Project structure](#project-structure)
- [Requirements](#requirements)
- [Local setup](#local-setup)
- [Environment variables](#environment-variables)
- [Supabase / PostgreSQL setup](#supabase--postgresql-setup)
- [Prisma setup and migrations](#prisma-setup-and-migrations)
- [Development commands](#development-commands)
- [Production build](#production-build)
- [Deployment: Vercel (web)](#deployment-vercel-web)
- [Deployment: Render (API)](#deployment-render-api)
- [Docker](#docker)
- [Further documentation](#further-documentation)

---

## Parking workflow

| Screen (role)                              | What it does                                                                                                                                                                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vehicle entry** (Security Staff)         | Vehicle number, type, owner category and entry hour. The server validates, rejects duplicates and full zones, and assigns the best slot, explaining why (correct zone, available, not blocked, best score, final availability verified). Shows the session number and entry QR. |
| **Vehicle finder** (both)                  | Search by vehicle number, slot ID, session number or scanned entry QR. Shows block, exact slot, entry time, live duration and estimated fee, with _Locate on map_, _Open in Google Maps_ (when coordinates are configured), _View session_ and _Check out_.                     |
| **Live parking** (both)                    | Logical map of every zone (available / occupied / blocked), slot details, search-to-highlight, and the parked-vehicle board. Refreshes every 30 s.                                                                                                                              |
| **Vehicle exit** (Security Staff)          | Find the vehicle, choose the exit hour, see the fee breakdown, pay with simulated UPI / Card / Cash (or _No charge_ for ₹0), then view the receipt.                                                                                                                             |
| **Receipt** (both)                         | Branded receipt with fee breakdown, payment status, transaction ID and verification QR. Print or download as PNG.                                                                                                                                                               |
| **Verify** (public, `/verify/<reference>`) | Opened by scanning the receipt QR. Validates the receipt against the database and shows a safe summary.                                                                                                                                                                         |
| **Dashboards**                             | Total / occupied / available / blocked slots, occupancy % (overall, 2W, 4W), currently parked, vehicles today; admins also see today's fees.                                                                                                                                    |
| **Alerts** (both)                          | Rule-based: zone full, zone nearly full (`ALERT_NEARLY_FULL_PERCENT`), vehicles parked longer than `ALERT_LONG_DURATION_HOURS`, blocked slots. Shown on dashboards and Live parking; refreshes every 30 s.                                                                      |
| **Session timeline** (both)                | On every session page: each recorded step (check-in, slot assigned with its score, checkout, payment, finalization, receipt, slot release) with time and operator, replayed from the audit log.                                                                                 |
| **Slot management** (Admin)                | Block an available slot with a reason (excluded from allocation) and unblock it, set allocation priority 0–100, and record or remove real block coordinates. Every change is audited.                                                                                           |
| **History** (Admin)                        | Every session, filterable by vehicle number, slot, vehicle type, owner category, status and date range; fees come from finalized transactions. Filters live in the URL.                                                                                                         |
| **Analytics** (Admin)                      | One campus day: vehicles entered and completed, average duration, busiest entry hour, revenue (by vehicle type and owner category), hourly occupancy and entries charts (each with a table view), zone usage and most-used slots.                                               |
| **Reports** (Admin)                        | CSV downloads (UTF-8 with BOM, spreadsheet-safe) of parking history, transactions, daily revenue and vehicles for a date range (default: last 30 days, at most 366).                                                                                                            |
| **Integrity** (Admin)                      | Read-only Parking Integrity Engine report: occupied slots ↔ active sessions, one active session per vehicle, no expired holds, completed sessions and paid payments have receipts, receipts match transactions, no stuck payments; plus recently rejected operations.           |
| **Audit logs** (Admin)                     | Filter by action, record type, record ID, username and date range; each entry shows actor, record and details.                                                                                                                                                                  |

### Parking users, gate checkout and shifts (API)

These flows are implemented and tested in the API (`/auth`, `/portal`, `/visitor`,
`/parking`, `/security`, `/admin`, `/notifications`); the web screens for them are a
separate step. Endpoint tables are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#endpoints-by-area).

| Flow                           | Who                                | What the backend does                                                                                                                                                                                                                                                               |
| ------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Register and get verified**  | Student, Campus Staff → Admin      | Registration creates a `PENDING` account with an identity document (Students also give Program, Department, Admission Year and Semester; the batch, e.g. 2024–2027, is derived). Admin approves, or rejects with a reason; the user is notified and may resubmit after a rejection. |
| **Account state**              | Student, Campus Staff              | `GET /portal/account` and `GET /auth/me` return the verification status and `parkNow` eligibility read from the database on that request, never from the sign-in token, so an Admin decision shows on the next call.                                                                |
| **Vehicles**                   | Student, Campus Staff, Admin       | Up to 5 per user, one primary, one active owner per normalized plate. Add, edit the label (number and type until the vehicle has history), set primary, remove. Admin looks up who owns a plate and can release it.                                                                 |
| **Park Now**                   | Verified Student, Campus Staff     | The server ranks the free slots with the desk's allocation, **holds** one (`AVAILABLE → HELD`), and the user confirms (`HELD → OCCUPIED`). It starts the same parking session as a desk entry; it is not an advance reservation.                                                    |
| **Ready to exit**              | Student, Campus Staff, Visitor     | Flags the active session (`EXIT_REQUESTED`) so the gate sees it. Nothing else changes: the slot stays occupied and no payment is made. It can be withdrawn. A fee estimate is available without creating a payment.                                                                 |
| **Gate checkout**              | Security Staff (on shift), Admin   | `POST /parking/checkouts/scan` takes the scanned **session QR**, finds the active session and checks vehicle, slot and session agree. The QR alone completes nothing: the guard then quotes, takes the simulated payment and finalizes. Receipt QRs are never accepted.             |
| **Visitor**                    | Visitor                            | Vehicle number + session number from the slip give a token that is valid for that one session only (`VISITOR_ACCESS_HOURS`). Visitors view, request exit and open the receipt; they cannot pay or finalize.                                                                         |
| **Shifts**                     | Admin assigns; Security Staff work | Templates (Morning / Evening / Night are seeded), a daily roster, shift history. A guard checks in and out. With `SHIFT_ENFORCEMENT=required` (default) vehicle entry and checkout payments need an on-duty shift; an Administrator can always act, flagged as an override.         |
| **Cash handover**              | Admin (cash custodian)             | After check-out the Admin counts the cash handed over; the system compares it with the shift's cash payments. A difference needs a reason and keeps the shift open until an Admin reviews it. Digital payments are reported separately.                                             |
| **Users, documents, vehicles** | Admin                              | Filter by program, department, batch, semester, verification, account status and parking status; approve or reject; correct academic details; view or download an identity document (each access audited); vehicle ownership lookup.                                                |

Rules the backend enforces, independent of any screen:

- **One verification state.** The `Admin = VERIFIED, Student = NOT VERIFIED` mismatch
  cannot happen server-side: every authenticated request reloads the account and its
  profile, and every verified-only check goes through one function
  (`parkNowEligibilityOf`). Authenticated responses are `Cache-Control: no-store`.
- **Gate-controlled final checkout.** Students, Staff and Visitors cannot pay for or
  finalize their own checkout; those routes answer `403 GATE_CHECKOUT_REQUIRED`.
- **Two different QR codes.** The _session QR_ (created at entry) is the only code the
  checkout accepts; the _receipt QR_ only verifies a finished receipt. Neither contains
  personal data.
- **Accountable payments.** A payment records the guard who finalized it and the shift
  it belongs to. A shift ending does not break a payment already in flight.
- **Public data stays aggregate.** Public receipt verification masks the plate
  (`KA****1234`); the public overview exposes no vehicles, sessions or users.
- **Safe slot changes.** Deactivating a block or zone stops new allocations and cancels
  holds, but vehicles already parked there keep their session and can check out.

Official fees (configurable in the `settings` table, seeded by `db:seed`):
Staff free; Student first 2 hours free then ₹10/h (2W) or ₹20/h (4W); Visitor
₹20/h (2W) or ₹40/h (4W). Duration = exit hour − entry hour (whole hours).
Example: Student 2W 09:00 → 13:00 = ₹20.

Payments are **simulated** (test/demo): no gateway is called and no money
moves. This is stated in the UI, on receipts and in the database
(`payments.is_simulated`).

## Project structure

npm workspaces monorepo:

```text
.
├── apps/
│   ├── api/                      Node.js + Express + TypeScript REST API
│   │   ├── prisma/
│   │   │   ├── schema.prisma     Database schema (single source of truth)
│   │   │   └── migrations/       SQL migrations (committed)
│   │   ├── prisma.config.ts      Prisma CLI configuration
│   │   ├── src/
│   │   │   ├── config/           Validated environment configuration
│   │   │   ├── db/               Prisma client, transactions (only DB-aware layer)
│   │   │   ├── lib/              Errors, logger
│   │   │   ├── middleware/       Authentication, role authorisation, validation, errors, request ID/logging, rate limiting
│   │   │   ├── modules/          Feature modules (routes → controller → service → repository)
│   │   │   │   ├── auth/         Login, logout, current user, JWT, password hashing
│   │   │   │   ├── accounts/     Registration, verification state (single source of truth), academic profile
│   │   │   │   ├── users/        Admin user management, vehicle ownership lookup, identity documents
│   │   │   │   ├── portal/       Student / Campus Staff: vehicles, Park Now, exit request, history, receipts
│   │   │   │   ├── visitor/      Visitor access token and the visitor's one session
│   │   │   │   ├── shifts/       Security shifts, roster, cash handover and reconciliation
│   │   │   │   ├── notifications/ In-app notifications for every signed-in role
│   │   │   │   ├── management/   Admin: slot inventory, integrity, history, analytics, reports, audit logs
│   │   │   │   ├── audit/        Audit-log repository and action names
│   │   │   │   ├── parking/      Check-in (one session factory), allocation, slot holds, tracking, map,
│   │   │   │   │                 QR scan, gate checkout, mock payment, finalization, receipts
│   │   │   │   ├── fees/         The single authoritative fee engine + fee schedule
│   │   │   │   ├── dashboard/    Live operational summary
│   │   │   │   ├── public/       Public overview and receipt verification
│   │   │   │   ├── settings/     Settings repository (fee schedule)
│   │   │   │   ├── system/       Admin-only system status
│   │   │   │   └── health/       /health and /health/ready probes
│   │   │   ├── routes/           /api/v1 router composition
│   │   │   ├── scripts/          CLI scripts (seed)
│   │   │   ├── app.ts            Express app factory
│   │   │   └── server.ts         Process entry point, graceful shutdown
│   │   ├── test/                 Integration tests (Vitest + Supertest + PostgreSQL)
│   │   └── Dockerfile
│   └── web/                      React + TypeScript + Vite client
│       ├── src/
│       │   ├── app/              Router, route paths, role navigation, error pages
│       │   ├── components/
│       │   │   ├── ui/           shadcn/ui design-system components
│       │   │   ├── layout/       App shell, sidebar, header, menus
│       │   │   ├── feedback/     Loading, error, empty states, status badges
│       │   │   └── branding/     Brand mark, institution notice
│       │   ├── config/           Runtime config and branding (from VITE_* env)
│       │   ├── features/         auth, dashboard, parking, operations, admin, public, account
│       │   ├── hooks/            Shared hooks
│       │   ├── i18n/             i18next setup and en/kn/hi/mr catalogues
│       │   ├── lib/              API client, utilities
│       │   └── styles/           Tailwind CSS + design tokens
│       ├── Dockerfile, nginx.conf
│       └── components.json       shadcn/ui configuration
├── packages/
│   └── shared/                   Contracts used by both apps: roles, locales,
│                                 zod validation schemas, API error/response types
├── docs/                         Architecture and deployment guides
├── docker-compose.yml            Local PostgreSQL (+ optional full stack)
├── render.yaml                   Render Blueprint (API)
├── vercel.json                   Vercel configuration (web)
└── .github/workflows/ci.yml      Lint, typecheck, test, build
```

## Requirements

- **Node.js 22.12+** and npm 10+ (`.nvmrc` pins Node 22)
- **PostgreSQL 14+** — the shared **Supabase** database is the normal development
  database ([setup](#supabase--postgresql-setup)); a local PostgreSQL (Docker:
  `docker compose up -d db`) is for the automated tests and offline experiments
- Docker (optional) for that disposable test database and the containerised stack

## Local setup

```bash
# 1. Install dependencies (all workspaces)
npm install

# 2. Configure environment files
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
#    Edit apps/api/.env: set DATABASE_URL (and DIRECT_URL if needed) to the shared
#    Supabase database (see "Supabase / PostgreSQL setup"), JWT_SECRET (see below)
#    and the SEED_* passwords.

# 3. Apply the committed migrations to that database (never reset it)
npm run db:migrate:deploy

# 4. Create the initial accounts, the baseline parking layout, the fee schedule and
#    the starter shift templates (idempotent: existing data is never overwritten)
npm run db:seed

# 5. Run API (http://localhost:4000) and web (http://localhost:5173)
npm run dev
```

To run the automated tests you also need a disposable local database (they
truncate every table, so never point them at Supabase):

```bash
docker compose up -d db
docker compose exec db createdb -U cpvts cpvts_test    # once
npm test
```

Generate a JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Open http://localhost:5173 for the public overview. Choose **Admin / Staff
login** (or go to `/login`) and sign in with the seeded username and password.
Admins land on `/admin`, Security Staff on `/staff`.

The seed is idempotent and never overwrites existing data. Besides the
accounts it creates, only if absent, the minimum layout from Master Blueprint
§5 (Two-Wheeler block T-01…T-10, Four-Wheeler block F-01…F-05, all available,
no GPS coordinates), the official fee schedule (`settings` key
`parking.feeSchedule`) and three starter Security Staff shift templates
(Morning 08:00–16:00, Evening 16:00–00:00, Night 00:00–08:00) that Admin can
edit.

> In `.env` files, quote values containing `#` (e.g. `SEED_ADMIN_PASSWORD="Pa#ss..."`),
> otherwise everything after `#` is treated as a comment.

## Environment variables

Every variable is validated at startup; the API refuses to start with an
invalid configuration and lists the problems.

### API — `apps/api/.env` (see `apps/api/.env.example`)

| Variable                                                   | Required  | Default                   | Purpose                                                                                                        |
| ---------------------------------------------------------- | --------- | ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                 |           | `development`             | `development`, `test` or `production`                                                                          |
| `APP_ENV`                                                  |           | `NODE_ENV`                | Display name of the environment (e.g. `staging`)                                                               |
| `PORT` / `HOST`                                            |           | `4000` / `0.0.0.0`        | Listen address                                                                                                 |
| `DATABASE_URL`                                             | ✔         |                           | PostgreSQL connection used by the running API                                                                  |
| `DIRECT_URL`                                               |           | `DATABASE_URL`            | Connection used by Prisma CLI for migrations                                                                   |
| `JWT_SECRET`                                               | ✔         |                           | ≥ 32 random characters; signs access tokens                                                                    |
| `JWT_EXPIRES_IN_SECONDS`                                   |           | `28800`                   | Access-token lifetime (8 h, one shift)                                                                         |
| `JWT_ISSUER` / `JWT_AUDIENCE`                              |           | `cpvts-api` / `cpvts-web` | Token claims checked on every request                                                                          |
| `FRONTEND_URL`                                             | prod*     |                           | Web app URL; default CORS origin                                                                               |
| `CORS_ORIGINS`                                             | prod*     |                           | Comma-separated allowed origins                                                                                |
| `TRUST_PROXY`                                              |           | `0`                       | Reverse-proxy hops to trust (Render: `1`)                                                                      |
| `LOGIN_RATE_LIMIT_WINDOW_MINUTES` / `LOGIN_RATE_LIMIT_MAX` |           | `15` / `10`               | Failed sign-ins allowed per IP per window                                                                      |
| `CAMPUS_TIMEZONE`                                          |           | `Asia/Kolkata`            | Campus time zone: "today" and the current hour                                                                 |
| `SLOT_HOLD_SECONDS`                                        |           | `15`                      | Lifetime of the temporary slot hold during allocation                                                          |
| `ALERT_NEARLY_FULL_PERCENT`                                |           | `90`                      | Zone occupancy % that raises a "nearly full" alert                                                             |
| `ALERT_LONG_DURATION_HOURS`                                |           | `8`                       | Active-session hours that raise a "long duration" alert                                                        |
| `PUBLIC_RATE_LIMIT_PER_MINUTE`                             |           | `120`                     | Requests per minute per IP on public endpoints                                                                 |
| `PARK_NOW_HOLD_SECONDS`                                    |           | `90`                      | How long a Park Now allocation is held for confirmation                                                        |
| `INSTITUTION_EMAIL_DOMAINS`                                |           | _(any)_                   | Restrict Student / Staff registration e-mail domains                                                           |
| `REGISTRATION_RATE_LIMIT_PER_HOUR`                         |           | `10`                      | Registrations per IP per hour                                                                                  |
| `VISITOR_ACCESS_HOURS`                                     |           | `12`                      | Lifetime of a visitor's access to their one session                                                            |
| `SHIFT_ENFORCEMENT`                                        |           | `required`                | `required`: gate operations need an on-duty shift; `optional`: Security Staff may work without one (see below) |
| `SHIFT_EARLY_CHECK_IN_MINUTES`                             |           | `60`                      | How long before its start a guard may check in                                                                 |
| `SHIFT_OVERRUN_MINUTES`                                    |           | `30`                      | Grace after a shift's end to finish an in-flight job                                                           |
| `SEED_ADMIN_*`, `SEED_STAFF_*`                             | seed only |                           | Initial accounts for `db:seed`                                                                                 |
| `TEST_DATABASE_URL`                                        | tests     | local `cpvts_test`        | Disposable database for the API tests (never Supabase)                                                         |

\* In production at least one of `CORS_ORIGINS` or `FRONTEND_URL` is required.

`SHIFT_ENFORCEMENT=required` (the default) means a Security Staff member must be
checked in to a shift that is under way to enter a vehicle or take a payment;
Administrators always can (an audited override). Use `optional` while the
roster is not in use yet: guards may then work without a shift, what they do is
still attributed to their shift when they have one, and cash taken outside any
shift is reported separately.

### Web — `apps/web/.env.local` (see `apps/web/.env.example`)

`VITE_*` values are **public** and embedded in the JavaScript bundle at build
time. Never put secrets in them.

| Variable                      | Required  | Purpose                                                                           |
| ----------------------------- | --------- | --------------------------------------------------------------------------------- |
| `VITE_API_BASE_URL`           | ✔ (build) | Primary API base URL, e.g. `https://cpvts-api.onrender.com` (no trailing slash)   |
| `VITE_API_URL`                |           | Backwards-compatible alternative for API base URL                                 |
| `VITE_BRAND_SHORT_NAME`       |           | Short product name (default `CPVTS`)                                              |
| `VITE_BRAND_PRODUCT_NAME`     |           | Full product name                                                                 |
| `VITE_BRAND_INSTITUTION_NAME` |           | Institution the deployment is prepared for                                        |
| `VITE_BRAND_SHOW_DEMO_NOTICE` |           | `true` shows "independent demonstration, not an official system" (default `true`) |
| `VITE_DEFAULT_LOCALE`         |           | `en`, `kn`, `hi` or `mr` (default `en`)                                           |

Branding defaults are defined once in `apps/web/src/config/branding-defaults.ts`.

## Supabase / PostgreSQL setup

CPVTS uses a standard PostgreSQL connection; Supabase is only the host. Any
PostgreSQL 14+ server works by changing the URLs.

**The shared Supabase database is the normal development database.**
`apps/api/.env` points `DATABASE_URL` at it, and `npm run dev`, the migrations
and the seed all run against it. Its data is the project's development data, so:

- Prisma (`schema.prisma` + `migrations/`) is the only way its structure changes.
  Never create tables, columns or constraints by hand in the Supabase dashboard.
- Never reset, drop or truncate it. Use `npm run db:migrate:deploy` against it —
  never `prisma migrate reset` or `prisma db push --force-reset`.
- The automated tests **truncate every table**, so they never run against it
  (see [Development commands](#development-commands)).

1. Create a Supabase project (choose a region near users, e.g. **Mumbai / ap-south-1**)
   and note the database password.
2. Open **Connect** in the Supabase dashboard and copy the **Session pooler**
   connection string (IPv4-compatible, port **5432**), e.g.
   `postgresql://postgres.<project-ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`.
   URL-encode special characters in the password.
3. Set the two URLs (the runtime driver and Prisma CLI read SSL options differently):

   ```dotenv
   # Runtime (node-postgres): TLS with libpq semantics
   DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true
   # Migrations (Prisma CLI)
   DIRECT_URL=postgresql://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require
   ```

   For full certificate verification, download the CA certificate from
   **Database → Settings → SSL Configuration** and use
   `?sslmode=verify-full&sslrootcert=/path/to/prod-ca-2021.crt` in `DATABASE_URL`.
   The **Transaction pooler** (port 6543) can also be used for `DATABASE_URL`;
   migrations must then use the session pooler or direct connection via `DIRECT_URL`.

4. Apply migrations and seed the first accounts from your machine:

   ```bash
   npm run db:migrate:deploy
   npm run db:seed
   ```

5. Check that the app really talks to the database and that nothing drifted
   (read-only; run in `apps/api`):

   ```bash
   npx prisma validate
   npx prisma migrate status
   npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
   ```

   `migrate status` must say "Database schema is up to date!" and `migrate diff`
   must report no difference (exit code 0). `GET /health/ready` then confirms the
   running API can reach the database.

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#supabase-postgresql) for details.

## Prisma setup and migrations

- Schema: `apps/api/prisma/schema.prisma`. Migrations: `apps/api/prisma/migrations/`
  (always committed). Generated client: `apps/api/src/generated/prisma` (git-ignored,
  regenerated by `dev`, `build`, `typecheck` and `test`).
- The initial migration creates `users`, `vehicles`, `parking_blocks`,
  `parking_zones`, `parking_slots`, `parking_sessions`, `payments`, `receipts`,
  `audit_logs` and `settings`, with foreign keys, unique constraints, indexes,
  partial unique indexes (one active session per vehicle and per slot, one paid
  payment per session) and CHECK constraints (hour ranges, non-negative amounts,
  consistent completed sessions). Later migrations add the parking-user tables
  (profiles with their academic details, identity documents, notifications, Park
  Now offers) and, in `20261009100000_backend_finalization`, the security-shift
  tables (`shift_templates`, `security_shifts`, `cash_handovers`), the session
  owner snapshot, the exit-request flag and the payment operator/shift columns.
  That migration backfills existing rows (session owners, payment operators) and
  adds CHECK constraints for the academic profile, shift windows and cash handovers.

| Task                                                      | Command                                   |
| --------------------------------------------------------- | ----------------------------------------- |
| Create a migration after editing the schema (development) | `npm run db:migrate -- --name <change>`   |
| Apply pending migrations (CI/production)                  | `npm run db:migrate:deploy`               |
| Show migration status                                     | `npm run db:migrate:status -w @cpvts/api` |
| Regenerate the client                                     | `npm run db:generate`                     |
| Seed accounts, baseline layout, fees (development)        | `npm run db:seed`                         |
| Seed accounts, baseline layout, fees (production)         | `npm run db:seed:deploy -w @cpvts/api`    |
| Browse data                                               | `npm run db:studio`                       |

Never edit an applied migration; create a new one. Constraints that the Prisma
schema language cannot express are added as SQL inside the migration.

## Development commands

Run from the repository root:

| Command                                   | Description                                       |
| ----------------------------------------- | ------------------------------------------------- |
| `npm run dev`                             | Shared package (watch) + API (watch) + web (Vite) |
| `npm run dev:api` / `npm run dev:web`     | Run one app                                       |
| `npm run lint`                            | ESLint                                            |
| `npm run format` / `npm run format:check` | Prettier                                          |
| `npm run typecheck`                       | TypeScript (strict) for all workspaces            |
| `npm test`                                | API integration tests + web tests                 |

API tests run against a real PostgreSQL database. They default to
`postgresql://cpvts:cpvts@localhost:5432/cpvts_test`; override with
`TEST_DATABASE_URL`. The test database is migrated and **truncated**, so it must
be a disposable local (or CI) database whose name contains `test`. The suite
refuses to start against anything else — including the shared Supabase
database — and pins both `DATABASE_URL` and `DIRECT_URL` to the test database,
so the connection in `apps/api/.env` is never used by a test run.

## Production build

```bash
npm ci
npm run build                  # shared → api (dist/) → web (apps/web/dist/)
npm run db:migrate:deploy      # with production DATABASE_URL / DIRECT_URL
npm run start:api              # node apps/api/dist/server.js
```

`VITE_API_BASE_URL` (or `VITE_API_URL`) must be set when building the web app. The web build output in
`apps/web/dist` is a static site that any static host can serve (single-page
app: unknown paths fall back to `index.html` via `vercel.json`).

Health checks: `GET /health` (liveness) and `GET /health/ready` (database
connectivity; returns 503 when unavailable).

## Deployment: Vercel (web)

1. Import the repository in Vercel. Keep **Root Directory** as the repository
   root (`.`) — `vercel.json` sets the install/build commands and output directory.
2. Add environment variables: `VITE_API_BASE_URL` (the Render API URL, e.g. `https://cpvts-api.onrender.com`)
   and any `VITE_BRAND_*` overrides.
3. Deploy. `vercel.json` rewrites all routes to `index.html` for client routing and sets immutable asset caching.
4. Add the Vercel URL to the API's `CORS_ORIGINS` / `FRONTEND_URL`.

## Deployment: Render (API)

1. In Render choose **New → Blueprint** and select this repository; `render.yaml`
   defines the `cpvts-api` web service (build, start, health check, env vars).
2. Fill in the prompted variables: `DATABASE_URL`, `DIRECT_URL` (Supabase),
   `FRONTEND_URL` and `CORS_ORIGINS` (the Vercel URL, e.g. `https://<app>.vercel.app,https://*.vercel.app,capacitor://localhost,http://localhost`). `JWT_SECRET` is generated.
3. Deploy. The start command applies pending migrations (`prisma migrate deploy`) before starting.
4. Seed the first accounts once from your machine against the production
   database (`npm run db:seed` with production URLs and `SEED_*` values), or from
   the Render Shell with `npm run db:seed:deploy -w @cpvts/api`.

Full guide: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Docker

```bash
docker compose up -d db              # local PostgreSQL for the automated tests (not the dev database)
docker compose --profile app up --build   # self-contained stack: its own PostgreSQL + API (:4000) + web (:8080)
docker compose exec api npm run db:seed:deploy   # with SEED_* variables set via -e
```

`apps/api/Dockerfile` and `apps/web/Dockerfile` are production images built
from the repository root; the API container applies migrations on start.

## Further documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — layering, authentication,
  authorisation, i18n, branding, data model, and how later phases plug in.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Supabase, Render, Vercel, Docker,
  Android WebView considerations, production checklist.
