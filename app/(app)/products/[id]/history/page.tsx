import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth/guards";
import { findProductById } from "@/lib/repositories/product.repo";
import { listTransactionsByProduct, countTransactionsByProduct } from "@/lib/repositories/inventory.repo";
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

export default async function InventoryHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const { page: pageParam } = await searchParams;

  const product = await findProductById(id);
  if (!product) notFound();

  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [transactions, total] = await Promise.all([
    listTransactionsByProduct(id, { limit: PAGE_SIZE, offset }),
    countTransactionsByProduct(id),
  ]);

  const userIds = [...new Set(transactions.map((t) => t.createdBy))];
  const userNameById = await findUserNamesByIds(userIds);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Inventory History</h1>
        <p className="text-muted-foreground">{product.productName}</p>
      </div>

      {transactions.length === 0 ? (
        <p className="text-muted-foreground">No inventory transactions yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>By</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Badge variant="secondary">{t.type}</Badge>
                  </TableCell>
                  <TableCell className={t.quantity < 0 ? "text-destructive" : "text-green-600"}>
                    {t.quantity > 0 ? `+${t.quantity}` : t.quantity}
                  </TableCell>
                  <TableCell>{t.notes ?? "—"}</TableCell>
                  <TableCell>{userNameById.get(t.createdBy) ?? "Unknown"}</TableCell>
                  <TableCell>{t.createdAt.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages} ({total} transactions)
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Button variant="outline" size="sm" render={<Link href={`/products/${id}/history?page=${page - 1}`}>Previous</Link>} />
            )}
            {page < totalPages && (
              <Button variant="outline" size="sm" render={<Link href={`/products/${id}/history?page=${page + 1}`}>Next</Link>} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
