import { prepareWorkspaceImport } from "./importWorkspace";
import { compactWorkspace, validateImport, validateWorkspace, type Workspace } from "./model";

export const MAX_WORKSPACE_BYTES = 32 * 1024 * 1024;

function byteLength(text: string): number {
  return new Blob([text]).size;
}

/** Keep current work and linked evidence when retained history reaches the backup budget. */
export function fitWorkspace(data: Workspace): Workspace {
  let fitted = compactWorkspace(validateWorkspace(data));
  let serialized = JSON.stringify(fitted);
  if (byteLength(serialized) <= MAX_WORKSPACE_BYTES) return fitted;

  const linked = new Set(
    Array.from(fitted.notes.text.matchAll(/#source[:=]([^\s)"<>]+)/g), (match) => match[1]),
  );
  fitted = { ...fitted, changes: [...fitted.changes], messages: [...fitted.messages], runs: [...fitted.runs], references: [...fitted.references] };
  while (byteLength(serialized) > MAX_WORKSPACE_BYTES) {
    const oldChange = fitted.changes.findIndex((change, index) =>
      fitted.changes.slice(index + 1).some((later) => later.target === change.target),
    );
    if (oldChange >= 0) fitted.changes.splice(oldChange, 1);
    else if (fitted.messages.length) fitted.messages.shift();
    else if (fitted.runs.length) fitted.runs.shift();
    else {
      const unlinked = fitted.references.findIndex((ref) => !linked.has(ref.id));
      if (unlinked < 0) break;
      fitted.references.splice(unlinked, 1);
    }
    serialized = JSON.stringify(fitted);
  }
  if (byteLength(serialized) > MAX_WORKSPACE_BYTES)
    throw new Error("This workspace exceeds the 32 MiB backup limit. Current documents were not changed.");
  return fitted;
}

export function serializeWorkspaceBackup(data: Workspace): string {
  return JSON.stringify(fitWorkspace(data));
}

export async function parseWorkspaceBackup(raw: string): Promise<Workspace> {
  if (byteLength(raw) > MAX_WORKSPACE_BYTES)
    throw new Error("Workspace file exceeds the 32 MiB backup limit.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Workspace file is not valid JSON.");
  }
  const data = validateImport(parsed);
  if (!data.board.elements.length && !data.changes.some((change) => change.target === "board"))
    return data;
  return prepareWorkspaceImport(data);
}
