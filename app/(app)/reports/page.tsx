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

function parseDate(
  value: string | undefined,
  boundary: "start" | "end" = "start"
): Date | null {
  if (!value) return null;

  // Parse "YYYY-MM-DD" as local time (not UTC) so the calendar date is
  // preserved regardless of the server's timezone offset. `new Date(string)`
  // would parse a date-only string as UTC midnight, which can shift to the
  // previous/next local day.
  const isoDateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (isoDateMatch) {
    const [, year, month, day] = isoDateMatch;
    // A date-only string is a whole-day boundary: "start" means local
    // midnight at the beginning of that day, "end" means the last
    // millisecond of that day (23:59:59.999 local) — matching the
    // end-of-day convention used by getTodayRange in the dashboard page.
    // Without this, a `to` bound parsed as start-of-day would exclude
    // every sale on the named day from an inclusive `lte` comparison.
    const parsed =
      boundary === "end"
        ? new Date(Number(year), Number(month) - 1, Number(day), 23, 59, 59, 999)
        : new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function endOfDayOf(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function startOfDayOf(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function parseReportRange(
  params: { from?: string; to?: string },
  now: Date
): { from: Date; to: Date } {
  // `from` defaults to start-of-month, and is parsed as start-of-day when
  // given as a date-only string. `to` defaults to `now` (a precise instant
  // that must NOT be pushed to end-of-day), and is parsed as end-of-day
  // when given as a date-only string — otherwise an inclusive `lte`
  // comparison against `to` would exclude every sale on the named day.
  const wasFromDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(params.from ?? "");
  const wasToDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(params.to ?? "");

  const parsedFrom = parseDate(params.from, "start") ?? startOfMonth(now);
  const parsedTo = parseDate(params.to, "end") ?? now;

  if (parsedFrom.getTime() > parsedTo.getTime()) {
    // Swap positions. Whichever value now occupies `to` must be
    // end-of-day if it originated from a date-only string (it may
    // currently be start-of-day, since it was originally parsed as
    // `from`); likewise whichever now occupies `from` must be
    // start-of-day. Values that defaulted (startOfMonth/now) are already
    // correct in either position and are left untouched.
    const newTo = wasFromDateOnly ? endOfDayOf(parsedFrom) : parsedFrom;
    const newFrom = wasToDateOnly ? startOfDayOf(parsedTo) : parsedTo;
    return { from: newFrom, to: newTo };
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
