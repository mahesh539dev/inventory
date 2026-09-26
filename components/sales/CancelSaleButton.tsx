"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelSaleAction } from "@/lib/actions/sale.actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";

export function CancelSaleButton({ saleId }: { saleId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await cancelSaleAction({ saleId });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="destructive">Cancel Sale</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this sale?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Are you sure? This restores all items to inventory and cannot be undone.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Back
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={isPending}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
