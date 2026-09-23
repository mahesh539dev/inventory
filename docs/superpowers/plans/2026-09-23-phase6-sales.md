# Phase 6 — Sales Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authenticated staff build a multi-product cart on a
`/sell` page (scanning QR codes or searching by name/SKU), check it out
as one atomic sale that decrements inventory and records `sales` +
`sale_items` + `inventory_transactions`, and browse completed sales via
`/sales` (list) and `/sales/[id]` (detail).

**Architecture:** A new `lib/services/sale.service.ts`'s `completeSale`
extends Phase 4's single-row `db.transaction()` + `SELECT ... FOR
UPDATE` pattern to lock every distinct cart-line product in one query,
sorted by `id`, before validating and decrementing each line —
preventing the multi-row deadlock a naive per-line lock loop would risk.
A new Postgres sequence (`sale_number_seq`) generates human-readable
sale numbers. The `/sell` page is a client component holding cart state
in `useState` (no persistence); it renders Phase 5's `<QrScanner>`
unchanged plus a new `<ProductSearch>` fallback, and unmounts the
scanner during a checkout review step.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Drizzle
ORM (new: `pgSequence`), Vitest + Testing Library (existing
infrastructure from Phase 5, no new test tooling).

**Spec:** [`docs/superpowers/specs/2026-09-23-phase6-sales-design.md`](../specs/2026-09-23-phase6-sales-design.md)

## Global Constraints

- `completeSale` must run inside a single `db.transaction()` that locks
  every distinct product row in the cart with `.for("update")`,
  **sorted by `products.id`**, before validating/decrementing any of
  them — a stable lock order across all concurrent calls, preventing a
  multi-row deadlock (source design's "New server code" section).
- Any single cart line failing validation (product not found,
  insufficient stock) throws inside the transaction, rolling back the
  **entire** sale — no partial sales, ever (source spec: "This phase
  must use proper database transactions"; source design's Error
  Handling: "whole sale rejected... all-or-nothing").
- `sale_number` is generated from a real Postgres sequence
  (`sale_number_seq`), formatted as `"SALE-" + 6-digit zero-padded
  nextval` (e.g. `"SALE-000001"`) — never derived from counting rows.
- Archived products **can** be added to a cart and sold — no status
  filter anywhere in the lookup or `completeSale` validation (source
  design's explicit decision, "New Components" #4).
- `buyer_name` / `buyer_phone` are optional on every sale — never
  required to complete a checkout (source design's Data Model Changes).
- `completeSale` and `lookupProductForSale` both call `requireUser()`
  first — any authenticated staff member, not admin-gated (source
  design's "What's already in place," matching Phase 5's scan actions).
- Reuse `components/scan/QrScanner.tsx` and `lib/scan/parse-qr-payload.ts`
  from Phase 5 **unchanged** — no edits to either file in this phase.
- `sale_items.cost_per_unit` snapshots the product's **current**
  `cost_price` at sale time (no cost-price history exists) —
  `sold_price_per_unit` snapshots the cart line's entered price, which
  defaults from but can differ from the product's `selling_price`.
- Cart state lives in `/sell`'s `useState` only — no `localStorage`, no
  server-side draft persistence, cleared on navigation/refresh (source
  design's explicit decision, "Out of Scope").
- Checkout is an in-page view state on `/sell`, not a separate route
  (source design's explicit decision).
- `<QrScanner>` must be **unmounted** (not merely hidden) when `/sell`
  enters the checkout review step, so its Phase-5-fixed unmount cleanup
  (stops the camera stream and the decode loop) actually runs and no
  stray scan can mutate the cart mid-review.

## Review Focus

- **Two concurrent `completeSale` calls whose carts share two or more
  of the same products, added in a different order** — must not
  deadlock and must not lose an update; the sorted-lock-order design is
  exactly the fix, and Task 4's test must prove the lock query sorts by
  id, not the insertion/cart order.
- **A cart line's quantity exceeds current stock only by the time
  checkout runs** (stock changed between add-to-cart and confirm, via
  another sale or an inventory adjustment) — the transaction's `SELECT
  ... FOR UPDATE` must see the live value and reject that line,
  rolling back the *whole* multi-line sale, not just silently
  under-filling it. Task 4 covers this with a multi-line scenario, not
  just a single-line one.
- **Sold price entered as 0, negative, or non-numeric** on a cart line
  — must be rejected before `completeSale` is ever called (client-side
  Zod validation), not silently recorded as a $0 or negative-profit
  sale. Task 5's schema enforces this and its own action-level test
  covers the case (`completeSaleAction` rejecting `soldPricePerUnit: 0`
  without calling `completeSale`) — the single point where every cart,
  regardless of which UI added its lines, passes through this check.
- **Two products with the identical name but different SKUs**, both
  matching a `<ProductSearch>` query — the result list must disambiguate
  by showing SKU alongside name and must add the *tapped* result's
  specific `productId`, not rely on name matching a single product.
  Task 6's component test must cover a two-result search, not just a
  single-match case, since this is the first fuzzy/multi-result picker
  in the app (`/products` search always narrows to one page of full rows
  with visible SKUs already, but never a tap-to-select list).
- **Scanning/searching the same product a second time while it's
  already in the cart** — must increment the existing line's quantity,
  not add a duplicate line with the same `productId` (source design's
  explicit behavior). Task 8 must test this via both entry points
  (decode and search-select), since they share the add-to-cart function
  but arrive through different UI paths.

---

## File Structure

- **Modify** `lib/db/schema.ts` — add `buyerName`/`buyerPhone` columns
  to `sales`, declare `saleNumberSeq` via `pgSequence`.
- **Modify** `lib/repositories/product.repo.ts` — `listProducts`/
  `countProducts`'s `status` filter must support "no filter" (both
  ACTIVE and ARCHIVED) when omitted, needed by `<ProductSearch>` since
  archived products are sellable; currently defaults to `"ACTIVE"`
  when `status` is omitted, which silently excludes archived products
  from search results today.
- **Create** `lib/repositories/sale.repo.ts` — `insertSale`,
  `insertSaleItems`, `listSales`, `countSales`, `findSaleById`.
- **Create** `lib/services/sale.service.ts` — `completeSale`
  transaction (the core of this phase).
- **Create** `lib/actions/sale.actions.ts` — `lookupProductForSale`,
  `completeSaleAction` (thin `requireUser()` + delegate wrapper).
- **Create** `lib/validation/sale.schema.ts` — Zod schema for a cart
  line (quantity, sold price bounds) and the buyer-info fields.
- **Create** `lib/actions/product-search.actions.ts` —
  `searchProductsForSale`, kept separate from `sale.actions.ts` to stay
  scoped to one concern (fuzzy multi-result search vs. exact checkout
  lookup), matching this codebase's existing one-file-one-responsibility
  convention in `lib/actions/`.
- **Create** `components/sell/SellCart.tsx` — presentational cart list.
- **Create** `components/sell/ProductSearch.tsx` — debounced
  search-and-tap-to-add fallback.
- **Create** `app/(app)/sell/page.tsx` — the cart-building +
  checkout-review page.
- **Create** `app/(app)/sales/page.tsx` — sale history list.
- **Create** `app/(app)/sales/[id]/page.tsx` — sale detail.
- **Verify** `components/nav/DesktopSidebar.tsx`,
  `components/nav/MobileNav.tsx` — both already contain `/sell` and
  `/sales` links, pre-wired ahead of this phase the same way `/scan`
  was pre-wired ahead of Phase 5 (confirmed by reading both files while
  writing this plan); Task 11 re-checks this rather than assuming it
  and modifies only if that's changed by the time it runs.

## Task 1: Schema changes — buyer fields, sale number sequence

**Files:**
- Modify: `lib/db/schema.ts`
- Migration: generated into `drizzle/` by `drizzle-kit generate`

**Interfaces:**
- Consumes: nothing (pure schema/migration task).
- Produces: `sales.buyerName: string | null`, `sales.buyerPhone: string | null`
  columns; a `sale_number_seq` Postgres sequence usable via
  `sql\`nextval('sale_number_seq')\`` — Task 2 (`sale.repo.ts`'s
  `insertSale`) is the first consumer of both.

- [ ] **Step 1: Add the two columns and the sequence to the schema**

Read `lib/db/schema.ts` first. Add `pgSequence` to the existing
`drizzle-orm/pg-core` import, declare the sequence, and add the two
columns to the `sales` table definition:

```typescript
// lib/db/schema.ts
import {
  pgTable,
  pgEnum,
  pgSequence,
  uuid,
  text,
  varchar,
  numeric,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
```

```typescript
export const saleNumberSeq = pgSequence("sale_number_seq", { startWith: 1 });
```

Place this declaration right before `export const sales = pgTable(...)`.

In the `sales` table definition, add the two new columns after
`notes`:

```typescript
export const sales = pgTable("sales", {
  id: uuid("id").primaryKey().defaultRandom(),
  saleNumber: varchar("sale_number", { length: 32 }).notNull(),
  soldAt: timestamp("sold_at", { withTimezone: true }).notNull().defaultNow(),
  soldBy: uuid("sold_by").notNull().references(() => users.id),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
  totalCost: numeric("total_cost", { precision: 12, scale: 2 }).notNull(),
  totalProfit: numeric("total_profit", { precision: 12, scale: 2 }).notNull(),
  status: saleStatusEnum("status").notNull().default("COMPLETED"),
  buyerName: text("buyer_name"),
  buyerPhone: text("buyer_phone"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("sales_sale_number_idx").on(table.saleNumber),
  index("sales_sold_at_idx").on(table.soldAt),
]);
```

- [ ] **Step 2: Generate the migration**

Run: `npx drizzle-kit generate`
Expected: a new file appears under `drizzle/` (e.g.
`0001_<auto-name>.sql`) containing `ALTER TABLE "sales" ADD COLUMN
"buyer_name" text;`, `ALTER TABLE "sales" ADD COLUMN "buyer_phone"
text;`, and `CREATE SEQUENCE "sale_number_seq" ...START WITH 1...;`.
Read the generated file to confirm all three statements are present
before continuing.

- [ ] **Step 3: Apply the migration**

Run: `npm run db:migrate`
Expected: succeeds with no errors against the dev database.

- [ ] **Step 4: Verify the existing test suite still passes**

