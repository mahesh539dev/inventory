import { z } from "zod";

export const cartLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive("Quantity must be at least 1"),
  soldPricePerUnit: z.number().positive("Sold price must be greater than zero"),
});

export const completeSaleSchema = z.object({
  items: z.array(cartLineSchema).min(1, "Cart must have at least one item"),
  buyerName: z.string().trim().max(255).optional(),
  buyerPhone: z.string().trim().max(50).optional(),
});

export type CartLineInput = z.infer<typeof cartLineSchema>;
export type CompleteSaleInput = z.infer<typeof completeSaleSchema>;
