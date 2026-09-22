import { describe, it, expect, vi, beforeEach } from "vitest";

// This test deterministically proves the SERVICE'S OWN LOCKING LOGIC is
// correct — i.e. that adjustInventory checks `newQuantity < 0` using the
// value it read INSIDE its own transaction, not a value read before the
// transaction started — without depending on real database timing.
//
// Why this exists: tests/integration/inventory.service.test.ts originally
// tried to force two real `adjustInventory` calls to genuinely race against
// the dev database. Extensive diagnosis showed that against this project's
// Railway Postgres instance, two concurrent db.update()/db.transaction()
// calls serialize by ~1-1.5 seconds for reasons outside this service's
// control (ruled out: connection pool acquisition, Drizzle's transaction
// wrapper, raw SQL execution, and even updates to two unrelated rows all
// showed the same gap) — so no amount of Promise.allSettled/barrier
// trickery in test code could reliably force two calls to actually overlap
// at the read point. A test that can't force the race can't prove the lock
// prevents a lost update; it can only prove "these two calls didn't happen
// to collide this time," which is not the same claim.
//
// This test sidesteps that entirely: it fakes the `db` transaction/select
// layer so IT controls exactly when each of two concurrent adjustInventory
// calls reads the product row and when each is allowed to proceed to its
// update — deterministically simulating the exact "lost update" race a row
// lock exists to prevent, and proving the service's arithmetic-and-check
// logic behaves correctly under that interleaving. It does not (and cannot)
// prove that `.for("update")` compiles to real Postgres row-locking SQL —
// that's a Drizzle library guarantee, not application logic, and is
// spot-checked instead by reading the compiled SQL (see the plan's Task 3
// review notes, which confirmed `.for("update")` emits `for update` in the
// query by inspecting drizzle-orm's dialect source directly).

const mockProduct = {
  id: "prod-1",
  currentQuantity: 5,
};

vi.mock("@/lib/db/client", () => ({
  db: {
    transaction: vi.fn(),
  },
}));

vi.mock("@/lib/repositories/inventory.repo", () => ({
  insertInventoryTransaction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/services/product.service", () => ({
  ProductNotFoundError: class ProductNotFoundError extends Error {},
}));

import { db } from "@/lib/db/client";
import { insertInventoryTransaction } from "@/lib/repositories/inventory.repo";
import { adjustInventory, InsufficientInventoryError } from "@/lib/services/inventory.service";

describe("adjustInventory — deterministic lost-update simulation", () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockReset();
    vi.mocked(insertInventoryTransaction).mockClear();
    mockProduct.currentQuantity = 5;
  });

  it("prevents a lost update when two calls' reads are forced to interleave before either writes", async () => {
    // Simulates a real currentQuantity column shared between two "connections."
    // Each fake transaction reads the CURRENT value of this variable at the
    // moment its callback runs its select, and writes back at the moment its
    // callback runs its update — exactly mirroring what two real Postgres
    // sessions would see under `SELECT ... FOR UPDATE`: the second session's
    // select blocks until the first session's transaction commits, so it
    // always sees the post-update value, never the stale pre-update one.
    let sharedQuantity = 5;
    let firstTransactionStarted = false;
    let releaseSecondSelect!: () => void;
    const secondSelectGate = new Promise<void>((resolve) => {
      releaseSecondSelect = resolve;
    });

    vi.mocked(db.transaction).mockImplementation(async (callback) => {
      const isFirstCall = !firstTransactionStarted;
      firstTransactionStarted = true;

      if (!isFirstCall) {
        // The second call's "SELECT ... FOR UPDATE" blocks until the first
        // transaction's fake commit releases the gate — this is the row
        // lock's real-world effect, simulated directly instead of hoped for
        // over the network.
        await secondSelectGate;
      }

      const fakeTx = {
        select: () => ({
          from: () => ({
            where: () => ({
              for: () => Promise.resolve([{ ...mockProduct, currentQuantity: sharedQuantity }]),
            }),
          }),
        }),
        update: () => ({
          set: (values: { currentQuantity: number }) => ({
            where: () => ({
              returning: () => {
                sharedQuantity = values.currentQuantity;
                return Promise.resolve([{ ...mockProduct, currentQuantity: values.currentQuantity }]);
              },
            }),
          }),
        }),
      };

      const result = await callback(fakeTx as never);

      if (isFirstCall) {
        // Simulate the first transaction committing (and thereby releasing
        // its row lock) only after its own update has completed.
        releaseSecondSelect();
      }

      return result;
    });

    const callA = adjustInventory({
      productId: "prod-1",
      quantityDelta: -5,
      type: "ADJUSTMENT",
      notes: "Attempt A",
      userId: "user-1",
    });
    const callB = adjustInventory({
      productId: "prod-1",
      quantityDelta: -5,
      type: "ADJUSTMENT",
      notes: "Attempt B",
      userId: "user-1",
    });

    const results = await Promise.allSettled([callA, callB]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // With the lock's blocking behavior simulated, exactly one call sees
    // the pre-update quantity (5) and succeeds; the other sees the
    // already-updated quantity (0) and is correctly rejected.
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientInventoryError);

    // Exactly one insertInventoryTransaction call — proving the rejected
    // attempt's error was thrown BEFORE any write, not after a partial one.
    expect(insertInventoryTransaction).toHaveBeenCalledTimes(1);

    expect(sharedQuantity).toBe(0);
  });

  it("demonstrates the lost-update bug this locking exists to prevent, when reads are NOT serialized", async () => {
    // Same simulation, but WITHOUT the lock's blocking behavior: both fake
    // transactions read the pre-update quantity (5) because neither waits
    // for the other to commit first — exactly what would happen if
    // `.for("update")` were removed from the real service. This test
    // exists to prove the simulation harness itself is meaningful (i.e. it
    // CAN fail), not to test adjustInventory — it deliberately does not
    // call the real service's locking behavior differently, it changes
    // what the fake `tx` returns to simulate the row lock being absent.
    let sharedQuantity = 5;

    vi.mocked(db.transaction).mockImplementation(async (callback) => {
      // No gate here — both calls' selects race freely, and since this
      // mock resolves selects synchronously-ish (no real await boundary
      // before reading `sharedQuantity`), both read 5 before either writes,
      // reproducing the lost-update race a row lock prevents.
      const fakeTx = {
        select: () => ({
          from: () => ({
            where: () => ({
              for: () => Promise.resolve([{ ...mockProduct, currentQuantity: sharedQuantity }]),
            }),
          }),
        }),
        update: () => ({
          set: (values: { currentQuantity: number }) => ({
            where: () => ({
              returning: () => {
                sharedQuantity = values.currentQuantity;
                return Promise.resolve([{ ...mockProduct, currentQuantity: values.currentQuantity }]);
              },
            }),
          }),
        }),
      };

      return callback(fakeTx as never);
    });

    const results = await Promise.allSettled([
      adjustInventory({
        productId: "prod-1",
        quantityDelta: -5,
        type: "ADJUSTMENT",
        notes: "Attempt A",
        userId: "user-1",
      }),
      adjustInventory({
        productId: "prod-1",
        quantityDelta: -5,
        type: "ADJUSTMENT",
        notes: "Attempt B",
        userId: "user-1",
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");

    // Both succeed when reads aren't serialized — this is the bug a real
    // row lock prevents. This test passing confirms the harness above (with
    // the gate) is a meaningful simulation, not a tautology that always
    // reports "1 fulfilled" regardless of locking behavior.
    expect(fulfilled.length).toBe(2);
    expect(insertInventoryTransaction).toHaveBeenCalledTimes(2);
  });
});
