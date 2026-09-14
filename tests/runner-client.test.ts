import { afterEach, describe, expect, it, vi } from "vitest";
import { RunnerClient } from "../src/features/execution/runner-client";
import { isTrustedParentEvent } from "../runner/protocol.mjs";

const envelope = { protocol: "ideate-python", version: 1 };
class BrowserWindow extends EventTarget {
  location = { origin: "http://localhost:3000" };
}
class Frame extends EventTarget {
  src = "/runner/index.html";
  sent: unknown[] = [];
  contentWindow = {
    postMessage: (message: unknown, origin: string) =>
      this.sent.push({ message, origin }),
  };
}
function setup() {
  const window = new BrowserWindow();
  vi.stubGlobal("window", window);
  const frame = new Frame();
  const outputs: unknown[] = [];
  const completions: unknown[] = [];
  const statuses: string[] = [];
  const client = new RunnerClient(frame as unknown as HTMLIFrameElement, {
    onStatus: (status) => statuses.push(status),
    onOutput: (...output) => outputs.push(output),
    onComplete: (...completion) => completions.push(completion),
  });
  const emit = (
    data: Record<string, unknown>,
    origin = "http://localhost:3000",
    source: unknown = frame.contentWindow,
  ) => {
    const event = new Event("message");
    Object.assign(event, { data: { ...envelope, ...data }, origin, source });
    window.dispatchEvent(event);
  };
  return { client, frame, outputs, completions, statuses, emit };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("application runner client", () => {
  it("keeps paused debugging alive and sends each resume only once", () => {
    vi.useFakeTimers();
    const { client, frame, emit, completions, statuses } = setup();
    emit({ type: "status", status: "ready" });
    client.run({ id: "debug", code: "x = 1", debug: true });
    emit({ type: "status", status: "running" });
    emit({
      type: "paused",
      id: "debug",
      pauseId: 1,
      line: 1,
      functionName: "<module>",
      locals: [],
    });
    vi.advanceTimersByTime(60_000);
    expect(completions).toEqual([]);
    expect(statuses.at(-1)).toBe("paused");
    client.resume("step");
    client.resume("step");
    expect(
      frame.sent.filter((entry: any) => entry.message.type === "resume"),
    ).toHaveLength(1);
    expect(frame.sent.at(-1)).toMatchObject({
      message: { type: "resume", id: "debug", pauseId: 1, command: "step" },
    });
    emit({ type: "status", status: "running" });
    vi.advanceTimersByTime(12_000);
    expect(completions).toMatchObject([["debug", { status: "timeout" }]]);
    client.dispose();
  });

  it("trusts only the configured frame origin and exact window source", () => {
    const { client, emit, outputs, completions } = setup();
    client.run({ id: "run-1", code: "print(42)" });
    emit({ type: "status", status: "ready" });
    const output = {
      type: "output",
      id: "run-1",
      sequence: 0,
      channel: "stdout",
      text: "42\n",
    };
    emit(output, "https://untrusted.example");
    emit(output, "http://localhost:3000", {});
    emit(output);
    emit(output);
    emit({ type: "complete", id: "wrong", status: "success", durationMs: 1 });
    emit({ type: "complete", id: "run-1", status: "success", durationMs: 1 });
    expect(outputs).toEqual([["run-1", "stdout", "42\n"]]);
    expect(completions).toEqual([
      ["run-1", { status: "success", durationMs: 1 }],
    ]);
    client.dispose();
  });

  it("stops immediately and ignores late completion from the stopped run", () => {
    const { client, emit, frame, completions } = setup();
    emit({ type: "status", status: "ready" });
    client.run({ id: "run-1", code: "while True: pass" });
    client.stop();
    expect(frame.sent.at(-1)).toMatchObject({
      message: { type: "stop", id: "run-1" },
      origin: "http://localhost:3000",
    });
    emit({ type: "complete", id: "run-1", status: "success", durationMs: 1 });
    expect(completions).toMatchObject([["run-1", { status: "cancelled" }]]);
    client.dispose();
  });

  it("fails a queued run if the runner frame cannot initialize", () => {
    vi.useFakeTimers();
    const { client, completions, statuses } = setup();
    client.run({ id: "run-1", code: "print(42)" });
    vi.advanceTimersByTime(50_000);
    expect(completions).toMatchObject([["run-1", { status: "error" }]]);
    expect(statuses.at(-1)).toBe("error");
    client.dispose();
  });

  it("marks a run interrupted if its iframe reloads instead of leaving it running", () => {
    const { client, frame, emit, completions } = setup();
    emit({ type: "status", status: "ready" });
    client.run({ id: "run-1", code: "while True: pass" });
    frame.dispatchEvent(new Event("load"));
    emit({ type: "status", status: "ready" });
    expect(completions).toMatchObject([
      [
        "run-1",
        { status: "error", error: expect.stringContaining("reloaded") },
      ],
    ]);
    client.dispose();
  });

  it("validates parent source and allowed origin before accepting any command", () => {
    const parent = {};
    const event = {
      source: parent,
      origin: "http://localhost:3000",
      data: { ...envelope, type: "init" },
    };
    expect(isTrustedParentEvent(event, parent, ["http://localhost:3000"])).toBe(
      true,
    );
    expect(
      isTrustedParentEvent({ ...event, source: {} }, parent, [
        "http://localhost:3000",
      ]),
    ).toBe(false);
    expect(
      isTrustedParentEvent(
        { ...event, origin: "https://untrusted.example" },
        parent,
        ["http://localhost:3000"],
      ),
    ).toBe(false);
  });
});
