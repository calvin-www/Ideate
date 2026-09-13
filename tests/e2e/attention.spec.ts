import { readFile } from "node:fs/promises";
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
  await page
    .getByRole("navigation", { name: "Workspace tools" })
    .getByRole("button", { name, exact: true })
    .click();
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
      ids: [board.elements.find((e) => e.type === "rectangle")!.id],
      mode: "highlight",
      label: "This search value",
    },
  ]);
  await open(page, "Whiteboard");
  await page
    .getByRole("button", { name: "Load binary search example" })
    .click();
  const before = await snapshot(page);
  await ask(page);
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
