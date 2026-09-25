import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/client", () => ({
  db: { transaction: vi.fn() },
}));

vi.mock("@/lib/repositories/sale.repo", () => ({
  insertSale: vi.fn(),
  insertSaleItems: vi.fn(),
  findSaleForUpdate: vi.fn(),
  findSaleItemsForUpdate: vi.fn(),
  updateSaleItemReturnedQuantity: vi.fn(),
  updateSaleStatus: vi.fn(),
}));

vi.mock("@/lib/repositories/inventory.repo", () => ({
  insertInventoryTransaction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/repositories/audit-log.repo", () => ({
  insertAuditLog: vi.fn(),
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
import {
  insertSale,
  insertSaleItems,
  findSaleForUpdate,
  findSaleItemsForUpdate,
  updateSaleItemReturnedQuantity,
  updateSaleStatus,
} from "@/lib/repositories/sale.repo";
import { insertInventoryTransaction } from "@/lib/repositories/inventory.repo";
import { insertAuditLog } from "@/lib/repositories/audit-log.repo";
import {
  completeSale,
  returnSaleItems,
  cancelSale,
  SaleNotFoundError,
  SaleNotCancellableError,
  InvalidReturnQuantityError,
} from "@/lib/services/sale.service";

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

// A minimal stand-in for the drizzle tx handle used by returnSaleItems and
// cancelSale's tests below. Those services call findSaleForUpdate /
// findSaleItemsForUpdate / updateSaleItemReturnedQuantity / updateSaleStatus
// / insertInventoryTransaction / insertAuditLog — all mocked repo functions
// that ignore their `tx` argument's shape in these tests — plus
// tx.update(products)... directly, so fakeTx needs a minimal `update` stub.
const fakeTx = {
  update: () => ({
    set: () => ({ where: () => Promise.resolve() }),
  }),
};

describe("returnSaleItems", () => {
  const baseSale = {
    id: "sale-1",
    saleNumber: "SALE-000001",
    status: "COMPLETED" as const,
  };
  const baseItem = {
    id: "item-1",
    saleId: "sale-1",
    productId: "prod-1",
    quantity: 5,
    returnedQuantity: 0,
    soldPricePerUnit: "10.00",
    costPerUnit: "6.00",
  };

  beforeEach(() => {
    vi.mocked(db.transaction).mockReset();
    vi.mocked(findSaleForUpdate).mockReset();
    vi.mocked(findSaleItemsForUpdate).mockReset();
    vi.mocked(updateSaleItemReturnedQuantity).mockReset();
    vi.mocked(updateSaleStatus).mockReset();
    vi.mocked(insertInventoryTransaction).mockReset();
    vi.mocked(insertAuditLog).mockReset();

    vi.mocked(db.transaction).mockImplementation(async (cb) => cb(fakeTx as never));
    vi.mocked(findSaleForUpdate).mockResolvedValue({ ...baseSale } as never);
    vi.mocked(findSaleItemsForUpdate).mockResolvedValue([{ ...baseItem }] as never);
    vi.mocked(updateSaleItemReturnedQuantity).mockResolvedValue(undefined as never);
    vi.mocked(updateSaleStatus).mockResolvedValue(undefined as never);
    vi.mocked(insertInventoryTransaction).mockResolvedValue(undefined as never);
    vi.mocked(insertAuditLog).mockResolvedValue(undefined as never);
  });

  it("returns partial quantity on one line, restocks inventory, and sets status to PARTIALLY_RETURNED", async () => {
    await returnSaleItems({ saleId: "sale-1", userId: "user-1", items: [{ saleItemId: "item-1", quantity: 2 }] });

    expect(updateSaleItemReturnedQuantity).toHaveBeenCalledWith("item-1", 2, expect.anything());
    expect(insertInventoryTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ productId: "prod-1", type: "RETURN", quantity: 2, referenceId: "sale-1" }),
      expect.anything()
    );
    expect(updateSaleStatus).toHaveBeenCalledWith("sale-1", "PARTIALLY_RETURNED", expect.anything());
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "SALE_RETURNED", entityType: "sale", entityId: "sale-1", userId: "user-1" }),
      expect.anything()
    );
  });

  it("sets status to RETURNED when the returned quantity covers everything outstanding", async () => {
    await returnSaleItems({ saleId: "sale-1", userId: "user-1", items: [{ saleItemId: "item-1", quantity: 5 }] });
    expect(updateSaleStatus).toHaveBeenCalledWith("sale-1", "RETURNED", expect.anything());
  });

  it("rejects a return quantity exceeding what remains on the line", async () => {
    vi.mocked(findSaleItemsForUpdate).mockResolvedValue([{ ...baseItem, returnedQuantity: 3 }] as never);
    await expect(
      returnSaleItems({ saleId: "sale-1", userId: "user-1", items: [{ saleItemId: "item-1", quantity: 3 }] })
    ).rejects.toBeInstanceOf(InvalidReturnQuantityError);
    expect(updateSaleItemReturnedQuantity).not.toHaveBeenCalled();
    expect(insertInventoryTransaction).not.toHaveBeenCalled();
  });

  it("rejects a zero or negative return quantity", async () => {
    await expect(
      returnSaleItems({ saleId: "sale-1", userId: "user-1", items: [{ saleItemId: "item-1", quantity: 0 }] })
    ).rejects.toBeInstanceOf(InvalidReturnQuantityError);
  });

  it("rejects a saleItemId that isn't part of this sale", async () => {
    await expect(
      returnSaleItems({ saleId: "sale-1", userId: "user-1", items: [{ saleItemId: "not-real", quantity: 1 }] })
    ).rejects.toBeInstanceOf(InvalidReturnQuantityError);
  });

  it("rejects when the sale is not found", async () => {
    vi.mocked(findSaleForUpdate).mockResolvedValue(undefined as never);
    await expect(
      returnSaleItems({ saleId: "missing", userId: "user-1", items: [{ saleItemId: "item-1", quantity: 1 }] })
    ).rejects.toBeInstanceOf(SaleNotFoundError);
  });

  it("rejects when the sale is already CANCELLED or RETURNED", async () => {
    vi.mocked(findSaleForUpdate).mockResolvedValue({ ...baseSale, status: "CANCELLED" } as never);
    await expect(
      returnSaleItems({ saleId: "sale-1", userId: "user-1", items: [{ saleItemId: "item-1", quantity: 1 }] })
    ).rejects.toThrow();
  });

  it("rejects an empty items array before touching the database", async () => {
    await expect(
      returnSaleItems({ saleId: "sale-1", userId: "user-1", items: [] })
    ).rejects.toThrow();
    expect(updateSaleItemReturnedQuantity).not.toHaveBeenCalled();
  });

  it("validates every line before writing any, rolling back on one bad line among several", async () => {
    vi.mocked(findSaleItemsForUpdate).mockResolvedValue([
      { ...baseItem, id: "item-1", returnedQuantity: 0 },
      { ...baseItem, id: "item-2", quantity: 1, returnedQuantity: 1 }, // already fully returned
    ] as never);
    await expect(
      returnSaleItems({
        saleId: "sale-1",
        userId: "user-1",
        items: [{ saleItemId: "item-1", quantity: 2 }, { saleItemId: "item-2", quantity: 1 }],
      })
    ).rejects.toBeInstanceOf(InvalidReturnQuantityError);
    expect(updateSaleItemReturnedQuantity).not.toHaveBeenCalled();
  });
});

