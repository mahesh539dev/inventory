// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SellCart } from "@/components/sell/SellCart";

const lines = [
  { productId: "prod-1", productName: "Widget", sku: "SKU-A", quantity: 2, soldPricePerUnit: 10, knownStock: 5 },
  { productId: "prod-2", productName: "Gadget", sku: "SKU-B", quantity: 1, soldPricePerUnit: 20, knownStock: 3 },
];

describe("SellCart", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows an empty-cart message when there are no lines", () => {
    render(<SellCart lines={[]} onQuantityChange={vi.fn()} onPriceChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText(/scan or search a product/i)).toBeInTheDocument();
  });

  it("renders one row per line with the correct running total", () => {
    render(<SellCart lines={lines} onQuantityChange={vi.fn()} onPriceChange={vi.fn()} onRemove={vi.fn()} />);

    expect(screen.getByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("Gadget")).toBeInTheDocument();
    // 2 * 10 + 1 * 20 = 40
    expect(screen.getByText("$40.00")).toBeInTheDocument();
  });

  it("shows a stock warning when quantity exceeds knownStock", () => {
    const overStockLines = [
      { productId: "prod-1", productName: "Widget", sku: "SKU-A", quantity: 9, soldPricePerUnit: 10, knownStock: 5 },
    ];
    render(<SellCart lines={overStockLines} onQuantityChange={vi.fn()} onPriceChange={vi.fn()} onRemove={vi.fn()} />);

    expect(screen.getByText(/only 5 in stock/i)).toBeInTheDocument();
  });

  it("calls onQuantityChange when the stepper is used", () => {
    const onQuantityChange = vi.fn();
    render(<SellCart lines={lines} onQuantityChange={onQuantityChange} onPriceChange={vi.fn()} onRemove={vi.fn()} />);

    fireEvent.click(screen.getAllByRole("button", { name: "+" })[0]);

    expect(onQuantityChange).toHaveBeenCalledWith("prod-1", 3);
  });

  it("removes the line when the stepper is decremented below 1", () => {
    const onRemove = vi.fn();
    const singleQtyLine = [
      { productId: "prod-1", productName: "Widget", sku: "SKU-A", quantity: 1, soldPricePerUnit: 10, knownStock: 5 },
    ];
    render(<SellCart lines={singleQtyLine} onQuantityChange={vi.fn()} onPriceChange={vi.fn()} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole("button", { name: "−" }));

    expect(onRemove).toHaveBeenCalledWith("prod-1");
  });

  it("calls onPriceChange when the price input changes", () => {
    const onPriceChange = vi.fn();
    render(<SellCart lines={lines} onQuantityChange={vi.fn()} onPriceChange={onPriceChange} onRemove={vi.fn()} />);

    const priceInputs = screen.getAllByLabelText(/sold price/i);
    fireEvent.change(priceInputs[0], { target: { value: "15" } });

    expect(onPriceChange).toHaveBeenCalledWith("prod-1", 15);
  });

  it("calls onRemove when the remove button is clicked", () => {
    const onRemove = vi.fn();
    render(<SellCart lines={lines} onQuantityChange={vi.fn()} onPriceChange={vi.fn()} onRemove={onRemove} />);

    fireEvent.click(screen.getAllByRole("button", { name: /remove/i })[1]);

    expect(onRemove).toHaveBeenCalledWith("prod-2");
  });
});
