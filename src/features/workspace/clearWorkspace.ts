import { createWorkspace, type Tool, type Workspace } from "./model";

export type ClearScope = Tool | "all";

export function clearWorkspaceData(
  data: Workspace,
  scope: ClearScope,
): Workspace {
  if (scope === "all") {
    const empty = createWorkspace();
    return {
      ...empty,
      code: { ...empty.code, text: "" },
      notes: { ...empty.notes, text: "" },
    };
  }
  return {
    ...data,
    [scope]:
      scope === "board"
        ? {
            id: "board",
            revision: data.board.revision + 1,
            elements: [],
            files: {},
          }
        : { ...data[scope], revision: data[scope].revision + 1, text: "" },
    runs: scope === "code" ? [] : data.runs,
    changes: data.changes.filter((change) => change.target !== scope),
    updatedAt: Date.now(),
  };
}
