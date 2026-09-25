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
// NOTE: capturedPausedValues is retained to assert QrScanner's `paused` prop
// stays permanently false. The real QrScanner now owns repeat-decode
// dedup itself via a time-based cooldown (see components/scan/QrScanner.tsx
// and tests/unit/QrScanner.test.tsx) — this mock intentionally has NO dedup
// logic of its own, so every capturedOnDecode!() call here reaches
// handleDecode directly, letting these page tests exercise handleDecode's
// own logic (parsing, lookup, resolvingRef re-entrancy) in isolation from
// QrScanner's internal timing.

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

  it("never toggles the scanner's paused prop — QrScanner is always unpaused", async () => {
    // QrScanner's `paused` prop must stay permanently false. Toggling it
    // true/false to reset QrScanner's internal repeat-decode dedup was the
    // previous (reverted) fix, and it caused a runaway add-loop: `paused`
    // does not pause the camera or decode loop at all, so flipping it back
    // to false just clears QrScanner's dedup memory, letting the SAME
    // in-frame code get decoded (and added) again on the very next camera
    // frame, repeatedly, for as long as the code stayed in view. See
    // components/scan/QrScanner.tsx and task-8-report.md.
    vi.mocked(lookupProductForSale).mockResolvedValue(productA);
    render(<SellPage />);

    expect(capturedPausedValues.at(-1)).toBe(false);

    await act(async () => {
      capturedOnDecode!("https://example.com/p/abc123");
    });
    await waitFor(() => expect(screen.getByText("Widget")).toBeInTheDocument());

    // paused must never have gone true at any point.
    expect(capturedPausedValues.every((value) => value === false)).toBe(true);
  });

  it("scanning the same product twice adds two units", async () => {
    // Proves the actual Phase 6 requirement end-to-end: scanning the same
    // product's QR code twice in a row adds two units to the cart. This no
    // longer needs fake timers or any cooldown simulation at the page
    // level — QrScanner itself is now the single place that dedups a
    // camera's rapid re-fire of the SAME physical scan (see
    // components/scan/QrScanner.tsx and its own tests). The mocked
    // QrScanner used here has no dedup logic, so firing capturedOnDecode!()
    // twice models two decodes QrScanner has already decided are genuine
    // (i.e. it already passed its own cooldown) — exactly what handleDecode
    // must handle correctly: process every decode it's given.
    vi.mocked(lookupProductForSale).mockResolvedValue(productA);
    render(<SellPage />);

    await act(async () => {
      capturedOnDecode!("https://example.com/p/abc123");
    });
    expect(screen.getByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();

    await act(async () => {
      capturedOnDecode!("https://example.com/p/abc123");
    });

    expect(screen.getByText("2")).toBeInTheDocument();
    expect(lookupProductForSale).toHaveBeenCalledTimes(2);
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
    vi.mocked(completeSaleAction).mockResolvedValue({
      ok: true,
      saleId: "sale-1",
      saleNumber: "SALE-000001",
    });
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

  it("returns to the cart-building view with cart intact when checkout fails with an expected domain error", async () => {
    vi.mocked(lookupProductForSale).mockResolvedValue(productA);
    vi.mocked(completeSaleAction).mockResolvedValue({
      ok: false,
      error: "Insufficient inventory for product prod-1: requested 1, only 0 available",
      productId: "prod-1",
      available: 0,
    });
    render(<SellPage />);

    capturedOnDecode!("https://example.com/p/abc123");
    await waitFor(() => expect(screen.getByText("Widget")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /checkout/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /confirm sale/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /confirm sale/i }));

    await waitFor(() => expect(screen.getByText(/insufficient inventory/i)).toBeInTheDocument());
    // Includes the failing line's product name so the user can tell which
    // line failed without seeing a raw UUID.
    expect(screen.getByText(/\(Widget\)/)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByText("Widget")).toBeInTheDocument(); // cart line still present
    // Actually returned to the cart-building view, not just showing the
    // error while still on the checkout screen.
    expect(screen.getByTestId("qr-scanner-stub")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^checkout$/i })).toBeInTheDocument();
  });

  it("returns to the cart-building view when checkout fails with a genuinely unexpected thrown error", async () => {
    // Proves the catch-block fallback still works for real thrown/rejected
    // errors (e.g. a network failure) distinct from the {ok:false} contract.
    vi.mocked(lookupProductForSale).mockResolvedValue(productA);
    vi.mocked(completeSaleAction).mockRejectedValue(new Error("Network error"));
    render(<SellPage />);

    capturedOnDecode!("https://example.com/p/abc123");
    await waitFor(() => expect(screen.getByText("Widget")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /checkout/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /confirm sale/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /confirm sale/i }));

    await waitFor(() => expect(screen.getByText("Network error")).toBeInTheDocument());
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByText("Widget")).toBeInTheDocument();
    expect(screen.getByTestId("qr-scanner-stub")).toBeInTheDocument();
  });

  it("ignores a second checkout confirm fired while the first is still resolving", async () => {
    vi.mocked(lookupProductForSale).mockResolvedValue(productA);
    let resolveFirst!: (value: { ok: true; saleId: string; saleNumber: string }) => void;
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

    resolveFirst({ ok: true, saleId: "sale-1", saleNumber: "SALE-000001" });
    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
  });

  it("disables Confirm Sale when a line has an invalid price, and re-enables it once fixed", async () => {
    vi.mocked(lookupProductForSale).mockResolvedValue(productA);
    render(<SellPage />);

    capturedOnDecode!("https://example.com/p/abc123");
    await waitFor(() => expect(screen.getByText("Widget")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /checkout/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /confirm sale/i })).toBeInTheDocument());

    const confirmButton = screen.getByRole("button", { name: /confirm sale/i });
    expect(confirmButton).not.toBeDisabled();

    const priceInput = screen.getByLabelText("Sold price");
    fireEvent.change(priceInput, { target: { value: "" } });

    await waitFor(() => expect(confirmButton).toBeDisabled());
    expect(screen.getByText(/fix the highlighted price\/quantity/i)).toBeInTheDocument();

    fireEvent.change(priceInput, { target: { value: "12.50" } });

    await waitFor(() => expect(confirmButton).not.toBeDisabled());
  });
});
