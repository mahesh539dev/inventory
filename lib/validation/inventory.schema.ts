import { z } from "zod";

const signedNonZeroInteger = z
  .string()
  .refine((val) => val.trim().length > 0, { message: "Required" })
  .refine((val) => Number.isInteger(Number(val)), { message: "Must be a whole number" })
  .refine((val) => Number(val) !== 0, { message: "Adjustment cannot be zero" })
  .transform((val) => Number(val));

export const adjustInventorySchema = z.object({
  quantityDelta: signedNonZeroInteger,
  type: z.enum(["PURCHASE", "ADJUSTMENT", "DAMAGE", "OTHER"]),
  notes: z.string().trim().min(1, "A reason is required").max(1000),
});

export type AdjustInventoryInput = z.infer<typeof adjustInventorySchema>;
