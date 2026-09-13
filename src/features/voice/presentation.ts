"use client";
import { create } from "zustand";
import { useWorkspace } from "../workspace/store";
import type { BoardElement, Proposal } from "../workspace/model";
import { boardFrame, textFrame } from "./progression";

export type Presentation = {
  proposal: Proposal;
  text?: string;
  elements?: BoardElement[];
  cancel: () => void;
};
export const usePresentation = create<{ current: Presentation | null }>(() => ({ current: null }));
export const clearPresentation = () => usePresentation.setState({ current: null });
export const cancelPresentation = () => usePresentation.getState().current?.cancel();

export async function presentChange(proposal: Proposal, preview: string | BoardElement[], signal: AbortSignal, durationMs: number): Promise<void> {
  signal.throwIfAborted();
  cancelPresentation();
  const initial = useWorkspace.getState().data;
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  await new Promise<void>((resolve, reject) => {
    let frame = 0, finished = false;
    const cleanup = () => { cancelAnimationFrame(frame); signal.removeEventListener("abort", cancel); unsubscribe(); };
    const cancel = () => {
      if (finished) return;
      finished = true;
      cleanup();
      clearPresentation();
      reject(new DOMException("Presentation interrupted", "AbortError"));
    };
    const unsubscribe = useWorkspace.subscribe((state) => {
      if (state.data.id !== initial.id || state.data[proposal.target].revision !== proposal.baseRevision) cancel();
    });
    const start = performance.now();
    function tick(now: number) {
      if (finished) return;
      if (signal.aborted) { cancel(); return; }
      const progress = Math.min(1, (now - start) / Math.max(1, durationMs));
      // Reduced motion uses completed objects/lines without intermediate pen movement.
      const visibleProgress = reduced && proposal.target === "board" ? Math.floor(progress * 5) / 5 : progress;
      usePresentation.setState({ current: {
        proposal, cancel,
        ...(typeof preview === "string"
          ? { text: textFrame(initial[proposal.target as "code" | "notes"].text, proposal.replacements ?? [], progress) }
          : { elements: boardFrame(initial.board.elements, preview, visibleProgress) }),
      } });
      if (progress < 1) frame = requestAnimationFrame(tick);
      else { finished = true; cleanup(); resolve(); }
    }
    signal.addEventListener("abort", cancel, { once: true });
    frame = requestAnimationFrame(tick);
  });
}
