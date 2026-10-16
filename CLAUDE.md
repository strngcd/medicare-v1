# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Medicar: an internal multi-branch pharmacy management system (V1). npm workspaces monorepo:
`server/` (Node + Express 5 + PostgreSQL via raw `pg`, CommonJS) and `client/` (React 19 + Vite SPA, ESM/JSX).
The backend and database are authoritative for every business rule; the UI only previews and hides unavailable actions.

## Commands

Run from the repo root unless noted. Config lives in `server/.env` (copy `server/.env.example`).

```bash
npm install                                  # both workspaces
npm run migrate                              # apply SQL migrations (dev DB)
npm run migrate:down --workspace server      # roll back latest migration
npm run migrate:create --workspace server -- <name>   # new SQL migration file
npm run seed                                 # idempotent reference data (roles, permissions, settings, categories, help, 499 medicines + 95 cosmetics)
npm run create-owner                         # first Owner (interactive, or OWNER_NAME/OWNER_EMAIL/OWNER_PASSWORD env)
npm run seed:demo --workspace server         # demo branches/staff/transactions (dev only, needs Owner + no stock)

npm run dev:server                           # API on :4000 (node --watch)
npm run dev:client                           # Vite on :5173, proxies /api -> :4000

npm test                                     # server + client suites
npm test --workspace server                  # Jest + Supertest, runs --runInBand against TEST_DATABASE_URL
npm run test:unit --workspace server
npm run test:integration --workspace server
npx jest --runInBand tests/integration/sales.test.js -t "voids"   # single file / test (run inside server/)
npx jest src/utils/money.test.js             # single client test (run inside client/)

npm run build                                # client -> client/dist
NODE_ENV=production npm start                # API also serves client/dist from the same origin
```

There is no linter or formatter configured; follow `.editorconfig` (2 spaces, LF) and match surrounding style.

Server tests migrate the test DB once (`tests/helpers/globalSetup.js`) and `TRUNCATE` all tables between tests (`tests/helpers/db.js`). Never point `TEST_DATABASE_URL` at a database with real data. Test helpers for creating users/sessions/fixtures are in `server/tests/helpers/` (`factories.js`, `session.js`).

## Server architecture

Each domain in `server/src/modules/<domain>/` follows **routes → controller → service → repository**:

- **routes**: `authenticate`, then `requirePermission` / `requireAnyPermission` (permission codes from `src/permissions/catalog.js`), then `validate({ params, query, body })` with zod schemas from `<domain>.validators.js`. Validated input is on `req.valid`.
- **controller**: thin; calls the service with `req.auth` (auth context), `actorFromRequest(req)` (for audit), validated input and `readIdempotencyKey(req)`; responds via `src/utils/response.js` (`sendData`, `sendPage`, `sendIdempotent`). Every response uses the `{ success, data, message }` envelope, plus `pagination` for lists.
- **service**: owns business rules, branch-access checks and the transaction. Throw `AppError` (`src/errors/AppError.js`); `errorHandler` maps AppError, ZodError and selected Postgres error codes to stable API error codes.
- **repository**: explicit SQL. Functions take an optional `client` so they join the service's transaction (`query(text, params, client)` / `withTransaction(work)` in `src/database/db.js`). Rows are camelized (`src/utils/camelize.js`).

Cross-cutting rules that span many files:

