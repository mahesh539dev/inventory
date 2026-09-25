import { db } from "@/lib/db/client";
import { sales, saleItems, products } from "@/lib/db/schema";
import { eq, desc, count, asc, inArray, and, gte, lte, or, ilike, type SQL } from "drizzle-orm";
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

export async function findSaleForUpdate(id: string, tx: DbOrTx): Promise<SaleRow | undefined> {
  const [row] = await tx.select().from(sales).where(eq(sales.id, id)).for("update");
  return row;
}

export async function findSaleItemsForUpdate(saleId: string, tx: DbOrTx): Promise<SaleItemRow[]> {
  return tx
    .select()
    .from(saleItems)
    .where(eq(saleItems.saleId, saleId))
    .orderBy(asc(saleItems.id))
    .for("update");
}

export async function updateSaleItemReturnedQuantity(
  saleItemId: string,
  newReturnedQuantity: number,
  tx: DbOrTx
): Promise<void> {
  await tx
    .update(saleItems)
    .set({ returnedQuantity: newReturnedQuantity })
    .where(eq(saleItems.id, saleItemId));
}

export async function updateSaleStatus(
  saleId: string,
  status: SaleRow["status"],
  tx: DbOrTx
): Promise<void> {
  await tx.update(sales).set({ status }).where(eq(sales.id, saleId));
}

export type ListSalesParams = {
  limit: number;
  offset: number;
  query?: string;
  dateFrom?: Date;
  dateTo?: Date;
  productId?: string;
  userId?: string;
  status?: SaleRow["status"];
};

function buildSalesFilters(params: Omit<ListSalesParams, "limit" | "offset">): SQL | undefined {
  const filters: SQL[] = [];

  if (params.status) filters.push(eq(sales.status, params.status));
  if (params.userId) filters.push(eq(sales.soldBy, params.userId));
  if (params.dateFrom) filters.push(gte(sales.soldAt, params.dateFrom));
  if (params.dateTo) filters.push(lte(sales.soldAt, params.dateTo));

  if (params.query && params.query.trim().length > 0) {
    const term = `%${params.query.trim()}%`;
    const queryFilter = or(
      ilike(sales.saleNumber, term),
      inArray(
        sales.id,
        db.select({ id: saleItems.saleId }).from(saleItems).innerJoin(products, eq(saleItems.productId, products.id)).where(ilike(products.sku, term))
      )
    );
    if (queryFilter) filters.push(queryFilter);
  }

  if (params.productId) {
    filters.push(
      inArray(
        sales.id,
        db.select({ id: saleItems.saleId }).from(saleItems).where(eq(saleItems.productId, params.productId))
      )
    );
  }

  return filters.length > 0 ? and(...filters) : undefined;
}

export async function listSales(params: ListSalesParams): Promise<SaleRow[]> {
  return db
    .select()
    .from(sales)
    .where(buildSalesFilters(params))
    .orderBy(desc(sales.soldAt))
    .limit(params.limit)
    .offset(params.offset);
}

export async function countSales(params: Omit<ListSalesParams, "limit" | "offset"> = {}): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(sales)
    .where(buildSalesFilters(params));
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
