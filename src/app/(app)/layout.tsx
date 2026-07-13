import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppNav } from "@/components/nav/app-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AppNav userLabel={session.user.name ?? session.user.email ?? ""} />
      <div className="flex-1">{children}</div>
    </div>
  );
}
