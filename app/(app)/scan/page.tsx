"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { QrScanner } from "@/components/scan/QrScanner";
import { parseQrPayload } from "@/lib/scan/parse-qr-payload";
import { resolveProductForScan } from "@/lib/actions/scan.actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const NOT_RECOGNIZED_ERROR = "Not a recognized product QR code";
const NOT_FOUND_ERROR = "Product not found — it may have been removed or its QR code regenerated.";

export default function ScanPage() {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sku, setSku] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleResolved(result: { id: string } | null) {
    if (result) {
      router.push(`/products/${result.id}`);
      return;
    }
    setError(NOT_FOUND_ERROR);
    setPaused(false);
  }

  function handleDecode(text: string) {
    const parsed = parseQrPayload(text);
    if (!parsed) {
      setError(NOT_RECOGNIZED_ERROR);
      return;
    }

    setError(null);
    setPaused(true);
    startTransition(async () => {
      const result = await resolveProductForScan({ publicIdentifier: parsed.publicIdentifier });
      handleResolved(result);
    });
  }

  function handleManualSubmit() {
    const trimmed = sku.trim();
    if (trimmed.length === 0) return;

    setError(null);
    startTransition(async () => {
      const result = await resolveProductForScan({ sku: trimmed });
      handleResolved(result);
    });
  }

  return (
    <div className="mx-auto max-w-sm space-y-6 p-6">
      <h1 className="text-xl font-semibold">Scan Product</h1>

      <QrScanner onDecode={handleDecode} paused={paused} />

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="space-y-2">
        <Label htmlFor="manual-sku">Or enter SKU manually</Label>
        <div className="flex gap-2">
          <Input
            id="manual-sku"
            value={sku}
            onChange={(event) => setSku(event.target.value)}
            placeholder="SKU"
          />
          <Button type="button" onClick={handleManualSubmit} disabled={isPending}>
            Find Product
          </Button>
        </div>
      </div>
    </div>
  );
}
