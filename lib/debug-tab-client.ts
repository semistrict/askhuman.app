import { ensureReviewerPresenceName } from "@/lib/app-settings";

type DebugEvalMessage = {
  type: "debug_eval";
  requestId: string;
  code: string;
};

type DebugEvalResultMessage = {
  type: "debug_eval_result";
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

type TabHelloMessage = {
  type: "tab_hello";
  url: string;
  title: string;
  userAgent: string;
  reviewerName: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function serializeDebugValue(
  value: unknown,
  seen = new WeakSet<object>(),
  depth: number = 0
): unknown {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (depth >= 4) return "[Max depth reached]";
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (value instanceof Element) {
    return {
      tagName: value.tagName,
      id: value.id || null,
      className: value.className || null,
      textContent: value.textContent?.slice(0, 500) ?? "",
      outerHTML: value.outerHTML.slice(0, 1000),
    };
  }
  if (value instanceof Node) {
    return {
      nodeType: value.nodeType,
      nodeName: value.nodeName,
      textContent: value.textContent?.slice(0, 500) ?? "",
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeDebugValue(item, seen, depth + 1));
  }
  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (!isPlainObject(value)) {
      const ctor = (value as { constructor?: { name?: string } }).constructor?.name;
      if (ctor && ctor !== "Object") {
        return {
          type: ctor,
          value: String(value),
        };
      }
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      out[key] = serializeDebugValue(entry, seen, depth + 1);
    }
    return out;
  }
  return String(value);
}

async function executeDebugCode(code: string): Promise<unknown> {
  return await (0, eval)(`(async () => {\n${code}\n})()`);
}

export function sendTabHello(ws: WebSocket) {
  const payload: TabHelloMessage = {
    type: "tab_hello",
    url: window.location.href,
    title: document.title,
    userAgent: navigator.userAgent,
    reviewerName: ensureReviewerPresenceName(window.localStorage),
  };
  ws.send(JSON.stringify(payload));
}

export async function handleDebugSocketMessage(
  ws: WebSocket,
  data: unknown
): Promise<boolean> {
  if (!data || typeof data !== "object" || (data as { type?: string }).type !== "debug_eval") {
    return false;
  }

  const message = data as DebugEvalMessage;
  const response: DebugEvalResultMessage = {
    type: "debug_eval_result",
    requestId: message.requestId,
    ok: true,
  };

  try {
    const value = await executeDebugCode(message.code);
    response.result = serializeDebugValue(value);
  } catch (error) {
    response.ok = false;
    response.error =
      error instanceof Error
        ? `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`
        : String(error);
  }

  ws.send(JSON.stringify(response));
  return true;
}
