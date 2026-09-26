import Link from "next/link";
import type { SaleRow } from "@/lib/repositories/sale.repo";

export function RecentSalesList({ sales }: { sales: SaleRow[] }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Recent Sales</h2>
        <Link href="/sales" className="text-sm underline">
          View all
        </Link>
      </div>
      {sales.length === 0 ? (
        <p className="text-muted-foreground">No sales yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {sales.map((sale) => (
            <li key={sale.id} className="flex items-center justify-between p-3">
              <Link href={`/sales/${sale.id}`} className="underline">
                {sale.saleNumber}
              </Link>
              <span className="text-sm text-muted-foreground">{sale.soldAt.toLocaleString()}</span>
              <span className="font-medium">${sale.totalAmount}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
