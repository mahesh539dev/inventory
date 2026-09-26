import Link from "next/link";
import { requireUser } from "@/lib/auth/guards";
import { listSales, countSales } from "@/lib/repositories/sale.repo";
import { findUserNamesByIds, listUsersForFilter } from "@/lib/repositories/user.repo";
import { listProducts } from "@/lib/repositories/product.repo";
import { SalesFilterBar } from "@/components/sales/SalesFilterBar";
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

type SalesSearchParams = {
  page?: string;
  q?: string;
  status?: "COMPLETED" | "CANCELLED" | "PARTIALLY_RETURNED" | "RETURNED";
  productId?: string;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
};

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<SalesSearchParams>;
}) {
  await requireUser();
  const sp = await searchParams;

  const page = Math.max(1, Number(sp.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const filterParams = {
    query: sp.q,
    status: sp.status,
    productId: sp.productId,
    userId: sp.userId,
    dateFrom: sp.dateFrom ? new Date(sp.dateFrom) : undefined,
    dateTo: sp.dateTo ? new Date(sp.dateTo) : undefined,
  };

  const [salesList, total, products, users] = await Promise.all([
    listSales({ limit: PAGE_SIZE, offset, ...filterParams }),
    countSales(filterParams),
    listProducts({ limit: 500, offset: 0 }),
    listUsersForFilter(),
  ]);

  const userIds = [...new Set(salesList.map((s) => s.soldBy))];
  const userNameById = await findUserNamesByIds(userIds);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const hasActiveFilters = Boolean(sp.q || sp.status || sp.productId || sp.userId || sp.dateFrom || sp.dateTo);

  function pageHref(targetPage: number): string {
    const params = new URLSearchParams();
    if (sp.q) params.set("q", sp.q);
    if (sp.status) params.set("status", sp.status);
    if (sp.productId) params.set("productId", sp.productId);
    if (sp.userId) params.set("userId", sp.userId);
    if (sp.dateFrom) params.set("dateFrom", sp.dateFrom);
    if (sp.dateTo) params.set("dateTo", sp.dateTo);
    params.set("page", String(targetPage));
    return `/sales?${params.toString()}`;
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-semibold">Sales</h1>

      <SalesFilterBar
        products={products.map((p) => ({ id: p.id, productName: p.productName }))}
        users={users}
      />

      {salesList.length === 0 ? (
        <p className="text-muted-foreground">
          {hasActiveFilters ? "No sales match these filters." : "No sales yet."}
        </p>
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
              <Button variant="outline" size="sm" render={<Link href={pageHref(page - 1)}>Previous</Link>} />
            )}
            {page < totalPages && (
              <Button variant="outline" size="sm" render={<Link href={pageHref(page + 1)}>Next</Link>} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
