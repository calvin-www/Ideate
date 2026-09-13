import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "../../src/features/workspace/model";

const silencePath = join(tmpdir(), "ideate-voice-test-silence.wav");
const silence = Buffer.alloc(44 + 16000 * 2 * 30);
silence.write("RIFF", 0); silence.writeUInt32LE(silence.length - 8, 4); silence.write("WAVEfmt ", 8);
silence.writeUInt32LE(16, 16); silence.writeUInt16LE(1, 20); silence.writeUInt16LE(1, 22);
silence.writeUInt32LE(16000, 24); silence.writeUInt32LE(32000, 28); silence.writeUInt16LE(2, 32); silence.writeUInt16LE(16, 34);
silence.write("data", 36); silence.writeUInt32LE(silence.length - 44, 40); writeFileSync(silencePath, silence);
test.use({ permissions: ["microphone"], launchOptions: { args: ["--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${silencePath}`] } });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ideate:auto-apply-changes", "true"));
});

async function voiceFixture(page: Page, step: (context: Workspace) => unknown, onPrompt?: (text: string) => void) {
  let socket!: WebSocketRoute;
  await page.route("**/api/voice/session", (route) => route.fulfill({ json: { token: "fixture-token" } }));
  await page.routeWebSocket("wss://api.elevenlabs.io/**", (ws) => { socket = ws; });
  await page.route("**/api/voice/speech", (route) => route.fulfill({ status: 200, contentType: "audio/pcm", headers: { "x-audio-sample-rate": "24000" }, body: Buffer.alloc(24000 * 2 * 5) }));
  await page.route("**/api/ai", (route) => {
    const body = route.request().postDataJSON();
    if (!body.continuation) onPrompt?.(body.messages.at(-1).text);
    const events = [
      ...(!body.continuation ? [{ type: "call", id: "fixture-step", name: "teach_step", args: step(body.context) }] : []),
      { type: "done", continuation: { contents: [] } },
    ];
    return route.fulfill({ contentType: "application/x-ndjson", body: events.map((event) => JSON.stringify(event)).join("\n") + "\n" });
  });
  return (text: string) => socket.send(JSON.stringify({ message_type: "committed_transcript", text }));
}

async function exportedWorkspace(page: Page): Promise<Workspace> {
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export workspace", exact: true }).click();
  return JSON.parse(await readFile((await (await downloading).path())!, "utf8"));
}

async function openChat(page: Page) {
  const toggle = page.getByRole("button", { name: "Toggle study partner", exact: true });
  if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
}

async function undoLastChange(page: Page) {
  await openChat(page);
  await page.getByRole("button", { name: "Undo last AI change", exact: true }).click();
}

async function observeAudio(page: Page) {
  await page.addInitScript(() => {
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    (window as unknown as { capturedTracks: MediaStreamTrack[] }).capturedTracks = [];
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await capture(constraints);
      (window as unknown as { capturedTracks: MediaStreamTrack[] }).capturedTracks.push(...stream.getTracks());
      return stream;
    };
    const resumeAudio = AudioContext.prototype.resume;
    (window as unknown as { audioContexts: AudioContext[] }).audioContexts = [];
    AudioContext.prototype.resume = function () {
      const contexts = (window as unknown as { audioContexts: AudioContext[] }).audioContexts;
      if (!contexts.includes(this)) contexts.push(this);
      return resumeAudio.call(this);
    };
  });
}

