import { buildBoardPatch } from "../board/adapter";
import { useWorkspace } from "./store";
import {
  applyProposal,
  checkProposal,
  replaceRanges,
  restoreChange,
  undoChange,
  type BoardElement,
  type Proposal,
  type Tool,
  type View,
  type Workspace,
} from "./model";
import type { ClearScope } from "./clearWorkspace";

export type PendingWorkspaceChange = {
  proposal: Proposal;
  preview: string | BoardElement[];
};

/** Browser-owned mutations and their revision checks live behind one boundary. */
export const workspaceCommands = {
  snapshot: (): Workspace => useWorkspace.getState().data,
  read: (tool: Tool) => useWorkspace.getState().data[tool],
  check(pending: PendingWorkspaceChange) {
    const state = useWorkspace.getState();
    checkProposal(state.data, pending.proposal, state.jobId);
  },
  async propose(proposal: Proposal): Promise<PendingWorkspaceChange> {
    const state = useWorkspace.getState();
    checkProposal(state.data, proposal, state.jobId);
    const preview = proposal.target === "board"
      ? await buildBoardPatch(state.data.board.elements, proposal.boardPatch)
      : replaceRanges(state.data[proposal.target].text, proposal.replacements);
    checkProposal(useWorkspace.getState().data, proposal, useWorkspace.getState().jobId);
    return { proposal, preview };
  },
  apply(pending: PendingWorkspaceChange) {
    const state = useWorkspace.getState();
    const { proposal, preview } = pending;
    const next = applyProposal(
      state.data,
      proposal,
      state.jobId,
      Array.isArray(preview) ? preview : undefined,
    );
    state.setData(() => next);
    return {
      status: "accepted" as const,
      target: proposal.target,
      revision: next[proposal.target].revision,
      operationId: proposal.id,
    };
  },
  reject(_pending: PendingWorkspaceChange) {
    return {
      status: "rejected" as const,
      message: "The student rejected the proposed change. No change was applied.",
    };
  },
  undo(id: string) {
    const state = useWorkspace.getState();
    state.setData((data) => undoChange(data, id));
  },
  restore(id: string, revision: number) {
    const state = useWorkspace.getState();
    state.setData((data) => restoreChange(data, id, revision));
  },
  reset(scope: ClearScope) {
    useWorkspace.getState().clearData(scope);
  },
  replace(data: Workspace, notice?: string) {
    useWorkspace.getState().replaceWorkspace(data, notice);
  },
  navigate(view: View, options?: { reveal?: boolean }) {
    useWorkspace.getState().navigate(view, options);
  },
};
