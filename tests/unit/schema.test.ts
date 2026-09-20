import { describe, it, expect } from "vitest";
import { users, products, sales, saleItems, inventoryTransactions, auditLogs, categories } from "@/lib/db/schema";

describe("schema", () => {
  it("exports all expected tables", () => {
    expect(users).toBeDefined();
    expect(categories).toBeDefined();
    expect(products).toBeDefined();
    expect(inventoryTransactions).toBeDefined();
    expect(sales).toBeDefined();
    expect(saleItems).toBeDefined();
    expect(auditLogs).toBeDefined();
  });
});
