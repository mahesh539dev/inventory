import Link from "next/link";
import { requireUser } from "@/lib/auth/guards";
import { listProducts, countProducts } from "@/lib/repositories/product.repo";
import { ProductSearchForm } from "@/components/products/ProductSearchForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PAGE_SIZE = 25;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const user = await requireUser();
  const { q, page: pageParam } = await searchParams;

  const search = q?.trim() || undefined;
  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [items, total] = await Promise.all([
    listProducts({ search, status: "ACTIVE", limit: PAGE_SIZE, offset }),
    countProducts({ search, status: "ACTIVE" }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Products</h1>
        {user.role === "ADMIN" && (
          <Button render={<Link href="/products/new">New Product</Link>} />
        )}
      </div>

      <ProductSearchForm defaultValue={q ?? ""} />

      {items.length === 0 ? (
        <p className="text-muted-foreground">No products found.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((product) => (
                <TableRow key={product.id}>
                  <TableCell>
                    <Link href={`/products/${product.id}`} className="font-medium underline-offset-4 hover:underline">
                      {product.sku}
                    </Link>
                  </TableCell>
                  <TableCell>{product.productName}</TableCell>
                  <TableCell>{product.categoryId ? "—" : "—"}</TableCell>
                  <TableCell>{product.currentQuantity}</TableCell>
                  <TableCell>{product.costPrice}</TableCell>
                  <TableCell>
                    <Badge variant={product.status === "ACTIVE" ? "default" : "secondary"}>
                      {product.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages} ({total} products)
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Button
                variant="outline"
                size="sm"
                render={
                  <Link href={`/products?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page - 1) })}`}>
                    Previous
                  </Link>
                }
              />
            )}
            {page < totalPages && (
              <Button
                variant="outline"
                size="sm"
                render={
                  <Link href={`/products?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page + 1) })}`}>
                    Next
                  </Link>
                }
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
