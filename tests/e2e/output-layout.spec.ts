import { expect, test as base, type Page } from "@playwright/test";

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
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await computer(page);
});
const computer = (page: Page) =>
  page
    .getByRole("navigation", { name: "Workspace tools" })
    .getByRole("button", { name: "Computer", exact: true })
    .click();
const source = (page: Page) =>
  page
    .getByRole("region", { name: "Python workspace", exact: true })
    .getByRole("textbox");
const output = (page: Page) =>
  page.getByRole("region", { name: "Python output panel", exact: true });
async function move(page: Page, action: string) {
  await page
    .getByRole("button", { name: "Move output", exact: true })
    .click({ timeout: 10000 });
  await page
    .getByRole("dialog", { name: "Output position" })
    .getByRole("button", { name: action, exact: true })
    .click({ timeout: 10000 });
}
test("starting Python keeps output in its docked or floating position", async ({
  page,
}) => {
  const editor = source(page);
  await editor.click();
  await editor.press("ControlOrMeta+A");
  await page.keyboard.insertText("print('position retained')");
  for (const placement of ["Move output right", "Float output"]) {
    await move(page, placement);
    if (placement === "Float output") {
      // Keep the floating window clear of the source toolbar before clicking Run.
      const title = await page.locator(".dv-floating-titlebar").boundingBox();
      await page.mouse.move(title!.x + title!.width / 2, title!.y + 10);
      await page.mouse.down();
      await page.mouse.move(title!.x + title!.width / 2, title!.y + 110, {
        steps: 8,
      });
      await page.mouse.up();
    }
    const before = await output(page).boundingBox();
    await page.getByRole("button", { name: "Run Python", exact: true }).click();
    await expect(output(page)).toContainText("position retained", {
      timeout: 30000,
    });
    await expect(
      page.getByRole("tab", { name: "Output", exact: true }),
    ).toBeVisible();
    const after = await output(page).boundingBox();
    expect(Math.abs(after!.x - before!.x)).toBeLessThan(3);
    expect(Math.abs(after!.y - before!.y)).toBeLessThan(3);
    expect(Math.abs(after!.width - before!.width)).toBeLessThan(3);
    await output(page)
      .getByRole("button", { name: "Clear", exact: true })
      .click();
  }
  await move(page, "Tab with editor");
  await page
    .getByRole("region", { name: "Python output panel", exact: true })
    .getByRole("button", { name: "Move output", exact: true })
    .focus();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(output(page)).toContainText("position retained", {
    timeout: 30000,
  });
  await expect(editor).toBeHidden();
  await expect(
    page.getByRole("tab", { name: "Output", exact: true }),
  ).toBeVisible();
});

