import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/client", () => ({
  db: { transaction: vi.fn() },
}));

vi.mock("@/lib/repositories/sale.repo", () => ({
  insertSale: vi.fn(),
  insertSaleItems: vi.fn(),
}));

vi.mock("@/lib/repositories/inventory.repo", () => ({
  insertInventoryTransaction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/services/product.service", () => ({
  ProductNotFoundError: class ProductNotFoundError extends Error {},
}));

// Mock drizzle-orm itself, keeping every real export EXCEPT inArray, which
// is replaced with a spy — this lets the test assert exactly which ids the
// service asked to lock and in what order, without needing to parse
// Drizzle's internal query-builder objects or touch any global prototype.
//
// vi.mock(...) factories are hoisted above top-level const declarations, so
// the spy itself must be created via vi.hoisted() (same pattern already
// used in tests/unit/QrScanner.test.tsx) rather than a plain top-level
// const — otherwise the factory below throws "Cannot access before
// initialization" at import time.
const { inArraySpy } = vi.hoisted(() => ({
  inArraySpy: vi.fn((column: unknown, values: string[]) => ({ __inArrayValues: values })),
}));
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, inArray: inArraySpy };
});

import { db } from "@/lib/db/client";
import { insertSale, insertSaleItems } from "@/lib/repositories/sale.repo";
import { completeSale } from "@/lib/services/sale.service";

describe("completeSale — lock ordering (deterministic)", () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockReset();
    vi.mocked(insertSale).mockReset();
    vi.mocked(insertSaleItems).mockReset();
    inArraySpy.mockClear();
  });

  it("locks product rows sorted by id, regardless of the cart's insertion order", async () => {
    // Two product ids where insertion order (B then A) is the REVERSE of
    // sort order — if the service locked in cart order instead of sorted
    // order, this test would catch it.
    const idA = "11111111-1111-1111-1111-111111111111";
    const idB = "22222222-2222-2222-2222-222222222222";

    let capturedOrderByCalled = false;
    let capturedLockStrength: string | undefined;

    vi.mocked(db.transaction).mockImplementation(async (callback) => {
      const fakeTx = {
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => {
                capturedOrderByCalled = true;
                return {
                  for: (strength: string) => {
                    capturedLockStrength = strength;
                    return Promise.resolve([
                      { id: idA, currentQuantity: 10, costPrice: "1.00" },
                      { id: idB, currentQuantity: 10, costPrice: "1.00" },
                    ]);
                  },
                };
              },
            }),
          }),
        }),
        update: () => ({
          set: () => ({ where: () => Promise.resolve() }),
        }),
        // The real node-postgres driver's tx.execute(...) resolves to
        // { rows: [...] }, not a bare array — confirmed against the real
        // dev DB in tests/integration/sale.repo.test.ts and
        // tests/integration/sale.service.test.ts. Mocked to match that
        // actual runtime shape.
        execute: () => Promise.resolve({ rows: [{ nextval: "1" }] }),
      };

      return callback(fakeTx as never);
    });

    vi.mocked(insertSale).mockResolvedValue({
      id: "sale-1",
      saleNumber: "SALE-000001",
    } as never);
    vi.mocked(insertSaleItems).mockResolvedValue([] as never);

    await completeSale({
      items: [
        { productId: idB, quantity: 1, soldPricePerUnit: 5 }, // B added first
        { productId: idA, quantity: 1, soldPricePerUnit: 5 }, // A added second
      ],
      userId: "user-1",
    });

    expect(inArraySpy).toHaveBeenCalledTimes(1);
    // The array passed to inArray(...) must be sorted ascending (A before
    // B), regardless of the cart's insertion order (B added before A).
    expect(inArraySpy.mock.calls[0][1]).toEqual([idA, idB]);
    expect(capturedOrderByCalled).toBe(true);
    expect(capturedLockStrength).toBe("update");
  });
});
