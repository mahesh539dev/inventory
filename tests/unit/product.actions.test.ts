import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/guards", () => ({
  requireAdmin: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/lib/services/product.service", () => ({
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  archiveProduct: vi.fn(),
  DuplicateSkuError: class DuplicateSkuError extends Error {},
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { requireAdmin } from "@/lib/auth/guards";
import { createProduct, DuplicateSkuError } from "@/lib/services/product.service";
import { createProductAction } from "@/lib/actions/product.actions";

function buildFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const defaults: Record<string, string> = {
    productName: "Nike Shoes",
    sku: "SHOE-001",
    categoryName: "Shoes",
    description: "",
    originalPrice: "5000",
    costPrice: "2500",
    sellingPrice: "",
    currentQuantity: "5",
    supplier: "",
    location: "",
    notes: "",
  };
  for (const [key, value] of Object.entries({ ...defaults, ...overrides })) {
    fd.set(key, value);
  }
  return fd;
}

describe("createProductAction", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset();
    vi.mocked(createProduct).mockReset();
  });

  it("requires admin before doing anything else", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("Forbidden: admin role required"));

    await expect(createProductAction(undefined, buildFormData())).rejects.toThrow("Forbidden");
    expect(createProduct).not.toHaveBeenCalled();
  });

  it("returns a field error when validation fails", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: "1", role: "ADMIN", email: "a@example.com" });

    const result = await createProductAction(undefined, buildFormData({ productName: "" }));

    expect(result?.error).toBeDefined();
    expect(createProduct).not.toHaveBeenCalled();
  });

  it("returns a duplicate SKU error from the service", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: "1", role: "ADMIN", email: "a@example.com" });
    vi.mocked(createProduct).mockRejectedValue(new DuplicateSkuError("SKU already exists: SHOE-001"));

    const result = await createProductAction(undefined, buildFormData());

    expect(result?.error).toContain("SHOE-001");
  });
});
