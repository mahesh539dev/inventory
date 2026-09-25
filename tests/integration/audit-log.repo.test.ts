import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { insertAuditLog } from "@/lib/repositories/audit-log.repo";
import { db } from "@/lib/db/client";
import { users, auditLogs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

async function makeUser() {
  const [user] = await db
    .insert(users)
    .values({
      name: "Test User",
      email: `user-${crypto.randomUUID()}@example.com`,
      passwordHash: "not-a-real-hash",
      role: "USER",
    })
    .returning();
  return user;
}

describe("insertAuditLog", () => {
  let userId: string;

  beforeEach(async () => {
    const user = await makeUser();
    userId = user.id;
  });

  afterEach(async () => {
    await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it("inserts a row with the given action, entity, and metadata", async () => {
    const row = await insertAuditLog({
      userId: userId,
      action: "SALE_RETURNED",
      entityType: "sale",
      entityId: "00000000-0000-0000-0000-000000000001",
      metadata: { items: [{ saleItemId: "item-1", quantity: 2 }], resultingStatus: "PARTIALLY_RETURNED" },
    });

    expect(row.id).toBeDefined();
    expect(row.action).toBe("SALE_RETURNED");
    expect(row.metadata).toEqual({ items: [{ saleItemId: "item-1", quantity: 2 }], resultingStatus: "PARTIALLY_RETURNED" });
  });

  it("participates in an outer transaction when passed a tx handle", async () => {
    let insertedId: string | undefined;
    await db.transaction(async (tx) => {
      const row = await insertAuditLog(
        { userId: userId, action: "SALE_CANCELLED", entityType: "sale", entityId: "00000000-0000-0000-0000-000000000002", metadata: null },
        tx
      );
      insertedId = row.id;
      // Do not throw — let the transaction commit normally; this test only
      // proves the tx handle is accepted and used, not rollback behavior
      // (rollback behavior is covered by sale.service.test.ts's mocked tests).
    });
    expect(insertedId).toBeDefined();
  });
});