test("Stop checkpoints writing, stops speech, and turns off microphone capture", async ({ page }) => {
  await observeAudio(page);
  const say = await voiceFixture(page, ({ code }) => ({
    speech: "Let's write the lower and upper bounds, then calculate the midpoint between them.",
    operation: { name: "edit_code", args: {
      baseRevision: code.revision,
      replacements: [{ from: 0, to: 0, text: "def stopped_search(values):\n    low = 0\n    high = len(values) - 1\n    return low\n" }],
      summary: "Write the bounds",
    } },
  }));
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Workspace tools" }).getByRole("button", { name: "Computer", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { capturedTracks: MediaStreamTrack[] }).capturedTracks.length)).toBe(0);
  await page.getByRole("button", { name: "Turn on microphone", exact: true }).click();
  await expect(page.getByRole("region", { name: "Voice controls", exact: true })).toContainText("Listening");
  await expect(page.getByRole("textbox", { name: "Ask your study partner", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Mute microphone", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { capturedTracks: MediaStreamTrack[] }).capturedTracks.map((track) => track.enabled))).toEqual([false]);
  await page.getByRole("button", { name: "Unmute microphone", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { capturedTracks: MediaStreamTrack[] }).capturedTracks.map((track) => track.enabled))).toEqual([true]);
  say("Show me binary search.");
  const preview = page.getByLabel("Study partner writing preview", { exact: true });
  await expect(preview).toContainText("def stopped_search(values):");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(preview).toBeHidden();
  await expect(page.getByRole("button", { name: "Turn on microphone", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { capturedTracks: MediaStreamTrack[] }).capturedTracks.map((track) => track.readyState))).toEqual(["ended"]);
  await expect.poll(() => page.evaluate(() => (window as unknown as { audioContexts: AudioContext[] }).audioContexts.map((context) => context.state))).toEqual(["closed", "closed"]);
  const stopped = await exportedWorkspace(page);
  expect(stopped.code.text).toContain("def stopped_search(values):");
  expect(stopped.code.text).not.toContain("    return low");
  expect(stopped.changes).toHaveLength(1);
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeDisabled();
});

test("typed follow-ups with the microphone on update the task used by continue", async ({ page }) => {
  const prompts: string[] = [];
  const say = await voiceFixture(page, () => ({ speech: "Here is the next explanation." }), (text) => prompts.push(text));
  await page.goto("/");
  await page.getByRole("button", { name: "Turn on microphone", exact: true }).click();
  const controls = page.getByRole("region", { name: "Voice controls" });
  await expect(controls).toContainText("Listening");
  say("Explain the lower bound.");
  await expect(controls).toContainText("Speaking");
  await expect(controls).toContainText("Listening");
  await page.getByRole("button", { name: "Toggle study partner", exact: true }).click();
  const composer = page.getByRole("textbox", { name: "Ask your study partner", exact: true });
  await composer.fill("Explain the upper bound instead.");
  await composer.press("Enter");
  await expect.poll(() => prompts.length).toBe(2);
  await expect(controls).toContainText("Listening");
  say("continue");
  await expect.poll(() => prompts.length).toBe(3);
  expect(prompts[2]).toContain("Previous request: Explain the upper bound instead.");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});

test("a hidden notes destination can be shown in Preview mode and committed once", async ({ page }, testInfo) => {
  const say = await voiceFixture(page, ({ notes }) => ({
    speech: "Save this observation.",
    operation: { name: "edit_notes", args: { baseRevision: notes.revision, replacements: [{ from: notes.text.length, to: notes.text.length, text: "# Voice observation\n\nEach comparison removes half the candidates.\n" }], summary: "Record the comparison" } },
  }));
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Workspace tools" });
  await navigation.getByRole("button", { name: "Journal", exact: true }).click();
  await page.getByRole("region", { name: "Study journal", exact: true }).getByRole("textbox").fill("# Existing notes\n" + Array.from({ length: 60 }, (_, i) => `Observation ${i + 1}\n`).join(""));
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await navigation.getByRole("button", { name: "Computer", exact: true }).click();
  const before = await exportedWorkspace(page);
  await page.getByRole("button", { name: "Turn on microphone", exact: true }).click();
  await expect(page.getByRole("region", { name: "Voice controls" })).toContainText("Listening");
  say("Record the observation in my notes.");
  await navigation.getByRole("button", { name: "Journal", exact: true }).click();
  const preview = page.getByLabel("Study partner writing preview", { exact: true });
  await expect(preview).toContainText("# Voice observation");
  await expect(preview.locator(".cm-line").filter({ hasText: "# Voice observation" })).toBeInViewport();
  await expect(page.getByRole("region", { name: "Voice controls" })).toContainText("Speaking");
  expect((await exportedWorkspace(page)).notes).toEqual(before.notes);
  await page.screenshot({ path: testInfo.outputPath("voice-notes-writing.png") });
  await expect(preview).toBeHidden();
  await openChat(page);
  await expect(page.getByRole("button", { name: "Undo last AI change", exact: true })).toBeEnabled();
  const after = await exportedWorkspace(page);
  expect(after.notes.text).toBe(before.notes.text + "# Voice observation\n\nEach comparison removes half the candidates.\n");
  expect(after.changes).toHaveLength(before.changes.length + 1);
  await undoLastChange(page);
  expect((await exportedWorkspace(page)).notes.text).toBe(before.notes.text);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});

test("board updates and deletions replace the provisional scene and preserve canonical content until done", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let updatedId = "", deletedId = "";
  const say = await voiceFixture(page, ({ board }) => {
    const labels = board.elements.filter((element) => element.type === "text" && !element.isDeleted);
    updatedId = labels[0].id; deletedId = labels[1].id;
    return { speech: "Update these labels.", operation: { name: "edit_board", args: {
      baseRevision: board.revision, additions: [], updates: [{ id: updatedId, text: "Voice midpoint" }], deleteIds: [deletedId], summary: "Clarify the labels",
    } } };
  });
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Workspace tools" }).getByRole("button", { name: "Whiteboard", exact: true }).click();
  await page.getByRole("button", { name: "Load binary search example", exact: true }).click();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  const before = await exportedWorkspace(page);
  await page.getByRole("button", { name: "Turn on microphone", exact: true }).click();
  await expect(page.getByRole("region", { name: "Voice controls" })).toContainText("Listening");
  say("Update the labels.");
  const preview = page.getByLabel("Study partner drawing preview", { exact: true });
  await expect(preview).toBeVisible();
  await expect(preview.locator(`svg [data-id="${updatedId}"]`)).toBeVisible();
  await expect(preview.locator(`svg [data-id="${updatedId}"]`)).toContainText("Voice midpoint");
  await expect(preview.locator(`[data-id="${deletedId}"]`)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Voice controls" })).toContainText("Speaking");
  expect((await exportedWorkspace(page)).board.elements).toEqual(before.board.elements);
  await page.screenshot({ path: testInfo.outputPath("voice-board-update.png") });
  await expect(preview).toBeHidden();
  const after = await exportedWorkspace(page);
  expect(after.board.elements.find((element) => element.id === updatedId)?.text).toBe("Voice midpoint");
  expect(after.board.elements.find((element) => element.id === deletedId)?.isDeleted).toBe(true);
  expect(after.changes).toHaveLength(before.changes.length + 1);
  await undoLastChange(page);
  expect((await exportedWorkspace(page)).board.elements.filter((element) => !element.isDeleted).map((element) => element.text)).toEqual(before.board.elements.filter((element) => !element.isDeleted).map((element) => element.text));
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  expect(errors).toEqual([]);
});

test("a board pen stroke grows during speech and taking over interrupts it", async ({ page }, testInfo) => {
  const say = await voiceFixture(page, ({ board }) => ({
    speech: "Let's draw the lower boundary from left to right, then turn upward to show where the next comparison begins.",
    operation: { name: "edit_board", args: { baseRevision: board.revision, updates: [], deleteIds: [], summary: "Draw the boundary", additions: [{ type: "freedraw", points: [{ x: 100, y: 100 }, { x: 180, y: 100 }, { x: 260, y: 100 }, { x: 340, y: 160 }, { x: 340, y: 240 }] }] } },
  }));
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Workspace tools" }).getByRole("button", { name: "Whiteboard", exact: true }).click();
  await expect(page.getByRole("button", { name: "Load binary search example", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Turn on microphone", exact: true }).click();
  const controls = page.getByRole("region", { name: "Voice controls" });
  await expect(controls).toContainText("Listening");
  say("Draw the lower boundary.");
  const preview = page.getByLabel("Study partner drawing preview", { exact: true });
  const stroke = preview.locator("svg [data-id] path").first();
  await expect(stroke).toBeVisible();
  await expect(stroke).toBeInViewport();
  const initialPath = await stroke.getAttribute("d");
  await expect.poll(() => stroke.getAttribute("d")).not.toBe(initialPath);
  await expect(controls).toContainText("Speaking");
  expect((await exportedWorkspace(page)).board.elements).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("voice-board-stroke.png") });
  await page.getByRole("button", { name: "Take over drawing", exact: true }).click();
  await expect(preview).toBeHidden();
  await expect(controls).toContainText("Listening");
  const paused = await exportedWorkspace(page);
  expect(paused.board.elements).toHaveLength(1);
  expect(paused.board.elements[0].type).toBe("freedraw");
  expect((paused.board.elements[0].points as number[][]).at(-1)).not.toEqual([240, 140]);
  expect(paused.board.elements[0]).not.toHaveProperty("voiceProgress");
  expect(paused.changes).toHaveLength(1);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await undoLastChange(page);
  expect((await exportedWorkspace(page)).board.elements.filter((element) => !element.isDeleted)).toEqual([]);
});

test("replacing the workspace aborts microphone capture that is still connecting", async ({ page }) => {
  let release!: () => void;
  await page.route("**/api/voice/session", async (route) => {
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ json: { token: "late-token" } }).catch(() => undefined);
  });
  let sockets = 0;
  await page.routeWebSocket("wss://api.elevenlabs.io/**", () => { sockets++; });
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  const original = await exportedWorkspace(page);
  await page.getByRole("button", { name: "Turn on microphone", exact: true }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  page.on("dialog", (dialog) => dialog.accept());
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({ name: "same-workspace.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(original)) });
  await expect(page.getByText("Workspace imported.", { exact: true })).toBeVisible();
  release();
  await expect(page.getByRole("button", { name: "Turn on microphone", exact: true })).toBeVisible();
  expect(sockets).toBe(0);
});

test("Stop during connection releases capture and ignores a late token", async ({ page }) => {
  await observeAudio(page);
  let release!: () => void;
  let sockets = 0;
  await page.route("**/api/voice/session", async (route) => {
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ json: { token: "late-token" } }).catch(() => undefined);
  });
  await page.routeWebSocket("wss://api.elevenlabs.io/**", () => { sockets++; });
  await page.goto("/");
  await page.getByRole("button", { name: "Turn on microphone", exact: true }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("button", { name: "Turn on microphone", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { capturedTracks: MediaStreamTrack[] }).capturedTracks.map((track) => track.readyState))).toEqual(["ended"]);
  release();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeDisabled();
  expect(sockets).toBe(0);
});

test("voice setup errors leave typed collaboration available", async ({ page }) => {
  await page.route("**/api/voice/session", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Add ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID to .env.local." }) }));
  await page.goto("/");
  await page.getByRole("button", { name: "Turn on microphone", exact: true }).click();
  await expect(page.getByRole("region", { name: "Voice controls" }).getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn on microphone", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Toggle study partner", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Ask your study partner" })).toBeEditable();
});

test("interrupting speech keeps the partial function and resumes the unfinished task after a question", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let socket!: WebSocketRoute;
  const prompts: string[] = [];
  const observedCode: string[] = [];
  await page.route("**/api/voice/session", (route) => route.fulfill({ json: { token: "fixture-token" } }));
  await page.routeWebSocket("wss://api.elevenlabs.io/**", (ws) => { socket = ws; });
  await page.route("**/api/voice/speech", (route) => route.fulfill({
    status: 200, contentType: "audio/pcm", headers: { "x-audio-sample-rate": "24000" }, body: Buffer.alloc(24000 * 2 * 4),
  }));
  await page.route("**/api/ai", async (route) => {
    const body = route.request().postDataJSON();
    let events;
    if (body.continuation) events = [{ type: "done", continuation: { contents: [] } }];
    else {
      prompts.push(body.messages.at(-1).text);
      observedCode.push(body.context.code.text);
      events = [{ type: "call", id: `voice-${prompts.length}`, name: "teach_step", args: {
        speech: prompts.length === 1 ? "Let's write the lower and upper bounds, then calculate the midpoint between them." : "Duplicates change which matching element we choose to return.",
        ...(prompts.length === 1 ? { operation: { name: "edit_code", args: {
          baseRevision: body.context.code.revision,
          replacements: [{ from: 0, to: 0, text: "def voice_search(values):\n    low = 0\n    high = len(values) - 1\n    return low\n" }], summary: "Write bounds progressively",
        } } } : prompts.length === 2 ? { operation: { name: "edit_notes", args: {
          baseRevision: body.context.notes.revision,
          replacements: [{ from: body.context.notes.text.length, to: body.context.notes.text.length, text: "Duplicates affect which matching element to return.\n" }], summary: "Record the clarification",
        } } } : {}),
      } }, { type: "done", continuation: { contents: [] } }];
    }
    await route.fulfill({ contentType: "application/x-ndjson", body: events.map((event) => JSON.stringify(event)).join("\n") + "\n" });
  });
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Workspace tools" }).getByRole("button", { name: "Computer", exact: true }).click();
  await expect(page.getByRole("region", { name: "Python workspace", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Turn on microphone", exact: true }).click();
  await expect(page.getByRole("region", { name: "Voice controls" })).toContainText("Listening");
  socket.send(JSON.stringify({ message_type: "committed_transcript", text: "Show me binary search." }));
  const preview = page.getByLabel("Study partner writing preview", { exact: true });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("def voice_search(values):");
  await expect(page.getByRole("region", { name: "Voice controls" })).toContainText("Speaking");
  const canonical = page.locator('[data-editor-tool="code"] .attention-text-editor .cm-content');
  await expect(canonical).not.toContainText("def voice_search(values):");
  socket.send(JSON.stringify({ message_type: "partial_transcript", text: "Wait, what about duplicates?" }));
  await expect(preview).toBeHidden();
  await expect(canonical).toContainText("def voice_search(values):");
  await expect(canonical).not.toContainText("    return low");
  socket.send(JSON.stringify({ message_type: "committed_transcript", text: "Wait, what about duplicates?" }));
  await expect.poll(() => prompts).toEqual(["Show me binary search.", "Wait, what about duplicates?"]);
  expect(observedCode[1]).toContain("def voice_search(values):");
  await expect(page.getByRole("region", { name: "Voice controls" })).toContainText("Listening");
  socket.send(JSON.stringify({ message_type: "committed_transcript", text: "continue" }));
  await expect.poll(() => prompts.length).toBe(3);
  expect(prompts[2]).toContain("Previous request: Show me binary search.");
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("button", { name: "Turn on microphone", exact: true })).toBeVisible();
  await expect(canonical).toContainText("def voice_search(values):");
  expect((await exportedWorkspace(page)).changes).toHaveLength(2);
  await undoLastChange(page);
  await undoLastChange(page);
  await expect(canonical).not.toContainText("def voice_search(values):");
  expect(errors).toEqual([]);
});
