import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db/client";
import { sales, saleItems, products, users } from "@/lib/db/schema";
import { sql, eq, inArray } from "drizzle-orm";
import {
  insertSale,
  insertSaleItems,
  listSales,
  countSales,
  findSaleById,
} from "@/lib/repositories/sale.repo";

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

describe("schema: returned_quantity column and PARTIALLY_RETURNED status", () => {
  let userId: string;
  let productId: string;

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

  it("allows inserting a sale_item with an explicit returnedQuantity and defaults to 0 when omitted", async () => {
    const sale = await insertSale({
      saleNumber: `TEST-${Date.now()}`,
      soldBy: userId,
      totalAmount: "10.00",
      totalCost: "5.00",
      totalProfit: "5.00",
      status: "COMPLETED",
    });
    const [item] = await insertSaleItems([{
      saleId: sale.id,
      productId: productId,
      quantity: 3,
      costPerUnit: "1.00",
      soldPricePerUnit: "2.00",
      totalCost: "3.00",
      totalRevenue: "6.00",
      profit: "3.00",
    }]);
    expect(item.returnedQuantity).toBe(0);
  });

  it("allows updating a sale's status to PARTIALLY_RETURNED", async () => {
    const sale = await insertSale({
      saleNumber: `TEST-${Date.now()}-2`,
      soldBy: userId,
      totalAmount: "10.00",
      totalCost: "5.00",
      totalProfit: "5.00",
      status: "PARTIALLY_RETURNED",
    });
    expect(sale.status).toBe("PARTIALLY_RETURNED");
  });
});

