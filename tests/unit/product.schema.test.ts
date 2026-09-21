import { describe, it, expect } from "vitest";
import { normalizeSku, createProductSchema } from "@/lib/validation/product.schema";

describe("normalizeSku", () => {
  it("trims and uppercases", () => {
    expect(normalizeSku("  shoe-001  ")).toBe("SHOE-001");
  });

  it("uppercases mixed case", () => {
    expect(normalizeSku("AbC-123")).toBe("ABC-123");
  });
});

describe("createProductSchema", () => {
  it("accepts valid product input", () => {
    const result = createProductSchema.safeParse({
      productName: "Nike Shoes",
      sku: "shoe-001",
      categoryName: "Shoes",
      description: "",
      originalPrice: "5000",
      costPrice: "2500",
      sellingPrice: "",
      currentQuantity: "5",
      supplier: "",
      location: "",
      notes: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sku).toBe("SHOE-001");
      expect(result.data.sellingPrice).toBeNull();
    }
  });

  it("rejects a missing product name", () => {
    const result = createProductSchema.safeParse({
      productName: "",
      sku: "SHOE-001",
      categoryName: "",
      description: "",
      originalPrice: "5000",
      costPrice: "2500",
      sellingPrice: "",
      currentQuantity: "5",
      supplier: "",
      location: "",
      notes: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative cost price", () => {
    const result = createProductSchema.safeParse({
      productName: "Nike Shoes",
      sku: "SHOE-001",
      categoryName: "",
      description: "",
      originalPrice: "5000",
      costPrice: "-1",
      sellingPrice: "",
      currentQuantity: "5",
      supplier: "",
      location: "",
      notes: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative initial quantity", () => {
    const result = createProductSchema.safeParse({
      productName: "Nike Shoes",
      sku: "SHOE-001",
      categoryName: "",
      description: "",
      originalPrice: "5000",
      costPrice: "2500",
      sellingPrice: "",
      currentQuantity: "-1",
      supplier: "",
      location: "",
      notes: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts an explicit selling price and coerces it", () => {
    const result = createProductSchema.safeParse({
      productName: "Nike Shoes",
      sku: "SHOE-001",
      categoryName: "",
      description: "",
      originalPrice: "5000",
      costPrice: "2500",
      sellingPrice: "4999",
      currentQuantity: "5",
      supplier: "",
      location: "",
      notes: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sellingPrice).toBe("4999");
    }
  });
});
