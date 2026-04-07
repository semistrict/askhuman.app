import { test, expect } from "@playwright/test";

test("front page tabs do not cause vertical reflow", async ({ page }) => {
  await page.goto("/");

  // Get the links element Y position as a stable reference
  const linksBefore = await page.locator(".links").boundingBox();
  expect(linksBefore).not.toBeNull();

  // Click each tab and verify footer doesn't move
  for (const tab of ["plan", "files", "playground", "diff"]) {
    await page.locator(".tab", { hasText: tab }).click();
    const linksAfter = await page.locator(".links").boundingBox();
    expect(linksAfter).not.toBeNull();
    expect(linksAfter!.y).toBe(linksBefore!.y);
  }
});
