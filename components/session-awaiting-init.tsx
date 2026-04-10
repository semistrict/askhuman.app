"use client";

import { useEffect, useMemo, useState } from "react";
import {
  bindReviewerPresenceSync,
  handleDebugSocketMessage,
  handlePresenceSocketMessage,
  sendTabHello,
} from "@/lib/debug-tab-client";
import { SessionChrome } from "@/components/session-chrome";
import {
  buildEncryptedToolAgentInstructions,
  buildPlainToolContinueInstructions,
} from "@/lib/e2e-tool-payload";
import {
  generateEncryptedShareKeyPair,
  readStoredEncryptedShareKeyPair,
  writeStoredEncryptedShareKeyPair,
  type StoredEncryptedShareKeyPair,
} from "@/lib/encrypted-share";
import type { ToolId } from "@/lib/tools/types";

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
  const [copyError, setCopyError] = useState<string | null>(null);
  const [keyState, setKeyState] = useState<
    | { kind: "loading" }
    | { kind: "missing" }
    | { kind: "error"; message: string }
    | { kind: "ready"; keyPair: StoredEncryptedShareKeyPair }
  >({ kind: "loading" });

  const encryptableToolId = toolId && toolId !== "share" ? toolId : null;

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

  useEffect(() => {
    if (!encryptableToolId) {
      return;
    }
    try {
      const stored = readStoredEncryptedShareKeyPair(window.localStorage);
      setKeyState(stored ? { kind: "ready", keyPair: stored } : { kind: "missing" });
    } catch (error) {
      console.error("Failed to read encrypted share keypair from localStorage", error);
      setKeyState({
        kind: "error",
        message: "End-to-end encryption is unavailable in this browser because localStorage access failed.",
      });
    }
  }, [encryptableToolId]);

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
        `I have the encrypted share page ready: ${url}`,
        "If this browser needs a fresh encryption key, I will send you the copied public-key instructions from that page next.",
        `Continue by encrypting the document to my public key and POSTing the encrypted JSON envelope to /share/${sessionId}.`,
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
    setCopyError(null);
    window.setTimeout(() => setCopyState("idle"), 1500);
  }

  async function copyPlainPrompt() {
    if (!encryptableToolId) {
      await copyPrompt();
      return;
    }
    await navigator.clipboard.writeText(
      buildPlainToolContinueInstructions({
        toolId: encryptableToolId as Exclude<ToolId, "share">,
        sessionId,
        baseUrl: window.location.origin,
      })
    );
    setCopyState("copied");
    setCopyError(null);
    window.setTimeout(() => setCopyState("idle"), 1500);
  }

  async function copyEncryptedPrompt(keyPair: StoredEncryptedShareKeyPair) {
    if (!encryptableToolId) return;
    const response = await fetch("/k", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyId: keyPair.keyId,
        publicKeySpki: keyPair.publicKeySpki,
      }),
    });
    if (!response.ok) {
      throw new Error("Failed to upload public key reference.");
    }
    const payload = (await response.json()) as { url?: string };
    if (!payload.url) {
      throw new Error("Public key upload did not return a key URL.");
    }
    await navigator.clipboard.writeText(
      buildEncryptedToolAgentInstructions({
        toolId: encryptableToolId as Exclude<ToolId, "share">,
        sessionId,
        baseUrl: window.location.origin,
        publicKeyUrl: payload.url,
      })
    );
    setCopyState("copied");
    setCopyError(null);
    window.setTimeout(() => setCopyState("idle"), 1500);
  }

  async function enableEncryption() {
    try {
      const keyPair = await generateEncryptedShareKeyPair();
      writeStoredEncryptedShareKeyPair(window.localStorage, keyPair);
      setKeyState({ kind: "ready", keyPair });
      await copyEncryptedPrompt(keyPair);
    } catch (error) {
      console.error("Failed to enable optional end-to-end encryption", error);
      setCopyError(error instanceof Error ? error.message : "Unable to enable end-to-end encryption.");
    }
  }

  const showEncryptionActions = encryptableToolId && keyState.kind !== "error";

  return (
    <SessionChrome title={title} sessionId={sessionId}>
      <main className="flex flex-1 items-center justify-center px-8">
        <div className="max-w-lg rounded-2xl border border-border bg-card/60 p-8 text-center shadow-[0_24px_80px_-32px_rgba(0,0,0,0.55)]">
          <div className="mx-auto mb-4 h-12 w-12 animate-pulse rounded-full bg-muted" />
          <h2 className="mb-2 text-lg font-semibold">Waiting for agent to connect...</h2>
          <p className="mb-5 text-sm text-muted-foreground">{message}</p>
          {encryptableToolId ? (
            <>
              <p className="mb-5 text-sm text-muted-foreground">
                End-to-end encryption is preferred for this session, but you can skip it and continue
                with the normal plaintext workflow if you want.
              </p>
              <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
                {showEncryptionActions &&
                  (keyState.kind === "ready" ? (
                    <button
                      type="button"
                      onClick={() => void copyEncryptedPrompt(keyState.keyPair)}
                      className="inline-flex items-center justify-center rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:border-foreground/30 hover:bg-foreground hover:text-background"
                    >
                      {copyState === "copied" ? "Instructions copied" : "Copy End-to-End Instructions"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void enableEncryption()}
                      className="inline-flex items-center justify-center rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:border-foreground/30 hover:bg-foreground hover:text-background"
                    >
                      {copyState === "copied" ? "Instructions copied" : "Enable E2E & Copy Instructions"}
                    </button>
                  ))}
                <button
                  type="button"
                  onClick={() => void copyPlainPrompt()}
                  className="inline-flex items-center justify-center rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:border-foreground/30 hover:bg-foreground hover:text-background"
                >
                  Continue Without Encryption
                </button>
              </div>
              {keyState.kind === "error" && (
                <p className="mt-4 text-sm text-amber-300">{keyState.message}</p>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={copyPrompt}
              className="inline-flex items-center justify-center rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:border-foreground/30 hover:bg-foreground hover:text-background"
            >
              {copyState === "copied" ? "Prompt copied" : "Copy Prompt For Agent"}
            </button>
          )}
          {copyError && (
            <p className="mt-4 text-sm text-amber-300">{copyError}</p>
          )}
        </div>
      </main>
    </SessionChrome>
  );
}
