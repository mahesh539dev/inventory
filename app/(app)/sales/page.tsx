import Link from "next/link";
import { requireUser } from "@/lib/auth/guards";
import { listSales, countSales } from "@/lib/repositories/sale.repo";
import { findUserNamesByIds } from "@/lib/repositories/user.repo";
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

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireUser();
  const { page: pageParam } = await searchParams;

  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [salesList, total] = await Promise.all([
    listSales({ limit: PAGE_SIZE, offset }),
    countSales(),
  ]);

  const userIds = [...new Set(salesList.map((s) => s.soldBy))];
  const userNameById = await findUserNamesByIds(userIds);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-semibold">Sales</h1>

      {salesList.length === 0 ? (
        <p className="text-muted-foreground">No sales yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sale #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Buyer</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Sold By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {salesList.map((sale) => (
                <TableRow key={sale.id}>
                  <TableCell>
                    <Link href={`/sales/${sale.id}`} className="underline">
                      {sale.saleNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{sale.soldAt.toLocaleString()}</TableCell>
                  <TableCell>{sale.buyerName ?? "—"}</TableCell>
                  <TableCell>${sale.totalAmount}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{sale.status}</Badge>
                  </TableCell>
                  <TableCell>{userNameById.get(sale.soldBy) ?? "Unknown"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages} ({total} sales)
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Button variant="outline" size="sm" render={<Link href={`/sales?page=${page - 1}`}>Previous</Link>} />
            )}
            {page < totalPages && (
              <Button variant="outline" size="sm" render={<Link href={`/sales?page=${page + 1}`}>Next</Link>} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
