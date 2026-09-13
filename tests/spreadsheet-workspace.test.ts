import { describe, expect, it } from "vitest";
import { createWorkspace, validateImport, editText, applyProposal, undoChange, restoreChange, type Proposal } from "../src/features/workspace/model";
import { clearWorkspaceData } from "../src/features/workspace/clearWorkspace";

const text = JSON.stringify({ cells: { A1: { raw: "Rent" }, B1: { raw: "1200", format: "currency" }, B2: { raw: "=SUM(B1:B1)" } } });
const proposal: Proposal = { id: "sheet-op", jobId: "job", target: "spreadsheet", baseRevision: 0, summary: "Expenses from journal", replacements: [{ from: 0, to: 0, text }], sources: [], sourceRevisions: { notes: 0 } };

describe("spreadsheet workspace transactions", () => {
  it("migrates older workspaces without changing their existing documents", () => {
    const old = createWorkspace();
    const { spreadsheet: _sheet, ...legacy } = old;
    const loaded = validateImport(legacy);
    expect(loaded.spreadsheet).toEqual({ id: "spreadsheet", revision: 0, text: "" });
    expect(loaded.notes).toEqual(old.notes);
  });
  it("applies, saves, and undoes a spreadsheet proposal", () => {
    const initial = createWorkspace();
    const next = validateImport(applyProposal(initial, proposal, "job"));
    expect(next.spreadsheet.text).toBe(text);
    expect(next.spreadsheet.revision).toBe(1);
    expect(undoChange(next, proposal.id).spreadsheet.text).toBe("");
  });
  it("preserves manual edits and rejects stale journal sources", () => {
    const initial = createWorkspace();
    expect(() => applyProposal(editText(initial, "spreadsheet", text), proposal, "job")).toThrow(/changed/i);
    expect(() => applyProposal(editText(initial, "notes", "New expenses"), proposal, "job")).toThrow(/source/i);
  });
  it("keeps replaced manual content recoverable after a conflicting undo", () => {
    const applied = applyProposal(createWorkspace(), proposal, "job");
    const manual = editText(applied, "spreadsheet", JSON.stringify({ cells: { A1: { raw: "Manual" } } }));
    expect(() => undoChange(manual, proposal.id)).toThrow(/changed/i);
    const restored = restoreChange(manual, proposal.id, manual.spreadsheet.revision);
    expect(restored.spreadsheet.text).toBe("");
    expect(undoChange(restored, restored.changes.at(-1)!.id).spreadsheet.text).toBe(manual.spreadsheet.text);
  });
  it("rejects malformed spreadsheet data in edits, imports, proposals, and history", () => {
    const initial = createWorkspace();
    const invalid = '{"cells":{"A201":{"raw":"1"}}}';
    expect(() => editText(initial, "spreadsheet", invalid)).toThrow();
    expect(() => validateImport({ ...initial, spreadsheet: { id: "spreadsheet", revision: 0, text: invalid } })).toThrow();
    expect(() => applyProposal(initial, { ...proposal, replacements: [{ from: 0, to: 0, text: invalid }] }, "job")).toThrow();
    const next = applyProposal(initial, proposal, "job");
    next.changes[0].before = invalid;
    expect(() => validateImport(next)).toThrow();
  });
  it("clears the spreadsheet independently and on full reset", () => {
    const next = applyProposal(createWorkspace(), proposal, "job");
    const cleared = clearWorkspaceData(next, "spreadsheet");
    expect(cleared.spreadsheet.text).toBe("");
    expect(cleared.notes).toEqual(next.notes);
    expect(cleared.changes).toHaveLength(0);
    expect(clearWorkspaceData(next, "all").spreadsheet.text).toBe("");
  });
});
