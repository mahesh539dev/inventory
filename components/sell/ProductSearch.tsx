"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  searchProductsForSale,
  type ProductSearchResult,
} from "@/lib/actions/product-search.actions";

type ProductSearchProps = {
  onSelect: (product: ProductSearchResult) => void;
};

const DEBOUNCE_MS = 300;

export function ProductSearch({ onSelect }: ProductSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductSearchResult[]>([]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setResults([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      const found = await searchProductsForSale(trimmed);
      if (!cancelled) setResults(found);
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="space-y-2">
      <Input
        role="searchbox"
        placeholder="Search by product name or SKU"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {results.length > 0 && (
        <ul role="listbox" className="space-y-1 rounded-md border p-2">
          {results.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => onSelect(product)}
                className="flex w-full items-center justify-between rounded p-2 text-left hover:bg-accent"
              >
                <span>
                  {product.productName}
                  {product.status === "ARCHIVED" && (
                    <span className="ml-2 text-xs text-muted-foreground">(Archived)</span>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">{product.sku}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
