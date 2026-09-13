import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "../../src/features/workspace/model";

const silencePath = join(tmpdir(), "ideate-board-navigation-silence.wav");
const silence = Buffer.alloc(44 + 16000 * 2 * 30);
silence.write("RIFF", 0); silence.writeUInt32LE(silence.length - 8, 4); silence.write("WAVEfmt ", 8);
silence.writeUInt32LE(16, 16); silence.writeUInt16LE(1, 20); silence.writeUInt16LE(1, 22);
silence.writeUInt32LE(16000, 24); silence.writeUInt32LE(32000, 28); silence.writeUInt16LE(2, 32); silence.writeUInt16LE(16, 34);
silence.write("data", 36); silence.writeUInt32LE(silence.length - 44, 40); writeFileSync(silencePath, silence);
test.use({ permissions: ["microphone"], launchOptions: { args: ["--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${silencePath}`] } });

async function snapshot(page: Page): Promise<Workspace> {
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export workspace", exact: true }).click();
  return JSON.parse(await readFile((await (await downloading).path())!, "utf8"));
}

async function startDrawing(page: Page, followup = false, beforeDrawing?: () => Promise<void>) {
  await page.addInitScript(() => localStorage.setItem("ideate:auto-apply-changes", "true"));
  let socket!: WebSocketRoute;
  let request = 0, step = 0;
  await page.route("**/api/voice/session", (route) => route.fulfill({ json: { token: "fixture-token" } }));
  await page.routeWebSocket("wss://api.elevenlabs.io/**", (ws) => { socket = ws; });
  await page.route("**/api/voice/speech", (route) => route.fulfill({
    contentType: "audio/pcm", headers: { "x-audio-sample-rate": "24000" }, body: Buffer.alloc(24000 * 2 * 8),
  }));
  await page.route("**/api/ai", (route) => {
    const body = route.request().postDataJSON();
    if (!body.continuation) { request++; step = 0; }
    const laterDrawing = followup && request === 1 && step === 2;
    const drawing = step === 0 || laterDrawing;
    const events: unknown[] = drawing ? [{ type: "call", id: `board-${request}-${step}`, name: "teach_step", args: {
      speech: "Watch the outline grow while I explain each side of this small diagram.",
      operation: { name: "edit_board", args: {
        baseRevision: body.context.board.revision + (laterDrawing ? 1 : 0),
        additions: [{ type: "rectangle", x: request === 1 ? 100 + (laterDrawing ? 2200 : 0) : -2000, y: 100, width: 160, height: 100 }],
        updates: [], deleteIds: [], summary: `Draw shape ${request}-${step}`,
      } },
    } }] : [];
    if (followup && request === 1 && step === 1)
      events.push({ type: "call", id: "read-first-shape", name: "read_board", args: {} });
    if (laterDrawing) {
      const board = body.toolResults.find((result: { name: string }) => result.name === "read_board").result;
      events.unshift({ type: "call", id: "point-to-first-shape", name: "show_attention", args: {
        target: "board", revision: board.revision, ids: [board.elements[0].id], mode: "highlight", label: "The first outline",
      } });
    }
    step++;
    return route.fulfill({ contentType: "application/x-ndjson", body: [...events, { type: "done", continuation: { contents: [] } }].map((event) => JSON.stringify(event)).join("\n") + "\n" });
  });
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Workspace tools" }).getByRole("button", { name: "Whiteboard", exact: true }).click();
  await page.locator(".excalidraw__canvas.interactive").waitFor();
  await page.getByRole("button", { name: "Turn on microphone", exact: true }).click();
  await expect(page.getByRole("region", { name: "Voice controls" })).toContainText("Listening");
  await beforeDrawing?.();
  const say = () => socket.send(JSON.stringify({ message_type: "committed_transcript", text: `Draw diagram ${request + 1}.` }));
  say();
  const preview = page.getByLabel("Study partner drawing preview", { exact: true });
  await expect(preview.locator("svg [data-id]").first()).toBeVisible();
  return { preview, say };
}

test("small AI drawings use readable wide framing instead of magnifying them", async ({ page }, testInfo) => {
  const { preview } = await startDrawing(page);
  const viewport = (await snapshot(page)).board.viewport!;
  expect(viewport.zoom).toBeLessThanOrEqual(1);
  await expect(preview.locator("svg [data-id]").first()).toBeInViewport();
  await expect(page.getByRole("button", { name: "Zoom out", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("board-wide-framing.png") });
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});

test("holding Space before a drawing preview starts still pans without taking over", async ({ page }) => {
  const { preview } = await startDrawing(page, false, async () => {
    await page.locator(".excalidraw").focus();
    await page.keyboard.down("Space");
  });
  const canvas = page.locator(".excalidraw__canvas.interactive");
  const box = (await canvas.boundingBox())!;
  const left = await preview.locator("svg").evaluate((svg) => svg.getBoundingClientRect().left);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 50, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect(preview).toBeVisible({ timeout: 1000 });
  await expect(page.getByRole("region", { name: "Voice controls" })).toContainText("Speaking");
  await expect.poll(() => preview.locator("svg").evaluate((svg) => svg.getBoundingClientRect().left)).toBeCloseTo(left + 90, 0);
  await page.getByRole("button", { name: "Fit drawing", exact: true }).click();
  await expect.poll(() => preview.locator("svg").evaluate((svg) => svg.getBoundingClientRect().left), { timeout: 1000 }).toBeCloseTo(left, 0);
  await expect(page.getByRole("region", { name: "Voice controls" })).toContainText("Speaking");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});

test.describe("touch navigation", () => {
  test.use({ hasTouch: true });
  test("touch pan and pinch protect the AI checkpoint until explicit editing takeover", async ({ page }) => {
    const { preview } = await startDrawing(page, false, async () => {
      await page.locator(".excalidraw").focus();
      await page.keyboard.press("r");
    });
    const before = (await snapshot(page)).board.viewport!;
    const box = (await page.locator(".excalidraw__canvas.interactive").boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, x, y }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 1, x: x + 80, y: y + 40 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(preview).toBeVisible({ timeout: 1000 });
    const panned = await snapshot(page);
    expect(panned.board.elements).toEqual([]);
    expect(panned.board.viewport).not.toEqual(before);
    await expect(page.getByRole("radio", { name: "Rectangle", exact: true })).toBeChecked();
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, x: x - 40, y }, { id: 2, x: x + 40, y }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 1, x: x - 80, y }, { id: 2, x: x + 80, y }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(preview).toBeVisible();
    await expect.poll(async () => (await snapshot(page)).board.viewport!.zoom).not.toBe(panned.board.viewport!.zoom);
    await expect(page.getByRole("region", { name: "Voice controls" })).toContainText("Speaking");
    await page.getByRole("button", { name: "Take over drawing", exact: true }).click();
    await expect(preview).toBeHidden();
    const checkpoint = await snapshot(page);
    expect(checkpoint.board.elements).toHaveLength(1);
    expect(checkpoint.changes).toHaveLength(1);
    await expect(page.getByRole("radio", { name: "Rectangle", exact: true })).toBeChecked();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
  });
});

test("panning and zooming keep drawing and speech active and own the camera for later steps", async ({ page }) => {
  const { preview, say } = await startDrawing(page, true);
  const controls = page.getByRole("region", { name: "Voice controls" });
  const before = (await snapshot(page)).board.viewport!;
  const canvas = page.locator(".excalidraw__canvas.interactive");
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.locator(".excalidraw").focus();
  await page.mouse.move(x, y);
  await page.keyboard.down("Space");
  await page.mouse.down();
  await page.mouse.move(x + 90, y + 50, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect(preview).toBeVisible();
  await expect(controls).toContainText("Speaking");
  const panned = (await snapshot(page)).board.viewport!;
  expect(panned.scrollX).not.toBe(before.scrollX);
  expect(panned.scrollY).not.toBe(before.scrollY);
  await expect.poll(async () => await preview.locator("svg").evaluate((svg) => svg.getBoundingClientRect().x) - box.x).toBeCloseTo((100 + panned.scrollX) * panned.zoom, 0);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const manual = (await snapshot(page)).board.viewport!;
  expect(manual.zoom).toBeGreaterThan(panned.zoom);
  await expect(controls).toContainText("Speaking");
  await expect.poll(async () => (await snapshot(page)).changes.length).toBe(1);
  await expect(preview.locator("svg [data-id]")).toHaveCount(2);
  expect((await snapshot(page)).board.viewport).toEqual(manual);
  await expect(controls).toContainText("Listening");
  const finished = await snapshot(page);
  expect(finished.board.elements.filter((element) => !element.isDeleted)).toHaveLength(2);
  expect(finished.board.revision).toBe(2);
  expect(finished.changes).toHaveLength(2);
  if (!await page.getByRole("button", { name: "Undo last AI change", exact: true }).isVisible())
    await page.getByRole("button", { name: "Toggle study partner", exact: true }).click();
  await page.getByRole("button", { name: "Undo last AI change", exact: true }).click();
  expect((await snapshot(page)).board.elements.filter((element) => !element.isDeleted).map((element) => element.id)).toEqual([finished.board.elements[0].id]);
  await page.getByRole("button", { name: "Toggle study partner", exact: true }).click();
  say();
  await expect(preview).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).board.viewport).not.toEqual(manual);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});

test("wheel, middle-button and hand navigation preserve the preview before editing takes over", async ({ page }) => {
  const { preview } = await startDrawing(page);
  const controls = page.getByRole("region", { name: "Voice controls" });
  const before = (await snapshot(page)).board.viewport!;
  const canvas = page.locator(".excalidraw__canvas.interactive");
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.locator(".excalidraw").focus();
  await page.mouse.move(x, y);
  await page.mouse.wheel(80, 40);
  await expect.poll(async () => (await snapshot(page)).board.viewport).not.toEqual(before);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(x + 40, y + 30, { steps: 4 });
  await page.mouse.up({ button: "middle" });
  await expect(preview).toBeVisible();
  await expect(controls).toContainText("Speaking");
  await page.locator(".excalidraw").focus();
  await page.keyboard.press("h");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 40, y - 30, { steps: 4 });
  await page.mouse.up();
  await expect(preview).toBeVisible();
  await expect(controls).toContainText("Speaking");
  await page.keyboard.press("v");
  await canvas.click({ position: { x: 150, y: 180 } });
  await expect(preview).toBeHidden();
  const checkpoint = await snapshot(page);
  expect(checkpoint.board.elements).toHaveLength(1);
  expect(checkpoint.board.elements[0]).not.toHaveProperty("voiceProgress");
  expect(checkpoint.board.revision).toBe(1);
  expect(checkpoint.changes).toHaveLength(1);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});

test("a stylus eraser respects native hand navigation and checkpoints editing", async ({ page }) => {
  const { preview } = await startDrawing(page);
  const canvas = page.locator(".excalidraw__canvas.interactive");
  const box = (await canvas.boundingBox())!;
  const point = { clientX: box.x + 150, clientY: box.y + 180 };
  for (const tool of ["hand", "selection"]) {
    const before = (await snapshot(page)).board.viewport!;
    await page.locator(".excalidraw").focus();
    await page.keyboard.press(tool === "hand" ? "h" : "v");
    if (tool === "selection") await page.keyboard.down("Space");
    await page.mouse.move(point.clientX, point.clientY);
    // Pointer Events assigns the eraser tip button 5. Dispatch that hardware
    // input because Playwright's mouse API only exposes left/middle/right.
    await canvas.dispatchEvent("pointerdown", {
      ...point, pointerId: 1, pointerType: "pen", isPrimary: true,
      button: 5, buttons: 32, bubbles: true, cancelable: true,
    });
    await page.mouse.move(point.clientX + 40, point.clientY + 20, { steps: 3 });
    await canvas.dispatchEvent("pointerup", {
      ...point, pointerId: 1, pointerType: "pen", isPrimary: true,
      button: 5, buttons: 0, bubbles: true, cancelable: true,
    });
    if (tool === "selection") await page.keyboard.up("Space");
    if (tool === "hand") {
      await expect(preview).toBeVisible();
      const navigated = await snapshot(page);
      expect(navigated.board.viewport).not.toEqual(before);
      expect(navigated.board.elements).toEqual([]);
    }
  }
  await expect(preview).toBeHidden({ timeout: 1000 });
  const checkpoint = await snapshot(page);
  expect(checkpoint.board.elements).toHaveLength(1);
  expect(checkpoint.board.elements[0]).not.toHaveProperty("voiceProgress");
  expect(checkpoint.changes).toHaveLength(1);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});
