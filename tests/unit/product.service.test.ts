import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/repositories/product.repo", () => ({
  findProductBySku: vi.fn(),
  insertProduct: vi.fn(),
  updateProduct: vi.fn(),
  archiveProduct: vi.fn(),
  findProductById: vi.fn(),
}));

vi.mock("@/lib/repositories/category.repo", () => ({
  findOrCreateCategory: vi.fn(),
}));

import {
  findProductBySku,
  insertProduct,
} from "@/lib/repositories/product.repo";
import { findOrCreateCategory } from "@/lib/repositories/category.repo";
import { createProduct, DuplicateSkuError } from "@/lib/services/product.service";
import type { CreateProductInput } from "@/lib/validation/product.schema";

const validInput: CreateProductInput = {
  sku: "SHOE-001",
  productName: "Nike Shoes",
  categoryName: "Shoes",
  description: "",
  originalPrice: "5000",
  costPrice: "2500",
  sellingPrice: null,
  currentQuantity: "5",
  supplier: "",
  location: "",
  notes: "",
};

describe("createProduct", () => {
  beforeEach(() => {
    vi.mocked(findProductBySku).mockReset();
    vi.mocked(insertProduct).mockReset();
    vi.mocked(findOrCreateCategory).mockReset();
  });

  it("throws DuplicateSkuError when the SKU already exists", async () => {
    vi.mocked(findProductBySku).mockResolvedValue({
      id: "existing-id",
      sku: "SHOE-001",
    } as never);

    await expect(createProduct(validInput)).rejects.toThrow(DuplicateSkuError);
    expect(insertProduct).not.toHaveBeenCalled();
  });

  it("creates a product with a generated publicIdentifier when the SKU is free", async () => {
    vi.mocked(findProductBySku).mockResolvedValue(undefined);
    vi.mocked(findOrCreateCategory).mockResolvedValue({ id: "cat-1", name: "Shoes" });
    vi.mocked(insertProduct).mockImplementation(async (data) => ({
      ...data,
      id: "new-id",
    } as never));

    const result = await createProduct(validInput);

    expect(insertProduct).toHaveBeenCalledTimes(1);
    const insertedData = vi.mocked(insertProduct).mock.calls[0][0];
    expect(insertedData.sku).toBe("SHOE-001");
    expect(insertedData.categoryId).toBe("cat-1");
    expect(typeof insertedData.publicIdentifier).toBe("string");
    expect(insertedData.publicIdentifier!.length).toBeGreaterThanOrEqual(10);
    expect(result.id).toBe("new-id");
  });

  it("skips category lookup when categoryName is empty", async () => {
    vi.mocked(findProductBySku).mockResolvedValue(undefined);
    vi.mocked(insertProduct).mockImplementation(async (data) => ({
      ...data,
      id: "new-id",
    } as never));

    await createProduct({ ...validInput, categoryName: "" });

    expect(findOrCreateCategory).not.toHaveBeenCalled();
  });
});
