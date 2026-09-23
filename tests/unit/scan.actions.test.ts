import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/guards", () => ({
  requireUser: vi.fn(),
}));

vi.mock("@/lib/repositories/product.repo", () => ({
  findProductByPublicIdentifier: vi.fn(),
  findProductBySku: vi.fn(),
}));

import { requireUser } from "@/lib/auth/guards";
import {
  findProductByPublicIdentifier,
  findProductBySku,
} from "@/lib/repositories/product.repo";
import { resolveProductForScan } from "@/lib/actions/scan.actions";

describe("resolveProductForScan", () => {
  beforeEach(() => {
    vi.mocked(requireUser).mockReset();
    vi.mocked(findProductByPublicIdentifier).mockReset();
    vi.mocked(findProductBySku).mockReset();
  });

  it("requires an authenticated user before doing anything else", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("not authenticated"));

    await expect(
      resolveProductForScan({ publicIdentifier: "abc123" })
    ).rejects.toThrow("not authenticated");
    expect(findProductByPublicIdentifier).not.toHaveBeenCalled();
  });

  it("resolves a product by publicIdentifier", async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: "user-1", role: "USER", email: "a@example.com" });
    vi.mocked(findProductByPublicIdentifier).mockResolvedValue({ id: "prod-1" } as never);

    const result = await resolveProductForScan({ publicIdentifier: "abc123" });

    expect(result).toEqual({ id: "prod-1" });
    expect(findProductByPublicIdentifier).toHaveBeenCalledWith("abc123");
    expect(findProductBySku).not.toHaveBeenCalled();
  });

  it("resolves a product by sku", async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: "user-1", role: "USER", email: "a@example.com" });
    vi.mocked(findProductBySku).mockResolvedValue({ id: "prod-2" } as never);

    const result = await resolveProductForScan({ sku: "SKU-123" });

    expect(result).toEqual({ id: "prod-2" });
    expect(findProductBySku).toHaveBeenCalledWith("SKU-123");
    expect(findProductByPublicIdentifier).not.toHaveBeenCalled();
  });

  it("returns null when publicIdentifier matches nothing", async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: "user-1", role: "USER", email: "a@example.com" });
    vi.mocked(findProductByPublicIdentifier).mockResolvedValue(undefined);

    const result = await resolveProductForScan({ publicIdentifier: "does-not-exist" });

    expect(result).toBeNull();
  });

  it("returns null when sku matches nothing", async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: "user-1", role: "USER", email: "a@example.com" });
    vi.mocked(findProductBySku).mockResolvedValue(undefined);

    const result = await resolveProductForScan({ sku: "NOPE" });

    expect(result).toBeNull();
  });

  it("throws if called with neither publicIdentifier nor sku", async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: "user-1", role: "USER", email: "a@example.com" });

    await expect(resolveProductForScan({})).rejects.toThrow(
      "resolveProductForScan requires exactly one of publicIdentifier or sku"
    );
  });

  it("throws if called with both publicIdentifier and sku", async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: "user-1", role: "USER", email: "a@example.com" });

    await expect(
      resolveProductForScan({ publicIdentifier: "abc123", sku: "SKU-123" })
    ).rejects.toThrow("resolveProductForScan requires exactly one of publicIdentifier or sku");
  });
});
