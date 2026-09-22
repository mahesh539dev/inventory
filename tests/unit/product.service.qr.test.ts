import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/repositories/product.repo", () => ({
  findProductById: vi.fn(),
  regeneratePublicIdentifier: vi.fn(),
}));

import { findProductById, regeneratePublicIdentifier } from "@/lib/repositories/product.repo";
import { regenerateProductQr, ProductNotFoundError } from "@/lib/services/product.service";

describe("regenerateProductQr", () => {
  beforeEach(() => {
    vi.mocked(findProductById).mockReset();
    vi.mocked(regeneratePublicIdentifier).mockReset();
  });

  it("throws ProductNotFoundError when the product does not exist", async () => {
    vi.mocked(findProductById).mockResolvedValue(undefined);

    await expect(regenerateProductQr("missing-id")).rejects.toThrow(ProductNotFoundError);
    expect(regeneratePublicIdentifier).not.toHaveBeenCalled();
  });

  it("assigns a new 10-character identifier when the product exists", async () => {
    vi.mocked(findProductById).mockResolvedValue({ id: "prod-1", publicIdentifier: "old-id" } as never);
    vi.mocked(regeneratePublicIdentifier).mockImplementation(async (id, newIdentifier) => ({
      id,
      publicIdentifier: newIdentifier,
    } as never));

    const result = await regenerateProductQr("prod-1");

    expect(regeneratePublicIdentifier).toHaveBeenCalledTimes(1);
    const [calledId, calledIdentifier] = vi.mocked(regeneratePublicIdentifier).mock.calls[0];
    expect(calledId).toBe("prod-1");
    expect(calledIdentifier).not.toBe("old-id");
    expect(typeof calledIdentifier).toBe("string");
    expect(calledIdentifier.length).toBeGreaterThanOrEqual(10);
    expect(result.publicIdentifier).toBe(calledIdentifier);
  });
});
