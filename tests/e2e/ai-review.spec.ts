import { readFile } from "node:fs/promises";
import { test as base, expect, type Page } from "@playwright/test";
import type {
  ArtifactRef,
  Workspace,
} from "../../src/features/workspace/model";

type RequestBody = {
  context: {
    notes: { text: string; length: number; revision: number };
    code: { text: string; length: number; revision: number };
    board: { revision: number };
    sources: ArtifactRef[];
  };
  continuation?: { contents: unknown[] };
  toolResults?: Array<{ id: string; name: string; result: { status: string } }>;
};
type ReviewPlan = (request: RequestBody) => {
  text: string;
  summary: string;
  target?: "notes" | "code" | "board";
  additions?: Record<string, unknown>[];
};

const test = base.extend<{ applicationErrors: string[] }>({
  applicationErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await use(errors);
      expect(errors, "No uncaught application errors").toEqual([]);
    },
    { auto: true },
  ],
});
test.use({ channel: "chrome", reducedMotion: "reduce" });

/** Only the HTTP boundary is replaced; the real review controller and store run. */
async function fixtureReviews(page: Page, plans: ReviewPlan[]) {
  const requests: RequestBody[] = [];
  const results: string[] = [];
  let nextPlan = 0;
  await page.route("**/api/ai", async (route) => {
    const body = route.request().postDataJSON() as RequestBody;
    requests.push(body);
    let events: unknown[];
    if (body.continuation) {
      const status = body.toolResults?.[0]?.result.status ?? "missing";
      results.push(status);
      events = [
        { type: "text", text: `Review recorded: ${status}.` },
        { type: "done", continuation: { contents: [] } },
      ];
    } else {
      const plan = plans[nextPlan++];
      expect(
        plan,
        "Every AI request has a deterministic fixture",
      ).toBeDefined();
      const review = plan(body);
      const target = review.target ?? "notes";
      const args =
        target === "board"
          ? {
              baseRevision: body.context.board.revision,
              additions: review.additions ?? [
                {
                  type: "rectangle",
                  x: 80,
                  y: 80,
                  width: 320,
                  height: 110,
                  text: review.text,
                },
              ],
              updates: [],
              deleteIds: [],
              summary: review.summary,
            }
          : {
              baseRevision: body.context[target].revision,
              replacements: [
                {
                  from: target === "code" ? 0 : body.context[target].length,
                  to: body.context[target].length,
                  text: review.text,
                },
              ],
              summary: review.summary,
            };
      const call = { id: `review-${nextPlan}`, name: `edit_${target}`, args };
      events = [
        { type: "text", text: "I prepared a journal update for your review." },
        { type: "call", ...call },
        {
          type: "done",
          continuation: {
            contents: [{ role: "model", parts: [{ functionCall: call }] }],
          },
        },
      ];
    }
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    });
  });
  return { requests, results };
}

function partner(page: Page) {
  return page.getByRole("complementary", { name: "AI study partner" });
}
function journal(page: Page) {
  return page.getByRole("region", { name: "Study journal", exact: true });
}

async function openJournal(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page
    .getByRole("navigation", { name: "Workspace tools" })
    .getByRole("button", { name: "Journal", exact: true })
    .click();
  await expect(journal(page).getByRole("textbox")).toBeVisible();
  await page
    .getByRole("button", { name: "Toggle study partner", exact: true })
    .click();
  await partner(page)
    .getByRole("switch", { name: "Auto-apply changes" })
    .uncheck();
}

async function askForReview(page: Page, prompt: string) {
  await partner(page)
    .getByRole("textbox", { name: "Ask your study partner" })
    .fill(prompt);
  await partner(page)
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await expect(
    partner(page).getByRole("button", { name: "Apply", exact: true }),
  ).toBeVisible();
}

async function finishReview(page: Page, decision: "Apply" | "Reject") {
  await partner(page)
    .getByRole("button", { name: decision, exact: true })
    .click();
  await expect(
    partner(page).getByRole("button", { name: "Stop AI request", exact: true }),
  ).toHaveCount(0);
}

async function editNotes(page: Page, text: string) {
  const editor = journal(page).getByRole("textbox");
  await editor.click();
  await editor.press("ControlOrMeta+A");
  await page.keyboard.insertText(text);
}

