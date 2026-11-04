import { toast } from "sonner";

export type ApiRequestInit = RequestInit & { timeoutMs?: number };

export class ApiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiConfigurationError";
  }
}

function apiBaseUrl(): URL {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!configured) {
    throw new ApiConfigurationError(
      "NEXT_PUBLIC_API_BASE_URL is not configured. Set it to the FastAPI /api/v1 URL.",
    );
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new ApiConfigurationError(
      "NEXT_PUBLIC_API_BASE_URL must be an absolute HTTP or HTTPS URL.",
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new ApiConfigurationError(
      "NEXT_PUBLIC_API_BASE_URL must be an HTTP or HTTPS URL without credentials, query, or fragment.",
    );
  }
  url.pathname = url.pathname.replace(/\/+$/u, "");
  if (!url.pathname.endsWith("/api/v1")) {
    throw new ApiConfigurationError(
      "NEXT_PUBLIC_API_BASE_URL must point to the FastAPI API root and end in /api/v1.",
    );
  }
  return url;
}

export function apiUrl(path: string) {
  const base = apiBaseUrl();
  const suffix = path.replace(/^\/+/, "");
  return new URL(suffix, `${base.toString().replace(/\/+$/u, "")}/`).toString();
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
      const message = `Backend was not connected or did not respond while requesting ${new URL(url).pathname}.`;
      console.error(message, error);
      if (typeof window !== "undefined") {
        toast.error(message, { id: "backend-not-connected" });
      }
    }
    throw error;
  }
}
