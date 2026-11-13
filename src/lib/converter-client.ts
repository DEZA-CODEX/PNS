export function converterApiUrl(path: string): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!configured) {
    throw new Error("NEXT_PUBLIC_API_BASE_URL is not configured.");
  }
  const base = new URL(
    configured,
    typeof window === "undefined" ? "http://localhost" : window.location.origin,
  );
  const suffix = path.replace(/^\/+/, "");
  return new URL(suffix, `${base.origin}/`).toString();
}

export async function converterFetch(path: string, init: RequestInit = {}) {
  return fetch(converterApiUrl(path), {
    ...init,
    credentials: "include",
    cache: "no-store",
  });
}
