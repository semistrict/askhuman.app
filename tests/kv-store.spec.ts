import { expect, test } from "@playwright/test";

const JSON_ACCEPT = { Accept: "application/json" };

function createSessionId() {
  return `kv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function postKvTx(
  request: { post: Function },
  sessionId: string,
  body: {
    baseVersion?: number | null;
    idempotencyKey?: string | null;
    ops: Array<{ op: "check" | "put" | "delete"; key: string; exists?: boolean; value?: unknown }>;
  }
) {
  return await request.post(`/s/${sessionId}/kv/tx`, {
    headers: JSON_ACCEPT,
    data: body,
  });
}

async function getKvEntry(
  request: { get: Function },
  sessionId: string,
  key: string
) {
  const response = await request.get(`/s/${sessionId}/kv?key=${encodeURIComponent(key)}`, {
    headers: JSON_ACCEPT,
  });
  expect(response.status()).toBe(200);
  return await response.json();
}

async function scanKv(
  request: { get: Function },
  sessionId: string,
  prefix: string,
  searchParams: { after?: string; limit?: number } = {}
) {
  const params = new URLSearchParams({ prefix });
  if (searchParams.after) {
    params.set("after", searchParams.after);
  }
  if (typeof searchParams.limit === "number") {
    params.set("limit", String(searchParams.limit));
  }
  const response = await request.get(`/s/${sessionId}/kv?${params.toString()}`, {
    headers: JSON_ACCEPT,
  });
  expect(response.status()).toBe(200);
  return await response.json();
}

function waitForWebSocketJson(
  ws: WebSocket,
  predicate: (data: unknown) => boolean,
  timeoutMs: number = 10_000
) {
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for websocket message"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener("message", handleMessage);
      ws.removeEventListener("error", handleError);
    };

    const handleError = () => {
      cleanup();
      reject(new Error("WebSocket error while waiting for kv message"));
    };

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(String(event.data));
        if (!predicate(data)) return;
        cleanup();
        resolve(data);
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };

    ws.addEventListener("message", handleMessage);
    ws.addEventListener("error", handleError);
  });
}

test.describe("Session KV Store", () => {
  test("writes, reads, scans, and conditionally updates JSON blobs", async ({ request }) => {
    const sessionId = createSessionId();

    const firstTx = await postKvTx(request, sessionId, {
      baseVersion: 0,
      idempotencyKey: "tx-1",
      ops: [
        { op: "put", key: "app/test/beta", value: { order: 2 } },
        { op: "put", key: "app/test/alpha", value: { order: 1 } },
      ],
    });
    expect(firstTx.status()).toBe(200);
    const firstBody = await firstTx.json();
    expect(firstBody).toMatchObject({
      ok: true,
      commitVersion: 1,
    });

    const entryBody = await getKvEntry(request, sessionId, "app/test/alpha");
    expect(entryBody.entry).toMatchObject({
      key: "app/test/alpha",
      value: { order: 1 },
      version: 1,
    });

    const scanBody = await scanKv(request, sessionId, "app/test/");
    expect(scanBody.entries.map((entry: { key: string }) => entry.key)).toEqual([
      "app/test/alpha",
      "app/test/beta",
    ]);

    const conditionalTx = await postKvTx(request, sessionId, {
      baseVersion: 1,
      idempotencyKey: "tx-2",
      ops: [
        { op: "check", key: "app/test/alpha", value: { order: 1 } },
        { op: "put", key: "app/test/alpha", value: { order: 3 } },
        { op: "delete", key: "app/test/beta" },
      ],
    });
    expect(conditionalTx.status()).toBe(200);
    const conditionalBody = await conditionalTx.json();
    expect(conditionalBody).toMatchObject({
      ok: true,
      commitVersion: 2,
    });

    const afterBody = await scanKv(request, sessionId, "app/test/");
    expect(afterBody.entries).toHaveLength(1);
    expect(afterBody.entries[0]).toMatchObject({
      key: "app/test/alpha",
      value: { order: 3 },
      version: 2,
    });

    const failedCheck = await postKvTx(request, sessionId, {
      baseVersion: 2,
      idempotencyKey: "tx-3",
      ops: [
        { op: "check", key: "app/test/alpha", value: { order: 1 } },
        { op: "put", key: "app/test/gamma", value: { order: 4 } },
      ],
    });
    expect(failedCheck.status()).toBe(412);
    expect(await failedCheck.json()).toMatchObject({
      ok: false,
      reason: "check_failed",
      key: "app/test/alpha",
    });
  });

  test("treats scan prefixes literally even when they include SQL wildcard characters", async ({
    request,
  }) => {
    const sessionId = createSessionId();

    const seed = await postKvTx(request, sessionId, {
      baseVersion: 0,
      idempotencyKey: "literal-prefixes",
      ops: [
        { op: "put", key: "app/test_under/real", value: { match: "underscore" } },
        { op: "put", key: "app/testXunder/nope", value: { match: "wrong-underscore" } },
        { op: "put", key: "app/test%percent/real", value: { match: "percent" } },
        { op: "put", key: "app/testZpercent/nope", value: { match: "wrong-percent" } },
      ],
    });
    expect(seed.status()).toBe(200);

    const underscoreScan = await scanKv(request, sessionId, "app/test_under/");
    expect(underscoreScan.entries.map((entry: { key: string }) => entry.key)).toEqual([
      "app/test_under/real",
    ]);

    const percentScan = await scanKv(request, sessionId, "app/test%percent/");
    expect(percentScan.entries.map((entry: { key: string }) => entry.key)).toEqual([
      "app/test%percent/real",
    ]);
  });

  test("allows idempotent retries after later commits and rejects stale new writes", async ({
    request,
  }) => {
    const sessionId = createSessionId();

    const firstTx = await postKvTx(request, sessionId, {
      baseVersion: 0,
      idempotencyKey: "retry-me",
      ops: [{ op: "put", key: "app/test/item", value: { value: 1 } }],
    });
    expect(firstTx.status()).toBe(200);
    const firstBody = await firstTx.json();
    expect(firstBody).toMatchObject({ ok: true, commitVersion: 1 });

    const secondTx = await postKvTx(request, sessionId, {
      baseVersion: 1,
      idempotencyKey: "later-write",
      ops: [{ op: "put", key: "app/test/later", value: { value: 2 } }],
    });
    expect(secondTx.status()).toBe(200);
    const secondBody = await secondTx.json();
    expect(secondBody).toMatchObject({ ok: true, commitVersion: 2 });

    const retryTx = await postKvTx(request, sessionId, {
      baseVersion: 0,
      idempotencyKey: "retry-me",
      ops: [{ op: "put", key: "app/test/item", value: { value: 1 } }],
    });
    expect(retryTx.status()).toBe(200);
    expect(await retryTx.json()).toMatchObject({
      ok: true,
      commitVersion: 1,
      changes: [{ op: "put", key: "app/test/item", value: { value: 1 } }],
    });

    const staleTx = await postKvTx(request, sessionId, {
      baseVersion: 0,
      idempotencyKey: "stale-write",
      ops: [{ op: "put", key: "app/test/stale", value: { value: 3 } }],
    });
    expect(staleTx.status()).toBe(409);
    expect(await staleTx.json()).toMatchObject({
      ok: false,
      reason: "version_conflict",
      currentVersion: 2,
    });
  });

  test("streams matching kv commits over websocket subscriptions", async ({ request }) => {
    const sessionId = createSessionId();
    const ws = new WebSocket(
      `ws://localhost:15032/s/${sessionId}/kv/ws?values=1&prefix=${encodeURIComponent("app/test/")}`
    );

    try {
      const subscribed = await waitForWebSocketJson(
        ws,
        (data) => !!data && typeof data === "object" && (data as { type?: string }).type === "kv_subscribed"
      );
      expect(subscribed).toMatchObject({
        type: "kv_subscribed",
        currentVersion: 0,
        prefixes: ["app/test/"],
        includeValues: true,
      });

      const commitPromise = waitForWebSocketJson(
        ws,
        (data) => !!data && typeof data === "object" && (data as { type?: string }).type === "kv_commit"
      );

      const response = await postKvTx(request, sessionId, {
        baseVersion: 0,
        idempotencyKey: "ws-1",
        ops: [
          { op: "put", key: "app/test/item", value: { visible: true } },
          { op: "put", key: "app/other/ignored", value: { visible: false } },
        ],
      });
      expect(response.status()).toBe(200);

      const commit = await commitPromise;
      expect(commit).toMatchObject({
        type: "kv_commit",
        commitVersion: 1,
        changes: [{ op: "put", key: "app/test/item", value: { visible: true } }],
      });
    } finally {
      ws.close();
    }
  });
});
