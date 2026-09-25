# Phase 7 — Returns/Cancellations — Design

Parent spec: [`2026-09-20-inventory-qr-sales-app-design.md`](2026-09-20-inventory-qr-sales-app-design.md)
(see "Implementation Phases" #7, and source requirements
[`inventory_qr_sales_app_claude_prompt.md`](../../../inventory_qr_sales_app_claude_prompt.md)
section 21 "Returns and Cancellations" and section 22 "Sales Page" —
"Support sale status COMPLETED/CANCELLED/RETURNED", "Allow a completed
sale to be cancelled/returned", "Restore inventory", "Create inventory
transaction", "Update sale status", "Do NOT delete the sale", "Preserve
audit history"; Phase 7 list entry: "Cancel sale", "Return sale",
"Restore inventory", "Inventory transaction", "Audit log"; Sales Page
section: search by SKU, search by sale number, date filter, product
filter, user filter, status filter).

## Summary

Lets any authenticated user unwind a completed sale two ways — a
whole-sale **cancel** (only while nothing has been returned yet) or a
per-line-item **return** with a partial quantity per line — restocking
inventory, recording an `inventory_transactions` row and an
`audit_logs` row for every unwind, and updating the sale's status,
inside one database transaction per action. The sale and its original
line items are never deleted or mutated in value; returns are tracked
as a running `returnedQuantity` per line and the sale's status derives
from that. Also closes out the Phase 6 design doc's deferred "Sales
Page" filter requirements: `/sales` gains search/filter by sale
number, SKU, date range, product, user, and status.

Explicitly **not** in scope: refund/payment processing (money already
changed hands outside this app; a return only reverses inventory and
sale status/record-keeping, not any payment rail), a full user-facing
audit-log viewer page (this phase only starts **writing** to
`audit_logs`; a page to browse it is Phase 10 "Security and Polish"
territory unless the user asks sooner), dashboard/report aggregation
of return/cancellation rates (Phase 8), and re-selling a
returned/cancelled sale's items as a new sale (out of scope entirely —
a returned item goes back into general stock and gets sold again
through the normal `/sell` flow like any other unit).

## What's already in place (Phases 1-6)

- `sales` / `sale_items` tables, `sale_status` and
  `inventory_transaction_type` enums, `completeSale` in
  `lib/services/sale.service.ts` — this phase extends all three rather
  than introducing a parallel path. `completeSale`'s
  `db.transaction()` + sorted multi-row `SELECT ... FOR UPDATE` +
  insert-`inventory_transactions`-in-the-same-transaction pattern is
  the direct template for this phase's restock logic.
- `lib/repositories/sale.repo.ts` (`insertSale`, `insertSaleItems`,
  `findSaleById`, `listSales`, `countSales`) — extended with new
  functions (below), not replaced.
- `lib/repositories/inventory.repo.ts`'s `insertInventoryTransaction` —
  reused as-is; this phase's restock action is just another caller,
  writing `type: "RETURN"` instead of `"SALE"`.
- `app/(app)/sales/page.tsx` (plain paginated list, no filters) and
  `app/(app)/sales/[id]/page.tsx` (detail page, read-only) — both
  gain new UI in this phase; neither is rebuilt from scratch.
- `requireUser()` in `lib/auth/guards.ts` — cancel/return actions use
  this (not `requireAdmin()`): any authenticated user who can complete
  a sale can also cancel or return it, consistent with Phase 6's own
  access level and an explicit decision for this phase (not
  admin-gated like Phase 4's inventory adjustments, since no reason
  field is required here either — see "Decisions" below).
- `audit_logs` table — exists in `lib/db/schema.ts` since the parent
  spec's initial schema but has never been written to by any phase
  through Phase 6. This phase is its first real writer.

## Decisions

Captured from brainstorming, since several of these reverse the
"obvious" simpler default and are easy to re-litigate by accident
during implementation:

- **Partial per-line returns, not whole-sale-only.** A return can
  target any subset of a sale's line items, and any quantity up to
  what remains unreturned on that line (not all-or-nothing per line).
- **Cancel is whole-sale and only legal from `COMPLETED`.** Once a
  single item has been returned (status is `PARTIALLY_RETURNED`),
  "cancel" is no longer offered — only further per-item returns apply
  from that point, until the sale reaches `RETURNED`. This is enforced
  in the service layer, not just hidden in the UI.
