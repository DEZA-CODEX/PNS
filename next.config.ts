import type { NextConfig } from "next";

const configuredApiUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
if (!configuredApiUrl) {
  throw new Error("NEXT_PUBLIC_API_BASE_URL is required and must point to the FastAPI backend.");
}

let apiOrigin: string;
try {
  const apiUrl = new URL(configuredApiUrl);
  if (
    !["http:", "https:"].includes(apiUrl.protocol) ||
    !apiUrl.hostname ||
    apiUrl.username ||
    apiUrl.password ||
    apiUrl.search ||
    apiUrl.hash ||
    !["", "/", "/api", "/api/v1"].includes(apiUrl.pathname.replace(/\/+$/u, ""))
  ) {
    throw new Error();
  }
  apiOrigin = apiUrl.origin;
} catch {
  throw new Error("NEXT_PUBLIC_API_BASE_URL must be an absolute HTTP(S) backend URL.");
}

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  `connect-src 'self' ${apiOrigin} https://vitals.vercel-insights.com`,
  "frame-src https://www.google.com https://maps.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: contentSecurityPolicy }],
      },
    ];
  },
};

export default nextConfig;
