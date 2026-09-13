import { beforeEach, expect, it, vi } from "vitest";
import { validateToolCall } from "../src/features/ai/server/tools";
import { createCollaborator } from "../src/features/ai/useCollaborator";
import { createWorkspace, undoChange } from "../src/features/workspace/model";
import { useWorkspace } from "../src/features/workspace/store";

const edit = { baseRevision: 0, updates: [{ address: "B2", raw: "=SUM(B1:B1)" }], summary: "Total the recorded amount" };
const stream = (events: unknown[]) => new Response(events.map(e => JSON.stringify(e)).join("\n") + "\n");
beforeEach(() => {
  const data = createWorkspace();
  Object.assign(data, { spreadsheet: { id: "spreadsheet", revision: 0, text: JSON.stringify({ cells: { A1: { raw: "Rent" }, B1: { raw: "1200" }, A100: { raw: "Later" } } }) } });
  useWorkspace.setState({ data, view: "code", selection: null, jobId: null, autoApplyChanges: true });
});
it("validates bounded cell patches and voice operations", () => {
  expect(validateToolCall("edit_spreadsheet", edit)).toEqual(edit);
  expect(validateToolCall("teach_step", { speech: "Here is the total.", operation: { name: "edit_spreadsheet", args: edit } })).toBeDefined();
  for (const address of ["A0", "AA1", "A201", "__proto__"]) expect(validateToolCall("edit_spreadsheet", { ...edit, updates: [{ address, raw: "1" }] })).toBeUndefined();
  expect(validateToolCall("edit_spreadsheet", { ...edit, updates: Array(201).fill(edit.updates[0]) })).toBeUndefined();
  expect(validateToolCall("read_spreadsheet", { fromRow: 10, toRow: 1 })).toBeUndefined();
});
it("reads grounded cells, applies a preserved patch and undoes it", async () => {
  const bodies: any[] = [];
  const client = createCollaborator({ onPending: vi.fn(), onError: vi.fn(), runCode: vi.fn(), request: async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    const call = bodies.length === 1 ? { id: "read", name: "read_spreadsheet", args: {} } : { id: "edit", name: "edit_spreadsheet", args: edit };
    return stream(bodies.length <= 2 ? [{ type: "call", ...call }, { type: "done", continuation: { contents: [] } }] : [{ type: "done", continuation: { contents: [] } }]);
  } });
  const before = useWorkspace.getState().data.spreadsheet.text;
  await client.ask("Total the recorded amount");
  const data = useWorkspace.getState().data;
  expect(JSON.parse(data.spreadsheet.text).cells).toMatchObject({ A1: { raw: "Rent" }, B2: { raw: "=SUM(B1:B1)" }, A100: { raw: "Later" } });
  expect(JSON.stringify(bodies[1])).toContain('calculated');
  expect(data.messages.at(-1)?.sources?.some(s => s.tool === "spreadsheet" && s.excerpt.includes("B1"))).toBe(true);
  expect(undoChange(data, data.changes.at(-1)!.id).spreadsheet.text).toBe(before);
});

it.each(["approve", "reject", "target conflict", "source conflict"])("handles review: %s", async action => {
  useWorkspace.setState({ autoApplyChanges: false });
  const onPending = vi.fn(), bodies: any[] = [];
  const client = createCollaborator({ onPending, onError: vi.fn(), runCode: vi.fn(), request: async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return stream(bodies.length === 1 ? [{ type: "call", id: "edit", name: "edit_spreadsheet", args: edit }, { type: "done", continuation: { contents: [] } }] : [{ type: "done", continuation: { contents: [] } }]);
  } });
  const before = useWorkspace.getState().data.spreadsheet.text;
  const task = client.ask("Total the rent from my notes");
  await vi.waitFor(() => expect(onPending).toHaveBeenCalledWith(expect.objectContaining({ proposal: expect.objectContaining({ target: "spreadsheet" }) })));
  expect(useWorkspace.getState().data.spreadsheet.text).toBe(before);
  if (action === "source conflict" || action === "target conflict") {
    const target = action === "source conflict" ? "notes" : "spreadsheet";
    useWorkspace.getState().setData(data => ({ ...data, [target]: { ...data[target], revision: data[target].revision + 1 } }));
  }
  if (action === "reject") client.reject(); else await client.approve();
  await task;
  const data = useWorkspace.getState().data;
  expect(data.changes).toHaveLength(action === "approve" ? 1 : 0);
  if (action !== "approve") expect(data.spreadsheet.text).toBe(before);
  if (action.includes("conflict")) expect(JSON.stringify(bodies[1])).toContain("conflicted");
});

it("bounds initial occupied context and pages reads with exact cell sources", async () => {
  const cells = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`A${i + 1}`, { raw: String(i + 1) }]));
  useWorkspace.getState().setData(data => ({ ...data, spreadsheet: { ...data.spreadsheet, text: JSON.stringify({ cells }) } }));
  const bodies: any[] = [];
  const client = createCollaborator({ onPending: vi.fn(), onError: vi.fn(), runCode: vi.fn(), request: async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return stream(bodies.length === 1 ? [{ type: "call", id: "read", name: "read_spreadsheet", args: { fromRow: 41, toRow: 100 } }, { type: "done", continuation: { contents: [] } }] : [{ type: "done", continuation: { contents: [] } }]);
  } });
  await client.ask("Read the next rows");
  expect(bodies[0].context.spreadsheet.cells).toHaveLength(20);
  expect(bodies[0].context.spreadsheet.truncated).toBe(true);
  const serialized = JSON.stringify(bodies[1]);
  expect(serialized).toContain('"nextRow":81');
  const source = useWorkspace.getState().data.messages.at(-1)?.sources?.find(source => source.tool === "spreadsheet" && source.ids?.includes("A41"));
  expect(source?.excerpt).toContain("A41: 41 (calculated: 41");
  expect(source?.ids).toHaveLength(40);
});

it("paginates Unicode-heavy rows within the transport byte budget without losing cells", async () => {
  const cells = Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`${String.fromCharCode(65 + i)}1`, { raw: "費".repeat(1000) }]));
  useWorkspace.getState().setData(data => ({ ...data, spreadsheet: { ...data.spreadsheet, text: JSON.stringify({ cells }) } }));
  const reads: any[] = [], bodies: any[] = [];
  const client = createCollaborator({ onPending: vi.fn(), onError: vi.fn(), runCode: vi.fn(), request: async (_url, init) => {
    const body = JSON.parse(String(init?.body)); bodies.push(body);
    const read = body.toolResults?.[0]?.result;
    if (read) reads.push(read);
    const finished = read && !read.nextAfterAddress;
    return stream(finished ? [{ type: "done", continuation: { contents: [] } }] : [{ type: "call", id: `read-${bodies.length}`, name: "read_spreadsheet", args: { fromRow: 1, toRow: 1, ...(read ? { afterAddress: read.nextAfterAddress } : {}) } }, { type: "done", continuation: { contents: [] } }]);
  } });
  await client.ask("Read the first row");
  expect(reads.length).toBeGreaterThan(1);
  expect(reads.flatMap(read => read.cells.map((cell: any) => cell.address))).toEqual(Object.keys(cells));
  for (const body of bodies.slice(1)) expect(Buffer.byteLength(JSON.stringify(body.toolResults))).toBeLessThan(192 * 1024);
  expect(Buffer.byteLength(JSON.stringify(bodies[0].context.spreadsheet))).toBeLessThan(20_000);
});
