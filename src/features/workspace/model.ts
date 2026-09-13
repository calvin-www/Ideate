import { z } from "zod";

export type Tool = "board" | "code" | "notes";
export type View = Tool | "desk";
export type BoardElement = {
  id: string;
  type: string;
  isDeleted?: boolean;
  [key: string]: unknown;
};
export type ArtifactRef = {
  id: string;
  tool: Tool;
  revision: number;
  label: string;
  excerpt: string;
  ids?: string[];
  from?: number;
  to?: number;
  runId?: string;
};
export type Run = {
  id: string;
  code: string;
  revision: number;
  output: string;
  status:
    "running" | "success" | "error" | "cancelled" | "timeout" | "interrupted";
  startedAt: number;
  durationMs: number;
  error?: string;
  line?: number;
};
export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  sources?: ArtifactRef[];
  status?: string;
};
export type Replacement = { from: number; to: number; text: string };
export type BoardPatch = {
  additions?: Record<string, unknown>[];
  updates?: Record<string, unknown>[];
  deleteIds?: string[];
};
export type Proposal = {
  id: string;
  jobId: string;
  target: Tool;
  baseRevision: number;
  summary: string;
  replacements?: Replacement[];
  boardPatch?: BoardPatch;
  sources: ArtifactRef[];
  sourceRevisions: Partial<Record<Tool, number>>;
};
export type Change = {
  id: string;
  target: Tool;
  summary: string;
  before: string | BoardElement[];
  after: string | BoardElement[];
  resultRevision: number;
  sources: ArtifactRef[];
  undone?: boolean;
};
export type Workspace = {
  schemaVersion: 1;
  id: string;
  title: string;
  code: { id: "code"; revision: number; text: string };
  notes: { id: "notes"; revision: number; text: string };
  board: {
    id: "board";
    revision: number;
    elements: BoardElement[];
    viewport?: { scrollX: number; scrollY: number; zoom: number };
  };
  runs: Run[];
  messages: Message[];
  changes: Change[];
  references: ArtifactRef[];
  acceptedOperations: string[];
  updatedAt: number;
};
export type Selection = {
  tool: Tool;
  revision: number;
  text: string;
  ids?: string[];
  from?: number;
  to?: number;
  runId?: string;
};

export const SAMPLE_CODE = `# Change the target, run, and follow the search.\ndef binary_search(values, target):\n    low, high = 0, len(values) - 1\n    while low <= high:\n        mid = (low + high) // 2\n        print(f"low={low}  high={high}  mid={mid}  value={values[mid]}")\n        if values[mid] == target:\n            return mid\n        if values[mid] < target:\n            low = mid + 1\n        else:\n            high = mid - 1\n    return -1\n\nvalues = [2, 5, 8, 12, 16, 23, 38, 56]\ntarget = 16\nresult = binary_search(values, target)\nprint(f"Found at index {result}" if result != -1 else "Not found")\n`;

export function createWorkspace(): Workspace {
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: "My study desk",
    code: { id: "code", revision: 0, text: SAMPLE_CODE },
    notes: {
      id: "notes",
      revision: 0,
      text: "# Binary search\n\n## What I want to understand\n\nWhy is it safe to discard half the array?\n\n## Observations\n\nWrite down a prediction, then try it in Python.\n",
    },
    board: { id: "board", revision: 0, elements: [] },
    runs: [],
    messages: [],
    changes: [],
    references: [],
    acceptedOperations: [],
    updatedAt: Date.now(),
  };
}

