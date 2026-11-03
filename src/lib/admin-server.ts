import { cookies } from "next/headers";
import type { AdminUser } from "@/lib/admin-types";
import { apiFetch } from "@/lib/api-client";

type AdminSession = {
  user: AdminUser;
  permissions: string[];
};

export async function getAdminSessionContext(): Promise<AdminSession | null> {
  const cookieHeader = (await cookies()).toString();
  const response = await apiFetch("/admin/auth/me", {
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status === 401) return null;
  if (!response.ok) {
    throw new Error(`Admin session verification failed with HTTP ${response.status}.`);
  }
  const payload = (await response.json()) as {
    authenticated?: boolean;
    user?: AdminUser;
    permissions?: string[];
  };
  if (!payload.authenticated || !payload.user || !Array.isArray(payload.permissions)) {
    throw new Error("The FastAPI admin session response was invalid.");
  }
  return { user: payload.user, permissions: payload.permissions };
}
