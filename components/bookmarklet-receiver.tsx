import { useEffect, useState, type ReactNode } from "react";
import {
  ENCRYPTED_HTML_ALGORITHM,
  ENCRYPTED_HTML_COMPRESSION,
  ENCRYPTED_HTML_KEY_BASE64URL_LENGTH,
  ENCRYPTED_HTML_VERSION,
  formatByteSize,
  MAX_UPLOAD_FORM_BYTES,
} from "@/lib/encrypted-html";

const SNAPSHOT_MESSAGE = "askhuman.bookmarklet.snapshot";
const READY_MESSAGE = "askhuman.bookmarklet.ready";
const RECEIVED_MESSAGE = "askhuman.bookmarklet.received";
const KEY_RE = new RegExp(`^[A-Za-z0-9_-]{${ENCRYPTED_HTML_KEY_BASE64URL_LENGTH}}$`);

type ReceiverState =
  | { status: "waiting" }
  | { status: "uploading"; title: string }
  | { status: "error"; message: string };

type SnapshotPayload = {
  version: typeof ENCRYPTED_HTML_VERSION;
  alg: typeof ENCRYPTED_HTML_ALGORITHM;
  compression?: typeof ENCRYPTED_HTML_COMPRESSION;
  title?: string;
  filename?: string;
  iv: string;
  ciphertext: string;
  mac: string;
  key: string;
};

function expectString(record: Record<string, unknown>, name: string): string {
  const value = record[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is missing.`);
  }
  return value.trim();
}

function parseSnapshotPayload(value: unknown): SnapshotPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Snapshot message is invalid.");
  }

  const record = value as Record<string, unknown>;
  if (record.version !== ENCRYPTED_HTML_VERSION) {
    throw new Error("Snapshot version is unsupported.");
  }
  if (record.alg !== ENCRYPTED_HTML_ALGORITHM) {
    throw new Error("Snapshot algorithm is unsupported.");
  }

  const key = expectString(record, "key");
  if (!KEY_RE.test(key)) {
    throw new Error("Snapshot key is invalid.");
  }
  if (
    "compression" in record &&
    record.compression !== undefined &&
    record.compression !== ENCRYPTED_HTML_COMPRESSION
  ) {
    throw new Error("Snapshot compression is unsupported.");
  }

  const title =
    typeof record.title === "string" && record.title.trim()
      ? record.title.replace(/\s+/g, " ").trim().slice(0, 140)
      : undefined;
  const filename =
    typeof record.filename === "string" && record.filename.trim()
      ? record.filename.trim().slice(0, 160)
      : undefined;

  return {
    version: ENCRYPTED_HTML_VERSION,
    alg: ENCRYPTED_HTML_ALGORITHM,
    ...(record.compression === ENCRYPTED_HTML_COMPRESSION
      ? { compression: ENCRYPTED_HTML_COMPRESSION }
      : {}),
    ...(title ? { title } : {}),
    ...(filename ? { filename } : {}),
    iv: expectString(record, "iv"),
    ciphertext: expectString(record, "ciphertext"),
    mac: expectString(record, "mac"),
    key,
  };
}

function replyToSource(event: MessageEvent, type: string): void {
  const source = event.source;
  if (!source || typeof source.postMessage !== "function") return;
  source.postMessage(
    { type },
    { targetOrigin: event.origin === "null" ? "*" : event.origin }
  );
}

function createUploadForm(payload: SnapshotPayload): FormData {
  const form = new FormData();
  form.set("version", String(payload.version));
  form.set("alg", payload.alg);
  if (payload.compression) form.set("compression", payload.compression);
  if (payload.title) form.set("title", payload.title);
  if (payload.filename) form.set("filename", payload.filename);
  form.set("iv", payload.iv);
  form.set("ciphertext", payload.ciphertext);
  form.set("mac", payload.mac);
  return form;
}

function payloadSizeMessage(size: number): string {
  return `${formatByteSize(size)} (${size.toLocaleString()} bytes). Limit: ${formatByteSize(MAX_UPLOAD_FORM_BYTES)} (${MAX_UPLOAD_FORM_BYTES.toLocaleString()} bytes).`;
}

async function createMeasuredUploadRequest(payload: SnapshotPayload): Promise<{
  request: Request;
  size: number;
}> {
  const request = new Request("/upload", {
    method: "POST",
    headers: { Accept: "text/plain" },
    body: createUploadForm(payload),
  });
  const size = (await request.clone().arrayBuffer()).byteLength;
  return { request, size };
}

async function uploadSnapshot(payload: SnapshotPayload): Promise<string> {
  const { request, size } = await createMeasuredUploadRequest(payload);
  if (size > MAX_UPLOAD_FORM_BYTES) {
    throw new Error(`Payload too large: ${payloadSizeMessage(size)}`);
  }

  const response = await fetch(request);
  const text = await response.text();
  if (!response.ok) {
    const message = text || response.statusText || "Upload failed.";
    if (response.status === 413 || /payload too large|too large/i.test(message)) {
      throw new Error(`${message.replace(/^Error:\s*/i, "").trim()} Payload size: ${payloadSizeMessage(size)}`);
    }
    throw new Error(message);
  }
  return text.trim();
}

function StatusMessage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--background)] px-6 text-[var(--foreground)]">
      <div className="max-w-md border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[8px_8px_0_var(--hard-shadow)]">
        <p className="font-mono text-[11px] uppercase leading-none text-[var(--accent)]">
          askhuman.app
        </p>
        <h1 className="mt-5 font-mono text-sm font-semibold uppercase">{title}</h1>
        <div className="mt-4 text-sm leading-6 text-[var(--muted-foreground)]">{children}</div>
      </div>
    </main>
  );
}

export function BookmarkletReceiver() {
  const [state, setState] = useState<ReceiverState>({ status: "waiting" });

  useEffect(() => {
    let received = false;

    function sendReady() {
      window.opener?.postMessage({ type: READY_MESSAGE }, "*");
    }

    async function onMessage(event: MessageEvent) {
      if (event.data?.type !== SNAPSHOT_MESSAGE || received) return;

      received = true;
      window.clearInterval(readyInterval);
      replyToSource(event, RECEIVED_MESSAGE);

      try {
        const payload = parseSnapshotPayload(event.data.payload);
        setState({ status: "uploading", title: payload.title || "Page snapshot" });
        const url = await uploadSnapshot(payload);
        window.location.href = `${url}#k=${payload.key}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not upload this snapshot.";
        setState({ status: "error", message });
      }
    }

    const readyInterval = window.setInterval(sendReady, 250);
    window.addEventListener("message", onMessage);
    sendReady();

    return () => {
      window.clearInterval(readyInterval);
      window.removeEventListener("message", onMessage);
    };
  }, []);

  if (state.status === "uploading") {
    return (
      <StatusMessage title="Uploading Snapshot">
        <p>Uploading encrypted HTML for {state.title}.</p>
      </StatusMessage>
    );
  }

  if (state.status === "error") {
    return (
      <StatusMessage title="Cannot Create Share">
        <p>{state.message}</p>
      </StatusMessage>
    );
  }

  return (
    <StatusMessage title="Waiting For Snapshot">
      <p>Run the askhuman snapshot bookmarklet from the page you want to share.</p>
    </StatusMessage>
  );
}
