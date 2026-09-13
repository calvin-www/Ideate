import { describe, expect, it } from "vitest";
import { playStep } from "../src/features/voice/playback";

describe("speech and writing playback", () => {
  it("starts writing during audible speech and waits for both", async () => {
    const events: string[] = [];
    let finishSpeech!: () => void;
    const done = playStep("Look at the midpoint.", new AbortController().signal, {
      speak: async (_text, _signal, start) => {
        await Promise.resolve(); events.push("speaking"); start();
        await new Promise<void>((resolve) => { finishSpeech = resolve; });
        events.push("speech finished");
      },
      present: async () => { events.push("writing"); },
    }).then(() => { events.push("done"); });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(["speaking", "writing"]);
    finishSpeech(); await done;
    expect(events).toEqual(["speaking", "writing", "speech finished", "done"]);
  });

  it("cancels audio if the visual presentation fails", async () => {
    let audioSignal!: AbortSignal;
    const done = playStep("Drawing.", new AbortController().signal, {
      speak: (_text, signal, start) => new Promise<void>((_resolve, reject) => {
        audioSignal = signal;
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        start();
      }),
      present: async () => { throw new Error("The document changed"); },
    });
    await expect(done).rejects.toThrow("The document changed");
    expect(audioSignal.aborted).toBe(true);
  });

  it("never starts drawing when speech fails to start", async () => {
    let drawn = false;
    await expect(playStep("Hello", new AbortController().signal, {
      speak: async () => { throw new Error("Speech unavailable"); },
      present: async () => { drawn = true; },
    })).rejects.toThrow("Speech unavailable");
    expect(drawn).toBe(false);
  });
});
