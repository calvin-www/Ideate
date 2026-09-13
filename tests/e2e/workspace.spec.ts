import { readFile } from "node:fs/promises";
import { goToTool } from "./desk-navigation";
import { test as base, expect, type Page } from "@playwright/test";
import type { Workspace } from "../../src/features/workspace/model";

const test = base.extend<{ applicationErrors: string[] }>({
  applicationErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (
          message.type() === "error" &&
          !message.text().startsWith("Failed to load resource:")
        )
          errors.push(message.text());
      });
      await use(errors);
      expect(errors, "No uncaught application or console errors").toEqual([]);
    },
    { auto: true },
  ],
});

test.use({ channel: "chrome", reducedMotion: "reduce" });

async function openWorkspace(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

async function navigate(
  page: Page,
  name: "Desk" | "Whiteboard" | "Computer" | "Journal",
) {
  await goToTool(page, name);
}

function pythonPanel(page: Page) {
  return page.getByRole("region", { name: "Python workspace", exact: true });
}
function journalPanel(page: Page) {
  return page.getByRole("region", { name: "Study journal", exact: true });
}

async function editDocument(
  page: Page,
  target: "code" | "notes",
  text: string,
) {
  const editor = (
    target === "code" ? pythonPanel(page) : journalPanel(page)
  ).getByRole("textbox");
  await editor.click();
  await editor.press("ControlOrMeta+A");
  if (text) await page.keyboard.insertText(text);
  else await editor.press("Backspace");
}

async function runPython(page: Page) {
  const run = pythonPanel(page).getByRole("button", {
    name: "Run Python",
    exact: true,
  });
  await expect(run).toBeEnabled({ timeout: 60_000 });
  await run.click();
}

async function exportedWorkspace(page: Page): Promise<Workspace> {
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export workspace", exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("ideate-workspace.json");
  const path = await download.path();
  expect(path).not.toBeNull();
  return JSON.parse(await readFile(path!, "utf8")) as Workspace;
}

test("binary search executes its real found and missing-target paths", async ({
  page,
}) => {
  await openWorkspace(page);
  await navigate(page, "Computer");
  await runPython(page);
  const output = pythonPanel(page).getByLabel("Python output", { exact: true });
  await expect(output).toContainText("Found at index 4", { timeout: 30_000 });
  await expect(output).toContainText("low=0  high=7  mid=3  value=12");
  await expect(output).toContainText("low=4  high=7  mid=5  value=23");
  await expect(output).toContainText("low=4  high=4  mid=4  value=16");

  const original = await exportedWorkspace(page);
  expect(original.runs.at(-1)?.status).toBe("success");
  await editDocument(
    page,
    "code",
    original.code.text.replace("target = 16", "target = 17"),
  );
  await expect(
    pythonPanel(page).getByText(/This output is from an earlier version/),
  ).toBeVisible();
  await runPython(page);
  await expect(output).toContainText("Not found", { timeout: 30_000 });
  await expect(output).not.toContainText("Found at index 4");
  const changed = await exportedWorkspace(page);
  expect(changed.runs.at(-1)).toMatchObject({
    status: "success",
    revision: changed.code.revision,
  });
  expect(changed.runs.at(-1)?.code).toContain("target = 17");
});

test("stderr and traceback lines are readable, and empty code succeeds explicitly", async ({
  page,
}) => {
  await openWorkspace(page);
  await navigate(page, "Computer");
  await editDocument(
    page,
    "code",
    'import sys\nprint("before the error", file=sys.stderr)\nraise ValueError("a useful failure")\n',
  );
  await runPython(page);
  const output = pythonPanel(page).getByLabel("Python output", { exact: true });
  await expect(output).toContainText("before the error", { timeout: 30_000 });
  await expect(output).toContainText("ValueError: a useful failure");
  await pythonPanel(page)
    .getByRole("button", { name: "Go to main.py, line 3", exact: true })
    .click();
  await expect(pythonPanel(page).getByRole("textbox")).toBeFocused();
  const failed = await exportedWorkspace(page);
  expect(failed.runs.at(-1)).toMatchObject({ status: "error", line: 3 });

  await editDocument(page, "code", "# the error source changed\n");
  await expect(
    pythonPanel(page).getByRole("button", { name: /Go to main.py, line/ }),
  ).toHaveCount(0);
  await editDocument(page, "code", "");
  await runPython(page);
  await expect(
    pythonPanel(page).getByText(
      "Completed successfully. This program did not print any output.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 30_000 });
  expect((await exportedWorkspace(page)).runs.at(-1)).toMatchObject({
    status: "success",
    code: "",
    output: "",
  });
});

test("an infinite loop can be stopped and Python runs again after restarting", async ({
  page,
}) => {
  await openWorkspace(page);
  await navigate(page, "Computer");
  await editDocument(
    page,
    "code",
    'print("loop started")\nwhile True:\n    pass\n',
  );
  await runPython(page);
  await expect(
    pythonPanel(page).getByText("Python is running", { exact: true }),
  ).toBeVisible();
  await pythonPanel(page)
    .getByRole("button", { name: "Stop", exact: true })
    .click();
  await expect(
    pythonPanel(page).getByText(
      "Run stopped. You can edit your code and try again.",
      { exact: true },
    ),
  ).toBeVisible();
  expect((await exportedWorkspace(page)).runs.at(-1)?.status).toBe("cancelled");
  await editDocument(page, "code", 'print("ready again", 6 * 7)\n');
  await runPython(page);
  await expect(
    pythonPanel(page).getByLabel("Python output", { exact: true }),
  ).toContainText("ready again 42", { timeout: 30_000 });
  expect((await exportedWorkspace(page)).runs.at(-1)?.status).toBe("success");
});

test("code and Markdown notes retain edits across navigation and reload", async ({
  page,
}) => {
  await openWorkspace(page);
  const code = "prediction = 21 * 2\nprint(prediction)\n";
  const notes =
    "# A useful invariant\n\nThe array stays sorted.\n\n| Step | Bound |\n| --- | --- |\n| One | 4 |\n\n```python\nlow = mid + 1\n```\n\n<script>window.untrustedMarkdown = true</script>\n";
  await navigate(page, "Computer");
  await editDocument(page, "code", code);
  await navigate(page, "Journal");
  await editDocument(page, "notes", notes);
  await journalPanel(page)
    .getByRole("tab", { name: "Preview", exact: true })
    .click();
  await expect(
    journalPanel(page).getByRole("heading", {
      name: "A useful invariant",
      exact: true,
    }),
  ).toBeVisible();
  await expect(journalPanel(page).getByRole("table")).toContainText("One");
  await expect(journalPanel(page).locator("pre")).toHaveText("low = mid + 1\n");
  expect(await page.evaluate(() => "untrustedMarkdown" in window)).toBe(false);
  await navigate(page, "Desk");
  await navigate(page, "Computer");
  await expect(pythonPanel(page).getByRole("textbox")).toContainText(
    "prediction = 21 * 2",
  );
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  const saved = await exportedWorkspace(page);
  expect(saved.code.text).toBe(code);
  expect(saved.notes.text).toBe(notes);
  await navigate(page, "Journal");
  await journalPanel(page)
    .getByRole("tab", { name: "Preview", exact: true })
    .click();
  await expect(
    journalPanel(page).getByRole("heading", {
      name: "A useful invariant",
      exact: true,
    }),
  ).toBeVisible();
});

test("the binary-search board example is included in exports and survives reload", async ({
  page,
}) => {
  await openWorkspace(page);
  await navigate(page, "Whiteboard");
  await page
    .getByRole("button", { name: "Load binary search example", exact: true })
    .click();
  let saved: Workspace | undefined;
  await expect
    .poll(
      async () => {
        saved = await exportedWorkspace(page);
        return saved.board.elements.filter((element) => !element.isDeleted)
          .length;
      },
      {
        message: "The exported workspace contains the loaded board",
        timeout: 20_000,
      },
    )
    .toBeGreaterThan(8);
  const elements = saved!.board.elements;
  expect(elements.some((element) => element.type === "text")).toBe(true);
  await navigate(page, "Desk");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  const restored = await exportedWorkspace(page);
  expect(restored.board.elements).toEqual(elements);
  await navigate(page, "Whiteboard");
  await expect(
    page.getByRole("button", {
      name: "Load binary search example",
      exact: true,
    }),
  ).toBeVisible();
});
