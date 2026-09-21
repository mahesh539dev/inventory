import { db } from "@/lib/db/client";
import { products } from "@/lib/db/schema";
import { and, eq, ilike, or, count } from "drizzle-orm";

export type ProductRow = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;

export async function findProductBySku(sku: string): Promise<ProductRow | undefined> {
  const [row] = await db.select().from(products).where(eq(products.sku, sku)).limit(1);
  return row;
}

export async function findProductById(id: string): Promise<ProductRow | undefined> {
  const [row] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return row;
}

export type PublicProductView = {
  productName: string;
  sellingPrice: string | null;
  productImage: string | null;
};

export async function findPublicProductView(
  publicIdentifier: string
): Promise<PublicProductView | undefined> {
  const [row] = await db
    .select({
      productName: products.productName,
      sellingPrice: products.sellingPrice,
      productImage: products.productImage,
    })
    .from(products)
    .where(eq(products.publicIdentifier, publicIdentifier))
    .limit(1);
  return row;
}

export async function findProductByPublicIdentifier(
  publicIdentifier: string
): Promise<ProductRow | undefined> {
  const [row] = await db
    .select()
    .from(products)
    .where(eq(products.publicIdentifier, publicIdentifier))
    .limit(1);
  return row;
}

export async function regeneratePublicIdentifier(
  id: string,
  newIdentifier: string
): Promise<ProductRow> {
  const [row] = await db
    .update(products)
    .set({ publicIdentifier: newIdentifier, updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning();
  return row;
}

export async function insertProduct(data: NewProduct): Promise<ProductRow> {
  const [row] = await db.insert(products).values(data).returning();
  return row;
}

export async function updateProduct(id: string, data: Partial<NewProduct>): Promise<ProductRow> {
  const [row] = await db
    .update(products)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning();
  return row;
}

export async function archiveProduct(id: string): Promise<ProductRow> {
  const [row] = await db
    .update(products)
    .set({ status: "ARCHIVED", updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning();
  return row;
}

type ListParams = {
  search?: string;
  categoryId?: string;
  status?: "ACTIVE" | "ARCHIVED";
  limit: number;
  offset: number;
};

function buildFilters(params: Pick<ListParams, "search" | "categoryId" | "status">) {
  const filters = [eq(products.status, params.status ?? "ACTIVE")];

  if (params.categoryId) {
    filters.push(eq(products.categoryId, params.categoryId));
  }

  if (params.search && params.search.trim().length > 0) {
    const term = `%${params.search.trim()}%`;
    const searchFilter = or(ilike(products.sku, term), ilike(products.productName, term));
    if (searchFilter) filters.push(searchFilter);
  }

  return and(...filters);
}

export async function listProducts(params: ListParams): Promise<ProductRow[]> {
  return db
    .select()
    .from(products)
    .where(buildFilters(params))
    .orderBy(products.productName)
    .limit(params.limit)
    .offset(params.offset);
}

export async function countProducts(
  params: Pick<ListParams, "search" | "categoryId" | "status">
): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(products)
    .where(buildFilters(params));
  return value;
}
