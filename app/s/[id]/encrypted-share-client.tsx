"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SessionChrome } from "@/components/session-chrome";
import {
  buildEncryptedShareAgentInstructions,
  decryptEncryptedShare,
  generateEncryptedShareKeyPair,
  parseEncryptedSharePayload,
  readStoredEncryptedShareKeyPair,
  writeStoredEncryptedShareKeyPair,
  type StoredEncryptedShareKeyPair,
} from "@/lib/encrypted-share";
import {
  bindReviewerPresenceSync,
  handleDebugSocketMessage,
  handlePresenceSocketMessage,
  sendTabHello,
} from "@/lib/debug-tab-client";

type LoadState =
  | { kind: "loading" }
  | { kind: "needs_key" }
  | { kind: "error"; message: string }
  | { kind: "ready"; markdown: string };

type KeyState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "ready"; keyPair: StoredEncryptedShareKeyPair }
  | { kind: "error"; message: string };

export function EncryptedShareClient({
  sessionId,
  payload,
  isDone: initialIsDone,
}: {
  sessionId: string;
  payload: string;
  isDone: boolean;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [keyState, setKeyState] = useState<KeyState>({ kind: "loading" });
  const [isDone, setIsDone] = useState(initialIsDone);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    try {
      const stored = readStoredEncryptedShareKeyPair(window.localStorage);
      if (stored) {
        setKeyState({ kind: "ready", keyPair: stored });
      } else {
        setKeyState({ kind: "missing" });
      }
    } catch (error) {
      setKeyState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to access localStorage for encrypted share keys.",
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (keyState.kind === "loading") {
        setState({ kind: "loading" });
        return;
      }
      if (keyState.kind === "missing") {
        setState({ kind: "needs_key" });
        return;
      }
      if (keyState.kind === "error") {
        setState({ kind: "error", message: keyState.message });
        return;
      }
      if (!payload.trim()) {
        setState({ kind: "loading" });
        return;
      }

      try {
        const parsed = parseEncryptedSharePayload(JSON.parse(payload));
        const markdown = await decryptEncryptedShare(parsed, keyState.keyPair);
        if (!cancelled) {
          setState({ kind: "ready", markdown });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            kind: "error",
            message:
              error instanceof Error
                ? error.message
                : "Unable to decrypt this document.",
          });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [keyState, payload]);

  async function copyAgentInstructions(keyPair: StoredEncryptedShareKeyPair) {
    try {
      const response = await fetch("/k", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          keyId: keyPair.keyId,
          publicKeySpki: keyPair.publicKeySpki,
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to upload public key reference.");
      }
      const payload = (await response.json()) as { url?: string };
      if (typeof payload.url !== "string" || !payload.url) {
        throw new Error("Public key upload did not return a key URL.");
      }
      await navigator.clipboard.writeText(
        buildEncryptedShareAgentInstructions({
          sessionId,
          baseUrl: window.location.origin,
          publicKeyUrl: payload.url,
        })
      );
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus("idle"), 1500);
    } catch {
      setCopyStatus("failed");
    }
  }

  async function enableEncryption() {
    try {
      const keyPair = await generateEncryptedShareKeyPair();
      writeStoredEncryptedShareKeyPair(window.localStorage, keyPair);
      setKeyState({ kind: "ready", keyPair });
      await copyAgentInstructions(keyPair);
    } catch (error) {
      setKeyState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to generate and store the encrypted share keypair.",
      });
    }
  }

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/s/${sessionId}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.addEventListener("open", () => {
      sendTabHello(ws);
    });

    ws.addEventListener("message", async (event) => {
      const data = JSON.parse(event.data);
      if (handlePresenceSocketMessage(data)) return;
      if (await handleDebugSocketMessage(ws, data)) return;
      if (data.type === "view") {
        window.location.reload();
      } else if (data.type === "done") {
        setIsDone(true);
      }
    });

    const cleanupPresenceSync = bindReviewerPresenceSync(ws);
    return () => {
      cleanupPresenceSync();
      ws.close();
    };
  }, [sessionId]);

  return (
    <SessionChrome
      title="Encrypted Share"
      sessionId={sessionId}
      headerBadges={
        <Badge variant="outline" className="font-mono text-xs">
          end-to-end encrypted
        </Badge>
      }
    >
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-8">
        <div className="flex items-center justify-between rounded-2xl border border-border bg-card/70 px-5 py-4 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.55)]">
          <div>
            <h2 className="text-base font-semibold">Encrypted document share</h2>
            <p className="text-sm text-muted-foreground">
              The private key stays in this browser's localStorage and the page only shares a short-lived public-key URL with the agent.
            </p>
            {copyStatus === "copied" && (
              <p className="mt-2 text-sm text-emerald-300">Agent instructions copied.</p>
            )}
            {copyStatus === "failed" && (
              <p className="mt-2 text-sm text-amber-300">
                Clipboard access failed. Try the copy button again from this page.
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {keyState.kind === "ready" && (
              <Button
                variant="outline"
                onClick={async () => {
                  await copyAgentInstructions(keyState.keyPair);
                }}
              >
                Copy Agent Instructions
              </Button>
            )}
            <Button
              onClick={async () => {
                await fetch(`/s/${sessionId}/done`, { method: "POST" });
                setIsDone(true);
              }}
              disabled={isDone || state.kind !== "ready"}
            >
              {isDone ? "Done" : "Done Reading"}
            </Button>
          </div>
        </div>

        {state.kind === "loading" && (
          <section className="rounded-3xl border border-border bg-card/60 px-8 py-16 text-center shadow-[0_24px_80px_-32px_rgba(0,0,0,0.55)]">
            <h3 className="text-lg font-semibold">Waiting for encrypted content…</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              The agent still needs to upload the ciphertext envelope for this session.
            </p>
          </section>
        )}

        {state.kind === "needs_key" && (
          <section className="rounded-3xl border border-amber-500/30 bg-amber-500/5 px-8 py-16 text-center shadow-[0_24px_80px_-32px_rgba(0,0,0,0.55)]">
            <h3 className="text-lg font-semibold">Enable end-to-end encryption?</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              This encrypted-share workflow stores a private key in this browser with localStorage.
              If you continue, the app will generate your keypair locally, upload a 24-hour
              public-key reference, and copy the agent instructions to your clipboard.
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button onClick={() => void enableEncryption()}>
                Enable & Copy Instructions
              </Button>
            </div>
          </section>
        )}

        {state.kind === "error" && (
          <section className="rounded-3xl border border-red-500/30 bg-red-500/5 px-8 py-16 text-center shadow-[0_24px_80px_-32px_rgba(0,0,0,0.55)]">
            <h3 className="text-lg font-semibold">Unable to decrypt document</h3>
            <p className="mt-2 text-sm text-muted-foreground">{state.message}</p>
          </section>
        )}

        {state.kind === "ready" && (
          <section className="rounded-3xl border border-border bg-card/70 px-8 py-10 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.55)]">
            <article className="prose prose-invert max-w-none text-[1.02rem] leading-8">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {state.markdown}
              </ReactMarkdown>
            </article>
          </section>
        )}
      </main>
    </SessionChrome>
  );
}
