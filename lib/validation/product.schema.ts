import { z } from "zod";

export function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

const moneyString = z
  .string()
  .refine((val) => val.trim().length > 0, { message: "Required" })
  .refine((val) => !Number.isNaN(Number(val)), { message: "Must be a number" })
  .refine((val) => Number(val) >= 0, { message: "Must be zero or greater" });

const optionalMoneyString = z
  .string()
  .transform((val) => (val.trim().length === 0 ? null : val))
  .nullable()
  .refine((val) => val === null || !Number.isNaN(Number(val)), { message: "Must be a number" })
  .refine((val) => val === null || Number(val) >= 0, { message: "Must be zero or greater" });

const quantityString = z
  .string()
  .refine((val) => val.trim().length > 0, { message: "Required" })
  .refine((val) => Number.isInteger(Number(val)), { message: "Must be a whole number" })
  .refine((val) => Number(val) >= 0, { message: "Must be zero or greater" });

const productFields = {
  productName: z.string().trim().min(1, "Product name is required").max(255),
  categoryName: z.string().trim().max(255).optional().default(""),
  description: z.string().trim().max(5000).optional().default(""),
  originalPrice: moneyString,
  costPrice: moneyString,
  sellingPrice: optionalMoneyString,
  currentQuantity: quantityString,
  supplier: z.string().trim().max(255).optional().default(""),
  location: z.string().trim().max(255).optional().default(""),
  notes: z.string().trim().max(5000).optional().default(""),
};

export const createProductSchema = z.object({
  sku: z.string().trim().min(1, "SKU is required").max(64).transform(normalizeSku),
  ...productFields,
});

export const updateProductSchema = z.object({
  ...productFields,
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
