# Phase 8 — Dashboard/Reports Design

**Status:** Approved for planning
**Date:** 2026-09-26
**Depends on:** Phases 1-7 (all merged to master as of commit `354093b`)

## Purpose

Give any signed-in user (no role restriction — matches how `/sales` and
`/products` already work) two new views:

- **`/dashboard`** — a quick daily operational glance: today's and
  month-to-date summary numbers, a short recent-sales list, and a short
  low-stock list. Replaces Phase 1's placeholder page at
  `app/(app)/dashboard/page.tsx`.
- **`/reports`** — a deeper, date-range-filterable view of the same
  summary metrics, plus a product/category breakdown table. New route.

Both pages are read-only. Neither introduces new mutations, schema
changes, or background jobs.

## Scope decisions (from brainstorming)

- **Access control:** same data for every authenticated user; no
  admin-only gate on `/reports` despite it surfacing cost/profit.
- **Dashboard default period:** two side-by-side blocks — **today** and
  **month-to-date** — not a single rolling window.
- **Reports filters:** date range (required), plus a product/category
  breakdown toggle. No staff-member ("sold by") filter in v1.
- **Returns/cancellations math:** tiles and reports show **gross**
  revenue/cost/profit (as if no returns happened) with a separate
  **returns line** shown as a deduction directly below each metric — not
  netted silently into the main number. A **cancelled sale is treated
  identically to a return**: per the existing `cancelSale` implementation
  (`lib/services/sale.service.ts`), cancelling writes
  `sale_items.returnedQuantity = quantity` on every line via the same
  `applyReturn` path a partial/full return uses, just with the parent
  `sales.status` set to `CANCELLED` instead of `RETURNED`. This means
  **no special-casing by sale status is needed** — the returns
  deduction is always `sum(returnedQuantity × per-unit figures)` across
  `sale_items` in range, regardless of why a line was returned.
- **Recent sales / low stock lists:** short (5-10 items), linking out to
  `/sales` and `/products` for the rest — not full inline lists.
- **Breakdown table:** per product or category (toggle, not both at
  once), showing units sold, revenue, cost, and profit — same four
  metrics as the top-level tiles, just sliced finer. Sorted by revenue
  descending; no interactive re-sort in v1.

## Architecture

### Routes

- `app/(app)/dashboard/page.tsx` (replace placeholder) — server
  component, `requireUser()` guard (existing pattern), no search params.
- `app/(app)/reports/page.tsx` (new) — server component, reads
  `from`/`to`/`groupBy` from `searchParams`. Defaults to current
  calendar month when absent or unparseable. If `from > to` after
  parsing, swap them silently (no error) — this is a read-only filter,
  not a destructive action.

### Repository layer (new functions)

All new aggregate queries live in `lib/repositories/sale.repo.ts`,
alongside the existing `listSales`/`countSales` from Phase 7, using the
same `db` client and Drizzle query builder conventions (no new
transaction/locking needs — these are plain reads).

```ts
export type SalesSummary = {
  saleCount: number;
  unitsSold: number;
  grossRevenue: string;   // numeric, returned as string like other money fields
  grossCost: string;
  grossProfit: string;
  returnedRevenue: string; // deduction line
  returnedCost: string;
  returnedProfit: string;
};

export async function getSalesSummary(range: { from: Date; to: Date }): Promise<SalesSummary>;
```

Implementation: one query joining `sale_items` to `sales`, filtered by
`sales.soldAt BETWEEN range.from AND range.to` (using the existing
`sales_sold_at_idx` index), with conditional aggregate expressions:

- Gross figures: `sum(quantity * ...)`-equivalent using the
  already-stored per-line `totalRevenue`/`totalCost`/`profit` columns
  (no need to recompute unit price × quantity — Phase 6 already stores
  the line totals).
- Returned figures: same three sums, scaled by
  `returnedQuantity / quantity` per line (since `returnedQuantity` can
  be partial), using the stored per-unit fields (`soldPricePerUnit`,
  `costPerUnit`, and per-unit profit `= (soldPricePerUnit - costPerUnit)`)
  multiplied by `returnedQuantity` directly — avoiding any fractional
  scaling of the stored line totals.
- `saleCount`: `count(distinct sale_items.sale_id)` in range.
- `unitsSold`: `sum(quantity)` gross (not reduced by returns — "units
  sold" reports what left the shelf during the period; returned units
  are visible via the returns deduction context, not by altering this
  count).

```ts
export type SalesBreakdownRow = {
  id: string;           // productId or categoryId
  name: string;          // productName or category name
  unitsSold: number;
  revenue: string;
  cost: string;
  profit: string;
};

export async function getSalesBreakdownByProduct(range: { from: Date; to: Date }): Promise<SalesBreakdownRow[]>;
export async function getSalesBreakdownByCategory(range: { from: Date; to: Date }): Promise<SalesBreakdownRow[]>;
```

Same join, `GROUP BY products.id` (or `categories.id` via
`products.categoryId`), ordered by summed revenue descending. Gross
figures only (no per-row returns deduction column in v1 — matches the
tiles' top-level returns line, not duplicated per row, to keep the
table simple).

`getSalesBreakdownByCategory` must account for `categoryId` being
nullable (uncategorized products) — group those under a literal
`"Uncategorized"` row rather than dropping them.

New function in `lib/repositories/inventory.repo.ts` (does **not**
already exist — corrected from an earlier assumption during design;
only the `LOW_STOCK_THRESHOLD = 5` constant in `lib/constants.ts`
predates this phase):