describe("sale.repo", () => {
  let userId: string;
  let productId: string;

  beforeEach(async () => {
    const user = await makeUser();
    userId = user.id;
    const product = await makeProduct();
    productId = product.id;
  });

  afterEach(async () => {
    // Scoped to rows this test created — the dev DB is shared with other
    // tests/manual data, so unscoped deletes can hit unrelated foreign-key
    // references (e.g. leftover products with inventory_transactions rows).
    const testSales = await db.select({ id: sales.id }).from(sales).where(eq(sales.soldBy, userId));
    const saleIds = testSales.map((s) => s.id);
    if (saleIds.length > 0) {
      await db.delete(saleItems).where(inArray(saleItems.saleId, saleIds));
      await db.delete(sales).where(inArray(sales.id, saleIds));
    }
    await db.delete(products).where(eq(products.id, productId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it("insertSale generates a sale_number from the sequence in SALE-NNNNNN form", async () => {
    const { rows } = await db.execute<{ nextval: string }>(
      sql`SELECT nextval('sale_number_seq')`
    );
    const saleNumber = `SALE-${rows[0].nextval.padStart(6, "0")}`;

    const sale = await insertSale({
      saleNumber,
      soldBy: userId,
      totalAmount: "20.00",
      totalCost: "10.00",
      totalProfit: "10.00",
      status: "COMPLETED",
    });

    expect(sale.saleNumber).toBe(saleNumber);
    expect(sale.saleNumber).toMatch(/^SALE-\d{6}$/);
  });

  it("insertSaleItems inserts one row per line linked to the sale", async () => {
    const sale = await insertSale({
      saleNumber: "SALE-000001",
      soldBy: userId,
      totalAmount: "20.00",
      totalCost: "10.00",
      totalProfit: "10.00",
      status: "COMPLETED",
    });

    const items = await insertSaleItems([
      {
        saleId: sale.id,
        productId,
        quantity: 2,
        costPerUnit: "5.00",
        soldPricePerUnit: "10.00",
        totalCost: "10.00",
        totalRevenue: "20.00",
        profit: "10.00",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].saleId).toBe(sale.id);
    expect(items[0].productId).toBe(productId);
  });

  it("findSaleById returns the sale with its items", async () => {
    const sale = await insertSale({
      saleNumber: "SALE-000002",
      soldBy: userId,
      totalAmount: "20.00",
      totalCost: "10.00",
      totalProfit: "10.00",
      status: "COMPLETED",
      buyerName: "Jane Doe",
    });
    await insertSaleItems([
      {
        saleId: sale.id,
        productId,
        quantity: 2,
        costPerUnit: "5.00",
        soldPricePerUnit: "10.00",
        totalCost: "10.00",
        totalRevenue: "20.00",
        profit: "10.00",
      },
    ]);

    const found = await findSaleById(sale.id);

    expect(found).toBeDefined();
    expect(found!.buyerName).toBe("Jane Doe");
    expect(found!.items).toHaveLength(1);
    expect(found!.items[0].productId).toBe(productId);
  });

  it("findSaleById returns undefined for an unknown id", async () => {
    const found = await findSaleById("00000000-0000-0000-0000-000000000000");
    expect(found).toBeUndefined();
  });

  it("findSaleById attaches each item's productName/sku, and orders items deterministically", async () => {
    const product2 = await makeProduct({
      sku: `SKU-${crypto.randomUUID().slice(0, 8)}`,
      productName: "Second Product",
    });

    const sale = await insertSale({
      saleNumber: "SALE-000006",
      soldBy: userId,
      totalAmount: "40.00",
      totalCost: "20.00",
      totalProfit: "20.00",
      status: "COMPLETED",
    });

    const insertedItems = await insertSaleItems([
      {
        saleId: sale.id,
        productId,
        quantity: 2,
        costPerUnit: "5.00",
        soldPricePerUnit: "10.00",
        totalCost: "10.00",
        totalRevenue: "20.00",
        profit: "10.00",
      },
      {
        saleId: sale.id,
        productId: product2.id,
        quantity: 1,
        costPerUnit: "10.00",
        soldPricePerUnit: "20.00",
        totalCost: "10.00",
        totalRevenue: "20.00",
        profit: "10.00",
      },
    ]);

    try {
      const found = await findSaleById(sale.id);

      expect(found).toBeDefined();
      expect(found!.items).toHaveLength(2);

      // Deterministic order: by saleItems.id ascending, matching insertion order.
      expect(found!.items.map((item) => item.id)).toEqual(insertedItems.map((item) => item.id));

      const firstItem = found!.items.find((item) => item.productId === productId);
      const secondItem = found!.items.find((item) => item.productId === product2.id);

      expect(firstItem?.productName).toBe("Test Product");
      expect(firstItem?.sku).toBe((await db.select().from(products).where(eq(products.id, productId)))[0].sku);
      expect(secondItem?.productName).toBe("Second Product");
      expect(secondItem?.sku).toBe(product2.sku);
    } finally {
      // Delete this test's own sale_items/sale before product2, since
      // product2 is a second product outside the outer afterEach's cleanup
      // scope (which only knows about the shared `productId`) and the FK
      // from sale_items to products would otherwise block the delete.
      await db.delete(saleItems).where(eq(saleItems.saleId, sale.id));
      await db.delete(sales).where(eq(sales.id, sale.id));
      await db.delete(products).where(eq(products.id, product2.id));
    }
  });

  it("listSales returns sales newest-first, respecting limit/offset", async () => {
    await insertSale({
      saleNumber: "SALE-000003",
      soldBy: userId,
      totalAmount: "5.00",
      totalCost: "2.00",
      totalProfit: "3.00",
      status: "COMPLETED",
    });
    await insertSale({
      saleNumber: "SALE-000004",
      soldBy: userId,
      totalAmount: "6.00",
      totalCost: "3.00",
      totalProfit: "3.00",
      status: "COMPLETED",
    });

    const results = await listSales({ limit: 1, offset: 0 });

    expect(results).toHaveLength(1);
    expect(results[0].saleNumber).toBe("SALE-000004");
  });

  it("countSales returns the total row count", async () => {
    await insertSale({
      saleNumber: "SALE-000005",
      soldBy: userId,
      totalAmount: "5.00",
      totalCost: "2.00",
      totalProfit: "3.00",
      status: "COMPLETED",
    });

    const total = await countSales();

    expect(total).toBeGreaterThanOrEqual(1);
  });
});
