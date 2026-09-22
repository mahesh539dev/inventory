# Phase 3 — QR System — Design

Parent spec: [`2026-09-20-inventory-qr-sales-app-design.md`](2026-09-20-inventory-qr-sales-app-design.md)
(see "QR & Public API Security" and phase 3 of "Implementation Phases").

## Summary

Turn the `public_identifier` every product already receives at creation
(Phase 2, `lib/services/product.service.ts`) into a usable QR workflow:
generate a scannable PNG on demand, land scanners on a product page,
show the QR on the product detail page with download/print, and let
admins invalidate/reissue a code.

No new database tables. One schema-level change: none required —
`products.public_identifier` (unique, not null) already exists.

## What's already in place (Phase 1/2)

- `products.publicIdentifier`: `nanoid(10)`, assigned once at creation,
  unique-indexed (`lib/db/schema.ts`).
- Nothing currently reads or exposes this field outside the DB row.

## New Components

### 1. `lib/services/qr.service.ts`

```ts
generateQrPng(publicIdentifier: string): Promise<Buffer>
```

Builds the PNG for `${APP_URL}/p/{publicIdentifier}` using the
`qrcode` package (new dependency). Pure function, no persistence —
regenerated fresh on every call. `APP_URL` read from existing env
config (matches how the rest of the app resolves its own origin).

### 2. `app/api/products/[id]/qr/route.ts`

`GET`, gated by `requireUser()` (any authenticated staff — same
visibility as the product detail page itself, no extra role split).

- Looks up the product by internal `id` via existing repo function.
- 404 (via a JSON 404 response, consistent with existing route handler
  error conventions) if the product doesn't exist.
- Generates the PNG via `qr.service`.
- Response: `Content-Type: image/png`.
  - Default: `Content-Disposition: inline` — lets the product page embed
    it directly as `<img src="/api/products/[id]/qr">`.
  - `?download=1`: `Content-Disposition: attachment; filename="{sku}-qr.png"`.

One route serves both inline display and download; no separate print
route. Printing is handled client-side (browser print of the product
detail page / the image), consistent with "never persist QR images."

### 3. `app/p/[publicIdentifier]/page.tsx`

The scan-landing page. Lives outside the `(app)` route group — no
authenticated-app chrome (mobile nav, etc.), since an unauthenticated
customer may land here directly from a physical QR sticker.

- Reads the session server-side (`getSessionUser()`).
- **No session:** calls a new restricted repo query,
  `findPublicProductView(publicIdentifier)`, selecting only
  `productName`, `sellingPrice`, `productImage`. The restriction is
  enforced at the query layer (a `select()` that only names those
  columns), not by trimming a full object after the fact.
- **Session present:** calls the existing full product query
  (`findProductByPublicIdentifier`, new repo function analogous to
  `findProductById` but keyed on `publicIdentifier`), rendering the
  same field set staff already see on `/products/[id]`. No additional
  role split beyond what the app already applies there.
- Unknown/unmatched identifier → Next.js `notFound()` in both cases.

### 4. `app/api/public/products/[identifier]/route.ts`

`GET`, no auth required. Calls the same `findPublicProductView`
function used by the unauthenticated branch of the page above, so
there is exactly one code path defining "what the public can see," per
the parent spec. Returns JSON. Not consumed by any UI yet — kept as
the stable public contract the parent spec calls for.

### 5. Product detail page — `app/(app)/products/[id]/page.tsx`

Add a QR section:

- `<img src="/api/products/{id}/qr" alt="Product QR code">`.
- "Download PNG" link → `/api/products/{id}/qr?download=1`.
- Admin-only "Regenerate QR code" button (see below), with a
  confirmation step since it invalidates the existing physical
  sticker/printout.

### 6. Regenerate action

- `lib/actions/product.actions.ts`: `regenerateProductQr(id: string)`,
  gated by `requireAdmin()`.
- `lib/services/product.service.ts`: new service function assigns a
  fresh `nanoid(10)` to `publicIdentifier` via a repo update, returns
  the updated product.
- Effect: the old `/p/{oldIdentifier}` URL immediately 404s
  (`notFound()`) since no row matches it anymore — "invalidates the
  old QR/URL" from the parent spec is satisfied by the lookup simply
  failing, not by an explicit revocation list.
- Old printed/downloaded PNG images still *display* correctly as
  images (nothing deletes the bytes, since none were ever persisted)
  but the URL they encode stops resolving to a real product.

## Data Flow

```
Product created (Phase 2, existing)
        │
        ▼
publicIdentifier assigned (nanoid(10))
        │
        ├── Product detail page renders <img> → GET /api/products/[id]/qr
        │        (requireUser) → qr.service.generateQrPng → PNG bytes
        │
        └── Someone scans the printed/downloaded QR
                 │
                 ▼
        GET /p/[publicIdentifier]
                 │
        session? ── no  → findPublicProductView (restricted columns)
                 └─ yes → findProductByPublicIdentifier (full row)
                 │
        not found (either branch) → notFound()
```

## Error Handling

- Unknown `id` on the QR image route → 404 JSON response.
- Unknown `publicIdentifier` on the public page or public API →
  `notFound()` / 404 JSON respectively.
- Regenerate on a non-existent product → reuses existing
  `ProductNotFoundError` convention from `product.service.ts`.
- No new error types needed beyond what Phase 2 established.

## Testing

- **Unit:** `qr.service.generateQrPng` returns a non-empty PNG buffer
  (`image/png` magic bytes) embedding the expected URL — decode via a
  lightweight QR-reading utility if one is cheap to add as a dev
  dependency; otherwise assert buffer signature/size and rely on
  integration coverage for correctness of the encoded URL indirectly
  (by asserting the generated route responds and the same identifier
  round-trips through the public page).
- **Integration:**
  - `findPublicProductView` returns only the three allowed fields
    (asserted by key set, not just by value).
  - `findProductByPublicIdentifier` returns the full row for an
    authenticated caller.
  - `/api/products/[id]/qr`: 401/redirect for unauthenticated, 200
    `image/png` for authenticated, correct `Content-Disposition` with
    and without `?download=1`.
  - `/p/[publicIdentifier]`: unauthenticated shows restricted content
    only (assert full fields like cost price are absent from the
    rendered output); authenticated shows full content; unknown
    identifier → 404.
  - Regenerate action: identifier changes in the DB, old identifier no
    longer resolves via either the page or the public API route,
    non-admin caller is rejected.

## Out of Scope (per parent spec)

Persisting QR images to storage, non-QR barcodes, multiple simultaneous
codes per product, low-stock/notification concerns (later phases).

## New Dependency

`qrcode` (npm) — server-side PNG generation, no client-side QR
rendering needed. `@types/qrcode` as a dev dependency if not bundled.