describe("cancelSale", () => {
  const baseSale = { id: "sale-1", saleNumber: "SALE-000001", status: "COMPLETED" as const };
  const items = [
    { id: "item-1", saleId: "sale-1", productId: "prod-1", quantity: 5, returnedQuantity: 0, soldPricePerUnit: "10.00", costPerUnit: "6.00" },
    { id: "item-2", saleId: "sale-1", productId: "prod-2", quantity: 2, returnedQuantity: 0, soldPricePerUnit: "20.00", costPerUnit: "12.00" },
  ];

  beforeEach(() => {
    vi.mocked(db.transaction).mockReset();
    vi.mocked(findSaleForUpdate).mockReset();
    vi.mocked(findSaleItemsForUpdate).mockReset();
    vi.mocked(updateSaleItemReturnedQuantity).mockReset();
    vi.mocked(updateSaleStatus).mockReset();
    vi.mocked(insertInventoryTransaction).mockReset();
    vi.mocked(insertAuditLog).mockReset();

    vi.mocked(db.transaction).mockImplementation(async (cb) => cb(fakeTx as never));
    vi.mocked(findSaleForUpdate).mockResolvedValue({ ...baseSale } as never);
    vi.mocked(findSaleItemsForUpdate).mockResolvedValue(items.map((i) => ({ ...i })) as never);
    vi.mocked(updateSaleItemReturnedQuantity).mockResolvedValue(undefined as never);
    vi.mocked(updateSaleStatus).mockResolvedValue(undefined as never);
    vi.mocked(insertInventoryTransaction).mockResolvedValue(undefined as never);
    vi.mocked(insertAuditLog).mockResolvedValue(undefined as never);
  });

  it("restocks every line's full quantity and sets status to CANCELLED", async () => {
    await cancelSale({ saleId: "sale-1", userId: "user-1" });

    expect(updateSaleItemReturnedQuantity).toHaveBeenCalledWith("item-1", 5, expect.anything());
    expect(updateSaleItemReturnedQuantity).toHaveBeenCalledWith("item-2", 2, expect.anything());
    expect(insertInventoryTransaction).toHaveBeenCalledTimes(2);
    expect(updateSaleStatus).toHaveBeenCalledWith("sale-1", "CANCELLED", expect.anything());
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "SALE_CANCELLED", entityType: "sale", entityId: "sale-1" }),
      expect.anything()
    );
  });

  it("rejects cancelling a sale that already has a partial return", async () => {
    vi.mocked(findSaleForUpdate).mockResolvedValue({ ...baseSale, status: "PARTIALLY_RETURNED" } as never);
    await expect(cancelSale({ saleId: "sale-1", userId: "user-1" })).rejects.toBeInstanceOf(SaleNotCancellableError);
    expect(updateSaleItemReturnedQuantity).not.toHaveBeenCalled();
  });

  it("rejects cancelling an already-CANCELLED sale", async () => {
    vi.mocked(findSaleForUpdate).mockResolvedValue({ ...baseSale, status: "CANCELLED" } as never);
    await expect(cancelSale({ saleId: "sale-1", userId: "user-1" })).rejects.toBeInstanceOf(SaleNotCancellableError);
  });

  it("rejects cancelling an already-RETURNED sale", async () => {
    vi.mocked(findSaleForUpdate).mockResolvedValue({ ...baseSale, status: "RETURNED" } as never);
    await expect(cancelSale({ saleId: "sale-1", userId: "user-1" })).rejects.toBeInstanceOf(SaleNotCancellableError);
  });
});

