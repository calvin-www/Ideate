import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { BoardElement, Workspace } from "../../src/features/workspace/model";

/**
 * Stands in for the "Load binary search example" button that BoardEditor used to
 * offer in its empty state. Carries only the properties the board needs to draw
 * these shapes; Excalidraw's restoreElements fills in the rest on import.
 */
export function binarySearchElements(): BoardElement[] {
  const values = [2, 5, 8, 12, 16, 23, 38, 56];
  // Matches what the board adapter builds for free text: a fixed width the text
  // wraps inside, rather than Excalidraw auto-sizing it to one long line.
  const label = (
    id: string,
    x: number,
    y: number,
    width: number,
    text: string,
  ) => ({
    id,
    type: "text",
    x,
    y,
    width,
    height: 25,
    text,
    originalText: text,
    fontSize: 20,
    autoResize: false,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
  });
  const elements: Record<string, unknown>[] = [
    label("sample-question", 90, 60, 500, "Why can we discard half the array?"),
  ];
  for (const [index, value] of values.entries()) {
    const x = 90 + index * 82;
    elements.push({
      id: `sample-cell-${index}`,
      type: "rectangle",
      x,
      y: 150,
      width: 70,
      height: 66,
    });
    elements.push(
      label(`sample-value-${index}`, x + 24, 172, 22, String(value)),
    );
  }
  for (const [text, x] of [
    ["low = 0", 93],
    ["mid = 3", 336],
    ["high = 7", 644],
  ] as const)
    elements.push(label(`sample-${text.split(" ")[0]}`, x, 240, 180, text));
  return elements as unknown as BoardElement[];
}

async function exported(page: Page): Promise<Workspace> {
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export workspace", exact: true })
    .click();
  return JSON.parse(await readFile((await (await downloading).path())!, "utf8"));
}

/**
 * Seeds the whiteboard with the binary search example. Round-trips through the
 * real export/import controls so the other documents keep their contents, then
 * fits the drawing the way the old example button did.
 */
export async function loadBoardExample(page: Page) {
  const current = await exported(page);
  const next: Workspace = {
    ...current,
    board: {
      ...current.board,
      elements: binarySearchElements(),
      revision: current.board.revision + 1,
    },
  };
  const choosing = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Import workspace", exact: true })
    .click();
  page.once("dialog", (dialog) => dialog.accept());
  await (
    await choosing
  ).setFiles({
    name: "binary-search.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(next)),
  });
  await expect(page.locator(".toast")).toContainText("Workspace imported.");
  const fit = page.getByRole("button", { name: "Fit drawing", exact: true });
  if (await fit.isVisible()) await fit.click();
}
