"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Label } from "@/components/ui/label";

export function ReportsDateRangeFilter({
  defaultFrom,
  defaultTo,
  defaultGroupBy,
}: {
  defaultFrom: string;
  defaultTo: string;
  defaultGroupBy: "product" | "category";
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function navigate(nextParams: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(nextParams)) {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    }
    router.push(`/reports?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap gap-3">
      <div>
        <Label htmlFor="report-from">From</Label>
        <input
          id="report-from"
          type="date"
          className="block h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          defaultValue={defaultFrom}
          onChange={(e) => navigate({ from: e.target.value || undefined })}
        />
      </div>

      <div>
        <Label htmlFor="report-to">To</Label>
        <input
          id="report-to"
          type="date"
          className="block h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          defaultValue={defaultTo}
          onChange={(e) => navigate({ to: e.target.value || undefined })}
        />
      </div>

      <div>
        <Label htmlFor="report-groupby">Group By</Label>
        <select
          id="report-groupby"
          className="block h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          defaultValue={defaultGroupBy}
          onChange={(e) => navigate({ groupBy: e.target.value || undefined })}
        >
          <option value="product">Product</option>
          <option value="category">Category</option>
        </select>
      </div>
    </div>
  );
}
