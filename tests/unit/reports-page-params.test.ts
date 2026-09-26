import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth/guards", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "1", email: "test@example.com", role: "USER" }),
}));
vi.mock("@/lib/repositories/sale.repo", () => ({
  getSalesSummary: vi.fn(),
  getSalesBreakdownByProduct: vi.fn().mockResolvedValue([]),
  getSalesBreakdownByCategory: vi.fn().mockResolvedValue([]),
}));

import { parseReportRange, parseGroupBy } from "@/app/(app)/reports/page";

describe("parseReportRange", () => {
  const now = new Date("2026-01-15T12:00:00");

  it("parses valid from/to ISO date strings", () => {
    const { from, to } = parseReportRange({ from: "2026-01-01", to: "2026-01-10" }, now);
    expect(from.getDate()).toBe(1);
    expect(to.getDate()).toBe(10);
  });

  it("defaults to the current calendar month when params are missing", () => {
    const { from, to } = parseReportRange({}, now);
    expect(from.getDate()).toBe(1);
    expect(from.getMonth()).toBe(0);
    expect(to.getMonth()).toBe(0);
  });

  it("defaults to the current calendar month when params are unparseable", () => {
    const { from, to } = parseReportRange({ from: "not-a-date", to: "also-not-a-date" }, now);
    expect(from.getDate()).toBe(1);
    expect(to.getMonth()).toBe(0);
  });

  it("swaps from and to silently when from is after to", () => {
    const { from, to } = parseReportRange({ from: "2026-01-20", to: "2026-01-05" }, now);
    expect(from.getDate()).toBe(5);
    expect(to.getDate()).toBe(20);
  });
});

describe("parseGroupBy", () => {
  it("returns 'product' for undefined or unrecognized values", () => {
    expect(parseGroupBy(undefined)).toBe("product");
    expect(parseGroupBy("nonsense")).toBe("product");
  });

  it("returns 'category' only when explicitly requested", () => {
    expect(parseGroupBy("category")).toBe("category");
  });
});
