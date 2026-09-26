"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { returnSaleItemsAction } from "@/lib/actions/sale.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";

type ReturnableItem = {
  id: string;
  productName: string;
  sku: string;
  quantity: number;
  returnedQuantity: number;
};

export function ReturnItemsDialog({ saleId, items }: { saleId: string; items: ReturnableItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const hasAnyQuantity = useMemo(
    () => Object.values(quantities).some((qty) => qty > 0),
    [quantities]
  );

  function handleConfirm() {
    setError(null);
    const payload = items
      .map((item) => ({ saleItemId: item.id, quantity: quantities[item.id] ?? 0 }))
      .filter((line) => line.quantity > 0);

    startTransition(async () => {
      const result = await returnSaleItemsAction({ saleId, items: payload });
      if (result.ok) {
        setOpen(false);
        setQuantities({});
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline">Return Items</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Return items from this sale</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {items.map((item) => {
            const remaining = item.quantity - item.returnedQuantity;
            return (
              <div key={item.id} className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{item.productName}</p>
                  <p className="text-xs text-muted-foreground">
                    Sold: {item.quantity} · Remaining: {remaining}
                  </p>
                </div>
                <div className="w-24">
                  <Label htmlFor={`return-qty-${item.id}`} className="sr-only">
                    Quantity to return for {item.productName}
                  </Label>
                  <Input
                    id={`return-qty-${item.id}`}
                    type="number"
                    min={0}
                    max={remaining}
                    disabled={remaining === 0}
                    value={quantities[item.id] ?? 0}
                    onChange={(e) => {
                      const raw = Number(e.target.value);
                      const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(remaining, raw)) : 0;
                      setQuantities((prev) => ({ ...prev, [item.id]: clamped }));
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isPending || !hasAnyQuantity}>
            Confirm Return
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
