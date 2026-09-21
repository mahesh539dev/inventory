import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import { findProductById } from "@/lib/repositories/product.repo";
import { listCategories } from "@/lib/repositories/category.repo";
import { updateProductAction } from "@/lib/actions/product.actions";
import { ProductForm } from "@/components/products/ProductForm";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const product = await findProductById(id);
  if (!product) notFound();

  const categories = await listCategories();
  const category = categories.find((c) => c.id === product.categoryId);
  const boundAction = updateProductAction.bind(null, id);

  return (
    <div className="p-4">
      <h1 className="text-2xl font-semibold mb-4">Edit Product</h1>
      {/* Quantity shown below is read-only context: updateProductAction/updateProduct do not
          write currentQuantity, so editing it here has no effect. Inventory adjustments belong
          to Phase 4's dedicated workflow, not this form. */}
      <ProductForm
        action={boundAction}
        skuEditable={false}
        submitLabel="Save Changes"
        defaultValues={{
          sku: product.sku,
          productName: product.productName,
          categoryName: category?.name ?? "",
          description: product.description ?? "",
          originalPrice: product.originalPrice,
          costPrice: product.costPrice,
          sellingPrice: product.sellingPrice ?? "",
          currentQuantity: String(product.currentQuantity),
          supplier: product.supplier ?? "",
          location: product.location ?? "",
          notes: product.notes ?? "",
        }}
      />
    </div>
  );
}