- **No required reason field.** Unlike Phase 4's `adjustInventory`,
  cancel/return actions capture no free-text justification beyond a
  confirm step — this was an explicit choice, not an oversight; the
  `notes` column on the resulting `inventory_transactions` row gets a
  generated description instead (see "Service Layer").
- **Any authenticated user, not admin-only.**
- **Original sale totals (`totalAmount`/`totalCost`/`totalProfit`)
  never change.** They remain an immutable record of what was
  originally sold. Returned value is derived on read from
  `sale_items.returnedQuantity × soldPricePerUnit` (and the cost/profit
  equivalents), never written back onto the `sales` row. This avoids
  float/rounding drift from repeated partial updates and keeps the
  `sales` table as a true ledger of the original transaction.
- **`audit_logs` gets its first real writes.** One row per cancel/return
  action (not one per line item), summarizing the whole action in
  `metadata`.

## Data Model Changes

```sql
ALTER TYPE sale_status ADD VALUE 'PARTIALLY_RETURNED';
ALTER TYPE inventory_transaction_type ADD VALUE 'RETURN';
ALTER TABLE sale_items ADD COLUMN returned_quantity INTEGER NOT NULL DEFAULT 0;
```

`sale_status` becomes: `COMPLETED`, `CANCELLED`, `PARTIALLY_RETURNED`,
`RETURNED`. Lifecycle (enforced in the service layer, not the DB):

```
COMPLETED ──cancel (nothing returned yet)──────────▶ CANCELLED
    │
    ├──return SOME (not all) outstanding qty────────▶ PARTIALLY_RETURNED
    │                                                        │
    │                                                        └──return the rest──▶ RETURNED
    │
    └──return ALL outstanding qty in one call───────▶ RETURNED
```

`CANCELLED` and `RETURNED` are terminal — no action in this phase
transitions out of them. `PARTIALLY_RETURNED` can only move to
`RETURNED`, never back to `COMPLETED`.

`sale_items.returned_quantity` tracks cumulative returned units per
line, defaulting to 0, bounded above by that line's own `quantity`
(enforced in the service layer on every write, not a DB constraint —
consistent with how `products.current_quantity`'s non-negative
invariant is enforced in `adjustInventory`/`completeSale` today rather
than via a CHECK constraint).

## Service Layer

New file additions to `lib/services/sale.service.ts`:

```ts
export class SaleNotFoundError extends Error { /* saleId */ }
export class SaleNotCancellableError extends Error { /* saleId, currentStatus */ }
export class InvalidReturnQuantityError extends Error {
  /* saleItemId, requested, remaining */
}

export type ReturnSaleItemsInput = {
  saleId: string;
  userId: string;
  items: { saleItemId: string; quantity: number }[]; // quantity > 0
};

export async function returnSaleItems(
  input: ReturnSaleItemsInput
): Promise<SaleWithItems> { /* ... */ }

export type CancelSaleInput = { saleId: string; userId: string };

export async function cancelSale(
  input: CancelSaleInput
): Promise<SaleWithItems> { /* ... */ }
```

**`returnSaleItems`** — the core engine, run inside one
`db.transaction()`:

