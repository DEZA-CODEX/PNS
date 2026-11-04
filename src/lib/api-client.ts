import { toast } from "sonner";

export type ApiRequestInit = RequestInit & { timeoutMs?: number };

export class ApiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiConfigurationError";
  }
}

function apiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!configured) {
    throw new ApiConfigurationError(
      "NEXT_PUBLIC_API_BASE_URL is not configured. Set it to the FastAPI URL.",
    );
  }

  const base = configured.replace(/\/+$/u, "");
  return base.endsWith("/api/v1") ? base : `${base}/api/v1`;
}

export function apiUrl(path: string) {
  const base = apiBaseUrl();
  const suffix = path.replace(/^\/+/, "");
  return `${base}/${suffix}`;
}

export function apiResourceUrl(url: string) {
  if (!url.startsWith("/api/v1/")) return url;
  return apiUrl(url.slice("/api/v1/".length));
}

export async function apiFetch(path: string, init: ApiRequestInit = {}) {
  const { timeoutMs = 15_000, ...requestInit } = init;
  const url = apiUrl(path);
  try {
    return await fetch(url, {
      ...requestInit,
      credentials: "include",
      cache: requestInit.cache ?? "no-store",
      signal: requestInit.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError")) {
      const message = `Backend was not connected or did not respond while requesting ${path}.`;
      console.error(message, error);
      if (typeof window !== "undefined") {
        toast.error(message, { id: "backend-not-connected" });
      }
    }
    throw error;
  }
}
