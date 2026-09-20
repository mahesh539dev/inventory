# Inventory, QR Product Catalog & Sales Management Application — Design

Source requirements: [`inventory_qr_sales_app_claude_prompt.md`](../../../inventory_qr_sales_app_claude_prompt.md) (repo root).

## Summary

A mobile-first Next.js application for a small business (2-3 internal
users) to manage product inventory, generate QR codes for products,
run a scan-first sell workflow, and track sales/profit. Deployed as a
single service on Railway with Railway PostgreSQL. Deliberately a
modular monolith — no microservices, queues, or caches.

## Technology Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 14+ (App Router), TypeScript | Full-stack in one deployable, matches spec |
| Styling/UI | Tailwind CSS + shadcn/ui | Mobile-first, minimal, fast to build with |
| Database | PostgreSQL (Railway addon) | Required by spec |
| ORM/migrations | Drizzle ORM + drizzle-kit | Lightweight, SQL-like, strong migration tooling |
| Auth | Auth.js (NextAuth) v5, credentials provider | Standard for Next.js, secure sessions/cookies built in |
| Password hashing | bcrypt | Industry standard |
| Image storage | Cloudflare R2 (S3-compatible) via `@aws-sdk/client-s3` | Cheap, no egress fees, satisfies "not ephemeral local disk" |
| QR generation | `qrcode` (server-side PNG generation, on demand) | No need to persist QR images |
| QR scanning | `html5-qrcode` | Actively maintained, works on iOS Safari + Android Chrome |
| Validation | Zod | Shared schemas across actions/routes/CSV |
| Testing | Vitest | Fast, works well with Drizzle + Postgres |
| Package manager | npm | Simplest, default Railway/Nixpacks support |
| Deployment | Dockerfile + Railway | Per spec |

## Architecture

Single Next.js app. Server Actions handle authenticated mutations;
Route Handlers back the public JSON API, QR image streaming, and
CSV import/export (things that need non-HTML responses or that
benefit from a stable REST contract). No separate backend service.

```
app/                    routes, pages, layouts (UI)
app/api/                route handlers (public product API, QR PNG, CSV)
lib/actions/            server actions — thin, call services
lib/services/           business logic (product, inventory, sale, qr, report)
lib/repositories/       Drizzle query functions per entity
lib/db/                 schema, migrations, client
lib/auth/               Auth.js config, session helpers, role guards
lib/storage/            image storage abstraction (R2 implementation)
lib/validation/         Zod schemas
components/             UI components (shadcn/ui based)
```

Each layer has one job: actions/routes parse+authorize, services hold
business rules and transactions, repositories are the only code that
touches Drizzle, storage/auth are swappable behind interfaces.

## Data Model (ERD)

```
users(id, name, email UNIQUE, password_hash, role[ADMIN|USER], active, created_at, updated_at)

categories(id, name UNIQUE, created_at)

products(
  id, public_identifier UNIQUE INDEX, sku UNIQUE INDEX (normalized upper),
  product_name, category_id FK->categories NULL, description,
  product_image URL NULL, original_price NUMERIC, cost_price NUMERIC,
  selling_price NUMERIC NULL, current_quantity INT CHECK >= 0,
  supplier, location, status[ACTIVE|ARCHIVED], notes,
  created_at, updated_at
)

inventory_transactions(
  id, product_id FK->products INDEX,
  type[PURCHASE|SALE|RETURN|ADJUSTMENT|DAMAGE|OTHER],
  quantity INT (signed), reference_id NULL, notes,
  created_by FK->users, created_at
)

sales(
  id, sale_number UNIQUE INDEX ("SALE-000001", Postgres sequence),
  sold_at, sold_by FK->users, total_amount, total_cost, total_profit,
  status[COMPLETED|CANCELLED|RETURNED], notes, created_at
)

sale_items(
  id, sale_id FK->sales INDEX, product_id FK->products INDEX,
  quantity, cost_per_unit (snapshot), sold_price_per_unit (snapshot),
  total_cost, total_revenue, profit
)

audit_logs(id, user_id FK->users NULL, action, entity_type, entity_id NULL, metadata JSONB, created_at)
```

