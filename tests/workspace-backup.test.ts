import { describe, expect, it } from "vitest";
import { MAX_WORKSPACE_BYTES, parseWorkspaceBackup, serializeWorkspaceBackup } from "../src/features/workspace/backup";
import { applyProposal, compactWorkspace, createWorkspace, editText } from "../src/features/workspace/model";

describe("workspace backup contract", () => {
  it("restores a valid workspace whose retained edit history exceeds the old import limit", async () => {
    let data = editText(createWorkspace(), "notes", "a".repeat(190_000));
    for (let i = 0; i < 40; i++) {
      data = compactWorkspace(applyProposal(data, {
        id: `edit-${i}`,
        jobId: "job",
        target: "notes",
        baseRevision: data.notes.revision,
        summary: "Change first character",
        replacements: [{ from: 0, to: 1, text: i % 2 ? "a" : "b" }],
        sources: [],
        sourceRevisions: {},
      }, "job"));
    }

    expect(Buffer.byteLength(JSON.stringify(data, null, 2))).toBeGreaterThan(15_000_000);
    const restored = await parseWorkspaceBackup(serializeWorkspaceBackup(data));
    expect(restored.notes.text).toBe(data.notes.text);
    expect(restored.notes.revision).toBe(41);
    expect(restored.changes).toHaveLength(40);
  });

  it("counts UTF-8 bytes and retains embedded board files", async () => {
    const data = createWorkspace();
    data.notes.text = "A 🙂 note";
    data.board.files.image = {
      id: "image",
      mimeType: "image/png",
      dataURL: "data:image/png;base64,AAAA",
      created: 1,
    };
    const raw = serializeWorkspaceBackup(data);
    expect(Buffer.byteLength(raw)).toBeGreaterThan(raw.length);
    const restored = await parseWorkspaceBackup(raw);
    expect(restored.notes.text).toBe("A 🙂 note");
    expect(restored.board.files.image.dataURL).toBe("data:image/png;base64,AAAA");
  });

  it("rejects irreducible oversized linked sources without mutating documents", () => {
    const data = createWorkspace();
    data.notes.text = Array.from({ length: 135 }, (_, index) => `#source:ref${index}`).join(" ");
    data.references = Array.from({ length: 135 }, (_, index) => ({
      id: `ref${index}`,
      tool: "notes",
      revision: 0,
      label: "Linked source",
      excerpt: "x".repeat(250_000),
    }));
    const original = data.notes.text;
    expect(() => serializeWorkspaceBackup(data)).toThrow(/32 MiB backup limit/);
    expect(data.notes.text).toBe(original);
    expect(data.references).toHaveLength(135);
  });

  it("rejects malformed and oversized backup input before replacing workspace data", async () => {
    await expect(parseWorkspaceBackup("{")).rejects.toThrow(/valid JSON/);
    await expect(parseWorkspaceBackup("x".repeat(MAX_WORKSPACE_BYTES + 1))).rejects.toThrow(/32 MiB backup limit/);
  });
});
