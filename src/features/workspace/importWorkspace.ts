import { normalizeBoardImport } from "../board/adapter";
import { validateImport, type BoardElement } from "./model";

export async function prepareWorkspaceImport(value: unknown) {
  const data = validateImport(value);
  data.board.elements = await normalizeBoardImport(data.board.elements);
  for (const change of data.changes) {
    if (change.target !== "board") continue;
    change.before = await normalizeBoardImport(change.before as BoardElement[]);
    change.after = await normalizeBoardImport(change.after as BoardElement[]);
  }
  return data;
}
