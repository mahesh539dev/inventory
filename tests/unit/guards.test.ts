import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

import { getSessionUser } from "@/lib/auth/session";
import { requireUser, requireAdmin } from "@/lib/auth/guards";

describe("requireAdmin", () => {
  it("throws Forbidden for a USER role", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      id: "1",
      role: "USER",
      email: "u@example.com",
    });
    await expect(requireAdmin()).rejects.toThrow("Forbidden");
  });

  it("returns the user for an ADMIN role", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      id: "1",
      role: "ADMIN",
      email: "a@example.com",
    });
    await expect(requireAdmin()).resolves.toMatchObject({ role: "ADMIN" });
  });
});

describe("requireUser", () => {
  it("redirects when there is no session", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    await expect(requireUser()).rejects.toThrow("REDIRECT");
  });
});
