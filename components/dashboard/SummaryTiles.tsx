import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { SalesSummary } from "@/lib/repositories/sale.repo";

function money(value: string): string {
  return `$${Number(value).toFixed(2)}`;
}

const TILES: { key: keyof SalesSummary; returnsKey: keyof SalesSummary | null; label: string; format: (v: string | number) => string }[] = [
  { key: "saleCount", returnsKey: null, label: "Sales", format: (v) => String(v) },
  { key: "unitsSold", returnsKey: null, label: "Units Sold", format: (v) => String(v) },
  { key: "grossRevenue", returnsKey: "returnedRevenue", label: "Revenue", format: (v) => money(String(v)) },
  { key: "grossCost", returnsKey: "returnedCost", label: "Cost", format: (v) => money(String(v)) },
  { key: "grossProfit", returnsKey: "returnedProfit", label: "Profit", format: (v) => money(String(v)) },
];

export function SummaryTiles({ label, summary }: { label: string; summary: SalesSummary }) {
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-medium">{label}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {TILES.map((tile) => (
          <Card key={tile.key} size="sm">
            <CardHeader>
              <CardTitle>{tile.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xl font-semibold">{tile.format(summary[tile.key])}</p>
              {tile.returnsKey && Number(summary[tile.returnsKey]) > 0 && (
                <p className="text-sm text-muted-foreground">
                  Returns: -{money(String(summary[tile.returnsKey]))}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
