"use server";

import { requireUser } from "@/lib/auth/guards";
import { findProductByPublicIdentifier, findProductBySku } from "@/lib/repositories/product.repo";
import { completeSale as completeSaleService } from "@/lib/services/sale.service";
import { completeSaleSchema } from "@/lib/validation/sale.schema";

export type ProductForSale = {
  id: string;
  productName: string;
  sku: string;
  sellingPrice: string | null;
  currentQuantity: number;
};

export async function lookupProductForSale(input: {
  publicIdentifier?: string;
  sku?: string;
}): Promise<ProductForSale | null> {
  await requireUser();

  const hasIdentifier = Boolean(input.publicIdentifier);
  const hasSku = Boolean(input.sku);
  if (hasIdentifier === hasSku) {
    throw new Error("lookupProductForSale requires exactly one of publicIdentifier or sku");
  }

  const product = hasIdentifier
    ? await findProductByPublicIdentifier(input.publicIdentifier!)
    : await findProductBySku(input.sku!);

  if (!product) return null;

  return {
    id: product.id,
    productName: product.productName,
    sku: product.sku,
    sellingPrice: product.sellingPrice,
    currentQuantity: product.currentQuantity,
  };
}

export async function completeSaleAction(input: {
  items: { productId: string; quantity: number; soldPricePerUnit: number }[];
  buyerName?: string;
  buyerPhone?: string;
}): Promise<{ saleId: string; saleNumber: string }> {
  const user = await requireUser();

  const parsed = completeSaleSchema.parse(input);

  const sale = await completeSaleService({
    items: parsed.items,
    buyerName: parsed.buyerName,
    buyerPhone: parsed.buyerPhone,
    userId: user.id,
  });

  return { saleId: sale.id, saleNumber: sale.saleNumber };
}
