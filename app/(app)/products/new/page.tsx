import { requireAdmin } from "@/lib/auth/guards";
import { createProductAction } from "@/lib/actions/product.actions";
import { ProductForm } from "@/components/products/ProductForm";

export default async function NewProductPage() {
  await requireAdmin();

  return (
    <div className="p-4">
      <h1 className="text-2xl font-semibold mb-4">New Product</h1>
      <ProductForm action={createProductAction} submitLabel="Create Product" />
    </div>
  );
}
