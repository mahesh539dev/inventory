// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

let capturedOnDecode: ((text: string) => void) | null = null;
let scannerMounted = false;
let capturedPausedValues: boolean[] = [];

vi.mock("@/components/scan/QrScanner", () => ({
  QrScanner: ({ onDecode, paused }: { onDecode: (text: string) => void; paused: boolean }) => {
    capturedOnDecode = onDecode;
    scannerMounted = true;
    capturedPausedValues.push(paused);
    return <div data-testid="qr-scanner-stub" data-paused={String(paused)} />;
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
    capturedPausedValues = [];
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
    // NOTE: this test calls capturedOnDecode! directly, bypassing the real
    // QrScanner's internal repeat-decode dedup entirely (the mock above has
    // no dedup logic of its own). It proves the page's cart-merge logic
    // (addOrIncrement) is correct once a decode DOES fire twice for the same
    // text, but it cannot prove the real QrScanner would ever fire onDecode
    // a second time for an unchanged code — that's what the `paused`-toggle
    // test below covers instead.
    vi.mocked(lookupProductForSale).mockResolvedValue(productA);
    render(<SellPage />);

    capturedOnDecode!("https://example.com/p/abc123");
    await waitFor(() => expect(screen.getByText("Widget")).toBeInTheDocument());

    capturedOnDecode!("https://example.com/p/abc123");

    await waitFor(() => expect(screen.getAllByText("Widget")).toHaveLength(1));
    expect(screen.getByText("2")).toBeInTheDocument(); // quantity stepper display
  });

  it("toggles the scanner's paused prop after a successful scan-add so its repeat-decode dedup resets", async () => {
    // The real QrScanner (components/scan/QrScanner.tsx) only clears its
    // internal "last decoded text" memory when its `paused` prop transitions
    // from true back to false. Since this test's mock has no dedup logic of
    // its own, it cannot exercise that real dedup behavior directly (see the
    // NOTE on the test above). Instead, it verifies the page's OWN
    // responsibility in the fix: that a successful add briefly toggles
    // `paused` true then false, which is what resets the real scanner's
    // dedup memory. Full end-to-end coverage of the scanner's dedup reset
    // would require an integration/e2e test against the real QrScanner
    // (with a real or fake camera/decoder), which is out of scope for this
    // mock-based unit suite.
    vi.mocked(lookupProductForSale).mockResolvedValue(productA);
    render(<SellPage />);

    expect(capturedPausedValues.at(-1)).toBe(false);

    await act(async () => {
      capturedOnDecode!("https://example.com/p/abc123");
    });
    await waitFor(() => expect(screen.getByText("Widget")).toBeInTheDocument());

    // paused must have gone true (to force the scanner's dedup-reset effect)
    // and then settled back to false so scanning continues to work.
    expect(capturedPausedValues).toContain(true);
    await waitFor(() => expect(capturedPausedValues.at(-1)).toBe(false));
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
    // Actually returned to the cart-building view, not just showing the
    // error while still on the checkout screen.
    expect(screen.getByTestId("qr-scanner-stub")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^checkout$/i })).toBeInTheDocument();
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
    // Fire both clicks inside a single act() so React cannot re-render
    // between them (which would flip `disabled={isPending}` to true and
    // make the second click a no-op for reasons unrelated to confirmingRef).
    // Using the raw DOM .click() avoids RTL's fireEvent.click() wrapping
    // each call in its own act(). This isolates the assertion to what the
    // confirmingRef synchronous guard specifically does.
    act(() => {
      confirmButton.click();
      confirmButton.click();
    });

    expect(completeSaleAction).toHaveBeenCalledTimes(1);

    resolveFirst({ saleId: "sale-1", saleNumber: "SALE-000001" });
    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
  });
});
