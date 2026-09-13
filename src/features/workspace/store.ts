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

type Store = {
  data: Workspace;
  hydrated: boolean;
  recoveryNeeded: boolean;
  view: View;
  visited: Tool[];
  chatOpen: boolean;
  selection: Selection | null;
  saveStatus: "loading" | "saved" | "saving" | "error";
  saveError: string;
  jobId: string | null;
  activity: string;
  notice: string;
  boardPreview: string;
  setData: (update: (data: Workspace) => Workspace) => void;
  navigate: (view: View) => void;
  setText: (target: "code" | "notes", text: string) => void;
  setBoard: (elements: BoardElement[]) => void;
};
export const useWorkspace = create<Store>((set, get) => ({
  data: createWorkspace(),
  hydrated: false,
  recoveryNeeded: false,
  view: "desk",
  visited: [],
  chatOpen: false,
  selection: null,
  saveStatus: "loading",
  saveError: "",
  jobId: null,
  activity: "",
  notice: "",
  boardPreview: "",
  setData: (update) => set({ data: compactWorkspace(update(get().data)) }),
  navigate: (view) => {
    flushSave();
    set({
      view,
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
  setBoard: (elements) => {
    const data = get().data;
    set({
      data: {
        ...data,
        board: { ...data.board, elements, revision: data.board.revision + 1 },
        updatedAt: Date.now(),
      },
    });
  },
}));
let timer: ReturnType<typeof setTimeout> | undefined;
let started = false;
let savedData: Workspace | undefined;
export async function hydrateWorkspace() {
  if (started) return;
  started = true;
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
