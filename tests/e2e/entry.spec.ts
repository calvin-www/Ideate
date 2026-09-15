import { expect, test } from "@playwright/test";

test.use({ reducedMotion: "reduce" });
const python = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "Python workspace", exact: true });
const journal = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "Study journal", exact: true });

test("a first visit opens the Code preset, presets are remembered, and the desk is optional", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(python(page)).toBeVisible();
  await expect(page.locator(".desk-home")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Layout preset" })).toHaveValue("code");

  await page.getByRole("combobox", { name: "Layout preset" }).selectOption("code-notes");
  await expect(python(page)).toBeVisible();
  await expect(journal(page)).toBeVisible();
  await page.reload();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await expect(python(page)).toBeVisible();
  await expect(journal(page)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Layout preset" })).toHaveValue("code-notes");

  await page.getByRole("link", { name: "Ideate, desk" }).click();
  await expect(page.locator(".desk-home")).toBeVisible();

  await page.goto("/?view=desk");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await expect(page.locator(".desk-home")).toBeVisible();
});
