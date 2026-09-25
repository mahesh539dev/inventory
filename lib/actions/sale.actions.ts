"use server";

import { requireUser } from "@/lib/auth/guards";
import { findProductByPublicIdentifier, findProductBySku } from "@/lib/repositories/product.repo";
import {
  completeSale as completeSaleService,
  InsufficientInventoryError,
  returnSaleItems,
  cancelSale,
  SaleNotFoundError,
  SaleNotCancellableError,
  InvalidReturnQuantityError,
} from "@/lib/services/sale.service";
import { ProductNotFoundError } from "@/lib/services/product.service";
import { completeSaleSchema } from "@/lib/validation/sale.schema";
import { returnSaleItemsSchema, cancelSaleSchema } from "@/lib/validation/return.schema";

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

export type CompleteSaleResult =
  | { ok: true; saleId: string; saleNumber: string }
  | { ok: false; error: string; productId?: string; available?: number };

export async function completeSaleAction(input: {
  items: { productId: string; quantity: number; soldPricePerUnit: number }[];
  buyerName?: string;
  buyerPhone?: string;
}): Promise<CompleteSaleResult> {
  const user = await requireUser();

  const parsed = completeSaleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid sale data" };
  }

  try {
    const sale = await completeSaleService({
      items: parsed.data.items,
      buyerName: parsed.data.buyerName,
      buyerPhone: parsed.data.buyerPhone,
      userId: user.id,
    });
    return { ok: true, saleId: sale.id, saleNumber: sale.saleNumber };
  } catch (error) {
    if (error instanceof InsufficientInventoryError) {
      return {
        ok: false,
        error: error.message,
        productId: error.productId,
        available: error.available,
      };
    }
    if (error instanceof ProductNotFoundError) {
      return { ok: false, error: error.message, productId: error.productId };
    }
    throw error;
  }
}

export type ReturnSaleItemsResult = { ok: true } | { ok: false; error: string };

export async function returnSaleItemsAction(input: {
  saleId: string;
  items: { saleItemId: string; quantity: number }[];
}): Promise<ReturnSaleItemsResult> {
  const user = await requireUser();

  const parsed = returnSaleItemsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid return data" };
  }

  try {
    await returnSaleItems({ saleId: parsed.data.saleId, userId: user.id, items: parsed.data.items });
    return { ok: true };
  } catch (error) {
    if (error instanceof InvalidReturnQuantityError) return { ok: false, error: error.message };
    if (error instanceof SaleNotFoundError) return { ok: false, error: error.message };
    if (error instanceof SaleNotCancellableError) return { ok: false, error: error.message };
    throw error;
  }
}

export type CancelSaleResult = { ok: true } | { ok: false; error: string };

export async function cancelSaleAction(input: { saleId: string }): Promise<CancelSaleResult> {
  const user = await requireUser();

  const parsed = cancelSaleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }

  try {
    await cancelSale({ saleId: parsed.data.saleId, userId: user.id });
    return { ok: true };
  } catch (error) {
    if (error instanceof SaleNotFoundError) return { ok: false, error: error.message };
    if (error instanceof SaleNotCancellableError) return { ok: false, error: error.message };
    throw error;
  }
}
