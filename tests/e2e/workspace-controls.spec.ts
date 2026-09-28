import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { goToTool } from "./desk-navigation";

test.use({ reducedMotion: "reduce" });

async function openComputer(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await goToTool(page, "Computer");
  await expect(page.getByRole("region", { name: "Python workspace", exact: true })).toBeVisible();
}

test("an exported workspace can be imported after local edits", async ({ page }) => {
  await openComputer(page);
  const editor = page.getByRole("region", { name: "Python workspace", exact: true }).getByRole("textbox");
  await editor.click();
  await page.keyboard.insertText("print('backup')");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export workspace" }).click(),
  ]);
  const backupPath = await download.path();
  expect(backupPath).not.toBeNull();

  await editor.click();
  await editor.press("ControlOrMeta+A");
  await page.keyboard.insertText("print('changed')");
  await expect(editor).toContainText("changed");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator('input[type="file"]').setInputFiles(backupPath!);
  await expect(editor).toContainText("backup");
});

test("a paused imported answer shows its interruption after reload", async ({ page }) => {
  await openComputer(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export workspace" }).click(),
  ]);
  const backup = JSON.parse(await readFile((await download.path())!, "utf8"));
  backup.messages = [
    { id: "paused-answer", role: "assistant", text: "Partial answer", status: "paused" },
  ];
  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator('input[type="file"]').setInputFiles({
    name: "paused-workspace.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.getByText("Workspace imported.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Toggle study partner" }).click();
  const partner = page.getByRole("complementary", { name: "AI study partner" });
  await expect(partner).toContainText("Partial answer");
  await expect(partner).toContainText("Interrupted when the workspace reloaded.");
  await expect(partner.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Toggle study partner" }).click();
  await expect(partner).toContainText("Interrupted when the workspace reloaded.");
  await expect(partner.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
});

test("a spreadsheet source offers to open the spreadsheet", async ({ page }) => {
  await openComputer(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export workspace" }).click(),
  ]);
  const backup = JSON.parse(await readFile((await download.path())!, "utf8"));
  backup.notes = {
    ...backup.notes,
    text: "[Sheet evidence](#source:sheet-source)",
    revision: 1,
  };
  backup.references = [{
    id: "sheet-source",
    tool: "spreadsheet",
    revision: backup.spreadsheet.revision,
    label: "Sheet evidence",
    excerpt: "A1: 10",
  }];
  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator('input[type="file"]').setInputFiles({
    name: "sheet-source.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await goToTool(page, "Journal");
  await page.getByRole("region", { name: "Study journal" })
    .getByRole("tab", { name: "Preview", exact: true }).click();
  await page.getByRole("link", { name: "Sheet evidence" }).click();
  const source = page.getByRole("dialog", { name: "Sheet evidence" });
  await expect(source.getByRole("button", { name: "Open Spreadsheet" })).toBeVisible();
});

test("a source reveals its passage after the Python editor loads", async ({ page }) => {
  await openComputer(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export workspace" }).click(),
  ]);
  const backup = JSON.parse(await readFile((await download.path())!, "utf8"));
  const passage = "print('reveal me')";
  backup.code = { ...backup.code, text: `before\n${passage}\nafter`, revision: 1 };
  backup.notes = { ...backup.notes, text: "[Code evidence](#source:code-source)", revision: 1 };
  backup.references = [{
    id: "code-source",
    tool: "code",
    revision: 1,
    label: "Code evidence",
    excerpt: passage,
    from: 7,
    to: 7 + passage.length,
  }];
  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator('input[type="file"]').setInputFiles({
    name: "code-source.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.setItem("ideate:layout-preset:v1", "notes"));
  await page.reload();
  const journal = page.getByRole("region", { name: "Study journal" });
  await expect(journal).toBeVisible();
  await expect(page.locator('[data-editor-tool="code"] .cm-content')).toHaveCount(0);
  await journal.getByRole("tab", { name: "Preview", exact: true }).click();
  await journal.getByRole("link", { name: "Code evidence" }).click();
  await page.getByRole("dialog", { name: "Code evidence" })
    .getByRole("button", { name: "Open Python" }).click();
  const editor = page.getByRole("region", { name: "Python workspace", exact: true }).getByRole("textbox");
  await expect(editor).toBeVisible();
  await expect.poll(() => editor.evaluate(() => window.getSelection()?.toString())).toBe(passage);
});

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
  await expect(header.getByRole("button", { name: "Arrangement", exact: true })).toBeVisible();
  const headerBox = (await header.boundingBox())!;
  const editorBox = (await page.getByRole("region", { name: "Python workspace", exact: true }).boundingBox())!;
  expect(editorBox.y - headerBox.y - headerBox.height).toBeLessThan(3);
  expect(editorBox.y + editorBox.height).toBeGreaterThan(995);
  await expect(header.getByRole("link", { name: "Ideate, desk", exact: true })).toBeVisible();
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

test("saving and worker errors keep desk navigation and dock geometry stable", async ({ page }) => {
  await openComputer(page);
  const navigation = page.getByRole("link", { name: "Ideate, desk", exact: true });
  const dock = page.getByRole("region", { name: "Python workspace", exact: true });
  const navBefore = await navigation.boundingBox();
  const dockBefore = await dock.boundingBox();
  await page.evaluate(() => {
    Worker.prototype.postMessage = function () { throw new DOMException("Storage full", "QuotaExceededError"); };
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
  await expect(header.getByRole("button", { name: "Tools", exact: true })).toBeInViewport();
  for (const control of await header.getByRole("button").all()) {
    const bounds = await control.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  }
  await page.screenshot({ path: test.info().outputPath(`narrow-controls-${width}.png`) });
  await header.getByRole("button", { name: "Tools", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Arrangement options" })).toBeInViewport();
  const menuBounds = (await page.getByRole("dialog", { name: "Arrangement options" }).boundingBox())!;
  expect(menuBounds.x).toBeGreaterThanOrEqual(12);
  expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(width - 12);
  await page.screenshot({ path: test.info().outputPath(`narrow-layout-${width}.png`) });
  await page.keyboard.press("Escape");
  await header.getByRole("button", { name: "Toggle study partner", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Ask your study partner", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
});
}
