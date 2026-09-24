// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

let capturedOnDecode: ((text: string) => void) | null = null;
let scannerMounted = false;

vi.mock("@/components/scan/QrScanner", () => ({
  QrScanner: ({ onDecode }: { onDecode: (text: string) => void }) => {
    capturedOnDecode = onDecode;
    scannerMounted = true;
    return <div data-testid="qr-scanner-stub" />;
  },
}));

let capturedOnSelect: ((product: unknown) => void) | null = null;
vi.mock("@/components/sell/ProductSearch", () => ({
  ProductSearch: ({ onSelect }: { onSelect: (product: unknown) => void }) => {
    capturedOnSelect = onSelect;
    return <div data-testid="product-search-stub" />;
  },
}));

vi.mock("@/lib/actions/sale.actions", () => ({
  lookupProductForSale: vi.fn(),
  completeSaleAction: vi.fn(),
}));

import { lookupProductForSale, completeSaleAction } from "@/lib/actions/sale.actions";
import SellPage from "@/app/(app)/sell/page";

const productA = {
  id: "prod-1",
  productName: "Widget",
  sku: "SKU-A",
  sellingPrice: "10.00",
  currentQuantity: 5,
};

describe("SellPage", () => {
  beforeEach(() => {
    pushMock.mockReset();
    vi.mocked(lookupProductForSale).mockReset();
    vi.mocked(completeSaleAction).mockReset();
    capturedOnDecode = null;
    capturedOnSelect = null;
    scannerMounted = false;
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the scanner and product search in the cart-building view", () => {
    render(<SellPage />);

    expect(screen.getByTestId("qr-scanner-stub")).toBeInTheDocument();
    expect(screen.getByTestId("product-search-stub")).toBeInTheDocument();
    expect(scannerMounted).toBe(true);
  });

  it("adding a product via scan creates a cart line", async () => {
    vi.mocked(lookupProductForSale).mockResolvedValue(productA);
    render(<SellPage />);

    capturedOnDecode!("https://example.com/p/abc123");

    await waitFor(() => expect(screen.getByText("Widget")).toBeInTheDocument());
  });

  it("scanning the same product twice increments quantity instead of duplicating the line", async () => {
    vi.mocked(lookupProductForSale).mockResolvedValue(productA);
    render(<SellPage />);

    capturedOnDecode!("https://example.com/p/abc123");
    await waitFor(() => expect(screen.getByText("Widget")).toBeInTheDocument());

    capturedOnDecode!("https://example.com/p/abc123");

    await waitFor(() => expect(screen.getAllByText("Widget")).toHaveLength(1));
    expect(screen.getByText("2")).toBeInTheDocument(); // quantity stepper display
  });

  it("adding a product via search also increments an existing line for the same product", async () => {
    vi.mocked(lookupProductForSale).mockResolvedValue(productA);
    render(<SellPage />);

    capturedOnDecode!("https://example.com/p/abc123");
    await waitFor(() => expect(screen.getByText("Widget")).toBeInTheDocument());

    capturedOnSelect!(productA);

    await waitFor(() => expect(screen.getAllByText("Widget")).toHaveLength(1));
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("Checkout is disabled when the cart is empty", () => {
    render(<SellPage />);
    expect(screen.getByRole("button", { name: /checkout/i })).toBeDisabled();
  });

  it("moving to checkout unmounts the QrScanner", async () => {
    vi.mocked(lookupProductForSale).mockResolvedValue(productA);
    render(<SellPage />);

    capturedOnDecode!("https://example.com/p/abc123");
    await waitFor(() => expect(screen.getByText("Widget")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /checkout/i }));

    await waitFor(() => expect(screen.queryByTestId("qr-scanner-stub")).not.toBeInTheDocument());
  });

  it("confirming a sale calls completeSaleAction and navigates to the sale detail page", async () => {
    vi.mocked(lookupProductForSale).mockResolvedValue(productA);
    vi.mocked(completeSaleAction).mockResolvedValue({ saleId: "sale-1", saleNumber: "SALE-000001" });
    render(<SellPage />);

    capturedOnDecode!("https://example.com/p/abc123");
    await waitFor(() => expect(screen.getByText("Widget")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /checkout/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /confirm sale/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /confirm sale/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/sales/sale-1"));
    expect(completeSaleAction).toHaveBeenCalledWith({
      items: [{ productId: "prod-1", quantity: 1, soldPricePerUnit: 10 }],
      buyerName: undefined,
      buyerPhone: undefined,
    });
  });

  it("returns to the cart-building view with cart intact when checkout fails", async () => {
    vi.mocked(lookupProductForSale).mockResolvedValue(productA);
    vi.mocked(completeSaleAction).mockRejectedValue(new Error("Insufficient inventory for product prod-1"));
    render(<SellPage />);

    capturedOnDecode!("https://example.com/p/abc123");
    await waitFor(() => expect(screen.getByText("Widget")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /checkout/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /confirm sale/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /confirm sale/i }));

    await waitFor(() => expect(screen.getByText(/insufficient inventory/i)).toBeInTheDocument());
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByText("Widget")).toBeInTheDocument(); // cart line still present
  });

  it("ignores a second checkout confirm fired while the first is still resolving", async () => {
    vi.mocked(lookupProductForSale).mockResolvedValue(productA);
    let resolveFirst!: (value: { saleId: string; saleNumber: string }) => void;
    vi.mocked(completeSaleAction).mockImplementation(
      () => new Promise((resolve) => { resolveFirst = resolve; })
    );
    render(<SellPage />);

    capturedOnDecode!("https://example.com/p/abc123");
    await waitFor(() => expect(screen.getByText("Widget")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /checkout/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /confirm sale/i })).toBeInTheDocument());

    const confirmButton = screen.getByRole("button", { name: /confirm sale/i });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    expect(completeSaleAction).toHaveBeenCalledTimes(1);

    resolveFirst({ saleId: "sale-1", saleNumber: "SALE-000001" });
    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
  });
});
