# Phase 2 — Product Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build authenticated Product Management: product CRUD (create, edit, view, archive), server-enforced unique SKU validation, product search/list, on-the-fly categories, and a product details page — establishing the repository/service/validation layering the rest of the app will follow.

**Architecture:** New `lib/repositories/`, `lib/services/`, `lib/validation/` layers sit between server actions and the Drizzle client. Server actions (`lib/actions/product.actions.ts`) stay thin: parse form input with Zod, call `requireAdmin()`/`requireUser()`, delegate to the service. The service (`lib/services/product.service.ts`) owns business rules (SKU normalization/uniqueness, `publicIdentifier` generation) and orchestrates repository calls inside a single transaction where needed. Repositories (`lib/repositories/product.repo.ts`, `category.repo.ts`) are the only files that import Drizzle table objects directly for products/categories.

**Tech Stack:** Next.js Server Actions, Drizzle ORM (existing `products`/`categories` tables — no migration needed), Zod for validation, `nanoid` for `publicIdentifier` generation, shadcn/ui (adding Textarea, Select, Table, Badge to the existing Button/Input/Label/Card set), Vitest.

**Spec:** [docs/superpowers/specs/2026-09-20-inventory-qr-sales-app-design.md](../specs/2026-09-20-inventory-qr-sales-app-design.md)

## Global Constraints

