# Phase 3 — QR System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn each product's existing `publicIdentifier` into a working QR workflow: an on-demand PNG image, a public scan-landing page (restricted view for anonymous visitors, full view for authenticated staff), a stable public JSON API, and an admin-only regenerate action — all with no persisted QR image files.

**Architecture:** A new `lib/services/qr.service.ts` wraps the `qrcode` npm package behind one pure function. Two new repository functions on the existing `product.repo.ts` add public-identifier lookups (one restricted-column, one full-row). One new route handler streams the PNG (`/api/products/[id]/qr`), one new route handler serves the restricted JSON contract (`/api/public/products/[identifier]`), and one new page (`/p/[publicIdentifier]`) is the human-facing scan landing spot, session-aware. The existing product detail page and product actions file each get additions (QR display/download UI; a `regenerateProductQr` action), following the same repo → service → action → page layering Phase 2 established.

**Tech Stack:** Next.js Route Handlers + Server Components (existing App Router setup), Drizzle ORM (existing `products` table, no migration), `qrcode` (new dependency) for server-side PNG generation, `nanoid` (already installed) for regenerating identifiers, Vitest for tests.

**Spec:** [docs/superpowers/specs/2026-09-21-phase3-qr-system-design.md](../specs/2026-09-21-phase3-qr-system-design.md) (parent: [docs/superpowers/specs/2026-09-20-inventory-qr-sales-app-design.md](../specs/2026-09-20-inventory-qr-sales-app-design.md))

## Global Constraints

