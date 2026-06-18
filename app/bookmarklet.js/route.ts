import { buildHostedBookmarkletScript } from "@/lib/bookmarklet-code";

export const dynamic = "force-dynamic";

const BOOKMARKLET_JS = buildHostedBookmarkletScript();

export async function GET() {
  return new Response(BOOKMARKLET_JS.trimStart(), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
