import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

// Start with no stored keys so the degraded states render; the project-wide
// storageState seeds keys for every other spec.
test.use({ reducedMotion: "reduce", storageState: { cookies: [], origins: [] } });

test("chat asks for a key, settings enable chat, and voice appears only with ElevenLabs settings", async ({ page }) => {
  await page.route("**/api/ai", async (route) => {
    const key = route.request().headers()["x-gemini-key"];
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body:
        JSON.stringify({ type: "text", text: `key=${key}` }) +
        "\n" +
        JSON.stringify({ type: "done", continuation: { contents: [] } }) +
        "\n",
    });
  });
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Toggle study partner" }).click();
  await expect(page.getByTestId("chat-setup")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Ask your study partner" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Turn on microphone", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Open settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByLabel("Gemini API key").fill("visitor-gemini");
  await dialog.getByRole("button", { name: "Save keys" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("chat-setup")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Ask your study partner" }).fill("hello");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByLabel("AI study partner")).toContainText("key=visitor-gemini");
  await expect(page.getByRole("button", { name: "Turn on microphone", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await dialog.getByLabel("ElevenLabs API key").fill("visitor-eleven");
  await dialog.getByLabel("ElevenLabs voice ID").fill("voice-1");
  await dialog.getByRole("button", { name: "Save keys" }).click();
  await expect(page.getByRole("button", { name: "Turn on microphone", exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn on microphone", exact: true })).toBeVisible();

  // Keys never reach the workspace the visitor can export.
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export workspace", exact: true }).click();
  const exported = await readFile((await (await downloading).path())!, "utf8");
  expect(exported).toContain("\"messages\"");
  expect(exported).not.toContain("visitor-gemini");
  expect(exported).not.toContain("visitor-eleven");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await dialog.getByRole("button", { name: "Clear keys" }).click();
  await dialog.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("button", { name: "Toggle study partner" }).click();
  await expect(page.getByTestId("chat-setup")).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn on microphone", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("ideate:provider-keys:v1"))).toBeNull();
});
