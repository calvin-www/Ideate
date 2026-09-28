import { expect, test } from "@playwright/test";
import { goToTool } from "./desk-navigation";
import { parseOperation, type StudyEvent } from "../../src/features/ai/contracts";
import { fixtureCheckpoint, fulfillStudyStream } from "./ai-stream-fixture";

test.use({ channel: "chrome", reducedMotion: "reduce" });
test("journal expenses become reviewed spreadsheet formulas with grounded sources and reversible restoration", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const journalText = "September expenses in USD: rent 1200; groceries 240. These are recorded expenses, not a forecast.";
  let readSource = "", spreadsheetRevision = 0, round = 0, accepted = false;
  await page.route("**/api/ai", async route => {
    const body = route.request().postDataJSON();
    let events: StudyEvent[];
    if (++round === 1) {
      expect(body.type).toBe("start");
      expect(body.context.notes.text).toBe(journalText);
      spreadsheetRevision = body.context.spreadsheet.revision;
      events = [{ type: "operationBatch", operations: [{ id: "read-journal", operation: parseOperation("read_notes", {})! }], checkpoint: fixtureCheckpoint("read-journal") }];
    } else if (round === 2) {
      expect(body.type).toBe("results");
      const read = body.results[0].result;
      expect(read.text).toBe(journalText);
      expect(read.source.tool).toBe("notes");
      expect(read.source.excerpt).toBe(journalText);
      readSource = read.source.id;
      events = [{ type: "operationBatch", operations: [{ id: "record-expenses", operation: parseOperation("edit_spreadsheet", {
        baseRevision: spreadsheetRevision,
        updates: [
          { address: "A1", raw: "September expenses (USD)" },
          { address: "A2", raw: "Rent" }, { address: "B2", raw: "1200", format: "currency" },
          { address: "A3", raw: "Groceries" }, { address: "B3", raw: "240", format: "currency" },
          { address: "A4", raw: "Total" }, { address: "B4", raw: "=SUM(B2:B3)", format: "currency" },
        ], summary: "Record the journal's September expenses and calculate their total",
      })! }], checkpoint: fixtureCheckpoint("record-expenses") }];
    } else {
      expect(body.type).toBe("results");
      expect(body.results[0].result.status).toBe("accepted");
      accepted = true;
      events = [{ type: "text", text: `Recorded the two expenses and their formula total. [Journal amounts](#source:${readSource})` }];
    }
    if (round > 2) events.push({ type: "done" });
    await fulfillStudyStream(route, events);
  });
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible({ timeout: 30_000 });
  await goToTool(page, "Journal");
  const journal = page.getByRole("region", { name: "Study journal", exact: true }).getByRole("textbox");
  await journal.click();
  await journal.press("ControlOrMeta+A");
  await page.keyboard.insertText(journalText);
  await goToTool(page, "Spreadsheet");
  const sheet = page.getByRole("region", { name: "Spreadsheet workspace" });
  await sheet.getByRole("textbox", { name: "Cell A8", exact: true }).fill("Keep this unrelated note");
  await goToTool(page, "Journal");
  await page.getByRole("button", { name: "Toggle study partner", exact: true }).click();
  const partner = page.getByRole("complementary", { name: "AI study partner" });
  await partner.getByRole("switch", { name: "Auto-apply changes" }).uncheck();
  await partner.getByRole("textbox", { name: "Ask your study partner" }).fill("Put my journal expenses into the spreadsheet and total them.");
  await partner.getByRole("button", { name: "Send message", exact: true }).click();
  const diff = partner.getByRole("region", { name: "Spreadsheet cell changes" });
  await expect(diff).toBeVisible();
  await expect(diff).toContainText("B4");
  await expect(diff).toContainText("=SUM(B2:B3)");
  await expect(diff).toContainText("$1,440.00");
  await expect(diff).not.toContainText('"cells"');
  await partner.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(partner.getByRole("button", { name: "Stop AI request", exact: true })).toHaveCount(0);
  expect(accepted).toBe(true);
  await partner.getByRole("button", { name: "Open spreadsheet", exact: true }).click();
  await expect(sheet.getByRole("textbox", { name: "Cell B4", exact: true })).toHaveValue("$1,440.00");
  await expect(sheet.getByRole("textbox", { name: "Cell A8", exact: true })).toHaveValue("Keep this unrelated note");
  await partner.getByRole("button", { name: "Journal amounts", exact: true }).click();
  const source = page.getByRole("dialog", { name: "Notes", exact: true });
  await expect(source.locator("pre")).toHaveText(journalText);
  await source.getByRole("button", { name: "Close source", exact: true }).click();
  await sheet.getByRole("textbox", { name: "Cell B3", exact: true }).click();
  await sheet.getByRole("textbox", { name: "Cell B3", exact: true }).fill("300");
  await sheet.getByRole("textbox", { name: "Cell A3", exact: true }).click();
  await expect(sheet.getByRole("textbox", { name: "Cell B4", exact: true })).toHaveValue("$1,500.00");
  await partner.getByRole("button", { name: "Undo last AI change" }).click();
  await expect(partner.getByText("Review restoring an earlier version", { exact: true })).toBeVisible();
  await expect(diff).toContainText("$1,500.00");
  await expect(diff).not.toContainText('"cells"');
  await partner.getByRole("button", { name: "Restore this version", exact: true }).click();
  await expect(sheet.getByRole("textbox", { name: "Cell B4", exact: true })).toHaveValue("");
  await expect(sheet.getByRole("textbox", { name: "Cell A8", exact: true })).toHaveValue("Keep this unrelated note");
  expect(errors).toEqual([]);
});
