import { describe, it, expect } from "vitest";
import { adjustInventorySchema } from "@/lib/validation/inventory.schema";

describe("adjustInventorySchema", () => {
  it("accepts a positive adjustment with a reason", () => {
    const result = adjustInventorySchema.safeParse({
      quantityDelta: "5",
      type: "PURCHASE",
      notes: "New stock delivery",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.quantityDelta).toBe(5);
    }
  });

  it("accepts a negative adjustment with a reason", () => {
    const result = adjustInventorySchema.safeParse({
      quantityDelta: "-2",
      type: "DAMAGE",
      notes: "Water damage",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.quantityDelta).toBe(-2);
    }
  });

  it("rejects a zero delta", () => {
    const result = adjustInventorySchema.safeParse({
      quantityDelta: "0",
      type: "ADJUSTMENT",
      notes: "No change",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing reason", () => {
    const result = adjustInventorySchema.safeParse({
      quantityDelta: "5",
      type: "PURCHASE",
      notes: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer delta", () => {
    const result = adjustInventorySchema.safeParse({
      quantityDelta: "2.5",
      type: "PURCHASE",
      notes: "Bad input",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid type value", () => {
    const result = adjustInventorySchema.safeParse({
      quantityDelta: "5",
      type: "SALE",
      notes: "Should not be selectable manually",
    });
    expect(result.success).toBe(false);
  });
});
