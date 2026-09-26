// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ReportsDateRangeFilter } from "@/components/reports/ReportsDateRangeFilter";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReportsDateRangeFilter", () => {
  it("renders from/to date inputs and a groupBy select pre-filled with defaults", () => {
    render(<ReportsDateRangeFilter defaultFrom="2026-01-01" defaultTo="2026-01-31" defaultGroupBy="product" />);
    expect(screen.getByLabelText(/from/i)).toHaveValue("2026-01-01");
    expect(screen.getByLabelText(/to/i)).toHaveValue("2026-01-31");
    expect(screen.getByLabelText(/group by/i)).toHaveValue("product");
  });

  it("navigates with updated from/to params on change", () => {
    render(<ReportsDateRangeFilter defaultFrom="2026-01-01" defaultTo="2026-01-31" defaultGroupBy="product" />);
    fireEvent.change(screen.getByLabelText(/from/i), { target: { value: "2026-02-01" } });
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("from=2026-02-01"));
  });

  it("navigates with the groupBy param on change", () => {
    render(<ReportsDateRangeFilter defaultFrom="2026-01-01" defaultTo="2026-01-31" defaultGroupBy="product" />);
    fireEvent.change(screen.getByLabelText(/group by/i), { target: { value: "category" } });
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("groupBy=category"));
  });
});
