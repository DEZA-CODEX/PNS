"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminPanel } from "@/site-pages/AdminPanel";
import type { AdminUser } from "@/lib/admin-types";
import { apiFetch } from "@/lib/api-client";

type AdminSession = {
  user: AdminUser;
  permissions: string[];
};

export function AdminSessionGate() {
  const router = useRouter();
  const [session, setSession] = useState<AdminSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    void apiFetch("/admin/auth/me", { timeoutMs: 5_000 })
      .then(async (response) => {
        if (response.status === 401) {
          router.replace("/admin/login");
          return;
        }
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
        if (active) {
          setSession({ user: payload.user, permissions: payload.permissions });
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Admin session verification failed.");
        }
      });

    return () => {
      active = false;
    };
  }, [attempt, router]);

  if (session) {
    return <AdminPanel currentUser={session.user} permissions={session.permissions} />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-surface-cool)] px-6 text-[var(--color-text-primary)]">
      <div className="max-w-lg text-center">
        <p role={error ? "alert" : "status"} className="text-sm">
          {error ?? "Verifying administrator session..."}
        </p>
        {error ? (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setAttempt((current) => current + 1);
            }}
            className="mt-4 rounded-lg border border-[var(--color-border-warm)] px-4 py-2 text-sm"
          >
            Try again
          </button>
        ) : null}
      </div>
    </main>
  );
}
