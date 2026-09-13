import { beforeEach, expect, it, vi } from "vitest";
import { demoSnapshot } from "../src/features/bank/normalize";
import { functionDeclarations, validateToolCall } from "../src/features/ai/server/tools";
import { SYSTEM_INSTRUCTION } from "../src/features/ai/server/prompt";
import { createCollaborator } from "../src/features/ai/useCollaborator";
import { createWorkspace, undoChange } from "../src/features/workspace/model";
import { useWorkspace } from "../src/features/workspace/store";
import { parseSheet } from "../src/features/spreadsheet/sheet";

const call = { id: "bank", name: "import_bank_data", args: { baseRevision: 0, summary: "Import mock bank data" } };
const stream = (events: unknown[]) => new Response(events.map((e) => JSON.stringify(e)).join("\n") + "\n");
const snapshot = { ...demoSnapshot("no_key"), source: "nessie" as const, reason: undefined };

beforeEach(() => {
  const data = createWorkspace();
  Object.assign(data, { spreadsheet: { id: "spreadsheet", revision: 0, text: JSON.stringify({ cells: { A1: { raw: "Old" } } }) } });
  useWorkspace.setState({ data, view: "spreadsheet", selection: null, jobId: null, autoApplyChanges: true });
});

function collaborator(bank: () => Promise<Response>, onPending = vi.fn()) {
  const bodies: any[] = [];
  const client = createCollaborator({ onPending, onError: vi.fn(), runCode: vi.fn(), request: async (url, init) => {
    if (String(url).endsWith("/api/bank/import")) { expect(init?.method).toBe("POST"); return bank(); }
    bodies.push(JSON.parse(String(init?.body)));
    return stream(bodies.length === 1 ? [{ type: "call", ...call }, { type: "done", continuation: { contents: [] } }] : [{ type: "done", continuation: { contents: [] } }]);
  } });
  return { client, bodies };
}

it("declares and validates the tool, including inside teach_step", () => {
  expect(validateToolCall("import_bank_data", call.args)).toEqual(call.args);
  expect(validateToolCall("import_bank_data", { baseRevision: 0 })).toBeUndefined();
  expect(validateToolCall("teach_step", { speech: "Pulling in your bank.", operation: { name: "import_bank_data", args: call.args } })).toBeDefined();
  expect(functionDeclarations.find((d) => d.name === "import_bank_data")?.description).toMatch(/Nessie/);
  expect(SYSTEM_INSTRUCTION).toMatch(/import_bank_data/);
});

it("replaces the sheet through an undoable proposal and reports the source and ranges", async () => {
  const { client, bodies } = collaborator(async () => Response.json(snapshot));
  const before = useWorkspace.getState().data.spreadsheet.text;
  await client.ask("Pull in my bank transactions");
  const data = useWorkspace.getState().data;
  const sheet = parseSheet(data.spreadsheet.text);
  expect(sheet.cells.A1.raw).toBe("Bank import");
  expect(sheet.cells.B1.raw).toMatch(/Capital One Nessie \(live\)/);
  expect(Object.values(sheet.cells).some((cell) => cell.raw === "Old")).toBe(false);
  expect(data.spreadsheet.revision).toBe(1);
  expect(data.changes).toHaveLength(1);
  expect(data.changes[0]).toMatchObject({ target: "spreadsheet", summary: "Import mock bank data" });
  const result = JSON.stringify(bodies[1]);
  expect(result).toContain('"status":"accepted"');
  expect(result).toContain('"source":"nessie"');
  expect(result).toMatch(/"ranges":\{"accounts":\{"fromRow":5/);
  expect(undoChange(data, data.changes[0].id).spreadsheet.text).toBe(before);
});

it("passes the offline reason through and honours review mode", async () => {
  useWorkspace.setState({ autoApplyChanges: false });
  const onPending = vi.fn();
  const { client, bodies } = collaborator(async () => Response.json(demoSnapshot("Nessie GET /customers timed out")), onPending);
  const before = useWorkspace.getState().data.spreadsheet.text;
  const task = client.ask("Connect my bank");
  await vi.waitFor(() => expect(onPending).toHaveBeenCalledWith(expect.objectContaining({ proposal: expect.objectContaining({ target: "spreadsheet", baseRevision: 0 }) })));
  expect(useWorkspace.getState().data.spreadsheet.text).toBe(before);
  await client.approve();
  await task;
  const result = JSON.stringify(bodies[1]);
  expect(result).toContain('"source":"snapshot"');
  expect(result).toContain("timed out");
  expect(parseSheet(useWorkspace.getState().data.spreadsheet.text).cells.B1.raw).toMatch(/Offline demo data/);
});

it("reports a stale revision as a conflict and a failed route as unavailable", async () => {
  const stale = collaborator(async () => Response.json(snapshot));
  useWorkspace.getState().setData((data) => ({ ...data, spreadsheet: { ...data.spreadsheet, revision: 3 } }));
  await stale.client.ask("Connect my bank");
  expect(JSON.stringify(stale.bodies[1])).toContain("conflicted");
  expect(useWorkspace.getState().data.changes).toHaveLength(0);

  useWorkspace.getState().setData((data) => ({ ...data, spreadsheet: { ...data.spreadsheet, revision: 0 } }));
  const down = collaborator(async () => new Response("nope", { status: 502 }));
  await down.client.ask("Connect my bank");
  expect(JSON.stringify(down.bodies[1])).toMatch(/unavailable.*502/);
  expect(useWorkspace.getState().data.changes).toHaveLength(0);
});
