import { expect, type Page } from "@playwright/test";

export async function goToTool(page: Page, name: string) {
  // The desk is no longer the entry view (Task 9), so the very first call in a
  // test can otherwise land its click on the brand link before hydration has
  // attached the handler that would send it to the desk.
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Ideate, desk" }).click();
  await expect(page.getByRole("button", { name: /Show 3D desk|Use simple view/ })).toBeVisible();
  const simple = page.getByRole("button", { name: "Use simple view", exact: true });
  if (await simple.isVisible()) await simple.click();
  if (name === "Desk") return;
  await page.locator(".flat-desk").getByRole("button", { name: new RegExp(`^${name}\\b`) }).click();
}

export async function arrange(page: Page, action: string) {
  await page.getByRole("button", { name: "Addons", exact: true }).click();
  await page.getByRole("button", { name: action, exact: true }).click();
}
