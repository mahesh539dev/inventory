import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";
import { findProductById } from "@/lib/repositories/product.repo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArchiveProductButton } from "@/components/products/ArchiveProductButton";
import { RegenerateQrButton } from "@/components/products/RegenerateQrButton";

export default async function ProductDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const product = await findProductById(id);
  if (!product) notFound();

  return (
    <div className="p-4 space-y-4 max-w-xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{product.productName}</h1>
          <p className="text-muted-foreground">SKU: {product.sku}</p>
        </div>
        <Badge variant={product.status === "ACTIVE" ? "default" : "secondary"}>{product.status}</Badge>
      </div>

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

      <div className="space-y-2 border-t pt-4">
        <h2 className="text-sm font-medium text-muted-foreground">QR Code</h2>
        <img
          src={`/api/products/${product.id}/qr`}
          alt={`QR code for ${product.productName}`}
          width={200}
          height={200}
          className="rounded-md border"
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" render={<a href={`/api/products/${product.id}/qr?download=1`}>Download PNG</a>} />
          {user.role === "ADMIN" && <RegenerateQrButton productId={product.id} />}
        </div>
      </div>

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

      {user.role === "ADMIN" && product.status === "ACTIVE" && (
        <div className="flex gap-2 pt-2">
          <Button render={<Link href={`/products/${product.id}/edit`}>Edit</Link>} />
          <ArchiveProductButton productId={product.id} />
        </div>
      )}
    </div>
  );
}
