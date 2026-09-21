"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { archiveProductAction } from "@/lib/actions/product.actions";

export function ArchiveProductButton({ productId }: { productId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="destructive"
      disabled={isPending}
      onClick={() => {
        if (!confirm("Archive this product? It will no longer appear in the active product list.")) return;
        startTransition(() => {
          archiveProductAction(productId);
        });
      }}
    >
      {isPending ? "Archiving..." : "Archive"}
    </Button>
  );
}
