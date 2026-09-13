import { expect, type Page } from "@playwright/test";

export async function goToTool(page: Page, name: string) {
  await page.getByRole("link", { name: "Ideate, back to desk" }).click();
  await expect(page.getByRole("button", { name: /Show 3D desk|Use simple view/ })).toBeVisible();
  const simple = page.getByRole("button", { name: "Use simple view", exact: true });
  if (await simple.isVisible()) await simple.click();
  if (name === "Desk") return;
  await page.locator(".flat-desk").getByRole("button", { name: new RegExp(`^${name}\\b`) }).click();
}

export async function arrange(page: Page, action: string) {
  await page.getByRole("button", { name: "Editor layout", exact: true }).click();
  const advanced = /^(Float|Tab with)/.test(action);
  if (advanced) await page.getByRole("button", { name: /^More arrangements/ }).click();
  await page.getByRole("button", { name: action, exact: true }).click();
}
