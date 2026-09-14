import { expect, test as base, type Page } from "@playwright/test";
import { addTool, arrange, chip, dragTool, floatTool, goToTool } from "./desk-navigation";

const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await use(errors);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});

test.use({ reducedMotion: "reduce" });

const python = (page: Page) =>
  page.getByRole("region", { name: "Python workspace", exact: true });
const journal = (page: Page) =>
  page.getByRole("region", { name: "Study journal", exact: true });

async function open(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible({ timeout: 30000 });
  await goToTool(page, "Computer");
}

test("chips reflect state and a click adds a tab without collapsing", async ({ page }) => {
  await open(page);
  await expect(chip(page, "Python")).toHaveAttribute("aria-pressed", "true");
  await expect(chip(page, "Journal")).toHaveAttribute("aria-pressed", "false");
  await expect(chip(page, "Output")).toBeVisible();
  await addTool(page, "Journal");
  await expect(page.getByRole("tab", { name: "Python", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Journal", exact: true })).toBeVisible();
  await expect(journal(page)).toBeVisible();
  await expect(chip(page, "Journal")).toHaveAttribute("aria-pressed", "true");
  await addTool(page, "Python");
  await expect(python(page)).toBeVisible();
  await expect(journal(page)).toBeHidden();
  await expect(page.getByRole("tab", { name: "Journal", exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("dock-tabs.png") });
});

test("dragging a chip splits from the single view and moves an open tool", async ({ page }) => {
  await open(page);
  await dragTool(page, "Journal", "right");
  await expect(python(page)).toBeVisible();
  await expect(journal(page)).toBeVisible();
  const left = (await python(page).boundingBox())!;
  const right = (await journal(page).boundingBox())!;
  expect(left.x + left.width).toBeLessThanOrEqual(right.x + 12);
  await dragTool(page, "Journal", "below");
  await expect
    .poll(async () => {
      const top = (await python(page).boundingBox())!;
      const bottom = (await journal(page).boundingBox())!;
      return top.y + top.height <= bottom.y + 12;
    })
    .toBe(true);
  await expect(page.getByRole("tab", { name: "Journal", exact: true })).toHaveCount(1);
});

test("dropping a chip on the dock floats it", async ({ page }) => {
  await open(page);
  await floatTool(page, "Whiteboard");
  await expect(page.locator(".dv-resize-container")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Dock Whiteboard", exact: true })).toBeVisible();
  await expect(python(page)).toBeVisible();
});

test("Output chip appears with Python and detaches as a tab", async ({ page }) => {
  await open(page);
  await addTool(page, "Output");
  await expect(page.getByRole("tab", { name: "Output", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Return output to editor", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Output", exact: true })).toHaveCount(0);
  await goToTool(page, "Journal");
  await expect(chip(page, "Output")).toHaveCount(0);
});

test("Alt+Shift shortcuts add a tab and Reset forgets the arrangement", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Alt+Shift+3");
  await expect(journal(page)).toBeVisible();
  await expect(python(page)).toBeHidden();
  await expect(page.getByRole("tab", { name: "Python", exact: true })).toBeVisible();
  await page.keyboard.press("Alt+3");
  await expect(page.locator(".dv-tab")).toHaveCount(0);
  await arrange(page, "Reset arrangement");
  await expect(page.locator(".dv-tab")).toHaveCount(0);
  await page.getByRole("button", { name: "Arrangement", exact: true }).click();
  await expect(page.getByRole("button", { name: "Restore previous arrangement", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reset arrangement", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
});

test("narrow viewports move chips into a Tools menu that switches tools", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(chip(page, "Journal")).toHaveCount(0);
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "Arrangement options" });
  await expect(menu.getByRole("button", { name: "Journal tool", exact: true })).toHaveAttribute("draggable", "false");
  await menu.getByRole("button", { name: "Journal tool", exact: true }).click();
  await expect(journal(page)).toBeVisible();
  await expect(python(page)).toBeHidden();
  await expect(page.locator(".dv-tab")).toHaveCount(0);
});
