export const BOOKMARKLET_RECEIVER_PATH = "/bookmarklet-receiver";

export function buildBookmarkletRuntime(originExpression: string): string {
  return String.raw`
(() => {
  if (window.__askhumanBookmarkletRunning) return;
  window.__askhumanBookmarkletRunning = true;

  const askhumanOrigin = ${originExpression};
  const receiverUrl = askhumanOrigin + "${BOOKMARKLET_RECEIVER_PATH}";
  const algorithm = "aes-256-cbc+hmac-sha256";
  const messageType = "askhuman.bookmarklet.snapshot";
  const readyType = "askhuman.bookmarklet.ready";
  const receivedType = "askhuman.bookmarklet.received";

  function bytesToBase64Url(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function toArrayBuffer(bytes) {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
  }

  function concatBytes(...parts) {
    const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.byteLength;
    }
    return result;
  }

  function doctypeToString() {
    const doctype = document.doctype;
    if (!doctype) return "<!doctype html>\n";
    let value = "<!doctype " + doctype.name;
    if (doctype.publicId) value += ' PUBLIC "' + doctype.publicId + '"';
    if (doctype.systemId) value += ' "' + doctype.systemId + '"';
    return value + ">\n";
  }

  function snapshotHtml() {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll("[data-askhuman-bookmarklet]").forEach((node) => node.remove());

    const head = clone.querySelector("head");
    if (head && !head.querySelector("base")) {
      const base = document.createElement("base");
      base.href = location.href;
      head.insertBefore(base, head.firstChild);
    }

    return doctypeToString() + clone.outerHTML;
  }

  function safeFilename() {
    const path = location.pathname.replace(/\/+$/g, "").split("/").filter(Boolean).pop();
    const stem = path || location.hostname || "page";
    return (stem.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "page") + ".html";
  }

  function showStatus(message) {
    let status = document.querySelector("[data-askhuman-bookmarklet='status']");
    if (!status) {
      status = document.createElement("div");
      status.dataset.askhumanBookmarklet = "status";
      Object.assign(status.style, {
        position: "fixed",
        zIndex: "2147483647",
        top: "16px",
        right: "16px",
        maxWidth: "320px",
        padding: "12px 14px",
        border: "1px solid #d8f3ff",
        background: "#07111f",
        color: "#eef7ff",
        font: "13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        boxShadow: "6px 6px 0 #000",
      });
      document.documentElement.appendChild(status);
    }
    status.textContent = message;
  }

  function clearStatus() {
    document.querySelector("[data-askhuman-bookmarklet='status']")?.remove();
  }

  async function encryptHtml(html) {
    const rawKey = crypto.getRandomValues(new Uint8Array(64));
    const aesKeyBytes = rawKey.slice(0, 32);
    const macKeyBytes = rawKey.slice(32);
    const iv = crypto.getRandomValues(new Uint8Array(16));
    const plaintext = new TextEncoder().encode(html);
    const aesKey = await crypto.subtle.importKey("raw", toArrayBuffer(aesKeyBytes), { name: "AES-CBC" }, false, ["encrypt"]);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: toArrayBuffer(iv) }, aesKey, toArrayBuffer(plaintext)));
    const macKey = await crypto.subtle.importKey("raw", toArrayBuffer(macKeyBytes), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", macKey, toArrayBuffer(concatBytes(iv, ciphertext))));

    return {
      key: bytesToBase64Url(rawKey),
      iv: bytesToBase64Url(iv),
      ciphertext: bytesToBase64Url(ciphertext),
      mac: bytesToBase64Url(mac),
    };
  }

  function waitForReceiver(popup, payload) {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const cleanup = () => {
        clearInterval(interval);
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
      };
      const send = () => {
        attempts += 1;
        try {
          popup.postMessage({ type: messageType, payload }, askhumanOrigin);
        } catch {}
      };
      const onMessage = (event) => {
        if (event.origin !== askhumanOrigin) return;
        if (event.data?.type === readyType) {
          send();
        }
        if (event.data?.type === receivedType) {
          cleanup();
          resolve();
        }
      };
      const interval = setInterval(() => {
        if (attempts > 60) return;
        send();
      }, 250);
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("The askhuman receiver tab did not respond."));
      }, 16000);

      window.addEventListener("message", onMessage);
      send();
    });
  }

  async function main() {
    if (!crypto?.subtle) {
      throw new Error("This browser does not expose Web Crypto on this page.");
    }

    const popup = window.open(receiverUrl, "_blank");
    if (!popup) {
      throw new Error("Popup was blocked. Allow popups for this page and try again.");
    }

    showStatus("Encrypting page snapshot...");
    const html = snapshotHtml();
    const title = (document.title || location.href || "Page snapshot").replace(/\s+/g, " ").trim().slice(0, 140);
    const encrypted = await encryptHtml(html);
    const payload = {
      version: 1,
      alg: algorithm,
      title: title || "Page snapshot",
      filename: safeFilename(),
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
      mac: encrypted.mac,
      key: encrypted.key,
    };

    showStatus("Sending encrypted snapshot to askhuman.app...");
    await waitForReceiver(popup, payload);
    clearStatus();
  }

  main().catch((error) => {
    clearStatus();
    const message = error instanceof Error ? error.message : String(error);
    alert("askhuman.app bookmarklet failed: " + message);
  }).finally(() => {
    window.__askhumanBookmarkletRunning = false;
  });
})();
`.trim();
}

export function buildHostedBookmarkletScript(): string {
  return buildBookmarkletRuntime(
    `new URL(document.currentScript && document.currentScript.src ? document.currentScript.src : "https://askhuman.app/bookmarklet.js").origin`
  );
}

export function buildInlineBookmarkletHref(origin: string): string {
  return `javascript:${encodeURIComponent(buildBookmarkletRuntime(JSON.stringify(origin.replace(/\/$/, ""))))}`;
}
