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
// stays permanently false (see the dedicated test below) — this component no
// longer toggles it. The real QrScanner's own repeat-decode dedup (its
// `lastDecodedRef`, reset only when `paused` transitions true->false) is
// intentionally never exercised by the page anymore; see
// components/scan/QrScanner.tsx and task-8-report.md for why toggling it
// caused a runaway add-loop.

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

  it("scanning the same product again after the cooldown window adds a second unit", async () => {
    // Proves the cooldown-elapsed path: a deliberate re-scan of the same
    // product's code (code physically moved away and re-presented, or
    // enough time has simply passed) is treated as a new scan and adds
    // another unit, calling lookupProductForSale again.
    //
    // Uses vi.useFakeTimers() with a real Date.now() shim disabled — instead
    // we control time via vi.setSystemTime, since the page's cooldown check
    // reads Date.now() directly (not setTimeout). RTL's waitFor() polls with
    // real timers internally, which stalls when fake timers are active, so
    // each awaited state change is driven explicitly through act() instead.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.mocked(lookupProductForSale).mockResolvedValue(productA);
      render(<SellPage />);

      await act(async () => {
        capturedOnDecode!("https://example.com/p/abc123");
      });
      expect(screen.getByText("Widget")).toBeInTheDocument();
      expect(screen.getByText("1")).toBeInTheDocument();

      // Advance past the cooldown window (2000ms) via the faked Date clock.
      vi.setSystemTime(Date.now() + 2100);

      await act(async () => {
        capturedOnDecode!("https://example.com/p/abc123");
      });

      expect(screen.getByText("2")).toBeInTheDocument();
      expect(lookupProductForSale).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("scanning the same product again immediately (within the cooldown window) is a no-op", async () => {
    // Proves the within-cooldown path: this is the test that would have
    // caught the runaway-add regression from the previous (reverted)
    // paused-toggle fix. The camera's continuous decode loop re-firing
    // onDecode for a code still in frame must NOT re-trigger a lookup or
    // increment the cart line.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.mocked(lookupProductForSale).mockResolvedValue(productA);
      render(<SellPage />);

      await act(async () => {
        capturedOnDecode!("https://example.com/p/abc123");
      });
      expect(screen.getByText("Widget")).toBeInTheDocument();
      expect(screen.getByText("1")).toBeInTheDocument();

      // Simulate the camera re-firing onDecode for the same still-in-frame
      // code a few times in quick succession, well within the cooldown.
      vi.setSystemTime(Date.now() + 100);
      await act(async () => {
        capturedOnDecode!("https://example.com/p/abc123");
      });
      vi.setSystemTime(Date.now() + 100);
      await act(async () => {
        capturedOnDecode!("https://example.com/p/abc123");
      });

      expect(lookupProductForSale).toHaveBeenCalledTimes(1);
      expect(screen.getByText("1")).toBeInTheDocument();
      expect(screen.queryByText("2")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
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
