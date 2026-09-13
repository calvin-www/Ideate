import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import type { Workspace } from "../../src/features/workspace/model";

test.use({ reducedMotion: "reduce" });
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
});
function partner(page: Page) {
  return page.getByRole("complementary", { name: "AI study partner" });
}
function codePanel(page: Page) {
  return page.getByRole("region", { name: "Python workspace", exact: true });
}
async function navigate(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Workspace tools" })
    .getByRole("button", { name, exact: true })
    .click();
}
async function editCode(page: Page, code: string) {
  const editor = codePanel(page).getByRole("textbox");
  await editor.click();
  await editor.press("ControlOrMeta+A");
  await page.keyboard.insertText(code);
}
async function snapshot(page: Page): Promise<Workspace> {
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export workspace", exact: true })
    .click();
  return JSON.parse(
    await readFile((await (await downloading).path())!, "utf8"),
  );
}
async function clear(
  page: Page,
  domain: "whiteboard" | "Python" | "notes" | "all workspace data",
) {
  await page
    .getByRole("button", { name: "Clear workspace data", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Clear workspace data",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: `Clear ${domain}`, exact: true })
    .click();
  await dialog
    .getByRole("button", { name: `Yes, clear ${domain}`, exact: true })
    .click();
}

test("auto-apply renders math, survives reload, and clearing chat persists without deleting notes", async ({
  page,
}) => {
  const requests: Array<{
    messages: Array<{ text: string }>;
    context: any;
    continuation?: unknown;
  }> = [];
  await page.route("**/api/ai", async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    const events = body.continuation
      ? [
          {
            type: "text",
            text: "The cost is $O(\\log n)$.\n\n\\[\\frac{n}{2}\\]",
          },
          { type: "done", continuation: { contents: [] } },
        ]
      : [
          {
            type: "call",
            id: "math-notes",
            name: "edit_notes",
            args: {
              baseRevision: body.context.notes.revision,
              replacements: [
                {
                  from: body.context.notes.length,
                  to: body.context.notes.length,
                  text: "\n\nInline \\(x^2\\).\n\n$$\n\\frac{n}{2}\n$$\n",
                },
              ],
              summary: "Record the equation",
            },
          },
          { type: "done", continuation: { contents: [] } },
        ];
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    });
  });
  await navigate(page, "Journal");
  await page.getByRole("button", { name: "Toggle study partner" }).click();
  const toggle = partner(page).getByRole("switch", {
    name: "Auto-apply changes",
  });
  await expect(toggle).toBeChecked();
  await partner(page)
    .getByRole("textbox", { name: "Ask your study partner" })
    .fill("Record the equation.");
  await partner(page).getByRole("button", { name: "Send message" }).click();
  await expect(partner(page).locator(".katex")).toHaveCount(2);
  await expect(
    partner(page).getByRole("button", { name: "Apply", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Study journal", exact: true })
      .locator(".katex"),
  ).toHaveCount(2);
  const applied = await snapshot(page);
  expect(applied.changes).toHaveLength(1);
  await partner(page)
    .getByRole("button", { name: "Clear chat", exact: true })
    .click();
  await partner(page)
    .getByRole("button", { name: "Clear conversation", exact: true })
    .click();
  await expect(partner(page).locator(".chat-message")).toHaveCount(0);
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Toggle study partner" }).click();
  await expect(
    partner(page).getByRole("switch", { name: "Auto-apply changes" }),
  ).toBeChecked();
  const saved = await snapshot(page);
  expect(saved.messages).toEqual([]);
  expect(saved.notes.text).toBe(applied.notes.text);
  expect(saved.changes).toHaveLength(1);
  expect(requests).toHaveLength(2);
});

test("IDE debugger steps real values, marks edits stale, continues the captured program, and stops", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await navigate(page, "Computer");
  await editCode(page, "value = 2\nvalue += 3\nprint(value)");
  await expect(
    codePanel(page).getByRole("button", { name: "Debug", exact: true }),
  ).toBeEnabled({ timeout: 60_000 });
  await codePanel(page)
    .getByRole("button", { name: "Debug", exact: true })
    .click();
  const debuggerPanel = page.getByRole("region", {
    name: "Python debugger",
    exact: true,
  });
  await expect(debuggerPanel.getByRole("status")).toHaveText(
    "Paused before line 1",
  );
  await expect(codePanel(page).locator(".cm-execution-line")).toContainText(
    "value = 2",
  );
  await debuggerPanel
    .getByRole("button", { name: "Step", exact: true })
    .click();
  await expect(debuggerPanel.getByRole("status")).toHaveText(
    "Paused before line 2",
  );
  await expect(
    debuggerPanel.getByRole("cell", { name: "2", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: ".local/story-debugger.png" });
  await editCode(page, "print('new source')");
  await expect(debuggerPanel).toContainText("Code changed.");
  await expect(codePanel(page).locator(".cm-execution-line")).toHaveCount(0);
  await debuggerPanel
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(
    codePanel(page).getByLabel("Python output", { exact: true }),
  ).toHaveText("5\n");
  await expect(debuggerPanel).toHaveCount(0);
  await expect(
    codePanel(page).getByRole("button", { name: "Debug", exact: true }),
  ).toBeEnabled({ timeout: 60_000 });
  await codePanel(page)
    .getByRole("button", { name: "Debug", exact: true })
    .click();
  await expect(debuggerPanel.getByRole("status")).toHaveText(
    "Paused before line 1",
  );
  await codePanel(page)
    .getByRole("button", { name: "Stop", exact: true })
    .click();
  await expect(debuggerPanel).toHaveCount(0);
  expect((await snapshot(page)).runs.at(-1)?.status).toBe("cancelled");
  expect(errors).toEqual([]);
});

test("domain clearing is scoped and full clearing stops debugging, flips the table, and stays empty after reload", async ({
  page,
}) => {
  await navigate(page, "Whiteboard");
  await page
    .getByRole("button", { name: "Load binary search example" })
    .click();
  await expect
    .poll(async () => (await snapshot(page)).board.elements.length)
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Toggle study partner" }).click();
  await partner(page)
    .getByRole("switch", { name: "Auto-apply changes" })
    .uncheck();
  await partner(page)
    .getByRole("textbox", { name: "Ask your study partner" })
    .fill("Keep my unsent question");
  await clear(page, "whiteboard");
  await expect(
    partner(page).getByRole("switch", { name: "Auto-apply changes" }),
  ).not.toBeChecked();
  await expect(
    partner(page).getByRole("textbox", { name: "Ask your study partner" }),
  ).toHaveValue("Keep my unsent question");
  await partner(page)
    .getByRole("button", { name: "Close study partner" })
    .click();
  let data = await snapshot(page);
  expect(data.board.elements).toEqual([]);
  expect(data.code.text).toContain("binary_search");
  await clear(page, "notes");
  data = await snapshot(page);
  expect(data.notes.text).toBe("");
  expect(data.code.text).toContain("binary_search");
  await navigate(page, "Computer");
  await clear(page, "Python");
  await expect(codePanel(page).locator(".cm-content")).toHaveText("");
  await codePanel(page).getByRole("textbox").press("ControlOrMeta+Z");
  expect((await snapshot(page)).code.text).toBe("");
  await editCode(page, "print('old program')");
  await expect(
    codePanel(page).getByRole("button", { name: "Debug", exact: true }),
  ).toBeEnabled({ timeout: 60_000 });
  await codePanel(page)
    .getByRole("button", { name: "Debug", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Python debugger" }),
  ).toContainText("Paused before line 1");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await clear(page, "all workspace data");
  await expect(
    page.getByRole("status", { name: "Workspace cleared. A fresh desk." }),
  ).toBeVisible();
  await page.screenshot({ path: ".local/story-table-flip.png" });
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  data = await snapshot(page);
  expect(data.code.text).toBe("");
  expect(data.notes.text).toBe("");
  expect(data.board.elements).toEqual([]);
  expect(data.runs).toEqual([]);
  expect(data.messages).toEqual([]);
  expect(data.changes).toEqual([]);
  await expect(partner(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Toggle study partner" }).click();
  await expect(
    partner(page).getByRole("switch", { name: "Auto-apply changes" }),
  ).toBeChecked();
});

test("mobile debugger and clear controls fit, with reduced-motion confirmation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await navigate(page, "Computer");
  await editCode(page, "number = 7\nprint(number)");
  await expect(
    codePanel(page).getByRole("button", { name: "Debug", exact: true }),
  ).toBeEnabled({ timeout: 60_000 });
  await codePanel(page)
    .getByRole("button", { name: "Debug", exact: true })
    .click();
  const debuggerPanel = page.getByRole("region", { name: "Python debugger" });
  await expect(debuggerPanel).toContainText("Paused before line 1");
  await debuggerPanel
    .getByRole("button", { name: "Step", exact: true })
    .click();
  await expect(debuggerPanel).toContainText("Paused before line 2");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const headerControls = page.locator(".app-header button:visible");
    for (const control of await headerControls.all()) {
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
  }
  await page.screenshot({ path: ".local/story-mobile-debugger.png" });
  await page
    .getByRole("button", { name: "Clear workspace data", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Clear workspace data" });
  await dialog
    .getByRole("button", { name: "Clear notes", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Keep my work", exact: true }),
  ).toBeFocused();
  await page.screenshot({ path: ".local/story-mobile-clear.png" });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await codePanel(page)
    .getByRole("button", { name: "Stop", exact: true })
    .click();
});
