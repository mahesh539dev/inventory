import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SalesBreakdownRow } from "@/lib/repositories/sale.repo";

export function BreakdownTable({
  rows,
  groupBy,
}: {
  rows: SalesBreakdownRow[];
  groupBy: "product" | "category";
}) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground">No sales in this range.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{groupBy === "product" ? "Product" : "Category"}</TableHead>
            <TableHead>Units Sold</TableHead>
            <TableHead>Revenue</TableHead>
            <TableHead>Cost</TableHead>
            <TableHead>Profit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{row.name}</TableCell>
              <TableCell>{row.unitsSold}</TableCell>
              <TableCell>${row.revenue}</TableCell>
              <TableCell>${row.cost}</TableCell>
              <TableCell>${row.profit}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
