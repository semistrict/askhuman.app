"use client";

import { useEffect, useMemo, useState } from "react";
import {
  bindReviewerPresenceSync,
  handleDebugSocketMessage,
  handlePresenceSocketMessage,
  sendTabHello,
} from "@/lib/debug-tab-client";
import { SessionChrome } from "@/components/session-chrome";

export function SessionAwaitingInit({
  sessionId,
  title,
  message,
  toolId,
}: {
  sessionId: string;
  title: string;
  message: string;
  toolId: string | null;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/s/${sessionId}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.addEventListener("open", () => {
      sendTabHello(ws, "awaiting_init");
    });

    ws.addEventListener("message", async (event) => {
      const data = JSON.parse(event.data);
      if (handlePresenceSocketMessage(data)) return;
      if (await handleDebugSocketMessage(ws, data)) return;
      if (data.type === "view") {
        window.location.reload();
      }
    });

    const cleanupPresenceSync = bindReviewerPresenceSync(ws);
    return () => {
      cleanupPresenceSync();
      ws.close();
    };
  }, [sessionId]);

  const agentPrompt = useMemo(() => {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const url = origin ? `${origin}/s/${sessionId}` : `/s/${sessionId}`;
    if (toolId === "diff") {
      return [
        `I have opened the diff review page: ${url}`,
        `Continue now by POSTing the diff payload to /diff/${sessionId}.`,
        "Do not wait for any further confirmation from me.",
      ].join("\n");
    }
    if (toolId === "present") {
      return [
        `I have opened the presentation review page: ${url}`,
        `Continue now by POSTing the presentation markdown to /present/${sessionId}.`,
        "Do not wait for any further confirmation from me.",
      ].join("\n");
    }
    if (toolId === "playground") {
      return [
        `I have opened the playground review page: ${url}`,
        `Continue now by POSTing the HTML payload to /playground/${sessionId}.`,
        "Do not wait for any further confirmation from me.",
      ].join("\n");
    }
    if (toolId === "share") {
      return [
        `I have the encrypted share page ready: ${url}#key=YOUR_LOCAL_KEY`,
        `Continue now by POSTing the encrypted JSON envelope to /share/${sessionId}.`,
        "Do not wait for any further confirmation from me.",
      ].join("\n");
    }
    return [
      `I have opened the review page: ${url}`,
      `Continue now by POSTing the review content to /review/${sessionId}.`,
      "Do not wait for any further confirmation from me.",
    ].join("\n");
  }, [sessionId, toolId]);

  async function copyPrompt() {
    await navigator.clipboard.writeText(agentPrompt);
    setCopyState("copied");
    window.setTimeout(() => setCopyState("idle"), 1500);
  }

  return (
    <SessionChrome title={title} sessionId={sessionId}>
      <main className="flex flex-1 items-center justify-center px-8">
        <div className="max-w-lg rounded-2xl border border-border bg-card/60 p-8 text-center shadow-[0_24px_80px_-32px_rgba(0,0,0,0.55)]">
          <div className="mx-auto mb-4 h-12 w-12 animate-pulse rounded-full bg-muted" />
          <h2 className="mb-2 text-lg font-semibold">Waiting for agent to connect...</h2>
          <p className="mb-5 text-sm text-muted-foreground">{message}</p>
          <button
            type="button"
            onClick={copyPrompt}
            className="inline-flex items-center justify-center rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:border-foreground/30 hover:bg-foreground hover:text-background"
          >
            {copyState === "copied" ? "Prompt copied" : "Copy Prompt For Agent"}
          </button>
        </div>
      </main>
    </SessionChrome>
  );
}
