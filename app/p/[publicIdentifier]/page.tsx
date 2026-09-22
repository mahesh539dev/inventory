import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import {
  findPublicProductView,
  findProductByPublicIdentifier,
} from "@/lib/repositories/product.repo";
import { Badge } from "@/components/ui/badge";

export default async function PublicProductPage({
  params,
}: {
  params: Promise<{ publicIdentifier: string }>;
}) {
  const { publicIdentifier } = await params;
  const user = await getSessionUser();

  if (!user) {
    const view = await findPublicProductView(publicIdentifier);
    if (!view) notFound();

    return (
      <div className="mx-auto max-w-sm p-6 space-y-4">
        {view.productImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={view.productImage}
            alt={view.productName}
            className="w-full rounded-md border object-cover"
          />
        )}
        <h1 className="text-xl font-semibold">{view.productName}</h1>
        <p className="text-lg">
          {view.sellingPrice !== null ? `$${view.sellingPrice}` : "Price not set"}
        </p>
      </div>
    );
  }

  const product = await findProductByPublicIdentifier(publicIdentifier);
  if (!product) notFound();

  return (
    <div className="mx-auto max-w-sm p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{product.productName}</h1>
        <Badge variant={product.status === "ACTIVE" ? "default" : "secondary"}>{product.status}</Badge>
      </div>
      <p className="text-muted-foreground">SKU: {product.sku}</p>

      <dl className="grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Available Quantity</dt>
        <dd>{product.currentQuantity}</dd>

        <dt className="text-muted-foreground">Original Price</dt>
        <dd>{product.originalPrice}</dd>

        <dt className="text-muted-foreground">Cost Price</dt>
        <dd>{product.costPrice}</dd>

        <dt className="text-muted-foreground">Selling Price</dt>
        <dd>{product.sellingPrice ?? "Not set"}</dd>

        {product.supplier && (
          <>
            <dt className="text-muted-foreground">Supplier</dt>
            <dd>{product.supplier}</dd>
          </>
        )}

        {product.location && (
          <>
            <dt className="text-muted-foreground">Location</dt>
            <dd>{product.location}</dd>
          </>
        )}
      </dl>

      {product.description && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">Description</h2>
          <p>{product.description}</p>
        </div>
      )}

      {product.notes && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">Notes</h2>
          <p>{product.notes}</p>
        </div>
      )}
    </div>
  );
}
