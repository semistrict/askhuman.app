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
    await expect(page.locator("header h1")).toHaveText("Opening");
    await expect(page.getByText("Welcome to the deck.")).toBeVisible();

    await request.post(`/s/${sessionId}/done`);
    const actionRes = await actionPromise;
    expect(actionRes.status).toBe(200);
    expect((await actionRes.json()).status).toBe("done");
  });

  test("arrow keys navigate slides without hijacking text input", async ({ page, request }) => {
    const { sessionId } = await startPresentSession(request);
    const actionPromise = submitPresentSession(sessionId, PRESENT_MARKDOWN);
    await page.goto(`/s/${sessionId}`);

    await expect(page.locator("header h1")).toHaveText("Opening");
    await expect(page.getByText("Welcome to the deck.")).toBeVisible();

    await page.keyboard.press("ArrowRight");
    await expect(page.getByText("This slide contains anchorable text for feedback.")).toBeVisible();
    await expect(page.getByText("Welcome to the deck.")).toHaveCount(0);

    await request.post(`/s/${sessionId}/threads`, { data: { text: "General comment" } });
    const textarea = page.getByPlaceholder("General comment...");
    await textarea.fill("ArrowLeft");
    await page.keyboard.press("ArrowLeft");

    await expect(textarea).toHaveValue("ArrowLeft");
    await expect(page.getByText("This slide contains anchorable text for feedback.")).toBeVisible();

    await page.locator("body").click({ position: { x: 20, y: 20 } });
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByText("Welcome to the deck.")).toBeVisible();

    await request.post(`/s/${sessionId}/done`);
    const actionRes = await actionPromise;
    expect(actionRes.status).toBe(200);
    expect((await actionRes.json()).status).toBe("done");
  });

  test("escape clears the inline selection comment composer", async ({ page, request }) => {
    const { sessionId } = await startPresentSession(request);
    const actionPromise = submitPresentSession(sessionId, PRESENT_MARKDOWN);
    await page.goto(`/s/${sessionId}`);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("This slide contains anchorable text for feedback.")).toBeVisible();

    const selectionPoint = await page
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
        const rect = range.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      });

    await page.mouse.move(selectionPoint.x, selectionPoint.y);
    await page.getByTestId("selection-comment-trigger").click();
    const composer = page.getByPlaceholder("Comment on this selection...");
    await composer.fill("This should clear.");
    await page.keyboard.press("Escape");

    await expect(composer).toHaveCount(0);
    await request.post(`/s/${sessionId}/done`);
    const actionRes = await actionPromise;
    expect(actionRes.status).toBe(200);
    expect((await actionRes.json()).status).toBe("done");
  });

  test("slide picker jumps by slide number and heading", async ({ page, request }) => {
    const { sessionId } = await startPresentSession(request);
    const actionPromise = submitPresentSession(sessionId, PRESENT_MARKDOWN);
    await page.goto(`/s/${sessionId}`);

    await page.getByTestId("slide-picker-trigger").click();
    await expect(page.getByTestId("slide-picker-option-2")).toContainText("Second Slide");
    await page.getByTestId("slide-picker-option-2").click();
    await expect(page.getByText("This slide contains anchorable text for feedback.")).toBeVisible();
    await expect(page.getByText("Welcome to the deck.")).toHaveCount(0);

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

    const selectionPoint = await page
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
        const rect = range.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      });

    await expect(page.getByPlaceholder("Comment on this selection...")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Dismiss" })).toHaveCount(0);
    await expect(page.locator("text=/slide 2, L\\d+/")).toHaveCount(0);
    await expect(page.getByTestId("selection-comment-trigger")).toHaveCount(0);
    await page.mouse.move(selectionPoint.x, selectionPoint.y);
    await expect(page.getByTestId("selection-comment-trigger")).toBeVisible();
    const triggerBox = await page.getByTestId("selection-comment-trigger").boundingBox();
    if (!triggerBox) {
      throw new Error("Expected selection comment trigger bounding box");
    }
    await page.mouse.move(triggerBox.x + triggerBox.width / 2, triggerBox.y + triggerBox.height / 2);
    await expect(page.getByTestId("selection-comment-trigger")).toBeVisible();
    await page.getByTestId("selection-comment-trigger").click();
    await page.getByPlaceholder("Comment on this selection...").fill("Tighten this wording.");
    await page.getByTestId("selection-comment-submit").click();
    const sidebar = page.locator("aside").last();
    await expect(sidebar.getByText(/anchorable text/)).toBeVisible();
    await expect(sidebar.getByText("slide 2", { exact: true })).toBeVisible();
    await expect
      .poll(async () =>
        await page.evaluate(() => {
          const css = window.CSS as typeof window.CSS & {
            highlights?: { has: (name: string) => boolean };
          };
          return css.highlights?.has("askhuman-selection") ?? false;
        })
      )
      .toBe(true);
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
    await expect(page.locator("header h1")).toHaveText("Updated Deck");
    await expect(page.getByText("Old note")).toBeVisible();
    await expect(page.getByText("outdated")).toBeVisible();
    await request.post(`/s/${sessionId}/done`);

    const updateRes = await updatePromise;
    expect(updateRes.status).toBe(200);
    expect((await updateRes.json()).status).toBe("done");
  });

  test("standalone poll is rejected while another presentation waiter is already active", async ({
    page,
    request,
  }) => {
    const { sessionId } = await startPresentSession(request);
    await page.goto(`/s/${sessionId}`);

    const actionPromise = submitPresentSession(sessionId, PRESENT_MARKDOWN);
    await expect(page.getByText("Welcome to the deck.")).toBeVisible();

    const pollRes = await request.get(`/present/${sessionId}/poll`, { headers: JSON_ACCEPT });
    expect(pollRes.status()).toBe(409);
    expect((await pollRes.json()).error).toContain("already waiting");
    await request.post(`/s/${sessionId}/done`);
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
