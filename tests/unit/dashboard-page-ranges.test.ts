import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth/guards", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "1", email: "test@example.com", role: "USER" }),
}));
vi.mock("@/lib/repositories/sale.repo", () => ({
  getSalesSummary: vi.fn(),
  listSales: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/repositories/inventory.repo", () => ({
  listLowStockProducts: vi.fn().mockResolvedValue([]),
}));

import { getTodayRange, getMonthToDateRange } from "@/app/(app)/dashboard/page";

describe("getTodayRange", () => {
  it("returns a range spanning midnight to midnight of the same calendar day", () => {
    const now = new Date("2026-01-15T14:30:00");
    const { from, to } = getTodayRange(now);
    expect(from.getDate()).toBe(15);
    expect(from.getHours()).toBe(0);
    expect(to.getDate()).toBe(15);
    expect(to.getHours()).toBe(23);
  });
});

describe("getMonthToDateRange", () => {
  it("returns a range from the 1st of the current month through now", () => {
    const now = new Date("2026-01-15T14:30:00");
    const { from, to } = getMonthToDateRange(now);
    expect(from.getDate()).toBe(1);
    expect(from.getMonth()).toBe(0);
    expect(to.getTime()).toBe(now.getTime());
  });
});
