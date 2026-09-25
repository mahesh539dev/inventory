import { db } from "@/lib/db/client";
import { auditLogs } from "@/lib/db/schema";
import type { DbOrTx } from "./inventory.repo";

export type AuditLogRow = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

export async function insertAuditLog(
  data: NewAuditLog,
  executor: DbOrTx = db
): Promise<AuditLogRow> {
  const [row] = await executor.insert(auditLogs).values(data).returning();
  return row;
}