describe("returnSaleItems — deterministic concurrent-call simulation", () => {
  // Same technique as tests/unit/inventory.service.concurrency.test.ts for
  // adjustInventory (see that file's header comment for the full rationale:
  // real-DB concurrency tests are unreliable against this project's Railway
  // instance, so the row lock's blocking effect is simulated directly by
  // controlling exactly when each call's "select" and "update" resolve,
  // rather than hoping two real calls happen to overlap). Here the shared
  // mutable state is one sale_item's returnedQuantity instead of a
  // product's currentQuantity, but the shape of the race — and what a
  // correctly-locked service must do about it — is identical.
  it("prevents two concurrent returns from double-counting when both target the same line", async () => {
    let sharedReturnedQuantity = 0;
    let firstCallStarted = false;
    let releaseSecondRead!: () => void;
    const secondReadGate = new Promise<void>((resolve) => {
      releaseSecondRead = resolve;
    });

    const sale = { id: "sale-1", saleNumber: "SALE-000001", status: "COMPLETED" as const };
    const lineQuantity = 5; // both calls try to return 3; only the first may fully succeed as requested

    vi.mocked(db.transaction).mockImplementation(async (callback) => {
      const isFirstCall = !firstCallStarted;
      firstCallStarted = true;

      if (!isFirstCall) {
        await secondReadGate; // second call's locked read blocks until the first call's transaction "commits"
      }

      const innerFakeTx = fakeTx; // service calls findSaleForUpdate/findSaleItemsForUpdate/etc. via the mocked repo functions below, not tx methods directly, so the fake tx object itself only needs to be a distinguishable value passed through

      vi.mocked(findSaleForUpdate).mockResolvedValueOnce({ ...sale } as never);
      vi.mocked(findSaleItemsForUpdate).mockResolvedValueOnce([
        { id: "item-1", saleId: "sale-1", productId: "prod-1", quantity: lineQuantity, returnedQuantity: sharedReturnedQuantity, soldPricePerUnit: "10.00", costPerUnit: "6.00" },
      ] as never);
      vi.mocked(updateSaleItemReturnedQuantity).mockImplementationOnce(async (_id, newQuantity) => {
        sharedReturnedQuantity = newQuantity;
      });

      const result = await callback(innerFakeTx as never);

      if (isFirstCall) {
        releaseSecondRead(); // simulate the first transaction's commit releasing the row lock
      }

      return result;
    });

    const callA = returnSaleItems({ saleId: "sale-1", userId: "user-1", items: [{ saleItemId: "item-1", quantity: 3 }] });
    const callB = returnSaleItems({ saleId: "sale-1", userId: "user-1", items: [{ saleItemId: "item-1", quantity: 3 }] });

    const results = await Promise.allSettled([callA, callB]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // With the lock's blocking behavior simulated: the first call sees
    // returnedQuantity=0 (remaining=5, requesting 3 succeeds); the second
    // call, blocked until the first commits, sees the now-updated
    // returnedQuantity=3 (remaining=2, requesting 3 correctly rejected) —
    // never both succeeding against the same stale remaining=5 snapshot,
    // which would let 6 units be returned against a line that only sold 5.
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InvalidReturnQuantityError);
    expect(sharedReturnedQuantity).toBe(3);
  });
});
