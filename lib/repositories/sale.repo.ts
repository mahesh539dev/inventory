import { db } from "@/lib/db/client";
import { sales, saleItems } from "@/lib/db/schema";
import { eq, desc, count } from "drizzle-orm";
import type { DbOrTx } from "./inventory.repo";

export type SaleRow = typeof sales.$inferSelect;
export type NewSale = typeof sales.$inferInsert;
export type SaleItemRow = typeof saleItems.$inferSelect;
export type NewSaleItem = typeof saleItems.$inferInsert;

export async function insertSale(data: NewSale, executor: DbOrTx = db): Promise<SaleRow> {
  const [row] = await executor.insert(sales).values(data).returning();
  return row;
}

export async function insertSaleItems(
  data: NewSaleItem[],
  executor: DbOrTx = db
): Promise<SaleItemRow[]> {
  return executor.insert(saleItems).values(data).returning();
}

export async function listSales(params: { limit: number; offset: number }): Promise<SaleRow[]> {
  return db
    .select()
    .from(sales)
    .orderBy(desc(sales.soldAt))
    .limit(params.limit)
    .offset(params.offset);
}

export async function countSales(): Promise<number> {
  const [{ value }] = await db.select({ value: count() }).from(sales);
  return value;
}

export async function findSaleById(
  id: string
): Promise<(SaleRow & { items: SaleItemRow[] }) | undefined> {
  const [sale] = await db.select().from(sales).where(eq(sales.id, id)).limit(1);
  if (!sale) return undefined;

  const items = await db.select().from(saleItems).where(eq(saleItems.saleId, id));
  return { ...sale, items };
}
