"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { QrScanner } from "@/components/scan/QrScanner";
import { parseQrPayload } from "@/lib/scan/parse-qr-payload";
import { ProductSearch } from "@/components/sell/ProductSearch";
import { SellCart, type CartLine } from "@/components/sell/SellCart";
import {
  lookupProductForSale,
  completeSaleAction,
  type ProductForSale,
} from "@/lib/actions/sale.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const NOT_RECOGNIZED_ERROR = "Not a recognized product QR code";
const NOT_FOUND_ERROR = "Product not found — it may have been removed or its QR code regenerated.";

type View = "cart" | "checkout";

export default function SellPage() {
  const router = useRouter();
  const [view, setView] = useState<View>("cart");
  const [lines, setLines] = useState<CartLine[]>([]);
  const [addError, setAddError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [buyerName, setBuyerName] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [isPending, startTransition] = useTransition();
  // Briefly toggled true/false after a successful scan-add so the QrScanner's
  // internal last-decoded-text memory (which only resets when its `paused`
  // prop transitions back to false) is cleared, letting the same QR code be
  // recognized again on an immediate repeat scan of the same product.
  const [scannerPaused, setScannerPaused] = useState(false);

  // Synchronous re-entrancy guards. `isPending` from useTransition only
  // updates on React's next render, so it cannot reliably block a second
  // trigger that fires synchronously (or in the same microtask) before that
  // render happens. Each guard below is checked-and-set at the very top of
  // its handler, and cleared once the corresponding async call settles
  // (success or failure), mirroring the reviewed fix in app/(app)/scan/page.tsx.
  const resolvingRef = useRef(false);
  const confirmingRef = useRef(false);

  function addOrIncrement(product: ProductForSale) {
    setLines((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (existing) {
        return current.map((line) =>
          line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line
        );
      }
      return [
        ...current,
        {
          productId: product.id,
          productName: product.productName,
          sku: product.sku,
          quantity: 1,
          soldPricePerUnit: product.sellingPrice ? Number(product.sellingPrice) : 0,
          knownStock: product.currentQuantity,
        },
      ];
    });
  }

  async function handleDecode(text: string) {
    if (resolvingRef.current) return;

    const parsed = parseQrPayload(text);
    if (!parsed) {
      setAddError(NOT_RECOGNIZED_ERROR);
      return;
    }

    resolvingRef.current = true;
    setAddError(null);
    try {
      const product = await lookupProductForSale({ publicIdentifier: parsed.publicIdentifier });
      if (!product) {
        setAddError(NOT_FOUND_ERROR);
        return;
      }
      addOrIncrement(product);
      // Reset the scanner's repeat-decode dedup so scanning this same QR
      // code again immediately is recognized as a new add rather than
      // silently ignored.
      setScannerPaused(true);
      setTimeout(() => setScannerPaused(false), 0);
    } finally {
      resolvingRef.current = false;
    }
  }

  async function handleSearchSelect(product: ProductForSale) {
    if (resolvingRef.current) return;

    resolvingRef.current = true;
    setAddError(null);
    try {
      addOrIncrement(product);
    } finally {
      resolvingRef.current = false;
    }
  }

  function handleQuantityChange(productId: string, quantity: number) {
    setLines((current) =>
      current.map((line) => (line.productId === productId ? { ...line, quantity } : line))
    );
  }

  function handlePriceChange(productId: string, price: number) {
    setLines((current) =>
      current.map((line) => (line.productId === productId ? { ...line, soldPricePerUnit: price } : line))
    );
  }

  function handleRemove(productId: string) {
    setLines((current) => current.filter((line) => line.productId !== productId));
  }

  function handleConfirm() {
    // Guard "Confirm Sale" against a second tap landing while the first
    // completeSaleAction call is still in flight. isPending alone is not
    // safe here (async update), so a synchronous ref flag gates entry and
    // is cleared once the call settles either way.
    if (confirmingRef.current) return;
    confirmingRef.current = true;

    setCheckoutError(null);
    startTransition(async () => {
      try {
        const result = await completeSaleAction({
          items: lines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            soldPricePerUnit: line.soldPricePerUnit,
          })),
          buyerName: buyerName.trim() || undefined,
          buyerPhone: buyerPhone.trim() || undefined,
        });
        router.push(`/sales/${result.saleId}`);
        // Leave confirmingRef true on success: the page is navigating away
        // regardless, and Next.js navigation isn't necessarily instantaneous,
        // so clearing it here could re-enable "Confirm Sale" over the
        // still-populated cart before the page unmounts.
      } catch (error) {
        setCheckoutError(error instanceof Error ? error.message : "Failed to complete sale");
        setView("cart");
        confirmingRef.current = false;
      }
    });
  }

  if (view === "checkout") {
    return (
      <div className="mx-auto max-w-sm space-y-6 p-6">
        <h1 className="text-xl font-semibold">Confirm Sale</h1>

        <SellCart
          lines={lines}
          onQuantityChange={handleQuantityChange}
          onPriceChange={handlePriceChange}
          onRemove={handleRemove}
        />

        <div className="space-y-2">
          <Label htmlFor="buyer-name">Buyer name (optional)</Label>
          <Input id="buyer-name" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="buyer-phone">Buyer phone (optional)</Label>
          <Input id="buyer-phone" value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)} />
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setView("cart")} disabled={isPending}>
            Back to cart
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={isPending}>
            Confirm Sale
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm space-y-6 p-6">
      <h1 className="text-xl font-semibold">Sell</h1>

      {view === "cart" && <QrScanner onDecode={handleDecode} paused={scannerPaused} />}
      <ProductSearch onSelect={handleSearchSelect} />

      {addError && (
        <p role="alert" className="text-sm text-destructive">
          {addError}
        </p>
      )}

      {checkoutError && (
        <p role="alert" className="text-sm text-destructive">
          {checkoutError}
        </p>
      )}

      <SellCart
        lines={lines}
        onQuantityChange={handleQuantityChange}
        onPriceChange={handlePriceChange}
        onRemove={handleRemove}
      />

      <Button type="button" onClick={() => setView("checkout")} disabled={lines.length === 0}>
        Checkout
      </Button>
    </div>
  );
}