```ts
export async function listLowStockProducts(limit: number): Promise<ProductRow[]>;
```

Query: `products` where `status = 'ACTIVE' AND currentQuantity <=
LOW_STOCK_THRESHOLD`, ordered by `currentQuantity` ascending, limited.
Excludes archived products (consistent with the Phase 2/4 pattern of
treating archived as out-of-scope for active-inventory concerns).

Recent sales reuses Phase 7's existing `listSales` with
`{ limit: 10 }` and no other filters.

### Components

- `components/dashboard/SummaryTiles.tsx` — presentational, accepts a
  `SalesSummary` plus a label (`"Today"` / `"This month"`), renders a
  tile grid: each tile shows the gross figure with a smaller "Returns:
  −$X" sub-line beneath.
- `components/dashboard/RecentSalesList.tsx` — presentational, takes
  `SaleListRow[]` (existing type from Phase 7), links each row to
  `/sales/[id]`, with a "View all" link to `/sales`.
- `components/dashboard/LowStockList.tsx` — presentational, takes
  `ProductRow[]`, links each row to `/products/[id]`, with a "View all"
  link to `/products?status=ACTIVE` (or similar existing filter, TBD
  against Phase 2's actual query params during implementation).
- `components/reports/ReportsDateRangeFilter.tsx` — client component,
  URL-param-driven (same pattern as Phase 7's `SalesFilterBar`): date
  range inputs + product/category toggle, pushes new `searchParams` on
  change.
- `components/reports/BreakdownTable.tsx` — presentational, takes
  `SalesBreakdownRow[]` and a `groupBy: "product" | "category"` label
  for the first column header.

`SummaryTiles` is shared between `/dashboard` (rendered twice: today +
month) and `/reports` (rendered once, for the selected range).

### Data flow

**Dashboard:** `requireUser()` → compute `today` range and
`monthToDate` range server-side (server timezone — see Known
Limitation below) → `Promise.all([getSalesSummary(today),
getSalesSummary(monthToDate), listSales({limit: 10}),
listLowStockProducts(10)])` → render.

**Reports:** `requireUser()` → parse `searchParams.from`/`.to` (ISO
date strings) with fallback to current calendar month if missing or
invalid; parse `searchParams.groupBy` with fallback to `"product"` →
`Promise.all([getSalesSummary(range), groupBy === "product" ?
getSalesBreakdownByProduct(range) : getSalesBreakdownByCategory(range)])`
→ render `SummaryTiles` once + `ReportsDateRangeFilter` +
`BreakdownTable`.

### Error handling

- No new error states beyond existing `requireUser()` auth redirect
  behavior — these are read-only pages with no form submissions or
  mutations.
- Invalid/missing `/reports` search params degrade to a default range
  rather than erroring, consistent with Phase 7's `SalesFilterBar`
  treatment of absent filters.
- Empty result sets (no sales in range) render zeroed tiles and empty
  list/table states, not errors.

### Testing

- Unit tests for `getSalesSummary`, `getSalesBreakdownByProduct`,
  `getSalesBreakdownByCategory`, `listLowStockProducts` against seeded
  data covering: a plain completed sale, a partially returned sale, a
  fully returned sale, and a cancelled sale — asserting the cancelled
  sale's full amount lands in the returns deduction exactly like a full
  return, and gross figures are unaffected by any of the return states.
- Component tests for `SummaryTiles` (renders gross + returns line
  correctly), `BreakdownTable`, `ReportsDateRangeFilter` (URL param
  round-trip: changing the range/toggle updates the URL; reading the
  URL on load reflects it back into the inputs).
- Integration/page test for `/reports`' search-param parsing and
  fallback behavior (missing params, invalid dates, `from > to` swap).

## Known limitations (explicitly accepted, not deferred silently)

- **Business timezone gap:** "today" and "month-to-date" boundaries use
  the server's locale/timezone, same pre-existing app-wide gap noted
  since Phase 4/5 (history page timestamps). Not a new gap introduced
  by this phase; a configured business timezone would need its own
  cross-cutting fix.
- **No staff-member filter in `/reports` v1** — explicitly out of scope
  per the brainstorming decision; can be added later as another
  `searchParams` field without restructuring the summary/breakdown
  queries (both already take an implicit "all sales in range" filter
  that a `soldBy` clause could narrow).
- **Breakdown table has no per-row returns column** — only the
  top-level tiles show the returns deduction; a per-product/category
  returns breakdown is a possible future enhancement, not built now
  (YAGNI — no stated need surfaced during brainstorming).

## Files touched (implementation-plan level detail, not final)

- `app/(app)/dashboard/page.tsx` (rewrite)
- `app/(app)/reports/page.tsx` (new)
- `components/dashboard/SummaryTiles.tsx` (new)
- `components/dashboard/RecentSalesList.tsx` (new)
- `components/dashboard/LowStockList.tsx` (new)
- `components/reports/ReportsDateRangeFilter.tsx` (new)
- `components/reports/BreakdownTable.tsx` (new)
- `lib/repositories/sale.repo.ts` (add `getSalesSummary`,
  `getSalesBreakdownByProduct`, `getSalesBreakdownByCategory`)
- `lib/repositories/inventory.repo.ts` (add `listLowStockProducts`) —
  or `product.repo.ts`; final placement decided during planning based
  on which file's existing query patterns fit best (the low-stock query
  filters `products` directly, no join to `inventory_transactions`, so
  `product.repo.ts` may be the more natural home despite the constant's
  Phase-4 origin — a planning-time call, not a design-time one).
