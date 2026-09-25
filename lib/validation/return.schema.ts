import { z } from "zod";

export const returnLineSchema = z.object({
  saleItemId: z.string().uuid(),
  quantity: z.number().int().positive("Quantity must be at least 1"),
});

export const returnSaleItemsSchema = z.object({
  saleId: z.string().uuid(),
  items: z.array(returnLineSchema).min(1, "Select at least one item to return"),
});

export const cancelSaleSchema = z.object({
  saleId: z.string().uuid(),
});

export type ReturnLineInput = z.infer<typeof returnLineSchema>;
export type ReturnSaleItemsInput = z.infer<typeof returnSaleItemsSchema>;
export type CancelSaleInput = z.infer<typeof cancelSaleSchema>;
