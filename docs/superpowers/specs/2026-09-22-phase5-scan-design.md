# Phase 5 — Scan — Design

Parent spec: [`2026-09-20-inventory-qr-sales-app-design.md`](2026-09-20-inventory-qr-sales-app-design.md)
(see "Implementation Phases" #5, and source requirements
[`inventory_qr_sales_app_claude_prompt.md`](../../../inventory_qr_sales_app_claude_prompt.md)
sections 14, 33, 56-58).

## Summary

An authenticated, camera-based QR scanner that lets staff scan a
product's QR sticker and land on that product's full detail page,
plus a manual-SKU fallback for when the camera is unavailable, denied,
or the code won't scan. The scanner itself is built as a reusable
component (not page-specific) because Phase 6 (Sell) needs the same
camera-decode capability inside its own flow ("Open Sell → Scan QR →
quantity → price").

Explicitly **not** in scope: the sale flow itself (Phase 6), any
change to the existing public `/p/[publicIdentifier]` scan-landing page
or its public API (Phase 3, unchanged), and barcode formats other than
QR (not requested anywhere in the source spec).

## What's already in place (Phases 1-4)

- `/p/[publicIdentifier]` (`app/p/[publicIdentifier]/page.tsx`) and
  `/api/public/products/[identifier]` — Phase 3's session-aware public
  scan-landing page. A phone's *native* camera app can already open a
  product's QR directly via this URL; today's gap is only that there is
  no *in-app* scanner that keeps staff inside the app shell and feeds
  into other in-app flows (Sell, in Phase 6).
- `qrcode` npm package — used only for *generating* the PNG a QR
  encodes (`lib/services/qr.service.ts`). It has no decoding
  capability; this phase adds a separate, camera-decoding library.
- `findProductByPublicIdentifier(identifier)` and
  `findProductBySku(sku)` in `lib/repositories/product.repo.ts` —
  existing internal (non-public-safe) lookups this phase reuses.
- `requireUser()` / `requireAdmin()` in `lib/auth/guards.ts` — this
  phase's page and action use `requireUser()` (any authenticated staff
  can scan/look up; scanning is not admin-gated, matching the spec's
  "Authenticated QR Scan" section which just says "staff logs in").
- Both `MobileNav` and `DesktopSidebar` already link to `/scan` (added
  ahead of this phase, currently 404s) — no nav changes needed.

## Library choice

**`@zxing/browser`** (plus its `@zxing/library` peer) for camera QR
decoding. Actively maintained, wraps `getUserMedia` internally, broad
support including iOS Safari 15+, no native/WASM build step. Chosen
over `html5-qrcode` (less control, less active maintenance) and
`qr-scanner`/nimiq (smaller community) per the source spec's "use a
well-maintained browser-compatible QR scanning library; do not
reinvent decoding."

## New Components

### 1. `components/scan/QrScanner.tsx`

Reusable client component (`"use client"`). Props:

```ts
type QrScannerProps = {
  onDecode: (text: string) => void;
  paused?: boolean; // caller can pause the feed after a decode while it processes/navigates
};
```

- Wraps `BrowserQRCodeReader` from `@zxing/browser`, targeting a
  `<video>` element it renders. Starts the camera on mount, stops it
  (`reader.stopContinuousDecode()` + released media stream) on
  unmount — no leaked camera access if the user navigates away or a
  parent unmounts this component (important once Phase 6 embeds it
  inside a larger Sell page).
- Tracks and exposes permission/device state internally, rendering the
  matching UI itself (this is a self-contained widget, not just a raw
  video feed):
  - `requesting` — brief loading state while `getUserMedia` resolves.
  - `granted` — live viewfinder.
  - `denied` (caught `NotAllowedError`) — spec's exact copy: "Camera
    access is required to scan QR codes. Please enable camera access
    in your browser settings."
  - `unavailable` (caught `NotFoundError`, or `mediaDevices` missing
    entirely, e.g. non-HTTPS/unsupported browser) — "No camera
    detected on this device."
  - In every non-`granted` state, the component renders nothing extra
    beyond the message — it does **not** render the manual-SKU
    fallback itself; that lives on the page, always visible, so it
    doesn't depend on this component's internal state machine.
- **Repeat-decode guard:** ZXing's continuous scan loop fires
  `onDecode`-equivalent repeatedly for the same code while it stays in
  frame. The component buffers the last decoded text and ignores
  identical repeats until `paused` toggles back to `false` (the
  caller's job is to set `paused=true` immediately on receiving a
  decode, while it validates/navigates, and reset it if that decode
  turns out to be invalid).
- Deliberately has **no knowledge** of products, identifiers, or
  routing — it only decodes text and reports it. Keeps it genuinely
  reusable for Phase 6.

### 2. `lib/scan/parse-qr-payload.ts`

Pure function, no I/O — easy to unit test in isolation from the
camera:

```ts
function parseQrPayload(text: string): { publicIdentifier: string } | null
```

Accepts either a full scanned URL matching this app's own
`/p/[publicIdentifier]` path shape (same origin or not — the sticker
could be scanned via a link shared off-device, so origin is not
checked, only the path pattern) or a bare identifier string (in case a
QR is ever generated without the full URL). Returns `null` for
anything else (a wifi-config QR, a random URL, plain garbage) rather
than throwing — the page decides how to surface that as a
non-fatal inline error.

### 3. `lib/actions/scan.actions.ts`

`resolveProductForScan(input: { publicIdentifier?: string; sku?: string }): Promise<{ id: string } | null>`

