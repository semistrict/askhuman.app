export const dynamic = "force-dynamic";

const BOOKMARKLET_JS = String.raw`
(() => {
  const existing = window.__askhumanBookmarkletRunning;
  if (existing) return;
  window.__askhumanBookmarkletRunning = true;

  const scriptUrl = document.currentScript && document.currentScript.src
    ? document.currentScript.src
    : "https://askhuman.app/bookmarklet.js";
  const askhumanOrigin = new URL(scriptUrl).origin;
  const algorithm = "aes-256-cbc+hmac-sha256";

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

  async function copyOrPrompt(url) {
    try {
      await navigator.clipboard.writeText(url);
      alert("askhuman.app link copied to clipboard.");
    } catch {
      prompt("askhuman.app link", url);
    }
  }

  async function main() {
    if (!crypto?.subtle) {
      throw new Error("This browser does not expose Web Crypto on this page.");
    }

    const popup = window.open("about:blank", "_blank");
    if (popup) {
      popup.document.write("<!doctype html><title>askhuman.app</title><body style=\"font:16px system-ui;padding:24px\">Encrypting page snapshot...</body>");
    }

    showStatus("Encrypting page snapshot...");
    const html = snapshotHtml();
    const title = (document.title || location.href || "Page snapshot").replace(/\s+/g, " ").trim().slice(0, 140);
    const encrypted = await encryptHtml(html);

    showStatus("Uploading ciphertext...");
    const form = new FormData();
    form.set("version", "1");
    form.set("alg", algorithm);
    form.set("title", title || "Page snapshot");
    form.set("filename", safeFilename());
    form.set("iv", encrypted.iv);
    form.set("ciphertext", encrypted.ciphertext);
    form.set("mac", encrypted.mac);

    const response = await fetch(askhumanOrigin + "/upload", {
      method: "POST",
      headers: { Accept: "text/plain" },
      body: form,
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(responseText || "Upload failed.");
    }

    const finalUrl = responseText.trim() + "#k=" + encrypted.key;
    clearStatus();
    if (popup) {
      popup.location.href = finalUrl;
    } else {
      await copyOrPrompt(finalUrl);
    }
  }

  main().catch((error) => {
    clearStatus();
    const message = error instanceof Error ? error.message : String(error);
    alert("askhuman.app bookmarklet failed: " + message);
  }).finally(() => {
    window.__askhumanBookmarkletRunning = false;
  });
})();
`;

export async function GET() {
  return new Response(BOOKMARKLET_JS.trimStart(), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
