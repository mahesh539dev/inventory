# Phase 8 — Dashboard/Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/dashboard` (today + month-to-date summary tiles, recent sales, low stock) and `/reports` (date-range-filtered summary + product/category breakdown table) for any signed-in user.

**Architecture:** New read-only aggregate query functions in the repository layer (`sale.repo.ts`, `product.repo.ts`) compute gross and returns-deducted sums directly in Postgres; two new/rewritten server-component pages call them and pass plain data down to small presentational components; one client component (`ReportsDateRangeFilter`) drives `/reports`' URL search params, mirroring Phase 7's `SalesFilterBar`.

**Tech Stack:** Next.js 16 (App Router, server components), Drizzle ORM, PostgreSQL, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-26-phase8-dashboard-reports-design.md`

## Global Constraints

- No schema changes. No new mutations, transactions, or row locking — every new query is a plain read.
- `LOW_STOCK_THRESHOLD = 5` (from `lib/constants.ts`) is fixed and app-wide, not configurable in this phase.
- A cancelled sale's `sale_items` rows have `returnedQuantity = quantity` on every line (the same field partial/full returns use) — there is no separate "cancelled" code path in any aggregate query. Never special-case `sales.status` in the new aggregate queries; always compute returns via `returnedQuantity`.
- Dashboard and Reports are visible to any authenticated user (`requireUser()`), no role gate.
- Money fields are Postgres `numeric` columns and arrive from Drizzle as strings (matches every existing repo function, e.g. `sales.totalAmount: string`). New aggregate functions must return money fields as strings too, computed via SQL `sum(...)` expressions, not floated through JS number arithmetic.
- `/reports` invalid/missing search params degrade to a default (current calendar month) rather than throwing; `from > to` is silently swapped, never rejected.
- Follow existing file conventions exactly: repo functions are plain exported async functions using the module-level `db` client (see `sale.repo.ts`, `product.repo.ts`); server components read `searchParams` as a `Promise` per existing Next.js 16 pattern in `app/(app)/sales/page.tsx`; client filter components use `useRouter`/`useSearchParams` + `URLSearchParams` push, not form state libraries.

## Review Focus

- **Cancelled sale folded into returns deduction, not excluded:** a cancelled sale's full line amounts must appear in `returnedRevenue`/`returnedCost`/`returnedProfit`, and its gross figures must still be counted (not zeroed) — this is the spec's core nuance and the single most likely thing a rushed implementation gets backwards.
- **Partial return math uses per-unit fields, not fractional scaling of stored totals:** `returnedRevenue` for a line must be `returnedQuantity * soldPricePerUnit` (and similarly for cost/profit), never `totalRevenue * (returnedQuantity / quantity)` — the spec explicitly calls out avoiding fractional scaling of stored line totals.
- **`categoryId` is nullable:** `getSalesBreakdownByCategory` must not silently drop uncategorized products from the sum — they need a real "Uncategorized" bucket row.
- **Empty range / no sales:** both dashboard tiles and the reports page must render zeroed tiles and empty list/table states without error when a date range or "today" has zero sales — no division-by-zero, no `undefined` reads on an empty aggregate row.
- **`/reports` malformed search params:** non-ISO date strings, a `to` before `from`, or an unrecognized `groupBy` value must all degrade to defaults/swap rather than crashing the page (Next.js server components throwing here would 500 the whole route, unlike a client-side form validation gap).

---

## File Structure

- `lib/repositories/sale.repo.ts` (modify) — add `getSalesSummary`, `getSalesBreakdownByProduct`, `getSalesBreakdownByCategory`. Same file as all other sale-related aggregate/list queries (`listSales`, `countSales`) — keeps sale-domain queries together per existing convention.
- ~~`lib/repositories/product.repo.ts` (modify) — add `listLowStockProducts`~~ **Superseded during Task 3's review**: a `listLowStockProducts(threshold, {limit, offset})` function already existed in `lib/repositories/inventory.repo.ts` since Phase 4 and does everything needed; Task 3's new duplicate was removed. Task 5 calls the pre-existing `inventory.repo.ts` version directly. No change needed to `product.repo.ts` for this phase.
- `app/(app)/dashboard/page.tsx` (rewrite) — server component, no search params.
- `app/(app)/reports/page.tsx` (new) — server component, reads `searchParams`.
- `components/dashboard/SummaryTiles.tsx` (new) — presentational, shared by both pages.
- `components/dashboard/RecentSalesList.tsx` (new) — presentational.
- `components/dashboard/LowStockList.tsx` (new) — presentational.
- `components/reports/ReportsDateRangeFilter.tsx` (new) — client component.
- `components/reports/BreakdownTable.tsx` (new) — presentational.
- Tests: `tests/integration/sale.repo.reports.test.ts`, `tests/integration/product.repo.lowstock.test.ts`, `tests/unit/SummaryTiles.test.tsx`, `tests/unit/BreakdownTable.test.tsx`, `tests/unit/ReportsDateRangeFilter.test.tsx`, `tests/unit/reports-page-params.test.ts`.

---

### Task 1: `getSalesSummary` repository query

**Files:**
- Modify: `lib/repositories/sale.repo.ts`
- Test: `tests/integration/sale.repo.reports.test.ts`

**Interfaces:**
- Consumes: existing `db`, `sales`, `saleItems`, `products` tables from `lib/db/schema.ts`; existing `sql`, `and`, `gte`, `lte` from `drizzle-orm`.
- Produces:
  ```ts
  export type SalesSummary = {
    saleCount: number;
    unitsSold: number;
    grossRevenue: string;
    grossCost: string;
    grossProfit: string;
    returnedRevenue: string;
    returnedCost: string;
    returnedProfit: string;
  };

  export async function getSalesSummary(range: { from: Date; to: Date }): Promise<SalesSummary>;
  ```
  Later tasks (Task 4, Task 5) call this with `{ from, to }` computed for "today", "this month", and the `/reports` selected range.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/sale.repo.reports.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db/client";
import { sales, saleItems, products, users } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { insertSale, insertSaleItems, getSalesSummary } from "@/lib/repositories/sale.repo";

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

describe("getSalesSummary", () => {
  let userId: string;
  let productId: string;
  const IN_RANGE = new Date("2026-01-15T12:00:00Z");
  const RANGE = { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-01-31T23:59:59Z") };

  beforeEach(async () => {
    const user = await makeUser();
    userId = user.id;
    const product = await makeProduct();
    productId = product.id;
  });

  afterEach(async () => {
    const testSales = await db.select({ id: sales.id }).from(sales).where(eq(sales.soldBy, userId));
    const saleIds = testSales.map((s) => s.id);
    if (saleIds.length > 0) {
      await db.delete(saleItems).where(inArray(saleItems.saleId, saleIds));
      await db.delete(sales).where(inArray(sales.id, saleIds));
    }
    await db.delete(products).where(eq(products.id, productId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it("sums gross revenue/cost/profit and units sold for a plain completed sale in range", async () => {
    const sale = await insertSale({
      saleNumber: `TEST-${crypto.randomUUID()}`,
      soldAt: IN_RANGE,
      soldBy: userId,
      totalAmount: "20.00",
      totalCost: "10.00",
      totalProfit: "10.00",
      status: "COMPLETED",
    });
    await insertSaleItems([{
      saleId: sale.id,
      productId,
      quantity: 2,
      costPerUnit: "5.00",
      soldPricePerUnit: "10.00",
      totalCost: "10.00",
      totalRevenue: "20.00",
      profit: "10.00",
    }]);

    const summary = await getSalesSummary(RANGE);

    expect(summary.saleCount).toBe(1);
    expect(summary.unitsSold).toBe(2);
    expect(Number(summary.grossRevenue)).toBeCloseTo(20.00);
    expect(Number(summary.grossCost)).toBeCloseTo(10.00);
    expect(Number(summary.grossProfit)).toBeCloseTo(10.00);
    expect(Number(summary.returnedRevenue)).toBeCloseTo(0);
    expect(Number(summary.returnedCost)).toBeCloseTo(0);
    expect(Number(summary.returnedProfit)).toBeCloseTo(0);
  });

  it("excludes sales outside the given date range", async () => {
    const sale = await insertSale({
      saleNumber: `TEST-${crypto.randomUUID()}`,
      soldAt: new Date("2026-02-01T00:00:00Z"), // outside RANGE
      soldBy: userId,
      totalAmount: "20.00",
      totalCost: "10.00",
      totalProfit: "10.00",
      status: "COMPLETED",
    });
    await insertSaleItems([{
      saleId: sale.id,
      productId,
      quantity: 2,
      costPerUnit: "5.00",
      soldPricePerUnit: "10.00",
      totalCost: "10.00",
      totalRevenue: "20.00",
      profit: "10.00",
    }]);

    const summary = await getSalesSummary(RANGE);

    expect(summary.saleCount).toBe(0);
    expect(summary.unitsSold).toBe(0);
  });

  it("counts a partially returned sale's full gross figures but moves the returned portion into the returns deduction using per-unit price, not fractional scaling of stored totals", async () => {
    const sale = await insertSale({
      saleNumber: `TEST-${crypto.randomUUID()}`,
      soldAt: IN_RANGE,
      soldBy: userId,
      totalAmount: "30.00",
      totalCost: "15.00",
      totalProfit: "15.00",
      status: "PARTIALLY_RETURNED",
    });
    // 3 units sold at $10/unit ($5 cost/unit), 1 of the 3 returned.
    await insertSaleItems([{
      saleId: sale.id,
      productId,
      quantity: 3,
      costPerUnit: "5.00",
      soldPricePerUnit: "10.00",
      totalCost: "15.00",
      totalRevenue: "30.00",
      profit: "15.00",
      returnedQuantity: 1,
    }]);

    const summary = await getSalesSummary(RANGE);

    expect(summary.saleCount).toBe(1);
    expect(summary.unitsSold).toBe(3); // gross units sold, not reduced by returns
    expect(Number(summary.grossRevenue)).toBeCloseTo(30.00);
    expect(Number(summary.grossCost)).toBeCloseTo(15.00);
    expect(Number(summary.grossProfit)).toBeCloseTo(15.00);
    expect(Number(summary.returnedRevenue)).toBeCloseTo(10.00); // 1 * $10/unit
    expect(Number(summary.returnedCost)).toBeCloseTo(5.00);     // 1 * $5/unit
    expect(Number(summary.returnedProfit)).toBeCloseTo(5.00);   // 1 * ($10-$5)
  });

  it("treats a CANCELLED sale's full amount as a returns deduction, identical to a full return, while gross figures still include it", async () => {
    const sale = await insertSale({
      saleNumber: `TEST-${crypto.randomUUID()}`,
      soldAt: IN_RANGE,
      soldBy: userId,
      totalAmount: "20.00",
      totalCost: "10.00",
      totalProfit: "10.00",
      status: "CANCELLED",
    });
    // cancelSale() in sale.service.ts sets returnedQuantity = quantity on every line.
    await insertSaleItems([{
      saleId: sale.id,
      productId,
      quantity: 2,
      costPerUnit: "5.00",
      soldPricePerUnit: "10.00",
      totalCost: "10.00",
      totalRevenue: "20.00",
      profit: "10.00",
      returnedQuantity: 2,
    }]);

    const summary = await getSalesSummary(RANGE);

    expect(summary.saleCount).toBe(1);
    expect(summary.unitsSold).toBe(2);
    expect(Number(summary.grossRevenue)).toBeCloseTo(20.00);
    expect(Number(summary.grossCost)).toBeCloseTo(10.00);
    expect(Number(summary.grossProfit)).toBeCloseTo(10.00);
    expect(Number(summary.returnedRevenue)).toBeCloseTo(20.00);
    expect(Number(summary.returnedCost)).toBeCloseTo(10.00);
    expect(Number(summary.returnedProfit)).toBeCloseTo(10.00);
  });

  it("returns zeroed fields (not undefined/NaN) when there are no sales in range", async () => {
    const summary = await getSalesSummary({ from: new Date("2020-01-01"), to: new Date("2020-01-02") });
    expect(summary.saleCount).toBe(0);
    expect(summary.unitsSold).toBe(0);
    expect(Number(summary.grossRevenue)).toBe(0);
    expect(Number(summary.returnedRevenue)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/sale.repo.reports.test.ts`
