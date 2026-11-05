import type { NextConfig } from "next";

const configuredApiUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();

function getApiOrigin(configuredUrl: string | undefined) {
  if (!configuredUrl) return "";

  try {
    const apiUrl = new URL(configuredUrl);
    return ["http:", "https:"].includes(apiUrl.protocol) ? apiUrl.origin : "";
  } catch {
    return "";
  }
}

const apiOrigin = getApiOrigin(configuredApiUrl);
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  `connect-src ${["'self'", apiOrigin, "https://vitals.vercel-insights.com"].filter(Boolean).join(" ")}`,
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
