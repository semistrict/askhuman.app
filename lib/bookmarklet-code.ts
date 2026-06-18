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

  function absolutizeUrl(value, baseUrl) {
    const trimmed = String(value || "").trim();
    if (!trimmed || /^(#|data:|blob:|javascript:|mailto:|tel:)/i.test(trimmed)) return value;
    try {
      return new URL(trimmed, baseUrl || location.href).href;
    } catch {
      return value;
    }
  }

  function absolutizeCss(cssText, baseUrl) {
    return String(cssText || "").replace(/url\(([^)]+)\)/gi, (match, rawUrl) => {
      const unquoted = rawUrl.trim().replace(/^["']|["']$/g, "");
      const absolute = absolutizeUrl(unquoted, baseUrl);
      return absolute === unquoted ? match : 'url("' + absolute.replace(/"/g, '\\"') + '")';
    });
  }

  function absolutizeSrcset(value, baseUrl) {
    return String(value || "")
      .split(",")
      .map((candidate) => {
        const parts = candidate.trim().split(/\s+/);
        if (!parts[0]) return "";
        parts[0] = absolutizeUrl(parts[0], baseUrl);
        return parts.join(" ");
      })
      .filter(Boolean)
      .join(", ");
  }

  function readableStylesheetCss() {
    const chunks = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const rules = sheet.cssRules;
        if (!rules) continue;
        const css = Array.from(rules)
          .map((rule) => absolutizeCss(rule.cssText, sheet.href || location.href))
          .join("\n");
        if (css) chunks.push(css);
      } catch {}
    }
    return chunks.join("\n\n");
  }

  function serializeComputedStyle(style) {
    const declarations = [];
    for (let index = 0; index < style.length; index += 1) {
      const name = style[index];
      const value = style.getPropertyValue(name);
      if (!value) continue;
      const priority = style.getPropertyPriority(name);
      declarations.push(name + ":" + value + (priority ? " !important" : "") + ";");
    }
    return declarations.join("");
  }

  function copyElementSnapshot(source, clone) {
    if (!(source instanceof Element) || !(clone instanceof Element)) return;
    try {
      clone.setAttribute("style", serializeComputedStyle(getComputedStyle(source)));
    } catch {}

    if (source instanceof HTMLInputElement && clone instanceof HTMLInputElement) {
      clone.setAttribute("value", source.value);
      if (source.checked) clone.setAttribute("checked", "");
      else clone.removeAttribute("checked");
    } else if (source instanceof HTMLTextAreaElement && clone instanceof HTMLTextAreaElement) {
      clone.textContent = source.value;
    } else if (source instanceof HTMLOptionElement && clone instanceof HTMLOptionElement) {
      if (source.selected) clone.setAttribute("selected", "");
      else clone.removeAttribute("selected");
    } else if (source instanceof HTMLCanvasElement && clone instanceof HTMLCanvasElement) {
      try {
        const image = document.createElement("img");
        image.src = source.toDataURL("image/png");
        image.width = source.width;
        image.height = source.height;
        image.alt = clone.getAttribute("aria-label") || "Canvas snapshot";
        clone.replaceWith(image);
      } catch {}
    }
  }

  function copyComputedSnapshots(sourceRoot, cloneRoot) {
    copyElementSnapshot(sourceRoot, cloneRoot);
    const sourceWalker = document.createTreeWalker(sourceRoot, 1);
    const cloneWalker = document.createTreeWalker(cloneRoot, 1);
    while (true) {
      const source = sourceWalker.nextNode();
      const clone = cloneWalker.nextNode();
      if (!source || !clone) break;
      copyElementSnapshot(source, clone);
    }
  }

  function absolutizeCloneAttributes(clone) {
    const urlAttributes = ["href", "src", "poster", "action", "cite", "data"];
    clone.querySelectorAll("*").forEach((element) => {
      for (const name of urlAttributes) {
        if (element.hasAttribute(name)) {
          element.setAttribute(name, absolutizeUrl(element.getAttribute(name), location.href));
        }
      }
      if (element.hasAttribute("srcset")) {
        element.setAttribute("srcset", absolutizeSrcset(element.getAttribute("srcset"), location.href));
      }
      if (element.hasAttribute("style")) {
        element.setAttribute("style", absolutizeCss(element.getAttribute("style"), location.href));
      }
    });
  }

  function prepareHeadForOffline(clone) {
    const head = clone.querySelector("head") || clone.insertBefore(document.createElement("head"), clone.firstChild);
    if (!head.querySelector("meta[charset]")) {
      const charset = document.createElement("meta");
      charset.setAttribute("charset", document.characterSet || "utf-8");
      head.insertBefore(charset, head.firstChild);
    }
    if (!head.querySelector("base")) {
      const base = document.createElement("base");
      base.href = location.href;
      head.insertBefore(base, head.firstChild);
    }
    head.querySelectorAll('link[rel~="stylesheet"]').forEach((node) => node.remove());
    head.querySelectorAll("style").forEach((node) => {
      node.textContent = absolutizeCss(node.textContent || "", location.href);
    });

    const css = readableStylesheetCss();
    if (css) {
      const style = document.createElement("style");
      style.dataset.askhumanOfflineCss = "readable-stylesheets";
      style.textContent = css;
      head.appendChild(style);
    }
  }

  function snapshotHtml() {
    const clone = document.documentElement.cloneNode(true);
    copyComputedSnapshots(document.documentElement, clone);
    clone.querySelectorAll("[data-askhuman-bookmarklet]").forEach((node) => node.remove());
    clone.querySelectorAll("script").forEach((node) => node.remove());
    prepareHeadForOffline(clone);
    absolutizeCloneAttributes(clone);

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

  async function gzipBytes(bytes) {
    if (typeof CompressionStream !== "function") {
      throw new Error("This browser does not support gzip CompressionStream.");
    }
    const stream = new Blob([toArrayBuffer(bytes)]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function encryptHtml(html) {
    const rawKey = crypto.getRandomValues(new Uint8Array(64));
    const aesKeyBytes = rawKey.slice(0, 32);
    const macKeyBytes = rawKey.slice(32);
    const iv = crypto.getRandomValues(new Uint8Array(16));
    const plaintext = await gzipBytes(new TextEncoder().encode(html));
    const aesKey = await crypto.subtle.importKey("raw", toArrayBuffer(aesKeyBytes), { name: "AES-CBC" }, false, ["encrypt"]);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: toArrayBuffer(iv) }, aesKey, toArrayBuffer(plaintext)));
    const macKey = await crypto.subtle.importKey("raw", toArrayBuffer(macKeyBytes), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", macKey, toArrayBuffer(concatBytes(iv, ciphertext))));

    return {
      key: bytesToBase64Url(rawKey),
      compression: "gzip",
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

    showStatus("Serializing offline page...");
    const html = snapshotHtml();
    const title = (document.title || location.href || "Page snapshot").replace(/\s+/g, " ").trim().slice(0, 140);
    showStatus("Compressing and encrypting page snapshot...");
    const encrypted = await encryptHtml(html);
    const payload = {
      version: 1,
      alg: algorithm,
      compression: encrypted.compression,
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
