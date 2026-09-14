import { expect, test } from "@playwright/test";
import { arrange, dragTool, goToTool } from "./desk-navigation";

test.use({ reducedMotion: "reduce" });
const python = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "Python workspace", exact: true });
const journal = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "Study journal", exact: true });

test("desk entry opens only the requested tool after its original pane was hidden", async ({ page }) => {
  await page.goto("/");
  await goToTool(page, "Computer");
  const editor = python(page).getByRole("textbox");
  await editor.fill("print('kept')");
  await editor.press("End");
  await page.keyboard.type(" # undo me");
  const original = await editor.elementHandle();
  // Existing basic split command is used so the failure isolates entry behavior.
  await dragTool(page, "Journal", "right");
  await page.getByRole("button", { name: "Hide Python", exact: true }).click();
  await expect(python(page)).toBeHidden();
  await goToTool(page, "Whiteboard");
  await goToTool(page, "Computer");
  await expect(python(page)).toBeVisible();
  await expect(journal(page)).toBeHidden();
  await expect(page.locator(".dv-tab")).toHaveCount(0);
  expect(await editor.evaluate((element, prior) => element === prior, original)).toBe(true);
  await expect(editor).toContainText("# undo me");
  await editor.press("ControlOrMeta+z");
  await expect(editor).not.toContainText("# undo me");
  await expect(editor).toContainText("print('kept')");
  await page.screenshot({ path: test.info().outputPath("single-computer.png") });
});

test("desk launches and shortcuts preserve an explicitly recoverable arrangement", async ({ page }) => {
  await page.goto("/");
  await goToTool(page, "Computer");
  await dragTool(page, "Journal", "right");
  await goToTool(page, "Computer");
  await expect(journal(page)).toBeHidden();
  await arrange(page, "Restore previous arrangement");
  await expect(journal(page)).toBeVisible();
  await expect(python(page)).toBeVisible();
  await page.keyboard.press("Alt+3");
  await expect(journal(page)).toBeVisible();
  await expect(python(page)).toBeHidden();
  await page.reload();
  await goToTool(page, "Computer");
  await expect(journal(page)).toBeHidden();
  await arrange(page, "Restore previous arrangement");
  await expect(journal(page)).toBeVisible();
  await expect(python(page)).toBeVisible();
  await page.getByRole("button", { name: "Arrangement", exact: true }).click();
  await page.screenshot({ path: test.info().outputPath("layout-menu.png") });
  await page.keyboard.press("Escape");
});

test("Escape stays in the editor and simple desk preference survives reload", async ({ page }) => {
  await page.goto("/");
  await goToTool(page, "Computer");
  await expect(page.getByRole("navigation", { name: "Workspace tools" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Ideate, back to desk" })).toContainText("Back to desk");
  await python(page).getByRole("textbox").press("Escape");
  await expect(python(page)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Show 3D desk", exact: true })).toBeVisible();
});

test("3D desk objects reopen alone and receive keyboard focus on return", async ({ page }) => {
  await page.goto("/");
  const computer = page.getByRole("button", { name: "Open Computer", exact: true });
  await computer.click();
  await expect(python(page)).toBeVisible();
  await dragTool(page, "Journal", "right");
  await page.getByRole("link", { name: "Ideate, back to desk" }).click();
  const journalObject = page.getByRole("button", { name: "Open Journal", exact: true });
  await expect(journalObject).toBeFocused();
  await computer.click();
  await expect(python(page)).toBeVisible();
  await expect(journal(page)).toBeHidden();
  await expect(page.locator(".dv-tab")).toHaveCount(0);
});

test("journal preview mode survives a layout reset and desk navigation", async ({ page }) => {
  await page.goto("/");
  await goToTool(page, "Journal");
  await journal(page).getByRole("textbox").fill("# Keep this view\n\nA note worth keeping.");
  await journal(page).getByRole("tab", { name: "Preview", exact: true }).click();
  await dragTool(page, "Python", "right");
  await goToTool(page, "Computer");
  await goToTool(page, "Journal");
  await expect(journal(page).getByRole("tab", { name: "Preview", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(journal(page).getByRole("heading", { name: "Keep this view" })).toBeVisible();
  await expect(python(page)).toBeHidden();
});
