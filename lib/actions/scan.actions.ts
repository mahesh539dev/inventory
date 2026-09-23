"use server";

import { requireUser } from "@/lib/auth/guards";
import {
  findProductByPublicIdentifier,
  findProductBySku,
} from "@/lib/repositories/product.repo";

export async function resolveProductForScan(input: {
  publicIdentifier?: string;
  sku?: string;
}): Promise<{ id: string } | null> {
  await requireUser();

  const hasIdentifier = Boolean(input.publicIdentifier);
  const hasSku = Boolean(input.sku);
  if (hasIdentifier === hasSku) {
    throw new Error("resolveProductForScan requires exactly one of publicIdentifier or sku");
  }

  const product = hasIdentifier
    ? await findProductByPublicIdentifier(input.publicIdentifier!)
    : await findProductBySku(input.sku!);

  return product ? { id: product.id } : null;
}