- SKU must be unique, normalized (trimmed, uppercased) before storage and before uniqueness checks; never silently overwrite an existing SKU (source spec section 5).
- "Manage products" (create/edit/archive) is ADMIN-only; "View products" is available to both ADMIN and USER (source spec section 25).
- Never hard-delete a product — "delete" sets `status: "ARCHIVED"` (source spec section 12, section 63 rule 7 "never delete historical").
- Selling price is nullable; do not require it at creation (source spec section 4).
- Every product gets a `publicIdentifier` generated at creation time — this phase generates and stores it (needed by the `products_public_identifier_idx` unique index already in the schema) but does not yet build the QR/public page that consumes it (that's Phase 3).
- Product photo upload is explicitly OUT OF SCOPE this phase (no R2 credentials configured yet) — the `productImage` field and an upload UI slot exist but are disabled/inert, not removed.
- All validation must be server-side (Zod schemas in `lib/validation/`, enforced in server actions) — never trust client-side-only validation.
- Package manager is npm. TypeScript strict mode. Mobile-first UI, large touch targets.
- Money fields already exist as Postgres `numeric` in the schema — when handling price input in TypeScript, convert form strings to numeric-safe decimal strings for Drizzle (Drizzle's `numeric` columns accept string input), never do float arithmetic on money values.

---

### Task 1: Install dependencies and add missing shadcn components

**Files:**
- Modify: `package.json` (add `zod`, `nanoid`)
- Create: `components/ui/textarea.tsx`, `components/ui/select.tsx`, `components/ui/table.tsx`, `components/ui/badge.tsx`

**Interfaces:**
- Produces: `Textarea`, `Select`/`SelectTrigger`/`SelectContent`/`SelectItem`/`SelectValue`, `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`, `Badge` components under `components/ui/`, all importing `cn` from `@/lib/utils` (matching the existing Button/Input/Label/Card pattern — do NOT let the shadcn CLI introduce a third-party `cn` package again, see Task 1 Step 4).

- [ ] **Step 1: Install zod and nanoid**

```bash
npm install zod nanoid
```

- [ ] **Step 2: Add the new shadcn components**

```bash
npx shadcn@latest add textarea select table badge
```

- [ ] **Step 3: Verify the components compile**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Verify cn imports are consistent**

Run: `grep -rn "from \"cn\"" components/ui/` (or equivalent search)
Expected: no matches. Every new component must import `cn` from `@/lib/utils`, exactly like `components/ui/button.tsx` already does. If the shadcn CLI generated an import from a different package, fix it to `import { cn } from "@/lib/utils";` in each affected file.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add zod, nanoid, and shadcn Textarea/Select/Table/Badge components"
```

---

### Task 2: Product and category repositories

**Files:**
- Create: `lib/repositories/category.repo.ts`
- Create: `lib/repositories/product.repo.ts`
- Test: `tests/integration/product.repo.test.ts`

**Interfaces:**
- Consumes: `db` from `@/lib/db/client`, `products`/`categories` tables and `productStatusEnum` from `@/lib/db/schema`.
- Produces (category.repo.ts):
  - `findOrCreateCategory(name: string): Promise<{ id: string; name: string }>` — case-insensitive lookup by trimmed name; creates if not found.
  - `listCategories(): Promise<{ id: string; name: string }[]>` — all categories, ordered by name.
- Produces (product.repo.ts):
  - `type ProductRow` — the full Drizzle-inferred row type for `products` (`typeof products.$inferSelect`).
  - `type NewProduct` — `typeof products.$inferInsert`.
  - `findProductBySku(sku: string): Promise<ProductRow | undefined>`
  - `findProductById(id: string): Promise<ProductRow | undefined>`
  - `insertProduct(data: NewProduct): Promise<ProductRow>`
  - `updateProduct(id: string, data: Partial<NewProduct>): Promise<ProductRow>`
  - `archiveProduct(id: string): Promise<ProductRow>` — sets `status: "ARCHIVED"`, `updatedAt: new Date()`.
  - `listProducts(params: { search?: string; categoryId?: string; status?: "ACTIVE" | "ARCHIVED"; limit: number; offset: number }): Promise<ProductRow[]>` — search matches `sku` OR `productName` case-insensitively (use Drizzle's `ilike`); default `status` filter is `"ACTIVE"` when not specified.
  - `countProducts(params: { search?: string; categoryId?: string; status?: "ACTIVE" | "ARCHIVED" }): Promise<number>` — same filters as `listProducts`, for pagination.

- [ ] **Step 1: Write category.repo.ts**

```typescript
import { db } from "@/lib/db/client";
import { categories } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export async function findOrCreateCategory(name: string): Promise<{ id: string; name: string }> {
  const trimmed = name.trim();

  const [existing] = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(sql`lower(${categories.name}) = lower(${trimmed})`)
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(categories)
    .values({ name: trimmed })
    .returning({ id: categories.id, name: categories.name });

  return created;
}

export async function listCategories(): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .orderBy(categories.name);
}
```

- [ ] **Step 2: Write product.repo.ts**

```typescript
import { db } from "@/lib/db/client";
import { products } from "@/lib/db/schema";
import { and, eq, ilike, or, count } from "drizzle-orm";

export type ProductRow = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;

export async function findProductBySku(sku: string): Promise<ProductRow | undefined> {
  const [row] = await db.select().from(products).where(eq(products.sku, sku)).limit(1);
  return row;
}

export async function findProductById(id: string): Promise<ProductRow | undefined> {
  const [row] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return row;
}

export async function insertProduct(data: NewProduct): Promise<ProductRow> {
  const [row] = await db.insert(products).values(data).returning();
  return row;
}

export async function updateProduct(id: string, data: Partial<NewProduct>): Promise<ProductRow> {
  const [row] = await db
    .update(products)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning();
  return row;
}

export async function archiveProduct(id: string): Promise<ProductRow> {
  const [row] = await db
    .update(products)
    .set({ status: "ARCHIVED", updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning();
  return row;
}

type ListParams = {
  search?: string;
  categoryId?: string;
  status?: "ACTIVE" | "ARCHIVED";
  limit: number;
  offset: number;
};

function buildFilters(params: Pick<ListParams, "search" | "categoryId" | "status">) {
  const filters = [eq(products.status, params.status ?? "ACTIVE")];

  if (params.categoryId) {
    filters.push(eq(products.categoryId, params.categoryId));
  }

  if (params.search && params.search.trim().length > 0) {
    const term = `%${params.search.trim()}%`;
    const searchFilter = or(ilike(products.sku, term), ilike(products.productName, term));
    if (searchFilter) filters.push(searchFilter);
  }

  return and(...filters);
}

export async function listProducts(params: ListParams): Promise<ProductRow[]> {
  return db
    .select()
    .from(products)
    .where(buildFilters(params))
    .orderBy(products.productName)
    .limit(params.limit)
    .offset(params.offset);
}

export async function countProducts(
  params: Pick<ListParams, "search" | "categoryId" | "status">
): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(products)
    .where(buildFilters(params));
  return value;
}
```

- [ ] **Step 3: Write an integration test against the real dev database**

Create `tests/integration/product.repo.test.ts`:

```typescript
import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/lib/db/client";
import { products, categories } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  findProductBySku,
  insertProduct,
  updateProduct,
  archiveProduct,
  listProducts,
  countProducts,
} from "@/lib/repositories/product.repo";
import { findOrCreateCategory } from "@/lib/repositories/category.repo";

const TEST_SKU_PREFIX = "TEST-REPO-";

describe("product.repo", () => {
  afterAll(async () => {
    await db.delete(products).where(eq(products.sku, `${TEST_SKU_PREFIX}001`));
    await db.delete(categories).where(eq(categories.name, "Test Repo Category"));
  });

  it("inserts and finds a product by SKU", async () => {
    const category = await findOrCreateCategory("Test Repo Category");

    const inserted = await insertProduct({
      publicIdentifier: "test-repo-pubid-001",
      sku: `${TEST_SKU_PREFIX}001`,
      productName: "Repo Test Product",
      categoryId: category.id,
      originalPrice: "100.00",
      costPrice: "50.00",
      currentQuantity: 10,
    });

    expect(inserted.sku).toBe(`${TEST_SKU_PREFIX}001`);

    const found = await findProductBySku(`${TEST_SKU_PREFIX}001`);
    expect(found?.id).toBe(inserted.id);
  });

  it("updates a product", async () => {
    const found = await findProductBySku(`${TEST_SKU_PREFIX}001`);
    if (!found) throw new Error("fixture missing");

    const updated = await updateProduct(found.id, { productName: "Renamed Repo Test Product" });
    expect(updated.productName).toBe("Renamed Repo Test Product");
  });

  it("archives a product instead of deleting it", async () => {
    const found = await findProductBySku(`${TEST_SKU_PREFIX}001`);
    if (!found) throw new Error("fixture missing");

    const archived = await archiveProduct(found.id);
    expect(archived.status).toBe("ARCHIVED");

    const stillFindableBySku = await findProductBySku(`${TEST_SKU_PREFIX}001`);
    expect(stillFindableBySku).toBeDefined();
  });

  it("excludes archived products from the default active list", async () => {
    const activeCount = await countProducts({ status: "ACTIVE" });
    const results = await listProducts({ status: "ACTIVE", limit: 1000, offset: 0 });
    expect(results.find((p) => p.sku === `${TEST_SKU_PREFIX}001`)).toBeUndefined();
    expect(results.length).toBeLessThanOrEqual(activeCount);
  });

  it("finds the archived product when explicitly filtering for ARCHIVED status", async () => {
    const results = await listProducts({ status: "ARCHIVED", limit: 1000, offset: 0 });
    expect(results.find((p) => p.sku === `${TEST_SKU_PREFIX}001`)).toBeDefined();
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npm test -- tests/integration/product.repo.test.ts`
Expected: all 5 tests PASS against the real dev database configured in `.env.local`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add product and category repositories with integration tests"
```

---

### Task 3: SKU normalization and product validation schemas

**Files:**
- Create: `lib/validation/product.schema.ts`
- Test: `tests/unit/product.schema.test.ts`

**Interfaces:**
- Produces:
  - `normalizeSku(raw: string): string` — trims whitespace, uppercases, collapses internal whitespace to nothing (SKUs have no spaces).
  - `createProductSchema` — Zod schema for product creation form input (all fields as strings from `FormData`, since HTML forms only produce strings/File).
  - `updateProductSchema` — Zod schema for edit form input (same shape as create, SKU immutable — omit `sku` from the update schema entirely, since SKU changes are out of scope for this phase).
  - `type CreateProductInput = z.infer<typeof createProductSchema>`
  - `type UpdateProductInput = z.infer<typeof updateProductSchema>`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/product.schema.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { normalizeSku, createProductSchema } from "@/lib/validation/product.schema";

describe("normalizeSku", () => {
  it("trims and uppercases", () => {
    expect(normalizeSku("  shoe-001  ")).toBe("SHOE-001");
  });

  it("uppercases mixed case", () => {
    expect(normalizeSku("AbC-123")).toBe("ABC-123");
  });
});

describe("createProductSchema", () => {
  it("accepts valid product input", () => {
    const result = createProductSchema.safeParse({
      productName: "Nike Shoes",
      sku: "shoe-001",
      categoryName: "Shoes",
      description: "",
      originalPrice: "5000",
      costPrice: "2500",
      sellingPrice: "",
      currentQuantity: "5",
      supplier: "",
      location: "",
      notes: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sku).toBe("SHOE-001");
      expect(result.data.sellingPrice).toBeNull();
    }
  });

  it("rejects a missing product name", () => {
    const result = createProductSchema.safeParse({
      productName: "",
      sku: "SHOE-001",
      categoryName: "",
      description: "",
      originalPrice: "5000",
      costPrice: "2500",
      sellingPrice: "",
      currentQuantity: "5",
      supplier: "",
      location: "",
      notes: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative cost price", () => {
    const result = createProductSchema.safeParse({
      productName: "Nike Shoes",
      sku: "SHOE-001",
      categoryName: "",
      description: "",
      originalPrice: "5000",
      costPrice: "-1",
      sellingPrice: "",
      currentQuantity: "5",
      supplier: "",
      location: "",
      notes: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative initial quantity", () => {
    const result = createProductSchema.safeParse({
      productName: "Nike Shoes",
      sku: "SHOE-001",
      categoryName: "",
      description: "",
      originalPrice: "5000",
      costPrice: "2500",
      sellingPrice: "",
      currentQuantity: "-1",
      supplier: "",
      location: "",
      notes: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts an explicit selling price and coerces it", () => {
    const result = createProductSchema.safeParse({
      productName: "Nike Shoes",
      sku: "SHOE-001",
      categoryName: "",
      description: "",
      originalPrice: "5000",
      costPrice: "2500",
      sellingPrice: "4999",
      currentQuantity: "5",
      supplier: "",
      location: "",
      notes: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sellingPrice).toBe("4999");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/product.schema.test.ts`
Expected: FAIL with "Cannot find module '@/lib/validation/product.schema'"

- [ ] **Step 3: Write the implementation**

Create `lib/validation/product.schema.ts`:

```typescript
import { z } from "zod";

export function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

const moneyString = z
  .string()
  .refine((val) => val.trim().length > 0, { message: "Required" })
  .refine((val) => !Number.isNaN(Number(val)), { message: "Must be a number" })
  .refine((val) => Number(val) >= 0, { message: "Must be zero or greater" });

const optionalMoneyString = z
  .string()
  .transform((val) => (val.trim().length === 0 ? null : val))
  .nullable()
  .refine((val) => val === null || !Number.isNaN(Number(val)), { message: "Must be a number" })
  .refine((val) => val === null || Number(val) >= 0, { message: "Must be zero or greater" });

const quantityString = z
  .string()
  .refine((val) => val.trim().length > 0, { message: "Required" })
  .refine((val) => Number.isInteger(Number(val)), { message: "Must be a whole number" })
  .refine((val) => Number(val) >= 0, { message: "Must be zero or greater" });

const productFields = {
  productName: z.string().trim().min(1, "Product name is required").max(255),
  categoryName: z.string().trim().max(255).optional().default(""),
  description: z.string().trim().max(5000).optional().default(""),
  originalPrice: moneyString,
  costPrice: moneyString,
  sellingPrice: optionalMoneyString,
  currentQuantity: quantityString,
  supplier: z.string().trim().max(255).optional().default(""),
  location: z.string().trim().max(255).optional().default(""),
  notes: z.string().trim().max(5000).optional().default(""),
};

export const createProductSchema = z.object({
  sku: z.string().trim().min(1, "SKU is required").max(64).transform(normalizeSku),
  ...productFields,
});

export const updateProductSchema = z.object({
  ...productFields,
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/product.schema.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add product validation schemas with SKU normalization"
```

---

### Task 4: Product service (business rules) and nanoid-based public identifier

**Files:**
- Create: `lib/services/product.service.ts`
- Test: `tests/unit/product.service.test.ts`

**Interfaces:**
- Consumes: `findProductBySku`, `insertProduct`, `updateProduct`, `archiveProduct`, `findProductById` from `@/lib/repositories/product.repo`; `findOrCreateCategory` from `@/lib/repositories/category.repo`; `CreateProductInput`, `UpdateProductInput` from `@/lib/validation/product.schema`; `nanoid` from `"nanoid"`.
- Produces:
  - `class DuplicateSkuError extends Error` — thrown when a create/rename would collide with an existing SKU.
  - `createProduct(input: CreateProductInput): Promise<ProductRow>` — looks up/creates category by name if `categoryName` non-empty, checks SKU uniqueness (throws `DuplicateSkuError` if taken), generates a `publicIdentifier` via `nanoid(10)`, inserts the product.
  - `updateProduct(id: string, input: UpdateProductInput): Promise<ProductRow>` — looks up/creates category by name if provided, updates all editable fields (SKU is not editable this phase, per Global Constraints).
  - `archiveProduct(id: string): Promise<ProductRow>` — thin pass-through to the repo function (kept in the service so callers only ever import from `lib/services`, never mix repo and service imports in the same call site).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/product.service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/repositories/product.repo", () => ({
  findProductBySku: vi.fn(),
  insertProduct: vi.fn(),
  updateProduct: vi.fn(),
  archiveProduct: vi.fn(),
  findProductById: vi.fn(),
}));

vi.mock("@/lib/repositories/category.repo", () => ({
  findOrCreateCategory: vi.fn(),
}));

import {
  findProductBySku,
  insertProduct,
} from "@/lib/repositories/product.repo";
import { findOrCreateCategory } from "@/lib/repositories/category.repo";
import { createProduct, DuplicateSkuError } from "@/lib/services/product.service";
import type { CreateProductInput } from "@/lib/validation/product.schema";

const validInput: CreateProductInput = {
  sku: "SHOE-001",
  productName: "Nike Shoes",
  categoryName: "Shoes",
  description: "",
  originalPrice: "5000",
  costPrice: "2500",
  sellingPrice: null,
  currentQuantity: "5",
  supplier: "",
  location: "",
  notes: "",
};

describe("createProduct", () => {
  beforeEach(() => {
    vi.mocked(findProductBySku).mockReset();
    vi.mocked(insertProduct).mockReset();
    vi.mocked(findOrCreateCategory).mockReset();
  });

  it("throws DuplicateSkuError when the SKU already exists", async () => {
    vi.mocked(findProductBySku).mockResolvedValue({
      id: "existing-id",
      sku: "SHOE-001",
    } as never);

    await expect(createProduct(validInput)).rejects.toThrow(DuplicateSkuError);
    expect(insertProduct).not.toHaveBeenCalled();
  });

  it("creates a product with a generated publicIdentifier when the SKU is free", async () => {
    vi.mocked(findProductBySku).mockResolvedValue(undefined);
    vi.mocked(findOrCreateCategory).mockResolvedValue({ id: "cat-1", name: "Shoes" });
    vi.mocked(insertProduct).mockImplementation(async (data) => ({
      ...data,
      id: "new-id",
    } as never));

    const result = await createProduct(validInput);

    expect(insertProduct).toHaveBeenCalledTimes(1);
    const insertedData = vi.mocked(insertProduct).mock.calls[0][0];
    expect(insertedData.sku).toBe("SHOE-001");
    expect(insertedData.categoryId).toBe("cat-1");
    expect(typeof insertedData.publicIdentifier).toBe("string");
    expect(insertedData.publicIdentifier!.length).toBeGreaterThanOrEqual(10);
    expect(result.id).toBe("new-id");
  });

  it("skips category lookup when categoryName is empty", async () => {
    vi.mocked(findProductBySku).mockResolvedValue(undefined);
    vi.mocked(insertProduct).mockImplementation(async (data) => ({
      ...data,
      id: "new-id",
    } as never));

    await createProduct({ ...validInput, categoryName: "" });

    expect(findOrCreateCategory).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/product.service.test.ts`
Expected: FAIL with "Cannot find module '@/lib/services/product.service'"

- [ ] **Step 3: Write the implementation**

Create `lib/services/product.service.ts`:

```typescript
import { nanoid } from "nanoid";
import {
  findProductBySku,
  insertProduct as repoInsertProduct,
  updateProduct as repoUpdateProduct,
  archiveProduct as repoArchiveProduct,
  findProductById,
  type ProductRow,
} from "@/lib/repositories/product.repo";
import { findOrCreateCategory } from "@/lib/repositories/category.repo";
import type { CreateProductInput, UpdateProductInput } from "@/lib/validation/product.schema";

export class DuplicateSkuError extends Error {
  constructor(sku: string) {
    super(`SKU already exists: ${sku}`);
    this.name = "DuplicateSkuError";
  }
}

export class ProductNotFoundError extends Error {
  constructor(id: string) {
    super(`Product not found: ${id}`);
    this.name = "ProductNotFoundError";
  }
}

async function resolveCategoryId(categoryName: string): Promise<string | undefined> {
  if (!categoryName || categoryName.trim().length === 0) return undefined;
  const category = await findOrCreateCategory(categoryName);
  return category.id;
}

export async function createProduct(input: CreateProductInput): Promise<ProductRow> {
  const existing = await findProductBySku(input.sku);
  if (existing) {
    throw new DuplicateSkuError(input.sku);
  }

  const categoryId = await resolveCategoryId(input.categoryName);

  return repoInsertProduct({
    publicIdentifier: nanoid(10),
    sku: input.sku,
    productName: input.productName,
    categoryId,
    description: input.description || null,
    originalPrice: input.originalPrice,
    costPrice: input.costPrice,
    sellingPrice: input.sellingPrice,
    currentQuantity: Number(input.currentQuantity),
    supplier: input.supplier || null,
    location: input.location || null,
    notes: input.notes || null,
  });
}

export async function updateProduct(id: string, input: UpdateProductInput): Promise<ProductRow> {
  const existing = await findProductById(id);
  if (!existing) {
    throw new ProductNotFoundError(id);
  }

  const categoryId = await resolveCategoryId(input.categoryName);

  return repoUpdateProduct(id, {
    productName: input.productName,
    categoryId,
    description: input.description || null,
    originalPrice: input.originalPrice,
    costPrice: input.costPrice,
    sellingPrice: input.sellingPrice,
    supplier: input.supplier || null,
    location: input.location || null,
    notes: input.notes || null,
  });
}

export async function archiveProduct(id: string): Promise<ProductRow> {
  const existing = await findProductById(id);
  if (!existing) {
    throw new ProductNotFoundError(id);
  }
  return repoArchiveProduct(id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/product.service.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add product service with SKU uniqueness and publicIdentifier generation"
```

---

### Task 5: Product server actions

**Files:**
- Create: `lib/actions/product.actions.ts`
- Test: `tests/unit/product.actions.test.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `requireUser` from `@/lib/auth/guards`; `createProductSchema`, `updateProductSchema` from `@/lib/validation/product.schema`; `createProduct`, `updateProduct as serviceUpdateProduct`, `archiveProduct as serviceArchiveProduct`, `DuplicateSkuError` from `@/lib/services/product.service`; `redirect` from `next/navigation`; `revalidatePath` from `next/cache`.
- Produces:
  - `type ProductFormState = { error?: string; fieldErrors?: Record<string, string> } | undefined`
  - `createProductAction(_prevState: ProductFormState, formData: FormData): Promise<ProductFormState>` — on success, redirects to `/products/[id]` (throws Next's redirect, so it never actually returns on the success path).
  - `updateProductAction(id: string, _prevState: ProductFormState, formData: FormData): Promise<ProductFormState>` — on success, redirects to `/products/[id]`.
  - `archiveProductAction(id: string): Promise<void>` — no form state needed (invoked from a button, not a form with field errors); revalidates `/products` and redirects there.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/product.actions.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/guards", () => ({
  requireAdmin: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/lib/services/product.service", () => ({
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  archiveProduct: vi.fn(),
  DuplicateSkuError: class DuplicateSkuError extends Error {},
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
import { createProduct, DuplicateSkuError } from "@/lib/services/product.service";
import { createProductAction } from "@/lib/actions/product.actions";

function buildFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const defaults: Record<string, string> = {
    productName: "Nike Shoes",
    sku: "SHOE-001",
    categoryName: "Shoes",
    description: "",
    originalPrice: "5000",
    costPrice: "2500",
    sellingPrice: "",
    currentQuantity: "5",
    supplier: "",
    location: "",
    notes: "",
  };
  for (const [key, value] of Object.entries({ ...defaults, ...overrides })) {
    fd.set(key, value);
  }
  return fd;
}

describe("createProductAction", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset();
    vi.mocked(createProduct).mockReset();
  });

  it("requires admin before doing anything else", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("Forbidden: admin role required"));

    await expect(createProductAction(undefined, buildFormData())).rejects.toThrow("Forbidden");
    expect(createProduct).not.toHaveBeenCalled();
  });

  it("returns a field error when validation fails", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: "1", role: "ADMIN", email: "a@example.com" });

    const result = await createProductAction(undefined, buildFormData({ productName: "" }));

    expect(result?.error).toBeDefined();
    expect(createProduct).not.toHaveBeenCalled();
  });

  it("returns a duplicate SKU error from the service", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: "1", role: "ADMIN", email: "a@example.com" });
    vi.mocked(createProduct).mockRejectedValue(new DuplicateSkuError("SKU already exists: SHOE-001"));

    const result = await createProductAction(undefined, buildFormData());

    expect(result?.error).toContain("SHOE-001");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/product.actions.test.ts`
Expected: FAIL with "Cannot find module '@/lib/actions/product.actions'"

- [ ] **Step 3: Write the implementation**

Create `lib/actions/product.actions.ts`:

```typescript
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireUser } from "@/lib/auth/guards";
import { createProductSchema, updateProductSchema } from "@/lib/validation/product.schema";
import {
  createProduct,
  updateProduct as serviceUpdateProduct,
  archiveProduct as serviceArchiveProduct,
  DuplicateSkuError,
} from "@/lib/services/product.service";

export type ProductFormState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

function formDataToRecord(formData: FormData): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") record[key] = value;
  }
  return record;
}

function firstFieldError(fieldErrors: Record<string, string[] | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, messages] of Object.entries(fieldErrors)) {
    if (messages && messages.length > 0) result[key] = messages[0];
  }
  return result;
}

export async function createProductAction(
  _prevState: ProductFormState,
  formData: FormData
): Promise<ProductFormState> {
  await requireAdmin();

  const parsed = createProductSchema.safeParse(formDataToRecord(formData));
  if (!parsed.success) {
    return {
      error: "Please fix the errors below",
      fieldErrors: firstFieldError(parsed.error.flatten().fieldErrors),
    };
  }

  let productId: string;
  try {
    const product = await createProduct(parsed.data);
    productId = product.id;
  } catch (error) {
    if (error instanceof DuplicateSkuError) {
      return { error: error.message, fieldErrors: { sku: error.message } };
    }
    throw error;
  }

  revalidatePath("/products");
  redirect(`/products/${productId}`);
}

export async function updateProductAction(
  id: string,
  _prevState: ProductFormState,
  formData: FormData
): Promise<ProductFormState> {
  await requireAdmin();

  const parsed = updateProductSchema.safeParse(formDataToRecord(formData));
  if (!parsed.success) {
    return {
      error: "Please fix the errors below",
      fieldErrors: firstFieldError(parsed.error.flatten().fieldErrors),
    };
  }

  await serviceUpdateProduct(id, parsed.data);

  revalidatePath("/products");
  revalidatePath(`/products/${id}`);
  redirect(`/products/${id}`);
}

export async function archiveProductAction(id: string): Promise<void> {
  await requireAdmin();
  await serviceArchiveProduct(id);
  revalidatePath("/products");
  redirect("/products");
}
```

Note: `requireUser` is imported in the interface list for use by read-only pages (Task 6/7), not by this actions file — remove the unused `requireUser` import from this file if your editor/linter flags it, since only `requireAdmin` is actually called here.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/product.actions.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add product server actions with admin authorization and validation"
```

---

### Task 6: Product list page with search

**Files:**
- Create: `app/(app)/products/page.tsx`
- Create: `components/products/ProductSearchForm.tsx`

**Interfaces:**
- Consumes: `requireUser` from `@/lib/auth/guards`; `listProducts`, `countProducts` from `@/lib/repositories/product.repo`; `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell` from `@/components/ui/table`; `Badge` from `@/components/ui/badge`; `Input` from `@/components/ui/input`; `Button` from `@/components/ui/button`.
- Produces: the `/products` route, reachable from the existing nav (`components/nav/MobileNav.tsx` and `DesktopSidebar.tsx` already link to `/products` — no nav changes needed this task).

- [ ] **Step 1: Write the search form component**

Create `components/products/ProductSearchForm.tsx`:

```tsx
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function ProductSearchForm({ defaultValue }: { defaultValue: string }) {
  return (
    <form method="GET" className="flex gap-2">
      <Input
        type="search"
        name="q"
        placeholder="Search SKU or name"
        defaultValue={defaultValue}
        className="flex-1"
      />
      <Button type="submit">Search</Button>
    </form>
  );
}
```

- [ ] **Step 2: Write the product list page**

Create `app/(app)/products/page.tsx`:

```tsx
import Link from "next/link";
import { requireUser } from "@/lib/auth/guards";
import { listProducts, countProducts } from "@/lib/repositories/product.repo";
import { ProductSearchForm } from "@/components/products/ProductSearchForm";
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

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const user = await requireUser();
  const { q, page: pageParam } = await searchParams;

  const search = q?.trim() || undefined;
  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [items, total] = await Promise.all([
    listProducts({ search, status: "ACTIVE", limit: PAGE_SIZE, offset }),
    countProducts({ search, status: "ACTIVE" }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Products</h1>
        {user.role === "ADMIN" && (
          <Button asChild>
            <Link href="/products/new">New Product</Link>
          </Button>
        )}
      </div>

      <ProductSearchForm defaultValue={q ?? ""} />

      {items.length === 0 ? (
        <p className="text-muted-foreground">No products found.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((product) => (
                <TableRow key={product.id}>
                  <TableCell>
                    <Link href={`/products/${product.id}`} className="font-medium underline-offset-4 hover:underline">
                      {product.sku}
                    </Link>
                  </TableCell>
                  <TableCell>{product.productName}</TableCell>
                  <TableCell>{product.categoryId ? "—" : "—"}</TableCell>
                  <TableCell>{product.currentQuantity}</TableCell>
                  <TableCell>{product.costPrice}</TableCell>
                  <TableCell>
                    <Badge variant={product.status === "ACTIVE" ? "default" : "secondary"}>
                      {product.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages} ({total} products)
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/products?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page - 1) })}`}>
                  Previous
                </Link>
              </Button>
            )}
            {page < totalPages && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/products?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page + 1) })}`}>
                  Next
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

Note on the category column: this task deliberately shows "—" for category since resolving `categoryId` to a category name in the list view requires a join that's a reasonable follow-up but not blocking — record this as a known simplification in the task's self-review, not a silent gap. If straightforward to add without over-engineering, prefer joining category name into `listProducts`'s result instead of leaving "—"; use your judgment, but do not skip mentioning the decision in your report.

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Manually verify in the dev server**

Run: `npm run dev`, log in, visit `/products`. Expected: empty state ("No products found.") since no products exist yet — this is expected and correct at this point in the plan. Confirm the "New Product" button appears only when logged in as the ADMIN role (the seeded admin from Phase 1 has `role: "ADMIN"`).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add product list page with search and pagination"
```

---

### Task 7: Product creation form and page

**Files:**
- Create: `app/(app)/products/new/page.tsx`
- Create: `components/products/ProductForm.tsx`

**Interfaces:**
- Consumes: `requireAdmin` from `@/lib/auth/guards`; `createProductAction`, `type ProductFormState` from `@/lib/actions/product.actions`; `Input`, `Label`, `Textarea`, `Button`, `Card`/`CardContent`/`CardHeader`/`CardTitle` from `@/components/ui/*`; `useActionState` from `react`.
- Produces: the `/products/new` route.

- [ ] **Step 1: Write the shared product form component**

Create `components/products/ProductForm.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ProductFormState } from "@/lib/actions/product.actions";

type ProductFormProps = {
  action: (prevState: ProductFormState, formData: FormData) => Promise<ProductFormState>;
  defaultValues?: {
    sku?: string;
    productName?: string;
    categoryName?: string;
    description?: string;
    originalPrice?: string;
    costPrice?: string;
    sellingPrice?: string;
    currentQuantity?: string;
    supplier?: string;
    location?: string;
    notes?: string;
  };
  skuEditable?: boolean;
  submitLabel: string;
};

export function ProductForm({ action, defaultValues = {}, skuEditable = true, submitLabel }: ProductFormProps) {
  const [state, formAction, isPending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="space-y-4 max-w-xl">
      <div className="space-y-2">
        <Label htmlFor="productName">Product Name</Label>
        <Input id="productName" name="productName" required defaultValue={defaultValues.productName} />
        {state?.fieldErrors?.productName && (
          <p className="text-sm text-destructive">{state.fieldErrors.productName}</p>
        )}
      </div>

      {skuEditable && (
        <div className="space-y-2">
          <Label htmlFor="sku">SKU</Label>
          <Input id="sku" name="sku" required defaultValue={defaultValues.sku} />
          {state?.fieldErrors?.sku && <p className="text-sm text-destructive">{state.fieldErrors.sku}</p>}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="categoryName">Category</Label>
        <Input id="categoryName" name="categoryName" defaultValue={defaultValues.categoryName} placeholder="e.g. Shoes" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" defaultValue={defaultValues.description} rows={3} />
      </div>

      <div className="space-y-2 opacity-50">
        <Label htmlFor="photo">Product Photo</Label>
        <Input id="photo" name="photo" type="file" disabled />
        <p className="text-xs text-muted-foreground">Photo upload coming soon.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="originalPrice">Original Price</Label>
          <Input id="originalPrice" name="originalPrice" inputMode="decimal" required defaultValue={defaultValues.originalPrice} />
          {state?.fieldErrors?.originalPrice && (
            <p className="text-sm text-destructive">{state.fieldErrors.originalPrice}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="costPrice">Cost Price</Label>
          <Input id="costPrice" name="costPrice" inputMode="decimal" required defaultValue={defaultValues.costPrice} />
          {state?.fieldErrors?.costPrice && (
            <p className="text-sm text-destructive">{state.fieldErrors.costPrice}</p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="sellingPrice">Selling Price (optional)</Label>
        <Input id="sellingPrice" name="sellingPrice" inputMode="decimal" defaultValue={defaultValues.sellingPrice} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="currentQuantity">Initial Quantity</Label>
        <Input
          id="currentQuantity"
          name="currentQuantity"
          inputMode="numeric"
          required
          defaultValue={defaultValues.currentQuantity ?? "0"}
        />
        {state?.fieldErrors?.currentQuantity && (
          <p className="text-sm text-destructive">{state.fieldErrors.currentQuantity}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="supplier">Supplier</Label>
          <Input id="supplier" name="supplier" defaultValue={defaultValues.supplier} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="location">Location</Label>
          <Input id="location" name="location" defaultValue={defaultValues.location} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" defaultValue={defaultValues.notes} rows={3} />
      </div>

      {state?.error && !state.fieldErrors && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" size="lg" className="w-full" disabled={isPending}>
        {isPending ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Write the new-product page**

Create `app/(app)/products/new/page.tsx`:

```tsx
import { requireAdmin } from "@/lib/auth/guards";
import { createProductAction } from "@/lib/actions/product.actions";
import { ProductForm } from "@/components/products/ProductForm";

export default async function NewProductPage() {
  await requireAdmin();

  return (
    <div className="p-4">
      <h1 className="text-2xl font-semibold mb-4">New Product</h1>
      <ProductForm action={createProductAction} submitLabel="Create Product" />
    </div>
  );
}
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Manually verify end-to-end against the real dev database**

Run: `npm run dev`, log in as the seeded ADMIN, visit `/products/new`, fill in a product (e.g. SKU `SHOE-001`, name "Nike Running Shoes", cost price `2500`, original price `4999`, quantity `5`), submit. Expected: redirected to `/products/[new-id]` (the details page doesn't exist until Task 8 — a 404 here is expected for this step only; confirm instead by checking `/products` shows the new product in the list, and that `npx drizzle-kit studio` or a direct query shows the row with a non-null `publicIdentifier`).

Then try creating a second product with the same SKU (case-insensitive: try `shoe-001`). Expected: form re-displays with a SKU field error, no duplicate row created.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add product creation form and page"
```

---

### Task 8: Product details page and edit page

**Files:**
- Create: `app/(app)/products/[id]/page.tsx`
- Create: `app/(app)/products/[id]/edit/page.tsx`
- Create: `components/products/ArchiveProductButton.tsx`

**Interfaces:**
- Consumes: `requireUser`, `requireAdmin` from `@/lib/auth/guards`; `findProductById` from `@/lib/repositories/product.repo`; `updateProductAction`, `archiveProductAction` from `@/lib/actions/product.actions`; `ProductForm` from `@/components/products/ProductForm`; `notFound` from `next/navigation`.
- Produces: the `/products/[id]` and `/products/[id]/edit` routes.

- [ ] **Step 1: Write the archive button as a small client component**

Create `components/products/ArchiveProductButton.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { archiveProductAction } from "@/lib/actions/product.actions";

export function ArchiveProductButton({ productId }: { productId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="destructive"
      disabled={isPending}
      onClick={() => {
        if (!confirm("Archive this product? It will no longer appear in the active product list.")) return;
        startTransition(() => {
          archiveProductAction(productId);
        });
      }}
    >
      {isPending ? "Archiving..." : "Archive"}
    </Button>
  );
}
```

- [ ] **Step 2: Write the product details page**

Create `app/(app)/products/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";
import { findProductById } from "@/lib/repositories/product.repo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArchiveProductButton } from "@/components/products/ArchiveProductButton";

export default async function ProductDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const product = await findProductById(id);
  if (!product) notFound();

  return (
    <div className="p-4 space-y-4 max-w-xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{product.productName}</h1>
          <p className="text-muted-foreground">SKU: {product.sku}</p>
        </div>
        <Badge variant={product.status === "ACTIVE" ? "default" : "secondary"}>{product.status}</Badge>
      </div>

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

      {product.notes && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">Notes</h2>
          <p>{product.notes}</p>
        </div>
      )}

      {user.role === "ADMIN" && product.status === "ACTIVE" && (
        <div className="flex gap-2 pt-2">
          <Button asChild>
            <Link href={`/products/${product.id}/edit`}>Edit</Link>
          </Button>
          <ArchiveProductButton productId={product.id} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write the edit page**

Create `app/(app)/products/[id]/edit/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import { findProductById } from "@/lib/repositories/product.repo";
import { listCategories } from "@/lib/repositories/category.repo";
import { updateProductAction } from "@/lib/actions/product.actions";
import { ProductForm } from "@/components/products/ProductForm";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const product = await findProductById(id);
  if (!product) notFound();

  const categories = await listCategories();
  const category = categories.find((c) => c.id === product.categoryId);
  const boundAction = updateProductAction.bind(null, id);

  return (
    <div className="p-4">
      <h1 className="text-2xl font-semibold mb-4">Edit Product</h1>
      <ProductForm
        action={boundAction}
        skuEditable={false}
        submitLabel="Save Changes"
        defaultValues={{
          sku: product.sku,
          productName: product.productName,
          categoryName: category?.name ?? "",
          description: product.description ?? "",
          originalPrice: product.originalPrice,
          costPrice: product.costPrice,
          sellingPrice: product.sellingPrice ?? "",
          currentQuantity: String(product.currentQuantity),
          supplier: product.supplier ?? "",
          location: product.location ?? "",
          notes: product.notes ?? "",
        }}
      />
    </div>
  );
}
```

Note: `currentQuantity` is shown as read-only context via the shared form's default value here, but the update path (`updateProductSchema`/`updateProduct` service function) does not include `currentQuantity` in what gets written — quantity changes belong to Phase 4's inventory adjustment workflow, not the product edit form. If `ProductForm`'s quantity field being editable-but-ignored on the edit page is confusing, that's an acceptable known rough edge for this phase — do not build inventory adjustment logic here; just leave a one-line comment in the edit page noting quantity edits here have no effect, to be replaced by Phase 4.

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Manually verify end-to-end**

Run: `npm run dev`, log in as ADMIN, navigate to the product created in Task 7's manual test via `/products`, click through to its details page. Expected: all fields display correctly, Edit and Archive buttons appear. Click Edit, change the product name, save — expect redirect back to the details page showing the updated name. Then click Archive, confirm the dialog — expect redirect to `/products`, and the product should no longer appear in the default (ACTIVE) list.

Also verify role gating: log in as a non-admin USER (create one via `npx tsx scripts/seed.ts` pattern if none exists, or temporarily check the guard logic) and confirm the Edit/Archive buttons and `/products/new` link do not appear, and that navigating directly to `/products/[id]/edit` or `/products/new` as a USER throws the "Forbidden" error from `requireAdmin()` rather than rendering the form.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add product details page and edit page with archive action"
```

---

## Phase 2 Completion Report Checklist

After all tasks are done, report per the source spec's section 64:
1. What was implemented — repositories/services/validation layers, product CRUD (create/edit/view/archive), SKU uniqueness, search, categories, list+details+edit pages
2. Files changed — full list from `git log --stat`
3. Database changes — none (schema already existed from Phase 1); confirm no migration was needed
4. Tests added — repo integration tests, schema/service/action unit tests
5. Tests executed — `npm test` output
6. Remaining issues — photo upload deferred (no R2 credentials); category name not joined into the list view (shown as "—"); quantity not editable via the edit form (belongs to Phase 4)
7. How to manually verify — steps from Tasks 6-8's manual verification steps
