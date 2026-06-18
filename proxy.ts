import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function isCurlRequest(request: NextRequest): boolean {
  const ua = request.headers.get("user-agent") || "";
  return /^curl\//i.test(ua);
}

export function proxy(request: NextRequest) {
  if (!isCurlRequest(request)) {
    return NextResponse.next();
  }

  const text = [
    "This encrypted viewer URL is meant for the human's browser, not curl.",
    "",
    "Give the full URL, including its #k= fragment, to the human.",
    "The fragment contains the decryption key and is never sent to askhuman.app.",
    "",
  ].join("\n");

  return new NextResponse(text, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export default proxy;

export const config = {
  matcher: ["/s/:id"],
};
