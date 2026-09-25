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

  it("listProducts with no status filter returns both ACTIVE and ARCHIVED products", async () => {
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
});
