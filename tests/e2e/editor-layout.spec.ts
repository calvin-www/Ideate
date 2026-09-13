import { expect, test, type Page } from "@playwright/test";

test.use({ reducedMotion: "reduce" });

async function open(page: Page, tool = "Computer") {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible({ timeout: 30000 });
  await page.getByRole("navigation", { name: "Workspace tools" }).getByRole("button", { name: tool, exact: true }).click();
}
async function layout(page: Page, action: string) {
  await page.getByRole("button", { name: "Editor layout", exact: true }).click();
  await page.getByRole("button", { name: action, exact: true }).click();
}
const python = (page: Page) => page.getByRole("region", { name: "Python workspace", exact: true });
const journal = (page: Page) => page.getByRole("region", { name: "Study journal", exact: true });

test("splits real editors and preserves undo when returning to the default", async ({ page }) => {
  await open(page);
  await expect(journal(page)).toBeHidden();
  const editor = python(page).getByRole("textbox");
  await editor.fill("print('before layout')");
  await editor.press("End");
  await page.keyboard.type(" # retained");
  await layout(page, "Split with Journal");
  await expect(python(page)).toBeVisible();
  await expect(journal(page)).toBeVisible();
  const left = await python(page).boundingBox();
  const right = await journal(page).boundingBox();
  expect(left!.x + left!.width).toBeLessThanOrEqual(right!.x + 12);
  await layout(page, "Single editor");
  await page.getByRole("navigation", { name: "Workspace tools" }).getByRole("button", { name: "Computer", exact: true }).click();
  await expect(journal(page)).toBeHidden();
  await expect(editor).toContainText("# retained");
  await editor.press("ControlOrMeta+z");
  await expect(editor).toContainText("before layout");
  await expect(editor).not.toContainText("# retained");
  await layout(page, "Restore saved layout");
  await expect(journal(page)).toBeVisible();
});

test("floats Python above the board and restores its bounds after maximizing", async ({ page }) => {
  await open(page, "Whiteboard");
  await layout(page, "Float Python");
  await expect(python(page)).toBeVisible();
  await expect(page.getByRole("region", { name: "Whiteboard tool", exact: true })).toBeVisible();
  const before = await python(page).boundingBox();
  await page.getByRole("button", { name: "Maximize Python", exact: true }).click();
  await expect(page.getByRole("button", { name: "Restore layout", exact: true })).toBeVisible();
  const maximized = await python(page).boundingBox();
  expect(maximized!.width).toBeGreaterThan(before!.width + 100);
  await page.getByRole("button", { name: "Restore layout", exact: true }).click();
  await expect.poll(async () => Math.abs((await python(page).boundingBox())!.width - before!.width)).toBeLessThan(3);
  expect(Math.abs((await python(page).boundingBox())!.x - before!.x)).toBeLessThan(3);
  await page.getByRole("button", { name: "Hide Python", exact: true }).click();
  await expect(python(page)).toBeHidden();
  await expect(page.getByRole("region", { name: "Whiteboard tool", exact: true })).toBeVisible();
});

test("persists resized splits and falls back to the single editor on narrow screens", async ({ page }) => {
  await open(page);
  await layout(page, "Split with Journal");
  const before = await python(page).boundingBox();
  const divider = page.locator(".dv-sash.dv-vertical").filter({ visible: true }).first();
  const bounds = await divider.boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds!.x - 130, bounds!.y + bounds!.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await python(page).boundingBox())!.width).toBeLessThan(before!.width - 80);
  const resized = await python(page).boundingBox();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("ideate:editor-layout:v1"))).not.toBeNull();
  await page.reload();
  await page.getByRole("navigation", { name: "Workspace tools" }).getByRole("button", { name: "Computer", exact: true }).click();
  await expect(journal(page)).toBeVisible();
  await expect.poll(async () => Math.abs((await python(page).boundingBox())!.width - resized!.width)).toBeLessThan(5);
  await page.setViewportSize({ width: 600, height: 850 });
  await expect(journal(page)).toBeHidden();
  await expect(python(page)).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(journal(page)).toBeVisible();
});
