import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/guards", () => ({
  requireAdmin: vi.fn(),
}));

vi.mock("@/lib/services/inventory.service", () => ({
  adjustInventory: vi.fn(),
  InsufficientInventoryError: class InsufficientInventoryError extends Error {
    constructor(productId: string, attemptedQuantity: number) {
      super(`Adjustment would result in negative inventory for product ${productId} (would be ${attemptedQuantity})`);
    }
  },
}));

vi.mock("@/lib/services/product.service", () => ({
  ProductNotFoundError: class ProductNotFoundError extends Error {},
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
import { adjustInventory, InsufficientInventoryError } from "@/lib/services/inventory.service";
import { redirect } from "next/navigation";
import { adjustInventoryAction } from "@/lib/actions/inventory.actions";

function buildFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const defaults: Record<string, string> = {
    quantityDelta: "5",
    type: "PURCHASE",
    notes: "New stock",
  };
  for (const [key, value] of Object.entries({ ...defaults, ...overrides })) {
    fd.set(key, value);
  }
  return fd;
}

describe("adjustInventoryAction", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset();
    vi.mocked(adjustInventory).mockReset();
    vi.mocked(redirect).mockReset().mockImplementation(() => {
      throw new Error("REDIRECT");
    });
  });

  it("requires admin before doing anything else", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("Forbidden: admin role required"));

    await expect(adjustInventoryAction("prod-1", undefined, buildFormData())).rejects.toThrow(
      "Forbidden"
    );
    expect(adjustInventory).not.toHaveBeenCalled();
  });

  it("returns a field error when validation fails (missing reason)", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: "1", role: "ADMIN", email: "a@example.com" });

    const result = await adjustInventoryAction("prod-1", undefined, buildFormData({ notes: "" }));

    expect(result?.error).toBeDefined();
    expect(adjustInventory).not.toHaveBeenCalled();
  });

  it("maps InsufficientInventoryError to a field error, not a thrown exception", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: "1", role: "ADMIN", email: "a@example.com" });
    vi.mocked(adjustInventory).mockRejectedValue(
      new InsufficientInventoryError("prod-1", -999)
    );

    const result = await adjustInventoryAction("prod-1", undefined, buildFormData({ quantityDelta: "-999" }));

    expect(result?.error).toBeDefined();
  });

  it("calls adjustInventory with parsed input and redirects on success", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: "admin-1", role: "ADMIN", email: "a@example.com" });
    vi.mocked(adjustInventory).mockResolvedValue({ id: "prod-1" } as never);

    await expect(
      adjustInventoryAction("prod-1", undefined, buildFormData())
    ).rejects.toThrow("REDIRECT");

    expect(adjustInventory).toHaveBeenCalledWith({
      productId: "prod-1",
      quantityDelta: 5,
      type: "PURCHASE",
      notes: "New stock",
      userId: "admin-1",
    });
    expect(redirect).toHaveBeenCalledWith("/products/prod-1");
  });
});
