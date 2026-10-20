# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

鲜境 FreshMarket is a coursework grocery platform. It has a React storefront, a separate staff console and a Fastify API, all in one npm-workspaces repo (`api/`, `web/`). Docs, UI text, error messages and code comments are in Chinese. Keep new user-facing strings in Chinese.

## Commands

Requires **Node.js 24+**. Local dev uses the built-in `node:sqlite`, so older Node versions fail at startup.

```bash
npm ci
npm run dev          # API on :3001 (tsx watch) + Vite on :5173 (proxies /api → :3001)
npm run typecheck    # tsc for api and web
npm test             # API tests: node:test via tsx, with coverage
npm run build
npm run test:e2e     # Playwright; starts `npm run dev` itself unless E2E_BASE_URL is set
npm run load         # load test against a running API
```

- Run a single API test: `cd api && npx tsx --test --test-name-pattern="<test name regex>" test/system.test.ts`
- PostgreSQL tests: set `TEST_DATABASE_URL=postgres://...`. Each test creates a temporary schema and drops it afterwards. CI runs `npm test` twice, once on SQLite and once on Postgres, so SQL changes must work on both.
- E2E results go to `docs/evidence/e2e-results.json` and screenshots to `docs/screenshots/`. Both are committed, so running E2E changes tracked files.
- Full stack (Postgres, Redis, RabbitMQ, nginx, Prometheus, Alertmanager, Grafana, Jaeger): `sh scripts/init-env.sh && sh scripts/deploy.sh` (unique image tag per deploy; `scripts/rollback.sh` returns to the previous one). Ops scripts exist as both `.sh` and `.ps1` (`backup`, `restore`, `deploy`, `rollback`); `.ps1` files stay ASCII so Windows PowerShell 5.1 reads them.
- Swagger: http://localhost:3001/api/docs. Demo accounts: `member`, `operator`, `warehouse`, `support`, `finance`, `admin`. Local password: `Fresh@123456`.

## Architecture

