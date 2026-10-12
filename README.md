# Medicar — Pharmacy Management System (V1)

An internal, multi-branch pharmacy operations system: medicines and batches,
branch inventory with an immutable stock ledger, purchasing and receiving,
point of sale with FEFO, refunds and voids, branch transfers, staff with
role- and branch-based permissions, alerts, reports and a full audit trail.

- **Frontend:** React (JavaScript/JSX, CSS), Vite, React Router, Recharts, lucide icons
- **Backend:** Node.js, Express, PostgreSQL via `pg` with explicit SQL (no ORM)
- **Tests:** Jest (+ Supertest for the API, Testing Library for the UI)

The backend and database are authoritative for every business rule; the UI
only previews and hides unavailable actions.

---

## Requirements

- Node.js 20 or newer (developed on Node 24)
- npm 10 or newer
- PostgreSQL 14 or newer (developed on PostgreSQL 16)

## Repository layout

```text
server/                 Express API
  migrations/           Versioned SQL migrations (node-pg-migrate)
  seeds/                Reference data (roles, permissions, settings, categories, help)
  scripts/              migrate, seed, seed-demo, create-owner
  src/
    config/ database/ errors/ middleware/ auth/ permissions/ validators/ utils/
    modules/<domain>/   routes -> controller -> service -> repository
  tests/unit/ tests/integration/
client/                 React SPA
  src/api/ context/ hooks/ components/ layouts/ pages/ permissions/ styles/ utils/
docs/API.md             API reference
docker-compose.yml      Optional local PostgreSQL
```

## Installation

```bash
npm install            # installs both workspaces
```

## Environment setup

```bash
cp server/.env.example server/.env
```

Edit `server/.env`. The important values:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection for the app |
| `TEST_DATABASE_URL` | Separate database used by the test suite (it is truncated during tests) |
| `APP_BASE_URL` | Public URL of the web app, used in password links |
| `BUSINESS_TIMEZONE` | Business calendar for "today", expiry and reports (default `Africa/Addis_Ababa`) |
| `TRUST_PROXY` | Set to `1` behind a reverse proxy so client IPs and Secure cookies work |
| `SMTP_*` | Optional. Without `SMTP_HOST`, reset and setup links are printed to the server console |

## Database setup

Create the databases (any method). With a local PostgreSQL and peer authentication:

```bash
createdb medicar_dev
createdb medicar_test
```

Or start the bundled container and use the TCP URLs from `.env.example`:

```bash
docker compose up -d
```

### Migrations

```bash
npm run migrate                       # apply pending migrations
npm run migrate:down --workspace server   # roll back the latest migration
```

Migrations are plain SQL files in `server/migrations`. Tests migrate the test
database automatically.

### Seeds

```bash
npm run seed            # roles, permissions, role defaults, settings, categories, help articles
npm run create-owner    # interactive: creates the first Owner account
```

`npm run seed` is idempotent and never creates users, stock or financial data.
For non-interactive provisioning set `OWNER_NAME`, `OWNER_EMAIL` and
`OWNER_PASSWORD` before `npm run create-owner`.

### Demo data (development only)

```bash
npm run seed:demo --workspace server
```

Creates two demo branches, demo staff, medicines, suppliers, a received
purchase, sales, a refund, a void and a shipped transfer through the real
services. It refuses to run in production and requires an empty catalog.
Demo staff sign in with the password printed by the script.

## Running in development

```bash
npm run dev:server      # API on http://localhost:4000
npm run dev:client      # Web app on http://localhost:5173 (proxies /api to the server)
```

Open http://localhost:5173 and sign in with the Owner account.

## Running tests

```bash
npm test                              # server and client suites
npm test --workspace server           # API, services, transactions, security
npm run test:unit --workspace server
npm test --workspace client
```

The server suite runs against `TEST_DATABASE_URL`, which it truncates and
re-seeds between tests. Never point it at a database with real data.

## Production build

```bash
npm run build           # builds the client into client/dist
NODE_ENV=production npm start
```

In production the API serves the built client from the same origin, so
session cookies stay first-party. Run it behind HTTPS (TLS-terminating proxy
with `TRUST_PROXY=1`).

## Security configuration

- **Sessions:** server-side, random 256-bit tokens; only SHA-256 hashes are
  stored. Cookies are `HttpOnly`, `SameSite=Strict`, `Secure` in production,
  and browser-session scoped (no "remember me", no inactivity timeout).
- **CSRF:** every state-changing request needs the `X-CSRF-Token` header
  matching a token bound to the session, and must be JSON.
- **Passwords:** bcrypt (`BCRYPT_ROUNDS`, default 12). Reset and account-setup
  links are hashed, single-use and expiring; using one signs out all sessions.
- **Brute force:** failed logins are rate limited per email and per IP and
  recorded in login history.
- **Authorization:** every request recomputes effective permissions (role
  defaults plus user overrides; Owner unrestricted) and checks branch access.
  Cost and profit fields are removed by the server for users without the
  financial permissions, including in exports and search.
- **Data integrity:** database triggers make stock movements, audit logs,
  login history, sale lines, refunds and receiving records append-only, block
  deletion of business records, keep batch cost and branch code immutable,
  and forbid negative stock and over-receiving.
- **Secrets:** never committed. Audit records strip any password/token/secret
  fields; system information exposes no infrastructure details.

## Key business rules (summary)

- Inventory changes only through the stock ledger; every change writes an
  immutable movement with before/after quantities.
- Sales use FEFO (earliest non-expired batch first), branch selling prices,
  a prorated sale discount, per-line tax from a settings snapshot and exact
  single-method payment — all recalculated by the server inside one
  transaction with row locks.
- Critical POSTs accept an `Idempotency-Key` header; retries never duplicate
  business transactions.
- Document numbers (`SAL-2026-000001`, `PUR-`, `REF-`, `TRF-`, `STK-`) are
  organization-wide, year-aware, gapless and never reused.

See the in-app Help center for user-facing explanations and
[docs/API.md](docs/API.md) for the API reference.
