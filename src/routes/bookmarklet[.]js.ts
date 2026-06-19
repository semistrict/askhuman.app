import { createFileRoute } from "@tanstack/react-router";
import { buildHostedBookmarkletScript } from "@/lib/bookmarklet-code";

const BOOKMARKLET_JS = buildHostedBookmarkletScript();

export const Route = createFileRoute("/bookmarklet.js")({
  server: {
    handlers: {
      GET: async () =>
        new Response(BOOKMARKLET_JS.trimStart(), {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          },
        }),
    },
  },
});
