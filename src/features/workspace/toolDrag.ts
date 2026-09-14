import type { OpenEditor, Placement } from "./editorDock";
import { isEditorPanel, type EditorPanel } from "./layoutPersistence";

export const TOOL_DRAG_TYPE = "application/x-ideate-tool";
export type DropPosition = "top" | "bottom" | "left" | "right" | "center";

/** Drag payload is mirrored here because dragover cannot read dataTransfer contents. */
let current: EditorPanel | null = null;

export function beginToolDrag(tool: EditorPanel, transfer: DataTransfer | null) {
  current = tool;
  if (transfer) {
    transfer.setData(TOOL_DRAG_TYPE, tool);
    transfer.effectAllowed = "move";
  }
}
export function endToolDrag() {
  current = null;
}
export function isToolDrag(transfer: DataTransfer | null | undefined) {
  return current !== null || Boolean(transfer?.types?.includes(TOOL_DRAG_TYPE));
}
export function draggedTool(transfer?: DataTransfer | null): EditorPanel | null {
  if (current) return current;
  const value = transfer?.getData(TOOL_DRAG_TYPE);
  return isEditorPanel(value) ? value : null;
}
export function placementFromPosition(position: DropPosition): Placement {
  switch (position) {
    case "top":
      return "above";
    case "bottom":
      return "below";
    case "center":
      return "within";
    default:
      return position;
  }
}
export function dropCommand(args: {
  tool: EditorPanel;
  position: DropPosition;
  reference: EditorPanel | undefined;
  fallback: EditorPanel;
}): OpenEditor {
  return {
    tool: args.tool,
    placement: placementFromPosition(args.position),
    reference: args.tool === "output" ? "code" : (args.reference ?? args.fallback),
  };
}
