// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/actions/product-search.actions", () => ({
  searchProductsForSale: vi.fn(),
}));

import { searchProductsForSale } from "@/lib/actions/product-search.actions";
import { ProductSearch } from "@/components/sell/ProductSearch";

describe("ProductSearch", () => {
  beforeEach(() => {
    vi.mocked(searchProductsForSale).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows nothing before any input", () => {
    render(<ProductSearch onSelect={vi.fn()} />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("shows two distinct results, disambiguated by SKU, for a query matching two products", async () => {
    vi.mocked(searchProductsForSale).mockResolvedValue([
      { id: "prod-1", productName: "Widget", sku: "SKU-A", sellingPrice: "9.99", currentQuantity: 5, status: "ACTIVE" },
      { id: "prod-2", productName: "Widget", sku: "SKU-B", sellingPrice: "12.00", currentQuantity: 2, status: "ACTIVE" },
    ]);

    render(<ProductSearch onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Widget" } });

    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    expect(screen.getByText("SKU-A")).toBeInTheDocument();
    expect(screen.getByText("SKU-B")).toBeInTheDocument();
  });

  it("calls onSelect with the specific tapped product, not just a name match", async () => {
    vi.mocked(searchProductsForSale).mockResolvedValue([
      { id: "prod-1", productName: "Widget", sku: "SKU-A", sellingPrice: "9.99", currentQuantity: 5, status: "ACTIVE" },
      { id: "prod-2", productName: "Widget", sku: "SKU-B", sellingPrice: "12.00", currentQuantity: 2, status: "ACTIVE" },
    ]);
    const onSelect = vi.fn();

    render(<ProductSearch onSelect={onSelect} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Widget" } });

    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    fireEvent.click(screen.getByText("SKU-B"));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "prod-2", sku: "SKU-B" })
    );
  });

  it("clears results when the query is cleared back to empty", async () => {
    vi.mocked(searchProductsForSale).mockResolvedValue([
      { id: "prod-1", productName: "Widget", sku: "SKU-A", sellingPrice: "9.99", currentQuantity: 5, status: "ACTIVE" },
    ]);

    render(<ProductSearch onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Widget" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });

    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });
});
