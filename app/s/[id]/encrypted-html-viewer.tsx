"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { EncryptedHtmlPayload } from "@/lib/encrypted-html";
import { decryptEncryptedHtmlPayload } from "@/lib/encrypted-html";

const IFRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "frame-src 'none'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

type ViewerState =
  | { status: "loading" }
  | { status: "ready"; html: string }
  | { status: "error"; message: string };

type Props = {
  shareId: string;
  payload: EncryptedHtmlPayload | null;
  loadError?: string | null;
};

function readFragmentKey(): string | null {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const key = params.get("k");
  return key ? key.trim() : null;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function injectCsp(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(IFRAME_CSP)}">`;
  if (/<head(\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${meta}`);
  }
  if (/<html(\s[^>]*)?>/i.test(html)) {
    return html.replace(/<html(\s[^>]*)?>/i, (match) => `${match}<head>${meta}</head>`);
  }
  return `<!doctype html><html><head>${meta}</head><body>${html}</body></html>`;
}

function StatusMessage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="grid min-h-0 flex-1 place-items-center bg-[var(--background)] px-6 text-[var(--foreground)]">
      <div className="max-w-md border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[8px_8px_0_var(--hard-shadow)]">
        <h1 className="font-mono text-sm font-semibold uppercase">
          {title}
        </h1>
        <div className="mt-4 text-sm leading-6 text-[var(--muted-foreground)]">{children}</div>
      </div>
    </main>
  );
}

export function EncryptedHtmlViewer({ shareId, payload, loadError }: Props) {
  const [state, setState] = useState<ViewerState>({ status: "loading" });
  const label = useMemo(
    () => payload?.title || payload?.filename || `share ${shareId}`,
    [payload?.filename, payload?.title, shareId]
  );

  useEffect(() => {
    document.title = `${label} | askhuman.app`;
  }, [label]);

  useEffect(() => {
    let cancelled = false;

    async function decrypt() {
      if (loadError) {
        setState({ status: "error", message: loadError });
        return;
      }
      if (!payload) {
        setState({ status: "error", message: "This share was not found or has expired." });
        return;
      }

      const key = readFragmentKey();
      if (!key) {
        setState({
          status: "error",
          message: "This link is missing its #k= decryption key fragment.",
        });
        return;
      }

      try {
        const html = await decryptEncryptedHtmlPayload(payload, key);
        if (!cancelled) {
          setState({ status: "ready", html: injectCsp(html) });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not decrypt this share.";
        if (!cancelled) {
          setState({ status: "error", message });
        }
      }
    }

    decrypt();
    window.addEventListener("hashchange", decrypt);
    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", decrypt);
    };
  }, [loadError, payload]);

  return (
    <div className="flex h-screen flex-col bg-[var(--background)] text-[var(--foreground)]">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 font-mono text-[11px] uppercase">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            className="font-semibold underline-offset-4 hover:text-[var(--accent)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]"
          >
            askhuman.app
          </Link>
          <span className="truncate text-[var(--quiet-foreground)]">{label}</span>
        </div>
        <span className="shrink-0 text-[var(--accent)]">
          <span aria-hidden="true">🔒</span> end-to-end encrypted
        </span>
      </header>

      {state.status === "loading" && (
        <StatusMessage title="Decrypting">
          <p>Reading the key from the URL fragment and opening the HTML locally.</p>
        </StatusMessage>
      )}

      {state.status === "error" && (
        <StatusMessage title="Cannot Open Share">
          <p>{state.message}</p>
        </StatusMessage>
      )}

      {state.status === "ready" && (
        <iframe
          title={label}
          srcDoc={state.html}
          sandbox="allow-scripts allow-forms"
          allow="clipboard-write"
          referrerPolicy="no-referrer"
          className="min-h-0 flex-1 border-0 bg-[var(--iframe-background)]"
          {...{ csp: IFRAME_CSP }}
        />
      )}
    </div>
  );
}
