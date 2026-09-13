import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { arrange, goToTool } from "./desk-navigation";

test.use({ reducedMotion: "reduce" });

test("spreadsheet recalculates, formats, undoes and persists", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible({ timeout: 30_000 });
  await goToTool(page, "Spreadsheet");
  const panel = page.getByRole("region", { name: "Spreadsheet workspace", exact: true });
  const cell = (id: string) => panel.getByRole("textbox", { name: `Cell ${id}`, exact: true });
  await cell("A1").fill("12");
  await cell("A2").fill("8");
  await cell("A3").fill("=SUM(A1:A2)");
  await cell("A3").press("Enter");
  await expect(cell("A3")).toHaveValue("20");
  await cell("A1").fill("22");
  await cell("A1").press("Enter");
  await expect(cell("A3")).toHaveValue("30");
  await panel.getByRole("button", { name: "Undo spreadsheet edit" }).click();
  await expect(cell("A3")).toHaveValue("20");
  await panel.getByRole("button", { name: "Redo spreadsheet edit" }).click();
  await expect(cell("A3")).toHaveValue("30");
  await cell("A3").click();
  await panel.getByLabel("Cell number format").focus();
  await panel.getByLabel("Cell number format").selectOption("currency");
  await expect(cell("A3")).toHaveValue("$30.00");
  await cell("B1").fill("0.25");
  await panel.getByLabel("Cell number format").focus();
  await panel.getByLabel("Cell number format").selectOption("percent");
  await expect(cell("B1")).toHaveValue("25%");
  const downloadPromise = page.waitForEvent("download");
  await panel.getByRole("button", { name: "CSV", exact: true }).click();
  const csv = await downloadPromise;
  expect(await readFile((await csv.path())!, "utf8")).toBe("22,0.25\r\n8,\r\n30,");
  await page.screenshot({ path: test.info().outputPath("spreadsheet-desktop.png") });
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await goToTool(page, "Spreadsheet");
  await expect(cell("A3")).toHaveValue("$30.00");
  await cell("A3").fill("40");
  await cell("A3").press("Enter");
  await expect(cell("A3")).toHaveValue("$40.00");
});

test("spreadsheet keyboard navigation, split layout and narrow screen", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Alt+4");
  const panel = page.getByRole("region", { name: "Spreadsheet workspace", exact: true });
  await expect(panel).toBeVisible();
  await arrange(page, "Split with Journal");
  await expect(panel).toBeVisible();
  await expect(page.getByRole("region", { name: "Study journal", exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("spreadsheet-split.png") });
  await panel.getByLabel("Cell A1", { exact: true }).click();
  await arrange(page, "Show only Spreadsheet");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.getByLabel("Cell A1", { exact: true })).toBeVisible();
  await panel.getByLabel("Cell A1", { exact: true }).fill("42");
  await panel.getByLabel("Cell A1", { exact: true }).press("Tab");
  await expect(panel.getByLabel("Cell B1", { exact: true })).toBeFocused();
  await page.screenshot({ path: test.info().outputPath("spreadsheet-narrow.png") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await goToTool(page, "Desk");
  await page.getByRole("button", { name: "Show 3D desk", exact: true }).click();
  await page.getByRole("button", { name: "Open Spreadsheet", exact: true }).click();
  await expect(panel).toBeVisible();
  expect(errors).toEqual([]);
});

test("pastes a rectangular range atomically and copies selected raw formulas", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible({ timeout: 30_000 });
  await goToTool(page, "Spreadsheet");
  const cell = (id: string) => page.getByRole("textbox", { name: `Cell ${id}`, exact: true });
  await cell("A1").click();
  await cell("A1").evaluate((input) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "Item\tPrice\nPaper\t4\nPencils\t6\nTotal\t=SUM(B2:B3)");
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  });
  await expect(cell("B4")).toHaveValue("10");
  await cell("A1").press("Shift+ArrowRight");
  await cell("B1").press("Shift+ArrowDown");
  const copied = await cell("B2").evaluate((input) => {
    const clipboardData = new DataTransfer();
    input.dispatchEvent(new ClipboardEvent("copy", { clipboardData, bubbles: true, cancelable: true }));
    return clipboardData.getData("text/plain");
  });
  expect(copied).toBe("Item\tPrice\nPaper\t4");
  await page.getByRole("button", { name: "Undo spreadsheet edit" }).click();
  await expect(cell("B4")).toHaveValue("");
});

test("clipboard preserves tabs, newlines and quotes inside individual cells", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible({ timeout: 30_000 });
  await goToTool(page, "Spreadsheet");
  const cell = (id: string) => page.getByRole("textbox", { name: `Cell ${id}`, exact: true });
  await cell("A1").click();
  const text = '"two\tcolumns"\tneighbor\n"two\nlines"\t"say ""hello"""';
  await cell("A1").evaluate((input, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  }, text);
  await expect(cell("B1")).toHaveValue("neighbor");
  await expect(cell("B2")).toHaveValue('say "hello"');
  await cell("A1").press("Shift+ArrowRight");
  await cell("B1").press("Shift+ArrowDown");
  const copied = await cell("B2").evaluate((input) => {
    const clipboardData = new DataTransfer();
    input.dispatchEvent(new ClipboardEvent("copy", { clipboardData, bubbles: true, cancelable: true }));
    return clipboardData.getData("text/plain");
  });
  expect(copied).toBe(text);
  await expect(cell("C1")).toHaveValue("");
});
