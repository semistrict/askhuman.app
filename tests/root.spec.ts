import { expect, test } from "@playwright/test";

function normalizeBaseUrls(text: string) {
  return text.replaceAll("http://localhost:15032", "https://askhuman.app");
}

test.describe("Root Page", () => {
  test("serves plain-text instructions to fetch-style agents", async ({ request }) => {
    const cases = [
      { headers: { "User-Agent": "Claude-User/1.0" } },
      { headers: { "User-Agent": "ChatGPT-User/1.0" } },
      { headers: { "Signature-Agent": "https://chatgpt.com" } },
    ];

    for (const testCase of cases) {
      const res = await request.get("/", { headers: testCase.headers });
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("text/plain");
      const text = await res.text();
      expect(text).toContain("# askhuman.app");
      expect(text).toContain("/review");
      expect(text).toContain("/present");
      expect(text).toContain("/share");
      expect(text).toContain("temporary file");
      expect(text).toContain("Google Chrome.app");
    }
  });

  test("llms.txt matches the root plain-text instructions", async ({ request }) => {
    const rootRes = await request.get("/", {
      headers: { "User-Agent": "Claude-User/1.0" },
    });
    const llmsRes = await request.get("/llms.txt");

    expect(llmsRes.status()).toBe(200);
    expect(llmsRes.headers()["content-type"]).toContain("text/plain");
    expect(normalizeBaseUrls(await llmsRes.text())).toBe(normalizeBaseUrls(await rootRes.text()));
  });

  test("footer exposes settings next to github and persists the toggle", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("link", { name: "github" })).toBeVisible();
    await expect(page.getByRole("link", { name: "settings", exact: true })).toBeVisible();

    await page.getByRole("link", { name: "settings", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();

    await page.getByLabel("Your name").fill("Ramon");
    const toggle = page.getByLabel("Enable PostHog monitoring");
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await page.getByRole("button", { name: "Close" }).click();

    await page.reload();
    await page.getByRole("link", { name: "settings", exact: true }).click();
    await expect(page.getByLabel("Your name")).toHaveValue("Ramon");
    await expect(page.getByLabel("Enable PostHog monitoring")).toBeChecked();
  });
});
