import { expect, type Page } from "@playwright/test";

export async function goToTool(page: Page, name: string) {
  await page.getByRole("link", { name: "Ideate, back to desk" }).click();
  await expect(page.getByRole("button", { name: /Show 3D desk|Use simple view/ })).toBeVisible();
  const simple = page.getByRole("button", { name: "Use simple view", exact: true });
  if (await simple.isVisible()) await simple.click();
  if (name === "Desk") return;
  await page.locator(".flat-desk").getByRole("button", { name: new RegExp(`^${name}\\b`) }).click();
}

export const toolDock = (page: Page) => page.getByRole("toolbar", { name: "Tools" });

/** A tool chip in the header dock, by its display title (Python, Journal, ...). */
export const chip = (page: Page, name: string) =>
  toolDock(page).getByRole("button", { name: `${name} tool`, exact: true });

/** Click a chip: adds the tool as a tab in the focused group or focuses it. */
export async function addTool(page: Page, name: string) {
  await chip(page, name).click();
}

async function dragChip(page: Page, name: string, to: { x: number; y: number }) {
  await chip(page, name).hover();
  await page.mouse.down();
  await page.mouse.move(to.x - 40, to.y - 40, { steps: 8 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.waitForTimeout(150);
  await page.mouse.up();
}

/** Drag a chip onto the first visible editor at the given placement. */
export async function dragTool(
  page: Page,
  name: string,
  placement: "left" | "right" | "above" | "below" | "within",
) {
  const region = page.locator("[data-editor-panel]:not([hidden])").first();
  const box = (await region.boundingBox())!;
  const point = {
    left: { x: box.width * 0.07, y: box.height / 2 },
    right: { x: box.width * 0.93, y: box.height / 2 },
    above: { x: box.width / 2, y: box.height * 0.07 },
    below: { x: box.width / 2, y: box.height * 0.93 },
    within: { x: box.width / 2, y: box.height / 2 },
  }[placement];
  await dragChip(page, name, { x: box.x + point.x, y: box.y + point.y });
}

/** Drop a chip on the dock itself to open the tool as a floating window. */
export async function floatTool(page: Page, name: string) {
  const box = (await toolDock(page).boundingBox())!;
  await dragChip(page, name, { x: box.x + 12, y: box.y + box.height / 2 });
}

/** Pick an item from the Arrangement overflow menu. */
export async function arrange(page: Page, action: string) {
  await page.getByRole("button", { name: "Arrangement", exact: true }).click();
  await page.getByRole("button", { name: action, exact: true }).click();
}
