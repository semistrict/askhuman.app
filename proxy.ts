import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function sessionRedirectTarget(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return `/session/${parts[1]}`;
  }
  return "/";
}

export function proxy(request: NextRequest) {
  const accept = request.headers.get("accept") || "";
  if (!accept.includes("text/html")) {
    return NextResponse.next();
  }

  const target = sessionRedirectTarget(request.nextUrl.pathname);
  return NextResponse.redirect(new URL(target, request.url));
}

export default proxy;

export const config = {
  matcher: [
    "/plan",
    "/plan/:path*",
    "/diff",
    "/diff/:path*",
  ],
};
