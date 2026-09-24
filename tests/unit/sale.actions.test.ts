import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/guards", () => ({
  requireUser: vi.fn(),
}));

vi.mock("@/lib/repositories/product.repo", () => ({
  findProductByPublicIdentifier: vi.fn(),
  findProductBySku: vi.fn(),
}));

vi.mock("@/lib/services/sale.service", () => ({
  completeSale: vi.fn(),
  InsufficientInventoryError: class InsufficientInventoryError extends Error {},
}));

import { requireUser } from "@/lib/auth/guards";
import { findProductByPublicIdentifier, findProductBySku } from "@/lib/repositories/product.repo";
import { completeSale } from "@/lib/services/sale.service";
import { lookupProductForSale, completeSaleAction } from "@/lib/actions/sale.actions";

const sessionUser = { id: "user-1", role: "USER" as const, email: "a@example.com" };

describe("lookupProductForSale", () => {
  beforeEach(() => {
    vi.mocked(requireUser).mockReset();
    vi.mocked(findProductByPublicIdentifier).mockReset();
    vi.mocked(findProductBySku).mockReset();
  });

  it("requires authentication before doing anything else", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("not authenticated"));

    await expect(lookupProductForSale({ sku: "SKU-1" })).rejects.toThrow("not authenticated");
    expect(findProductBySku).not.toHaveBeenCalled();
  });

  it("resolves by publicIdentifier and shapes the result for a cart line", async () => {
    vi.mocked(requireUser).mockResolvedValue(sessionUser);
    vi.mocked(findProductByPublicIdentifier).mockResolvedValue({
      id: "prod-1",
      productName: "Widget",
      sku: "SKU-1",
      sellingPrice: "9.99",
      currentQuantity: 20,
    } as never);

    const result = await lookupProductForSale({ publicIdentifier: "abc123" });

    expect(result).toEqual({
      id: "prod-1",
      productName: "Widget",
      sku: "SKU-1",
      sellingPrice: "9.99",
      currentQuantity: 20,
    });
  });

  it("resolves by sku", async () => {
    vi.mocked(requireUser).mockResolvedValue(sessionUser);
    vi.mocked(findProductBySku).mockResolvedValue({
      id: "prod-2",
      productName: "Gadget",
      sku: "SKU-2",
      sellingPrice: null,
      currentQuantity: 5,
    } as never);

    const result = await lookupProductForSale({ sku: "SKU-2" });

    expect(result?.id).toBe("prod-2");
    expect(findProductByPublicIdentifier).not.toHaveBeenCalled();
  });

  it("returns null when nothing matches", async () => {
    vi.mocked(requireUser).mockResolvedValue(sessionUser);
    vi.mocked(findProductBySku).mockResolvedValue(undefined);

    const result = await lookupProductForSale({ sku: "NOPE" });

    expect(result).toBeNull();
  });

  it("throws if called with neither publicIdentifier nor sku", async () => {
    vi.mocked(requireUser).mockResolvedValue(sessionUser);

    await expect(lookupProductForSale({})).rejects.toThrow(
      "lookupProductForSale requires exactly one of publicIdentifier or sku"
    );
  });
});

describe("completeSaleAction", () => {
  beforeEach(() => {
    vi.mocked(requireUser).mockReset();
    vi.mocked(completeSale).mockReset();
  });

  it("requires authentication before calling completeSale", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("not authenticated"));

    await expect(
      completeSaleAction({ items: [{ productId: "prod-1", quantity: 1, soldPricePerUnit: 5 }] })
    ).rejects.toThrow("not authenticated");
    expect(completeSale).not.toHaveBeenCalled();
  });

  it("validates input before calling completeSale, rejecting an empty cart", async () => {
    vi.mocked(requireUser).mockResolvedValue(sessionUser);

    await expect(completeSaleAction({ items: [] })).rejects.toThrow();
    expect(completeSale).not.toHaveBeenCalled();
  });

  it("validates input before calling completeSale, rejecting a zero/negative sold price", async () => {
    vi.mocked(requireUser).mockResolvedValue(sessionUser);

    await expect(
      completeSaleAction({ items: [{ productId: "prod-1", quantity: 1, soldPricePerUnit: 0 }] })
    ).rejects.toThrow();
    expect(completeSale).not.toHaveBeenCalled();
  });

  it("passes the authenticated userId through to completeSale and shapes the return value", async () => {
    vi.mocked(requireUser).mockResolvedValue(sessionUser);
    vi.mocked(completeSale).mockResolvedValue({
      id: "sale-1",
      saleNumber: "SALE-000001",
      items: [],
    } as never);

    const productId = "11111111-1111-4111-8111-111111111111";
    const result = await completeSaleAction({
      items: [{ productId, quantity: 2, soldPricePerUnit: 10 }],
      buyerName: "Jane",
    });

    expect(completeSale).toHaveBeenCalledWith({
      items: [{ productId, quantity: 2, soldPricePerUnit: 10 }],
      buyerName: "Jane",
      buyerPhone: undefined,
      userId: "user-1",
    });
    expect(result).toEqual({ saleId: "sale-1", saleNumber: "SALE-000001" });
  });
});
