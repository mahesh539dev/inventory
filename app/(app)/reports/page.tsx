import { requireUser } from "@/lib/auth/guards";
import {
  getSalesSummary,
  getSalesBreakdownByProduct,
  getSalesBreakdownByCategory,
} from "@/lib/repositories/sale.repo";
import { SummaryTiles } from "@/components/dashboard/SummaryTiles";
import { ReportsDateRangeFilter } from "@/components/reports/ReportsDateRangeFilter";
import { BreakdownTable } from "@/components/reports/BreakdownTable";

type ReportsSearchParams = {
  from?: string;
  to?: string;
  groupBy?: string;
};

function startOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;

  // Parse "YYYY-MM-DD" as local time (not UTC) so the calendar date is
  // preserved regardless of the server's timezone offset. `new Date(string)`
  // would parse a date-only string as UTC midnight, which can shift to the
  // previous/next local day.
  const isoDateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (isoDateMatch) {
    const [, year, month, day] = isoDateMatch;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseReportRange(
  params: { from?: string; to?: string },
  now: Date
): { from: Date; to: Date } {
  const parsedFrom = parseDate(params.from) ?? startOfMonth(now);
  const parsedTo = parseDate(params.to) ?? now;

  if (parsedFrom.getTime() > parsedTo.getTime()) {
    return { from: parsedTo, to: parsedFrom };
  }
  return { from: parsedFrom, to: parsedTo };
}

export function parseGroupBy(groupBy: string | undefined): "product" | "category" {
  return groupBy === "category" ? "category" : "product";
}

export function toDateInputValue(date: Date): string {
  // Build the "YYYY-MM-DD" string from local-time getters rather than
  // `toISOString()`, which converts to UTC first and can roll the date
  // forward/backward a day in timezones west/east of UTC (e.g. evenings in
  // US Eastern rolling forward into the next UTC day).
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<ReportsSearchParams>;
}) {
  await requireUser();
  const sp = await searchParams;
  const now = new Date();

  const range = parseReportRange(sp, now);
  const groupBy = parseGroupBy(sp.groupBy);

  const [summary, breakdown] = await Promise.all([
    getSalesSummary(range),
    groupBy === "product" ? getSalesBreakdownByProduct(range) : getSalesBreakdownByCategory(range),
  ]);

  return (
    <div className="p-4 space-y-6">
      <h1 className="text-2xl font-semibold">Reports</h1>

      <ReportsDateRangeFilter
        defaultFrom={toDateInputValue(range.from)}
        defaultTo={toDateInputValue(range.to)}
        defaultGroupBy={groupBy}
      />

      <SummaryTiles label="Selected Range" summary={summary} />

      <BreakdownTable rows={breakdown} groupBy={groupBy} />
    </div>
  );
}
