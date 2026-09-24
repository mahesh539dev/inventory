"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type CartLine = {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  soldPricePerUnit: number;
  knownStock: number;
};

type SellCartProps = {
  lines: CartLine[];
  onQuantityChange: (productId: string, quantity: number) => void;
  onPriceChange: (productId: string, price: number) => void;
  onRemove: (productId: string) => void;
};

export function SellCart({ lines, onQuantityChange, onPriceChange, onRemove }: SellCartProps) {
  if (lines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Scan or search a product to add it to this sale.
      </p>
    );
  }

  const total = lines.reduce((sum, line) => sum + line.quantity * line.soldPricePerUnit, 0);

  return (
    <div className="space-y-3">
      {lines.map((line) => (
        <div key={line.productId} className="space-y-1 rounded-md border p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{line.productName}</p>
              <p className="text-xs text-muted-foreground">{line.sku}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Remove"
              onClick={() => onRemove(line.productId)}
            >
              Remove
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="−"
                onClick={() =>
                  line.quantity <= 1
                    ? onRemove(line.productId)
                    : onQuantityChange(line.productId, line.quantity - 1)
                }
              >
                −
              </Button>
              <span className="w-8 text-center">{line.quantity}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="+"
                onClick={() => onQuantityChange(line.productId, line.quantity + 1)}
              >
                +
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Label htmlFor={`price-${line.productId}`}>Sold price</Label>
              <Input
                id={`price-${line.productId}`}
                type="number"
                step="0.01"
                min="0"
                value={line.soldPricePerUnit}
                onChange={(event) => onPriceChange(line.productId, Number(event.target.value))}
                className="w-24"
              />
            </div>

            <span className="ml-auto text-sm font-medium">
              ${(line.quantity * line.soldPricePerUnit).toFixed(2)}
            </span>
          </div>

          {line.quantity > line.knownStock && (
            <p className="text-xs text-destructive">
              Only {line.knownStock} in stock — this line may fail at checkout.
            </p>
          )}
        </div>
      ))}

      <div className="flex items-center justify-between border-t pt-3 font-semibold">
        <span>Total</span>
        <span>${total.toFixed(2)}</span>
      </div>
    </div>
  );
}