- `products.publicIdentifier` already exists (unique, not null, `nanoid(10)` assigned at creation in `lib/services/product.service.ts`) — no schema migration in this phase.
- QR PNGs are generated fresh on every request and never persisted to disk/storage (parent spec, "QR & Public API Security").
- The restricted public view exposes only `productName`, `sellingPrice`, `productImage` — enforced by selecting only those columns at the query layer, never by filtering a full object after the fact (parent spec).
- There is exactly one code path defining "what the public can see": both the unauthenticated branch of `/p/[publicIdentifier]` and `GET /api/public/products/[identifier]` call the same repository function (this plan's spec, "New Components" #3/#4).
- Authenticated visitors to `/p/[publicIdentifier]` see the same full field set staff already see on `/products/[id]` — no new role split beyond what exists today (this plan's spec, confirmed with user).
- The QR image route (`/api/products/[id]/qr`) requires only `requireUser()` (any authenticated staff), not `requireAdmin()` (this plan's spec).
- Regenerating a QR code is admin-only (`requireAdmin()`) and works by assigning a new `nanoid(10)` to `publicIdentifier` — invalidation happens because the old identifier no longer matches any row, not via an explicit revocation list (this plan's spec).
- `APP_URL` env var (already declared in `.env.example`) is the base URL QR codes encode — read it via `process.env.APP_URL`, matching the existing `DATABASE_URL` access pattern in `lib/db/client.ts`.
- Package manager is npm. TypeScript strict mode. Follow existing conventions: `Button render={<Link>...}</Link>}` (base-ui, not `asChild`), `ProductNotFoundError` from `lib/services/product.service.ts` for not-found handling, repositories are the only files touching Drizzle table objects directly.
- Never hard-delete or persist QR files; never trust client input for authorization — all guards happen server-side via `requireUser()`/`requireAdmin()`.

---

### Task 1: Install `qrcode` dependency

**Files:**
- Modify: `package.json` (add `qrcode`, `@types/qrcode`)

**Interfaces:**
- Produces: the `qrcode` package's `toBuffer` function available for import in Task 2.

- [ ] **Step 1: Install qrcode and its types**

```bash
npm install qrcode
npm install --save-dev @types/qrcode
```

- [ ] **Step 2: Verify the install**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors (nothing imports `qrcode` yet, so this just confirms the install didn't break anything).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Add qrcode dependency for Phase 3 QR generation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: QR generation service

**Files:**
- Create: `lib/services/qr.service.ts`
- Test: `tests/unit/qr.service.test.ts`

**Interfaces:**
- Consumes: `toBuffer` from `"qrcode"`.
- Produces:
  - `buildPublicProductUrl(publicIdentifier: string): string` — returns `${process.env.APP_URL}/p/${publicIdentifier}`, throwing an `Error("APP_URL environment variable is not set")` if `APP_URL` is unset (fail loud rather than encode a broken URL into a printed QR sticker).
  - `generateQrPng(publicIdentifier: string): Promise<Buffer>` — builds the target URL via `buildPublicProductUrl` and returns a PNG buffer encoding it.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/qr.service.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildPublicProductUrl, generateQrPng } from "@/lib/services/qr.service";

const ORIGINAL_APP_URL = process.env.APP_URL;

describe("buildPublicProductUrl", () => {
  beforeEach(() => {
    process.env.APP_URL = "https://inventory.example.com";
  });

  afterEach(() => {
    process.env.APP_URL = ORIGINAL_APP_URL;
  });

  it("builds the public product URL from APP_URL and the identifier", () => {
    expect(buildPublicProductUrl("abc123")).toBe("https://inventory.example.com/p/abc123");
  });

  it("throws when APP_URL is not set", () => {
    delete process.env.APP_URL;
    expect(() => buildPublicProductUrl("abc123")).toThrow("APP_URL environment variable is not set");
  });
});

describe("generateQrPng", () => {
  beforeEach(() => {
    process.env.APP_URL = "https://inventory.example.com";
  });

  afterEach(() => {
    process.env.APP_URL = ORIGINAL_APP_URL;
  });

  it("returns a non-empty PNG buffer", async () => {
    const buffer = await generateQrPng("abc123");
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    // PNG magic bytes: 0x89 'P' 'N' 'G' '\r' '\n' 0x1A '\n'
    expect(buffer.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it("produces different bytes for different identifiers", async () => {
    const bufferA = await generateQrPng("identifier-a");
    const bufferB = await generateQrPng("identifier-b");
    expect(bufferA.equals(bufferB)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/qr.service.test.ts`
Expected: FAIL with "Cannot find module '@/lib/services/qr.service'"

- [ ] **Step 3: Write the implementation**

Create `lib/services/qr.service.ts`:

```typescript
import { toBuffer } from "qrcode";

export function buildPublicProductUrl(publicIdentifier: string): string {
  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    throw new Error("APP_URL environment variable is not set");
  }
  return `${appUrl}/p/${publicIdentifier}`;
}

export async function generateQrPng(publicIdentifier: string): Promise<Buffer> {
  const targetUrl = buildPublicProductUrl(publicIdentifier);
  return toBuffer(targetUrl, { type: "png" });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/qr.service.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add QR PNG generation service

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Public-identifier repository queries

**Files:**
- Modify: `lib/repositories/product.repo.ts`
- Test: `tests/integration/product.repo.qr.test.ts`

**Interfaces:**
- Consumes: `db` from `@/lib/db/client`; `products` from `@/lib/db/schema`; `eq` from `drizzle-orm` (already imported in this file).
- Produces (new exports added to the existing file):
  - `type PublicProductView = { productName: string; sellingPrice: string | null; productImage: string | null }`
  - `findPublicProductView(publicIdentifier: string): Promise<PublicProductView | undefined>` — selects only `productName`, `sellingPrice`, `productImage` (via Drizzle's `select({...})` column-picking form, not a full `select()` followed by object-trimming).
  - `findProductByPublicIdentifier(publicIdentifier: string): Promise<ProductRow | undefined>` — full row, same shape as `findProductById`.
  - `regeneratePublicIdentifier(id: string, newIdentifier: string): Promise<ProductRow>` — updates just `publicIdentifier` and `updatedAt`, returns the updated row.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/product.repo.qr.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db/client";
import { products } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  insertProduct,
  findPublicProductView,
  findProductByPublicIdentifier,
  regeneratePublicIdentifier,
} from "@/lib/repositories/product.repo";

const TEST_SKU = "TEST-QR-REPO-001";
const ORIGINAL_IDENTIFIER = "test-qr-repo-pubid-001";

describe("product.repo QR queries", () => {
  let productId: string;

  beforeAll(async () => {
    const inserted = await insertProduct({
      publicIdentifier: ORIGINAL_IDENTIFIER,
      sku: TEST_SKU,
      productName: "QR Repo Test Product",
      productImage: "https://example.com/photo.jpg",
      originalPrice: "100.00",
      costPrice: "50.00",
      sellingPrice: "89.99",
      currentQuantity: 3,
    });
    productId = inserted.id;
  });

  afterAll(async () => {
    await db.delete(products).where(eq(products.sku, TEST_SKU));
  });

  it("findPublicProductView returns only the restricted fields", async () => {
    const view = await findPublicProductView(ORIGINAL_IDENTIFIER);
    expect(view).toEqual({
      productName: "QR Repo Test Product",
      sellingPrice: "89.99",
      productImage: "https://example.com/photo.jpg",
    });
    // Explicitly confirm no other keys leaked through (e.g. costPrice).
    expect(Object.keys(view!).sort()).toEqual(["productImage", "productName", "sellingPrice"]);
  });

  it("findPublicProductView returns undefined for an unknown identifier", async () => {
    const view = await findPublicProductView("does-not-exist");
    expect(view).toBeUndefined();
  });

  it("findProductByPublicIdentifier returns the full row", async () => {
    const row = await findProductByPublicIdentifier(ORIGINAL_IDENTIFIER);
    expect(row?.id).toBe(productId);
    expect(row?.costPrice).toBe("50.00");
    expect(row?.currentQuantity).toBe(3);
  });

  it("regeneratePublicIdentifier changes the identifier and old one stops resolving", async () => {
    const updated = await regeneratePublicIdentifier(productId, "test-qr-repo-pubid-002");
    expect(updated.publicIdentifier).toBe("test-qr-repo-pubid-002");

    const oldLookup = await findProductByPublicIdentifier(ORIGINAL_IDENTIFIER);
    expect(oldLookup).toBeUndefined();

    const newLookup = await findProductByPublicIdentifier("test-qr-repo-pubid-002");
    expect(newLookup?.id).toBe(productId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/integration/product.repo.qr.test.ts`
Expected: FAIL with "findPublicProductView is not a function" (or similar — the exports don't exist yet).

- [ ] **Step 3: Add the new functions to product.repo.ts**

Modify `lib/repositories/product.repo.ts` — add these exports after the existing `findProductById` function (keep all existing code unchanged):

```typescript
export type PublicProductView = {
  productName: string;
  sellingPrice: string | null;
  productImage: string | null;
};

export async function findPublicProductView(
  publicIdentifier: string
): Promise<PublicProductView | undefined> {
  const [row] = await db
    .select({
      productName: products.productName,
      sellingPrice: products.sellingPrice,
      productImage: products.productImage,
    })
    .from(products)
    .where(eq(products.publicIdentifier, publicIdentifier))
    .limit(1);
  return row;
}

export async function findProductByPublicIdentifier(
  publicIdentifier: string
): Promise<ProductRow | undefined> {
  const [row] = await db
    .select()
    .from(products)
    .where(eq(products.publicIdentifier, publicIdentifier))
    .limit(1);
  return row;
}

export async function regeneratePublicIdentifier(
  id: string,
  newIdentifier: string
): Promise<ProductRow> {
  const [row] = await db
    .update(products)
    .set({ publicIdentifier: newIdentifier, updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning();
  return row;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/integration/product.repo.qr.test.ts`
Expected: all 4 tests PASS against the real dev database.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add public-identifier repository queries for QR system

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Regenerate QR service function and server action

**Files:**
- Modify: `lib/services/product.service.ts`
- Modify: `lib/actions/product.actions.ts`
- Test: `tests/unit/product.service.qr.test.ts`
- Test: `tests/unit/product.actions.qr.test.ts`

**Interfaces:**
- Consumes (service): `regeneratePublicIdentifier`, `findProductById` from `@/lib/repositories/product.repo`; `nanoid` from `"nanoid"`; `ProductNotFoundError` (already defined in this file).
- Produces (service): `regenerateProductQr(id: string): Promise<ProductRow>` — throws `ProductNotFoundError` if the product doesn't exist, otherwise assigns `nanoid(10)` and returns the updated row.
- Consumes (actions): `regenerateProductQr` from `@/lib/services/product.service`; `requireAdmin` from `@/lib/auth/guards` (already imported); `ProductNotFoundError` (already imported).
- Produces (actions): `regenerateProductQrAction(id: string): Promise<void>` — admin-gated, calls the service, revalidates `/products/[id]`, redirects back to `/products/[id]`.

- [ ] **Step 1: Write the failing service test**

Create `tests/unit/product.service.qr.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/repositories/product.repo", () => ({
  findProductById: vi.fn(),
  regeneratePublicIdentifier: vi.fn(),
}));

import { findProductById, regeneratePublicIdentifier } from "@/lib/repositories/product.repo";
import { regenerateProductQr, ProductNotFoundError } from "@/lib/services/product.service";

describe("regenerateProductQr", () => {
  beforeEach(() => {
    vi.mocked(findProductById).mockReset();
    vi.mocked(regeneratePublicIdentifier).mockReset();
  });

  it("throws ProductNotFoundError when the product does not exist", async () => {
    vi.mocked(findProductById).mockResolvedValue(undefined);

    await expect(regenerateProductQr("missing-id")).rejects.toThrow(ProductNotFoundError);
    expect(regeneratePublicIdentifier).not.toHaveBeenCalled();
  });

  it("assigns a new 10-character identifier when the product exists", async () => {
    vi.mocked(findProductById).mockResolvedValue({ id: "prod-1", publicIdentifier: "old-id" } as never);
    vi.mocked(regeneratePublicIdentifier).mockImplementation(async (id, newIdentifier) => ({
      id,
      publicIdentifier: newIdentifier,
    } as never));

    const result = await regenerateProductQr("prod-1");

    expect(regeneratePublicIdentifier).toHaveBeenCalledTimes(1);
    const [calledId, calledIdentifier] = vi.mocked(regeneratePublicIdentifier).mock.calls[0];
    expect(calledId).toBe("prod-1");
    expect(calledIdentifier).not.toBe("old-id");
    expect(typeof calledIdentifier).toBe("string");
    expect(calledIdentifier.length).toBeGreaterThanOrEqual(10);
    expect(result.publicIdentifier).toBe(calledIdentifier);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/product.service.qr.test.ts`
Expected: FAIL with "regenerateProductQr is not a function"

- [ ] **Step 3: Add regenerateProductQr to product.service.ts**

Modify `lib/services/product.service.ts` — change the repository import at the top of the file to add `regeneratePublicIdentifier`:

```typescript
import {
  findProductBySku,
  insertProduct as repoInsertProduct,
  updateProduct as repoUpdateProduct,
  archiveProduct as repoArchiveProduct,
  findProductById,
  regeneratePublicIdentifier,
  type ProductRow,
} from "@/lib/repositories/product.repo";
```

Then add this function after the existing `archiveProduct` function:

```typescript
export async function regenerateProductQr(id: string): Promise<ProductRow> {
  const existing = await findProductById(id);
  if (!existing) {
    throw new ProductNotFoundError(id);
  }
  return regeneratePublicIdentifier(id, nanoid(10));
}
```

- [ ] **Step 4: Run the service test to verify it passes**

Run: `npm test -- tests/unit/product.service.qr.test.ts`
Expected: both tests PASS.

- [ ] **Step 5: Write the failing action test**

Create `tests/unit/product.actions.qr.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/guards", () => ({
  requireAdmin: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/lib/services/product.service", () => ({
  regenerateProductQr: vi.fn(),
  ProductNotFoundError: class ProductNotFoundError extends Error {},
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { requireAdmin } from "@/lib/auth/guards";
import { regenerateProductQr } from "@/lib/services/product.service";
import { redirect } from "next/navigation";
import { regenerateProductQrAction } from "@/lib/actions/product.actions";

describe("regenerateProductQrAction", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset();
    vi.mocked(regenerateProductQr).mockReset();
    vi.mocked(redirect).mockReset().mockImplementation(() => {
      throw new Error("REDIRECT");
    });
  });

  it("requires admin before regenerating", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("Forbidden: admin role required"));

    await expect(regenerateProductQrAction("prod-1")).rejects.toThrow("Forbidden");
    expect(regenerateProductQr).not.toHaveBeenCalled();
  });

  it("regenerates and redirects back to the product page", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: "admin-1", role: "ADMIN", email: "a@example.com" });
    vi.mocked(regenerateProductQr).mockResolvedValue({ id: "prod-1" } as never);

    await expect(regenerateProductQrAction("prod-1")).rejects.toThrow("REDIRECT");

    expect(regenerateProductQr).toHaveBeenCalledWith("prod-1");
    expect(redirect).toHaveBeenCalledWith("/products/prod-1");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- tests/unit/product.actions.qr.test.ts`
Expected: FAIL with "regenerateProductQrAction is not a function"

- [ ] **Step 7: Add regenerateProductQrAction to product.actions.ts**

Modify `lib/actions/product.actions.ts` — change the service import at the top to add `regenerateProductQr`:

```typescript
import {
  createProduct,
  updateProduct as serviceUpdateProduct,
  archiveProduct as serviceArchiveProduct,
  regenerateProductQr,
  DuplicateSkuError,
  ProductNotFoundError,
} from "@/lib/services/product.service";
```

Then add this function at the end of the file:

```typescript
export async function regenerateProductQrAction(id: string): Promise<void> {
  await requireAdmin();
  await regenerateProductQr(id);
  revalidatePath(`/products/${id}`);
  redirect(`/products/${id}`);
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- tests/unit/product.actions.qr.test.ts`
Expected: both tests PASS.

- [ ] **Step 9: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: all tests PASS, including the pre-existing Phase 2 tests.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Add QR regeneration service function and admin action

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: QR PNG route handler

**Files:**
- Create: `app/api/products/[id]/qr/route.ts`
- Test: `tests/integration/qr.route.test.ts`

**Interfaces:**
- Consumes: `requireUser` from `@/lib/auth/guards`; `findProductById` from `@/lib/repositories/product.repo`; `generateQrPng` from `@/lib/services/qr.service`; `NextRequest` from `next/server`.
- Produces: `GET` handler at `/api/products/[id]/qr` — returns `image/png` bytes; supports `?download=1` query param to switch `Content-Disposition` to `attachment`.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/qr.route.test.ts`. This test drives the route handler's exported `GET` function directly (the standard way to integration-test Next.js Route Handlers without spinning up a server), mocking only the auth guard so it exercises the real repository and real QR generation against the dev database:

```typescript
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/lib/db/client";
import { products } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { insertProduct } from "@/lib/repositories/product.repo";

vi.mock("@/lib/auth/guards", () => ({
  requireUser: vi.fn(),
}));

import { requireUser } from "@/lib/auth/guards";
import { GET } from "@/app/api/products/[id]/qr/route";

const TEST_SKU = "TEST-QR-ROUTE-001";
const ORIGINAL_APP_URL = process.env.APP_URL;

describe("GET /api/products/[id]/qr", () => {
  let productId: string;

  beforeAll(async () => {
    process.env.APP_URL = "https://inventory.example.com";
    const inserted = await insertProduct({
      publicIdentifier: "test-qr-route-pubid-001",
      sku: TEST_SKU,
      productName: "QR Route Test Product",
      originalPrice: "100.00",
      costPrice: "50.00",
      currentQuantity: 1,
    });
    productId = inserted.id;
  });

  afterAll(async () => {
    await db.delete(products).where(eq(products.sku, TEST_SKU));
    process.env.APP_URL = ORIGINAL_APP_URL;
  });

  beforeEach(() => {
    vi.mocked(requireUser).mockReset();
  });

  it("propagates the auth guard's rejection when unauthenticated", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("redirect to login"));

    await expect(
      GET(new Request(`http://localhost/api/products/${productId}/qr`) as never, {
        params: Promise.resolve({ id: productId }),
      })
    ).rejects.toThrow();
  });

  it("returns a PNG image for an authenticated user", async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: "user-1", role: "USER", email: "u@example.com" });

    const response = await GET(
      new Request(`http://localhost/api/products/${productId}/qr`) as never,
      { params: Promise.resolve({ id: productId }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toBe("inline");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("sets an attachment disposition with the SKU-based filename when download=1", async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: "user-1", role: "USER", email: "u@example.com" });

    const response = await GET(
      new Request(`http://localhost/api/products/${productId}/qr?download=1`) as never,
      { params: Promise.resolve({ id: productId }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="${TEST_SKU}-qr.png"`
    );
  });

  it("returns 404 for an unknown product id", async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: "user-1", role: "USER", email: "u@example.com" });

    const response = await GET(
      new Request("http://localhost/api/products/00000000-0000-0000-0000-000000000000/qr") as never,
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) }
    );

    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/integration/qr.route.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/products/[id]/qr/route'"

- [ ] **Step 3: Write the route handler**

Create `app/api/products/[id]/qr/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import { findProductById } from "@/lib/repositories/product.repo";
import { generateQrPng } from "@/lib/services/qr.service";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireUser();

  const { id } = await params;
  const product = await findProductById(id);
  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  const png = await generateQrPng(product.publicIdentifier);
  const isDownload = request.nextUrl.searchParams.get("download") === "1";

  return new NextResponse(new Uint8Array(png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": isDownload
        ? `attachment; filename="${product.sku}-qr.png"`
        : "inline",
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/integration/qr.route.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add QR PNG route handler with inline and download modes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Public product API route

**Files:**
- Create: `app/api/public/products/[identifier]/route.ts`
- Test: `tests/integration/public-products.route.test.ts`

**Interfaces:**
- Consumes: `findPublicProductView` from `@/lib/repositories/product.repo`.
- Produces: `GET` handler at `/api/public/products/[identifier]` — no auth required, returns the restricted JSON view or a 404.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/public-products.route.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db/client";
import { products } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { insertProduct } from "@/lib/repositories/product.repo";
import { GET } from "@/app/api/public/products/[identifier]/route";

const TEST_SKU = "TEST-PUBLIC-API-001";
const IDENTIFIER = "test-public-api-pubid-001";

describe("GET /api/public/products/[identifier]", () => {
  beforeAll(async () => {
    await insertProduct({
      publicIdentifier: IDENTIFIER,
      sku: TEST_SKU,
      productName: "Public API Test Product",
      productImage: "https://example.com/photo.jpg",
      originalPrice: "100.00",
      costPrice: "50.00",
      sellingPrice: "79.99",
      currentQuantity: 2,
    });
  });

  afterAll(async () => {
    await db.delete(products).where(eq(products.sku, TEST_SKU));
  });

  it("returns only the restricted fields with no auth required", async () => {
    const response = await GET(new Request(`http://localhost/api/public/products/${IDENTIFIER}`) as never, {
      params: Promise.resolve({ identifier: IDENTIFIER }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      productName: "Public API Test Product",
      sellingPrice: "79.99",
      productImage: "https://example.com/photo.jpg",
    });
    expect(Object.keys(body).sort()).toEqual(["productImage", "productName", "sellingPrice"]);
  });

  it("returns 404 for an unknown identifier", async () => {
    const response = await GET(new Request("http://localhost/api/public/products/nonexistent") as never, {
      params: Promise.resolve({ identifier: "nonexistent" }),
    });

    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/integration/public-products.route.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/public/products/[identifier]/route'"

- [ ] **Step 3: Write the route handler**

Create `app/api/public/products/[identifier]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { findPublicProductView } from "@/lib/repositories/product.repo";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ identifier: string }> }
) {
  const { identifier } = await params;
  const view = await findPublicProductView(identifier);

  if (!view) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  return NextResponse.json(view);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/integration/public-products.route.test.ts`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add public product JSON API route

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Public scan-landing page

**Files:**
- Create: `app/p/[publicIdentifier]/page.tsx`

**Interfaces:**
- Consumes: `getSessionUser` from `@/lib/auth/session`; `findPublicProductView`, `findProductByPublicIdentifier` from `@/lib/repositories/product.repo`; `notFound` from `next/navigation`; `Badge` from `@/components/ui/badge`.
- Produces: the `/p/[publicIdentifier]` route, rendered outside the `(app)` layout group (no authenticated-app nav chrome — this page is reachable by anonymous scanners).

- [ ] **Step 1: Write the page**

Create `app/p/[publicIdentifier]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import {
  findPublicProductView,
  findProductByPublicIdentifier,
} from "@/lib/repositories/product.repo";
import { Badge } from "@/components/ui/badge";

export default async function PublicProductPage({
  params,
}: {
  params: Promise<{ publicIdentifier: string }>;
}) {
  const { publicIdentifier } = await params;
  const user = await getSessionUser();

  if (!user) {
    const view = await findPublicProductView(publicIdentifier);
    if (!view) notFound();

    return (
      <div className="mx-auto max-w-sm p-6 space-y-4">
        {view.productImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={view.productImage}
            alt={view.productName}
            className="w-full rounded-md border object-cover"
          />
        )}
        <h1 className="text-xl font-semibold">{view.productName}</h1>
        <p className="text-lg">
          {view.sellingPrice !== null ? `$${view.sellingPrice}` : "Price not set"}
        </p>
      </div>
    );
  }

  const product = await findProductByPublicIdentifier(publicIdentifier);
  if (!product) notFound();

  return (
    <div className="mx-auto max-w-sm p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{product.productName}</h1>
        <Badge variant={product.status === "ACTIVE" ? "default" : "secondary"}>{product.status}</Badge>
      </div>
      <p className="text-muted-foreground">SKU: {product.sku}</p>

      <dl className="grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Available Quantity</dt>
        <dd>{product.currentQuantity}</dd>

        <dt className="text-muted-foreground">Original Price</dt>
        <dd>{product.originalPrice}</dd>

        <dt className="text-muted-foreground">Cost Price</dt>
        <dd>{product.costPrice}</dd>

        <dt className="text-muted-foreground">Selling Price</dt>
        <dd>{product.sellingPrice ?? "Not set"}</dd>

        {product.supplier && (
          <>
            <dt className="text-muted-foreground">Supplier</dt>
            <dd>{product.supplier}</dd>
          </>
        )}

        {product.location && (
          <>
            <dt className="text-muted-foreground">Location</dt>
            <dd>{product.location}</dd>
          </>
        )}
      </dl>

      {product.description && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">Description</h2>
          <p>{product.description}</p>
        </div>
      )}
    </div>
  );
}
```

Note: this page intentionally uses a plain `<img>` tag rather than `next/image` for the anonymous-view product photo, since `next/image` requires configuring allowed remote hostnames and product photo hosting (R2) isn't provisioned yet (matches the Phase 2 decision to defer photo upload). Revisit when R2 is configured.

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 3: Manually verify against the real dev database**

Run: `npm run dev`. Using a product created in earlier manual testing (or create one via `/products/new` while logged in), find its `publicIdentifier` (via `npx drizzle-kit studio` or a direct query) and visit `/p/{that-identifier}` in a **private/incognito browser window** (no session cookie). Expected: only product name and price shown (no SKU, cost, quantity). Then visit the same URL in your regular logged-in browser tab. Expected: full product details shown, matching what `/products/[id]` shows. Then visit `/p/does-not-exist`. Expected: Next.js's default 404 page.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add public QR scan-landing page with session-aware view

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: QR display, download, and regenerate UI on the product detail page

**Files:**
- Modify: `app/(app)/products/[id]/page.tsx`
- Create: `components/products/RegenerateQrButton.tsx`

**Interfaces:**
- Consumes: `regenerateProductQrAction` from `@/lib/actions/product.actions`; `useTransition` from `react` (same pattern as the existing `ArchiveProductButton`).
- Produces: a QR section on `/products/[id]` visible to any authenticated viewer (image + download link), with an admin-only regenerate button.

- [ ] **Step 1: Write the regenerate button as a small client component**

Create `components/products/RegenerateQrButton.tsx` (mirrors the existing `ArchiveProductButton` pattern):

```tsx
"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { regenerateProductQrAction } from "@/lib/actions/product.actions";

export function RegenerateQrButton({ productId }: { productId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      disabled={isPending}
      onClick={() => {
        if (
          !confirm(
            "Regenerate this product's QR code? The old QR code (any printed copies) will stop working."
          )
        )
          return;
        startTransition(() => {
          regenerateProductQrAction(productId);
        });
      }}
    >
      {isPending ? "Regenerating..." : "Regenerate QR code"}
    </Button>
  );
}
```

- [ ] **Step 2: Add the QR section to the product detail page**

Modify `app/(app)/products/[id]/page.tsx` — add the import for `RegenerateQrButton` alongside the existing `ArchiveProductButton` import:

```typescript
import { RegenerateQrButton } from "@/components/products/RegenerateQrButton";
```

Then add a QR section right after the closing `</dl>` block and before the `{product.description && (...)}` block:

```tsx
      <div className="space-y-2 border-t pt-4">
        <h2 className="text-sm font-medium text-muted-foreground">QR Code</h2>
        <img
          src={`/api/products/${product.id}/qr`}
          alt={`QR code for ${product.productName}`}
          width={200}
          height={200}
          className="rounded-md border"
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" render={<a href={`/api/products/${product.id}/qr?download=1`}>Download PNG</a>} />
          {user.role === "ADMIN" && <RegenerateQrButton productId={product.id} />}
        </div>
      </div>
```

Note: this uses a plain `<img>` (not `next/image`) for the same reason as Task 7 — the source is a same-origin API route generating bytes on the fly, which `next/image`'s remote-pattern allowlist isn't designed for; a plain tag is the correct choice here, not a workaround.

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all tests PASS (no test changes in this task, just UI — this confirms nothing broke).

- [ ] **Step 5: Manually verify end-to-end**

Run: `npm run dev`, log in as ADMIN, visit any product's detail page. Expected: a QR code image renders, a "Download PNG" link downloads a file named `{sku}-qr.png`, and a "Regenerate QR code" button appears. Click regenerate, confirm the dialog. Expected: page reloads showing a visually different QR code (scan it with a phone, or note the previous `publicIdentifier` via `drizzle-kit studio` and confirm it changed). Then visit the *old* `/p/{old-identifier}` URL. Expected: 404. Log out and log in as a non-admin USER, visit the same product page. Expected: QR image and Download link appear, but no Regenerate button.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add QR display, download, and admin regenerate UI to product page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Update .env.example documentation and README

**Files:**
- Modify: `README.md`

**Interfaces:**
- None (documentation only).

- [ ] **Step 1: Check current README structure**

Run: `grep -n "^#" README.md` to see existing section headers, so the new section matches the existing style/placement (likely near the "Features" or "Environment Variables" section, following whatever pattern Phase 1/2 used there).

- [ ] **Step 2: Add a QR System section**

Add a short section to `README.md` documenting: what the QR system does (scan a product's QR to view it publicly or, if logged in, its full internal record), that `APP_URL` must be set correctly in production for printed QR codes to resolve to the right domain (already declared in `.env.example` — this task only adds prose explaining why it matters, not a new env var), and that regenerating a QR code invalidates any previously printed copies. Match the heading level and tone of the surrounding sections rather than inventing a new style.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Document QR system in README

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Phase 3 Completion Report Checklist

After all tasks are done, report per the parent spec's phase-completion convention (matching Phase 2's report structure):

1. **What was implemented** — QR PNG generation (on-demand, never persisted), public scan-landing page with session-aware restricted/full views, public JSON API, QR display/download/regenerate UI on the product detail page.
2. **Files changed** — full list from `git log --stat` across this branch.
3. **Database changes** — none (schema already had `publicIdentifier` from Phase 1; only existing rows' `publicIdentifier` values change via regenerate, no migration).
4. **Tests added** — `qr.service` unit tests, `product.repo` QR-query integration tests, `product.service`/`product.actions` regenerate unit tests, QR route and public-API route integration tests.
5. **Tests executed** — `npm test` output.
6. **Remaining issues** — public product photo still uses a plain `<img>` tag pending R2/`next/image` remote-pattern configuration (consistent with Phase 2's deferral); no rate limiting yet on the public routes (`/p/[publicIdentifier]`, `/api/public/products/[identifier]`) — flagged for Phase 10 (Security & Polish) per the parent spec's phase breakdown, not silently dropped.
7. **How to manually verify** — steps from Tasks 7 and 8's manual verification steps.
