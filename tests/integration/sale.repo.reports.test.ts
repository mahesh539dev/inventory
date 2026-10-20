import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db/client";
import { sales, saleItems, products, users, categories } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { insertSale, insertSaleItems, getSalesSummary, getSalesBreakdownByProduct, getSalesBreakdownByCategory } from "@/lib/repositories/sale.repo";

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
      saleNumber: `TEST-${Math.random().toString(36).slice(2, 8)}`,
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
      saleNumber: `TEST-${Math.random().toString(36).slice(2, 8)}`,
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
      saleNumber: `TEST-${Math.random().toString(36).slice(2, 8)}`,
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
      saleNumber: `TEST-${Math.random().toString(36).slice(2, 8)}`,
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
      saleNumber: `TEST-${Math.random().toString(36).slice(2, 8)}`,
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
