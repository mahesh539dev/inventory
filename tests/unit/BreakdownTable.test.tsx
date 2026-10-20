// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { BreakdownTable } from "@/components/reports/BreakdownTable";
import type { SalesBreakdownRow } from "@/lib/repositories/sale.repo";

afterEach(() => cleanup());

const rows: SalesBreakdownRow[] = [
  { id: "p1", name: "Widget", unitsSold: 5, revenue: "50.00", cost: "20.00", profit: "30.00" },
];

describe("BreakdownTable", () => {
  it("renders a row per product with units/revenue/cost/profit", () => {
    render(<BreakdownTable rows={rows} groupBy="product" />);
    expect(screen.getByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText(/50\.00/)).toBeInTheDocument();
  });

  it("labels the first column header by groupBy", () => {
    render(<BreakdownTable rows={rows} groupBy="category" />);
    expect(screen.getByText(/category/i)).toBeInTheDocument();
  });

  it("renders an empty state when there are no rows", () => {
    render(<BreakdownTable rows={[]} groupBy="product" />);
    expect(screen.getByText(/no sales in this range/i)).toBeInTheDocument();
  });
});
