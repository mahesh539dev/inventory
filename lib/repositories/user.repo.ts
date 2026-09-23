import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

export async function findUserNamesByIds(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, ids));

  return new Map(rows.map((u) => [u.id, u.name]));
}
