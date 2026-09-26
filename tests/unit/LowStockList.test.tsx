// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LowStockList } from "@/components/dashboard/LowStockList";
import type { ProductRow } from "@/lib/repositories/product.repo";

afterEach(() => cleanup());

function makeProduct(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: "prod-1",
    publicIdentifier: "abc123",
    sku: "SKU-1",
    productName: "Widget",
    categoryId: null,
    description: null,
    productImage: null,
    originalPrice: "10.00",
    costPrice: "5.00",
    sellingPrice: "10.00",
    currentQuantity: 2,
    supplier: null,
    location: null,
    status: "ACTIVE",
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("LowStockList", () => {
  it("renders each product's name, quantity, and links to its detail page", () => {
    render(<LowStockList products={[makeProduct()]} />);
    expect(screen.getByText("Widget")).toBeInTheDocument();
    expect(screen.getByText(/2/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /widget/i })).toHaveAttribute("href", "/products/prod-1");
  });

  it("renders an empty state when nothing is low on stock", () => {
    render(<LowStockList products={[]} />);
    expect(screen.getByText(/nothing.*low|no low.stock/i)).toBeInTheDocument();
  });
});
