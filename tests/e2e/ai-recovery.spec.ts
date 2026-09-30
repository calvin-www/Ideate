import { test, expect } from "@playwright/test";
import type { StudyEvent } from "../../src/features/ai/contracts";
import { fixtureCheckpoint, fulfillStudyStream } from "./ai-stream-fixture";

test("a capped response pauses and Continue completes the same chat message", async ({
  page,
}) => {
  let requests = 0;
  const checkpoint = fixtureCheckpoint("browser-fixture");
  await page.route("**/api/ai", async (route) => {
    const body = route.request().postDataJSON();
    requests++;
    if (requests === 2) expect(body).toMatchObject({ type: "continue", checkpoint });
    const events: StudyEvent[] =
      requests === 1
        ? [
            { type: "text", text: "The first half. " },
            { type: "status", message: "Continuing the response…" },
            {
              type: "paused",
              message:
                "Paused at this request's limit. Continue when you're ready.",
              checkpoint,
              append: true,
            },
          ]
        : [
            { type: "text", text: "The second half." },
            { type: "done" },
          ];
    await fulfillStudyStream(route, events);
  });
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page
    .getByRole("button", { name: "Toggle study partner", exact: true })
    .click();
  const panel = page.getByRole("complementary", { name: "AI study partner" });
  await panel
    .getByRole("textbox", { name: "Ask your study partner" })
    .fill("Explain the example");
  await panel
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Continue", exact: true }),
  ).toBeVisible();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  expect(requests).toBe(1);
  await panel.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    panel.getByText("The first half. The second half.", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Continue", exact: true }),
  ).toHaveCount(0);
  await expect(panel.locator("article.assistant")).toHaveCount(1);
  expect(requests).toBe(2);
});
