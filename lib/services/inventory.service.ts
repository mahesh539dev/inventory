import { db } from "@/lib/db/client";
import { products } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { insertInventoryTransaction } from "@/lib/repositories/inventory.repo";
import { ProductNotFoundError } from "@/lib/services/product.service";
import type { ProductRow } from "@/lib/repositories/product.repo";

export class InsufficientInventoryError extends Error {
  constructor(productId: string, attemptedQuantity: number) {
    super(
      `Adjustment would result in negative inventory for product ${productId} (would be ${attemptedQuantity})`
    );
    this.name = "InsufficientInventoryError";
  }
}

export type AdjustInventoryInput = {
  productId: string;
  quantityDelta: number;
  type: "PURCHASE" | "ADJUSTMENT" | "DAMAGE" | "OTHER";
  notes: string;
  userId: string;
};

export async function adjustInventory(input: AdjustInventoryInput): Promise<ProductRow> {
  return db.transaction(async (tx) => {
    const [product] = await tx
      .select()
      .from(products)
      .where(eq(products.id, input.productId))
      .for("update");

    if (!product) {
      throw new ProductNotFoundError(input.productId);
    }

    const newQuantity = product.currentQuantity + input.quantityDelta;
    if (newQuantity < 0) {
      throw new InsufficientInventoryError(input.productId, newQuantity);
    }

    const [updated] = await tx
      .update(products)
      .set({ currentQuantity: newQuantity, updatedAt: new Date() })
      .where(eq(products.id, input.productId))
      .returning();

    // Pass `tx`, not the module `db`, so this insert is part of the SAME
    // transaction as the update above (see DbOrTx in inventory.repo.ts) —
    // if the transaction rolls back (e.g. a later error), this insert
    // must roll back with it, not land as an orphaned row.
    await insertInventoryTransaction(
      {
        productId: input.productId,
        type: input.type,
        quantity: input.quantityDelta,
        notes: input.notes,
        createdBy: input.userId,
      },
      tx
    );

    return updated;
  });
}
