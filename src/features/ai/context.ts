import { parseSheet, evaluateSheet } from "../spreadsheet/sheet";
import type { ArtifactRef, BoardElement, Run, Selection, Tool, Workspace } from "../workspace/model";
export function textExcerpt(text: string, from = 0, to = text.length) {
  const start = Math.max(0, Math.min(from, text.length));
  const end = Math.max(start, Math.min(to, text.length, start + 20_000));
  return {
    text: text.slice(start, end),
    from: start,
    to: end,
    length: text.length,
    truncated: start > 0 || end < text.length,
  };
}

export function boardExcerpt(elements: BoardElement[], ids?: string[]) {
  const selected = ids ? new Set(ids) : null;
  if (selected) {
    for (const element of elements) {
      const bindings = [element.startBinding, element.endBinding].filter(
        Boolean,
      ) as Array<{ elementId?: string }>;
      const bound = Array.isArray(element.boundElements)
        ? (element.boundElements as Array<{ id: string }>)
        : [];
      if (
        selected.has(element.id) ||
        bindings.some((binding) => selected.has(binding.elementId ?? "")) ||
        bound.some((item) => selected.has(item.id))
      ) {
        selected.add(element.id);
        bindings.forEach((binding) => {
          if (binding.elementId) selected.add(binding.elementId);
        });
        bound.forEach((item) => selected.add(item.id));
      }
    }
  }
  const relevant = elements.filter(
    (element) => !element.isDeleted && (!selected || selected.has(element.id)),
  );
  const fields: Array<keyof BoardElement> = [
    "id",
    "type",
    "x",
    "y",
    "width",
    "height",
    "text",
    "strokeColor",
    "backgroundColor",
    "points",
    "startBinding",
    "endBinding",
    "boundElements",
    "containerId",
  ];
  return {
    elements: relevant
      .slice(0, 100)
      .map((element) =>
        Object.fromEntries(
          fields
            .filter((field) => element[field] !== undefined)
            .map((field) => [
              field,
              typeof element[field] === "string"
                ? (element[field] as string).slice(0, 1_000)
                : element[field],
            ]),
        ),
      ),
    totalElements: relevant.length,
    truncated: relevant.length > 100,
  };
}

type SpreadsheetReadCell = { address: string; raw: string; format?: string; calculated: string | number };
function spreadsheetCellSource(cells: SpreadsheetReadCell[]) {
  return cells.map(cell => `${cell.address}: ${cell.raw} (calculated: ${cell.calculated}; format: ${cell.format ?? "general"})`).join("\n");
}
export function spreadsheetExcerpt(text: string, fromRow = 1, toRow = 200, overview = false, afterAddress?: string) {
  const sheet = parseSheet(text);
  const calculated = evaluateSheet(sheet);
  const end = overview ? 200 : Math.min(toRow, fromRow + 39);
  const compare = (a: string, b: string) => Number(a.slice(1)) - Number(b.slice(1)) || a.localeCompare(b);
  const all = Object.entries(sheet.cells).sort(([a], [b]) => compare(a, b));
  const relevant = all.filter(([address]) => Number(address.slice(1)) >= fromRow && Number(address.slice(1)) <= end && (!afterAddress || compare(address, afterAddress) > 0));
  const cells: SpreadsheetReadCell[] = [];
  const encoder = new TextEncoder();
  for (const [address, cell] of relevant) {
    const next = [...cells, { address, ...cell, calculated: calculated[address] }];
    // Include the duplicated source excerpt and JSON escaping in the UTF-8 budget.
    const bytes = encoder.encode(JSON.stringify({ cells: next, excerpt: spreadsheetCellSource(next) })).byteLength;
    if (cells.length && (bytes > (overview ? 16_000 : 64_000) || (overview && cells.length >= 20))) break;
    cells.push(next[next.length - 1]);
  }
  const withinRangeTruncated = cells.length < relevant.length;
  return { cells, fromRow, toRow: end, totalCells: all.length, truncated: cells.length < all.length || end < toRow,
    ...(withinRangeTruncated && cells.length ? { nextAfterAddress: cells.at(-1)!.address } : end < toRow ? { nextRow: end + 1 } : {}) };
}
export function spreadsheetSource(excerpt: ReturnType<typeof spreadsheetExcerpt>) {
  return spreadsheetCellSource(excerpt.cells);
}