1. Lock the sale row (`SELECT ... FOR UPDATE` on `sales` by id) and its
   full set of `sale_items` rows (`SELECT ... FOR UPDATE`, ordered by
   `id` ascending — same stable-lock-order rationale as
   `completeSale`'s sorted product-id locking, so two concurrent
   actions against the same sale can't deadlock each other).
2. If the sale doesn't exist: throw `SaleNotFoundError`. If its status
   is not `COMPLETED` or `PARTIALLY_RETURNED`: throw
   `SaleNotCancellableError`-style rejection (reuse or add a sibling
   typed error — exact naming decided during implementation, but the
   distinct case of "already CANCELLED/RETURNED" must produce a
   clear, distinct error from `InvalidReturnQuantityError`).
3. For each requested `{saleItemId, quantity}`: resolve the locked
   line, compute `remaining = line.quantity - line.returnedQuantity`.
   If `quantity <= 0` or `quantity > remaining`: throw
   `InvalidReturnQuantityError`. Validate every line BEFORE writing
   anything, same "validate all, then mutate all" discipline as
   `completeSale` — a single invalid line rolls back the whole call,
   never a partial application of a multi-line return request.
4. For each validated line: `UPDATE sale_items SET returned_quantity =
   returned_quantity + :qty`; `UPDATE products SET current_quantity =
   current_quantity + :qty` (restock, keyed by that line's
   `productId`); `INSERT INTO inventory_transactions` (`type:
   "RETURN"`, `quantity: +qty`, `referenceId: saleId`, `notes:
   "Return against Sale ${saleNumber}"`, `createdBy: userId`) — one
   inventory-transaction row per returned line, mirroring
   `completeSale`'s one-row-per-line convention.
5. Recompute sale status from the now-updated lines: every line's
   `returnedQuantity == quantity` → `RETURNED`; else any line with
   `returnedQuantity > 0` → `PARTIALLY_RETURNED`. `UPDATE sales SET
   status = :computed`.
6. Insert one `audit_logs` row: `action: "SALE_RETURNED"`,
   `entityType: "sale"`, `entityId: saleId`, `userId`, `metadata: {
   items: [{saleItemId, productId, quantity}], resultingStatus }`.
7. Return the updated sale + items (same shape `completeSale`
   returns).

**`cancelSale`** is a thin, separately-named entry point that enforces
its own stricter precondition and then delegates into the same
restock/transaction/audit machinery:

1. Lock the sale (`SELECT ... FOR UPDATE`).
2. If status is not exactly `COMPLETED`: throw
   `SaleNotCancellableError` (this is what makes cancel unavailable
   once any return has happened — a `PARTIALLY_RETURNED` sale fails
   this check even though it would pass `returnSaleItems`'s looser
   status check).
3. Build a full-return item list — every line's entire
   `quantity - returnedQuantity` (which for an untouched `COMPLETED`
   sale is just every line's full `quantity`) — and run the same
   restock/inventory-transaction/status-recompute/audit-log steps
   described above, but write `CANCELLED` as the resulting status
   instead of letting step 5's derivation produce `RETURNED`, and use
   `action: "SALE_CANCELLED"` / a `"Cancelled Sale ${saleNumber}"`
   inventory-transaction note instead of the return phrasing.

Implementation is free to factor steps 4-6 into one shared private
helper called by both `returnSaleItems` and `cancelSale` with a
`resultingStatus` override — the spec describes the observable
behavior and transaction boundary, not the exact function split.

## Repository Layer

`lib/repositories/sale.repo.ts` additions:

- `findSaleForUpdate(saleId, tx)` — locked single-row sale fetch.
- `findSaleItemsForUpdate(saleId, tx)` — locked, `id`-ordered line
  fetch.
- `updateSaleItemReturnedQuantity(saleItemId, newReturnedQuantity, tx)`.
- `updateSaleStatus(saleId, status, tx)`.
- `listSales` and `countSales` extended with an options object:
  `{ limit, offset, saleNumberOrSku?, dateFrom?, dateTo?, productId?,
  userId?, status? }`. `saleNumberOrSku` matches `sales.saleNumber`
  OR any of the sale's `sale_items.product.sku` values (a join,
  consistent with `findSaleById`'s existing product-join pattern from
  Phase 6's final-review fix). All filters are optional and
  AND-combined when multiple are present.

New file `lib/repositories/audit-log.repo.ts`:

- `insertAuditLog(data: { userId, action, entityType, entityId,
  metadata }, tx?)` — first real usage of the `audit_logs` table,
  following the same `DbOrTx`-parameter convention as
  `insertInventoryTransaction` so it can participate in the same
  transaction as its caller.

## Server Actions

`lib/actions/sale.actions.ts` additions, following the codebase's
established `{error}`-return (not throw) pattern for Server Actions —
this is the pattern Phase 6's final review corrected
`completeSaleAction` to use, and both new actions here follow it from
the start rather than repeating that mistake:

```ts
export async function returnSaleItemsAction(
  input: ReturnSaleItemsInput
): Promise<{ error?: string } | { success: true }> { /* ... */ }

export async function cancelSaleAction(
  input: CancelSaleInput
): Promise<{ error?: string } | { success: true }> { /* ... */ }
```

Both call `requireUser()` first. Each typed service error maps to a
user-readable `error` string (mirroring how `completeSaleAction`
already maps `InsufficientInventoryError`/`ProductNotFoundError`).

## UI

**`/sales/[id]` detail page** (`app/(app)/sales/[id]/page.tsx`):

- "Cancel Sale" button/confirm-dialog, rendered only when
  `sale.status === "COMPLETED"`. Confirming calls `cancelSaleAction`
  with no additional input beyond the sale id.
- "Return Items" button, rendered when `sale.status === "COMPLETED"`
  or `"PARTIALLY_RETURNED"`, opening a dialog listing every sale item
  with its `quantity`, `returnedQuantity`, and remaining returnable
  amount, plus an editable "quantity to return" input per line
  (bounded `0..remaining` client-side; the service layer is the real
  enforcement). Submits the non-zero lines to
  `returnSaleItemsAction`.
- When `returnedQuantity > 0` exists anywhere on the sale, the page
  additionally shows derived lines: "Returned: -$X" and "Net: $Y",
  computed client/server-render-time from
  `sum(returnedQuantity × soldPricePerUnit)` etc. — never read from a
  stored column, per the "Decisions" section above.
- Status badge extended to render `PARTIALLY_RETURNED` and the
  already-existing `RETURNED`/`CANCELLED` values distinctly (reuse the
  existing `Badge` component/variant pattern from Phase 6's
  `/sales` list).

**`/sales` list page** (`app/(app)/sales/page.tsx`):

- Filter bar above the table, URL-search-param driven (extends the
  existing `?page=` pattern rather than introducing client state):
  a text input for sale number/SKU (`?q=`), a date range picker
  (`?dateFrom=&dateTo=`), a product select (`?productId=`), a user
  select (`?userId=`), and a status select (`?status=`) offering all
  four `sale_status` values. Changing any filter resets `page` to 1.
- Product and user select options are populated server-side from
  existing repo functions (`listProducts`, a user-listing equivalent —
  reuse what exists, add a minimal `listUsers`-style query only if
  nothing suitable already exists).
- Empty-state and pagination text adjusted to reflect when filters are
  active ("No sales match these filters" vs. the existing "No sales
  yet").

## Testing

Following this codebase's established patterns (deterministic mocked
tests for transactional/concurrency-sensitive logic — real-DB
"concurrency" tests are known-unreliable against this project's
Railway instance, see the inventory-app-infra-notes memory; TDD
per-task):

- **Unit** (`tests/unit/sale.service.test.ts` additions):
  `returnSaleItems` happy path (single line, multiple lines, one
  product touched by two lines); over-return rejection
  (`quantity > remaining`); zero/negative quantity rejection; status
  transition boundaries (`COMPLETED`→`PARTIALLY_RETURNED`,
  `PARTIALLY_RETURNED`→`RETURNED`, all-lines-in-one-call→`RETURNED`
  directly from `COMPLETED`); `cancelSale` happy path from
  `COMPLETED`; `cancelSale` rejection from `PARTIALLY_RETURNED`,
  `RETURNED`, and `CANCELLED`. Mock the transaction/select/update
  chain the same way `inventory.service.concurrency.test.ts` does for
  Phase 4, including an assertion on lock strength
  (`.for("update")`) to catch a regression to a weaker lock.
- **Integration** (`tests/integration/sale.repo.test.ts` additions):
  new repo functions against the real test DB; `listSales`/`countSales`
  filter combinations (each filter alone, two combined, no matches).
- **Unit/component** (`tests/unit/sale.actions.test.ts`,
  new `tests/unit/SaleDetail.test.tsx` or similar): Server Action
  error-mapping for each typed service error; return-dialog quantity
  bounding and submit behavior; cancel-button visibility gated on
  status.

## Known Non-Blocking Gaps (parked, not fixed this phase)

- No refund/payment-rail integration — this app never processed
  payment in the first place (Phase 6 records a sale, not a charge),
  so a "return" here only means inventory + record-keeping, consistent
  with the app's existing scope.
- No user-facing page to browse `audit_logs` yet — this phase only
  writes to it. A viewer is Phase 10 territory.
- `saleNumberOrSku` search is a simple partial/exact match (implementation
  detail decided during the plan/build step, e.g. `ILIKE` for partial
  matching) — no fuzzy search or ranking.
- A non-UUID `/sales/[id]` still gives a raw 500 instead of a 404
  (pre-existing gap noted in Phase 6's design doc, unrelated to this
  phase, not addressed here).
