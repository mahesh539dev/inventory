import { requireUser } from "@/lib/auth/guards";
import { getSalesSummary, listSales } from "@/lib/repositories/sale.repo";
import { listLowStockProducts } from "@/lib/repositories/inventory.repo";
import { LOW_STOCK_THRESHOLD } from "@/lib/constants";
import { SummaryTiles } from "@/components/dashboard/SummaryTiles";
import { RecentSalesList } from "@/components/dashboard/RecentSalesList";
import { LowStockList } from "@/components/dashboard/LowStockList";

export function getTodayRange(now: Date): { from: Date; to: Date } {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { from, to };
}

export function getMonthToDateRange(now: Date): { from: Date; to: Date } {
  const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  return { from, to: now };
}

export default async function DashboardPage() {
  const user = await requireUser();
  const now = new Date();

  const [todaySummary, monthSummary, recentSales, lowStockProducts] = await Promise.all([
    getSalesSummary(getTodayRange(now)),
    getSalesSummary(getMonthToDateRange(now)),
    listSales({ limit: 10, offset: 0 }),
    listLowStockProducts(LOW_STOCK_THRESHOLD, { limit: 10, offset: 0 }),
  ]);

  return (
    <div className="p-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground">Signed in as {user.email} ({user.role})</p>
      </div>

      <SummaryTiles label="Today" summary={todaySummary} />
      <SummaryTiles label="This Month" summary={monthSummary} />

      <div className="grid gap-6 sm:grid-cols-2">
        <RecentSalesList sales={recentSales} />
        <LowStockList products={lowStockProducts} />
      </div>
    </div>
  );
}
