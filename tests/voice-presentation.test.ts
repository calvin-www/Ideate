import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createWorkspace, type Proposal } from "../src/features/workspace/model";
import { useWorkspace } from "../src/features/workspace/store";
import { checkpointPresentation, clearPresentation, presentChange, usePresentation } from "../src/features/voice/presentation";

let frame: FrameRequestCallback;
beforeEach(() => {
  useWorkspace.setState({ data: createWorkspace(), jobId: "voice-job" });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => { clearPresentation(); vi.unstubAllGlobals(); });

function proposal(jobId = "voice-job"): Proposal {
  return { id: jobId, jobId, target: "code", baseRevision: 0, summary: "Write a line", sources: [], sourceRevisions: {}, replacements: [{ from: 0, to: 0, text: "low = 0\n" }] };
}

it("keeps exactly the visible lines as one undoable change when interrupted", async () => {
  const initial = useWorkspace.getState().data;
  const change = { ...proposal(), replacements: [{ from: 0, to: 0, text: "def search(values):\n    low = 0\n    return low\n" }] };
  const playing = presentChange(change, "def search(values):\n    low = 0\n    return low\n" + initial.code.text, new AbortController().signal, 1000).catch((error) => error);
  frame(performance.now() + 400);
  const visible = usePresentation.getState().current!.text;
  usePresentation.setState({ paintedText: { proposalId: change.id, text: visible! } });
  expect(visible).toContain("def search(values):");
  expect(visible).not.toContain("    return low");
  expect(checkpointPresentation()).toBe(true);
  expect((await playing).name).toBe("AbortError");
  expect(usePresentation.getState().current).toBeNull();
  expect(useWorkspace.getState().data.code.text).toBe(visible);
  expect(useWorkspace.getState().data.changes).toHaveLength(1);
  expect(useWorkspace.getState().data.changes[0].before).toBe(initial.code.text);
  expect(checkpointPresentation()).toBe(false);
});

it("does not save unchanged frames or overwrite a newer manual edit", async () => {
  const playing = presentChange(proposal(), "low = 0\n", new AbortController().signal, 1000).catch((error) => error);
  frame(performance.now());
  expect(checkpointPresentation()).toBe(false);
  await playing;
  expect(useWorkspace.getState().data.changes).toHaveLength(0);
  const second = presentChange(proposal(), "low = 0\n", new AbortController().signal, 1000).catch((error) => error);
  frame(performance.now() + 2000);
  await second;
  useWorkspace.getState().setText("code", "# manual edit");
  expect(checkpointPresentation()).toBe(false);
  expect(useWorkspace.getState().data.code.text).toBe("# manual edit");
});

it("does not checkpoint work that has not reached the editor yet", async () => {
  const before = useWorkspace.getState().data.code.text;
  const playing = presentChange(proposal(), "low = 0\n" + before, new AbortController().signal, 100);
  frame(performance.now() + 200);
  await playing;
  expect(usePresentation.getState().current!.text).not.toBe(before);
  expect(checkpointPresentation()).toBe(false);
  expect(useWorkspace.getState().data.code.text).toBe(before);
  expect(useWorkspace.getState().data.changes).toHaveLength(0);
});

it("keeps manual-edit interruption active after the visual timer finishes", async () => {
  const takeover = vi.fn();
  window.addEventListener("ideate:voice-takeover", takeover);
  const playback = presentChange(proposal(), "low = 0\n", new AbortController().signal, 100);
  frame(performance.now() + 200);
  await playback;
  expect(usePresentation.getState().current).not.toBeNull();
  useWorkspace.getState().setText("code", "# my manual change");
  expect(takeover).toHaveBeenCalledOnce();
  expect(usePresentation.getState().current).toBeNull();
  expect(useWorkspace.getState().data.code.text).toBe("# my manual change");
});

it("retires the preview before commit without treating the commit as manual takeover", async () => {
  const takeover = vi.fn();
  window.addEventListener("ideate:voice-takeover", takeover);
  const playback = presentChange(proposal(), "low = 0\n", new AbortController().signal, 100);
  frame(performance.now() + 200);
  await playback;
  clearPresentation("voice-job");
  useWorkspace.getState().setText("code", "low = 0\n");
  expect(takeover).not.toHaveBeenCalled();
  expect(usePresentation.getState().current).toBeNull();
});

it("ignores stale job cleanup after a newer presentation begins", async () => {
  const first = new AbortController();
  const oldPlayback = presentChange(proposal("old"), "old", first.signal, 100).catch((error) => error);
  frame(performance.now() + 10);
  const newPlayback = presentChange(proposal("new"), "new", new AbortController().signal, 100);
  frame(performance.now() + 200);
  await newPlayback;
  first.abort();
  clearPresentation("old");
  expect((await oldPlayback).name).toBe("AbortError");
  expect(usePresentation.getState().current?.proposal.jobId).toBe("new");
});
