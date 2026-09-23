# Phase 6 — Sales — Design

Parent spec: [`2026-09-20-inventory-qr-sales-app-design.md`](2026-09-20-inventory-qr-sales-app-design.md)
(see "Implementation Phases" #6, and source requirements
[`inventory_qr_sales_app_claude_prompt.md`](../../../inventory_qr_sales_app_claude_prompt.md)
Phase 6 section: Sell page, Scan product, Quantity, Sold price, Sale
calculation, Profit calculation, Inventory update, Sale transaction,
Sale history, Sale confirmation — "This phase must use proper database
transactions.").

## Summary

An authenticated `/sell` page where staff build a multi-product cart —
by scanning QR codes with Phase 5's reusable `<QrScanner>` component or
searching by name/SKU — then check out as one atomic sale: inventory is
decremented, a `sales` row and one `sale_items` row per line are
recorded, and profit is computed per line from each product's current
cost price. A `/sales` list and `/sales/[id]` detail page round out the
"sale history" deliverable.

Explicitly **not** in scope: returns/cancellations (Phase 7, which will
read but not write today's `sales`/`sale_items` rows), dashboard/report
aggregation beyond the plain sale-history list (Phase 8), CSV
import/export of sales (Phase 9), and a `customers` entity (buyer name/
phone are free-text fields on `sales`, not a normalized table — see
"Data Model Changes").

## What's already in place (Phases 1-5)

- `components/scan/QrScanner.tsx` — reused as-is, no changes. Its
  `onDecode`/`paused` props and internal permission-state UI
  (`denied`/`unavailable` messages, repeat-decode dedup) are exactly
  what this phase needs; this is the reuse Phase 5's design doc called
  out by name.
- `lib/scan/parse-qr-payload.ts` — reused as-is to interpret a camera
  decode into a `publicIdentifier`.
- `products` table + `lib/repositories/product.repo.ts`
  (`findProductBySku`, `findProductByPublicIdentifier`, `findProductById`,
  `listProducts`) — existing lookups this phase's cart-add and search
  reuse directly; no new product-repo code needed.
- `lib/services/inventory.service.ts`'s `adjustInventory` — not called
  directly by this phase (a sale is its own transaction, not a call
  into the adjustment service), but its `db.transaction()` +
  `SELECT ... FOR UPDATE` + insert-`inventory_transactions`-in-the-same-
  transaction pattern is the template `completeSale` follows and
  extends to multiple rows.
- `sales` / `sale_items` tables already exist in `lib/db/schema.ts`
  (scaffolded from the parent spec's Data Model) — this phase adds two
  columns and a sequence (below), writes to them for the first time,
  and is the first phase to read them back for history.
- `requireUser()` in `lib/auth/guards.ts` — this phase's page and
  action use it, same as Phase 5: any authenticated staff member can
  sell, not admin-gated (the source spec's Phase 6 section has no
  role restriction, consistent with scanning).

## Data Model Changes

```sql
ALTER TABLE sales ADD COLUMN buyer_name TEXT NULL;
ALTER TABLE sales ADD COLUMN buyer_phone TEXT NULL;

CREATE SEQUENCE sale_number_seq START 1;
```

- `buyer_name` / `buyer_phone` — both optional, inline on `sales` (not
  a separate `customers` table). Captured on the checkout/confirm step,
  not required to complete a sale. No normalization, dedup, or lookup
  UI — free-text fields for record-keeping (e.g. store credit,
  follow-up), matching the source spec's minimal Phase 6 scope. A
  `customers` table is explicitly deferred (YAGNI) unless a future
  phase needs customer history or lookup.
- `sale_number_seq` — a real Postgres sequence, not a derived/counted
  value. `sale_number` is generated at insert time as
  `'SALE-' || lpad(nextval('sale_number_seq')::text, 6, '0')`
  (`"SALE-000001"`, matching the parent spec's example). A sequence
  guarantees no collisions or lost numbers under concurrent checkouts
  without extra locking — the correct tool for a monotonic
  human-readable order number, versus counting existing rows (fragile
  under concurrency) or requiring the checkout transaction to lock the
  whole `sales` table.

## New Components

### 1. `/sell` page — `app/(app)/sell/page.tsx`

Client component with two view states, both on the same route (no
child route for checkout — the earlier design decision was to keep
cart state in one component tree since it's plain `useState`, not
persisted):

**Cart-building view (default):**
- `<QrScanner onDecode={handleDecode} paused={false} />` at the top,
  always live in this view.
- `<ProductSearch onSelect={handleAddProduct} />` below it — a live
  search-by-name-or-SKU fallback (debounced query against
  `listProducts`), tap a result to add it to the cart. Always visible,
  same "standing fallback, not permission-gated" pattern as Phase 5's
  manual-SKU input.
- `<SellCart>` below that: one row per cart line (product name, SKU,
  qty with +/- steppers, sold price — prefilled from the product's
  `selling_price` and directly editable, per-line subtotal, remove
  button), plus a running total. Empty state: "Scan or search a
  product to add it to this sale."
- A soft stock warning per line if `quantity > currentQuantity` as
  known from when the line was added or last refreshed (client-side
  only, not re-fetched live — see "Error Handling"). Does not block
  adding/editing; checkout is the authoritative check.
- "Checkout" button, disabled when the cart is empty, switches to the
  checkout view.

**Checkout view (after tapping Checkout):**
- `<QrScanner>` is unmounted here (not just hidden) — this triggers its
  existing unmount cleanup (camera stream released, ZXing decode loop
  stopped, the Phase 5 fix), so no stray scan can mutate the cart while
  reviewing. A "Back to cart" control remounts the cart-building view
  (and, with it, a fresh `<QrScanner>` instance).
- Read-only summary of the cart lines and total.
- Two optional text inputs: buyer name, buyer phone.
- "Confirm Sale" button → calls `completeSale`. On success, shows a
  brief confirmation (sale number, total) and routes to
  `/sales/[id]`. On failure (see "Error Handling"), shows which line(s)
  failed and returns the user to the cart-building view with the
  failing line(s) flagged — cart state is untouched, nothing is
  cleared, so the user can adjust quantities and retry immediately.

### 2. `components/sell/SellCart.tsx`

Presentational cart component: renders lines, qty steppers, editable
price inputs, remove buttons, running total. Receives cart state and
mutator callbacks as props from `/sell`'s page-level state — no
internal fetching, no knowledge of the checkout/API layer, kept testable
in isolation the same way `QrScanner` has no knowledge of products.

### 3. `components/sell/ProductSearch.tsx`

Debounced text input + result list. Queries `listProducts` (existing,
reused) filtered by name/SKU substring match; on tap, calls
`onSelect(product)`. No new repo function — `listProducts` already
supports the filtering this needs (confirmed against its existing
`ListParams` in `product.repo.ts`).

### 4. Cart state & add/increment logic (in `/sell/page.tsx`)

```ts
type CartLine = {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  soldPricePerUnit: number;
  knownStock: number; // currentQuantity as of when this line was added/updated
};
```

- Adding a product already in the cart (by `productId`) increments its
  `quantity` by 1 rather than creating a duplicate line — applies
  identically whether the product arrived via scan or search.
- `parseQrPayload` → `resolveProductForScan`-style lookup is reused
  directly from Phase 5's action (`resolveProductForScan` already
  accepts `publicIdentifier` or `sku` and returns just `{ id }`) — but
  this phase needs the full product row (name, SKU, price, stock), not
  just an id, to build a cart line and immediately navigate nowhere.
  See "New server code" below for `lookupProductForSale`, the one new
  lookup this phase adds.
- A decoded/searched product that resolves to `null` (no match) shows
  the same inline-error pattern as `/scan`: "Product not found" /
  "Not a recognized product QR code," cart unaffected.
- **Archived products can be added and sold** — explicit design
  decision (clearance/discontinued-stock use case), enforced by *not*
  adding any status filter to the lookup or to `completeSale`'s
  validation, matching how Phase 5 already lets archived products
  resolve through scanning to their detail page.

### 5. New server code

```ts
// lib/actions/sale.actions.ts (new file) — "use server" actions, both
// call requireUser() first, then delegate to the service functions below
async function lookupProductForSale(
  input: { publicIdentifier?: string; sku?: string }
): Promise<{ id: string; productName: string; sku: string; sellingPrice: string | null; currentQuantity: number } | null>

async function completeSaleAction(
  input: Omit<CompleteSaleInput, "userId">
): Promise<{ saleId: string; saleNumber: string }>
// ^ thin wrapper: requireUser() supplies userId, then calls
//   sale.service.ts's completeSale(input) below and shapes its
//   return value down to just what the client needs to navigate.

// lib/services/sale.service.ts (new file)
type CompleteSaleInput = {
  items: { productId: string; quantity: number; soldPricePerUnit: number }[];
  buyerName?: string;
  buyerPhone?: string;
  userId: string;
};

async function completeSale(input: CompleteSaleInput): Promise<SaleWithItems>

// lib/repositories/sale.repo.ts (new file)
function insertSale(data: NewSale, tx: DbOrTx): Promise<SaleRow>
function insertSaleItems(data: NewSaleItem[], tx: DbOrTx): Promise<SaleItemRow[]>
function listSales(params: { limit: number; offset: number }): Promise<SaleRow[]>
function countSales(): Promise<number>
function findSaleById(id: string): Promise<(SaleRow & { items: SaleItemRow[] }) | undefined>
```

`lookupProductForSale` is a small new lookup (not a modification of
Phase 5's `resolveProductForScan`, which stays untouched and
Sell-agnostic per its own design's "out of scope") — it needs the full
row for the cart line UI, where `resolveProductForScan` deliberately
returns only an `id`.

`completeSale` (service layer) is the transactional core:

```ts
async function completeSale(input: CompleteSaleInput): Promise<SaleWithItems> {
  return db.transaction(async (tx) => {
    // 1. Lock every distinct product row in the cart, sorted by
    //    productId, in a single query — a stable lock order across all
    //    concurrent completeSale calls prevents a classic multi-row
    //    deadlock (two carts locking the same two products in opposite
    //    order). Phase 4's adjustInventory only ever locks one row, so
    //    this is new ground for this codebase, called out explicitly
    //    here and in the implementation plan's Review Focus.
    // 2. For each line: product must exist (else throw
    //    ProductNotFoundError, reusing Phase 2's error type) and
    //    currentQuantity >= requested quantity (else throw
    //    InsufficientInventoryError, reusing Phase 4's error type) —
    //    any single line failing throws immediately, rolling back the
    //    whole transaction. No status/archived check (see above).
    // 3. Decrement each product's currentQuantity.
    // 4. Insert one inventory_transactions row per line
    //    (type: "SALE", quantity: -requestedQuantity, referenceId:
    //    the new sale's id once it's known — see ordering note below).
    // 5. Generate sale_number from sale_number_seq; insert one sales
    //    row (totalAmount/totalCost/totalProfit summed across lines,
    //    buyerName/buyerPhone from input, status: "COMPLETED").
    // 6. Insert one sale_items row per line: costPerUnit snapshots the
    //    product's CURRENT cost_price (schema has no cost-price
    //    history, so "current at sale time" is the only available
    //    basis — consistent with sold_price_per_unit also being a
    //    snapshot, not a live reference), soldPricePerUnit from input,
    //    totalCost/totalRevenue/profit computed per line.
    // 7. Return the sale row joined with its items for the
    //    confirmation screen / detail page.
  });
}
```

Ordering note: `inventory_transactions.reference_id` (existing column,
currently unused by Phase 4's `PURCHASE`/`ADJUSTMENT`/etc. transactions)
gets populated with the new sale's `id` for `SALE`-type transactions —
insert the `sales` row first (step 5 before step 4 in execution order,
renumbered accordingly in the implementation plan), so each
`inventory_transactions` row can reference it. This is the first phase
to populate `reference_id`; no schema change needed, the column already
exists for exactly this purpose per the parent spec's ERD.

`InsufficientInventoryError` and `ProductNotFoundError` are reused from
`lib/services/inventory.service.ts` / `lib/services/product.service.ts`
directly (same error types, same meaning) rather than redefined — the
sell page's error handling can share one code path with the existing
adjust-stock page's error UI patterns if useful, though the UI itself
is new.

### 6. `/sales` page — `app/(app)/sales/page.tsx`

Server component (no interactivity needed beyond pagination links).
Table/list: sale number, sold-at date, buyer name (if present), total
amount, status, sold-by. Newest first. Plain offset pagination (no
filtering or date-range yet — that is Phase 8's "reports" territory
per the parent spec's phase breakdown, explicitly deferred here to
avoid duplicating that work).

### 7. `/sales/[id]` page — `app/(app)/sales/[id]/page.tsx`

Server component. Full detail: sale number, sold-at, sold-by, buyer
name/phone (if present), status, notes; a line-item table (product
name/SKU — linking to `/products/[id]` — quantity, sold price per
unit, cost per unit, line revenue, line profit); sale-level totals
(amount, cost, profit) matching the sum of its lines. A 404 (via
`findSaleById` returning `undefined`) for an unknown id, same pattern
as `/products/[id]`.

## Data Flow

```
Staff opens /sell (cart-building view)
        │
        ▼
<QrScanner> live  +  <ProductSearch> live
        │                    │
   decode text          type + tap result
        │                    │
        ▼                    ▼
parseQrPayload / lookupProductForSale({ sku })
        │
   ┌────┴─────┐
   │          │
 found      null → inline error, cart unaffected
   │
   ▼
already in cart? → increment quantity : add new line
(soldPricePerUnit defaults to product.selling_price, editable)
        │
        ▼
SellCart shows updated lines + running total + soft stock warnings
        │
   tap "Checkout" (disabled if cart empty)
        │
        ▼
Checkout view: <QrScanner> unmounted, cart shown read-only,
buyer name/phone (optional), "Confirm Sale"
        │
        ▼
completeSale({ items, buyerName?, buyerPhone?, userId })
        │
   ┌────┴──────────────────────┐
   │                            │
 success                  any line fails stock/existence check
   │                            │
   ▼                            ▼
router.push(`/sales/${saleId}`)   whole transaction rolls back;
                                   return to cart-building view,
                                   failing line(s) flagged, cart
                                   state untouched
```

## Error Handling

- Scanned/searched product not found → inline error, same copy pattern
  as Phase 5 ("Product not found" / "Not a recognized product QR
  code"), cart unaffected, user can immediately retry.
- Client-side stock warning (requested `quantity` > last-known
  `currentQuantity` for that line) → non-blocking inline warning on
  that cart line; does not prevent tapping Checkout, since the
  authoritative check happens in the transaction. Stale by design (not
  re-fetched on every keystroke) — this is a UX hint, not a guarantee.
- Checkout stock failure (`InsufficientInventoryError` on any line,
  inside the transaction) → **whole sale rejected, transaction rolls
  back entirely** (explicit design decision — matches the source
  spec's "must use proper database transactions," all-or-nothing, no
  partial sales). User is returned to the cart-building view with the
  specific failing line(s) marked; nothing else about the cart is
  cleared or reset.
- Checkout product-not-found failure (a cart line's product was
  archived-and-deleted or otherwise vanished between add and confirm —
  edge case, no delete feature exists yet in this app, but defensive
  since `ProductNotFoundError` is a real throw path in the shared
  service pattern) → same rollback-and-flag treatment as a stock
  failure.
- Empty cart → "Checkout" is disabled, not merely validated after the
  fact.
- Zero/negative quantity or sold price → rejected client-side (Zod
  schema in `lib/validation/sale.schema.ts`) before `completeSale` is
  ever called, same validate-at-the-boundary approach as Phases 4-5.
- Archived product added to cart → no error, sells normally (explicit
  decision, see "New Components" #4).
- Unauthenticated access to `/sell`, `/sales`, `/sales/[id]`, or a
  direct call to `completeSale`/`lookupProductForSale` → handled by the
  existing `(app)` route group's auth enforcement / `requireUser()`'s
  redirect, nothing new to build.

## Testing

- **Unit:**
  - `sale.service.ts`'s `completeSale` — happy path (single line, multi
    line), quantity decrements correctly per line, `sale_number`
    increments monotonically across calls, profit computed correctly
    per line (`(soldPrice - costPrice) * quantity`) and summed
    correctly at the sale level, `InsufficientInventoryError` thrown
    and transaction rolled back (no partial writes) when any one line
    of a multi-line cart would go negative, `ProductNotFoundError`
    thrown for an unknown `productId`, archived products complete
    successfully (no filtering), `inventory_transactions` rows get the
    new sale's id as `reference_id`.
  - `lookupProductForSale` — resolves by `publicIdentifier`, resolves
    by `sku`, returns `null` for no match, throws on unauthenticated
    access.
  - Row-lock ordering — a focused test asserting the lock query sorts
    by `productId` before acquiring (guards against a future edit
    silently reintroducing the deadlock risk); exact test shape (query
    inspection vs. a two-concurrent-transaction integration test) is an
    implementation-plan-level decision given this project's documented
    Railway Postgres concurrency-test flakiness (see infra notes) —
    likely a deterministic mocked test in the same style as Phase 4's
    `inventory.service.concurrency.test.ts`, not a real-DB race test.
- **Component:**
  - `SellCart` — renders lines, qty stepper increments/decrements
    correctly (never below 1; a stepper down from 1 removes the line
    or is a no-op — implementation plan decides which, default to
    "remove" since that matches most POS UX and avoids a confusing
    quantity-0 line), editable price input updates the line/total,
    remove button removes a line, running total recalculates.
  - `/sell` page-level — adding the same product twice increments
    rather than duplicates (via a mocked `QrScanner`/`ProductSearch`,
    same mocking pattern Phase 5 used for `QrScanner` in
    `scan.page.test.tsx`), Checkout disabled when cart is empty,
    checkout view unmounts the scanner (assert on the mocked
    component's unmount, same technique validated in Phase 5's
    `QrScanner` unmount-cleanup regression test), a rejected checkout
    returns to the cart view with the cart contents intact.
- **Manual checklist (real camera hardware, same reasoning as Phase 5):**
  scan multiple different real products into a cart on a mobile device,
  complete a sale, verify it appears correctly in `/sales/[id]`; verify
  the insufficient-stock rejection path with a real product whose
  quantity is temporarily set low.

## Out of Scope for This Phase

Returns/cancellations and any mutation of a completed sale (Phase 7 —
this phase only ever inserts `sales`/`sale_items`, never updates or
deletes them); a `customers` table or any customer lookup/history
beyond the two free-text fields on `sales`; sales reporting, revenue/
profit dashboards, or date-range filtering (Phase 8); CSV export of
sales (Phase 9); barcode formats beyond QR (unchanged from Phase 5's
same deferral); cart persistence across a page refresh or navigation
(explicit design decision — client `useState` only); a distinct
`/sell/checkout` route (explicit design decision — checkout is an
in-page view state); rate limiting on `completeSale` (Phase 10, same
deferral pattern as every prior phase's auth-gated actions).
