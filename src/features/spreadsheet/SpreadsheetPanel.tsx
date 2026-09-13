"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { Download, Redo2, Undo2 } from "lucide-react";
import { useWorkspace } from "../workspace/store";
import { adapters } from "../workspace/adapters";
import { columnName, evaluateSheet, exportCsv, formatCell, parseSheet, patchSheet, serializeSheet, type Sheet } from "./sheet";
import styles from "./SpreadsheetPanel.module.css";
import { parseClipboard, serializeClipboard } from "./clipboard";

type Point = { row: number; col: number };
const address = ({ row, col }: Point) => `${columnName(col)}${row + 1}`;
function point(id: string): Point | null {
  const match = /^([A-Z])([1-9]\d*)$/.exec(id);
  return match && Number(match[2]) <= 200 ? { col: match[1].charCodeAt(0) - 65, row: Number(match[2]) - 1 } : null;
}

export default function SpreadsheetPanel({ visible = true }: { visible?: boolean }) {
  const artifact = useWorkspace((state) => state.data.spreadsheet);
  const workspaceId = useWorkspace((state) => state.data.id);
  const sheet = useMemo(() => parseSheet(artifact.text), [artifact.text]);
  const values = useMemo(() => evaluateSheet(sheet), [sheet]);
  const [active, setActive] = useState<Point>({ row: 0, col: 0 });
  const [anchor, setAnchor] = useState<Point>({ row: 0, col: 0 });
  const [focused, setFocused] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState(40);
  const [cols, setCols] = useState(8);
  const [error, setError] = useState("");
  const [, refreshHistory] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const history = useRef<{ undo: string[]; redo: string[]; text: string; workspaceId: string }>({ undo: [], redo: [], text: artifact.text, workspaceId });
  const preserveAnchor = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const occupied = Object.keys(sheet.cells).map(point).filter((p): p is Point => !!p);
  const rowCount = Math.min(200, Math.max(rows, ...occupied.map((p) => p.row + 1)));
  const colCount = Math.min(26, Math.max(cols, ...occupied.map((p) => p.col + 1)));
  const selected = useMemo(() => {
    const ids: string[] = [];
    for (let row = Math.min(anchor.row, active.row); row <= Math.max(anchor.row, active.row); row++)
      for (let col = Math.min(anchor.col, active.col); col <= Math.max(anchor.col, active.col); col++) ids.push(address({ row, col }));
    return ids;
  }, [anchor, active]);
  const selectedSet = new Set(selected);
  const currentAddress = address(active);

  useLayoutEffect(() => {
    // Select the raw value after the formatted display has been replaced.
    if (focused) root.current?.querySelector<HTMLInputElement>(`[aria-label="Cell ${focused}"]`)?.select();
  }, [focused]);

  useEffect(() => {
    if (history.current.text !== artifact.text || history.current.workspaceId !== workspaceId) {
      history.current = { undo: [], redo: [], text: artifact.text, workspaceId };
      refreshHistory((n) => n + 1);
    }
  }, [artifact.text, workspaceId]);
  useEffect(() => {
    if (!visible || useWorkspace.getState().view !== "spreadsheet") return;
    useWorkspace.setState({ selection: { tool: "spreadsheet", revision: artifact.revision, ids: selected,
      text: selected.map((id) => `${id}: ${sheet.cells[id]?.raw ?? ""}${sheet.cells[id]?.raw.startsWith("=") ? ` → ${formatCell(values[id] ?? "", sheet.cells[id]?.format)}` : ""}`).join("\n") } });
  }, [selected, artifact.revision, sheet, values, visible]);

  const focusCell = useCallback((next: Point, extend = false) => {
    next = { row: Math.max(0, Math.min(199, next.row)), col: Math.max(0, Math.min(25, next.col)) };
    setRows((n) => Math.max(n, next.row + 1));
    setCols((n) => Math.max(n, next.col + 1));
    setActive(next);
    if (!extend) setAnchor(next);
    preserveAnchor.current = extend;
    setEditing(false);
    requestAnimationFrame(() => {
      const input = root.current?.querySelector<HTMLInputElement>(`[aria-label="Cell ${address(next)}"]`);
      input?.focus();
      input?.select();
      input?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }, []);
  useEffect(() => {
    const adapter = { focus: () => focusCell(activeRef.current), reveal: (ref: { ids?: string[] }) => {
      const first = ref.ids?.map(point).find((p) => !!p);
      if (first) focusCell(first);
    } };
    adapters.spreadsheet = adapter;
    return () => { if (adapters.spreadsheet === adapter) delete adapters.spreadsheet; };
  }, [focusCell]);

  function save(next: Sheet) {
    const state = useWorkspace.getState();
    const before = state.data.spreadsheet.text;
    const text = serializeSheet(next);
    if (before === text) return;
    if (history.current.text !== before || history.current.workspaceId !== state.data.id)
      history.current = { undo: [], redo: [], text: before, workspaceId: state.data.id };
    history.current.undo.push(before);
    if (history.current.undo.length > 100) history.current.undo.shift();
    history.current.redo = [];
    state.setText("spreadsheet", text);
    history.current.text = useWorkspace.getState().data.spreadsheet.text;
    refreshHistory((n) => n + 1);
    setError("");
  }
  function update(updates: Parameters<typeof patchSheet>[1]) {
    try { save(patchSheet(parseSheet(useWorkspace.getState().data.spreadsheet.text), updates)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update these cells."); }
  }
  function undo(redo = false) {
    const state = useWorkspace.getState();
    if (history.current.text !== state.data.spreadsheet.text || history.current.workspaceId !== state.data.id) return;
    const source = redo ? history.current.redo : history.current.undo;
    const text = source.pop();
    if (text === undefined) return;
    (redo ? history.current.undo : history.current.redo).push(state.data.spreadsheet.text);
    state.setText("spreadsheet", text);
    history.current.text = text;
    refreshHistory((n) => n + 1);
  }
  function paste(event: ClipboardEvent) {
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    let matrix: string[][];
    try { matrix = parseClipboard(text); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not read the clipboard."); return; }
    if (active.row + matrix.length > 200 || active.col + Math.max(...matrix.map((row) => row.length)) > 26) {
      setError("This paste exceeds the sheet's 200 rows or 26 columns. Choose a cell closer to A1 or paste a smaller range."); return;
    }
    update(matrix.flatMap((row, r) => row.map((raw, c) => ({ address: address({ row: active.row + r, col: active.col + c }), raw }))));
  }
  function copy(event: ClipboardEvent) {
    if (editing && selected.length === 1) return;
    event.preventDefault();
    const lines: string[][] = [];
    for (let row = Math.min(anchor.row, active.row); row <= Math.max(anchor.row, active.row); row++) {
      const cells: string[] = [];
      for (let col = Math.min(anchor.col, active.col); col <= Math.max(anchor.col, active.col); col++) cells.push(sheet.cells[address({ row, col })]?.raw ?? "");
      lines.push(cells);
    }
    event.clipboardData.setData("text/plain", serializeClipboard(lines));
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) {
      event.preventDefault(); undo(event.shiftKey || event.key.toLowerCase() === "y"); return;
    }
    if (event.key === "F2") { event.preventDefault(); setEditing(true); return; }
    if (event.key === "Escape") { setEditing(false); event.currentTarget.select(); return; }
    if (!editing && (event.key === "Delete" || event.key === "Backspace") && selected.length > 1) {
      event.preventDefault(); update(selected.map((id) => ({ address: id, raw: "" }))); return;
    }
    const moves: Record<string, Point> = { Enter: { row: active.row + (event.shiftKey ? -1 : 1), col: active.col }, Tab: { row: active.row, col: active.col + (event.shiftKey ? -1 : 1) }, ArrowDown: { row: active.row + 1, col: active.col }, ArrowUp: { row: active.row - 1, col: active.col }, ArrowLeft: { row: active.row, col: active.col - 1 }, ArrowRight: { row: active.row, col: active.col + 1 } };
    if (moves[event.key] && (!editing || event.key === "Enter" || event.key === "Tab")) {
      event.preventDefault(); focusCell(moves[event.key], event.shiftKey && event.key.startsWith("Arrow"));
    }
  }
  return <section ref={root} className={styles.panel} aria-label="Spreadsheet workspace" hidden={!visible} onFocusCapture={() => useWorkspace.getState().focusTool("spreadsheet")}>
    <div className={styles.toolbar}>
      <span className={styles.title}>Spreadsheet</span>
      <div className={styles.actions}>
        <button aria-label="Undo spreadsheet edit" title="Undo" disabled={!history.current.undo.length} onClick={() => undo()}><Undo2 size={16} /></button>
        <button aria-label="Redo spreadsheet edit" title="Redo" disabled={!history.current.redo.length} onClick={() => undo(true)}><Redo2 size={16} /></button>
        <select aria-label="Cell number format" value={sheet.cells[currentAddress]?.format ?? "general"} onChange={(event) => update(selected.map((id) => ({ address: id, raw: sheet.cells[id]?.raw ?? "", format: event.target.value as "general" | "currency" | "percent" })))}>
          <option value="general">General</option><option value="currency">Currency (USD)</option><option value="percent">Percent</option>
        </select>
        <button onClick={() => { const url = URL.createObjectURL(new Blob([exportCsv(sheet)], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = "spreadsheet.csv"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}><Download size={15} /> CSV</button>
      </div>
    </div>
    <div className={styles.formulaBar}><output aria-label="Selected cells">{selected.length > 1 ? `${address(anchor)}:${currentAddress}` : currentAddress}</output><span aria-hidden="true">fx</span><input aria-label="Cell formula" value={sheet.cells[currentAddress]?.raw ?? ""} placeholder="Enter a value or =SUM(A1:A5)" onChange={(event) => update([{ address: currentAddress, raw: event.target.value }])} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); focusCell({ ...active, row: active.row + 1 }); } }} /></div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.scroller}>
      <table className={styles.grid} aria-label="Spreadsheet cells" onPaste={paste} onCopy={copy}>
        <thead><tr><th aria-label="Row numbers" />{Array.from({ length: colCount }, (_, col) => <th key={col} scope="col">{columnName(col)}</th>)}</tr></thead>
        <tbody>{Array.from({ length: rowCount }, (_, row) => <tr key={row}><th scope="row">{row + 1}</th>{Array.from({ length: colCount }, (_, col) => {
          const id = address({ row, col });
          return <td key={id} className={selectedSet.has(id) ? styles.selected : undefined}><input aria-label={`Cell ${id}`} autoComplete="off" spellCheck={false} tabIndex={id === currentAddress ? 0 : -1} className={typeof values[id] === "number" ? styles.numeric : undefined}
            value={focused === id ? sheet.cells[id]?.raw ?? "" : formatCell(values[id] ?? "", sheet.cells[id]?.format)}
            onPointerDown={(event) => { preserveAnchor.current = event.shiftKey; if (event.shiftKey) { event.preventDefault(); focusCell({ row, col }, true); } }}
            onFocus={(event) => { setActive({ row, col }); if (!preserveAnchor.current) setAnchor({ row, col }); preserveAnchor.current = false; setFocused(id); setEditing(false); event.currentTarget.select(); }}
            onBlur={() => setFocused(null)} onDoubleClick={() => setEditing(true)} onChange={(event) => update([{ address: id, raw: event.target.value }])} onKeyDown={keyDown} /></td>;
        })}</tr>)}</tbody>
      </table>
    </div>
    <footer className={styles.footer}><div><button disabled={rowCount >= 200} onClick={() => setRows(Math.min(200, rowCount + 20))}>+ 20 rows</button><button disabled={colCount >= 26} onClick={() => setCols(Math.min(26, colCount + 4))}>+ 4 columns</button></div><span>{selected.length > 1 ? `${selected.length} cells selected` : "Shift + arrows to select · F2 to edit"}</span><details><summary>Formulas</summary><p>Start with = to calculate. Try =A1*B1 or =SUM(A1:A10). Use SUM, AVERAGE, MIN, MAX and COUNT with ranges, or ROUND(A1, 2). Copying preserves formulas exactly; cell references do not shift.</p></details></footer>
  </section>;
}

