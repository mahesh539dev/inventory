"use server";

import { requireUser } from "@/lib/auth/guards";
import { listProducts } from "@/lib/repositories/product.repo";

export type ProductSearchResult = {
  id: string;
  productName: string;
  sku: string;
  sellingPrice: string | null;
  currentQuantity: number;
  status: "ACTIVE" | "ARCHIVED";
};

const SEARCH_RESULT_LIMIT = 10;

export async function searchProductsForSale(query: string): Promise<ProductSearchResult[]> {
  await requireUser();

  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const results = await listProducts({
    search: trimmed,
    status: undefined,
    limit: SEARCH_RESULT_LIMIT,
    offset: 0,
  });

  return results.map((product) => ({
    id: product.id,
    productName: product.productName,
    sku: product.sku,
    sellingPrice: product.sellingPrice,
    currentQuantity: product.currentQuantity,
    status: product.status,
  }));
}
