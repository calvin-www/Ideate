import { expect, test, type Page } from "@playwright/test";
import { goToTool } from "./desk-navigation";

test.use({ reducedMotion: "reduce" });

async function openComputer(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await goToTool(page, "Computer");
  await expect(page.getByRole("region", { name: "Python workspace", exact: true })).toBeVisible();
}

test("header controls leave the full tool area available and chat opens only by its toggle", async ({ page }) => {
  await openComputer(page);
  const header = page.getByRole("banner");
  const microphone = header.getByRole("button", { name: "Turn on microphone", exact: true });
  const chat = header.getByRole("button", { name: "Toggle study partner", exact: true });
  await expect(microphone).toBeVisible();
  const micBox = (await microphone.boundingBox())!;
  const chatBox = (await chat.boundingBox())!;
  expect(chatBox.x - micBox.x - micBox.width).toBeLessThanOrEqual(10);
  expect(Math.abs(micBox.y - chatBox.y)).toBeLessThan(2);
  await expect(header.getByRole("button", { name: "Editor layout", exact: true })).toBeVisible();
  const headerBox = (await header.boundingBox())!;
  const editorBox = (await page.getByRole("region", { name: "Python workspace", exact: true }).boundingBox())!;
  expect(editorBox.y - headerBox.y - headerBox.height).toBeLessThan(3);
  expect(editorBox.y + editorBox.height).toBeGreaterThan(995);
  await expect(header.getByRole("link", { name: "Ideate, back to desk", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Explain visually", exact: true })).toHaveCount(0);
  const composer = page.getByRole("textbox", { name: "Ask your study partner", exact: true });
  await expect(composer).toBeHidden();
  await chat.focus();
  await chat.press("Enter");
  await expect(composer).toBeVisible();
  await chat.click();
  await expect(composer).toBeHidden();
  await page.screenshot({ path: test.info().outputPath("desktop-controls.png") });
});

test("saving and storage errors keep desk navigation and dock geometry stable", async ({ page }) => {
  await openComputer(page);
  const navigation = page.getByRole("link", { name: "Ideate, back to desk", exact: true });
  const dock = page.getByRole("region", { name: "Python workspace", exact: true });
  const navBefore = await navigation.boundingBox();
  const dockBefore = await dock.boundingBox();
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = function () { throw new DOMException("Storage full", "QuotaExceededError"); };
  });
  const editor = dock.getByRole("textbox");
  await editor.click();
  await editor.press("End");
  await page.keyboard.insertText(" # trigger save");
  await expect(page.getByText("Saving", { exact: true })).toBeVisible();
  expect(await navigation.boundingBox()).toEqual(navBefore);
  expect(await dock.boundingBox()).toEqual(dockBefore);
  await expect(page.getByText("Save needs attention", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Could not save locally" })).toBeVisible();
  expect(await navigation.boundingBox()).toEqual(navBefore);
  expect(await dock.boundingBox()).toEqual(dockBefore);
});

for (const width of [320, 390]) {
test(`compact controls remain reachable at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  const header = page.getByRole("banner");
  await expect(header.getByRole("button", { name: "Turn on microphone", exact: true })).toBeInViewport();
  await expect(header.getByRole("button", { name: "Toggle study partner", exact: true })).toBeInViewport();
  await goToTool(page, "Computer");
  await expect(header.getByRole("button", { name: "Editor layout", exact: true })).toBeInViewport();
  for (const control of await header.getByRole("button").all()) {
    const bounds = await control.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  }
  await page.screenshot({ path: test.info().outputPath(`narrow-controls-${width}.png`) });
  await header.getByRole("button", { name: "Editor layout", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Editor layout options" })).toBeInViewport();
  const menuBounds = (await page.getByRole("dialog", { name: "Editor layout options" }).boundingBox())!;
  expect(menuBounds.x).toBeGreaterThanOrEqual(12);
  expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(width - 12);
  await page.screenshot({ path: test.info().outputPath(`narrow-layout-${width}.png`) });
  await page.keyboard.press("Escape");
  await header.getByRole("button", { name: "Toggle study partner", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Ask your study partner", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
});
}
