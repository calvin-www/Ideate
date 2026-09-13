export type SpeechPlayer = (text: string, signal: AbortSignal, onStart: () => void) => Promise<void>;
export async function playStep(text: string, signal: AbortSignal, options: {
  speak: SpeechPlayer;
  present?: (signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const linked = AbortSignal.any([signal, controller.signal]);
  let started = false;
  let begin!: () => void, fail!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => { begin = resolve; fail = reject; });
  const audio = Promise.resolve().then(() => options.speak(text, linked, () => {
    if (!started && !linked.aborted) { started = true; begin(); }
  })).then(() => {
    if (!started) throw new Error("Speech ended before playback started.");
  }).catch((error) => { fail(error); throw error; });
  const visual = ready.then(() => { linked.throwIfAborted(); return options.present?.(linked); });
  try {
    await Promise.all([audio, visual]);
    linked.throwIfAborted();
  } catch (error) {
    controller.abort(error);
    throw error;
  }
}

export function estimateSpeechDuration(text: string): number {
  return Math.max(800, Math.min(18_000, text.trim().split(/\s+/).length * 350));
}
