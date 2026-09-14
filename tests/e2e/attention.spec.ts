import { readFile } from "node:fs/promises";
import { arrange, goToTool } from "./desk-navigation";
import { loadBoardExample } from "./board-fixture";
import { test, expect, type Page } from "@playwright/test";
import type { Workspace } from "../../src/features/workspace/model";

type Context = {
  board: Workspace["board"];
  code: Workspace["code"];
  notes: Workspace["notes"];
};
async function fixture(
  page: Page,
  cues: (context: Context) => Record<string, unknown>[],
) {
  const results: { status: string; visible: boolean }[] = [];
  await page.route("**/api/ai", async (route) => {
    const body = route.request().postDataJSON();
    if (body.toolResults)
      results.push(
        ...body.toolResults.map(
          (r: { result: (typeof results)[number] }) => r.result,
        ),
      );
    const calls = body.toolResults
      ? []
      : cues(body.context).map((args, i) => ({
          id: `cue-${i}`,
          name: "show_attention",
          args,
        }));
    const events = calls.length
      ? [
          ...calls.map((call) => ({ type: "call", ...call })),
          {
            type: "done",
            continuation: {
              contents: [
                {
                  role: "model",
                  parts: calls.map((functionCall) => ({ functionCall })),
                },
              ],
            },
          },
        ]
      : [
          { type: "text", text: "Look at the marked idea." },
          { type: "done", continuation: { contents: [] } },
        ];
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    });
  });
  return results;
}
async function open(page: Page, domain: "Computer" | "Whiteboard" | "Journal") {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await navigate(page, domain);
  await page
    .getByRole("button", { name: "Toggle study partner", exact: true })
    .click();
}
async function navigate(page: Page, name: string) {
  await goToTool(page, name);
}
async function ask(page: Page) {
  const composer = page.getByRole("textbox", {
    name: "Ask your study partner",
  });
  await composer.fill("Point out the important part");
  await composer.press("Enter");
  await expect(
    page.getByRole("button", { name: "Stop AI request" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Look at the marked idea.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply", exact: true }),
  ).toHaveCount(0);
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

test("journal selection stays visible on every selected line", async ({ page }, testInfo) => {
  await open(page, "Journal");
  const journal = page.getByRole("region", { name: "Study journal", exact: true });
  const editor = journal.getByRole("textbox");
  const passage = "First journal line.\nSecond **bold** journal line.\nThird journal line.";
  await editor.click();
  await editor.press("ControlOrMeta+A");
  await page.keyboard.insertText(passage);
  await editor.press("ControlOrMeta+Home");
  await editor.press("ControlOrMeta+Shift+End");
  await expect.poll(() => editor.evaluate(() => window.getSelection()?.toString())).toBe(passage);
  await expect(journal.locator(".cm-selectionBackground").last()).toBeVisible();
  // Opaque active-line paint sits above CodeMirror's drawn selection layer.
  // It must clear while selecting, including the line containing the head.
  await expect(journal.locator(".cm-activeLine")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const backgrounds = await journal.locator(".cm-selectionBackground").evaluateAll((nodes) =>
    nodes.map((node) => getComputedStyle(node).backgroundColor),
  );
  expect(new Set(backgrounds).size).toBe(1);
  expect(backgrounds[0]).not.toBe("rgba(0, 0, 0, 0)");
  await page.screenshot({ path: testInfo.outputPath("journal-selection.png") });
  await editor.press("ArrowRight");
  await expect(journal.locator(".cm-selectionBackground")).toHaveCount(0);
  await expect(journal.locator(".cm-activeLine")).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});

for (const domain of ["Computer", "Journal"] as const) {
  test(`${domain} multiline attention encompasses the passage in one box`, async ({ page }, testInfo) => {
    const target = domain === "Computer" ? "code" : "notes";
    await fixture(page, (context) => [{
      target,
      revision: context[target].revision,
      from: 0,
      to: context[target].text.indexOf("\n\nOutside"),
      mode: "highlight",
      label: "The complete passage",
    }]);
    await open(page, domain);
    const panel = page.getByRole("region", {
      name: domain === "Computer" ? "Python workspace" : "Study journal",
      exact: true,
    });
    const editor = panel.getByRole("textbox");
    await editor.click();
    await editor.press("ControlOrMeta+A");
    const passage = domain === "Journal"
      ? `First marked paragraph.\n\n${"Second marked paragraph wraps across the editor. ".repeat(5)}\n\nThird marked paragraph.`
      : "First marked line.\nSecond marked line is longer.\nThird marked line.";
    await page.keyboard.insertText(`${passage}\n\nOutside this passage.`);
    await ask(page);
    const boxes = panel.locator(`[data-attention-target="${target}"] [data-attention-box]`);
    await expect(boxes).toHaveCount(1);
    const bounds = (await boxes.boundingBox())!;
    const lines = await panel.locator(".cm-line").evaluateAll((nodes) => nodes.filter((node) => node.textContent?.trim()).slice(0, 3).map((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect().toJSON();
    }));
    for (const line of lines) {
      expect(bounds.x).toBeLessThanOrEqual(line.left + 1);
      expect(bounds.y).toBeLessThanOrEqual(line.top + 1);
      expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(line.right - 1);
      expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(line.bottom - 1);
    }
    const outside = await panel.locator(".cm-line").last().boundingBox();
    expect(bounds.y + bounds.height).toBeLessThan(outside!.y);
    await page.screenshot({ path: testInfo.outputPath(`${target}-multiline-cue.png`) });
    if (domain === "Journal") {
      await panel.getByRole("tab", { name: "Preview", exact: true }).click();
      await expect(boxes).toHaveCount(1);
      await expect(boxes).toBeVisible();
      const previewBounds = (await boxes.boundingBox())!;
      const paragraphs = await panel.locator("article > p").evaluateAll((nodes) =>
        nodes.slice(0, 3).map((node) => node.getBoundingClientRect().toJSON()),
      );
      expect(previewBounds.y).toBeLessThanOrEqual(paragraphs[0].top + 1);
      expect(previewBounds.y + previewBounds.height).toBeGreaterThanOrEqual(paragraphs[2].bottom - 1);
    }
  });
}

for (const origin of ["Computer", "Journal", "Desk", "Narrow"]) {
  test(`Show from ${origin} reveals the Python source behind its output tab`, async ({
    page,
  }) => {
    const results = await fixture(page, ({ code }) => [
      {
        target: "code",
        revision: code.revision,
        from: 0,
        to: 10,
        mode: "highlight",
        label: "Source behind output",
      },
    ]);
    await open(page, "Computer");
    await page
      .getByRole("button", { name: "Move output", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Output position" })
      .getByRole("button", { name: "Tab with editor", exact: true })
      .click();
    const editor = page
      .getByRole("region", { name: "Python workspace", exact: true })
      .getByRole("textbox");
    await expect(editor).toBeHidden();
    if (origin === "Narrow") await page.setViewportSize({ width: 600, height: 850 });
    if (origin !== "Computer" && origin !== "Narrow") await navigate(page, origin);
    await ask(page);
    await page
      .getByRole("button", { name: "Show in Python Source behind output" })
      .click();
    await expect(editor).toBeVisible();
    expect(results.map((result) => result.visible)).toEqual([origin === "Narrow"]);
    await expect(page.locator('[data-attention-target="code"]')).toBeVisible();
    if (origin === "Narrow") {
      await page.getByRole("button", { name: "Toggle study partner", exact: true }).click();
      await page.setViewportSize({ width: 1440, height: 1000 });
      await expect(editor).toBeVisible();
      await expect(page.locator(".dv-tab")).toHaveCount(2);
    }
    if (origin === "Journal") {
      await expect(page.locator(".dv-tab")).toHaveCount(0);
      await arrange(page, "Restore previous arrangement");
    }
    await page.getByRole("tab", { name: "Output", exact: true }).click();
    await navigate(page, "Journal");
    await navigate(page, "Computer");
    await expect(editor).toBeVisible();
    await expect(page.locator(".dv-tab")).toHaveCount(0);
    await arrange(page, "Restore previous arrangement");
    await expect(editor).toBeHidden();
  });
}

test("Python highlights preserve selections and source, follow scroll, and clear on edit", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await fixture(page, ({ code }) => {
    const from = code.text.indexOf("mid =");
    return [
      {
        target: "code",
        revision: code.revision,
        from,
        to: from + 23,
        mode: "highlight",
        label: "Choose the midpoint",
      },
    ];
  });
  await open(page, "Computer");
  const editor = page
    .getByRole("region", { name: "Python workspace", exact: true })
    .getByRole("textbox");
  await editor.click();
  await editor.press("ControlOrMeta+End");
  await page.keyboard.insertText("\n" + "# More practice\n".repeat(40));
  await editor.press("ControlOrMeta+Home");
  await editor.press("Shift+End");
  await expect(
    page.getByRole("button", { name: "Remove selection context" }),
  ).toBeVisible();
  await page
    .locator(".cm-foldGutter .cm-gutterElement")
    .filter({ hasText: "⌄" })
    .first()
    .click();
  await expect(page.locator(".cm-foldPlaceholder")).toBeVisible();
  const before = await snapshot(page);
  await ask(page);
  const overlay = page.locator('[data-attention-target="code"]');
  const box = overlay.locator("[data-attention-box]").first();
  await expect(box).toBeVisible();
  await expect(page.locator(".cm-foldPlaceholder")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Remove selection context" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Ask your study partner" }),
  ).toBeFocused();
  const after = await snapshot(page);
  expect(after.code).toEqual(before.code);
  expect(after.changes).toEqual(before.changes);
  expect(after).not.toHaveProperty("attention");
  await page.screenshot({ path: testInfo.outputPath("python-cue.png") });
  const original = await box.boundingBox();
  await page
    .locator(".cm-scroller")
    .first()
    .evaluate((node) => {
      node.scrollTop += 40;
    });
  await expect
    .poll(async () => (await box.boundingBox())?.y)
    .not.toBe(original?.y);
  await editor.click();
  await editor.press("End");
  await page.keyboard.insertText(" # edited");
  await expect(overlay).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("notes work in preview and edit, and a cue in another domain waits for Show", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const results = await fixture(page, ({ notes, code }) => [
    {
      target: "notes",
      revision: notes.revision,
      from: notes.text.indexOf("Compare"),
      to: notes.text.indexOf("Compare") + 7,
      mode: "highlight",
      label: "Compare the boundaries",
    },
    {
      target: "code",
      revision: code.revision,
      from: 0,
      to: 0,
      mode: "point",
      label: "Start here",
    },
  ]);
  await open(page, "Journal");
  const journal = page.getByRole("region", {
    name: "Study journal",
    exact: true,
  });
  const editor = journal.getByRole("textbox");
  await editor.click();
  await editor.press("ControlOrMeta+A");
  await page.keyboard.insertText(
    "# Search notes\n\nCompare **low** and high before choosing the midpoint.\n\nKeep the interval inclusive.\n",
  );
  await journal.getByRole("tab", { name: "Preview", exact: true }).click();
  await ask(page);
  await expect(
    journal.getByRole("tab", { name: "Preview", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const overlay = page.locator('[data-attention-target="notes"]');
  await expect(overlay.locator("[data-attention-box]")).toHaveCount(1);
  await expect(overlay.getByRole("status")).toHaveText(
    "Compare the boundaries",
  );
  expect(results.map((result) => result.visible)).toEqual([true, false]);
  await page.screenshot({ path: testInfo.outputPath("notes-preview-cue.png") });
  await journal.getByRole("tab", { name: "Edit", exact: true }).click();
  await expect(overlay.locator("[data-attention-box]").first()).toBeVisible();
  await page.getByRole("button", { name: "Show in Python Start here" }).click();
  const codeOverlay = page.locator('[data-attention-target="code"]');
  await expect(codeOverlay.getByRole("status")).toHaveText("Start here");
  await expect(codeOverlay.locator("[data-attention-box]")).toHaveCount(0);
  await page.getByRole("button", { name: "Dismiss code cue" }).click();
  await expect(codeOverlay).toHaveCount(0);
  await page.getByRole("button", { name: "Clear notes cue" }).click();
  await expect(page.getByLabel("Study partner cues")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("whiteboard cues follow zoom and pan without editing the drawing", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await fixture(page, ({ board }) => [
    {
      target: "board",
      revision: board.revision,
      ids: board.elements.filter((e) => e.type === "rectangle").slice(0, 2).map((e) => e.id),
      mode: "highlight",
      label: "This search value",
    },
  ]);
  await open(page, "Whiteboard");
  await loadBoardExample(page);
  const before = await snapshot(page);
  await ask(page);
  await expect(page.locator('[data-attention-target="board"] [data-attention-box]')).toHaveCount(2);
  const box = page
    .locator('[data-attention-target="board"] [data-attention-box]')
    .first();
  await expect(box).toBeVisible();
  const original = await box.boundingBox();
  const zoomOut = page.getByRole("button", { name: "Zoom out", exact: true });
  await zoomOut.click();
  await expect
    .poll(async () => (await box.boundingBox())?.width)
    .toBeLessThan(original!.width);
  const zoomed = await box.boundingBox();
  const canvas = page.locator(".excalidraw canvas").last();
  const canvasBounds = (await canvas.boundingBox())!;
  await page.mouse.move(
    canvasBounds.x + canvasBounds.width / 2,
    canvasBounds.y + canvasBounds.height / 2,
  );
  await page.mouse.wheel(0, 50);
  await expect
    .poll(async () => (await box.boundingBox())?.y)
    .not.toBe(zoomed?.y);
  const after = await snapshot(page);
  expect(after.board.elements).toEqual(before.board.elements);
  expect(after.board.revision).toEqual(before.board.revision);
  expect(after.changes).toEqual(before.changes);
  await page.screenshot({ path: testInfo.outputPath("board-cue.png") });
  await page.getByRole("button", { name: "Dismiss board cue" }).click();
  await expect(box).toHaveCount(0);
  const camera = (await snapshot(page)).board.viewport;
  await navigate(page, "Computer");
  await navigate(page, "Whiteboard");
  expect((await snapshot(page)).board.viewport).toEqual(camera);
  expect(errors).toEqual([]);
});

for (const example of [
  {
    name: "nested list",
    text: "- Parent concept\n  - Child example\n",
    mode: "Preview",
  },
  {
    name: "link definition",
    text: "[reference]: https://example.com\n",
    mode: "Edit",
  },
] as const) {
  test(`notes reveal the complete ${example.name} target`, async ({ page }) => {
    await fixture(page, ({ notes }) => [
      {
        target: "notes",
        revision: notes.revision,
        from: 0,
        to: notes.text.length,
        mode: "highlight",
        label: "The whole passage",
      },
    ]);
    await open(page, "Journal");
    const journal = page.getByRole("region", {
      name: "Study journal",
      exact: true,
    });
    const editor = journal.getByRole("textbox");
    await editor.click();
    await editor.press("ControlOrMeta+A");
    await page.keyboard.insertText(example.text);
    await journal.getByRole("tab", { name: "Preview", exact: true }).click();
    await ask(page);
    await expect(
      journal.getByRole("tab", { name: example.mode, exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    const box = page
      .locator('[data-attention-target="notes"] [data-attention-box]')
      .first();
    await expect(box).toBeVisible();
    if (example.mode === "Preview") {
      const parent = await journal.locator("article > ul > li").boundingBox();
      const bounds = await box.boundingBox();
      expect(Math.abs(bounds!.y - parent!.y)).toBeLessThan(2);
      expect(bounds!.height).toBeGreaterThanOrEqual(parent!.height - 1);
    }
  });
}