Expected: FAIL — `getSalesSummary is not a function` (or similar import error), since it doesn't exist yet.

- [ ] **Step 3: Implement `getSalesSummary`**

Add to `lib/repositories/sale.repo.ts` (append near the other query functions; add `sql`, `sum`, `countDistinct` to the existing `drizzle-orm` import):

```ts
import { eq, desc, count, asc, inArray, and, gte, lte, or, ilike, sql, sum, countDistinct, type SQL } from "drizzle-orm";
```

```ts
export type SalesSummary = {
  saleCount: number;
  unitsSold: number;
  grossRevenue: string;
  grossCost: string;
  grossProfit: string;
  returnedRevenue: string;
  returnedCost: string;
  returnedProfit: string;
};

export async function getSalesSummary(range: { from: Date; to: Date }): Promise<SalesSummary> {
  const [row] = await db
    .select({
      saleCount: countDistinct(sales.id),
      unitsSold: sql<string>`coalesce(sum(${saleItems.quantity}), 0)`,
      grossRevenue: sql<string>`coalesce(sum(${saleItems.totalRevenue}), 0)`,
      grossCost: sql<string>`coalesce(sum(${saleItems.totalCost}), 0)`,
      grossProfit: sql<string>`coalesce(sum(${saleItems.profit}), 0)`,
      returnedRevenue: sql<string>`coalesce(sum(${saleItems.returnedQuantity} * ${saleItems.soldPricePerUnit}), 0)`,
      returnedCost: sql<string>`coalesce(sum(${saleItems.returnedQuantity} * ${saleItems.costPerUnit}), 0)`,
      returnedProfit: sql<string>`coalesce(sum(${saleItems.returnedQuantity} * (${saleItems.soldPricePerUnit} - ${saleItems.costPerUnit})), 0)`,
    })
    .from(saleItems)
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .where(and(gte(sales.soldAt, range.from), lte(sales.soldAt, range.to)));

  return {
    saleCount: row.saleCount,
    unitsSold: Number(row.unitsSold),
    grossRevenue: row.grossRevenue,
    grossCost: row.grossCost,
    grossProfit: row.grossProfit,
    returnedRevenue: row.returnedRevenue,
    returnedCost: row.returnedCost,
    returnedProfit: row.returnedProfit,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/sale.repo.reports.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/sale.repo.ts tests/integration/sale.repo.reports.test.ts
git commit -m "Add getSalesSummary aggregate query for dashboard/reports"
```

