import Link from "next/link";
import type { ProductRow } from "@/lib/repositories/product.repo";

export function LowStockList({ products }: { products: ProductRow[] }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Low Stock</h2>
        <Link href="/products?status=ACTIVE" className="text-sm underline">
          View all
        </Link>
      </div>
      {products.length === 0 ? (
        <p className="text-muted-foreground">Nothing is low on stock.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {products.map((product) => (
            <li key={product.id} className="flex items-center justify-between p-3">
              <Link href={`/products/${product.id}`} className="underline">
                {product.productName}
              </Link>
              <span className="font-medium">{product.currentQuantity} left</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
