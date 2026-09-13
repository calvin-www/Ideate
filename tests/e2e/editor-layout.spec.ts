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

async function open(page: Page, tool = "Computer") {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page
    .getByRole("navigation", { name: "Workspace tools" })
    .getByRole("button", { name: tool, exact: true })
    .click();
}
async function layout(page: Page, action: string) {
  await page
    .getByRole("button", { name: "Editor layout", exact: true })
    .click({ timeout: 10000 });
  await page
    .getByRole("button", { name: action, exact: true })
    .click({ timeout: 10000 });
}
const python = (page: Page) =>
  page.getByRole("region", { name: "Python workspace", exact: true });
const journal = (page: Page) =>
  page.getByRole("region", { name: "Study journal", exact: true });

test("splits real editors and preserves undo when returning to the default", async ({
  page,
}) => {
  await open(page);
  await expect(journal(page)).toBeHidden();
  await page.screenshot({ path: test.info().outputPath("default.png") });
  const editor = python(page).getByRole("textbox");
  await editor.click();
  await editor.press("ControlOrMeta+A");
  await page.keyboard.insertText("print('before layout')");
  await editor.press("End");
  await page.keyboard.type(" # retained");
  await expect(editor).toContainText("# retained");
  await layout(page, "Split with Journal");
  await expect(python(page)).toBeVisible();
  await expect(journal(page)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("split.png") });
  const left = await python(page).boundingBox();
  const right = await journal(page).boundingBox();
  expect(left!.x + left!.width).toBeLessThanOrEqual(right!.x + 12);
  await layout(page, "Single editor");
  await page
    .getByRole("navigation", { name: "Workspace tools" })
    .getByRole("button", { name: "Computer", exact: true })
    .click();
  await expect(journal(page)).toBeHidden();
  await expect(editor).toContainText("# retained");
  await editor.press("ControlOrMeta+z");
  await expect(editor).toContainText("before layout");
  await expect(editor).not.toContainText("# retained");
  await layout(page, "Restore saved layout");
  await expect(journal(page)).toBeVisible();
});

test("floats Python above the board and restores its bounds after maximizing", async ({
  page,
}) => {
  await open(page, "Whiteboard");
  await layout(page, "Float Python");
  await expect(python(page)).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Whiteboard tool", exact: true }),
  ).toBeVisible();
  const initial = await python(page).boundingBox();
  const title = await page.locator(".dv-floating-titlebar").boundingBox();
  await page.mouse.move(
    title!.x + title!.width / 2,
    title!.y + title!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    title!.x + title!.width / 2 - 170,
    title!.y + title!.height / 2 + 90,
    { steps: 10 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await python(page).boundingBox())!.x)
    .toBeLessThan(initial!.x - 100);
  const handle = await page
    .locator(".dv-resize-handle-bottomright")
    .filter({ visible: true })
    .boundingBox();
  await page.mouse.move(
    handle!.x + handle!.width / 2,
    handle!.y + handle!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(handle!.x + 85, handle!.y + 55, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => (await python(page).boundingBox())!.width)
    .toBeGreaterThan(initial!.width + 40);
  await page.screenshot({ path: test.info().outputPath("floating.png") });
  const before = await python(page).boundingBox();
  await page
    .getByRole("button", { name: "Maximize Python", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Restore layout", exact: true }),
  ).toBeVisible();
  const maximized = await python(page).boundingBox();
  await page.screenshot({ path: test.info().outputPath("maximized.png") });
  expect(maximized!.width).toBeGreaterThan(before!.width + 100);
  await page
    .getByRole("button", { name: "Restore layout", exact: true })
    .click();
  await expect
    .poll(async () =>
      Math.abs((await python(page).boundingBox())!.width - before!.width),
    )
    .toBeLessThan(3);
  expect(
    Math.abs((await python(page).boundingBox())!.x - before!.x),
  ).toBeLessThan(3);
  await page.reload();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Workspace tools" })
    .getByRole("button", { name: "Computer", exact: true })
    .click();
  await layout(page, "Restore saved layout");
  await expect
    .poll(async () =>
      Math.abs((await python(page).boundingBox())!.width - before!.width),
    )
    .toBeLessThan(3);
  await page.getByRole("button", { name: "Hide Python", exact: true }).click();
  await expect(python(page)).toBeHidden();
  await expect(
    page.getByRole("region", { name: "Whiteboard tool", exact: true }),
  ).toBeVisible();
});

test("persists resized splits and falls back to the single editor on narrow screens", async ({
  page,
}) => {
  await open(page);
  await layout(page, "Split with Journal");
  const before = await python(page).boundingBox();
  const divider = page
    .locator(
      ".dv-split-view-container.dv-horizontal > .dv-sash-container > .dv-sash",
    )
    .filter({ visible: true })
    .first();
  const bounds = await divider.boundingBox();
  await page.mouse.move(
    bounds!.x + bounds!.width / 2,
    bounds!.y + bounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(bounds!.x - 130, bounds!.y + bounds!.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await python(page).boundingBox())!.width)
    .toBeLessThan(before!.width - 80);
  const resized = await python(page).boundingBox();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("ideate:editor-layout:v1")),
    )
    .not.toBeNull();
  await page.reload();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Workspace tools" })
    .getByRole("button", { name: "Computer", exact: true })
    .click();
  await layout(page, "Restore saved layout");
  await expect(journal(page)).toBeVisible();
  await expect
    .poll(async () =>
      Math.abs((await python(page).boundingBox())!.width - resized!.width),
    )
    .toBeLessThan(5);
  await python(page).getByRole("textbox").click();
  await page.setViewportSize({ width: 600, height: 850 });
  await expect(journal(page)).toBeHidden();
  await expect(python(page)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("narrow.png") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(journal(page)).toBeVisible();
  await page.setViewportSize({ width: 600, height: 850 });
  await page
    .getByRole("navigation", { name: "Workspace tools" })
    .getByRole("button", { name: "Computer", exact: true })
    .click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator(".dv-tab")).toHaveCount(0);
  await expect(python(page)).toBeVisible();
  await expect(journal(page)).toBeHidden();
  await layout(page, "Restore saved layout");
  await expect(journal(page)).toBeVisible();
});