Run: `npm test`
Expected: PASS — same test count as before this task (a schema-only
change with no application code touched yet).

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts drizzle/
git commit -m "Add buyer fields and sale number sequence to sales schema"
```

## Task 2: `sale.repo.ts` — repository functions

**Files:**
- Create: `lib/repositories/sale.repo.ts`
- Test: `tests/integration/sale.repo.test.ts`

**Interfaces:**
- Consumes: `sales`, `saleItems` from `lib/db/schema.ts` (Task 1);
  `DbOrTx` type convention from `lib/repositories/inventory.repo.ts`
  (existing — either the module `db` or a `tx` handle, so writes can
  participate in `completeSale`'s transaction).
- Produces: `insertSale(data, executor?)`, `insertSaleItems(data,
  executor?)`, `listSales(params)`, `countSales()`, `findSaleById(id)`
  — Task 4 (`sale.service.ts`) is the first consumer of the inserts;
  Task 9/10 (`/sales`, `/sales/[id]` pages) are the first consumers of
  the reads.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/integration/sale.repo.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db/client";
import { sales, saleItems, products, users } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import {
  insertSale,
  insertSaleItems,
  listSales,
  countSales,
  findSaleById,
} from "@/lib/repositories/sale.repo";

async function makeUser() {
  const [user] = await db
    .insert(users)
    .values({
      name: "Test Cashier",
      email: `cashier-${crypto.randomUUID()}@example.com`,
      passwordHash: "not-a-real-hash",
      role: "USER",
    })
    .returning();
  return user;
}

async function makeProduct(overrides: Partial<typeof products.$inferInsert> = {}) {
  const [product] = await db
    .insert(products)
    .values({
      publicIdentifier: crypto.randomUUID().slice(0, 12),
      sku: `SKU-${crypto.randomUUID().slice(0, 8)}`,
      productName: "Test Product",
      originalPrice: "10.00",
      costPrice: "5.00",
      sellingPrice: "10.00",
      currentQuantity: 100,
      ...overrides,
    })
    .returning();
  return product;
}

describe("sale.repo", () => {
  let userId: string;
  let productId: string;

  beforeEach(async () => {
    const user = await makeUser();
    userId = user.id;
    const product = await makeProduct();
    productId = product.id;
  });

  afterEach(async () => {
    await db.delete(saleItems);
    await db.delete(sales);
    await db.delete(products);
    await db.delete(users);
  });

  it("insertSale generates a sale_number from the sequence in SALE-NNNNNN form", async () => {
    const [{ nextval }] = await db.execute<{ nextval: string }>(
      sql`SELECT nextval('sale_number_seq')`
    );
    const saleNumber = `SALE-${nextval.padStart(6, "0")}`;

    const sale = await insertSale({
      saleNumber,
      soldBy: userId,
      totalAmount: "20.00",
      totalCost: "10.00",
      totalProfit: "10.00",
      status: "COMPLETED",
    });

    expect(sale.saleNumber).toBe(saleNumber);
    expect(sale.saleNumber).toMatch(/^SALE-\d{6}$/);
  });

  it("insertSaleItems inserts one row per line linked to the sale", async () => {
    const sale = await insertSale({
      saleNumber: "SALE-000001",
      soldBy: userId,
      totalAmount: "20.00",
      totalCost: "10.00",
      totalProfit: "10.00",
      status: "COMPLETED",
    });

    const items = await insertSaleItems([
      {
        saleId: sale.id,
        productId,
        quantity: 2,
        costPerUnit: "5.00",
        soldPricePerUnit: "10.00",
        totalCost: "10.00",
        totalRevenue: "20.00",
        profit: "10.00",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].saleId).toBe(sale.id);
    expect(items[0].productId).toBe(productId);
  });

  it("findSaleById returns the sale with its items", async () => {
    const sale = await insertSale({
      saleNumber: "SALE-000002",
      soldBy: userId,
      totalAmount: "20.00",
      totalCost: "10.00",
      totalProfit: "10.00",
      status: "COMPLETED",
      buyerName: "Jane Doe",
    });
    await insertSaleItems([
      {
        saleId: sale.id,
        productId,
        quantity: 2,
        costPerUnit: "5.00",
        soldPricePerUnit: "10.00",
        totalCost: "10.00",
        totalRevenue: "20.00",
        profit: "10.00",
      },
    ]);

    const found = await findSaleById(sale.id);

    expect(found).toBeDefined();
    expect(found!.buyerName).toBe("Jane Doe");
    expect(found!.items).toHaveLength(1);
    expect(found!.items[0].productId).toBe(productId);
  });

  it("findSaleById returns undefined for an unknown id", async () => {
    const found = await findSaleById("00000000-0000-0000-0000-000000000000");
    expect(found).toBeUndefined();
  });

  it("listSales returns sales newest-first, respecting limit/offset", async () => {
    await insertSale({
      saleNumber: "SALE-000003",
      soldBy: userId,
      totalAmount: "5.00",
      totalCost: "2.00",
      totalProfit: "3.00",
      status: "COMPLETED",
    });
    await insertSale({
      saleNumber: "SALE-000004",
      soldBy: userId,
      totalAmount: "6.00",
      totalCost: "3.00",
      totalProfit: "3.00",
      status: "COMPLETED",
    });

    const results = await listSales({ limit: 1, offset: 0 });

    expect(results).toHaveLength(1);
    expect(results[0].saleNumber).toBe("SALE-000004");
  });

  it("countSales returns the total row count", async () => {
    await insertSale({
      saleNumber: "SALE-000005",
      soldBy: userId,
      totalAmount: "5.00",
      totalCost: "2.00",
      totalProfit: "3.00",
      status: "COMPLETED",
    });

    const total = await countSales();

    expect(total).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/integration/sale.repo.test.ts`
Expected: FAIL — `Cannot find module '@/lib/repositories/sale.repo'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/repositories/sale.repo.ts
import { db } from "@/lib/db/client";
import { sales, saleItems } from "@/lib/db/schema";
import { eq, desc, count } from "drizzle-orm";
import type { DbOrTx } from "./inventory.repo";

export type SaleRow = typeof sales.$inferSelect;
export type NewSale = typeof sales.$inferInsert;
export type SaleItemRow = typeof saleItems.$inferSelect;
export type NewSaleItem = typeof saleItems.$inferInsert;

export async function insertSale(data: NewSale, executor: DbOrTx = db): Promise<SaleRow> {
  const [row] = await executor.insert(sales).values(data).returning();
  return row;
}

export async function insertSaleItems(
  data: NewSaleItem[],
  executor: DbOrTx = db
): Promise<SaleItemRow[]> {
  return executor.insert(saleItems).values(data).returning();
}

export async function listSales(params: { limit: number; offset: number }): Promise<SaleRow[]> {
  return db
    .select()
    .from(sales)
    .orderBy(desc(sales.soldAt))
    .limit(params.limit)
    .offset(params.offset);
}

export async function countSales(): Promise<number> {
  const [{ value }] = await db.select({ value: count() }).from(sales);
  return value;
}

export async function findSaleById(
  id: string
): Promise<(SaleRow & { items: SaleItemRow[] }) | undefined> {
  const [sale] = await db.select().from(sales).where(eq(sales.id, id)).limit(1);
  if (!sale) return undefined;

  const items = await db.select().from(saleItems).where(eq(saleItems.saleId, id));
  return { ...sale, items };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/sale.repo.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/sale.repo.ts tests/integration/sale.repo.test.ts
git commit -m "Add sale repository functions"
```

## Task 3: `product.repo.ts` — support an unfiltered status search

**Files:**
- Modify: `lib/repositories/product.repo.ts:93-127` (`buildFilters`,
  `listProducts`, `countProducts`, and the `ListParams` type)
- Test: `tests/integration/product.repo.test.ts` (existing file —
  add cases, do not remove any)

