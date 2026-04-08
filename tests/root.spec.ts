import { expect, test } from "@playwright/test";

test.describe("Root Page", () => {
  test("footer exposes settings next to github and persists the toggle", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("link", { name: "github" })).toBeVisible();
    await expect(page.getByRole("link", { name: "settings" })).toBeVisible();

    await page.getByRole("link", { name: "settings" }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();

    await page.getByLabel("Your name").fill("Ramon");
    const toggle = page.getByLabel("Enable PostHog monitoring");
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await page.getByRole("button", { name: "Close" }).click();

    await page.reload();
    await page.getByRole("link", { name: "settings" }).click();
    await expect(page.getByLabel("Your name")).toHaveValue("Ramon");
    await expect(page.getByLabel("Enable PostHog monitoring")).toBeChecked();
  });
});