### API (`api/src`)
- `app.ts` `buildApp()` wires the whole app. It creates the DB, runs migrations and the seed, and builds the services. It also defines the auth guards and passes a single `Context` (`core/context.ts`) to each `modules/*/controller.ts` route registrar. Tests call `buildApp({db, logger:false, workers:false})` and drive routes with `app.inject`.
- Modules: `accounts` (auth, cart, addresses, notifications), `catalog` (products, fuzzy search in `search.ts`, search suggestions/hot keywords/related/for-you recommendations, demo seed), `orders` (state machine; `create()` for cart checkout with optional coupon, `seckill()` for flash-sale orders, both sharing `begin/address/insert`), `promotions` (`coupons.ts`: pure `quote()` discount + per-line allocation, `lockCoupon/markCouponUsed` used inside checkout; `seckill.ts`: Redis token gate + admin; `controller.ts`), `admin` (staff console endpoints, which call the other modules' services). `OrderRepository` holds shared consistency helpers: `get(tx,id,lock)` for row locking, `audit()`, `emit()` (outbox, stores the W3C trace context), `restock()`, `releaseCoupon()` (cancel + full refund) and `releaseSeckill()` (cancel only).
- **Dual-dialect DB layer** (`core/database.ts`): one `Query` interface (`all`/`one`/`run`) with `?` placeholders. These are rewritten to `$n` for Postgres. SQLite access is serialized through a promise queue, and transactions use `BEGIN IMMEDIATE`. Postgres-only clauses (`FOR UPDATE`, `SKIP LOCKED`) are added only when `db.dialect==='postgres'`. Write SQL that works on both.
- **Migrations**: `database/schema.sql` (all `CREATE ... IF NOT EXISTS`) runs on every startup. A new column on an existing table must go in `schema.sql` and also in the `additions` map in `database.ts`, which is how existing databases get upgraded.
- **Seed**: `modules/catalog/seed.ts` is the source of truth. It adds missing demo products and users, and never overwrites existing price, stock or status, or recreates soft-deleted products. `database/seed.sql` is generated from the built output by `scripts/export-seed.mjs`. Demo user IDs are `u-<role>`, and tests sign JWTs for those IDs directly.
- **Auth/RBAC** (`core/security.ts` + guards in `app.ts`): the JWT carries `sub`, `accountType` (`member`/`staff`) and `sessionVersion`. Every request re-reads the user and rejects the token if the user is deleted or inactive, if `session_version` changed, or if the account type doesn't match. To invalidate sessions, bump `users.session_version`. Use the guards `ctx.memberOnly`, `ctx.staffOnly` and `ctx.permit('<capability>')`. Capabilities per role are in `capabilities`, and delete capabilities (`*.delete`) are admin-only. Members and staff are fully separate: members log in at `/api/auth/*`, staff at `/api/admin/auth/*`, and neither can call the other's endpoints.
- **Responses/errors**: success is `result(req,data)` → `{code:0,message,data,traceId}`. For failures, use `ensure(cond,status,CODE,'中文消息')`, which throws `BusinessError`; the global handler turns it into the same envelope.
- **Consistency rules** (details in `docs/design.md` §4):
  - Every state change runs inside `db.transaction`, locks the order row, and calls `repo.audit()` and `repo.emit()` within the same transaction.
  - Stock is decremented with a conditional `UPDATE ... WHERE stock>=?`, never check-then-update.
  - Order creation is idempotent via the `idempotency-key` header plus a SHA-256 hash of the request.
  - `payments`, `refunds` and `settlements` have a unique `order_id`.
  - Coupons: one per member per template (`UNIQUE(coupon_id,user_id)`), issuance via `issued<total`. `order_items.discount` holds each line's share; partial refunds subtract `ceil(discount*q/quantity)`. Delivery fee is computed on `subtotal-discount`.
  - Flash sale: `seckill_activities.sold<stock` (also a CHECK) plus product stock, one unit per member via `seckill_participants` PK. Redis tokens only shed load; the DB decides.
- **Soft deletes**: `users`, `products` and `orders` have `deleted_at`. Queries must filter `deleted_at IS NULL`. History (order items, refunds) is kept.
- **Money** is stored as integer 分 everywhere (delivery is free at ≥ 9900).
- **Runtime** (`core/runtime.ts`): a 2-second worker expires unpaid orders (`ORDER_TTL_MINUTES`) and flushes the outbox. If `AMQP_URL` is set, events are published to RabbitMQ with confirms. Otherwise they are consumed in-process. Consumers deduplicate through `processed_events`. Redis (`REDIS_URL`) is an optional 30-second catalog cache keyed by a version counter. After any mutation that affects catalog data (stock, products, orders), call `ctx.runtime.invalidate()`.
- **Tracing** (`core/tracing.ts`): `initTracing()` registers a process-wide OpenTelemetry provider once (tests pass an in-memory exporter before `buildApp`). `genReqId` starts the HTTP span, so `req.id` is the W3C traceId (honours incoming `traceparent`). `traceDatabase()` wraps the `Query` interface; SQL/Redis spans are only created under an active parent span. Exporting requires `OTEL_EXPORTER_OTLP_ENDPOINT` (Docker: Jaeger on :16686).
- Behind nginx the API trusts one proxy hop only when `TRUST_PROXY` is set (Docker sets `1`; nginx overwrites `X-Forwarded-For`), so limits are per real client; unset means forwarded headers are ignored. Per-member limits (coupon claim, seckill) key on the verified JWT `sub`, falling back to IP.
- The global rate limit (300/min) is per IP and the E2E suite runs close to it; keep extra storefront requests low (home promotions use one combined `/api/promotions` call, recommendations lazy-load).
- With `NODE_ENV=production`, `buildApp` refuses to start without a strong `JWT_SECRET`, a `DATABASE_URL`, and (if seeding) a non-default `DEMO_PASSWORD`.

### Web (`web/src`)
- React 19 + react-router 7, no UI framework. `App.tsx` splits routes: `/admin/*` renders the staff console (`Admin.tsx`, `admin/*`, `staff.css`) with its own layout; all other routes get the storefront header and footer.
- `api.ts` `api()` picks the token by path: paths starting `/admin/` use `fresh-staff-token`, everything else uses `fresh-member-token` (both in sessionStorage). A 401 dispatches a `fresh-session-expired` event, which `store.tsx` handles. `store.tsx` is the global context: member and staff users, cart, addresses, the selected delivery address (persisted to localStorage) and toasts.
- The storefront category state comes from the URL `category` query param. The top nav and the icon category bar both read it.
- `web/src/search-highlight.ts` is imported by `api/test/search-highlight.test.ts`, so keep it free of browser and React dependencies.

## Conventions
- The code is written in a very dense style: long single-line functions, minimal whitespace, short Chinese comments. Match it when editing instead of reformatting files.
- Feature commits update the matching paragraph in `README.md`, which describes behavior in detail (search rules, deletion permissions, the account split). Update it when behavior changes.
- `docs/`, `deliverables/` and the Python scripts in `scripts/` (`generate-deliverables.py`, `package.py`, etc.) produce coursework deliverables. Running the app doesn't need them.