Concurrency safety: sale completion runs inside a single DB
transaction that takes `SELECT ... FOR UPDATE` on the affected
product row(s) before validating/reducing quantity, so two concurrent
sales against the same product cannot both succeed when only one unit
remains. `current_quantity >= 0` is enforced by a CHECK constraint as
defense in depth.

## QR & Public API Security

- `public_identifier`: short URL-safe random id (nanoid), generated at
  product creation, immutable per QR "generation." A regenerate action
  issues a new identifier (invalidating the old QR/URL) rather than
  supporting multiple simultaneous codes.
- QR PNGs are generated on demand from `${APP_URL}/p/{publicIdentifier}`
  via the `qrcode` package and streamed for download/print — never
  persisted as files.
- `/p/[publicIdentifier]` checks the Auth.js session server-side:
  unauthenticated visitors are served by a query function that
  `SELECT`s only `product_name, selling_price, image_url` — the
  restricted field set is enforced at the query layer, not by
  filtering a full object in the UI. Authenticated visitors get the
  full product query gated by role.
- `GET /api/public/products/[identifier]` reuses the same restricted
  query function so there is exactly one code path defining "what the
  public can see."

## Image Storage Abstraction

```ts
interface ImageStorage {
  upload(file: Buffer, key: string, contentType: string): Promise<string>
  delete(key: string): Promise<void>
}
```

R2 implementation validates MIME type (jpeg/png/webp) and a 5MB size
cap before upload. Swapping providers later means adding one new
class behind the same interface.

## Folder Structure

```
inventory/
├── Dockerfile
├── railway.json
├── drizzle.config.ts
├── .env.example
├── app/
│   ├── (auth)/login/page.tsx
│   ├── (app)/                      authenticated layout + mobile nav
│   │   ├── dashboard/page.tsx
│   │   ├── products/{page,new,[id],[id]/edit,import}/...
│   │   ├── scan/page.tsx
│   │   ├── sell/page.tsx
│   │   ├── sales/{page,[id]}/...
│   │   ├── reports/page.tsx
│   │   └── settings/page.tsx
│   ├── p/[publicIdentifier]/page.tsx
│   └── api/
│       ├── public/products/[identifier]/route.ts
│       ├── products/[id]/qr/route.ts
│       ├── import/products/route.ts
│       └── export/{products,sales,inventory}/route.ts
├── lib/
│   ├── db/{schema.ts, client.ts}
│   ├── auth/{config.ts, session.ts, guards.ts}
│   ├── storage/{interface.ts, r2.ts}
│   ├── services/{product,inventory,sale,qr,report}.service.ts
│   ├── repositories/{product,inventory,sale,user,audit}.repo.ts
│   ├── actions/{product,inventory,sale,import}.actions.ts
│   └── validation/{product,sale,inventory,csv}.schema.ts
├── components/{ui/, scan/QrScanner.tsx, ...}
├── drizzle/                        generated SQL migrations
├── scripts/seed.ts
└── tests/{unit/, integration/}
```

## Implementation Phases

Following the source spec's phase breakdown exactly (section 61):

1. Project Foundation — Next.js/TS/Tailwind/shadcn, Drizzle+migrations, env config, Auth.js foundation, base layout
2. Product Management — CRUD, SKU validation, search, photo upload, categories
3. QR System — generation, public identifier, public page, auth-aware page, download/print
4. Inventory — transactions, add/adjust stock, history, low-stock detection
5. Scan — mobile camera scanner, manual SKU fallback
6. Sales — sell page, sale calculation/profit, transactional inventory update, sale history
7. Returns/Cancellations — cancel/return sale, restore inventory, audit log
8. Dashboard/Reports — summary tiles, recent sales, low stock, date-filtered reports
9. CSV — import with validation/preview, export
10. Security & Polish — auth/authz review, rate limiting, file upload validation, error/loading states, accessibility
11. Testing — unit + integration test pass across financial/inventory logic
12. Railway Deployment — Dockerfile, railway.json, migration/seed process, docs

Each phase gets its own commit(s) and a completion report (what was
implemented, files changed, DB changes, tests added/executed,
remaining issues, manual verification steps) per the source spec's
section 64.

## Out of Scope for V1

Per source spec section 59: multi-store/location, purchase orders,
customer records, WhatsApp/invoice/payment integration, barcode
(non-QR) support, product variants, multi-currency, GST/tax,
low-stock notifications. Schema/architecture should not preclude
these but none are built now.
