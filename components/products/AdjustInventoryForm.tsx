"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { InventoryFormState } from "@/lib/actions/inventory.actions";

type AdjustInventoryFormProps = {
  action: (prevState: InventoryFormState, formData: FormData) => Promise<InventoryFormState>;
  currentQuantity: number;
};

export function AdjustInventoryForm({ action, currentQuantity }: AdjustInventoryFormProps) {
  const [state, formAction, isPending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="space-y-4 max-w-sm">
      <p className="text-sm text-muted-foreground">
        Current quantity: <span className="font-medium text-foreground">{currentQuantity}</span>
      </p>

      <div className="space-y-2">
        <Label htmlFor="quantityDelta">Adjustment</Label>
        <Input
          id="quantityDelta"
          name="quantityDelta"
          inputMode="numeric"
          placeholder="e.g. 5 or -2"
          required
        />
        {state?.fieldErrors?.quantityDelta && (
          <p className="text-sm text-destructive">{state.fieldErrors.quantityDelta}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="type">Type</Label>
        <Select name="type" defaultValue="PURCHASE">
          <SelectTrigger id="type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PURCHASE">Purchase</SelectItem>
            <SelectItem value="ADJUSTMENT">Adjustment</SelectItem>
            <SelectItem value="DAMAGE">Damage</SelectItem>
            <SelectItem value="OTHER">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Reason</Label>
        <Textarea id="notes" name="notes" required rows={3} placeholder="e.g. New stock delivery" />
        {state?.fieldErrors?.notes && <p className="text-sm text-destructive">{state.fieldErrors.notes}</p>}
      </div>

      {state?.error && !state.fieldErrors && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" size="lg" className="w-full" disabled={isPending}>
        {isPending ? "Saving..." : "Save Adjustment"}
      </Button>
    </form>
  );
}
