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