test("header navigation always opens each editor full size and retains the split arrangement", async ({
  page,
}) => {
  await open(page);
  await layout(page, "Split with Journal");
  for (const name of ["Computer", "Whiteboard", "Journal"]) {
    await page
      .getByRole("navigation", { name: "Workspace tools" })
      .getByRole("button", { name, exact: true })
      .click();
    await expect(page.locator("[data-editor-tool]:visible")).toHaveCount(1);
    await expect(page.locator(".dv-tab")).toHaveCount(0);
    const expected =
      name === "Computer"
        ? python(page)
        : name === "Journal"
          ? journal(page)
          : page.getByRole("region", { name: "Whiteboard tool", exact: true });
    await expect(expected).toBeVisible();
    const bounds = await expected.boundingBox();
    expect(bounds!.width).toBeGreaterThan(1300);
    await layout(page, "Restore saved layout");
    await expect(page.locator(".dv-tab")).toHaveCount(2);
  }
});

test("docks a floating editor and keeps single mode after hiding the last panel", async ({
  page,
}) => {
  await open(page, "Whiteboard");
  await layout(page, "Float Python");
  await page.getByRole("button", { name: "Dock Python", exact: true }).click();
  await expect(python(page)).toBeVisible();
  await expect(page.locator(".dv-floating-titlebar")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Hide Whiteboard", exact: true })
    .click();
  await page.getByRole("button", { name: "Hide Python", exact: true }).click();
  await expect(page.locator(".dv-tab")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("ideate:editor-layout:v1")!).enabled,
      ),
    )
    .toBe(false);
  await page.reload();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Workspace tools" })
    .getByRole("button", { name: "Computer", exact: true })
    .click();
  await expect(python(page)).toBeVisible();
  await expect(page.locator(".dv-tab")).toHaveCount(0);
});

test("drags editors into a tab group without recreating the editor", async ({
  page,
}) => {
  await open(page);
  const original = await python(page).getByRole("textbox").elementHandle();
  await layout(page, "Split with Journal");
  const tab = page.getByRole("tab", { name: "Python", exact: true });
  const source = await page
    .getByRole("tab", { name: "Journal", exact: true })
    .boundingBox();
  const target = await python(page).boundingBox();
  await page.mouse.move(
    source!.x + source!.width / 2,
    source!.y + source!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    source!.x + source!.width / 2 - 20,
    source!.y + source!.height / 2,
    { steps: 3 },
  );
  await page.mouse.move(
    target!.x + target!.width / 2,
    target!.y + target!.height / 2,
    { steps: 12 },
  );
  await page.mouse.move(
    target!.x + target!.width / 2 + 1,
    target!.y + target!.height / 2 + 1,
  );
  await page.mouse.up();
  await expect(python(page)).toBeHidden();
  await expect(journal(page)).toBeVisible();
  await tab.click();
  await expect(python(page)).toBeVisible();
  await expect(journal(page)).toBeHidden();
  expect(
    await python(page)
      .getByRole("textbox")
      .evaluate((element, previous) => element === previous, original),
  ).toBe(true);
});

test("Python keeps running while its editor is split, floated, and maximized", async ({
  page,
}) => {
  await open(page);
  const editor = python(page).getByRole("textbox");
  await editor.click();
  await editor.press("ControlOrMeta+A");
  await page.keyboard.insertText(
    "import time\nfor i in range(8):\n    print('tick', i, flush=True)\n    time.sleep(0.8)\nprint('layout-finished')",
  );
  const runner = await page
    .getByTitle("Isolated Python runner", { exact: true })
    .elementHandle();
  await python(page)
    .getByRole("button", { name: "Run Python", exact: true })
    .click();
  const output = python(page).getByLabel("Python output", { exact: true });
  await expect(output).toContainText("tick 0", { timeout: 30000 });
  await layout(page, "Split with Journal");
  await page.getByRole("button", { name: "Float Python", exact: true }).click();
  await page
    .getByRole("button", { name: "Maximize Python", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Restore layout", exact: true })
    .click();
  await expect(output).toContainText("layout-finished", { timeout: 30000 });
  expect(
    await page
      .getByTitle("Isolated Python runner", { exact: true })
      .evaluate((element, previous) => element === previous, runner),
  ).toBe(true);
});
