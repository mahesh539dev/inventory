// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { RecentSalesList } from "@/components/dashboard/RecentSalesList";
import type { SaleRow } from "@/lib/repositories/sale.repo";

afterEach(() => cleanup());

function makeSale(overrides: Partial<SaleRow> = {}): SaleRow {
  return {
    id: "sale-1",
    saleNumber: "SALE-000001",
    soldAt: new Date("2026-01-15T12:00:00Z"),
    soldBy: "user-1",
    totalAmount: "20.00",
    totalCost: "10.00",
    totalProfit: "10.00",
    status: "COMPLETED",
    notes: null,
    buyerName: null,
    buyerPhone: null,
    createdAt: new Date("2026-01-15T12:00:00Z"),
    ...overrides,
  };
}

describe("RecentSalesList", () => {
  it("renders each sale's number and links to its detail page", () => {
    render(<RecentSalesList sales={[makeSale()]} />);
    const link = screen.getByRole("link", { name: /SALE-000001/i });
    expect(link).toHaveAttribute("href", "/sales/sale-1");
  });

  it("renders a link to view all sales", () => {
    render(<RecentSalesList sales={[makeSale()]} />);
    expect(screen.getByRole("link", { name: /view all/i })).toHaveAttribute("href", "/sales");
  });

  it("renders an empty state when there are no recent sales", () => {
    render(<RecentSalesList sales={[]} />);
    expect(screen.getByText(/no sales yet/i)).toBeInTheDocument();
  });
});
