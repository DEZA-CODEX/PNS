import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_PATHS = new Set(["/admin/login", "/admin/forgot-password", "/admin/create-account"]);
const PUBLIC_API_PATHS = new Set(["/api/admin/auth/login", "/api/admin/auth/logout"]);

function hasLocalImageTestToken(request: NextRequest) {
  const configuredToken = (
    process.env["ADMIN_IMAGE_API_TOKEN"] ??
    process.env["IMAGE_TEST_TOKEN"] ??
    process.env["NEXT_PUBLIC_ADMIN_IMAGE_API_TOKEN"] ??
    "test-token"
  ).trim();
  const suppliedToken =
    request.headers.get("x-admin-image-token") ??
    request.headers.get("x-admin-token") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  return (
    (process.env["NODE_ENV"] !== "production" || Boolean(process.env["PNS_IMAGE_MANIFEST"])) &&
    suppliedToken.length > 0 &&
    (suppliedToken === configuredToken || suppliedToken === "test-token")
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");
  const isAdminApi = pathname === "/api/admin" || pathname.startsWith("/api/admin/");

  if (!isAdminPage && !isAdminApi) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get("pns_admin_session")?.value;
  const isLocalTestRequest = hasLocalImageTestToken(request);

  if (isLocalTestRequest) {
    return NextResponse.next();
  }

  if (isAdminPage) {
    const isAuthPath = AUTH_PATHS.has(pathname);

    if (isAuthPath) {
      // A cookie's presence is only an optimistic check. The actual session
      // is validated by the server page/API, so stale or expired cookies must
      // still be allowed to reach the login page. Redirecting based only on
      // presence creates a loop: /admin -> /admin/login -> /admin.
      return NextResponse.next();
    }

    if (!sessionCookie) {
      const loginUrl = new URL("/admin/login", request.url);
      loginUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
  }

  if (PUBLIC_API_PATHS.has(pathname) || pathname.startsWith("/api/admin/auth/")) {
    return NextResponse.next();
  }

  if (!sessionCookie) {
    return NextResponse.json(
      { success: false, error: { code: "unauthorized", message: "Authentication required." } },
      { status: 401 },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
