export type ApiRequestInit = RequestInit & { timeoutMs?: number };

export class ApiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiConfigurationError";
  }
}

function apiBaseUrl(): URL {
  const configured = process.env["NEXT_PUBLIC_API_BASE_URL"]?.trim();
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

export function apiFetch(path: string, init: ApiRequestInit = {}) {
  const { timeoutMs = 15_000, ...requestInit } = init;
  return fetch(apiUrl(path), {
    ...requestInit,
    credentials: "include",
    cache: requestInit.cache ?? "no-store",
    signal: requestInit.signal ?? AbortSignal.timeout(timeoutMs),
  });
}