// Keep a working session bounded. Source links in the notebook take priority
// over unlinked history; trimming conversation history never edits documents.
export function compactWorkspace(data: Workspace): Workspace {
  if (
    data.messages.length <= 200 &&
    data.changes.length <= 40 &&
    data.runs.length <= 100 &&
    data.references.length <= 2000 &&
    data.acceptedOperations.length <= 1000
  )
    return data;
  let references = data.references;
  if (references.length > 2000) {
    const linked = new Set(
      Array.from(
        data.notes.text.matchAll(/#source[:=]([^\s)"<>]+)/g),
        (match) => match[1],
      ),
    );
    const important = references.filter((ref) => linked.has(ref.id));
    // More than 2,000 live links is a document limit, not permission to drop one.
    if (important.length <= 2000) {
      const recent = references
        .filter((ref) => !linked.has(ref.id))
        .slice(-(2000 - important.length));
      references = [...important, ...(important.length === 2000 ? [] : recent)];
    }
  }
  return {
    ...data,
    messages: data.messages.slice(-200),
    changes: data.changes.slice(-40),
    runs: data.runs.slice(-100),
    references,
    acceptedOperations: data.acceptedOperations.slice(-1000),
  };
}

export function editText(
  data: Workspace,
  target: "code" | "notes",
  text: string,
): Workspace {
  if (data[target].text === text) return data;
  return {
    ...data,
    [target]: { ...data[target], text, revision: data[target].revision + 1 },
    updatedAt: Date.now(),
  };
}

export function replaceRanges(
  text: string,
  replacements: Replacement[],
): string {
  if (!Array.isArray(replacements) || replacements.length > 100)
    throw new Error("Invalid replacement list.");
  const sorted = [...replacements].sort(
    (a, b) => a.from - b.from || a.to - b.to,
  );
  let end = -1;
  for (const r of sorted) {
    if (
      !Number.isInteger(r.from) ||
      !Number.isInteger(r.to) ||
      r.from < 0 ||
      r.to < r.from ||
      r.to > text.length ||
      typeof r.text !== "string"
    )
      throw new Error("Invalid text range.");
    if (r.from < end || (r.from === end && r.from === r.to))
      throw new Error("Text ranges overlap.");
    end = r.to;
  }
  let result = text;
  for (const r of sorted.reverse())
    result = result.slice(0, r.from) + r.text + result.slice(r.to);
  if (result.length > 200_000)
    throw new Error("This document exceeds the size limit.");
  return result;
}

export function checkProposal(
  data: Workspace,
  proposal: Proposal,
  activeJob: string | null,
) {
  if (data.acceptedOperations.includes(proposal.id))
    throw new Error("This change was already applied.");
  if (activeJob !== proposal.jobId)
    throw new Error(
      "This request was cancelled. Ask again to prepare a fresh change.",
    );
  if (data[proposal.target].revision !== proposal.baseRevision)
    throw new Error(
      "This document changed. Ask for a fresh proposal to preserve your edits.",
    );
  for (const [tool, revision] of Object.entries(proposal.sourceRevisions)) {
    if (data[tool as Tool].revision !== revision)
      throw new Error(
        "The source context changed. Ask again using the current workspace.",
      );
  }
}

export function applyProposal(
  data: Workspace,
  proposal: Proposal,
  activeJob: string | null,
  boardResult?: BoardElement[],
): Workspace {
  checkProposal(data, proposal, activeJob);
  const target = proposal.target;
  const before = target === "board" ? data.board.elements : data[target].text;
  const after =
    target === "board"
      ? boardResult
      : replaceRanges(data[target].text, proposal.replacements ?? []);
  if (after === undefined)
    throw new Error("The board preview could not be prepared.");
  const revision = data[target].revision + 1;
  const artifact =
    target === "board"
      ? { ...data.board, elements: after as BoardElement[], revision }
      : { ...data[target], text: after as string, revision };
  const change: Change = {
    id: proposal.id,
    target,
    summary: proposal.summary,
    before,
    after,
    resultRevision: revision,
    sources: proposal.sources,
  };
  return {
    ...data,
    [target]: artifact,
    changes: [...data.changes, change],
    acceptedOperations: [...data.acceptedOperations, proposal.id],
    references: [
      ...data.references,
      ...proposal.sources.filter(
        (ref) => !data.references.some((r) => r.id === ref.id),
      ),
    ],
    updatedAt: Date.now(),
  };
}

export function undoChange(data: Workspace, id: string): Workspace {
  const change = data.changes.find((c) => c.id === id);
  if (!change || change.undone)
    throw new Error("This change is no longer available to undo.");
  const current =
    change.target === "board" ? data.board.elements : data[change.target].text;
  if (JSON.stringify(current) !== JSON.stringify(change.after))
    throw new Error(
      "This content changed after the AI edit. Review the inverse change before restoring it.",
    );
  const artifact =
    change.target === "board"
      ? {
          ...data.board,
          elements: change.before as BoardElement[],
          revision: data.board.revision + 1,
        }
      : {
          ...data[change.target],
          text: change.before as string,
          revision: data[change.target].revision + 1,
        };
  return {
    ...data,
    [change.target]: artifact,
    changes: data.changes.map((c) =>
      c.id === id ? { ...c, undone: true } : c,
    ),
    updatedAt: Date.now(),
  };
}

// Explicit recovery after reviewing a conflicting undo. Preserve the replaced
// content as a new undoable change so later manual work remains recoverable.
export function restoreChange(
  data: Workspace,
  id: string,
  reviewedRevision: number,
): Workspace {
  const change = data.changes.find((c) => c.id === id && !c.undone);
  if (!change) throw new Error("This change is no longer available.");
  if (data[change.target].revision !== reviewedRevision)
    throw new Error("The content changed since this preview. Review it again.");
  const before =
    change.target === "board" ? data.board.elements : data[change.target].text;
  const revision = reviewedRevision + 1;
  const artifact =
    change.target === "board"
      ? { ...data.board, elements: change.before as BoardElement[], revision }
      : { ...data[change.target], text: change.before as string, revision };
  const inverse: Change = {
    id: crypto.randomUUID(),
    target: change.target,
    summary: `Restore before: ${change.summary}`,
    before,
    after: change.before,
    resultRevision: revision,
    sources: change.sources,
  };
  return {
    ...data,
    [change.target]: artifact,
    changes: [
      ...data.changes.map((c) => (c.id === id ? { ...c, undone: true } : c)),
      inverse,
    ],
    updatedAt: Date.now(),
  };
}

const revisionSchema = z.number().int().nonnegative();
const pointSchema = z.tuple([z.number().finite(), z.number().finite()]);
const bindingSchema = z
  .object({
    elementId: z.string(),
    focus: z.number().optional(),
    gap: z.number().optional(),
    fixedPoint: pointSchema.nullable().optional(),
  })
  .passthrough()
  .nullable();
const elementSchema = z
  .object({
    id: z.string().min(1).max(200),
    type: z.enum([
      "rectangle",
      "ellipse",
      "diamond",
      "text",
      "arrow",
      "line",
      "freedraw",
      "frame",
      "magicframe",
    ]),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
    angle: z.number().finite().optional(),
    strokeColor: z.string().max(100).optional(),
    backgroundColor: z.string().max(100).optional(),
    fillStyle: z.enum(["hachure", "cross-hatch", "solid", "zigzag"]).optional(),
    strokeStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
    strokeWidth: z.number().finite().nonnegative().optional(),
    roughness: z.number().finite().optional(),
    opacity: z.number().min(0).max(100).optional(),
    groupIds: z.array(z.string()).optional(),
    frameId: z.string().nullable().optional(),
    seed: z.number().optional(),
    version: z.number().optional(),
    versionNonce: z.number().optional(),
    isDeleted: z.boolean().optional(),
    locked: z.boolean().optional(),
    updated: z.number().optional(),
    index: z.string().nullable().optional(),
    link: z.string().nullable().optional(),
    boundElements: z
      .array(z.object({ id: z.string(), type: z.enum(["text", "arrow"]) }))
      .nullable()
      .optional(),
    roundness: z
      .object({ type: z.number(), value: z.number().optional() })
      .nullable()
      .optional(),
    points: z.array(pointSchema).max(50000).optional(),
    pressures: z.array(z.number()).max(50000).optional(),
    simulatePressure: z.boolean().optional(),
    lastCommittedPoint: pointSchema.nullable().optional(),
    startBinding: bindingSchema.optional(),
    endBinding: bindingSchema.optional(),
    startArrowhead: z.string().nullable().optional(),
    endArrowhead: z.string().nullable().optional(),
    elbowed: z.boolean().optional(),
    text: z.string().max(200000).optional(),
    originalText: z.string().max(200000).optional(),
    fontSize: z.number().positive().optional(),
    fontFamily: z.number().optional(),
    lineHeight: z.number().positive().optional(),
    textAlign: z.enum(["left", "center", "right"]).optional(),
    verticalAlign: z.enum(["top", "middle", "bottom"]).optional(),
    containerId: z.string().nullable().optional(),
    autoResize: z.boolean().optional(),
    name: z.string().nullable().optional(),
  })
  .passthrough()
  .superRefine((element, ctx) => {
    if (
      ["arrow", "line", "freedraw"].includes(element.type) &&
      !element.points?.length
    )
      ctx.addIssue({ code: "custom", message: "Drawing points are missing." });
    if (element.type === "text" && typeof element.text !== "string")
      ctx.addIssue({ code: "custom", message: "Text is missing." });
  });
const refSchema = z.object({
  id: z.string(),
  tool: z.enum(["board", "code", "notes"]),
  revision: revisionSchema,
  label: z.string(),
  excerpt: z.string().max(250_000),
  ids: z.array(z.string()).optional(),
  from: z.number().optional(),
  to: z.number().optional(),
  runId: z.string().optional(),
});
const runSchema = z.object({
  id: z.string(),
  code: z.string().max(200_000),
  revision: revisionSchema,
  output: z.string().max(100_000),
  status: z.enum([
    "running",
    "success",
    "error",
    "cancelled",
    "timeout",
    "interrupted",
  ]),
  startedAt: z.number(),
  durationMs: z.number(),
  error: z.string().optional(),
  line: z.number().optional(),
});
const snapshotSchema = z.union([
  z.string().max(200_000),
  z.array(elementSchema).max(4000),
]);
const workspaceSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  title: z.string().max(100),
  code: z.object({
    id: z.literal("code"),
    revision: revisionSchema,
    text: z.string().max(200_000),
  }),
  notes: z.object({
    id: z.literal("notes"),
    revision: revisionSchema,
    text: z.string().max(200_000),
  }),
  board: z.object({
    id: z.literal("board"),
    revision: revisionSchema,
    elements: z.array(elementSchema).max(4000),
    viewport: z
      .object({
        scrollX: z.number(),
        scrollY: z.number(),
        zoom: z.number().positive(),
      })
      .optional(),
  }),
  runs: z.array(runSchema).max(100),
  messages: z
    .array(
      z.object({
        id: z.string(),
        role: z.enum(["user", "assistant"]),
        text: z.string().max(200_000),
        sources: z.array(refSchema).optional(),
        status: z.string().optional(),
      }),
    )
    .max(500),
  changes: z
    .array(
      z.object({
        id: z.string(),
        target: z.enum(["board", "code", "notes"]),
        summary: z.string(),
        before: snapshotSchema,
        after: snapshotSchema,
        resultRevision: revisionSchema,
        sources: z.array(refSchema),
        undone: z.boolean().optional(),
      }),
    )
    .max(500),
  references: z.array(refSchema).max(2000),
  acceptedOperations: z.array(z.string()).max(2000),
  updatedAt: z.number(),
});
export function validateWorkspace(value: unknown): Workspace {
  const data = workspaceSchema.parse(value) as Workspace;
  if (
    new Set(data.board.elements.map((e) => e.id)).size !==
    data.board.elements.length
  )
    throw new Error("Drawing IDs must be unique.");
  for (const change of data.changes) {
    if (
      change.target === "board"
        ? !Array.isArray(change.before) || !Array.isArray(change.after)
        : typeof change.before !== "string" || typeof change.after !== "string"
    )
      throw new Error("A change contains invalid document snapshots.");
  }
  return data;
}
export function validateImport(value: unknown): Workspace {
  const data = validateWorkspace(value);
  data.runs = data.runs.map((run) =>
    run.status === "running" ? { ...run, status: "interrupted" } : run,
  );
  data.messages = data.messages.map((m) =>
    m.status === "working" ? { ...m, status: "interrupted" } : m,
  );
  return data;
}
