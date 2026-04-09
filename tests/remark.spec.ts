import { test, expect } from "@playwright/test";

const JSON_ACCEPT = { Accept: "application/json" };

const REMARK_MARKDOWN = `# Opening

Welcome to the deck.

---

# Second Slide

This slide contains anchorable text for feedback.
`;

async function createRemarkSession(
  request: { post: Function },
  markdown: string = REMARK_MARKDOWN
) {
  const multipart: Record<string, string> = { markdown };
  const res = await request.post("/present", {
    headers: JSON_ACCEPT,
    multipart,
  });
  expect(res.status()).toBe(200);
  return await res.json();
}

function postDoneAfterDelay(
  request: { post: (url: string, options?: { data?: unknown }) => Promise<unknown> },
  sessionId: string,
  delayMs: number = 100
) {
  return new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      request
        .post(`/s/${sessionId}/done`)
        .then(() => resolve(), reject);
    }, delayMs);
  });
}

test.describe("Presentation", () => {
  test("creates a presentation session with remark as the default mode", async ({ request }) => {
    const body = await createRemarkSession(request);
    expect(body.sessionId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body.url).toContain(`/s/${body.sessionId}`);
    expect(body.message).toContain(`/present/${body.sessionId}/poll`);
    expect(body.message).toContain("Presentation review session created.");
  });

  test("rejects the removed mode field", async ({ request }) => {
    const res = await request.post("/present", {
      headers: JSON_ACCEPT,
      multipart: {
        markdown: REMARK_MARKDOWN,
        mode: "revealjs",
      },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("no longer configurable");
  });

  test("browser renders remark slides and allows navigation", async ({ page, request }) => {
    const { sessionId } = await createRemarkSession(request);
    await page.goto(`/s/${sessionId}`);

    await expect(page.getByRole("heading", { name: "Presentation" })).toBeVisible();
    await expect(page.getByText("Remark", { exact: true })).toBeVisible();
    await expect(page.getByText("Welcome to the deck.")).toBeVisible();

    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("heading", { name: "Second Slide" })).toBeVisible();
    await expect(page.getByText("This slide contains anchorable text for feedback.")).toBeVisible();
  });

  test("selection comments include selected text and context in poll output", async ({ page, request }) => {
    const { sessionId } = await createRemarkSession(request);
    await page.goto(`/s/${sessionId}`);
    await page.getByRole("button", { name: "Next" }).click();

    await page.locator("main article p").filter({
      hasText: "This slide contains anchorable text for feedback.",
    }).evaluate((element) => {
      const node = element.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) {
        throw new Error("Expected text node inside remark paragraph");
      }
      const text = node.textContent ?? "";
      const start = text.indexOf("anchorable text");
      const end = start + "anchorable text".length;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    await expect(page.getByText("Anchored Comment", { exact: true })).toBeVisible();

    await page.getByPlaceholder("Comment on this selection...").fill("Tighten this wording.");
    await page.getByRole("button", { name: "Comment on Selection" }).click();
    await expect(page.getByText("Tighten this wording.")).toBeVisible();

    const delayedDone = postDoneAfterDelay(request, sessionId, 300);
    await page.locator("aside").getByRole("button", { name: "Done" }).click();

    const pollRes = await request.get(`/present/${sessionId}/poll`, {
      headers: JSON_ACCEPT,
      timeout: 10000,
    });
    await delayedDone;
    const body = await pollRes.json();
    expect(body.status).toBe("done");
    expect(body.threads[0].selection_text).toContain("anchorable text");
    expect(body.threads[0].selection_context).toContain("feedback");
    expect(body.threads[0].location_label).toContain("slide 2");
    expect(body.threads[0].messages[0].text).toBe("Tighten this wording.");
  });

  test("updating a presentation session resets done and marks old comments outdated", async ({ page, request }) => {
    const { sessionId } = await createRemarkSession(request);
    await request.post(`/s/${sessionId}/threads`, {
      data: { text: "Old note" },
    });
    await request.post(`/s/${sessionId}/done`);

    await page.goto(`/s/${sessionId}`);
    await expect(page.getByText("Old note")).toBeVisible();

    const updateRes = await request.post("/present", {
      headers: JSON_ACCEPT,
      multipart: {
        sessionId,
        markdown: "# Updated Deck\n\nFresh slide.",
      },
    });
    expect(updateRes.status()).toBe(200);

    await expect(page.getByText("Updated Deck")).toBeVisible();
    await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
    await expect(page.getByText("outdated")).toBeVisible();
  });
});
