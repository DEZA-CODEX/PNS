import { toast } from "sonner";

export type ApiRequestInit = RequestInit & { timeoutMs?: number };

export class ApiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiConfigurationError";
  }
}

const API_PREFIX = "/api/v1";

function apiBaseUrl(): URL {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!configured) {
    throw new ApiConfigurationError(
      "NEXT_PUBLIC_API_BASE_URL is not configured. Set it to the FastAPI URL.",
    );
  }

  const base = new URL(
    configured,
    typeof window === "undefined" ? "http://localhost" : window.location.origin,
  );

  base.pathname = `${API_PREFIX}/`;
  return base;
}

export function apiUrl(path: string): string {
  const base = apiBaseUrl();
  if (/^[a-z][a-z\d+.-]*:/iu.test(path) || path.startsWith("//")) {
    throw new ApiConfigurationError("API endpoint paths must be relative to the backend.");
  }

  let suffix = path.replace(/^\/+/, "");
  while (suffix === "api" || suffix.startsWith("api/")) {
    suffix = suffix.replace(/^api(?:\/v1)?(?:\/|$)/u, "");
  }

  const url = new URL(suffix, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(`${API_PREFIX}/`)) {
    throw new ApiConfigurationError("API endpoint paths must stay within the /api/v1 prefix.");
  }
  return url.toString();
}

export function apiResourceUrl(url: string) {
  if (!/^\/api(?:\/v1)?(?:\/|$)/u.test(url)) return url;
  return apiUrl(url);
}

export async function apiFetch(path: string, init: ApiRequestInit = {}) {
  const { timeoutMs = 15_000, ...requestInit } = init;
  const url = apiUrl(path);
  const headers = new Headers(requestInit.headers);
  if (typeof FormData !== "undefined" && requestInit.body instanceof FormData) {
    headers.delete("Content-Type");
  }

  try {
    return await fetch(url, {
      ...requestInit,
      headers,
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
