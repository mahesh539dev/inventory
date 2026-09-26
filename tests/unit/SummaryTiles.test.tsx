// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SummaryTiles } from "@/components/dashboard/SummaryTiles";
import type { SalesSummary } from "@/lib/repositories/sale.repo";

afterEach(() => cleanup());

const summary: SalesSummary = {
  saleCount: 4,
  unitsSold: 9,
  grossRevenue: "180.00",
  grossCost: "90.00",
  grossProfit: "90.00",
  returnedRevenue: "20.00",
  returnedCost: "10.00",
  returnedProfit: "10.00",
};

describe("SummaryTiles", () => {
  it("renders the label and gross figures", () => {
    render(<SummaryTiles label="Today" summary={summary} />);
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText(/180\.00/)).toBeInTheDocument();
    expect(screen.getByText("9", { exact: true })).toBeInTheDocument(); // units sold
  });

  it("renders a returns deduction line separate from the gross figure", () => {
    render(<SummaryTiles label="Today" summary={summary} />);
    expect(screen.getByText(/-\$?20\.00|−\$?20\.00/)).toBeInTheDocument();
  });

  it("renders zeroed tiles without error when summary has no sales", () => {
    const empty: SalesSummary = {
      saleCount: 0, unitsSold: 0,
      grossRevenue: "0", grossCost: "0", grossProfit: "0",
      returnedRevenue: "0", returnedCost: "0", returnedProfit: "0",
    };
    render(<SummaryTiles label="Today" summary={empty} />);
    expect(screen.getByText("Today")).toBeInTheDocument();
  });
});
