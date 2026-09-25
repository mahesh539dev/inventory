import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth/guards";
import { findSaleById } from "@/lib/repositories/sale.repo";
import { findUserNamesByIds } from "@/lib/repositories/user.repo";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function SaleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  const sale = await findSaleById(id);
  if (!sale) notFound();

  const userNameById = await findUserNamesByIds([sale.soldBy]);

  return (
    <div className="p-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{sale.saleNumber}</h1>
        <p className="text-muted-foreground">
          {sale.soldAt.toLocaleString()} · Sold by {userNameById.get(sale.soldBy) ?? "Unknown"}
        </p>
        <Badge variant="secondary" className="mt-2">
          {sale.status}
        </Badge>
      </div>

      {(sale.buyerName || sale.buyerPhone) && (
        <div className="text-sm">
          <p className="font-medium">Buyer</p>
          {sale.buyerName && <p>{sale.buyerName}</p>}
          {sale.buyerPhone && <p className="text-muted-foreground">{sale.buyerPhone}</p>}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Sold Price</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Revenue</TableHead>
              <TableHead>Profit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sale.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <Link
                    href={`/products/${item.productId}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {item.productName}
                  </Link>
                  <p className="text-xs text-muted-foreground">{item.sku}</p>
                </TableCell>
                <TableCell>{item.quantity}</TableCell>
                <TableCell>${item.soldPricePerUnit}</TableCell>
                <TableCell>${item.costPerUnit}</TableCell>
                <TableCell>${item.totalRevenue}</TableCell>
                <TableCell>${item.profit}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-end gap-6 text-sm font-medium">
        <span>Total cost: ${sale.totalCost}</span>
        <span>Total revenue: ${sale.totalAmount}</span>
        <span>Total profit: ${sale.totalProfit}</span>
      </div>
    </div>
  );
}
