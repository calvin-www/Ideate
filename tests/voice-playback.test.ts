import { afterEach, describe, expect, it, vi } from "vitest";
import { createNarrationQueue, playStep } from "../src/features/voice/playback";

afterEach(() => vi.useRealTimers());

describe("teaching step playback", () => {
  it("presents a step when narration is off", async () => {
    const present = vi.fn().mockResolvedValue(undefined);

    await playStep("Look at the midpoint.", new AbortController().signal, { present });

    expect(present).toHaveBeenCalledOnce();
  });

  it("starts visual progress with narration and finishes without waiting for slow audio", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const done = playStep("Look at the midpoint.", new AbortController().signal, {
      narrate: async () => {
        events.push("audio started");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        events.push("audio finished");
      },
      present: async () => {
        events.push("visual started");
        await new Promise((resolve) => setTimeout(resolve, 100));
        events.push("visual finished");
      },
    }).then(() => events.push("step finished"));

    await vi.advanceTimersByTimeAsync(100);
    await done;
    expect(events).toContain("audio started");
    expect(events).toContain("visual started");
    expect(events).toContain("visual finished");
    expect(events).toContain("step finished");
    expect(events).not.toContain("audio finished");
    await vi.advanceTimersByTimeAsync(900);
  });

  it("keeps a visual step successful when narration fails", async () => {
    const present = vi.fn().mockResolvedValue(undefined);

    await expect(playStep("Continue.", new AbortController().signal, {
      narrate: async () => { throw new Error("Speech unavailable"); },
      present,
    })).resolves.toBeUndefined();
    expect(present).toHaveBeenCalledOnce();
  });

  it("aborts narration when visual progression fails", async () => {
    let audioSignal!: AbortSignal;

    await expect(playStep("Drawing.", new AbortController().signal, {
      narrate: async (_text, signal) => { audioSignal = signal; },
      present: async () => { throw new Error("The document changed"); },
    })).rejects.toThrow("The document changed");
    expect(audioSignal.aborted).toBe(true);
  });
});

describe("narration queue", () => {
  it("delivers phrases in order even after an audio failure", async () => {
    const queue = createNarrationQueue();
    const events: string[] = [];
    let finishFirst!: () => void;
    const signal = new AbortController().signal;
    queue.enqueue("first", signal, async () => {
      events.push("first started");
      await new Promise<void>((resolve) => { finishFirst = resolve; });
      throw new Error("Speech unavailable");
    });
    queue.enqueue("second", signal, async () => { events.push("second started"); });

    await vi.waitFor(() => expect(events).toEqual(["first started"]));
    finishFirst();
    await vi.waitFor(() => expect(events).toEqual(["first started", "second started"]));
  });

  it("stops active and queued audio, then accepts a new turn", async () => {
    const queue = createNarrationQueue();
    const events: string[] = [];
    const signal = new AbortController().signal;
    queue.enqueue("first", signal, async (audioSignal) => {
      events.push("first started");
      await new Promise<void>((_resolve, reject) =>
        audioSignal.addEventListener("abort", () => reject(audioSignal.reason), { once: true }));
    });
    queue.enqueue("second", signal, async () => { events.push("second started"); });
    await vi.waitFor(() => expect(events).toEqual(["first started"]));

    queue.stop();
    await Promise.resolve();
    expect(events).toEqual(["first started"]);
    queue.resume();
    queue.enqueue("third", signal, async () => { events.push("third started"); });
    await vi.waitFor(() => expect(events).toEqual(["first started", "third started"]));
  });
});
