import { z } from "zod";
import { attentionSchema, parseAttention } from "./attention";
import { freehandAdditionSchema } from "../board/freehand";

const offset = z.number().int().nonnegative().max(1_000_000);
const revision = z.number().int().nonnegative();
const id = z.string().min(1).max(200);
const summary = z.string().min(1).max(600);
const coordinate = z.number().min(-100_000).max(100_000);
// Tool arguments can contain escaped line breaks in board labels. A diagram
// label treats the two characters backslash and n as a line break. Code and
// notes keep their text verbatim: a literal \n is meaningful there.
const boardText = z
  .string()
  .max(2_000)
  .overwrite((text) => text.replace(/\\n/g, "\n"));
const shapeAddition = z.strictObject({
  type: z.enum(["rectangle", "ellipse", "diamond", "text"]),
  x: coordinate,
  y: coordinate,
  width: z.number().min(1).max(10_000),
  height: z.number().min(1).max(10_000),
  text: boardText.optional(),
});
const arrowAddition = z.strictObject({
  type: z.literal("arrow"),
  x: coordinate,
  y: coordinate,
  width: z.number().min(-10_000).max(10_000).describe("Horizontal displacement from start to end; negative points left, zero is vertical."),
  height: z.number().min(-10_000).max(10_000).describe("Vertical displacement from start to end; negative points up, zero is horizontal."),
  text: boardText.optional(),
  startId: id.optional(),
  endId: id.optional(),
}).refine((arrow) => arrow.width !== 0 || arrow.height !== 0, {
  path: ["width"], message: "An arrow must move: width and height cannot both be zero.",
});
const textPatch = z.strictObject({
  baseRevision: revision,
  replacements: z
    .array(
      z.strictObject({
        from: offset,
        to: offset,
        text: z.string().max(24 * 1024),
      }),
    )
    .min(1)
    .max(30),
  summary,
});
const readText = z.strictObject({
  from: offset.optional(),
  to: offset.optional(),
});

const workspaceToolSchemas = {
  show_attention: attentionSchema,
  clear_attention: z.strictObject({
    target: z.enum(["board", "code", "notes"]).optional(),
  }),
  read_board: z.strictObject({ ids: z.array(id).max(100).optional() }),
  read_code: readText,
  read_notes: readText,
  read_spreadsheet: z.strictObject({
    afterAddress: z.string().regex(/^[A-Z](?:[1-9]|[1-9][0-9]|1[0-9]{2}|200)$/).optional(),
    fromRow: z.number().int().min(1).max(200).optional(),
    toRow: z.number().int().min(1).max(200).optional(),
  }),
  edit_spreadsheet: z.strictObject({
    baseRevision: revision,
    updates: z.array(z.strictObject({
      address: z.string().regex(/^[A-Z](?:[1-9]|[1-9][0-9]|1[0-9]{2}|200)$/),
      raw: z.string().max(1000),
      format: z.enum(["general", "currency", "percent"]).optional(),
    })).min(1).max(200),
    summary,
  }),
  read_run: z.strictObject({
    id,
    from: offset.optional(),
    to: offset.optional(),
  }),
  edit_code: textPatch,
  edit_notes: textPatch,
  edit_board: z.strictObject({
    baseRevision: revision,
    additions: z
      .array(
        z.discriminatedUnion("type", [
          shapeAddition,
          arrowAddition,
          freehandAdditionSchema,
        ]),
      )
      .max(50),
    updates: z
      .array(
        z.strictObject({
          id,
          text: boardText.optional(),
          strokeColor: z.string().max(32).optional(),
          backgroundColor: z.string().max(32).optional(),
          x: coordinate.optional(),
          y: coordinate.optional(),
        }),
      )
      .max(50),
    deleteIds: z.array(id).max(50),
    summary,
  }),
  run_python: z.strictObject({ revision }),
  link_artifacts: z.strictObject({
    sourceIds: z.array(id).min(1).max(30),
    target: z.literal("notes"),
    summary,
  }),
};