**Interfaces:**
- Consumes: nothing new.
- Produces: `listProducts`/`countProducts` now accept `status:
  undefined` (or the field omitted) to mean "no status filter" (both
  ACTIVE and ARCHIVED), instead of silently defaulting to `"ACTIVE"`.
  Task 6 (`<ProductSearch>`'s backing lookup) is the first caller that
  needs this — archived products must be searchable since Phase 6
  allows selling them.

Every **existing** caller (`app/(app)/products/page.tsx`,
`tests/integration/product.repo.test.ts`) already passes `status`
explicitly (`"ACTIVE"` or `"ARCHIVED"`), so this change is safe: it only
changes behavior for a call that omits `status` entirely, which no
existing caller does.

- [ ] **Step 1: Read the current file and write the failing test**

Read `lib/repositories/product.repo.ts` in full first (you'll be
modifying `buildFilters`, lines 93-107, and the `ListParams` type,
lines 85-91).

Add this test to the **existing** file
`tests/integration/product.repo.test.ts` (read it first to match its
existing setup/teardown helpers and import style — do not duplicate
helper functions if the file already defines equivalent ones):

```typescript
it("listProducts with no status filter returns both ACTIVE and ARCHIVED products", async () => {
  // Uses this test file's existing product-creation helper, creating one
  // ACTIVE and one ARCHIVED product (see existing tests in this file for
  // the exact helper name/shape already in use).
  const results = await listProducts({ limit: 1000, offset: 0 });
  const statuses = new Set(results.map((p) => p.status));

  expect(statuses.has("ACTIVE")).toBe(true);
  expect(statuses.has("ARCHIVED")).toBe(true);
});

it("countProducts with no status filter counts both ACTIVE and ARCHIVED products", async () => {
  const activeOnly = await countProducts({ status: "ACTIVE" });
  const archivedOnly = await countProducts({ status: "ARCHIVED" });
  const both = await countProducts({});

  expect(both).toBe(activeOnly + archivedOnly);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/integration/product.repo.test.ts`
Expected: FAIL — both new tests fail because `buildFilters` currently
always applies `eq(products.status, params.status ?? "ACTIVE")`, so an
omitted `status` still filters to `ACTIVE` only.

- [ ] **Step 3: Modify `buildFilters` to treat an omitted status as "no filter"**

In `lib/repositories/product.repo.ts`, change:

```typescript
function buildFilters(params: Pick<ListParams, "search" | "categoryId" | "status">) {
  const filters = [eq(products.status, params.status ?? "ACTIVE")];
```

to:

```typescript
function buildFilters(params: Pick<ListParams, "search" | "categoryId" | "status">) {
  const filters = params.status ? [eq(products.status, params.status)] : [];
```

No other lines in `buildFilters`, `listProducts`, or `countProducts`
need to change — the rest of the function already conditionally pushes
to `filters` and calls `and(...filters)`, which handles an empty
`filters` array correctly (an unconditional `WHERE` clause with no
status term).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/product.repo.test.ts`
Expected: PASS (all tests in the file, including the two new ones)

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: PASS — `app/(app)/products/page.tsx` always passes
`status: "ACTIVE"` explicitly, so its behavior (and its own tests, if
any exercise that page) is unaffected.

- [ ] **Step 6: Commit**

```bash
git add lib/repositories/product.repo.ts tests/integration/product.repo.test.ts
git commit -m "Support searching products across all statuses"
```

## Task 4: `sale.service.ts` — `completeSale` transaction

**Files:**
- Create: `lib/services/sale.service.ts`
- Test: `tests/unit/sale.service.test.ts` (deterministic mocked-transaction
  tests, same technique as
  `tests/unit/inventory.service.concurrency.test.ts`)
- Test: `tests/integration/sale.service.test.ts` (real-DB happy-path
  and validation tests)

**Interfaces:**
- Consumes: `insertSale`, `insertSaleItems` from
  `lib/repositories/sale.repo.ts` (Task 2); `db` from
  `lib/db/client.ts`; `products` from `lib/db/schema.ts`;
  `insertInventoryTransaction` from `lib/repositories/inventory.repo.ts`
  (existing); `InsufficientInventoryError` (new, this file) and
  `ProductNotFoundError` from `lib/services/product.service.ts`
  (existing, reused as-is).
- Produces: `completeSale(input: CompleteSaleInput): Promise<SaleWithItems>`
  — Task 5 (`sale.actions.ts`) is the only consumer.

```typescript
type CompleteSaleInput = {
  items: { productId: string; quantity: number; soldPricePerUnit: number }[];
  buyerName?: string;
  buyerPhone?: string;
  userId: string;
};

type SaleWithItems = SaleRow & { items: SaleItemRow[] };
```

- [ ] **Step 1: Write the failing integration tests (real DB, happy path + validation)**

```typescript
// tests/integration/sale.service.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db/client";
import { sales, saleItems, inventoryTransactions, products, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { completeSale, InsufficientInventoryError } from "@/lib/services/sale.service";
import { ProductNotFoundError } from "@/lib/services/product.service";

async function makeUser() {
  const [user] = await db
    .insert(users)
    .values({
      name: "Test Cashier",
      email: `cashier-${crypto.randomUUID()}@example.com`,
      passwordHash: "not-a-real-hash",
      role: "USER",
    })
    .returning();
  return user;
}

async function makeProduct(overrides: Partial<typeof products.$inferInsert> = {}) {
  const [product] = await db
    .insert(products)
    .values({
      publicIdentifier: crypto.randomUUID().slice(0, 12),
      sku: `SKU-${crypto.randomUUID().slice(0, 8)}`,
      productName: "Test Product",
      originalPrice: "10.00",
      costPrice: "4.00",
      sellingPrice: "10.00",
      currentQuantity: 10,
      ...overrides,
    })
    .returning();
  return product;
}

describe("completeSale (integration)", () => {
  let userId: string;

  beforeEach(async () => {
    const user = await makeUser();
    userId = user.id;
  });

  afterEach(async () => {
    await db.delete(saleItems);
    await db.delete(sales);
    await db.delete(inventoryTransactions);
    await db.delete(products);
    await db.delete(users);
  });

  it("completes a single-line sale: decrements stock, records sale + item + inventory transaction", async () => {
    const product = await makeProduct({ currentQuantity: 10, costPrice: "4.00" });

    const result = await completeSale({
      items: [{ productId: product.id, quantity: 3, soldPricePerUnit: 12 }],
      userId,
    });

    expect(result.saleNumber).toMatch(/^SALE-\d{6}$/);
    expect(result.totalAmount).toBe("36.00");
    expect(result.totalCost).toBe("12.00");
    expect(result.totalProfit).toBe("24.00");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].quantity).toBe(3);
    expect(result.items[0].profit).toBe("24.00");

    const [updatedProduct] = await db.select().from(products).where(eq(products.id, product.id));
    expect(updatedProduct.currentQuantity).toBe(7);

    const txns = await db
      .select()
      .from(inventoryTransactions)
      .where(eq(inventoryTransactions.productId, product.id));
    expect(txns).toHaveLength(1);
    expect(txns[0].type).toBe("SALE");
    expect(txns[0].quantity).toBe(-3);
    expect(txns[0].referenceId).toBe(result.id);
  });

  it("completes a multi-line sale across different products with correct totals", async () => {
    const productA = await makeProduct({ currentQuantity: 5, costPrice: "2.00" });
    const productB = await makeProduct({ currentQuantity: 8, costPrice: "3.00" });

    const result = await completeSale({
      items: [
        { productId: productA.id, quantity: 2, soldPricePerUnit: 5 },
        { productId: productB.id, quantity: 1, soldPricePerUnit: 6 },
      ],
      userId,
    });

    expect(result.totalAmount).toBe("16.00");
    expect(result.totalCost).toBe("7.00");
    expect(result.totalProfit).toBe("9.00");
    expect(result.items).toHaveLength(2);

    const [updatedA] = await db.select().from(products).where(eq(products.id, productA.id));
    const [updatedB] = await db.select().from(products).where(eq(products.id, productB.id));
    expect(updatedA.currentQuantity).toBe(3);
    expect(updatedB.currentQuantity).toBe(7);
  });

  it("records optional buyer name and phone when provided", async () => {
    const product = await makeProduct();

    const result = await completeSale({
      items: [{ productId: product.id, quantity: 1, soldPricePerUnit: 10 }],
      buyerName: "Jane Doe",
      buyerPhone: "555-0100",
      userId,
    });

    expect(result.buyerName).toBe("Jane Doe");
    expect(result.buyerPhone).toBe("555-0100");
  });

  it("completes a sale for an ARCHIVED product with no status restriction", async () => {
    const product = await makeProduct({ status: "ARCHIVED", currentQuantity: 4 });

    const result = await completeSale({
      items: [{ productId: product.id, quantity: 1, soldPricePerUnit: 10 }],
      userId,
    });

    expect(result.items).toHaveLength(1);
    const [updated] = await db.select().from(products).where(eq(products.id, product.id));
    expect(updated.currentQuantity).toBe(3);
  });

  it("rejects the WHOLE multi-line sale when any one line has insufficient stock, rolling back all lines", async () => {
    const productA = await makeProduct({ currentQuantity: 10 });
    const productB = await makeProduct({ currentQuantity: 1 });

    await expect(
      completeSale({
        items: [
          { productId: productA.id, quantity: 2, soldPricePerUnit: 5 },
          { productId: productB.id, quantity: 5, soldPricePerUnit: 5 }, // exceeds stock of 1
        ],
        userId,
      })
    ).rejects.toBeInstanceOf(InsufficientInventoryError);

    // Line A must NOT have been decremented even though it was valid on its own —
    // the whole transaction rolled back.
    const [updatedA] = await db.select().from(products).where(eq(products.id, productA.id));
    expect(updatedA.currentQuantity).toBe(10);

    const salesCount = await db.select().from(sales);
    expect(salesCount).toHaveLength(0);
  });

  it("throws ProductNotFoundError for an unknown productId", async () => {
    await expect(
      completeSale({
        items: [{ productId: "00000000-0000-0000-0000-000000000000", quantity: 1, soldPricePerUnit: 10 }],
        userId,
      })
    ).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it("generates strictly increasing sale numbers across sequential calls", async () => {
    const product = await makeProduct({ currentQuantity: 10 });

    const first = await completeSale({
      items: [{ productId: product.id, quantity: 1, soldPricePerUnit: 10 }],
      userId,
    });
    const second = await completeSale({
      items: [{ productId: product.id, quantity: 1, soldPricePerUnit: 10 }],
      userId,
    });

    const firstNum = Number(first.saleNumber.replace("SALE-", ""));
    const secondNum = Number(second.saleNumber.replace("SALE-", ""));
    expect(secondNum).toBeGreaterThan(firstNum);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/integration/sale.service.test.ts`
Expected: FAIL — `Cannot find module '@/lib/services/sale.service'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/services/sale.service.ts
import { sql, eq, inArray, asc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { products } from "@/lib/db/schema";
import { insertSale, insertSaleItems, type SaleRow, type SaleItemRow } from "@/lib/repositories/sale.repo";
import { insertInventoryTransaction } from "@/lib/repositories/inventory.repo";
import { ProductNotFoundError } from "@/lib/services/product.service";

export class InsufficientInventoryError extends Error {
  constructor(productId: string, requested: number, available: number) {
    super(
      `Insufficient inventory for product ${productId}: requested ${requested}, only ${available} available`
    );
    this.name = "InsufficientInventoryError";
  }
}

export type CompleteSaleInput = {
  items: { productId: string; quantity: number; soldPricePerUnit: number }[];
  buyerName?: string;
  buyerPhone?: string;
  userId: string;
};

export type SaleWithItems = SaleRow & { items: SaleItemRow[] };

function money(value: number): string {
  return value.toFixed(2);
}

export async function completeSale(input: CompleteSaleInput): Promise<SaleWithItems> {
  return db.transaction(async (tx) => {
    // Lock every DISTINCT product row involved, sorted by id — a stable
    // lock order across all concurrent completeSale calls, so two carts
    // that share two or more products (added in a different order) can
    // never deadlock against each other.
    const productIds = [...new Set(input.items.map((item) => item.productId))].sort();

    const lockedProducts = await tx
      .select()
      .from(products)
      .where(inArray(products.id, productIds))
      .orderBy(asc(products.id))
      .for("update");

    const productById = new Map(lockedProducts.map((p) => [p.id, p]));

    // Validate every line BEFORE writing anything — any single failure
    // must roll back the whole transaction, not just skip that line.
    for (const item of input.items) {
      const product = productById.get(item.productId);
      if (!product) {
        throw new ProductNotFoundError(item.productId);
      }
      if (product.currentQuantity < item.quantity) {
        throw new InsufficientInventoryError(item.productId, item.quantity, product.currentQuantity);
      }
    }

    let totalAmount = 0;
    let totalCost = 0;
    let totalProfit = 0;
    const saleItemsData: {
      productId: string;
      quantity: number;
      costPerUnit: string;
      soldPricePerUnit: string;
      totalCost: string;
      totalRevenue: string;
      profit: string;
    }[] = [];

    for (const item of input.items) {
      const product = productById.get(item.productId)!;
      const costPerUnit = Number(product.costPrice);
      const lineRevenue = item.soldPricePerUnit * item.quantity;
      const lineCost = costPerUnit * item.quantity;
      const lineProfit = lineRevenue - lineCost;

      totalAmount += lineRevenue;
      totalCost += lineCost;
      totalProfit += lineProfit;

      saleItemsData.push({
        productId: item.productId,
        quantity: item.quantity,
        costPerUnit: money(costPerUnit),
        soldPricePerUnit: money(item.soldPricePerUnit),
        totalCost: money(lineCost),
        totalRevenue: money(lineRevenue),
        profit: money(lineProfit),
      });

      await tx
        .update(products)
        .set({ currentQuantity: product.currentQuantity - item.quantity, updatedAt: new Date() })
        .where(eq(products.id, item.productId));
    }

    const [{ nextval }] = await tx.execute<{ nextval: string }>(sql`SELECT nextval('sale_number_seq')`);
    const saleNumber = `SALE-${nextval.padStart(6, "0")}`;

    const sale = await insertSale(
      {
        saleNumber,
        soldBy: input.userId,
        totalAmount: money(totalAmount),
        totalCost: money(totalCost),
        totalProfit: money(totalProfit),
        status: "COMPLETED",
        buyerName: input.buyerName ?? null,
        buyerPhone: input.buyerPhone ?? null,
      },
      tx
    );

    const items = await insertSaleItems(
      saleItemsData.map((item) => ({ ...item, saleId: sale.id })),
      tx
    );

    for (const item of input.items) {
      await insertInventoryTransaction(
        {
          productId: item.productId,
          type: "SALE",
          quantity: -item.quantity,
          referenceId: sale.id,
          notes: `Sale ${saleNumber}`,
          createdBy: input.userId,
        },
        tx
      );
    }

    return { ...sale, items };
  });
}
```

- [ ] **Step 4: Run integration tests to verify they pass**

Run: `npx vitest run tests/integration/sale.service.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Write the failing deterministic lock-order test**

This test does NOT try to force a real two-connection race (this
project's Railway Postgres instance is documented as unreliable for
that — see `tests/unit/inventory.service.concurrency.test.ts`'s
header comment). Instead it mocks `db.transaction` and asserts the
lock query's `where`/`orderBy` arguments reflect a **sorted** id list
regardless of the cart's insertion order — proving the deadlock-safety
property is a property of the code, not of timing.

```typescript
// tests/unit/sale.service.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/client", () => ({
  db: { transaction: vi.fn() },
}));

vi.mock("@/lib/repositories/sale.repo", () => ({
  insertSale: vi.fn(),
  insertSaleItems: vi.fn(),
}));

vi.mock("@/lib/repositories/inventory.repo", () => ({
  insertInventoryTransaction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/services/product.service", () => ({
  ProductNotFoundError: class ProductNotFoundError extends Error {},
}));

// Mock drizzle-orm itself, keeping every real export EXCEPT inArray, which
// is replaced with a spy — this lets the test assert exactly which ids the
// service asked to lock and in what order, without needing to parse
// Drizzle's internal query-builder objects or touch any global prototype.
const inArraySpy = vi.fn((column: unknown, values: string[]) => ({ __inArrayValues: values }));
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, inArray: inArraySpy };
});

import { db } from "@/lib/db/client";
import { insertSale, insertSaleItems } from "@/lib/repositories/sale.repo";
import { completeSale } from "@/lib/services/sale.service";

describe("completeSale — lock ordering (deterministic)", () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockReset();
    vi.mocked(insertSale).mockReset();
    vi.mocked(insertSaleItems).mockReset();
    inArraySpy.mockClear();
  });

  it("locks product rows sorted by id, regardless of the cart's insertion order", async () => {
    // Two product ids where insertion order (B then A) is the REVERSE of
    // sort order — if the service locked in cart order instead of sorted
    // order, this test would catch it.
    const idA = "11111111-1111-1111-1111-111111111111";
    const idB = "22222222-2222-2222-2222-222222222222";

    let capturedOrderByCalled = false;
    let capturedLockStrength: string | undefined;

    vi.mocked(db.transaction).mockImplementation(async (callback) => {
      const fakeTx = {
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => {
                capturedOrderByCalled = true;
                return {
                  for: (strength: string) => {
                    capturedLockStrength = strength;
                    return Promise.resolve([
                      { id: idA, currentQuantity: 10, costPrice: "1.00" },
                      { id: idB, currentQuantity: 10, costPrice: "1.00" },
                    ]);
                  },
                };
              },
            }),
          }),
        }),
        update: () => ({
          set: () => ({ where: () => Promise.resolve() }),
        }),
        execute: () => Promise.resolve([{ nextval: "1" }]),
      };

      return callback(fakeTx as never);
    });

    vi.mocked(insertSale).mockResolvedValue({
      id: "sale-1",
      saleNumber: "SALE-000001",
    } as never);
    vi.mocked(insertSaleItems).mockResolvedValue([] as never);

    await completeSale({
      items: [
        { productId: idB, quantity: 1, soldPricePerUnit: 5 }, // B added first
        { productId: idA, quantity: 1, soldPricePerUnit: 5 }, // A added second
      ],
      userId: "user-1",
    });

    expect(inArraySpy).toHaveBeenCalledTimes(1);
    // The array passed to inArray(...) must be sorted ascending (A before
    // B), regardless of the cart's insertion order (B added before A).
    expect(inArraySpy.mock.calls[0][1]).toEqual([idA, idB]);
    expect(capturedOrderByCalled).toBe(true);
    expect(capturedLockStrength).toBe("update");
  });
});
```

- [ ] **Step 6: Run test to verify it fails, then implementation already satisfies it**

Run: `npx vitest run tests/unit/sale.service.test.ts`
Expected: since Step 3's implementation already calls
`.sort()` on `productIds` and `.orderBy(asc(products.id))` before
`.for("update")`, this test should PASS immediately — it is a
regression guard for this property, not new production code. If it
fails, re-check that `completeSale`'s `productIds` line reads
`[...new Set(input.items.map((item) => item.productId))].sort()`
(lexicographic sort on UUID strings, which is what
`orderBy(asc(products.id))` produces from Postgres too, since UUIDs
compare as text) and that this array is what gets passed as `inArray`'s
second argument.

- [ ] **Step 7: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: PASS — all existing tests plus this task's 8 new ones (7
integration + 1 unit).

- [ ] **Step 8: Commit**

```bash
git add lib/services/sale.service.ts tests/integration/sale.service.test.ts tests/unit/sale.service.test.ts
git commit -m "Add completeSale transaction with sorted multi-row locking"
```

## Task 5: `sale.actions.ts` and `sale.schema.ts`

**Files:**
- Create: `lib/validation/sale.schema.ts`
- Create: `lib/actions/sale.actions.ts`
- Test: `tests/unit/sale.actions.test.ts`

**Interfaces:**
- Consumes: `completeSale`, `InsufficientInventoryError` from
  `lib/services/sale.service.ts` (Task 4); `ProductNotFoundError` from
  `lib/services/product.service.ts` (existing); `requireUser` from
  `lib/auth/guards.ts` (existing); `findProductByPublicIdentifier`,
  `findProductBySku` from `lib/repositories/product.repo.ts`
  (existing, unmodified by Task 3's change).
- Produces: `lookupProductForSale(input): Promise<ProductForSale | null>`,
  `completeSaleAction(input): Promise<{ saleId: string; saleNumber: string }>`
  — Task 8 (`/sell` page) is the consumer of both.

```typescript
type ProductForSale = {
  id: string;
  productName: string;
  sku: string;
  sellingPrice: string | null;
  currentQuantity: number;
};

type CompleteSaleActionInput = {
  items: { productId: string; quantity: number; soldPricePerUnit: number }[];
  buyerName?: string;
  buyerPhone?: string;
};
```

- [ ] **Step 1: Write the Zod schema**

```typescript
// lib/validation/sale.schema.ts
import { z } from "zod";

export const cartLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive("Quantity must be at least 1"),
  soldPricePerUnit: z.number().positive("Sold price must be greater than zero"),
});

export const completeSaleSchema = z.object({
  items: z.array(cartLineSchema).min(1, "Cart must have at least one item"),
  buyerName: z.string().trim().max(255).optional(),
  buyerPhone: z.string().trim().max(50).optional(),
});

export type CartLineInput = z.infer<typeof cartLineSchema>;
export type CompleteSaleInput = z.infer<typeof completeSaleSchema>;
```

- [ ] **Step 2: Write the failing tests**

```typescript
// tests/unit/sale.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/guards", () => ({
  requireUser: vi.fn(),
}));

vi.mock("@/lib/repositories/product.repo", () => ({
  findProductByPublicIdentifier: vi.fn(),
  findProductBySku: vi.fn(),
}));

vi.mock("@/lib/services/sale.service", () => ({
  completeSale: vi.fn(),
  InsufficientInventoryError: class InsufficientInventoryError extends Error {},
}));

import { requireUser } from "@/lib/auth/guards";
import { findProductByPublicIdentifier, findProductBySku } from "@/lib/repositories/product.repo";
import { completeSale } from "@/lib/services/sale.service";
import { lookupProductForSale, completeSaleAction } from "@/lib/actions/sale.actions";

const sessionUser = { id: "user-1", role: "USER" as const, email: "a@example.com" };

describe("lookupProductForSale", () => {
  beforeEach(() => {
    vi.mocked(requireUser).mockReset();
    vi.mocked(findProductByPublicIdentifier).mockReset();
    vi.mocked(findProductBySku).mockReset();
  });

  it("requires authentication before doing anything else", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("not authenticated"));

    await expect(lookupProductForSale({ sku: "SKU-1" })).rejects.toThrow("not authenticated");
    expect(findProductBySku).not.toHaveBeenCalled();
  });

  it("resolves by publicIdentifier and shapes the result for a cart line", async () => {
    vi.mocked(requireUser).mockResolvedValue(sessionUser);
    vi.mocked(findProductByPublicIdentifier).mockResolvedValue({
      id: "prod-1",
      productName: "Widget",
      sku: "SKU-1",
      sellingPrice: "9.99",
      currentQuantity: 20,
    } as never);

    const result = await lookupProductForSale({ publicIdentifier: "abc123" });

    expect(result).toEqual({
      id: "prod-1",
      productName: "Widget",
      sku: "SKU-1",
      sellingPrice: "9.99",
      currentQuantity: 20,
    });
  });

  it("resolves by sku", async () => {
    vi.mocked(requireUser).mockResolvedValue(sessionUser);
    vi.mocked(findProductBySku).mockResolvedValue({
      id: "prod-2",
      productName: "Gadget",
      sku: "SKU-2",
      sellingPrice: null,
      currentQuantity: 5,
    } as never);

    const result = await lookupProductForSale({ sku: "SKU-2" });

    expect(result?.id).toBe("prod-2");
    expect(findProductByPublicIdentifier).not.toHaveBeenCalled();
  });

  it("returns null when nothing matches", async () => {
    vi.mocked(requireUser).mockResolvedValue(sessionUser);
    vi.mocked(findProductBySku).mockResolvedValue(undefined);

    const result = await lookupProductForSale({ sku: "NOPE" });

    expect(result).toBeNull();
  });

  it("throws if called with neither publicIdentifier nor sku", async () => {
    vi.mocked(requireUser).mockResolvedValue(sessionUser);

    await expect(lookupProductForSale({})).rejects.toThrow(
      "lookupProductForSale requires exactly one of publicIdentifier or sku"
    );
  });
});

describe("completeSaleAction", () => {
  beforeEach(() => {
    vi.mocked(requireUser).mockReset();
    vi.mocked(completeSale).mockReset();
  });

  it("requires authentication before calling completeSale", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("not authenticated"));

    await expect(
      completeSaleAction({ items: [{ productId: "prod-1", quantity: 1, soldPricePerUnit: 5 }] })
    ).rejects.toThrow("not authenticated");
    expect(completeSale).not.toHaveBeenCalled();
  });

  it("validates input before calling completeSale, rejecting an empty cart", async () => {
    vi.mocked(requireUser).mockResolvedValue(sessionUser);

    await expect(completeSaleAction({ items: [] })).rejects.toThrow();
    expect(completeSale).not.toHaveBeenCalled();
  });

  it("validates input before calling completeSale, rejecting a zero/negative sold price", async () => {
    vi.mocked(requireUser).mockResolvedValue(sessionUser);

    await expect(
      completeSaleAction({ items: [{ productId: "prod-1", quantity: 1, soldPricePerUnit: 0 }] })
    ).rejects.toThrow();
    expect(completeSale).not.toHaveBeenCalled();
  });

  it("passes the authenticated userId through to completeSale and shapes the return value", async () => {
    vi.mocked(requireUser).mockResolvedValue(sessionUser);
    vi.mocked(completeSale).mockResolvedValue({
      id: "sale-1",
      saleNumber: "SALE-000001",
      items: [],
    } as never);

    const result = await completeSaleAction({
      items: [{ productId: "prod-1", quantity: 2, soldPricePerUnit: 10 }],
      buyerName: "Jane",
    });

    expect(completeSale).toHaveBeenCalledWith({
      items: [{ productId: "prod-1", quantity: 2, soldPricePerUnit: 10 }],
      buyerName: "Jane",
      buyerPhone: undefined,
      userId: "user-1",
    });
    expect(result).toEqual({ saleId: "sale-1", saleNumber: "SALE-000001" });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/sale.actions.test.ts`
Expected: FAIL — `Cannot find module '@/lib/actions/sale.actions'`

- [ ] **Step 4: Write the implementation**

```typescript
// lib/actions/sale.actions.ts
"use server";

import { requireUser } from "@/lib/auth/guards";
import { findProductByPublicIdentifier, findProductBySku } from "@/lib/repositories/product.repo";
import { completeSale as completeSaleService } from "@/lib/services/sale.service";
import { completeSaleSchema } from "@/lib/validation/sale.schema";

export type ProductForSale = {
  id: string;
  productName: string;
  sku: string;
  sellingPrice: string | null;
  currentQuantity: number;
};

export async function lookupProductForSale(input: {
  publicIdentifier?: string;
  sku?: string;
}): Promise<ProductForSale | null> {
  await requireUser();

  const hasIdentifier = Boolean(input.publicIdentifier);
  const hasSku = Boolean(input.sku);
  if (hasIdentifier === hasSku) {
    throw new Error("lookupProductForSale requires exactly one of publicIdentifier or sku");
  }

  const product = hasIdentifier
    ? await findProductByPublicIdentifier(input.publicIdentifier!)
    : await findProductBySku(input.sku!);

  if (!product) return null;

  return {
    id: product.id,
    productName: product.productName,
    sku: product.sku,
    sellingPrice: product.sellingPrice,
    currentQuantity: product.currentQuantity,
  };
}

export async function completeSaleAction(input: {
  items: { productId: string; quantity: number; soldPricePerUnit: number }[];
  buyerName?: string;
  buyerPhone?: string;
}): Promise<{ saleId: string; saleNumber: string }> {
  const user = await requireUser();

  const parsed = completeSaleSchema.parse(input);

  const sale = await completeSaleService({
    items: parsed.items,
    buyerName: parsed.buyerName,
    buyerPhone: parsed.buyerPhone,
    userId: user.id,
  });

  return { saleId: sale.id, saleNumber: sale.saleNumber };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/sale.actions.test.ts`
Expected: PASS (all 9 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/validation/sale.schema.ts lib/actions/sale.actions.ts tests/unit/sale.actions.test.ts
git commit -m "Add sale lookup and checkout server actions"
```

## Task 6: `<ProductSearch>` component

**Files:**
- Create: `components/sell/ProductSearch.tsx`
- Create: `lib/actions/product-search.actions.ts` (small new action —
  see note below)
- Test: `tests/unit/ProductSearch.test.tsx`

**Interfaces:**
- Consumes: `listProducts` from `lib/repositories/product.repo.ts`
  (Task 3's unfiltered-status version); `requireUser` from
  `lib/auth/guards.ts`.
- Produces: `ProductSearch` React component with props `{ onSelect:
  (product: SearchResult) => void }` — Task 8 (`/sell` page) renders
  this directly.

```typescript
type SearchResult = {
  id: string;
  productName: string;
  sku: string;
  sellingPrice: string | null;
  currentQuantity: number;
  status: "ACTIVE" | "ARCHIVED";
};
```

Note on the new action file: `lookupProductForSale` (Task 5) resolves
one exact match by identifier/SKU; this component needs a *fuzzy,
multi-result* search-as-you-type, which is a different shape
(`listProducts`-backed, returns an array). Kept in its own small action
file rather than added to `sale.actions.ts` to keep that file focused
on the checkout flow per this project's one-file-one-responsibility
convention (see `lib/actions/` — `product.actions.ts`,
`inventory.actions.ts`, `scan.actions.ts` are each scoped to one
concern already).

- [ ] **Step 1: Write the search action's failing test**

```typescript
// tests/unit/sale.actions.test.ts -- ADD to the existing file from Task 5,
// do not create a new file for this part. Add these imports alongside the
// existing ones at the top:
//   vi.mock("@/lib/repositories/product.repo", () => ({
//     findProductByPublicIdentifier: vi.fn(),
//     findProductBySku: vi.fn(),
//     listProducts: vi.fn(),
//   }));
//   import { listProducts } from "@/lib/repositories/product.repo";
//   import { searchProductsForSale } from "@/lib/actions/product-search.actions";
//
// Then add this describe block:

describe("searchProductsForSale", () => {
  beforeEach(() => {
    vi.mocked(requireUser).mockReset();
    vi.mocked(listProducts).mockReset();
  });

  it("requires authentication", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("not authenticated"));

    await expect(searchProductsForSale("widget")).rejects.toThrow("not authenticated");
    expect(listProducts).not.toHaveBeenCalled();
  });

  it("searches across all statuses (archived products are sellable) and shapes results", async () => {
    vi.mocked(requireUser).mockResolvedValue(sessionUser);
    vi.mocked(listProducts).mockResolvedValue([
      {
        id: "prod-1",
        productName: "Widget A",
        sku: "SKU-A",
        sellingPrice: "9.99",
        currentQuantity: 5,
        status: "ACTIVE",
      },
      {
        id: "prod-2",
        productName: "Widget B",
        sku: "SKU-B",
        sellingPrice: "12.00",
        currentQuantity: 0,
        status: "ARCHIVED",
      },
    ] as never);

    const results = await searchProductsForSale("widget");

    expect(listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ search: "widget", status: undefined })
    );
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      id: "prod-1",
      productName: "Widget A",
      sku: "SKU-A",
      sellingPrice: "9.99",
      currentQuantity: 5,
      status: "ACTIVE",
    });
  });

  it("returns an empty array for a blank query without calling listProducts", async () => {
    vi.mocked(requireUser).mockResolvedValue(sessionUser);

    const results = await searchProductsForSale("   ");

    expect(results).toEqual([]);
    expect(listProducts).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/sale.actions.test.ts`
Expected: FAIL — `Cannot find module '@/lib/actions/product-search.actions'`

- [ ] **Step 3: Write the search action implementation**

```typescript
// lib/actions/product-search.actions.ts
"use server";

import { requireUser } from "@/lib/auth/guards";
import { listProducts } from "@/lib/repositories/product.repo";

export type ProductSearchResult = {
  id: string;
  productName: string;
  sku: string;
  sellingPrice: string | null;
  currentQuantity: number;
  status: "ACTIVE" | "ARCHIVED";
};

const SEARCH_RESULT_LIMIT = 10;

export async function searchProductsForSale(query: string): Promise<ProductSearchResult[]> {
  await requireUser();

  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const results = await listProducts({
    search: trimmed,
    status: undefined,
    limit: SEARCH_RESULT_LIMIT,
    offset: 0,
  });

  return results.map((product) => ({
    id: product.id,
    productName: product.productName,
    sku: product.sku,
    sellingPrice: product.sellingPrice,
    currentQuantity: product.currentQuantity,
    status: product.status,
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/sale.actions.test.ts`
Expected: PASS (all tests in the file, including Task 5's 9 plus this
task's 3)

- [ ] **Step 5: Write the failing component test**

```typescript
// tests/unit/ProductSearch.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/actions/product-search.actions", () => ({
  searchProductsForSale: vi.fn(),
}));

import { searchProductsForSale } from "@/lib/actions/product-search.actions";
import { ProductSearch } from "@/components/sell/ProductSearch";

describe("ProductSearch", () => {
  beforeEach(() => {
    vi.mocked(searchProductsForSale).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows nothing before any input", () => {
    render(<ProductSearch onSelect={vi.fn()} />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("shows two distinct results, disambiguated by SKU, for a query matching two products", async () => {
    vi.mocked(searchProductsForSale).mockResolvedValue([
      { id: "prod-1", productName: "Widget", sku: "SKU-A", sellingPrice: "9.99", currentQuantity: 5, status: "ACTIVE" },
      { id: "prod-2", productName: "Widget", sku: "SKU-B", sellingPrice: "12.00", currentQuantity: 2, status: "ACTIVE" },
    ]);

    render(<ProductSearch onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Widget" } });

    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    expect(screen.getByText("SKU-A")).toBeInTheDocument();
    expect(screen.getByText("SKU-B")).toBeInTheDocument();
  });

  it("calls onSelect with the specific tapped product, not just a name match", async () => {
    vi.mocked(searchProductsForSale).mockResolvedValue([
      { id: "prod-1", productName: "Widget", sku: "SKU-A", sellingPrice: "9.99", currentQuantity: 5, status: "ACTIVE" },
      { id: "prod-2", productName: "Widget", sku: "SKU-B", sellingPrice: "12.00", currentQuantity: 2, status: "ACTIVE" },
    ]);
    const onSelect = vi.fn();

    render(<ProductSearch onSelect={onSelect} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Widget" } });

    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    fireEvent.click(screen.getByText("SKU-B"));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "prod-2", sku: "SKU-B" })
    );
  });

  it("clears results when the query is cleared back to empty", async () => {
    vi.mocked(searchProductsForSale).mockResolvedValue([
      { id: "prod-1", productName: "Widget", sku: "SKU-A", sellingPrice: "9.99", currentQuantity: 5, status: "ACTIVE" },
    ]);

    render(<ProductSearch onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Widget" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });

    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx vitest run tests/unit/ProductSearch.test.tsx`
Expected: FAIL — `Cannot find module '@/components/sell/ProductSearch'`

- [ ] **Step 7: Write the component implementation**

```tsx
// components/sell/ProductSearch.tsx
"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  searchProductsForSale,
  type ProductSearchResult,
} from "@/lib/actions/product-search.actions";

type ProductSearchProps = {
  onSelect: (product: ProductSearchResult) => void;
};

const DEBOUNCE_MS = 300;

export function ProductSearch({ onSelect }: ProductSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductSearchResult[]>([]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setResults([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      const found = await searchProductsForSale(trimmed);
      if (!cancelled) setResults(found);
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="space-y-2">
      <Input
        role="searchbox"
        placeholder="Search by product name or SKU"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {results.length > 0 && (
        <ul role="listbox" className="space-y-1 rounded-md border p-2">
          {results.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => onSelect(product)}
                className="flex w-full items-center justify-between rounded p-2 text-left hover:bg-accent"
              >
                <span>
                  {product.productName}
                  {product.status === "ARCHIVED" && (
                    <span className="ml-2 text-xs text-muted-foreground">(Archived)</span>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">{product.sku}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run tests/unit/ProductSearch.test.tsx`
Expected: PASS (all 4 tests)

- [ ] **Step 9: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: PASS (all existing tests plus this task's tests)

- [ ] **Step 10: Commit**

```bash
git add lib/actions/product-search.actions.ts components/sell/ProductSearch.tsx tests/unit/sale.actions.test.ts tests/unit/ProductSearch.test.tsx
git commit -m "Add product search fallback for the sell flow"
```

## Task 7: `<SellCart>` component

**Files:**
- Create: `components/sell/SellCart.tsx`
- Test: `tests/unit/SellCart.test.tsx`

**Interfaces:**
- Consumes: nothing external — pure presentational component driven by
  props.
- Produces: `SellCart` React component — Task 8 (`/sell` page) renders
  this directly and owns all state it displays/mutates.

```typescript
type CartLine = {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  soldPricePerUnit: number;
  knownStock: number;
};

type SellCartProps = {
  lines: CartLine[];
  onQuantityChange: (productId: string, quantity: number) => void;
  onPriceChange: (productId: string, price: number) => void;
  onRemove: (productId: string) => void;
};
```

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/SellCart.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SellCart } from "@/components/sell/SellCart";

const lines = [
  { productId: "prod-1", productName: "Widget", sku: "SKU-A", quantity: 2, soldPricePerUnit: 10, knownStock: 5 },
  { productId: "prod-2", productName: "Gadget", sku: "SKU-B", quantity: 1, soldPricePerUnit: 20, knownStock: 3 },
];

describe("SellCart", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows an empty-cart message when there are no lines", () => {
    render(<SellCart lines={[]} onQuantityChange={vi.fn()} onPriceChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText(/scan or search a product/i)).toBeInTheDocument();
  });

  it("renders one row per line with the correct running total", () => {
    render(<SellCart lines={lines} onQuantityChange={vi.fn()} onPriceChange={vi.fn()} onRemove={vi.fn()} />);

    expect(screen.getByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("Gadget")).toBeInTheDocument();
    // 2 * 10 + 1 * 20 = 40
    expect(screen.getByText("$40.00")).toBeInTheDocument();
  });

  it("shows a stock warning when quantity exceeds knownStock", () => {
    const overStockLines = [
      { productId: "prod-1", productName: "Widget", sku: "SKU-A", quantity: 9, soldPricePerUnit: 10, knownStock: 5 },
    ];
    render(<SellCart lines={overStockLines} onQuantityChange={vi.fn()} onPriceChange={vi.fn()} onRemove={vi.fn()} />);

    expect(screen.getByText(/only 5 in stock/i)).toBeInTheDocument();
  });

  it("calls onQuantityChange when the stepper is used", () => {
    const onQuantityChange = vi.fn();
    render(<SellCart lines={lines} onQuantityChange={onQuantityChange} onPriceChange={vi.fn()} onRemove={vi.fn()} />);

    fireEvent.click(screen.getAllByRole("button", { name: "+" })[0]);

    expect(onQuantityChange).toHaveBeenCalledWith("prod-1", 3);
  });

  it("removes the line when the stepper is decremented below 1", () => {
    const onRemove = vi.fn();
    const singleQtyLine = [
      { productId: "prod-1", productName: "Widget", sku: "SKU-A", quantity: 1, soldPricePerUnit: 10, knownStock: 5 },
    ];
    render(<SellCart lines={singleQtyLine} onQuantityChange={vi.fn()} onPriceChange={vi.fn()} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole("button", { name: "−" }));

    expect(onRemove).toHaveBeenCalledWith("prod-1");
  });

  it("calls onPriceChange when the price input changes", () => {
    const onPriceChange = vi.fn();
    render(<SellCart lines={lines} onQuantityChange={vi.fn()} onPriceChange={onPriceChange} onRemove={vi.fn()} />);

    const priceInputs = screen.getAllByLabelText(/sold price/i);
    fireEvent.change(priceInputs[0], { target: { value: "15" } });

    expect(onPriceChange).toHaveBeenCalledWith("prod-1", 15);
  });

  it("calls onRemove when the remove button is clicked", () => {
    const onRemove = vi.fn();
    render(<SellCart lines={lines} onQuantityChange={vi.fn()} onPriceChange={vi.fn()} onRemove={onRemove} />);

    fireEvent.click(screen.getAllByRole("button", { name: /remove/i })[1]);

    expect(onRemove).toHaveBeenCalledWith("prod-2");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/SellCart.test.tsx`
Expected: FAIL — `Cannot find module '@/components/sell/SellCart'`

- [ ] **Step 3: Write the implementation**

```tsx
// components/sell/SellCart.tsx
"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type CartLine = {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  soldPricePerUnit: number;
  knownStock: number;
};

type SellCartProps = {
  lines: CartLine[];
  onQuantityChange: (productId: string, quantity: number) => void;
  onPriceChange: (productId: string, price: number) => void;
  onRemove: (productId: string) => void;
};

export function SellCart({ lines, onQuantityChange, onPriceChange, onRemove }: SellCartProps) {
  if (lines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Scan or search a product to add it to this sale.
      </p>
    );
  }

  const total = lines.reduce((sum, line) => sum + line.quantity * line.soldPricePerUnit, 0);

  return (
    <div className="space-y-3">
      {lines.map((line) => (
        <div key={line.productId} className="space-y-1 rounded-md border p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{line.productName}</p>
              <p className="text-xs text-muted-foreground">{line.sku}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Remove"
              onClick={() => onRemove(line.productId)}
            >
              Remove
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="−"
                onClick={() =>
                  line.quantity <= 1
                    ? onRemove(line.productId)
                    : onQuantityChange(line.productId, line.quantity - 1)
                }
              >
                −
              </Button>
              <span className="w-8 text-center">{line.quantity}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="+"
                onClick={() => onQuantityChange(line.productId, line.quantity + 1)}
              >
                +
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Label htmlFor={`price-${line.productId}`}>Sold price</Label>
              <Input
                id={`price-${line.productId}`}
                type="number"
                step="0.01"
                min="0"
                value={line.soldPricePerUnit}
                onChange={(event) => onPriceChange(line.productId, Number(event.target.value))}
                className="w-24"
              />
            </div>

            <span className="ml-auto text-sm font-medium">
              ${(line.quantity * line.soldPricePerUnit).toFixed(2)}
            </span>
          </div>

          {line.quantity > line.knownStock && (
            <p className="text-xs text-destructive">
              Only {line.knownStock} in stock — this line may fail at checkout.
            </p>
          )}
        </div>
      ))}

      <div className="flex items-center justify-between border-t pt-3 font-semibold">
        <span>Total</span>
        <span>${total.toFixed(2)}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/SellCart.test.tsx`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add components/sell/SellCart.tsx tests/unit/SellCart.test.tsx
git commit -m "Add SellCart presentational component"
```

## Task 8: `/sell` page

**Files:**
- Create: `app/(app)/sell/page.tsx`
- Test: `tests/unit/sell.page.test.tsx`

**Interfaces:**
- Consumes: `QrScanner` from `components/scan/QrScanner.tsx` (Phase 5,
  unmodified); `parseQrPayload` from `lib/scan/parse-qr-payload.ts`
  (Phase 5, unmodified); `ProductSearch` from
  `components/sell/ProductSearch.tsx` (Task 6); `SellCart` +
  `CartLine` type from `components/sell/SellCart.tsx` (Task 7);
  `lookupProductForSale` from `lib/actions/sale.actions.ts` (Task 5);
  `completeSaleAction` from `lib/actions/sale.actions.ts` (Task 5).
- Produces: the `/sell` route. Nothing else depends on this file.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/unit/sell.page.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

let capturedOnDecode: ((text: string) => void) | null = null;
let scannerMounted = false;

vi.mock("@/components/scan/QrScanner", () => ({
  QrScanner: ({ onDecode }: { onDecode: (text: string) => void }) => {
    capturedOnDecode = onDecode;
    scannerMounted = true;
    return <div data-testid="qr-scanner-stub" />;
  },
}));

let capturedOnSelect: ((product: unknown) => void) | null = null;
vi.mock("@/components/sell/ProductSearch", () => ({
  ProductSearch: ({ onSelect }: { onSelect: (product: unknown) => void }) => {
    capturedOnSelect = onSelect;
    return <div data-testid="product-search-stub" />;
  },
}));

vi.mock("@/lib/actions/sale.actions", () => ({
  lookupProductForSale: vi.fn(),
  completeSaleAction: vi.fn(),
}));

import { lookupProductForSale, completeSaleAction } from "@/lib/actions/sale.actions";
import SellPage from "@/app/(app)/sell/page";

const productA = {
  id: "prod-1",
  productName: "Widget",
  sku: "SKU-A",
  sellingPrice: "10.00",
  currentQuantity: 5,
};

describe("SellPage", () => {
  beforeEach(() => {
    pushMock.mockReset();
    vi.mocked(lookupProductForSale).mockReset();
    vi.mocked(completeSaleAction).mockReset();
    capturedOnDecode = null;
    capturedOnSelect = null;
    scannerMounted = false;
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the scanner and product search in the cart-building view", () => {
    render(<SellPage />);

    expect(screen.getByTestId("qr-scanner-stub")).toBeInTheDocument();
    expect(screen.getByTestId("product-search-stub")).toBeInTheDocument();
    expect(scannerMounted).toBe(true);
  });

  it("adding a product via scan creates a cart line", async () => {
    vi.mocked(lookupProductForSale).mockResolvedValue(productA);
    render(<SellPage />);

    capturedOnDecode!("https://example.com/p/abc123");

    await waitFor(() => expect(screen.getByText("Widget")).toBeInTheDocument());
  });

  it("scanning the same product twice increments quantity instead of duplicating the line", async () => {
    vi.mocked(lookupProductForSale).mockResolvedValue(productA);
    render(<SellPage />);

    capturedOnDecode!("https://example.com/p/abc123");
    await waitFor(() => expect(screen.getByText("Widget")).toBeInTheDocument());

    capturedOnDecode!("https://example.com/p/abc123");

    await waitFor(() => expect(screen.getAllByText("Widget")).toHaveLength(1));
    expect(screen.getByText("2")).toBeInTheDocument(); // quantity stepper display
  });

  it("adding a product via search also increments an existing line for the same product", async () => {
    vi.mocked(lookupProductForSale).mockResolvedValue(productA);
    render(<SellPage />);

    capturedOnDecode!("https://example.com/p/abc123");
    await waitFor(() => expect(screen.getByText("Widget")).toBeInTheDocument());

    capturedOnSelect!(productA);

    await waitFor(() => expect(screen.getAllByText("Widget")).toHaveLength(1));
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("Checkout is disabled when the cart is empty", () => {
    render(<SellPage />);
    expect(screen.getByRole("button", { name: /checkout/i })).toBeDisabled();
  });

  it("moving to checkout unmounts the QrScanner", async () => {
    vi.mocked(lookupProductForSale).mockResolvedValue(productA);
    render(<SellPage />);

    capturedOnDecode!("https://example.com/p/abc123");
    await waitFor(() => expect(screen.getByText("Widget")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /checkout/i }));

    await waitFor(() => expect(screen.queryByTestId("qr-scanner-stub")).not.toBeInTheDocument());
  });

  it("confirming a sale calls completeSaleAction and navigates to the sale detail page", async () => {
    vi.mocked(lookupProductForSale).mockResolvedValue(productA);
    vi.mocked(completeSaleAction).mockResolvedValue({ saleId: "sale-1", saleNumber: "SALE-000001" });
    render(<SellPage />);

    capturedOnDecode!("https://example.com/p/abc123");
    await waitFor(() => expect(screen.getByText("Widget")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /checkout/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /confirm sale/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /confirm sale/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/sales/sale-1"));
    expect(completeSaleAction).toHaveBeenCalledWith({
      items: [{ productId: "prod-1", quantity: 1, soldPricePerUnit: 10 }],
      buyerName: undefined,
      buyerPhone: undefined,
    });
  });

  it("returns to the cart-building view with cart intact when checkout fails", async () => {
    vi.mocked(lookupProductForSale).mockResolvedValue(productA);
    vi.mocked(completeSaleAction).mockRejectedValue(new Error("Insufficient inventory for product prod-1"));
    render(<SellPage />);

    capturedOnDecode!("https://example.com/p/abc123");
    await waitFor(() => expect(screen.getByText("Widget")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /checkout/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /confirm sale/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /confirm sale/i }));

    await waitFor(() => expect(screen.getByText(/insufficient inventory/i)).toBeInTheDocument());
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByText("Widget")).toBeInTheDocument(); // cart line still present
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/sell.page.test.tsx`
Expected: FAIL — `Cannot find module '@/app/(app)/sell/page'`

- [ ] **Step 3: Write the implementation**

```tsx
// app/(app)/sell/page.tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { QrScanner } from "@/components/scan/QrScanner";
import { parseQrPayload } from "@/lib/scan/parse-qr-payload";
import { ProductSearch } from "@/components/sell/ProductSearch";
import { SellCart, type CartLine } from "@/components/sell/SellCart";
import { lookupProductForSale, completeSaleAction } from "@/lib/actions/sale.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const NOT_RECOGNIZED_ERROR = "Not a recognized product QR code";
const NOT_FOUND_ERROR = "Product not found — it may have been removed or its QR code regenerated.";

type View = "cart" | "checkout";

export default function SellPage() {
  const router = useRouter();
  const [view, setView] = useState<View>("cart");
  const [lines, setLines] = useState<CartLine[]>([]);
  const [addError, setAddError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [buyerName, setBuyerName] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [isPending, startTransition] = useTransition();
  const resolvingRef = useRef(false);

  function addOrIncrement(product: {
    id: string;
    productName: string;
    sku: string;
    sellingPrice: string | null;
    currentQuantity: number;
  }) {
    setLines((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (existing) {
        return current.map((line) =>
          line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line
        );
      }
      return [
        ...current,
        {
          productId: product.id,
          productName: product.productName,
          sku: product.sku,
          quantity: 1,
          soldPricePerUnit: product.sellingPrice ? Number(product.sellingPrice) : 0,
          knownStock: product.currentQuantity,
        },
      ];
    });
  }

  async function handleDecode(text: string) {
    if (resolvingRef.current) return;

    const parsed = parseQrPayload(text);
    if (!parsed) {
      setAddError(NOT_RECOGNIZED_ERROR);
      return;
    }

    resolvingRef.current = true;
    setAddError(null);
    const product = await lookupProductForSale({ publicIdentifier: parsed.publicIdentifier });
    resolvingRef.current = false;

    if (!product) {
      setAddError(NOT_FOUND_ERROR);
      return;
    }
    addOrIncrement(product);
  }

  function handleSearchSelect(product: {
    id: string;
    productName: string;
    sku: string;
    sellingPrice: string | null;
    currentQuantity: number;
  }) {
    setAddError(null);
    addOrIncrement(product);
  }

  function handleQuantityChange(productId: string, quantity: number) {
    setLines((current) =>
      current.map((line) => (line.productId === productId ? { ...line, quantity } : line))
    );
  }

  function handlePriceChange(productId: string, price: number) {
    setLines((current) =>
      current.map((line) => (line.productId === productId ? { ...line, soldPricePerUnit: price } : line))
    );
  }

  function handleRemove(productId: string) {
    setLines((current) => current.filter((line) => line.productId !== productId));
  }

  function handleConfirm() {
    setCheckoutError(null);
    startTransition(async () => {
      try {
        const result = await completeSaleAction({
          items: lines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            soldPricePerUnit: line.soldPricePerUnit,
          })),
          buyerName: buyerName.trim() || undefined,
          buyerPhone: buyerPhone.trim() || undefined,
        });
        router.push(`/sales/${result.saleId}`);
      } catch (error) {
        setCheckoutError(error instanceof Error ? error.message : "Failed to complete sale");
      }
    });
  }

  if (view === "checkout") {
    return (
      <div className="mx-auto max-w-sm space-y-6 p-6">
        <h1 className="text-xl font-semibold">Confirm Sale</h1>

        <SellCart
          lines={lines}
          onQuantityChange={handleQuantityChange}
          onPriceChange={handlePriceChange}
          onRemove={handleRemove}
        />

        <div className="space-y-2">
          <Label htmlFor="buyer-name">Buyer name (optional)</Label>
          <Input id="buyer-name" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="buyer-phone">Buyer phone (optional)</Label>
          <Input id="buyer-phone" value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)} />
        </div>

        {checkoutError && (
          <p role="alert" className="text-sm text-destructive">
            {checkoutError}
          </p>
        )}

        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setView("cart")} disabled={isPending}>
            Back to cart
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={isPending}>
            Confirm Sale
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm space-y-6 p-6">
      <h1 className="text-xl font-semibold">Sell</h1>

      <QrScanner onDecode={handleDecode} paused={false} />
      <ProductSearch onSelect={handleSearchSelect} />

      {addError && (
        <p role="alert" className="text-sm text-destructive">
          {addError}
        </p>
      )}

      <SellCart
        lines={lines}
        onQuantityChange={handleQuantityChange}
        onPriceChange={handlePriceChange}
        onRemove={handleRemove}
      />

      <Button type="button" onClick={() => setView("checkout")} disabled={lines.length === 0}>
        Checkout
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/sell.page.test.tsx`
Expected: PASS (all 9 tests)

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: PASS (all existing tests plus this task's tests)

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/sell/page.tsx" tests/unit/sell.page.test.tsx
git commit -m "Add /sell page wiring scanner, search, cart, and checkout"
```

## Task 9: `/sales` list page

**Files:**
- Create: `app/(app)/sales/page.tsx`

**Interfaces:**
- Consumes: `listSales`, `countSales` from
  `lib/repositories/sale.repo.ts` (Task 2); `findUserNamesByIds` from
  `lib/repositories/user.repo.ts` (existing); `requireUser` from
  `lib/auth/guards.ts` (existing).
- Produces: the `/sales` route (each row links to its own
  `/sales/[id]` detail page, Task 10). Nothing else depends on this
  file's exports (it has none — a server component page); navigating
  back from a sale detail page to this list relies on Task 11's nav
  link, not a page-level back button.

This task has no isolated unit test of its own (same as
`app/(app)/products/[id]/history/page.tsx`, which this task mirrors
structurally — no dedicated test file exists for that page either in
this codebase; its correctness is covered by the repository-level
tests from Task 2 plus this task's own manual build/smoke verification
in Step 3 below).

- [ ] **Step 1: Read the reference page**

Read `app/(app)/products/[id]/history/page.tsx` in full — this task
reuses its exact pagination pattern (`PAGE_SIZE` constant,
`searchParams` promise, `Math.max(1, Number(pageParam) || 1)`,
`Table`/`TableHeader`/`TableBody` components, Prev/Next via
`Button render={<Link>}`).

- [ ] **Step 2: Write the implementation**

```tsx
// app/(app)/sales/page.tsx
import Link from "next/link";
import { requireUser } from "@/lib/auth/guards";
import { listSales, countSales } from "@/lib/repositories/sale.repo";
import { findUserNamesByIds } from "@/lib/repositories/user.repo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PAGE_SIZE = 25;

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireUser();
  const { page: pageParam } = await searchParams;

  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [salesList, total] = await Promise.all([
    listSales({ limit: PAGE_SIZE, offset }),
    countSales(),
  ]);

  const userIds = [...new Set(salesList.map((s) => s.soldBy))];
  const userNameById = await findUserNamesByIds(userIds);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-semibold">Sales</h1>

      {salesList.length === 0 ? (
        <p className="text-muted-foreground">No sales yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sale #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Buyer</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Sold By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {salesList.map((sale) => (
                <TableRow key={sale.id}>
                  <TableCell>
                    <Link href={`/sales/${sale.id}`} className="underline">
                      {sale.saleNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{sale.soldAt.toLocaleString()}</TableCell>
                  <TableCell>{sale.buyerName ?? "—"}</TableCell>
                  <TableCell>${sale.totalAmount}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{sale.status}</Badge>
                  </TableCell>
                  <TableCell>{userNameById.get(sale.soldBy) ?? "Unknown"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages} ({total} sales)
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Button variant="outline" size="sm" render={<Link href={`/sales?page=${page - 1}`}>Previous</Link>} />
            )}
            {page < totalPages && (
              <Button variant="outline" size="sm" render={<Link href={`/sales?page=${page + 1}`}>Next</Link>} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify manually with the dev server**

Run: `npm run dev`, navigate to `/sales` while logged in.
Expected: page loads with no runtime errors, shows "No sales yet."
against a fresh/empty dataset, or a paginated table if sales already
exist from earlier tasks' integration tests (those tests clean up
after themselves via `afterEach`, so this should normally be empty
unless you've manually created a sale through `/sell` already).

- [ ] **Step 4: Run the full test suite and build to confirm no regressions**

Run: `npm test && npm run build`
Expected: PASS — all tests green, build succeeds with `/sales` listed
in the route table.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/sales/page.tsx"
git commit -m "Add /sales list page"
```

## Task 10: `/sales/[id]` detail page

**Files:**
- Create: `app/(app)/sales/[id]/page.tsx`
- Test: `tests/integration/sale.repo.test.ts` (already covers
  `findSaleById` from Task 2 — no new repository test needed here)

**Interfaces:**
- Consumes: `findSaleById` from `lib/repositories/sale.repo.ts` (Task
  2); `findUserNamesByIds` from `lib/repositories/user.repo.ts`
  (existing); `requireUser` from `lib/auth/guards.ts` (existing).
- Produces: the `/sales/[id]` route — Task 8's `/sell` page
  `router.push`es here on a successful checkout.

Same no-dedicated-page-test rationale as Task 9 (matches this
codebase's existing convention for `/products/[id]` and
`/products/[id]/history`, neither of which has its own page-level test
file — correctness here rests on Task 2's `findSaleById` repository
test plus this task's manual verification step).

- [ ] **Step 1: Read the reference page**

Read `app/(app)/products/[id]/page.tsx` in full for the 404-on-missing
pattern (`notFound()` from `next/navigation`) this task reuses.

- [ ] **Step 2: Write the implementation**

```tsx
// app/(app)/sales/[id]/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth/guards";
import { findSaleById } from "@/lib/repositories/sale.repo";
import { findUserNamesByIds } from "@/lib/repositories/user.repo";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function SaleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  const sale = await findSaleById(id);
  if (!sale) notFound();

  const userNameById = await findUserNamesByIds([sale.soldBy]);

  return (
    <div className="p-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{sale.saleNumber}</h1>
        <p className="text-muted-foreground">
          {sale.soldAt.toLocaleString()} · Sold by {userNameById.get(sale.soldBy) ?? "Unknown"}
        </p>
        <Badge variant="secondary" className="mt-2">
          {sale.status}
        </Badge>
      </div>

      {(sale.buyerName || sale.buyerPhone) && (
        <div className="text-sm">
          <p className="font-medium">Buyer</p>
          {sale.buyerName && <p>{sale.buyerName}</p>}
          {sale.buyerPhone && <p className="text-muted-foreground">{sale.buyerPhone}</p>}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Sold Price</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Revenue</TableHead>
              <TableHead>Profit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sale.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <Link href={`/products/${item.productId}`} className="underline">
                    View product
                  </Link>
                </TableCell>
                <TableCell>{item.quantity}</TableCell>
                <TableCell>${item.soldPricePerUnit}</TableCell>
                <TableCell>${item.costPerUnit}</TableCell>
                <TableCell>${item.totalRevenue}</TableCell>
                <TableCell>${item.profit}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-end gap-6 text-sm font-medium">
        <span>Total cost: ${sale.totalCost}</span>
        <span>Total revenue: ${sale.totalAmount}</span>
        <span>Total profit: ${sale.totalProfit}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify manually with the dev server**

Run: `npm run dev`, complete a real sale through `/sell`, confirm it
navigates to `/sales/[id]` and every field (buyer info if entered, line
items, totals) renders correctly; visit `/sales/00000000-0000-0000-0000-000000000000`
directly and confirm a 404 page renders.

- [ ] **Step 4: Run the full test suite and build to confirm no regressions**

Run: `npm test && npm run build`
Expected: PASS — all tests green, build succeeds with `/sales/[id]`
listed in the route table.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/sales/[id]/page.tsx"
git commit -m "Add /sales/[id] detail page"
```

## Task 11: Navigation links

**Files:** none expected — see Step 1, this task may turn out to need
no changes at all.

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing other tasks depend on — this is the final wiring
  check.

- [ ] **Step 1: Read both files and check whether the links already exist**

Read `components/nav/DesktopSidebar.tsx` and `components/nav/MobileNav.tsx`
in full. As of this plan being written, **both files already contain**
`{ href: "/sell", label: "Sell", icon: ShoppingCart }` and
`{ href: "/sales", label: "Sales", icon: Receipt }` entries, with
`ShoppingCart`/`Receipt` already imported from `lucide-react` in both
files — pre-wired ahead of this phase, the same way `/scan`'s entry was
pre-wired ahead of Phase 5. If you find this is still true when you
reach this task, **no code change is needed** — proceed directly to
Step 2 to confirm the routes actually resolve now that Tasks 8-10 have
created them, then Step 4 to commit nothing (skip Step 3's commit).

If a fresh read of either file shows the entries are *missing*
(e.g. someone reverted them, or this plan is being run against a
different starting point than expected), add them following the exact
existing object-array shape each file already uses for its other
entries (`{ href, label, icon }`), positioned after the `/scan` entry,
reusing each file's already-imported `ShoppingCart`/`Receipt` icons —
do not add a new icon import if one is already present.

- [ ] **Step 2: Verify manually with the dev server**

Run: `npm run dev`, confirm both "Sell" and "Sales" links appear in the
sidebar (desktop width) and bottom nav (mobile width) and navigate to
the correct, now-functional `/sell` and `/sales` routes (previously
these links existed but 404'd, since the routes didn't exist until
Tasks 8-10 of this plan).

- [ ] **Step 3: If you made a code change in Step 1, commit it**

```bash
git add components/nav/DesktopSidebar.tsx components/nav/MobileNav.tsx
git commit -m "Link Sell and Sales pages from navigation"
```

## Task 12: Manual real-device verification checklist

**Files:** none (no code changes — this task records manual
verification, mirroring Phase 5's Task 6).

**Interfaces:** none.

- [ ] **Step 1: Run the app and reach `/sell`**

```bash
npm run dev
```

Log in, tap "Sell" in the mobile nav / sidebar.

- [ ] **Step 2: Build a multi-product cart via scanning**

On a mobile device, scan two or more different real products' QR
codes. Confirm each appears as its own cart line with the correct
name/SKU/default price, and confirm scanning the same product a second
time increments its existing line instead of duplicating it.

- [ ] **Step 3: Add a product via search**

Use the search fallback to find and add a product by typing part of
its name, then part of its SKU. Confirm both find the right product
and tapping a result adds/increments it in the cart exactly like a
scan does.

- [ ] **Step 4: Edit a cart line**

Change a line's quantity via the +/- steppers and its sold price via
the input. Confirm the line subtotal and cart total update correctly.
Decrement a line's quantity down to 0 and confirm it's removed from
the cart.

- [ ] **Step 5: Complete a sale**

Tap Checkout, confirm the QrScanner's camera indicator turns off
(scanner unmounted), optionally enter a buyer name/phone, tap Confirm
Sale. Confirm it navigates to `/sales/[id]` showing the correct line
items, totals, and buyer info if entered.

- [ ] **Step 6: Verify the insufficient-stock rejection path**

Using a real product's admin adjust-stock page (Phase 4), temporarily
set a product's quantity to something small (e.g. 1). Add it to a
cart with a requested quantity higher than that (e.g. 5) alongside at
least one other valid product, attempt checkout, and confirm: the
whole sale is rejected with a clear error, the OTHER valid line was
NOT sold (its product's stock is unchanged), and the cart still shows
both lines so you can correct the quantity and retry. Restore the
product's original stock quantity afterward.

- [ ] **Step 7: Verify `/sales` and `/sales/[id]`**

Navigate to `/sales`, confirm the sale(s) from Steps 5-6 appear with
correct totals and buyer info (if any), newest first. Tap into one and
confirm every line item's product link navigates to that product's
detail page.

- [ ] **Step 8: Record the result**

Report back (in the PR description or final review notes) which
devices/browsers were checked and their outcome. This step has no
commit — it is a verification gate the user confirms before merge, not
something a subagent can complete unattended.

---
