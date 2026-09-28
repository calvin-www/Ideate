export type Narrator = (text: string, signal: AbortSignal) => Promise<void> | void;
export async function playStep(text: string, signal: AbortSignal, options: {
  narrate?: Narrator;
  present?: (signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const linked = AbortSignal.any([signal, controller.signal]);
  if (options.narrate) {
    try {
      void Promise.resolve(options.narrate(text, linked)).catch(() => undefined);
    } catch {
      // Optional narration never controls visual progress or the operation result.
    }
  }
  try {
    await options.present?.(linked);
    linked.throwIfAborted();
  } catch (error) {
    controller.abort(error);
    throw error;
  }
}

export function estimateSpeechDuration(text: string): number {
  return Math.max(800, Math.min(18_000, text.trim().split(/\s+/).length * 350));
}

/** Speech may lag behind teaching, but its phrases stay ordered within a turn. */
export function createNarrationQueue(onError?: (error: unknown) => void) {
  let tail = Promise.resolve();
  let active: AbortController | null = null;
  let generation = 0;
  let enabled = true;
  const seen = new Set<string>();
  return {
    enqueue(id: string, signal: AbortSignal, run: (signal: AbortSignal) => Promise<void>) {
      if (!enabled || seen.has(id)) return;
      seen.add(id);
      const queuedGeneration = generation;
      tail = tail.catch(() => undefined).then(async () => {
        if (!enabled || queuedGeneration !== generation || signal.aborted) return;
        const controller = new AbortController();
        active = controller;
        const linked = AbortSignal.any([signal, controller.signal]);
        try {
          await run(linked);
        } catch (error) {
          if (!linked.aborted) onError?.(error);
        } finally {
          if (active === controller) active = null;
        }
      });
    },
    isPlaying: () => active !== null,
    stop() {
      enabled = false;
      generation++;
      active?.abort();
      tail = Promise.resolve();
    },
    resume() {
      enabled = true;
      generation++;
      seen.clear();
      tail = Promise.resolve();
    },
  };
}