- **Inventory ledger**: `modules/inventory/inventory.ledger.js` is the *only* code path that changes `branch_inventory.quantity`. It locks rows `FOR UPDATE`, rejects negative stock and appends an immutable `stock_movements` row. Sales, purchases/receiving, refunds, voids, transfers, adjustments and disposals all go through it. Sales allocate stock FEFO (`inventory/fefo.js`).
- **Idempotency**: critical POSTs wrap their work in `runIdempotent` (`modules/idempotency/idempotency.js`) keyed by the `Idempotency-Key` header; retries replay the stored response.
- **Audit**: state changes call `recordAudit(client, actor, entry)` (`modules/audit/audit.recorder.js`) inside the same transaction; it strips secret-like fields.
- **Authorization**: `src/auth/authContext.js` loads the user, role, effective permissions (role defaults plus per-user overrides; Owner unrestricted) and branch assignments on every request. Services enforce branch scope via `permissions/branchAccess.js`. `permissions/financialVisibility.js` strips cost/profit fields from responses (including exports and search) for users lacking the financial permissions. New cost/profit fields must be added to its field sets.
- **Permissions catalog**: add or change permissions and role defaults in `src/permissions/catalog.js`; `npm run seed` syncs them to the DB (`seeds/accessControl.js`). The client mirrors codes in `client/src/routes.jsx` and `<Can>` / guards.
- **Dates in SQL**: filter timestamps against business-day bounds (`col >= ($d::date AT TIME ZONE tz) AND col < (($d::date + 1) AT TIME ZONE tz)`), never `(col AT TIME ZONE tz)::date`, which cannot use indexes.
- **Exports**: fetch every row in one query (`parseListParams(..., { exportLimit })`); over `EXPORT_MAX_ROWS` they fail with `EXPORT_TOO_LARGE`, never truncate.
- **Seeds**: seeded categories and catalog medicines carry permanent keys (`seed_key`, `catalog_key`); seeds match on those, never on editable names.
- **Money**: use `decimal.js` helpers in `src/utils/money.js`. NUMERIC columns arrive as strings and must never become floats. DATE columns are returned as `YYYY-MM-DD` strings (`database/pool.js`); business "today" and expiry use `BUSINESS_TIMEZONE` via `src/utils/time.js`.
- **Document numbers**: displayed numbers are a prefix plus a random 6-char code (`SAL-7K3QX9`, `PUR-`, `REF-`, `TRF-`, `STK-`) from `modules/documents/documentNumbers.js`; UUIDs stay internal.
- **Cache**: `src/utils/cache.js` caches report aggregates in-process; any successful write request marks them stale (`invalidateOnWrite` in `routes.js`). Reports and dashboard/analytics stay exact (a sale or refund shows on the next read); the dashboard page polls every 30 s and on tab focus. Cache keys must include branch scope and permission flags.
- **DB-level guarantees**: migrations (`server/migrations/*.sql`, plain SQL via node-pg-migrate, table `schema_migrations`) add triggers that make ledgers, audit logs, sale lines, refunds and receivings append-only, block deletes of business records, and keep batch cost and branch code immutable. Model changes as new rows or status changes, not updates or deletes. Branches, users and suppliers are soft-deleted (`deleted_at`, only while unused; rows then frozen); every query listing or fetching them must exclude `deleted_at IS NOT NULL`. Add new migrations rather than editing applied ones.

Auth: server-side sessions (hashed tokens in `user_sessions`), `HttpOnly` / `SameSite=Strict` cookies, and CSRF via the `X-CSRF-Token` header matching the `medicar_csrf` cookie on every state-changing JSON request. Without `SMTP_HOST`, reset and setup emails are printed to the server console.

## Client architecture

- `src/api/client.js`: fetch wrapper that sends cookies + CSRF token and normalizes errors into `ApiError` (`code`, `fieldErrors`). All API calls go through it (`/api/v1`).
- `src/routes.jsx`: route table of lazily loaded pages, each with the permission codes that open it. `App.jsx` wraps them in `RequireAuth` / `RequirePermission` guards (`src/permissions/`).
- `src/context/AuthContext.jsx` exposes the user, selected branch and `can(code)`. Shared hooks are in `src/hooks/` (`useApi`, `useAction`, `useListState`, `useLookups`), and UI primitives are in `src/components/ui/`.
- Plain CSS in `src/styles/`. Icons come from `lucide-react` and charts from Recharts.

## Reference

- `docs/API.md`: API reference. `README.md`: setup, security model and business-rule summary.
- Business timezone `Africa/Addis_Ababa`, English + Gregorian only. Sales take exactly one payment method (CASH or BANK_TRANSFER) and one sale-level discount prorated across lines.
- Work on `feat/*` branches and merge into `main` locally. Don't push without asking.
