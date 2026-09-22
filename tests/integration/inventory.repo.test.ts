import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db/client";
import { products, inventoryTransactions, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { insertProduct } from "@/lib/repositories/product.repo";
import {
  insertInventoryTransaction,
  listTransactionsByProduct,
  countTransactionsByProduct,
  countLowStockProducts,
  listLowStockProducts,
} from "@/lib/repositories/inventory.repo";

const TEST_SKU = "TEST-INV-REPO-001";
const LOW_STOCK_SKU = "TEST-INV-REPO-LOW-001";

describe("inventory.repo", () => {
  let productId: string;
  let lowStockProductId: string;
  let userId: string;

  beforeAll(async () => {
    const [existingUser] = await db.select({ id: users.id }).from(users).limit(1);
    if (!existingUser) throw new Error("No seeded user found — run seed script first");
    userId = existingUser.id;

    const inserted = await insertProduct({
      publicIdentifier: "test-inv-repo-pubid-001",
      sku: TEST_SKU,
      productName: "Inventory Repo Test Product",
      originalPrice: "100.00",
      costPrice: "50.00",
      currentQuantity: 10,
    });
    productId = inserted.id;

    const lowStockInserted = await insertProduct({
      publicIdentifier: "test-inv-repo-pubid-002",
      sku: LOW_STOCK_SKU,
      productName: "Inventory Repo Low Stock Test Product",
      originalPrice: "100.00",
      costPrice: "50.00",
      currentQuantity: 2,
    });
    lowStockProductId = lowStockInserted.id;
  });

  afterAll(async () => {
    await db.delete(inventoryTransactions).where(eq(inventoryTransactions.productId, productId));
    await db.delete(products).where(eq(products.sku, TEST_SKU));
    await db.delete(products).where(eq(products.sku, LOW_STOCK_SKU));
  });

  it("inserts and lists transactions for a product, newest first", async () => {
    const first = await insertInventoryTransaction({
      productId,
      type: "PURCHASE",
      quantity: 10,
      notes: "Initial stock",
      createdBy: userId,
    });
    expect(first.quantity).toBe(10);

    const second = await insertInventoryTransaction({
      productId,
      type: "ADJUSTMENT",
      quantity: -2,
      notes: "Damaged",
      createdBy: userId,
    });
    expect(second.quantity).toBe(-2);

    const list = await listTransactionsByProduct(productId, { limit: 10, offset: 0 });
    expect(list.length).toBe(2);
    expect(list[0].id).toBe(second.id); // newest first
    expect(list[1].id).toBe(first.id);

    const total = await countTransactionsByProduct(productId);
    expect(total).toBe(2);
  });

  it("counts and lists low-stock active products", async () => {
    const count = await countLowStockProducts(5);
    expect(count).toBeGreaterThanOrEqual(1);

    const list = await listLowStockProducts(5, { limit: 100, offset: 0 });
    expect(list.find((p) => p.id === lowStockProductId)).toBeDefined();
    expect(list.find((p) => p.id === productId)).toBeUndefined(); // quantity 10 > threshold 5
  });

  it("rolls back insertInventoryTransaction when passed a tx that later rolls back", async () => {
    // Regression guard for the DbOrTx parameter: an insert issued against a
    // transaction handle must actually be part of that transaction (and
    // therefore vanish on rollback), not silently land via a separate
    // connection. If this ever regresses to always using the module `db`,
    // this test fails because the row would still exist after rollback.
    const countBefore = await countTransactionsByProduct(productId);

    await expect(
      db.transaction(async (tx) => {
        await insertInventoryTransaction(
          {
            productId,
            type: "OTHER",
            quantity: 1,
            notes: "Should be rolled back",
            createdBy: userId,
          },
          tx
        );
        throw new Error("Force rollback");
      })
    ).rejects.toThrow("Force rollback");

    const countAfter = await countTransactionsByProduct(productId);
    expect(countAfter).toBe(countBefore);
  });
});
