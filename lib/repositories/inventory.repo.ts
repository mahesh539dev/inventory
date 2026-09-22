import { db } from "@/lib/db/client";
import { inventoryTransactions, products } from "@/lib/db/schema";
import { and, eq, lte, desc, count } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/lib/db/schema";
import type { ProductRow } from "./product.repo";

export type InventoryTransactionRow = typeof inventoryTransactions.$inferSelect;
export type NewInventoryTransaction = typeof inventoryTransactions.$inferInsert;

// Either the module-level `db` client or a `tx` handle from `db.transaction()`.
// A write against `db` from inside someone else's `tx` callback runs on a
// DIFFERENT pooled connection and does NOT participate in that transaction —
// callers that need atomicity across this insert and other writes (Task 3)
// must pass their `tx` handle through explicitly.
export type DbOrTx = NodePgDatabase<typeof schema> | Parameters<Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]>[0];

export async function insertInventoryTransaction(
  data: NewInventoryTransaction,
  executor: DbOrTx = db
): Promise<InventoryTransactionRow> {
  const [row] = await executor.insert(inventoryTransactions).values(data).returning();
  return row;
}

export async function listTransactionsByProduct(
  productId: string,
  params: { limit: number; offset: number }
): Promise<InventoryTransactionRow[]> {
  return db
    .select()
    .from(inventoryTransactions)
    .where(eq(inventoryTransactions.productId, productId))
    .orderBy(desc(inventoryTransactions.createdAt))
    .limit(params.limit)
    .offset(params.offset);
}

export async function countTransactionsByProduct(productId: string): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(inventoryTransactions)
    .where(eq(inventoryTransactions.productId, productId));
  return value;
}

function lowStockFilter(threshold: number) {
  return and(lte(products.currentQuantity, threshold), eq(products.status, "ACTIVE"));
}

export async function countLowStockProducts(threshold: number): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(products)
    .where(lowStockFilter(threshold));
  return value;
}

export async function listLowStockProducts(
  threshold: number,
  params: { limit: number; offset: number }
): Promise<ProductRow[]> {
  return db
    .select()
    .from(products)
    .where(lowStockFilter(threshold))
    .orderBy(products.currentQuantity)
    .limit(params.limit)
    .offset(params.offset);
}
