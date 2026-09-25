import { db } from "@/lib/db/client";
import { sales, saleItems, products } from "@/lib/db/schema";
import { eq, desc, count, asc, inArray } from "drizzle-orm";
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
): Promise<(SaleRow & { items: (SaleItemRow & { productName: string; sku: string })[] }) | undefined> {
  const [sale] = await db.select().from(sales).where(eq(sales.id, id)).limit(1);
  if (!sale) return undefined;

  const items = await db
    .select()
    .from(saleItems)
    .where(eq(saleItems.saleId, id))
    .orderBy(asc(saleItems.id));

  const productIds = [...new Set(items.map((item) => item.productId))];
  const productRows = productIds.length
    ? await db
        .select({ id: products.id, productName: products.productName, sku: products.sku })
        .from(products)
        .where(inArray(products.id, productIds))
    : [];
  const productById = new Map(productRows.map((p) => [p.id, p]));

  const itemsWithProduct = items.map((item) => {
    const product = productById.get(item.productId);
    return {
      ...item,
      productName: product?.productName ?? "Unknown product",
      sku: product?.sku ?? "—",
    };
  });

  return { ...sale, items: itemsWithProduct };
}
