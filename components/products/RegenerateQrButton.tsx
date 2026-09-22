"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { regenerateProductQrAction } from "@/lib/actions/product.actions";

export function RegenerateQrButton({ productId }: { productId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      disabled={isPending}
      onClick={() => {
        if (
          !confirm(
            "Regenerate this product's QR code? The old QR code (any printed copies) will stop working."
          )
        )
          return;
        startTransition(() => {
          regenerateProductQrAction(productId);
        });
      }}
    >
      {isPending ? "Regenerating..." : "Regenerate QR code"}
    </Button>
  );
}
