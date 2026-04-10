"use client";

import { useEffect, useState } from "react";
import type { Thread } from "@/worker/session";
import { FileReviewClient } from "./file-review-client";
import { DiffReviewClient } from "./diff-review-client";
import { PresentClient } from "./remark-client";
import { PlaygroundClient } from "./playground-client";
import { SessionChrome } from "@/components/session-chrome";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  buildEncryptedSessionErrorInstructions,
  detectEncryptedShareKeyMismatch,
  decryptEncryptedShare,
  parseEncryptedSharePayload,
  readStoredEncryptedShareKeyPair,
  type StoredEncryptedShareKeyPair,
} from "@/lib/encrypted-share";
import {
  buildEncryptedToolAgentInstructions,
  isEncryptedDocReviewPayload,
  parseEncryptedToolPayload,
  type EncryptedToolPayload,
} from "@/lib/e2e-tool-payload";
import { parseDiffToClientHunks } from "@/lib/diff-client";
import type { ToolId } from "@/lib/tools/types";

type LoadState =
  | { kind: "loading" }
  | { kind: "mismatch"; recipientKeyId: string; currentKeyId: string }
  | { kind: "error"; message: string }
  | { kind: "ready"; payload: EncryptedToolPayload };

export function EncryptedToolClient({
  sessionId,
  toolId,
  payload,
  initialThreads,
  isDone,
}: {
  sessionId: string;
  toolId: Exclude<ToolId, "share">;
  payload: string;
  initialThreads: Thread[];
  isDone: boolean;
}) {
  const [keyPair, setKeyPair] = useState<StoredEncryptedShareKeyPair | null>(null);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [errorCopyStatus, setErrorCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [reviewModeReady, setReviewModeReady] = useState(toolId !== "review");

  useEffect(() => {
    try {
      setKeyPair(readStoredEncryptedShareKeyPair(window.localStorage));
    } catch (error) {
      console.error("Failed to read encrypted tool keypair from localStorage", error);
      setState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "This encrypted session needs the same local keypair that was used when encryption was enabled.",
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!payload.trim()) {
        setState({ kind: "loading" });
        return;
      }
      if (!keyPair) {
        setState({
          kind: "error",
          message: "This encrypted session needs the same local keypair that was used when encryption was enabled.",
        });
        return;
      }

      try {
        const envelope = parseEncryptedSharePayload(JSON.parse(payload));
        const mismatch = detectEncryptedShareKeyMismatch(envelope, keyPair);
        if (mismatch) {
          if (!cancelled) {
            setState({ kind: "mismatch", ...mismatch });
          }
          return;
        }
        const plaintext = await decryptEncryptedShare(envelope, keyPair);
        const parsed = parseEncryptedToolPayload(toolId, plaintext);
        if (!cancelled) {
          setState({ kind: "ready", payload: parsed });
        }
      } catch (error) {
        console.error("Failed to load encrypted tool payload", error);
        if (!cancelled) {
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : "Unable to decrypt this session.",
          });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [keyPair, payload, toolId]);

  useEffect(() => {
    if (state.kind !== "ready" || state.payload.type !== "review") {
      setReviewModeReady(toolId !== "review");
      return;
    }

    if (!isEncryptedDocReviewPayload(state.payload)) {
      setReviewModeReady(true);
      return;
    }

    let cancelled = false;
    setReviewModeReady(false);

    async function syncReviewMode() {
      try {
        const response = await fetch(`/s/${sessionId}/review-mode`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "doc" }),
        });
        if (!response.ok) {
          throw new Error("Failed to sync encrypted doc review mode.");
        }
        if (!cancelled) {
          setReviewModeReady(true);
        }
      } catch (error) {
        console.error("Failed to sync encrypted review mode", error);
        if (!cancelled) {
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : "Unable to prepare this encrypted review.",
          });
        }
      }
    }

    void syncReviewMode();
    return () => {
      cancelled = true;
    };
  }, [sessionId, state, toolId]);

  async function copyFreshInstructions() {
    if (!keyPair) return;
    try {
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
      const body = (await response.json()) as { url?: string };
      if (!body.url) {
        throw new Error("Public key upload did not return a key URL.");
      }
      await navigator.clipboard.writeText(
        buildEncryptedToolAgentInstructions({
          toolId,
          sessionId,
          baseUrl: window.location.origin,
          publicKeyUrl: body.url,
        })
      );
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus("idle"), 1500);
    } catch (error) {
      console.error("Failed to copy fresh encrypted-tool instructions", error);
      setCopyStatus("failed");
    }
  }

  async function copyErrorForAgent(message: string) {
    try {
      await navigator.clipboard.writeText(
        buildEncryptedSessionErrorInstructions({
          toolId,
          sessionId,
          message,
          currentKeyId: keyPair?.keyId ?? null,
        })
      );
      setErrorCopyStatus("copied");
      window.setTimeout(() => setErrorCopyStatus("idle"), 1500);
    } catch (error) {
      console.error("Failed to copy encrypted-session error for agent", error);
      setErrorCopyStatus("failed");
    }
  }

  if (state.kind === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Waiting for encrypted content…</p>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <SessionChrome
        title="Encrypted Session"
        sessionId={sessionId}
        headerBadges={
          <Badge variant="outline" className="font-mono text-xs">
            end-to-end encrypted
          </Badge>
        }
      >
        <main className="flex flex-1 items-center justify-center bg-background px-6">
          <div className="max-w-lg rounded-2xl border border-border bg-card/60 p-8 text-center shadow-[0_24px_80px_-32px_rgba(0,0,0,0.55)]">
            <h2 className="mb-2 text-lg font-semibold">Unable to decrypt session</h2>
            <p className="text-sm text-muted-foreground">{state.message}</p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button variant="outline" onClick={() => void copyErrorForAgent(state.message)}>
                Copy Error for Agent
              </Button>
            </div>
            {errorCopyStatus === "copied" && (
              <p className="mt-4 text-sm text-emerald-300">Error details copied for the agent.</p>
            )}
            {errorCopyStatus === "failed" && (
              <p className="mt-4 text-sm text-amber-300">Unable to copy error details. Try again.</p>
            )}
          </div>
        </main>
      </SessionChrome>
    );
  }

  if (state.kind === "mismatch") {
    return (
      <SessionChrome
        title="Encrypted Session"
        sessionId={sessionId}
        headerBadges={
          <Badge variant="outline" className="font-mono text-xs">
            end-to-end encrypted
          </Badge>
        }
      >
        <main className="flex flex-1 items-center justify-center bg-background px-6">
          <div className="max-w-lg rounded-2xl border border-amber-500/30 bg-amber-500/5 p-8 text-center shadow-[0_24px_80px_-32px_rgba(0,0,0,0.55)]">
            <h2 className="mb-2 text-lg font-semibold">Keys out of sync</h2>
            <p className="text-sm text-muted-foreground">
              The agent encrypted this session for a different local key than the one currently
              stored in this browser.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Agent used <code>{state.recipientKeyId}</code>. This browser currently has{" "}
              <code>{state.currentKeyId}</code>.
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button variant="outline" onClick={() => void copyFreshInstructions()}>
                Copy Fresh Instructions
              </Button>
            </div>
            {copyStatus === "copied" && (
              <p className="mt-4 text-sm text-emerald-300">Fresh agent instructions copied.</p>
            )}
            {copyStatus === "failed" && (
              <p className="mt-4 text-sm text-amber-300">Unable to copy instructions. Try again.</p>
            )}
            <p className="mt-4 text-sm text-muted-foreground">
              Copy fresh instructions for the agent, then ask it to retry with your current key.
            </p>
          </div>
        </main>
      </SessionChrome>
    );
  }

  if (!reviewModeReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Preparing encrypted review…</p>
      </div>
    );
  }

  if (state.payload.type === "review") {
    return (
      <FileReviewClient
        sessionId={sessionId}
        files={state.payload.files}
        initialThreads={initialThreads}
        isDone={isDone}
        reviewMode={isEncryptedDocReviewPayload(state.payload) ? "doc" : "files"}
      />
    );
  }

  if (state.payload.type === "diff") {
    return (
      <DiffReviewClient
        sessionId={sessionId}
        description={state.payload.description}
        hunks={parseDiffToClientHunks(state.payload.diff)}
        initialThreads={initialThreads}
        isDone={isDone}
      />
    );
  }

  if (state.payload.type === "present") {
    return (
      <PresentClient
        sessionId={sessionId}
        markdown={state.payload.markdown}
        initialThreads={initialThreads}
        isDone={isDone}
      />
    );
  }

  return (
    <PlaygroundClient
      sessionId={sessionId}
      html={state.payload.html}
      initialThreads={initialThreads}
      isDone={isDone}
    />
  );
}
