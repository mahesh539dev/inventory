"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ProductFormState } from "@/lib/actions/product.actions";

type ProductFormProps = {
  action: (prevState: ProductFormState, formData: FormData) => Promise<ProductFormState>;
  defaultValues?: {
    sku?: string;
    productName?: string;
    categoryName?: string;
    description?: string;
    originalPrice?: string;
    costPrice?: string;
    sellingPrice?: string;
    currentQuantity?: string;
    supplier?: string;
    location?: string;
    notes?: string;
  };
  skuEditable?: boolean;
  submitLabel: string;
};

export function ProductForm({ action, defaultValues = {}, skuEditable = true, submitLabel }: ProductFormProps) {
  const [state, formAction, isPending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="space-y-4 max-w-xl">
      <div className="space-y-2">
        <Label htmlFor="productName">Product Name</Label>
        <Input id="productName" name="productName" required defaultValue={defaultValues.productName} />
        {state?.fieldErrors?.productName && (
          <p className="text-sm text-destructive">{state.fieldErrors.productName}</p>
        )}
      </div>

      {skuEditable && (
        <div className="space-y-2">
          <Label htmlFor="sku">SKU</Label>
          <Input id="sku" name="sku" required defaultValue={defaultValues.sku} />
          {state?.fieldErrors?.sku && <p className="text-sm text-destructive">{state.fieldErrors.sku}</p>}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="categoryName">Category</Label>
        <Input id="categoryName" name="categoryName" defaultValue={defaultValues.categoryName} placeholder="e.g. Shoes" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" defaultValue={defaultValues.description} rows={3} />
      </div>

      <div className="space-y-2 opacity-50">
        <Label htmlFor="photo">Product Photo</Label>
        <Input id="photo" name="photo" type="file" disabled />
        <p className="text-xs text-muted-foreground">Photo upload coming soon.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="originalPrice">Original Price</Label>
          <Input id="originalPrice" name="originalPrice" inputMode="decimal" required defaultValue={defaultValues.originalPrice} />
          {state?.fieldErrors?.originalPrice && (
            <p className="text-sm text-destructive">{state.fieldErrors.originalPrice}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="costPrice">Cost Price</Label>
          <Input id="costPrice" name="costPrice" inputMode="decimal" required defaultValue={defaultValues.costPrice} />
          {state?.fieldErrors?.costPrice && (
            <p className="text-sm text-destructive">{state.fieldErrors.costPrice}</p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="sellingPrice">Selling Price (optional)</Label>
        <Input id="sellingPrice" name="sellingPrice" inputMode="decimal" defaultValue={defaultValues.sellingPrice} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="currentQuantity">Initial Quantity</Label>
        <Input
          id="currentQuantity"
          name="currentQuantity"
          inputMode="numeric"
          required
          defaultValue={defaultValues.currentQuantity ?? "0"}
        />
        {state?.fieldErrors?.currentQuantity && (
          <p className="text-sm text-destructive">{state.fieldErrors.currentQuantity}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="supplier">Supplier</Label>
          <Input id="supplier" name="supplier" defaultValue={defaultValues.supplier} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="location">Location</Label>
          <Input id="location" name="location" defaultValue={defaultValues.location} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" defaultValue={defaultValues.notes} rows={3} />
      </div>

      {state?.error && !state.fieldErrors && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" size="lg" className="w-full" disabled={isPending}>
        {isPending ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
