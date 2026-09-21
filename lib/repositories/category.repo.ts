import { db } from "@/lib/db/client";
import { categories } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

export async function findOrCreateCategory(name: string): Promise<{ id: string; name: string }> {
  const trimmed = name.trim();

  const [existing] = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(sql`lower(${categories.name}) = lower(${trimmed})`)
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(categories)
    .values({ name: trimmed })
    .returning({ id: categories.id, name: categories.name });

  return created;
}

export async function listCategories(): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .orderBy(categories.name);
}
