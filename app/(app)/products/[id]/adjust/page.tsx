import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import { findProductById } from "@/lib/repositories/product.repo";
import { adjustInventoryAction } from "@/lib/actions/inventory.actions";
import { AdjustInventoryForm } from "@/components/products/AdjustInventoryForm";

export default async function AdjustInventoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const product = await findProductById(id);
  if (!product) notFound();

  const boundAction = adjustInventoryAction.bind(null, id);

  return (
    <div className="p-4">
      <h1 className="text-2xl font-semibold mb-1">Adjust Stock</h1>
      <p className="text-muted-foreground mb-4">{product.productName}</p>
      <AdjustInventoryForm action={boundAction} currentQuantity={product.currentQuantity} />
    </div>
  );
}
