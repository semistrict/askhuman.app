import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function isCurlRequest(request: NextRequest): boolean {
  const ua = request.headers.get("user-agent") || "";
  return /^curl\//i.test(ua);
}

function sessionRedirectTarget(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return `/s/${parts[1]}`;
  }
  return "/";
}

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/s/") && isCurlRequest(request)) {
    const url = request.nextUrl.toString();
    const text = [
      "This URL is meant for the human reviewer, not the agent.",
      "",
      "Show it to the same user you are already interacting with, or open it in their browser with:",
      `open "${url}"`,
      `xdg-open "${url}"`,
      "",
      "For agent-side automation, use the diff session, request, reply, dismiss, and complete curl endpoints instead.",
      "",
    ].join("\n");
    return new NextResponse(text, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (request.nextUrl.pathname.startsWith("/s/")) {
    return NextResponse.next();
  }

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
    "/s/:id",
    "/plan",
    "/plan/:path*",
    "/diff",
    "/diff/:path*",
  ],
};
