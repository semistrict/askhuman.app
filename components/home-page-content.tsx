"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { buildInlineBookmarkletHref } from "@/lib/bookmarklet-code";

const ROOT_COMMAND = "curl -s https://askhuman.app";

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const didCopy = document.execCommand("copy");
    textarea.remove();
    if (!didCopy) {
      throw new Error("Clipboard copy was blocked.");
    }
  }
}

function CopyBlock({
  label,
  value,
  copyValue: valueToCopy,
}: {
  label: string;
  value: ReactNode;
  copyValue?: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    if (status === "idle") return;
    const timeout = window.setTimeout(() => setStatus("idle"), 1800);
    return () => window.clearTimeout(timeout);
  }, [status]);

  async function copyValue() {
    try {
      await copyText(valueToCopy ?? String(value));
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }

  const statusText =
    status === "copied" ? "copied" : status === "error" ? "copy blocked" : "copy command";

  return (
    <button
      type="button"
      onClick={copyValue}
      className="group block w-full border border-[var(--border)] bg-[var(--surface)] p-4 text-left shadow-[5px_5px_0_var(--hard-shadow)] transition-transform hover:-translate-y-0.5 hover:shadow-[7px_7px_0_var(--hard-shadow)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]"
    >
      <span className="mb-2 flex items-center justify-between gap-3 font-mono text-[11px] uppercase text-[var(--accent)]">
        <span>{label}</span>
        <span
          aria-live="polite"
          className={
            status === "copied"
              ? "text-[var(--accent)]"
              : status === "error"
                ? "text-[var(--destructive)]"
                : "text-[var(--quiet-foreground)]"
          }
        >
          {statusText}
        </span>
      </span>
      <blockquote className="border-l-4 border-[var(--accent)] pl-4 text-sm leading-7 text-[var(--muted-foreground)]">
        {value}
      </blockquote>
    </button>
  );
}

export function HomePageContent() {
  const bookmarkletRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    bookmarkletRef.current?.setAttribute(
      "href",
      buildInlineBookmarkletHref(window.location.origin)
    );
  }, []);

  return (
    <main className="min-h-screen bg-[var(--background)] px-5 py-8 text-[var(--foreground)] sm:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-5xl content-center gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[8px_8px_0_var(--hard-shadow)]">
          <p className="font-mono text-xs uppercase text-[var(--accent)]">askhuman.app</p>
          <h1 className="mt-5 max-w-lg text-4xl font-medium leading-tight sm:text-5xl">
            Encrypted HTML links for agent-made pages.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-[var(--muted-foreground)]">
            The server stores ciphertext for seven days. The browser gets the key from the URL
            fragment and renders the decrypted single-file HTML in a sandbox.
          </p>
        </section>

        <section className="grid content-center gap-5">
          <CopyBlock
            label="Agent starts here"
            value={
              <>
                Run <code className="font-mono">curl -s https://askhuman.app</code> and follow
                the instructions to upload the HTML file.
              </>
            }
            copyValue={ROOT_COMMAND}
          />

          <div className="border border-[var(--border)] bg-[var(--surface)] p-4 text-sm leading-7 text-[var(--muted-foreground)] shadow-[5px_5px_0_var(--hard-shadow)]">
            <p>
              The curl response gives the agent the OpenSSL recipe, the upload endpoint, and the
              exact rule that the final URL must end with <code className="font-mono">#k=...</code>.
            </p>
          </div>

          <div className="border border-[var(--border)] bg-[var(--surface)] p-4 text-sm leading-7 text-[var(--muted-foreground)] shadow-[5px_5px_0_var(--hard-shadow)]">
            <p className="font-mono text-[11px] uppercase leading-none text-[var(--accent)]">
              Browser bookmarklet
            </p>
            <a
              ref={bookmarkletRef}
              href="/bookmarklet.js"
              className="mt-3 inline-block border border-[var(--border)] px-3 py-2 font-mono text-xs uppercase text-[var(--foreground)] shadow-[3px_3px_0_var(--hard-shadow)] transition-transform hover:-translate-y-0.5 hover:shadow-[5px_5px_0_var(--hard-shadow)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]"
            >
              askhuman snapshot
            </a>
            <p className="mt-3">
              Drag it to your bookmarks bar. Click it on a page to encrypt a DOM snapshot and open
              the share link in askhuman.app.
            </p>
          </div>

          <div className="flex gap-5 font-mono text-xs">
            <a
              href="https://github.com/semistrict/askhuman.app"
              className="text-[var(--foreground)] underline decoration-[var(--accent)] underline-offset-4"
            >
              github
            </a>
            <a
              href="/llms.txt"
              className="text-[var(--foreground)] underline decoration-[var(--accent)] underline-offset-4"
            >
              llms.txt
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
