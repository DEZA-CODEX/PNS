import type { Metadata } from "next";
import { AdminPanel } from "@/site-pages/AdminPanel";
import { getPageAdminContext } from "@/lib/admin-auth";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Admin Dashboard" };
// The dashboard reads the authenticated session and must be rendered per request.
export const dynamic = "force-dynamic";

export default async function Page() {
  const context = await getPageAdminContext();
  if (!context) redirect("/admin/login");

  return <AdminPanel currentUser={context.user} permissions={[...context.permissions]} />;
}
