import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function ProductSearchForm({ defaultValue }: { defaultValue: string }) {
  return (
    <form method="GET" className="flex gap-2">
      <Input
        type="search"
        name="q"
        placeholder="Search SKU or name"
        defaultValue={defaultValue}
        className="flex-1"
      />
      <Button type="submit">Search</Button>
    </form>
  );
}