export function makeReference(
  data: Workspace,
  tool: Tool,
  selection?: Selection | null,
): ArtifactRef {
  const selected = selection?.tool === tool ? selection : undefined;
  const artifact = data[tool];
  return {
    id: crypto.randomUUID(),
    tool,
    revision: selected?.revision ?? artifact.revision,
    label: selected?.runId
      ? "Python output"
      : tool === "board"
        ? "Whiteboard"
        : tool === "code"
          ? "Python"
          : tool === "spreadsheet" ? "Spreadsheet" : "Notes",
    excerpt: (
      selected?.text ??
      (tool === "board"
        ? data.board.elements
            .filter((element) => !element.isDeleted)
            .map((element) => String(element.text ?? ""))
            .filter(Boolean)
            .join("\n")
        : tool === "spreadsheet" ? spreadsheetSource(spreadsheetExcerpt(data.spreadsheet.text, 1, 200, true)) : data[tool].text)
    ).slice(0, 2_000),
    ...(selected?.ids ? { ids: [...selected.ids] } : {}),
    ...(selected?.from !== undefined
      ? { from: selected.from, to: selected.to }
      : {}),
    ...(selected?.runId ? { runId: selected.runId } : {}),
  };
}

export function makeTextReadReference(
  data: Workspace,
  tool: "code" | "notes",
  range: ReturnType<typeof textExcerpt>,
  run?: Run,
): ArtifactRef {
  return {
    ...makeReference(data, tool, {
      tool,
      revision: run?.revision ?? data[tool].revision,
      text: range.text,
      from: range.from,
      to: range.to,
      ...(run ? { runId: run.id } : {}),
    }),
    // A read is already bounded. Save exactly what was returned, rather than
    // replacing it with the initial 2,000-character overview excerpt.
    excerpt: range.text,
  };
}

export function captureContext(
  workspace: { data: Workspace; view: string },
  selection: Selection | null,
): Record<string, unknown> {
  const { data, view } = workspace;
  const relevantRuns = selection?.runId
    ? data.runs.filter((run) => run.id === selection.runId)
    : data.runs.slice(-2);
  return structuredClone({
    activeTool: view,
    spreadsheet: { id: "spreadsheet", revision: data.spreadsheet.revision, ...spreadsheetExcerpt(data.spreadsheet.text, 1, 200, true) },
    selection: selection
      ? { ...selection, text: selection.text.slice(0, 8_000) }
      : null,
    board: {
      id: "board",
      revision: data.board.revision,
      ...boardExcerpt(
        data.board.elements,
        selection?.tool === "board" ? selection.ids : undefined,
      ),
    },
    code: {
      id: "code",
      revision: data.code.revision,
      ...textExcerpt(
        data.code.text,
        selection?.tool === "code" && !selection.runId
          ? Math.max(0, (selection.from ?? 0) - 2_000)
          : 0,
      ),
    },
    notes: {
      id: "notes",
      revision: data.notes.revision,
      ...textExcerpt(
        data.notes.text,
        selection?.tool === "notes"
          ? Math.max(0, (selection.from ?? 0) - 2_000)
          : 0,
      ),
    },
    runs: relevantRuns.map((run) => ({
      ...run,
      code: run.code.slice(0, 8_000),
      output: run.output.slice(0, 4_000),
      outputTruncated: run.output.length > 4_000,
      sourceTruncated: run.code.length > 8_000,
    })),
    recentChanges: data.changes.slice(-10).map((change) => ({
      id: change.id,
      target: change.target,
      revision: change.resultRevision,
      summary: change.summary.slice(0, 300),
    })),
  });
}
