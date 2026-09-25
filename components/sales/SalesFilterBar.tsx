"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const STATUSES = ["COMPLETED", "CANCELLED", "PARTIALLY_RETURNED", "RETURNED"] as const;

export function SalesFilterBar({
  products,
  users,
}: {
  products: { id: string; productName: string }[];
  users: { id: string; name: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");

  function navigate(nextParams: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(nextParams)) {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    }
    params.set("page", "1");
    router.push(`/sales?${params.toString()}`);
  }

  return (
    <div className="space-y-3">
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ q: query || undefined });
        }}
      >
        <Input
          placeholder="Sale number or SKU"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button type="submit">Search</Button>
      </form>

      <div className="flex flex-wrap gap-3">
        <div>
          <Label htmlFor="filter-status">Status</Label>
          <select
            id="filter-status"
            className="block h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
            value={searchParams.get("status") ?? ""}
            onChange={(e) => navigate({ status: e.target.value || undefined })}
          >
            <option value="">All</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="filter-product">Product</Label>
          <select
            id="filter-product"
            className="block h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
            value={searchParams.get("productId") ?? ""}
            onChange={(e) => navigate({ productId: e.target.value || undefined })}
          >
            <option value="">All</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.productName}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="filter-user">User</Label>
          <select
            id="filter-user"
            className="block h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
            value={searchParams.get("userId") ?? ""}
            onChange={(e) => navigate({ userId: e.target.value || undefined })}
          >
            <option value="">All</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="filter-date-from">From</Label>
          <input
            id="filter-date-from"
            type="date"
            className="block h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
            defaultValue={searchParams.get("dateFrom") ?? ""}
            onChange={(e) => navigate({ dateFrom: e.target.value || undefined })}
          />
        </div>

        <div>
          <Label htmlFor="filter-date-to">To</Label>
          <input
            id="filter-date-to"
            type="date"
            className="block h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
            defaultValue={searchParams.get("dateTo") ?? ""}
            onChange={(e) => navigate({ dateTo: e.target.value || undefined })}
          />
        </div>
      </div>
    </div>
  );
}