async function snapshot(page: Page): Promise<Workspace> {
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export workspace", exact: true })
    .click();
  const path = await (await downloading).path();
  expect(path).not.toBeNull();
  return JSON.parse(await readFile(path!, "utf8")) as Workspace;
}

test("Apply and Reject preserve review control, and an accepted source link opens its excerpt", async ({
  page,
}) => {
  let linkedSource: ArtifactRef | undefined;
  const fixture = await fixtureReviews(page, [
    () => ({
      text: "\nThis rejected sentence must never be saved.\n",
      summary: "An optional journal sentence",
    }),
    (request) => {
      linkedSource = request.context.sources.find(
        (source) => source.tool === "code",
      );
      expect(linkedSource).toBeDefined();
      return {
        text: `\n## A source worth keeping\n\n[Original Python source](#source:${linkedSource!.id})\n`,
        summary: "Keep a link to the original Python source",
      };
    },
  ]);
  await openJournal(page);
  const before = await snapshot(page);
  await askForReview(page, "Suggest one sentence for my journal.");
  expect((await snapshot(page)).notes.text).toBe(before.notes.text);
  await finishReview(page, "Reject");
  const rejected = await snapshot(page);
  expect(rejected.notes.text).toBe(before.notes.text);
  expect(rejected.changes).toHaveLength(0);

  await askForReview(page, "Propose a journal link to my Python source.");
  expect((await snapshot(page)).notes.text).toBe(before.notes.text);
  await finishReview(page, "Apply");
  const accepted = await snapshot(page);
  expect(accepted.notes.text).toContain("## A source worth keeping");
  expect(accepted.notes.text).not.toContain("This rejected sentence");
  expect(accepted.changes).toHaveLength(1);
  expect(accepted.references).toContainEqual(linkedSource);
  expect(fixture.results).toEqual(["rejected", "accepted"]);

  await journal(page)
    .getByRole("tab", { name: "Preview", exact: true })
    .click();
  const sourceLink = journal(page).getByRole("link", {
    name: "Original Python source",
    exact: true,
  });
  await sourceLink.click();
  const dialog = page.getByRole("dialog", { name: "Python", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("pre")).toHaveText(linkedSource!.excerpt);
  const close = dialog.getByRole("button", {
    name: "Close source",
    exact: true,
  });
  const open = dialog.getByRole("button", { name: "Open Python", exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(open).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(sourceLink).toBeFocused();
});

test("stale Apply and stopping a pending review leave manual notes intact", async ({
  page,
}) => {
  const fixture = await fixtureReviews(page, [
    () => ({
      text: "\nAn outdated proposal.\n",
      summary: "Capture an idea before the edit",
    }),
    () => ({
      text: "\nA cancelled proposal.\n",
      summary: "Capture an idea only if approved",
    }),
  ]);
  await openJournal(page);
  await askForReview(page, "Propose an addition to my notes.");
  const manual =
    "# My own explanation\n\nI changed my mind while the proposal was open.\n";
  await editNotes(page, manual);
  await finishReview(page, "Apply");
  await expect(partner(page).getByRole("alert")).toContainText(
    "Your manual edits were preserved",
  );
  const stale = await snapshot(page);
  expect(stale.notes.text).toBe(manual);
  expect(stale.changes).toHaveLength(0);
  expect(fixture.results).toEqual(["conflicted"]);

  await askForReview(page, "Prepare another addition, which I may stop.");
  await partner(page)
    .getByRole("button", { name: "Stop AI request", exact: true })
    .click();
  await expect(
    partner(page).getByRole("button", { name: "Apply", exact: true }),
  ).toHaveCount(0);
  await expect(
    partner(page).getByRole("button", { name: "Send message", exact: true }),
  ).toBeVisible();
  const cancelled = await snapshot(page);
  expect(cancelled.notes.text).toBe(manual);
  expect(cancelled.changes).toHaveLength(0);
  expect(cancelled.messages.at(-1)?.status).toBe("cancelled");
  expect(fixture.requests).toHaveLength(3);
});

test("undo conflicts show a review, preserve later edits, and restoration is itself undoable", async ({
  page,
}) => {
  await fixtureReviews(page, [
    () => ({
      text: "\nAn accepted AI observation.\n",
      summary: "Record one observation",
    }),
  ]);
  await openJournal(page);
  const original = (await snapshot(page)).notes.text;
  await askForReview(page, "Propose one observation for my journal.");
  await finishReview(page, "Apply");
  const accepted = (await snapshot(page)).notes.text;
  const manual = `${accepted}\nA manual correction after the AI edit.\n`;
  await editNotes(page, manual);
  const undo = partner(page).getByRole("button", {
    name: "Undo last AI change",
    exact: true,
  });
  await undo.click();
  await expect(
    partner(page).getByText("Review restoring an earlier version", {
      exact: true,
    }),
  ).toBeVisible();
  expect((await snapshot(page)).notes.text).toBe(manual);
  await partner(page)
    .getByRole("button", { name: "Keep current work", exact: true })
    .click();
  expect((await snapshot(page)).notes.text).toBe(manual);

  await undo.click();
  const latestManual = `${manual}One more correction while reviewing the restore.\n`;
  await editNotes(page, latestManual);
  await partner(page)
    .getByRole("button", { name: "Restore this version", exact: true })
    .click();
  await expect(partner(page).getByRole("alert")).toContainText(/changed/i);
  expect((await snapshot(page)).notes.text).toBe(latestManual);

  await undo.click();
  await partner(page)
    .getByRole("button", { name: "Restore this version", exact: true })
    .click();
  const restored = await snapshot(page);
  expect(restored.notes.text).toBe(original);
  expect(restored.changes).toHaveLength(2);
  expect(restored.changes.at(-1)?.before).toBe(latestManual);
  await undo.click();
  expect((await snapshot(page)).notes.text).toBe(latestManual);
});

test("Apply & run accepts a fixture code proposal and executes it with the real Python runner", async ({
  page,
}) => {
  const proposedCode = "print('approved execution', 42)\n";
  const fixture = await fixtureReviews(page, [
    () => ({
      target: "code",
      text: proposedCode,
      summary: "Print the approved execution result",
    }),
  ]);
  await openJournal(page);
  const originalCode = (await snapshot(page)).code.text;
  await askForReview(
    page,
    "Propose Python that prints the approved execution result.",
  );
  expect((await snapshot(page)).code.text).toBe(originalCode);
  await partner(page)
    .getByRole("button", { name: "Apply & run", exact: true })
    .click();
  const python = page.getByRole("region", {
    name: "Python workspace",
    exact: true,
  });
  await expect(python).toBeVisible();
  await expect(
    python.getByLabel("Python output", { exact: true }),
  ).toContainText("approved execution 42", { timeout: 60_000 });
  await expect(
    partner(page).getByRole("button", { name: "Stop AI request", exact: true }),
  ).toHaveCount(0);
  const executed = await snapshot(page);
  expect(executed.code.text).toBe(proposedCode);
  expect(executed.changes).toHaveLength(1);
  expect(executed.changes[0].target).toBe("code");
  expect(executed.runs.at(-1)).toMatchObject({
    code: proposedCode,
    revision: executed.code.revision,
    status: "success",
    output: "approved execution 42\n",
  });
  expect(fixture.results).toEqual(["accepted"]);
});

test("an AI board proposal renders a real preview, applies editable elements, and can be undone", async ({
  page,
}) => {
  const label = "Keep the sorted half";
  const fixture = await fixtureReviews(page, [
    () => ({
      target: "board",
      text: label,
      summary: "Add one diagram annotation",
    }),
  ]);
  await openJournal(page);
  await page
    .getByRole("navigation", { name: "Workspace tools" })
    .getByRole("button", { name: "Whiteboard", exact: true })
    .click();
  const board = page.getByRole("region", {
    name: "Whiteboard tool",
    exact: true,
  });
  await expect(board.locator("canvas").first()).toBeVisible();
  const before = (await snapshot(page)).board.elements;
  await askForReview(page, "Propose a labeled box on the whiteboard.");
  const preview = partner(page).getByRole("img", {
    name: "Preview of the proposed whiteboard changes",
    exact: true,
  });
  await expect(preview).toBeVisible();
  await expect
    .poll(() =>
      preview.evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  expect((await snapshot(page)).board.elements).toEqual(before);
  await finishReview(page, "Apply");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  const applied = await snapshot(page);
  const rectangle = applied.board.elements.find(
    (element) => element.type === "rectangle" && !element.isDeleted,
  );
  const text = applied.board.elements.find(
    (element) =>
      element.type === "text" && element.text === label && !element.isDeleted,
  );
  expect(rectangle).toBeDefined();
  expect(text).toMatchObject({ containerId: rectangle!.id });
  expect(applied.changes).toHaveLength(1);
  expect(applied.changes[0].target).toBe("board");
  expect(fixture.results).toEqual(["accepted"]);
  await partner(page)
    .getByRole("button", { name: "Undo last AI change", exact: true })
    .click();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  const undone = await snapshot(page);
  expect(
    undone.board.elements.some(
      (element) => element.text === label && !element.isDeleted,
    ),
  ).toBe(false);
  expect(undone.changes[0].undone).toBe(true);
});

for (const autoApply of [false, true]) {
  test(`study partner pen strokes ${autoApply ? "auto-apply" : "respect review"}, survive reload, and undo`, async ({
    page,
  }, testInfo) => {
    const drawing = () => ({
      target: "board" as const,
      text: "",
      summary: "Draw a curve with the pen",
      additions: [
        {
          type: "freedraw",
          points: [
            { x: 160, y: 220 },
            { x: 180, y: 185 },
            { x: 210, y: 160 },
            { x: 250, y: 150 },
            { x: 290, y: 160 },
            { x: 320, y: 185 },
            { x: 340, y: 220 },
          ],
          strokeColor: "#c92a2a",
          strokeWidth: 3,
        },
      ],
    });
    const fixture = await fixtureReviews(
      page,
      autoApply ? [drawing] : [drawing, drawing],
    );
    await openJournal(page);
    await page
      .getByRole("navigation", { name: "Workspace tools" })
      .getByRole("button", { name: "Whiteboard", exact: true })
      .click();
    const before = (await snapshot(page)).board.elements;
    if (autoApply) {
      await partner(page)
        .getByRole("switch", { name: "Auto-apply changes" })
        .check();
      await partner(page)
        .getByRole("textbox", { name: "Ask your study partner" })
        .fill("Draw a curve using the pen.");
      await partner(page)
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        partner(page).getByText("Review recorded: accepted.", { exact: true }),
      ).toBeVisible();
      await expect(
        partner(page).getByRole("button", { name: "Apply", exact: true }),
      ).toHaveCount(0);
    } else {
      await askForReview(page, "Draw a curve using the pen.");
      const preview = partner(page).getByRole("img", {
        name: "Preview of the proposed whiteboard changes",
      });
      await expect(preview).toBeVisible();
      await expect
        .poll(() =>
          preview.evaluate((image) => (image as HTMLImageElement).naturalWidth),
        )
        .toBeGreaterThan(0);
      expect((await snapshot(page)).board.elements).toEqual(before);
      await finishReview(page, "Reject");
      expect((await snapshot(page)).board.elements).toEqual(before);
      await askForReview(page, "Draw the pen curve again.");
      await finishReview(page, "Apply");
    }
    await expect(
      page.getByText("Saved locally", { exact: true }),
    ).toBeVisible();
    const applied = await snapshot(page);
    expect(applied.changes).toHaveLength(1);
    const stroke = applied.board.elements.find(
      (element) => element.type === "freedraw" && !element.isDeleted,
    );
    expect(stroke).toMatchObject({
      x: 160,
      y: 220,
      width: 180,
      height: 70,
      strokeColor: "#c92a2a",
      strokeWidth: 3,
      points: [
        [0, 0],
        [20, -35],
        [50, -60],
        [90, -70],
        [130, -60],
        [160, -35],
        [180, 0],
      ],
    });
    await page
      .getByRole("button", { name: "Fit drawing", exact: true })
      .click();
    await page.screenshot({ path: testInfo.outputPath("pen-stroke.png") });
    await expect(
      page.getByText("Saved locally", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText("Saved locally", { exact: true }),
    ).toBeVisible();
    expect((await snapshot(page)).board.elements).toEqual(
      applied.board.elements,
    );
    await page
      .getByRole("button", { name: "Toggle study partner", exact: true })
      .click();
    await partner(page)
      .getByRole("button", { name: "Undo last AI change", exact: true })
      .click();
    const undone = await snapshot(page);
    expect(
      undone.board.elements.filter((element) => !element.isDeleted),
    ).toEqual(before.filter((element) => !element.isDeleted));
    expect(undone.changes[0].undone).toBe(true);
    expect(fixture.results).toEqual(
      autoApply ? ["accepted"] : ["rejected", "accepted"],
    );
  });
}
