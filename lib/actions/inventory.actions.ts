"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { adjustInventorySchema } from "@/lib/validation/inventory.schema";
import { adjustInventory, InsufficientInventoryError } from "@/lib/services/inventory.service";
import { ProductNotFoundError } from "@/lib/services/product.service";

export type InventoryFormState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

function formDataToRecord(formData: FormData): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") record[key] = value;
  }
  return record;
}

function firstFieldError(fieldErrors: Record<string, string[] | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, messages] of Object.entries(fieldErrors)) {
    if (messages && messages.length > 0) result[key] = messages[0];
  }
  return result;
}

export async function adjustInventoryAction(
  productId: string,
  _prevState: InventoryFormState,
  formData: FormData
): Promise<InventoryFormState> {
  const user = await requireAdmin();

  const parsed = adjustInventorySchema.safeParse(formDataToRecord(formData));
  if (!parsed.success) {
    return {
      error: "Please fix the errors below",
      fieldErrors: firstFieldError(parsed.error.flatten().fieldErrors),
    };
  }

  try {
    await adjustInventory({
      productId,
      quantityDelta: parsed.data.quantityDelta,
      type: parsed.data.type,
      notes: parsed.data.notes,
      userId: user.id,
    });
  } catch (error) {
    if (error instanceof InsufficientInventoryError) {
      return { error: error.message, fieldErrors: { quantityDelta: error.message } };
    }
    if (error instanceof ProductNotFoundError) {
      return { error: "This product no longer exists." };
    }
    throw error;
  }

  revalidatePath(`/products/${productId}`);
  revalidatePath(`/products/${productId}/history`);
  redirect(`/products/${productId}`);
}