export const toolSchemas = {
  ...workspaceToolSchemas,
  teach_step: z.strictObject({
    text: z.string().trim().min(1).max(1200),
    operation: z.discriminatedUnion("name", [
      z.strictObject({ name: z.literal("edit_code"), args: workspaceToolSchemas.edit_code }),
      z.strictObject({ name: z.literal("edit_notes"), args: workspaceToolSchemas.edit_notes }),
      z.strictObject({ name: z.literal("edit_spreadsheet"), args: workspaceToolSchemas.edit_spreadsheet }),
      z.strictObject({ name: z.literal("edit_board"), args: workspaceToolSchemas.edit_board }),
      z.strictObject({ name: z.literal("show_attention"), args: workspaceToolSchemas.show_attention }),
      z.strictObject({ name: z.literal("clear_attention"), args: workspaceToolSchemas.clear_attention }),
    ]).optional(),
  }),
};

export const toolNames = [
  "teach_step",
  "show_attention",
  "clear_attention",
  "read_board",
  "read_code",
  "read_notes",
  "read_spreadsheet",
  "read_run",
  "edit_code",
  "edit_notes",
  "edit_spreadsheet",
  "edit_board",
  "run_python",
  "link_artifacts",
] as const;
export type ToolName = (typeof toolNames)[number];

function operation<K extends ToolName>(name: K) {
  return z.strictObject({ name: z.literal(name), args: toolSchemas[name] });
}

export const operationSchema = z.discriminatedUnion("name", [
  operation("teach_step"),
  operation("show_attention"),
  operation("clear_attention"),
  operation("read_board"),
  operation("read_code"),
  operation("read_notes"),
  operation("read_spreadsheet"),
  operation("read_run"),
  operation("edit_code"),
  operation("edit_notes"),
  operation("edit_spreadsheet"),
  operation("edit_board"),
  operation("run_python"),
  operation("link_artifacts"),
]);
export type Operation = z.infer<typeof operationSchema>;
export type OperationCall = { id: string; operation: Operation };

export function parseOperation(name: string, args: unknown): Operation | undefined {
  const parsed = operationSchema.safeParse({ name, args });
  if (!parsed.success) return undefined;
  const operation = parsed.data;
  if (operation.name === "show_attention" && !parseAttention(operation.args)) return undefined;
  if (operation.name === "read_spreadsheet") {
    const range = operation.args;
    if ((range.toRow ?? 200) < (range.fromRow ?? 1)) return undefined;
  }
  if (operation.name === "edit_spreadsheet") {
    const updates = operation.args.updates;
    if (new Set(updates.map((cell) => cell.address)).size !== updates.length) return undefined;
  }
  if (operation.name === "teach_step" && operation.args.operation) {
    const nested = operation.args.operation;
    if (!parseOperation(nested.name, nested.args)) return undefined;
  }
  if (operation.name === "edit_code" || operation.name === "edit_notes") {
    const ranges = [...operation.args.replacements].sort(
      (a, b) => a.from - b.from || a.to - b.to,
    );
    if (ranges.some((range, index) =>
      range.to < range.from || (index > 0 && range.from < ranges[index - 1].to)
    )) return undefined;
  }
  if (
    operation.name === "read_code" ||
    operation.name === "read_notes" ||
    operation.name === "read_run"
  ) {
    const range = operation.args;
    if (range.from !== undefined && range.to !== undefined && range.to < range.from)
      return undefined;
  }
  return operation;
}

export function validateToolCall(name: string, args: unknown): Record<string, unknown> | undefined {
  return parseOperation(name, args)?.args;
}

// Backends own the value and meaning of a checkpoint. Callers only pass it back.
declare const checkpointBrand: unique symbol;
export type StudyCheckpoint = { readonly [checkpointBrand]: true };

export type StudyTurnInput =
  | { type: "start"; messages: { role: "user" | "assistant"; text: string }[]; context: Record<string, unknown> }
  | { type: "results"; checkpoint: StudyCheckpoint; results: { id: string; result: unknown }[] }
  | { type: "continue"; checkpoint: StudyCheckpoint };

export type StudyEvent =
  | { type: "text"; text: string }
  | { type: "replace"; text: string }
  | { type: "status"; message: string }
  | { type: "operationBatch"; operations: OperationCall[]; checkpoint?: StudyCheckpoint }
  | { type: "paused"; message: string; checkpoint: StudyCheckpoint; append: boolean }
  | { type: "done" }
  | { type: "error"; message: string };

export type StudyBackend = {
  advance(input: StudyTurnInput, signal: AbortSignal): AsyncIterable<StudyEvent>;
};
