"use client";
import { create } from "zustand";
import { useWorkspace } from "../workspace/store";
import { applyProposal, checkProposal, type BoardElement, type Proposal } from "../workspace/model";
import { boardFrame, checkpointBoard, textFrame } from "./progression";

export type Presentation = {
  proposal: Proposal;
  text?: string;
  elements?: BoardElement[];
  finalElements?: BoardElement[];
  cancel: () => void;
};
export const usePresentation = create<{
  current: Presentation | null;
  paintedBoard: { proposalId: string; elements: BoardElement[] } | null;
  paintedText: { proposalId: string; text: string } | null;
}>(() => ({ current: null, paintedBoard: null, paintedText: null }));
export const clearPresentation = (jobId?: string) => {
  const current = usePresentation.getState().current;
  if (current && (!jobId || current.proposal.jobId === jobId)) current.cancel();
};
export const cancelPresentation = () => {
  const current = usePresentation.getState().current;
  if (!current) return;
  clearPresentation();
  if (typeof window !== "undefined") window.dispatchEvent(new Event("ideate:voice-takeover"));
};

/** Retain an already-authorized step at its currently visible position. */
export function checkpointPresentation(): boolean {
  const current = usePresentation.getState().current;
  if (!current) return false;
  const state = useWorkspace.getState();
  const proposal = current.proposal;
  try {
    checkProposal(state.data, proposal, state.jobId);
    const before = proposal.target === "board" ? state.data.board.elements : state.data[proposal.target].text;
    const painted = usePresentation.getState().paintedBoard;
    const paintedText = usePresentation.getState().paintedText;
    const visible = proposal.target === "board"
      ? painted?.proposalId === proposal.id ? painted.elements : before
      : paintedText?.proposalId === proposal.id ? paintedText.text : before;
    if (visible === undefined || JSON.stringify(visible) === JSON.stringify(before)) {
      clearPresentation(proposal.jobId);
      return false;
    }
    const checkpoint = {
      ...proposal,
      summary: `${proposal.summary} (paused here)`,
      ...(typeof visible === "string" ? { replacements: [{ from: 0, to: String(before).length, text: visible }] } : {}),
    };
    const board = Array.isArray(visible) ? checkpointBoard(visible) : undefined;
    if (board && JSON.stringify(board) === JSON.stringify(before)) {
      clearPresentation(proposal.jobId);
      return false;
    }
    const next = applyProposal(state.data, checkpoint, state.jobId, board);
    // Retire guards before publishing the checkpoint so our own commit is not
    // mistaken for a conflicting manual edit. Late completion cannot apply it twice.
    clearPresentation(proposal.jobId);
    state.setData(() => next);
    return true;
  } catch {
    // A later manual edit or a replaced workspace wins over an old preview.
    clearPresentation(proposal.jobId);
    return false;
  }
}

export function takeOverPresentation() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("ideate:voice-takeover"));
  clearPresentation();
}

export async function presentChange(proposal: Proposal, preview: string | BoardElement[], signal: AbortSignal, durationMs: number): Promise<void> {
  signal.throwIfAborted();
  clearPresentation();
  // Cell patches commit together after speech; never animate serialized sheet data.
  if (proposal.target === "spreadsheet") return;
  const initial = useWorkspace.getState().data;
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  await new Promise<void>((resolve, reject) => {
    let frame = 0, disposed = false;
    const cleanup = () => { cancelAnimationFrame(frame); signal.removeEventListener("abort", cancel); unsubscribe(); };
    const cancel = () => {
      if (disposed) return;
      disposed = true;
      cleanup();
      if (usePresentation.getState().current?.cancel === cancel)
        usePresentation.setState({ current: null, paintedBoard: null, paintedText: null });
      reject(new DOMException("Presentation interrupted", "AbortError"));
    };
    const unsubscribe = useWorkspace.subscribe((state) => {
      if (state.data.id !== initial.id || state.data[proposal.target].revision !== proposal.baseRevision) {
        if (usePresentation.getState().current?.cancel === cancel) cancelPresentation();
        else cancel();
      }
    });
    const start = performance.now();
    function tick(now: number) {
      if (disposed) return;
      if (signal.aborted) { cancel(); return; }
      const progress = Math.min(1, (now - start) / Math.max(1, durationMs));
      // Reduced motion uses completed objects/lines without intermediate pen movement.
      const visibleProgress = reduced && proposal.target === "board" ? (progress === 1 ? 1 : 0) : progress;
      usePresentation.setState({ current: {
        proposal, cancel,
        ...(typeof preview === "string"
          ? { text: textFrame(initial[proposal.target as "code" | "notes"].text, proposal.replacements ?? [], progress) }
          : {
              elements: boardFrame(
                initial.board.elements,
                preview,
                visibleProgress,
              ),
              finalElements: preview,
            }),
      } });
      if (progress < 1) frame = requestAnimationFrame(tick);
      // Keep the revision/abort guards until the paired speech ends and the
      // collaborator retires this preview immediately before committing.
      else resolve();
    }
    signal.addEventListener("abort", cancel, { once: true });
    frame = requestAnimationFrame(tick);
  });
}
