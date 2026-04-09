import { expect, test } from "@playwright/test";

const JSON_ACCEPT = { Accept: "application/json" };

const PRESENT_MARKDOWN = `# Opening

Welcome to the deck.

---

# Second Slide

This slide contains anchorable text for feedback.
`;

async function startPresentSession(request: { post: Function }) {
  const res = await request.post("/present", { headers: JSON_ACCEPT });
  expect(res.status()).toBe(200);
  return await res.json();
}

function submitPresentSession(sessionId: string, markdown: string, extra: Record<string, string> = {}) {
  const formData = new FormData();
  formData.set("markdown", markdown);
  for (const [key, value] of Object.entries(extra)) {
    formData.set(key, value);
  }
  return fetch(`http://localhost:15032/present/${sessionId}`, {
    method: "POST",
    headers: JSON_ACCEPT,
    body: formData,
  });
}

test.describe("Presentation", () => {
  test("starts a presentation session and returns the nested action endpoint", async ({
    request,
  }) => {
    const body = await startPresentSession(request);
    expect(body.sessionId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body.url).toContain(`/s/${body.sessionId}`);
    expect(body.message).toContain("Chrome app mode");
    expect(body.next).toContain(`/present/${body.sessionId}`);
  });

  test("bootstrap rejects a presentation payload on the root endpoint", async ({ request }) => {
    const res = await request.post("/present", {
      headers: JSON_ACCEPT,
      multipart: { markdown: PRESENT_MARKDOWN },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("POST /present only creates an empty presentation session");
  });

  test("browser renders slides after the action initializes the session", async ({ page, request }) => {
    const { sessionId } = await startPresentSession(request);
    const actionPromise = submitPresentSession(sessionId, PRESENT_MARKDOWN);
    await page.goto(`/s/${sessionId}`);
    await expect(page.getByRole("heading", { name: "Presentation" })).toBeVisible();
    await expect(page.getByText("Welcome to the deck.")).toBeVisible();

    await request.post(`/s/${sessionId}/done`);
    const actionRes = await actionPromise;
    expect(actionRes.status).toBe(200);
    expect((await actionRes.json()).status).toBe("done");
  });

  test("selection comments include selection text and context in the action response", async ({
    page,
    request,
  }) => {
    const { sessionId } = await startPresentSession(request);
    const actionPromise = submitPresentSession(sessionId, PRESENT_MARKDOWN);
    await page.goto(`/s/${sessionId}`);
    await expect(page.getByText("Welcome to the deck.")).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("This slide contains anchorable text for feedback.")).toBeVisible();

    await page
      .locator("main article p")
      .filter({ hasText: "This slide contains anchorable text for feedback." })
      .evaluate((element) => {
        const node = element.firstChild;
        if (!node || node.nodeType !== Node.TEXT_NODE) {
          throw new Error("Expected a text node");
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

    await page.getByPlaceholder("Comment on this selection...").fill("Tighten this wording.");
    await page.getByRole("button", { name: "Comment on Selection" }).click();
    await request.post(`/s/${sessionId}/done`);

    const actionRes = await actionPromise;
    const body = await actionRes.json();
    expect(body.status).toBe("done");
    expect(body.threads[0].selection_text).toContain("anchorable text");
    expect(body.threads[0].selection_context).toContain("feedback");
    expect(body.threads[0].location_label).toContain("slide 2");
    expect(body.threads[0].messages[0].text).toBe("Tighten this wording.");
  });

  test("updating a presentation session marks older comments outdated and reopens review", async ({
    page,
    request,
  }) => {
    const { sessionId } = await startPresentSession(request);
    await page.goto(`/s/${sessionId}`);

    const initialAction = submitPresentSession(sessionId, PRESENT_MARKDOWN);
    await expect(page.getByText("Welcome to the deck.")).toBeVisible();
    await request.post(`/s/${sessionId}/threads`, { data: { text: "Old note" } });
    await request.post(`/s/${sessionId}/done`);
    await initialAction;

    const updatePromise = submitPresentSession(
      sessionId,
      "# Updated Deck\n\nFresh slide.",
      { response: "Updated the deck." }
    );
    await page.reload();
    await expect(page.getByText("Updated Deck")).toBeVisible();
    await expect(page.getByText("Old note")).toBeVisible();
    await expect(page.getByText("outdated")).toBeVisible();
    await request.post(`/s/${sessionId}/done`);

    const updateRes = await updatePromise;
    expect(updateRes.status).toBe(200);
    expect((await updateRes.json()).status).toBe("done");
  });

  test("standalone poll still works after a presentation is initialized", async ({ page, request }) => {
    const { sessionId } = await startPresentSession(request);
    await page.goto(`/s/${sessionId}`);

    const actionPromise = submitPresentSession(sessionId, PRESENT_MARKDOWN);
    await expect(page.getByText("Welcome to the deck.")).toBeVisible();
    await request.post(`/s/${sessionId}/threads`, { data: { text: "Looks good" } });
    await request.post(`/s/${sessionId}/done`);

    const pollRes = await request.get(`/present/${sessionId}/poll`, { headers: JSON_ACCEPT });
    const body = await pollRes.json();
    expect(body.status).toBe("done");
    expect(body.threads[0].messages[0].text).toBe("Looks good");
    await actionPromise;
  });

  test("rejects the removed mode field on the action endpoint", async ({ request }) => {
    const { sessionId } = await startPresentSession(request);
    const res = await request.post(`/present/${sessionId}`, {
      headers: JSON_ACCEPT,
      multipart: {
        markdown: PRESENT_MARKDOWN,
        mode: "revealjs",
      },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("no longer configurable");
  });
});
