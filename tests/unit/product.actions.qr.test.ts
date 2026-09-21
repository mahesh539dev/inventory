import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/guards", () => ({
  requireAdmin: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/lib/services/product.service", () => ({
  regenerateProductQr: vi.fn(),
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
import { regenerateProductQr } from "@/lib/services/product.service";
import { redirect } from "next/navigation";
import { regenerateProductQrAction } from "@/lib/actions/product.actions";

describe("regenerateProductQrAction", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset();
    vi.mocked(regenerateProductQr).mockReset();
    vi.mocked(redirect).mockReset().mockImplementation(() => {
      throw new Error("REDIRECT");
    });
  });

  it("requires admin before regenerating", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("Forbidden: admin role required"));

    await expect(regenerateProductQrAction("prod-1")).rejects.toThrow("Forbidden");
    expect(regenerateProductQr).not.toHaveBeenCalled();
  });

  it("regenerates and redirects back to the product page", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: "admin-1", role: "ADMIN", email: "a@example.com" });
    vi.mocked(regenerateProductQr).mockResolvedValue({ id: "prod-1" } as never);

    await expect(regenerateProductQrAction("prod-1")).rejects.toThrow("REDIRECT");

    expect(regenerateProductQr).toHaveBeenCalledWith("prod-1");
    expect(redirect).toHaveBeenCalledWith("/products/prod-1");
  });
});