- `requireUser()` first — any authenticated staff member, not
  admin-only (matches the spec's "Authenticated QR Scan" section).
- Exactly one of `publicIdentifier` or `sku` must be provided (the two
  entry points — camera decode vs. manual entry — never both); the
  other branch is a defensive `throw` on a programmer error, not a
  user-facing case.
- Looks up via the existing `findProductByPublicIdentifier` or
  `findProductBySku` repo functions — no new repo code needed, no
  archived-status filtering (archived products resolve normally, per
  the design decision below).
- Returns `{ id: product.id }` on a match, `null` otherwise. Deliberately
  returns only the internal `id` — never the full product row through
  this path — since this action's only job is "where do I navigate,"
  and the destination page (`/products/[id]`, existing, authenticated)
  is what actually authorizes and renders full product data.

### 4. `/scan` page — `app/(app)/scan/page.tsx`

Client component (needs `useState`/`useRouter` to react to decodes).
`requireUser()`-equivalent enforcement happens naturally: this route
sits under the `(app)` route group's existing authenticated layout.

Layout:
- `<QrScanner onDecode={...} paused={...} />` at the top.
- Always-visible manual fallback below it: a text input (SKU) + a
  "Find Product" submit button — visible regardless of camera
  permission state, per the source spec listing it as a standing
  fallback ("Enter SKU Manually"), not solely a denied-camera
  affordance.
- A single shared inline error region below both, used for: unrecognized
  QR payload, product-not-found (from either entry point), and any
  `resolveProductForScan` failure. Camera keeps running through all of
  these — the user can immediately retry scanning or typing without any
  reset step.

Flow on decode:
1. `parseQrPayload(text)` → `null` → inline error ("Not a recognized
   product QR code"), camera keeps running, `paused` stays `false`.
2. Parsed successfully → set `paused = true`, call
   `resolveProductForScan({ publicIdentifier })`.
3. `null` result → inline error ("Product not found — it may have been
   removed or its QR code regenerated."), `paused = false` (resume
   scanning).
4. `{ id }` → `router.push('/products/' + id)`.

Flow on manual submit: same steps 2-4 using
`resolveProductForScan({ sku })`, with client-side validation only
requiring a non-empty trimmed string (SKU format is already validated
at product-creation time; scan lookup doesn't need to duplicate that
format check, only "was something typed").

Archived products resolve and navigate exactly like active ones — the
existing product detail page already renders an ARCHIVED badge
(Phase 2/4), and this matches how archived products are already
reachable via search/product list today. No new restriction is
introduced here.

## Data Flow

```
Staff opens /scan
        │
        ▼
<QrScanner> requests camera
        │
   ┌────┴─────┐
   │          │
 granted   denied/unavailable
   │          │
   │          └─→ message shown; manual-SKU input still available
   │
   ▼
Camera decodes text → parseQrPayload(text)
        │
   ┌────┴─────┐
   │          │
 parsed     null → inline error, camera keeps running
   │
   ▼
resolveProductForScan({ publicIdentifier }) [or { sku } from manual entry]
        │
   ┌────┴─────┐
   │          │
 { id }     null → inline error, resume scanning / re-enable form
   │
   ▼
router.push(`/products/${id}`)
```

## Error Handling

- Camera permission denied → `<QrScanner>`'s own `denied` state message;
  manual-SKU fallback remains usable (never blocked by camera state).
- No camera device / unsupported browser → `<QrScanner>`'s own
  `unavailable` state message; same fallback availability.
- Decoded text doesn't match the product-QR shape → page-level inline
  error, camera keeps running (per explicit design decision — favors a
  fast rescan loop over forcing an explicit retry tap).
- Decoded/typed identifier well-formed but no matching product (deleted,
  or identifier regenerated per Phase 3's admin regenerate action making
  old stickers stale) → page-level inline error, stays on `/scan`
  either resuming the camera or re-enabling the manual form depending on
  which path produced it.
- Archived product → no error; navigates normally (explicit design
  decision, avoids introducing a restriction the spec never asked for).
- Unauthenticated access to `/scan` or a direct call to
  `resolveProductForScan` → handled by the existing `(app)` route
  group's auth enforcement / `requireUser()`'s redirect-to-login,
  nothing new to build.

## Testing

- **Unit:**
  - `parseQrPayload` — accepts a full `/p/[identifier]` URL (with and
    without a scheme/host prefix), accepts a bare identifier, rejects
    an unrelated URL, rejects empty/garbage text.
  - `resolveProductForScan` — resolves by `publicIdentifier`, resolves
    by `sku`, returns `null` when neither matches, throws on
    unauthenticated access (mocking `requireUser`), throws if called
    with neither/both inputs.
- **Component:** `<QrScanner>` permission-state rendering — mock
  `navigator.mediaDevices.getUserMedia` to resolve (verify `<video>`
  path attempted), reject with `NotAllowedError` (verify denied
  message), and reject with `NotFoundError` (verify unavailable
  message). This satisfies the source spec's explicit "test camera
  permissions" requirement at the automatable level.
- **Manual checklist (not automatable — no real camera hardware in
  CI):** scan a real product QR sticker successfully on Android
  Chrome, iPhone Safari, and desktop Chrome (webcam, if available);
  verify denied-permission and no-camera-device UI on at least one
  mobile browser; verify manual-SKU fallback end-to-end on a device
  with camera access deliberately declined. Recorded as a checklist in
  the implementation plan, verified by the user before merge — not a
  task any subagent can complete itself.

## Out of Scope for This Phase

The Sell flow and its own use of `<QrScanner>` (Phase 6); any change to
the public `/p/[publicIdentifier]` page or public API (Phase 3,
untouched); barcode/format support beyond QR; offline/PWA scanning;
rate-limiting `resolveProductForScan` (general auth-route rate limiting
is Phase 10 per the parent spec, same as Phase 3's deferral); archived
product visibility changes on the public scan surface (already tracked
as a Phase 10 follow-up from Phase 3, unrelated to this phase's
authenticated flow).