test("starting the debugger keeps output detached", async ({ page }) => {
  const editor = source(page);
  await editor.click();
  await editor.press("ControlOrMeta+A");
  await page.keyboard.insertText("value = 7\nprint(value)");
  await move(page, "Move output right");
  await page.getByRole("button", { name: "Debug", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("tab", { name: "Output", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(output(page)).toContainText("7", { timeout: 30000 });
});

test("output can be placed around the source without recreating the editor", async ({
  page,
}) => {
  const editor = source(page);
  const original = await editor.elementHandle();
  await editor.click();
  await editor.press("ControlOrMeta+A");
  await page.keyboard.insertText("print('kept')");
  await editor.press("End");
  await page.keyboard.type(" # undo me");
  for (const position of ["right", "left", "above", "below"]) {
    await move(page, `Move output ${position}`);
    await expect(
      page.getByRole("tab", { name: "Output", exact: true }),
    ).toBeVisible();
    const code = await editor.boundingBox();
    const result = await output(page).boundingBox();
    if (position === "right")
      expect(result!.x).toBeGreaterThan(code!.x + code!.width - 12);
    if (position === "left")
      expect(result!.x + result!.width).toBeLessThan(code!.x + 12);
    if (position === "above")
      expect(result!.y + result!.height).toBeLessThan(code!.y + 12);
    if (position === "below")
      expect(result!.y).toBeGreaterThan(code!.y + code!.height - 12);
    expect(
      await editor.evaluate(
        (element, previous) => element === previous,
        original,
      ),
    ).toBe(true);
  }
  await page.screenshot({ path: test.info().outputPath("output-below.png") });
  await move(page, "Return output to editor");
  await expect(
    page.getByRole("tab", { name: "Output", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("separator", { name: "Resize output panel" }),
  ).toBeVisible();
  await editor.click();
  await editor.press("ControlOrMeta+z");
  await expect(editor).not.toContainText("# undo me");
});

test("floating output keeps streaming and can be moved, resized, and maximized", async ({
  page,
}) => {
  const editor = source(page);
  await editor.click();
  await editor.press("ControlOrMeta+A");
  await page.keyboard.insertText(
    "import time\nfor i in range(10):\n    print('tick', i, flush=True)\n    time.sleep(0.7)\nprint('output-finished')",
  );
  await page.getByRole("button", { name: "Run Python", exact: true }).click();
  await expect(output(page)).toContainText("tick 0", { timeout: 30000 });
  await move(page, "Float output");
  const before = await output(page).boundingBox();
  const title = await page.locator(".dv-floating-titlebar").boundingBox();
  await page.mouse.move(title!.x + title!.width / 2, title!.y + 10);
  await page.mouse.down();
  await page.mouse.move(title!.x + title!.width / 2 - 160, title!.y + 90, {
    steps: 10,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await output(page).boundingBox())!.x)
    .toBeLessThan(before!.x - 100);
  const handle = await page
    .locator(".dv-resize-handle-bottomright")
    .filter({ visible: true })
    .boundingBox();
  await page.mouse.move(handle!.x + 2, handle!.y + 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 90, handle!.y + 60, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => (await output(page).boundingBox())!.width)
    .toBeGreaterThan(before!.width + 50);
  await page.screenshot({
    path: test.info().outputPath("floating-output.png"),
  });
  const bounds = await output(page).boundingBox();
  await page
    .getByRole("button", { name: "Maximize Output", exact: true })
    .click();
  await expect(source(page)).toBeHidden();
  await expect(output(page)).toBeVisible();
  await page
    .getByRole("button", { name: "Restore layout", exact: true })
    .click();
  await expect
    .poll(async () =>
      Math.abs((await output(page).boundingBox())!.width - bounds!.width),
    )
    .toBeLessThan(3);
  await expect(output(page)).toContainText("output-finished", {
    timeout: 30000,
  });
  await move(page, "Return output to editor");
  await expect(output(page)).toContainText("tick 9");
  await output(page)
    .getByRole("button", { name: "Clear", exact: true })
    .click();
  await expect(output(page)).toContainText("Output cleared");
});

test("navigation and reload restore Computer's separate output layout", async ({
  page,
}) => {
  await move(page, "Move output right");
  const before = await output(page).boundingBox();
  await page
    .getByRole("navigation", { name: "Workspace tools" })
    .getByRole("button", { name: "Whiteboard", exact: true })
    .click();
  await expect(output(page)).toBeHidden();
  await computer(page);
  await expect
    .poll(async () =>
      Math.abs((await output(page).boundingBox())!.width - before!.width),
    )
    .toBeLessThan(3);
  await expect(
    page.getByRole("tab", { name: "Output", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await computer(page);
  await expect(page.locator(".dv-tab")).toHaveCount(2);
  await expect(output(page)).toBeVisible();
  await page.setViewportSize({ width: 600, height: 850 });
  await expect(
    page.getByRole("separator", { name: "Resize output panel" }),
  ).toBeVisible();
  await expect(output(page)).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(
    page.getByRole("tab", { name: "Output", exact: true }),
  ).toBeVisible();
});

test("output can share a tab group and stays usable when its editor is hidden", async ({
  page,
}) => {
  const editor = source(page);
  await editor.click();
  await editor.press("ControlOrMeta+A");
  await page.keyboard.insertText("print('tabbed output')");
  await page.getByRole("button", { name: "Run Python", exact: true }).click();
  await expect(output(page)).toContainText("tabbed output", { timeout: 30000 });
  await move(page, "Tab with editor");
  await expect(editor).toBeHidden();
  await expect(output(page)).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Workspace tools" });
  await computer(page);
  await expect(editor).toBeHidden();
  await navigation.getByRole("button", { name: "Desk", exact: true }).click();
  await computer(page);
  await expect(editor).toBeHidden();
  await expect(output(page)).toBeVisible();
  await page.getByRole("tab", { name: "Python", exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(output(page)).toBeHidden();
  await page.getByRole("tab", { name: "Output", exact: true }).click();
  await expect(output(page)).toContainText("tabbed output");
  await move(page, "Move output right");
  await page.getByRole("button", { name: "Hide Python", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(output(page)).toContainText("tabbed output");
  await navigation.getByRole("button", { name: "Desk", exact: true }).click();
  await computer(page);
  await expect(editor).toBeHidden();
  await expect(page.locator(".dv-tab")).toHaveCount(1);
  await move(page, "Move output left");
  await expect(editor).toBeVisible();
  const left = await output(page).boundingBox();
  const right = await editor.boundingBox();
  expect(left!.x + left!.width).toBeLessThan(right!.x + 12);
  await page.getByRole("button", { name: "Hide Python", exact: true }).click();
  await page
    .getByRole("button", { name: "Return output to editor", exact: true })
    .click();
  await expect(editor).toBeVisible();
  await expect(output(page)).toContainText("tabbed output");
  await expect(
    page.getByRole("separator", { name: "Resize output panel" }),
  ).toBeVisible();
});

test("error links reveal the source when output is the active tab", async ({
  page,
}) => {
  const editor = source(page);
  await editor.click();
  await editor.press("ControlOrMeta+A");
  await page.keyboard.insertText(
    "print('retained')\nraise ValueError('output review')",
  );
  await page.getByRole("button", { name: "Run Python", exact: true }).click();
  await expect(output(page)).toContainText("ValueError: output review", {
    timeout: 30000,
  });
  await move(page, "Tab with editor");
  await expect(editor).toBeHidden();
  await output(page)
    .getByRole("button", { name: "Go to main.py, line 2", exact: true })
    .click();
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();
  await expect(page.locator(".dv-tab")).toHaveCount(2);
});
