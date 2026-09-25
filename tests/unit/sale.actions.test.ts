import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/guards", () => ({
  requireUser: vi.fn(),
}));

vi.mock("@/lib/repositories/product.repo", () => ({
  findProductByPublicIdentifier: vi.fn(),
  findProductBySku: vi.fn(),
  listProducts: vi.fn(),
}));

vi.mock("@/lib/services/sale.service", () => ({
  completeSale: vi.fn(),
  InsufficientInventoryError: class InsufficientInventoryError extends Error {
    constructor(
      public readonly productId: string,
      public readonly requested: number,
      public readonly available: number
    ) {
      super(`Insufficient inventory for product ${productId}: requested ${requested}, only ${available} available`);
      this.name = "InsufficientInventoryError";
    }
  },
}));

vi.mock("@/lib/services/product.service", () => ({
  ProductNotFoundError: class ProductNotFoundError extends Error {
    constructor(public readonly productId: string) {
      super(`Product not found: ${productId}`);
      this.name = "ProductNotFoundError";
    }
  },
}));

import { requireUser } from "@/lib/auth/guards";
import { findProductByPublicIdentifier, findProductBySku, listProducts } from "@/lib/repositories/product.repo";
import { completeSale } from "@/lib/services/sale.service";
import { InsufficientInventoryError } from "@/lib/services/sale.service";
import { ProductNotFoundError } from "@/lib/services/product.service";
import { lookupProductForSale, completeSaleAction } from "@/lib/actions/sale.actions";
import { searchProductsForSale } from "@/lib/actions/product-search.actions";

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

    const result = await completeSaleAction({ items: [] });

    expect(result.ok).toBe(false);
    expect(completeSale).not.toHaveBeenCalled();
  });

  it("validates input before calling completeSale, rejecting a zero/negative sold price", async () => {
    vi.mocked(requireUser).mockResolvedValue(sessionUser);

    const result = await completeSaleAction({
      items: [{ productId: "prod-1", quantity: 1, soldPricePerUnit: 0 }],
    });

    expect(result.ok).toBe(false);
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
    expect(result).toEqual({ ok: true, saleId: "sale-1", saleNumber: "SALE-000001" });
  });

  it("returns an ok:false result with structured data when completeSale throws InsufficientInventoryError", async () => {
    vi.mocked(requireUser).mockResolvedValue(sessionUser);
    const productId = "11111111-1111-4111-8111-111111111111";
    vi.mocked(completeSale).mockRejectedValue(
      new InsufficientInventoryError(productId, 5, 2)
    );

    const result = await completeSaleAction({
      items: [{ productId, quantity: 5, soldPricePerUnit: 10 }],
    });

    expect(result).toEqual({
      ok: false,
      error: `Insufficient inventory for product ${productId}: requested 5, only 2 available`,
      productId,
      available: 2,
    });
  });

  it("returns an ok:false result with the productId when completeSale throws ProductNotFoundError", async () => {
    vi.mocked(requireUser).mockResolvedValue(sessionUser);
    const productId = "11111111-1111-4111-8111-111111111111";
    vi.mocked(completeSale).mockRejectedValue(new ProductNotFoundError(productId));

    const result = await completeSaleAction({
      items: [{ productId, quantity: 1, soldPricePerUnit: 10 }],
    });

    expect(result).toEqual({
      ok: false,
      error: `Product not found: ${productId}`,
      productId,
    });
  });

  it("re-throws genuinely unexpected errors from completeSale", async () => {
    vi.mocked(requireUser).mockResolvedValue(sessionUser);
    vi.mocked(completeSale).mockRejectedValue(new Error("DB connection lost"));

    await expect(
      completeSaleAction({
        items: [{ productId: "11111111-1111-4111-8111-111111111111", quantity: 1, soldPricePerUnit: 10 }],
      })
    ).rejects.toThrow("DB connection lost");
  });
});

describe("searchProductsForSale", () => {
  beforeEach(() => {
    vi.mocked(requireUser).mockReset();
    vi.mocked(listProducts).mockReset();
  });

  it("requires authentication", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("not authenticated"));

    await expect(searchProductsForSale("widget")).rejects.toThrow("not authenticated");
    expect(listProducts).not.toHaveBeenCalled();
  });

  it("searches across all statuses (archived products are sellable) and shapes results", async () => {
    vi.mocked(requireUser).mockResolvedValue(sessionUser);
    vi.mocked(listProducts).mockResolvedValue([
      {
        id: "prod-1",
        productName: "Widget A",
        sku: "SKU-A",
        sellingPrice: "9.99",
        currentQuantity: 5,
        status: "ACTIVE",
      },
      {
        id: "prod-2",
        productName: "Widget B",
        sku: "SKU-B",
        sellingPrice: "12.00",
        currentQuantity: 0,
        status: "ARCHIVED",
      },
    ] as never);

    const results = await searchProductsForSale("widget");

    expect(listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ search: "widget", status: undefined })
    );
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      id: "prod-1",
      productName: "Widget A",
      sku: "SKU-A",
      sellingPrice: "9.99",
      currentQuantity: 5,
      status: "ACTIVE",
    });
  });

  it("returns an empty array for a blank query without calling listProducts", async () => {
    vi.mocked(requireUser).mockResolvedValue(sessionUser);

    const results = await searchProductsForSale("   ");

    expect(results).toEqual([]);
    expect(listProducts).not.toHaveBeenCalled();
  });
});
