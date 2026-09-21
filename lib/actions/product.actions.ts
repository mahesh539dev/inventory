"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { createProductSchema, updateProductSchema } from "@/lib/validation/product.schema";
import {
  createProduct,
  updateProduct as serviceUpdateProduct,
  archiveProduct as serviceArchiveProduct,
  DuplicateSkuError,
} from "@/lib/services/product.service";

export type ProductFormState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

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

export async function createProductAction(
  _prevState: ProductFormState,
  formData: FormData
): Promise<ProductFormState> {
  await requireAdmin();

  const parsed = createProductSchema.safeParse(formDataToRecord(formData));
  if (!parsed.success) {
    return {
      error: "Please fix the errors below",
      fieldErrors: firstFieldError(parsed.error.flatten().fieldErrors),
    };
  }

  let productId: string;
  try {
    const product = await createProduct(parsed.data);
    productId = product.id;
  } catch (error) {
    if (error instanceof DuplicateSkuError) {
      return { error: error.message, fieldErrors: { sku: error.message } };
    }
    throw error;
  }

  revalidatePath("/products");
  redirect(`/products/${productId}`);
}

export async function updateProductAction(
  id: string,
  _prevState: ProductFormState,
  formData: FormData
): Promise<ProductFormState> {
  await requireAdmin();

  const parsed = updateProductSchema.safeParse(formDataToRecord(formData));
  if (!parsed.success) {
    return {
      error: "Please fix the errors below",
      fieldErrors: firstFieldError(parsed.error.flatten().fieldErrors),
    };
  }

  await serviceUpdateProduct(id, parsed.data);

  revalidatePath("/products");
  revalidatePath(`/products/${id}`);
  redirect(`/products/${id}`);
}

export async function archiveProductAction(id: string): Promise<void> {
  await requireAdmin();
  await serviceArchiveProduct(id);
  revalidatePath("/products");
  redirect("/products");
}
