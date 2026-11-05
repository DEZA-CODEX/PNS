import type { Metadata } from "next";
import { AdminSessionGate } from "@/admin/AdminSessionGate";

export const metadata: Metadata = { title: "Admin Dashboard" };

export default function Page() {
  return <AdminSessionGate />;
}
