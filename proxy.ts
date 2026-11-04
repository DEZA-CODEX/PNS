import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_PATHS = new Set(["/admin/login", "/admin/forgot-password", "/admin/create-account"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");

  if (!isAdminPage) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get("pns_admin_session")?.value;
  if (AUTH_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  if (!sessionCookie) {
    const loginUrl = new URL("/admin/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
