"use client";
import { create } from "zustand";
import {
  createWorkspace,
  compactWorkspace,
  editText,
  type Selection,
  type View,
  type Workspace,
  type Tool,
  type BoardElement,
} from "./model";
import { loadWorkspace, saveWorkspace } from "./persistence";
import { checkAttention, type AttentionState } from "../ai/attention";
import { clearWorkspaceData, type ClearScope } from "./clearWorkspace";
import type { BoardFiles } from "../board/images";

type Store = {
  data: Workspace;
  hydrated: boolean;
  recoveryNeeded: boolean;
  view: View;
  page: View;
  visited: Tool[];
  visibleTools: Tool[];
  navigationEpoch: number;
  navigationReveal: Tool | null;
  focusTool: (tool: Tool) => void;
  chatOpen: boolean;
  autoApplyChanges: boolean;
  setAutoApplyChanges: (enabled: boolean) => void;
  selection: Selection | null;
  saveStatus: "loading" | "saved" | "saving" | "error";
  saveError: string;
  jobId: string | null;
  activity: string;
  notice: string;
  boardPreview: string;
  attention: AttentionState;
  clearAttention: (target?: Tool) => void;
  clearData: (scope: ClearScope) => void;
  editorEpochs: Record<Tool, number>;
  setData: (update: (data: Workspace) => Workspace) => void;
  navigate: (view: View, options?: { reveal?: boolean }) => void;
  setText: (target: "code" | "notes", text: string) => void;
  setBoard: (elements: BoardElement[], files?: BoardFiles) => void;
};
export const useWorkspace = create<Store>((set, get) => ({
  data: createWorkspace(),
  hydrated: false,
  recoveryNeeded: false,
  view: "desk",
  page: "desk",
  visited: [],
  visibleTools: [],
  navigationEpoch: 0,
  navigationReveal: null,
  focusTool: (tool) => {
    if (get().view !== tool) set({ view: tool, selection: null });
  },
  chatOpen: false,
  autoApplyChanges: true,
  setAutoApplyChanges: (enabled) => {
    set({ autoApplyChanges: enabled });
    try {
      localStorage.setItem("ideate:auto-apply-changes", String(enabled));
    } catch {
      set({
        notice:
          "Auto-apply changed for this session. Your browser could not save the preference.",
      });
    }
  },
  selection: null,
  saveStatus: "loading",
  saveError: "",
  jobId: null,
  activity: "",
  notice: "",
  boardPreview: "",
  attention: {},
  editorEpochs: { board: 0, code: 0, notes: 0 },
  clearData: (scope) => {
    const current = get();
    const editorEpochs = { ...current.editorEpochs };
    for (const tool of ["board", "code", "notes"] as const)
      if (scope === "all" || scope === tool) editorEpochs[tool]++;
    if (scope === "all") current.setAutoApplyChanges(true);
    set({
      data: clearWorkspaceData(current.data, scope),
      editorEpochs,
      selection: null,
      attention: {},
      ...(scope === "all" || scope === "board" ? { boardPreview: "" } : {}),
      ...(scope === "all"
        ? {
            recoveryNeeded: false,
            saveError: "",
            notice: "",
            view: "desk" as const,
            page: "desk" as const,
          }
        : {}),
    });
    void flushSave();
  },
  clearAttention: (target) => {
    if (!target) return set({ attention: {} });
    const attention = { ...get().attention };
    delete attention[target];
    set({ attention });
  },
  setData: (update) => set({ data: compactWorkspace(update(get().data)) }),
  navigate: (view, options) => {
    flushSave();
    set({
      view,
      page: view,
      navigationEpoch: get().navigationEpoch + 1,
      navigationReveal: options?.reveal && view !== "desk" ? view : null,
      selection: null,
      visited:
        view === "desk"
          ? get().visited
          : Array.from(new Set([...get().visited, view])),
    });
  },
  setText: (target, text) => {
    if (text.length > 200_000) {
      set({
        notice:
          "This document has reached its 200,000 character limit. Download a copy before starting a smaller example.",
      });
      return;
    }
    set({ data: editText(get().data, target, text) });
  },
  setBoard: (elements, files) => {
    const data = get().data;
    set({
      data: {
        ...data,
        board: {
          ...data.board,
          elements,
          files: files ?? data.board.files,
          revision: data.board.revision + 1,
        },
        updatedAt: Date.now(),
      },
    });
  },
}));
// Cues are transient and revision-bound, including changes made by import,
// undo, and accepted AI proposals. Never rebase them onto different content.
useWorkspace.subscribe((state, previous) => {
  if (state.data === previous.data) return;
  const remaining = Object.values(state.attention).filter((cue) => {
    const sameContent =
      cue.target === "board"
        ? state.data.board.elements === previous.data.board.elements
        : state.data[cue.target].text === previous.data[cue.target].text;
    return (
      sameContent &&
      cue.workspaceId === state.data.id &&
      !checkAttention(state.data, cue)
    );
  });
  if (remaining.length !== Object.keys(state.attention).length)
    useWorkspace.setState({
      attention: Object.fromEntries(remaining.map((cue) => [cue.target, cue])),
    });
});
let timer: ReturnType<typeof setTimeout> | undefined;
let started = false;
let savedData: Workspace | undefined;
export async function hydrateWorkspace() {
  if (started) return;
  started = true;
  try {
    if (typeof window !== "undefined") {
      useWorkspace.setState({
        autoApplyChanges:
          window.localStorage.getItem("ideate:auto-apply-changes") !== "false",
      });
    }
  } catch {
    /* Keep auto-apply on when browser preferences are unavailable. */
  }
  try {
    const data = await loadWorkspace();
    useWorkspace.setState({
      ...(data ? { data } : {}),
      hydrated: true,
      saveStatus: "saved",
    });
    savedData = useWorkspace.getState().data;
  } catch {
    useWorkspace.setState({
      hydrated: true,
      recoveryNeeded: true,
      saveStatus: "error",
      saveError:
        "The saved workspace could not be opened. It has been preserved. Download it for recovery or import a valid copy. New edits will not overwrite it.",
    });
  }
  useWorkspace.subscribe((state, previous) => {
    if (state.data === previous.data) return;
    if (state.recoveryNeeded) return;
    useWorkspace.setState({ saveStatus: "saving" });
    clearTimeout(timer);
    timer = setTimeout(flushSave, 450);
  });
}
export async function flushSave() {
  clearTimeout(timer);
  const { data, hydrated, recoveryNeeded } = useWorkspace.getState();
  if (!hydrated || recoveryNeeded || data === savedData) return;
  try {
    await saveWorkspace(data);
    savedData = data;
    if (useWorkspace.getState().data === data)
      useWorkspace.setState({ saveStatus: "saved", saveError: "" });
  } catch {
    useWorkspace.setState({
      saveStatus: "error",
      saveError:
        "Could not save locally. Export your workspace to keep a copy.",
    });
  }
}
