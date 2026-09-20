import { requireUser } from "@/lib/auth/guards";
import { MobileNav } from "@/components/nav/MobileNav";
import { DesktopSidebar } from "@/components/nav/DesktopSidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();

  return (
    <div className="flex min-h-dvh">
      <DesktopSidebar />
      <main className="flex-1 pb-16 md:pb-0">{children}</main>
      <MobileNav />
    </div>
  );
}
