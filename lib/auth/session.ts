import { auth } from "@/auth";

export type SessionUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  role: "ADMIN" | "USER";
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user) return null;

  const role = (session.user as { role?: string }).role;
  if (role !== "ADMIN" && role !== "USER") return null;

  return session.user as SessionUser;
}
