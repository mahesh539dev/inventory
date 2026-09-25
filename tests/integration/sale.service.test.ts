import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db/client";
import { sales, saleItems, inventoryTransactions, products, users } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { completeSale, InsufficientInventoryError } from "@/lib/services/sale.service";
import { ProductNotFoundError } from "@/lib/services/product.service";

// Each completeSale call runs one real transaction with several sequential
// round trips (row lock select, per-item update, nextval, sale insert,
// sale_items insert, N inventory_transaction inserts). Against this
// project's Railway Postgres dev instance — already documented as having
// unusually high per-transaction latency, see
// tests/unit/inventory.service.concurrency.test.ts's header comment — that
// routinely exceeds vitest's 5000ms default, especially in the test below
// that runs two full completeSale calls sequentially in one `it()`. This is
// infra latency, not application logic, so the fix is a longer budget for
// this file, not weaker assertions.
const DB_TEST_TIMEOUT_MS = 30000;

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

describe("completeSale (integration)", () => {
  let userId: string;
  let productIds: string[];

  // This project's dev DB is shared across concurrently-running test files
  // (vitest parallelizes across files by default), so unscoped deletes in
  // afterEach can race against another file's beforeEach/it inserting rows
  // that reference the same users/products/sales, throwing FK violations.
  // Scoped to rows this test created, same pattern as the sibling
  // tests/integration/sale.repo.test.ts's afterEach.
  async function makeProduct(overrides: Partial<typeof products.$inferInsert> = {}) {
    const [product] = await db
      .insert(products)
      .values({
        publicIdentifier: crypto.randomUUID().slice(0, 12),
        sku: `SKU-${crypto.randomUUID().slice(0, 8)}`,
        productName: "Test Product",
        originalPrice: "10.00",
        costPrice: "4.00",
        sellingPrice: "10.00",
        currentQuantity: 10,
        ...overrides,
      })
      .returning();
    productIds.push(product.id);
    return product;
  }

  beforeEach(async () => {
    const user = await makeUser();
    userId = user.id;
    productIds = [];
  }, DB_TEST_TIMEOUT_MS);

  afterEach(async () => {
    const testSales = await db.select({ id: sales.id }).from(sales).where(eq(sales.soldBy, userId));
    const saleIds = testSales.map((s) => s.id);
    if (saleIds.length > 0) {
      await db.delete(saleItems).where(inArray(saleItems.saleId, saleIds));
      await db.delete(inventoryTransactions).where(inArray(inventoryTransactions.referenceId, saleIds));
      await db.delete(sales).where(inArray(sales.id, saleIds));
    }
    if (productIds.length > 0) {
      await db.delete(inventoryTransactions).where(inArray(inventoryTransactions.productId, productIds));
      await db.delete(products).where(inArray(products.id, productIds));
    }
    await db.delete(users).where(eq(users.id, userId));
  }, DB_TEST_TIMEOUT_MS);

  it("completes a single-line sale: decrements stock, records sale + item + inventory transaction", async () => {
    const product = await makeProduct({ currentQuantity: 10, costPrice: "4.00" });

    const result = await completeSale({
      items: [{ productId: product.id, quantity: 3, soldPricePerUnit: 12 }],
      userId,
    });

    expect(result.saleNumber).toMatch(/^SALE-\d{6}$/);
    expect(result.totalAmount).toBe("36.00");
    expect(result.totalCost).toBe("12.00");
    expect(result.totalProfit).toBe("24.00");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].quantity).toBe(3);
    expect(result.items[0].profit).toBe("24.00");

    const [updatedProduct] = await db.select().from(products).where(eq(products.id, product.id));
    expect(updatedProduct.currentQuantity).toBe(7);

    const txns = await db
      .select()
      .from(inventoryTransactions)
      .where(eq(inventoryTransactions.productId, product.id));
    expect(txns).toHaveLength(1);
    expect(txns[0].type).toBe("SALE");
    expect(txns[0].quantity).toBe(-3);
    expect(txns[0].referenceId).toBe(result.id);
  }, DB_TEST_TIMEOUT_MS);

  it("completes a multi-line sale across different products with correct totals", async () => {
    const productA = await makeProduct({ currentQuantity: 5, costPrice: "2.00" });
    const productB = await makeProduct({ currentQuantity: 8, costPrice: "3.00" });

    const result = await completeSale({
      items: [
        { productId: productA.id, quantity: 2, soldPricePerUnit: 5 },
        { productId: productB.id, quantity: 1, soldPricePerUnit: 6 },
      ],
      userId,
    });

    expect(result.totalAmount).toBe("16.00");
    expect(result.totalCost).toBe("7.00");
    expect(result.totalProfit).toBe("9.00");
    expect(result.items).toHaveLength(2);

    const [updatedA] = await db.select().from(products).where(eq(products.id, productA.id));
    const [updatedB] = await db.select().from(products).where(eq(products.id, productB.id));
    expect(updatedA.currentQuantity).toBe(3);
    expect(updatedB.currentQuantity).toBe(7);
  }, DB_TEST_TIMEOUT_MS);

  it("records optional buyer name and phone when provided", async () => {
    const product = await makeProduct();

    const result = await completeSale({
      items: [{ productId: product.id, quantity: 1, soldPricePerUnit: 10 }],
      buyerName: "Jane Doe",
      buyerPhone: "555-0100",
      userId,
    });

    expect(result.buyerName).toBe("Jane Doe");
    expect(result.buyerPhone).toBe("555-0100");
  }, DB_TEST_TIMEOUT_MS);

  it("completes a sale for an ARCHIVED product with no status restriction", async () => {
    const product = await makeProduct({ status: "ARCHIVED", currentQuantity: 4 });

    const result = await completeSale({
      items: [{ productId: product.id, quantity: 1, soldPricePerUnit: 10 }],
      userId,
    });

    expect(result.items).toHaveLength(1);
    const [updated] = await db.select().from(products).where(eq(products.id, product.id));
    expect(updated.currentQuantity).toBe(3);
  }, DB_TEST_TIMEOUT_MS);

  it("rejects the WHOLE multi-line sale when any one line has insufficient stock, rolling back all lines", async () => {
    const productA = await makeProduct({ currentQuantity: 10 });
    const productB = await makeProduct({ currentQuantity: 1 });

    await expect(
      completeSale({
        items: [
          { productId: productA.id, quantity: 2, soldPricePerUnit: 5 },
          { productId: productB.id, quantity: 5, soldPricePerUnit: 5 }, // exceeds stock of 1
        ],
        userId,
      })
    ).rejects.toBeInstanceOf(InsufficientInventoryError);

    // Line A must NOT have been decremented even though it was valid on its own —
    // the whole transaction rolled back.
    const [updatedA] = await db.select().from(products).where(eq(products.id, productA.id));
    expect(updatedA.currentQuantity).toBe(10);

    const salesCount = await db.select().from(sales).where(eq(sales.soldBy, userId));
    expect(salesCount).toHaveLength(0);
  }, DB_TEST_TIMEOUT_MS);

  it("rejects the WHOLE sale when two lines for the SAME product exceed combined stock, leaving currentQuantity unchanged", async () => {
    const product = await makeProduct({ currentQuantity: 5 });

    await expect(
      completeSale({
        items: [
          { productId: product.id, quantity: 3, soldPricePerUnit: 5 },
          { productId: product.id, quantity: 4, soldPricePerUnit: 5 }, // 3 + 4 = 7 > 5 available
        ],
        userId,
      })
    ).rejects.toBeInstanceOf(InsufficientInventoryError);

    const [updated] = await db.select().from(products).where(eq(products.id, product.id));
    expect(updated.currentQuantity).toBe(5);

    const salesCount = await db.select().from(sales).where(eq(sales.soldBy, userId));
    expect(salesCount).toHaveLength(0);
  }, DB_TEST_TIMEOUT_MS);

  it("completes a sale with two lines for the SAME product, decrementing by the combined total", async () => {
    const product = await makeProduct({ currentQuantity: 10, costPrice: "4.00" });

    const result = await completeSale({
      items: [
        { productId: product.id, quantity: 2, soldPricePerUnit: 12 },
        { productId: product.id, quantity: 3, soldPricePerUnit: 15 },
      ],
      userId,
    });

    expect(result.items).toHaveLength(2);

    const [updated] = await db.select().from(products).where(eq(products.id, product.id));
    expect(updated.currentQuantity).toBe(5); // 10 - (2 + 3) = 5

    const txns = await db
      .select()
      .from(inventoryTransactions)
      .where(eq(inventoryTransactions.productId, product.id));
    expect(txns).toHaveLength(2);
  }, DB_TEST_TIMEOUT_MS);

  it("throws ProductNotFoundError for an unknown productId", async () => {
    await expect(
      completeSale({
        items: [{ productId: "00000000-0000-0000-0000-000000000000", quantity: 1, soldPricePerUnit: 10 }],
        userId,
      })
    ).rejects.toBeInstanceOf(ProductNotFoundError);
  }, DB_TEST_TIMEOUT_MS);

  it("generates strictly increasing sale numbers across sequential calls", async () => {
    const product = await makeProduct({ currentQuantity: 10 });

    const first = await completeSale({
      items: [{ productId: product.id, quantity: 1, soldPricePerUnit: 10 }],
      userId,
    });
    const second = await completeSale({
      items: [{ productId: product.id, quantity: 1, soldPricePerUnit: 10 }],
      userId,
    });

    const firstNum = Number(first.saleNumber.replace("SALE-", ""));
    const secondNum = Number(second.saleNumber.replace("SALE-", ""));
    expect(secondNum).toBeGreaterThan(firstNum);
  }, DB_TEST_TIMEOUT_MS);
});