---

### Task 2: `getSalesBreakdownByProduct` and `getSalesBreakdownByCategory`

**Files:**
- Modify: `lib/repositories/sale.repo.ts`
- Test: `tests/integration/sale.repo.reports.test.ts` (append)

**Interfaces:**
- Consumes: `getSalesSummary`'s date-range shape (`{ from: Date; to: Date }`); `categories` table (new import from `lib/db/schema.ts`).
- Produces:
  ```ts
  export type SalesBreakdownRow = {
    id: string;
    name: string;
    unitsSold: number;
    revenue: string;
    cost: string;
    profit: string;
  };

  export async function getSalesBreakdownByProduct(range: { from: Date; to: Date }): Promise<SalesBreakdownRow[]>;
  export async function getSalesBreakdownByCategory(range: { from: Date; to: Date }): Promise<SalesBreakdownRow[]>;
  ```
  Task 6 (`/reports` page) calls whichever of these matches the user's `groupBy` selection.

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/sale.repo.reports.test.ts`:

```ts
import { getSalesBreakdownByProduct, getSalesBreakdownByCategory } from "@/lib/repositories/sale.repo";
import { categories } from "@/lib/db/schema";

describe("getSalesBreakdownByProduct / getSalesBreakdownByCategory", () => {
  let userId: string;
  let categorized: Awaited<ReturnType<typeof makeProduct>>;
  let uncategorized: Awaited<ReturnType<typeof makeProduct>>;
  let categoryId: string;
  const IN_RANGE = new Date("2026-01-15T12:00:00Z");
  const RANGE = { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-01-31T23:59:59Z") };

  beforeEach(async () => {
    const user = await makeUser();
    userId = user.id;
    const [category] = await db.insert(categories).values({ name: `Cat-${crypto.randomUUID()}` }).returning();
    categoryId = category.id;
    categorized = await makeProduct({ productName: "Categorized Widget", categoryId });
    uncategorized = await makeProduct({ productName: "Loose Widget" });
  });

  afterEach(async () => {
    const testSales = await db.select({ id: sales.id }).from(sales).where(eq(sales.soldBy, userId));
    const saleIds = testSales.map((s) => s.id);
    if (saleIds.length > 0) {
      await db.delete(saleItems).where(inArray(saleItems.saleId, saleIds));
      await db.delete(sales).where(inArray(sales.id, saleIds));
    }
    await db.delete(products).where(inArray(products.id, [categorized.id, uncategorized.id]));
    await db.delete(categories).where(eq(categories.id, categoryId));
    await db.delete(users).where(eq(users.id, userId));
  });

  async function sellOneUnit(productId: string, sellingPrice: string, costPrice: string) {
    const sale = await insertSale({
      saleNumber: `TEST-${crypto.randomUUID()}`,
      soldAt: IN_RANGE,
      soldBy: userId,
      totalAmount: sellingPrice,
      totalCost: costPrice,
      totalProfit: (Number(sellingPrice) - Number(costPrice)).toFixed(2),
      status: "COMPLETED",
    });
    await insertSaleItems([{
      saleId: sale.id,
      productId,
      quantity: 1,
      costPerUnit: costPrice,
      soldPricePerUnit: sellingPrice,
      totalCost: costPrice,
      totalRevenue: sellingPrice,
      profit: (Number(sellingPrice) - Number(costPrice)).toFixed(2),
    }]);
  }

  it("breaks down units/revenue/cost/profit per product, ordered by revenue descending", async () => {
    await sellOneUnit(categorized.id, "50.00", "20.00");
    await sellOneUnit(uncategorized.id, "10.00", "5.00");

    const rows = await getSalesBreakdownByProduct(RANGE);
    const relevant = rows.filter((r) => [categorized.id, uncategorized.id].includes(r.id));

    expect(relevant[0].id).toBe(categorized.id); // higher revenue first
    expect(relevant[0].name).toBe("Categorized Widget");
    expect(relevant[0].unitsSold).toBe(1);
    expect(Number(relevant[0].revenue)).toBeCloseTo(50.00);
    expect(relevant[1].id).toBe(uncategorized.id);
  });

  it("groups by category, bucketing products with no categoryId under 'Uncategorized'", async () => {
    await sellOneUnit(categorized.id, "50.00", "20.00");
    await sellOneUnit(uncategorized.id, "10.00", "5.00");

    const rows = await getSalesBreakdownByCategory(RANGE);

    const namedCategory = rows.find((r) => r.id === categoryId);
    expect(namedCategory).toBeDefined();
    expect(Number(namedCategory!.revenue)).toBeCloseTo(50.00);

    const uncategorizedRow = rows.find((r) => r.name === "Uncategorized");
    expect(uncategorizedRow).toBeDefined();
    expect(Number(uncategorizedRow!.revenue)).toBeCloseTo(10.00);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/sale.repo.reports.test.ts`
Expected: FAIL — new tests fail with import/undefined-function errors.

- [ ] **Step 3: Implement both breakdown functions**

Add `categories` to the schema import at the top of `lib/repositories/sale.repo.ts`:

```ts
import { sales, saleItems, products, categories } from "@/lib/db/schema";
```

Append:

```ts
export type SalesBreakdownRow = {
  id: string;
  name: string;
  unitsSold: number;
  revenue: string;
  cost: string;
  profit: string;
};

export async function getSalesBreakdownByProduct(range: { from: Date; to: Date }): Promise<SalesBreakdownRow[]> {
  const rows = await db
    .select({
      id: products.id,
      name: products.productName,
      unitsSold: sql<string>`coalesce(sum(${saleItems.quantity}), 0)`,
      revenue: sql<string>`coalesce(sum(${saleItems.totalRevenue}), 0)`,
      cost: sql<string>`coalesce(sum(${saleItems.totalCost}), 0)`,
      profit: sql<string>`coalesce(sum(${saleItems.profit}), 0)`,
    })
    .from(saleItems)
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .innerJoin(products, eq(saleItems.productId, products.id))
    .where(and(gte(sales.soldAt, range.from), lte(sales.soldAt, range.to)))
    .groupBy(products.id, products.productName)
    .orderBy(desc(sql`sum(${saleItems.totalRevenue})`));

  return rows.map((r) => ({ ...r, unitsSold: Number(r.unitsSold) }));
}

export async function getSalesBreakdownByCategory(range: { from: Date; to: Date }): Promise<SalesBreakdownRow[]> {
  const categoryKey = sql<string>`coalesce(${categories.id}::text, 'uncategorized')`;
  const categoryName = sql<string>`coalesce(${categories.name}, 'Uncategorized')`;

  const rows = await db
    .select({
      id: categoryKey,
      name: categoryName,
      unitsSold: sql<string>`coalesce(sum(${saleItems.quantity}), 0)`,
      revenue: sql<string>`coalesce(sum(${saleItems.totalRevenue}), 0)`,
      cost: sql<string>`coalesce(sum(${saleItems.totalCost}), 0)`,
      profit: sql<string>`coalesce(sum(${saleItems.profit}), 0)`,
    })
    .from(saleItems)
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .innerJoin(products, eq(saleItems.productId, products.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(gte(sales.soldAt, range.from), lte(sales.soldAt, range.to)))
    .groupBy(categoryKey, categoryName)
    .orderBy(desc(sql`sum(${saleItems.totalRevenue})`));

  return rows.map((r) => ({ ...r, unitsSold: Number(r.unitsSold) }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/sale.repo.reports.test.ts`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/sale.repo.ts tests/integration/sale.repo.reports.test.ts
git commit -m "Add getSalesBreakdownByProduct and getSalesBreakdownByCategory queries"
```

---

### Task 3: `listLowStockProducts` repository query

**Files:**
- Modify: `lib/repositories/product.repo.ts`
- Test: `tests/integration/product.repo.lowstock.test.ts`

**Interfaces:**
- Consumes: `LOW_STOCK_THRESHOLD` from `lib/constants.ts`; existing `ProductRow` type from `product.repo.ts`.
- Produces:
  ```ts
  export async function listLowStockProducts(limit: number): Promise<ProductRow[]>;
  ```
  Task 4 (`/dashboard` page) calls this with `limit: 10`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/product.repo.lowstock.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db/client";
import { products } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { listLowStockProducts, insertProduct } from "@/lib/repositories/product.repo";
import { LOW_STOCK_THRESHOLD } from "@/lib/constants";

describe("listLowStockProducts", () => {
  const createdIds: string[] = [];

  afterEach(async () => {
    if (createdIds.length > 0) {
      await db.delete(products).where(inArray(products.id, createdIds));
      createdIds.length = 0;
    }
  });

  async function makeProduct(overrides: Partial<typeof products.$inferInsert>) {
    const row = await insertProduct({
      publicIdentifier: crypto.randomUUID().slice(0, 12),
      sku: `SKU-${crypto.randomUUID().slice(0, 8)}`,
      productName: "Test Product",
      originalPrice: "10.00",
      costPrice: "5.00",
      sellingPrice: "10.00",
      currentQuantity: 100,
      ...overrides,
    });
    createdIds.push(row.id);
    return row;
  }

  it("includes ACTIVE products at or below the threshold, ordered by quantity ascending", async () => {
    const low = await makeProduct({ productName: "Almost Out", currentQuantity: LOW_STOCK_THRESHOLD });
    const lower = await makeProduct({ productName: "Very Low", currentQuantity: 0 });
    await makeProduct({ productName: "Plenty", currentQuantity: LOW_STOCK_THRESHOLD + 1 });

    const rows = await listLowStockProducts(10);
    const relevantIds = rows.map((r) => r.id);

    expect(relevantIds.indexOf(lower.id)).toBeLessThan(relevantIds.indexOf(low.id));
    expect(rows.every((r) => r.currentQuantity <= LOW_STOCK_THRESHOLD)).toBe(true);
  });

  it("excludes ARCHIVED products even if their quantity is low", async () => {
    const archived = await makeProduct({ productName: "Archived Low", currentQuantity: 0, status: "ARCHIVED" });

    const rows = await listLowStockProducts(50);

    expect(rows.some((r) => r.id === archived.id)).toBe(false);
  });

  it("respects the limit parameter", async () => {
    for (let i = 0; i < 3; i++) {
      await makeProduct({ productName: `Low ${i}`, currentQuantity: 1 });
    }

    const rows = await listLowStockProducts(2);
    expect(rows.length).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/product.repo.lowstock.test.ts`
Expected: FAIL — `listLowStockProducts is not a function`

- [ ] **Step 3: Implement `listLowStockProducts`**

Add to `lib/repositories/product.repo.ts` (add `lte` and `asc` to the existing `drizzle-orm` import, and import the threshold constant):

```ts
import { and, eq, ilike, or, count, lte, asc } from "drizzle-orm";
import { LOW_STOCK_THRESHOLD } from "@/lib/constants";
```

```ts
export async function listLowStockProducts(limit: number): Promise<ProductRow[]> {
  return db
    .select()
    .from(products)
    .where(and(eq(products.status, "ACTIVE"), lte(products.currentQuantity, LOW_STOCK_THRESHOLD)))
    .orderBy(asc(products.currentQuantity))
    .limit(limit);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/product.repo.lowstock.test.ts`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/product.repo.ts tests/integration/product.repo.lowstock.test.ts
git commit -m "Add listLowStockProducts query for dashboard low-stock list"
```

---

### Task 4: `SummaryTiles`, `RecentSalesList`, `LowStockList` components

**Files:**
- Create: `components/dashboard/SummaryTiles.tsx`
- Create: `components/dashboard/RecentSalesList.tsx`
- Create: `components/dashboard/LowStockList.tsx`
- Test: `tests/unit/SummaryTiles.test.tsx`, `tests/unit/RecentSalesList.test.tsx`, `tests/unit/LowStockList.test.tsx`

**Interfaces:**
- Consumes: `SalesSummary` type from `lib/repositories/sale.repo.ts`; `SaleRow` type from `lib/repositories/sale.repo.ts`; `ProductRow` type from `lib/repositories/product.repo.ts`; `Card`/`CardHeader`/`CardTitle`/`CardContent` from `components/ui/card.tsx`; `Badge` from `components/ui/badge.tsx`.
- Produces:
  ```ts
  export function SummaryTiles({ label, summary }: { label: string; summary: SalesSummary }): JSX.Element;
  export function RecentSalesList({ sales }: { sales: SaleRow[] }): JSX.Element;
  export function LowStockList({ products }: { products: ProductRow[] }): JSX.Element;
  ```
  Task 5 (`/dashboard` page) and Task 6 (`/reports` page) import and render these directly.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/SummaryTiles.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SummaryTiles } from "@/components/dashboard/SummaryTiles";
import type { SalesSummary } from "@/lib/repositories/sale.repo";

afterEach(() => cleanup());

const summary: SalesSummary = {
  saleCount: 4,
  unitsSold: 9,
  grossRevenue: "180.00",
  grossCost: "90.00",
  grossProfit: "90.00",
  returnedRevenue: "20.00",
  returnedCost: "10.00",
  returnedProfit: "10.00",
};

describe("SummaryTiles", () => {
  it("renders the label and gross figures", () => {
    render(<SummaryTiles label="Today" summary={summary} />);
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText(/180\.00/)).toBeInTheDocument();
    expect(screen.getByText(/9/)).toBeInTheDocument(); // units sold
  });

  it("renders a returns deduction line separate from the gross figure", () => {
    render(<SummaryTiles label="Today" summary={summary} />);
    expect(screen.getByText(/-\$?20\.00|−\$?20\.00/)).toBeInTheDocument();
  });

  it("renders zeroed tiles without error when summary has no sales", () => {
    const empty: SalesSummary = {
      saleCount: 0, unitsSold: 0,
      grossRevenue: "0", grossCost: "0", grossProfit: "0",
      returnedRevenue: "0", returnedCost: "0", returnedProfit: "0",
    };
    render(<SummaryTiles label="Today" summary={empty} />);
    expect(screen.getByText("Today")).toBeInTheDocument();
  });
});
```

Create `tests/unit/RecentSalesList.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { RecentSalesList } from "@/components/dashboard/RecentSalesList";
import type { SaleRow } from "@/lib/repositories/sale.repo";

afterEach(() => cleanup());

function makeSale(overrides: Partial<SaleRow> = {}): SaleRow {
  return {
    id: "sale-1",
    saleNumber: "SALE-000001",
    soldAt: new Date("2026-01-15T12:00:00Z"),
    soldBy: "user-1",
    totalAmount: "20.00",
    totalCost: "10.00",
    totalProfit: "10.00",
    status: "COMPLETED",
    notes: null,
    buyerName: null,
    buyerPhone: null,
    createdAt: new Date("2026-01-15T12:00:00Z"),
    ...overrides,
  };
}

describe("RecentSalesList", () => {
  it("renders each sale's number and links to its detail page", () => {
    render(<RecentSalesList sales={[makeSale()]} />);
    const link = screen.getByRole("link", { name: /SALE-000001/i });
    expect(link).toHaveAttribute("href", "/sales/sale-1");
  });

  it("renders a link to view all sales", () => {
    render(<RecentSalesList sales={[makeSale()]} />);
    expect(screen.getByRole("link", { name: /view all/i })).toHaveAttribute("href", "/sales");
  });

  it("renders an empty state when there are no recent sales", () => {
    render(<RecentSalesList sales={[]} />);
    expect(screen.getByText(/no sales yet/i)).toBeInTheDocument();
  });
});
```

Create `tests/unit/LowStockList.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LowStockList } from "@/components/dashboard/LowStockList";
import type { ProductRow } from "@/lib/repositories/product.repo";

afterEach(() => cleanup());

function makeProduct(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: "prod-1",
    publicIdentifier: "abc123",
    sku: "SKU-1",
    productName: "Widget",
    categoryId: null,
    description: null,
    productImage: null,
    originalPrice: "10.00",
    costPrice: "5.00",
    sellingPrice: "10.00",
    currentQuantity: 2,
    supplier: null,
    location: null,
    status: "ACTIVE",
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("LowStockList", () => {
  it("renders each product's name, quantity, and links to its detail page", () => {
    render(<LowStockList products={[makeProduct()]} />);
    expect(screen.getByText("Widget")).toBeInTheDocument();
    expect(screen.getByText(/2/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /widget/i })).toHaveAttribute("href", "/products/prod-1");
  });

  it("renders an empty state when nothing is low on stock", () => {
    render(<LowStockList products={[]} />);
    expect(screen.getByText(/nothing.*low|no low.stock/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/SummaryTiles.test.tsx tests/unit/RecentSalesList.test.tsx tests/unit/LowStockList.test.tsx`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Implement the three components**

Create `components/dashboard/SummaryTiles.tsx`:

```tsx
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { SalesSummary } from "@/lib/repositories/sale.repo";

function money(value: string): string {
  return `$${Number(value).toFixed(2)}`;
}

const TILES: { key: keyof SalesSummary; returnsKey: keyof SalesSummary | null; label: string; format: (v: string | number) => string }[] = [
  { key: "saleCount", returnsKey: null, label: "Sales", format: (v) => String(v) },
  { key: "unitsSold", returnsKey: null, label: "Units Sold", format: (v) => String(v) },
  { key: "grossRevenue", returnsKey: "returnedRevenue", label: "Revenue", format: (v) => money(String(v)) },
  { key: "grossCost", returnsKey: "returnedCost", label: "Cost", format: (v) => money(String(v)) },
  { key: "grossProfit", returnsKey: "returnedProfit", label: "Profit", format: (v) => money(String(v)) },
];

export function SummaryTiles({ label, summary }: { label: string; summary: SalesSummary }) {
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-medium">{label}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {TILES.map((tile) => (
          <Card key={tile.key} size="sm">
            <CardHeader>
              <CardTitle>{tile.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xl font-semibold">{tile.format(summary[tile.key])}</p>
              {tile.returnsKey && Number(summary[tile.returnsKey]) > 0 && (
                <p className="text-sm text-muted-foreground">
                  Returns: -{money(String(summary[tile.returnsKey]))}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

Create `components/dashboard/RecentSalesList.tsx`:

```tsx
import Link from "next/link";
import type { SaleRow } from "@/lib/repositories/sale.repo";

export function RecentSalesList({ sales }: { sales: SaleRow[] }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Recent Sales</h2>
        <Link href="/sales" className="text-sm underline">
          View all
        </Link>
      </div>
      {sales.length === 0 ? (
        <p className="text-muted-foreground">No sales yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {sales.map((sale) => (
            <li key={sale.id} className="flex items-center justify-between p-3">
              <Link href={`/sales/${sale.id}`} className="underline">
                {sale.saleNumber}
              </Link>
              <span className="text-sm text-muted-foreground">{sale.soldAt.toLocaleString()}</span>
              <span className="font-medium">${sale.totalAmount}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

Create `components/dashboard/LowStockList.tsx`:

```tsx
import Link from "next/link";
import type { ProductRow } from "@/lib/repositories/product.repo";

export function LowStockList({ products }: { products: ProductRow[] }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Low Stock</h2>
        <Link href="/products?status=ACTIVE" className="text-sm underline">
          View all
        </Link>
      </div>
      {products.length === 0 ? (
        <p className="text-muted-foreground">Nothing is low on stock.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {products.map((product) => (
            <li key={product.id} className="flex items-center justify-between p-3">
              <Link href={`/products/${product.id}`} className="underline">
                {product.productName}
              </Link>
              <span className="font-medium">{product.currentQuantity} left</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/SummaryTiles.test.tsx tests/unit/RecentSalesList.test.tsx tests/unit/LowStockList.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/ tests/unit/SummaryTiles.test.tsx tests/unit/RecentSalesList.test.tsx tests/unit/LowStockList.test.tsx
git commit -m "Add SummaryTiles, RecentSalesList, LowStockList components"
```

---

### Task 5: `/dashboard` page

**Files:**
- Modify: `app/(app)/dashboard/page.tsx`
- Test: `tests/unit/dashboard-page-ranges.test.ts` (pure date-range helper, extracted for testability)

**Interfaces:**
- Consumes: `requireUser` from `lib/auth/guards.ts`; `getSalesSummary` from `lib/repositories/sale.repo.ts`; `listSales` from `lib/repositories/sale.repo.ts`; `listLowStockProducts` from `lib/repositories/inventory.repo.ts` (**correction, ruled during Task 3's review**: this function already existed from Phase 4 with signature `listLowStockProducts(threshold: number, params: { limit: number; offset: number }): Promise<ProductRow[]>` — filters `ACTIVE` + `currentQuantity <= threshold`, ordered ascending. Task 3 was redundant and its duplicate was removed; call the pre-existing one directly as `listLowStockProducts(LOW_STOCK_THRESHOLD, { limit: 10, offset: 0 })`, importing `LOW_STOCK_THRESHOLD` from `lib/constants.ts`); `SummaryTiles`, `RecentSalesList`, `LowStockList` from Task 4.
- Produces: the rendered `/dashboard` route. Also produces a small exported helper (used only within this task, but exported for direct unit testing without rendering the page):
  ```ts
  export function getTodayRange(now: Date): { from: Date; to: Date };
  export function getMonthToDateRange(now: Date): { from: Date; to: Date };
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dashboard-page-ranges.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getTodayRange, getMonthToDateRange } from "@/app/(app)/dashboard/page";

describe("getTodayRange", () => {
  it("returns a range spanning midnight to midnight of the same calendar day", () => {
    const now = new Date("2026-01-15T14:30:00");
    const { from, to } = getTodayRange(now);
    expect(from.getDate()).toBe(15);
    expect(from.getHours()).toBe(0);
    expect(to.getDate()).toBe(15);
    expect(to.getHours()).toBe(23);
  });
});

describe("getMonthToDateRange", () => {
  it("returns a range from the 1st of the current month through now", () => {
    const now = new Date("2026-01-15T14:30:00");
    const { from, to } = getMonthToDateRange(now);
    expect(from.getDate()).toBe(1);
    expect(from.getMonth()).toBe(0);
    expect(to.getTime()).toBe(now.getTime());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/dashboard-page-ranges.test.ts`
Expected: FAIL — page module doesn't export these functions yet (also currently doesn't exist as anything but the Phase 1 placeholder).

- [ ] **Step 3: Implement `/dashboard` page**

Replace `app/(app)/dashboard/page.tsx` entirely:

```tsx
import { requireUser } from "@/lib/auth/guards";
import { getSalesSummary, listSales } from "@/lib/repositories/sale.repo";
import { listLowStockProducts } from "@/lib/repositories/inventory.repo";
import { LOW_STOCK_THRESHOLD } from "@/lib/constants";
import { SummaryTiles } from "@/components/dashboard/SummaryTiles";
import { RecentSalesList } from "@/components/dashboard/RecentSalesList";
import { LowStockList } from "@/components/dashboard/LowStockList";

export function getTodayRange(now: Date): { from: Date; to: Date } {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { from, to };
}

export function getMonthToDateRange(now: Date): { from: Date; to: Date } {
  const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  return { from, to: now };
}

export default async function DashboardPage() {
  const user = await requireUser();
  const now = new Date();

  const [todaySummary, monthSummary, recentSales, lowStockProducts] = await Promise.all([
    getSalesSummary(getTodayRange(now)),
    getSalesSummary(getMonthToDateRange(now)),
    listSales({ limit: 10, offset: 0 }),
    listLowStockProducts(LOW_STOCK_THRESHOLD, { limit: 10, offset: 0 }),
  ]);

  return (
    <div className="p-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground">Signed in as {user.email} ({user.role})</p>
      </div>

      <SummaryTiles label="Today" summary={todaySummary} />
      <SummaryTiles label="This Month" summary={monthSummary} />

      <div className="grid gap-6 sm:grid-cols-2">
        <RecentSalesList sales={recentSales} />
        <LowStockList products={lowStockProducts} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/dashboard-page-ranges.test.ts`
Expected: PASS (both tests)

- [ ] **Step 5: Verify the full app still builds**

Run: `npx tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/dashboard/page.tsx tests/unit/dashboard-page-ranges.test.ts
git commit -m "Implement /dashboard with today/month summary tiles, recent sales, low stock"
```

---

### Task 6: `ReportsDateRangeFilter` and `BreakdownTable` components

**Files:**
- Create: `components/reports/ReportsDateRangeFilter.tsx`
- Create: `components/reports/BreakdownTable.tsx`
- Test: `tests/unit/ReportsDateRangeFilter.test.tsx`, `tests/unit/BreakdownTable.test.tsx`

**Interfaces:**
- Consumes: `useRouter`/`useSearchParams` from `next/navigation` (same pattern as `SalesFilterBar`); `Input`, `Label`, `Button` from `components/ui/`; `Table`/`TableBody`/`TableCell`/`TableHead`/`TableHeader`/`TableRow` from `components/ui/table.tsx`; `SalesBreakdownRow` type from `lib/repositories/sale.repo.ts`.
- Produces:
  ```ts
  export function ReportsDateRangeFilter({ defaultFrom, defaultTo, defaultGroupBy }: {
    defaultFrom: string;
    defaultTo: string;
    defaultGroupBy: "product" | "category";
  }): JSX.Element;

  export function BreakdownTable({ rows, groupBy }: { rows: SalesBreakdownRow[]; groupBy: "product" | "category" }): JSX.Element;
  ```
  Task 7 (`/reports` page) renders both, passing the parsed/defaulted search params through.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/ReportsDateRangeFilter.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ReportsDateRangeFilter } from "@/components/reports/ReportsDateRangeFilter";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReportsDateRangeFilter", () => {
  it("renders from/to date inputs and a groupBy select pre-filled with defaults", () => {
    render(<ReportsDateRangeFilter defaultFrom="2026-01-01" defaultTo="2026-01-31" defaultGroupBy="product" />);
    expect(screen.getByLabelText(/from/i)).toHaveValue("2026-01-01");
    expect(screen.getByLabelText(/to/i)).toHaveValue("2026-01-31");
    expect(screen.getByLabelText(/group by/i)).toHaveValue("product");
  });

  it("navigates with updated from/to params on change", () => {
    render(<ReportsDateRangeFilter defaultFrom="2026-01-01" defaultTo="2026-01-31" defaultGroupBy="product" />);
    fireEvent.change(screen.getByLabelText(/from/i), { target: { value: "2026-02-01" } });
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("from=2026-02-01"));
  });

  it("navigates with the groupBy param on change", () => {
    render(<ReportsDateRangeFilter defaultFrom="2026-01-01" defaultTo="2026-01-31" defaultGroupBy="product" />);
    fireEvent.change(screen.getByLabelText(/group by/i), { target: { value: "category" } });
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("groupBy=category"));
  });
});
```

Create `tests/unit/BreakdownTable.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { BreakdownTable } from "@/components/reports/BreakdownTable";
import type { SalesBreakdownRow } from "@/lib/repositories/sale.repo";

afterEach(() => cleanup());

const rows: SalesBreakdownRow[] = [
  { id: "p1", name: "Widget", unitsSold: 5, revenue: "50.00", cost: "20.00", profit: "30.00" },
];

describe("BreakdownTable", () => {
  it("renders a row per product with units/revenue/cost/profit", () => {
    render(<BreakdownTable rows={rows} groupBy="product" />);
    expect(screen.getByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText(/50\.00/)).toBeInTheDocument();
  });

  it("labels the first column header by groupBy", () => {
    render(<BreakdownTable rows={rows} groupBy="category" />);
    expect(screen.getByText(/category/i)).toBeInTheDocument();
  });

  it("renders an empty state when there are no rows", () => {
    render(<BreakdownTable rows={[]} groupBy="product" />);
    expect(screen.getByText(/no sales in this range/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/ReportsDateRangeFilter.test.tsx tests/unit/BreakdownTable.test.tsx`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Implement both components**

Create `components/reports/ReportsDateRangeFilter.tsx`:

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Label } from "@/components/ui/label";

export function ReportsDateRangeFilter({
  defaultFrom,
  defaultTo,
  defaultGroupBy,
}: {
  defaultFrom: string;
  defaultTo: string;
  defaultGroupBy: "product" | "category";
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function navigate(nextParams: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(nextParams)) {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    }
    router.push(`/reports?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap gap-3">
      <div>
        <Label htmlFor="report-from">From</Label>
        <input
          id="report-from"
          type="date"
          className="block h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          defaultValue={defaultFrom}
          onChange={(e) => navigate({ from: e.target.value || undefined })}
        />
      </div>

      <div>
        <Label htmlFor="report-to">To</Label>
        <input
          id="report-to"
          type="date"
          className="block h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          defaultValue={defaultTo}
          onChange={(e) => navigate({ to: e.target.value || undefined })}
        />
      </div>

      <div>
        <Label htmlFor="report-groupby">Group By</Label>
        <select
          id="report-groupby"
          className="block h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          defaultValue={defaultGroupBy}
          onChange={(e) => navigate({ groupBy: e.target.value || undefined })}
        >
          <option value="product">Product</option>
          <option value="category">Category</option>
        </select>
      </div>
    </div>
  );
}
```

Create `components/reports/BreakdownTable.tsx`:

```tsx
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SalesBreakdownRow } from "@/lib/repositories/sale.repo";

export function BreakdownTable({
  rows,
  groupBy,
}: {
  rows: SalesBreakdownRow[];
  groupBy: "product" | "category";
}) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground">No sales in this range.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{groupBy === "product" ? "Product" : "Category"}</TableHead>
            <TableHead>Units Sold</TableHead>
            <TableHead>Revenue</TableHead>
            <TableHead>Cost</TableHead>
            <TableHead>Profit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{row.name}</TableCell>
              <TableCell>{row.unitsSold}</TableCell>
              <TableCell>${row.revenue}</TableCell>
              <TableCell>${row.cost}</TableCell>
              <TableCell>${row.profit}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/ReportsDateRangeFilter.test.tsx tests/unit/BreakdownTable.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add components/reports/ tests/unit/ReportsDateRangeFilter.test.tsx tests/unit/BreakdownTable.test.tsx
git commit -m "Add ReportsDateRangeFilter and BreakdownTable components"
```

---

### Task 7: `/reports` page with search-param parsing and defaults

**Files:**
- Create: `app/(app)/reports/page.tsx`
- Test: `tests/unit/reports-page-params.test.ts`

**Interfaces:**
- Consumes: `requireUser` from `lib/auth/guards.ts`; `getSalesSummary`, `getSalesBreakdownByProduct`, `getSalesBreakdownByCategory` from `lib/repositories/sale.repo.ts`; `SummaryTiles` from Task 4; `ReportsDateRangeFilter`, `BreakdownTable` from Task 6.
- Produces: the rendered `/reports` route. Also exports a pure parsing helper for direct unit testing:
  ```ts
  export function parseReportRange(params: { from?: string; to?: string }, now: Date): { from: Date; to: Date };
  export function parseGroupBy(groupBy?: string): "product" | "category";
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/reports-page-params.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseReportRange, parseGroupBy } from "@/app/(app)/reports/page";

describe("parseReportRange", () => {
  const now = new Date("2026-01-15T12:00:00");

  it("parses valid from/to ISO date strings", () => {
    const { from, to } = parseReportRange({ from: "2026-01-01", to: "2026-01-10" }, now);
    expect(from.getDate()).toBe(1);
    expect(to.getDate()).toBe(10);
  });

  it("defaults to the current calendar month when params are missing", () => {
    const { from, to } = parseReportRange({}, now);
    expect(from.getDate()).toBe(1);
    expect(from.getMonth()).toBe(0);
    expect(to.getMonth()).toBe(0);
  });

  it("defaults to the current calendar month when params are unparseable", () => {
    const { from, to } = parseReportRange({ from: "not-a-date", to: "also-not-a-date" }, now);
    expect(from.getDate()).toBe(1);
    expect(to.getMonth()).toBe(0);
  });

  it("swaps from and to silently when from is after to", () => {
    const { from, to } = parseReportRange({ from: "2026-01-20", to: "2026-01-05" }, now);
    expect(from.getDate()).toBe(5);
    expect(to.getDate()).toBe(20);
  });
});

describe("parseGroupBy", () => {
  it("returns 'product' for undefined or unrecognized values", () => {
    expect(parseGroupBy(undefined)).toBe("product");
    expect(parseGroupBy("nonsense")).toBe("product");
  });

  it("returns 'category' only when explicitly requested", () => {
    expect(parseGroupBy("category")).toBe("category");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/reports-page-params.test.ts`
Expected: FAIL — `app/(app)/reports/page.tsx` doesn't exist yet.

- [ ] **Step 3: Implement `/reports` page**

Create `app/(app)/reports/page.tsx`:

```tsx
import { requireUser } from "@/lib/auth/guards";
import {
  getSalesSummary,
  getSalesBreakdownByProduct,
  getSalesBreakdownByCategory,
} from "@/lib/repositories/sale.repo";
import { SummaryTiles } from "@/components/dashboard/SummaryTiles";
import { ReportsDateRangeFilter } from "@/components/reports/ReportsDateRangeFilter";
import { BreakdownTable } from "@/components/reports/BreakdownTable";

type ReportsSearchParams = {
  from?: string;
  to?: string;
  groupBy?: string;
};

function startOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseReportRange(
  params: { from?: string; to?: string },
  now: Date
): { from: Date; to: Date } {
  const parsedFrom = parseDate(params.from) ?? startOfMonth(now);
  const parsedTo = parseDate(params.to) ?? now;

  if (parsedFrom.getTime() > parsedTo.getTime()) {
    return { from: parsedTo, to: parsedFrom };
  }
  return { from: parsedFrom, to: parsedTo };
}

export function parseGroupBy(groupBy: string | undefined): "product" | "category" {
  return groupBy === "category" ? "category" : "product";
}

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<ReportsSearchParams>;
}) {
  await requireUser();
  const sp = await searchParams;
  const now = new Date();

  const range = parseReportRange(sp, now);
  const groupBy = parseGroupBy(sp.groupBy);

  const [summary, breakdown] = await Promise.all([
    getSalesSummary(range),
    groupBy === "product" ? getSalesBreakdownByProduct(range) : getSalesBreakdownByCategory(range),
  ]);

  return (
    <div className="p-4 space-y-6">
      <h1 className="text-2xl font-semibold">Reports</h1>

      <ReportsDateRangeFilter
        defaultFrom={toDateInputValue(range.from)}
        defaultTo={toDateInputValue(range.to)}
        defaultGroupBy={groupBy}
      />

      <SummaryTiles label="Selected Range" summary={summary} />

      <BreakdownTable rows={breakdown} groupBy={groupBy} />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/reports-page-params.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Verify the full app still builds**

Run: `npx tsc --noEmit && npx next build`
Expected: clean compile, `/dashboard` and `/reports` both listed as registered routes in the build output.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/reports/page.tsx tests/unit/reports-page-params.test.ts
git commit -m "Implement /reports with date-range filter and product/category breakdown"
```

---

### Task 8: Final whole-branch review

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all Phase 8 tests pass; any pre-existing failures are limited to the already-documented Railway DB latency flakes (`inventory.service.test.ts` real-DB sanity check, `product.repo.test.ts` status-filter counts) — confirm no *new* failures were introduced.

- [ ] **Step 2: Run full type check and production build**

Run: `npx tsc --noEmit && npx next build`
Expected: clean compile, `/dashboard` and `/reports` registered as routes.

- [ ] **Step 3: Manually trace the Review Focus list against the implementation**

Re-read the Review Focus section at the top of this plan and confirm each of the 5 items against the actual merged code (not just the tests) — in particular, confirm `getSalesSummary`'s SQL never references `sales.status` to decide what counts as "returned", only `saleItems.returnedQuantity`.

- [ ] **Step 4: Commit any final-review fixes, then hand off**

If the review finds issues, fix them in one follow-up commit describing what was found (matching the pattern used at the end of Phases 6 and 7). If clean, no commit needed — proceed to whichever integration step (PR, merge) the user's workflow calls for next.
