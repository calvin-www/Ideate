"use client";
import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "../workspace/store";
import { adapters } from "../workspace/adapters";
import { buildBoardPatch } from "../board/adapter";
import {
  applyProposal,
  checkProposal,
  replaceRanges,
  type ArtifactRef,
  type BoardElement,
  type BoardPatch,
  type Message,
  type Proposal,
  type Replacement,
  type Run,
  type Selection,
  type Tool,
  type Workspace,
} from "../workspace/model";
// This module contains only schemas and type-only SDK imports; it has no key,
// provider client, or other server runtime dependency.
import { validateToolCall } from "./server/tools";
import { checkAttention, parseAttention } from "./attention";

export type PendingChange = {
  proposal: Proposal;
  preview: string | BoardElement[];
};
export type VoiceHooks = {
  enabled: () => boolean;
  context: () => Record<string, unknown>;
  play: (speech: string, signal: AbortSignal, change?: PendingChange, action?: () => Promise<unknown>) => Promise<void>;
  clear?: () => void;
};
type Options = {
  voice?: VoiceHooks;
  runCode: () => Promise<Run>;
  stopCode?: () => void;
  onPending: (value: PendingChange | null) => void;
  onError: (message: string) => void;
  onPause?: (message: string) => void;
  request?: typeof fetch;
};
type Call = { id: string; name: string; args: Record<string, unknown> };
type Continuation = { contents: unknown[]; token?: string };
type Resume = { contents: unknown[]; token: string; append: boolean };
type Review = PendingChange & { speech?: string; resolve: (result: unknown) => void };
type Job = {
  voice: boolean;
  taught: boolean;
  id: string;
  controller: AbortController;
  assistantId: string;
  prompt: string;
  messages: Array<{ role: "user" | "assistant"; text: string }>;
  context: Record<string, unknown>;
  sources: ArtifactRef[];
  sourceRevisions: Partial<Record<Tool, number>>;
  review: Review | null;
  results: Map<string, unknown>;
  ownedRunId?: string;
};
class CollaborationError extends Error {}

function endpointError(value: unknown, fallback: string): string {
  // /api/ai emits controlled, sanitized errors. Keep their actionable reason;
  // unexpected HTML/proxy responses still use the local fallback.
  if (
    value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "error"
  ) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message.trim())
      return message.trim().slice(0, 500);
  }
  return fallback;
}

function textExcerpt(text: string, from = 0, to = text.length) {
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

function boardExcerpt(elements: BoardElement[], ids?: string[]) {
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
  const fields = [
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

function makeReference(
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
          : "Notes",
    excerpt: (
      selected?.text ??
      (tool === "board"
        ? data.board.elements
            .filter((element) => !element.isDeleted)
            .map((element) => String(element.text ?? ""))
            .filter(Boolean)
            .join("\n")
        : data[tool].text)
    ).slice(0, 2_000),
    ...(selected?.ids ? { ids: [...selected.ids] } : {}),
    ...(selected?.from !== undefined
      ? { from: selected.from, to: selected.to }
      : {}),
    ...(selected?.runId ? { runId: selected.runId } : {}),
  };
}

function makeTextReadReference(
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

function captureContext(
  data: Workspace,
  view: string,
  selection: Selection | null,
): Record<string, unknown> {
  const relevantRuns = selection?.runId
    ? data.runs.filter((run) => run.id === selection.runId)
    : data.runs.slice(-2);
  return {
    activeTool: view,
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
  };
}

function explicitlyRequestsExecution(prompt: string): boolean {
  if (
    /\b(?:do not|don't|never|without|no need to)\s+(?:run|execute|test)\b/i.test(
      prompt,
    )
  )
    return false;
  // Quoted examples and explanations of execution are not an instruction to
  // execute. Ambiguous wording can still use the explicit Run button.
  const instruction = prompt
    .replace(/`[^`]*`|"[^"]*"|'[^']*'/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  if (
    /\b(?:run through|in your head|mentally|my understanding)\b/.test(
      instruction,
    )
  )
    return false;
  const command = instruction.replace(
    /^(?:please\s+)?(?:(?:can|could|would) you\s+)?(?:please\s+)?/,
    "",
  );
  const directExecution =
    /^(?:(?:run|execute)(?:\s+(?:(?:my|the|this|that)\s+)?(?:(?:python\s+)?(?:code|program|script)|it|this|that|python)\b|[.!?]*$)|test\s+(?:(?:my|the|this|that)\s+)?(?:python\s+)?(?:code|program|script)\b)/;
  if (directExecution.test(command)) return true;
  if (
    !/^(?:implement|write|create|fix|update|change|add|remove)\b/.test(command)
  )
    return false;
  return command
    .split(/\b(?:and|then)\b/)
    .slice(1)
    .some((clause) =>
      directExecution.test(clause.trim().replace(/^please\s+/, "")),
    );
}

export function createCollaborator(options: Options) {
  let active: Job | null = null;
  let suspended: { job: Job; resume: Resume; snapshot: Workspace } | null =
    null;
  const request = options.request ?? fetch;
  const isActive = (job: Job) =>
    active === job &&
    useWorkspace.getState().jobId === job.id &&
    !job.controller.signal.aborted;
  const assertActive = (job: Job) => {
    if (!isActive(job)) throw new DOMException("Stopped", "AbortError");
  };
  const updateAssistant = (job: Job, update: (message: Message) => Message) => {
    if (!isActive(job)) return;
    useWorkspace.getState().setData((data) => ({
      ...data,
      messages: data.messages.map((message) =>
        message.id === job.assistantId ? update(message) : message,
      ),
    }));
  };
  const rememberSource = (
    job: Job,
    tool: Tool,
    data: Workspace,
    ref?: ArtifactRef,
  ) => {
    const source = ref ?? makeReference(data, tool);
    // Saved runs retain their own source snapshot. Editing the live document
    // does not invalidate a reference to an already completed execution.
    if (!source.runId) job.sourceRevisions[tool] = source.revision;
    const sourceIds = JSON.stringify(
      source.ids ? [...source.ids].sort() : undefined,
    );
    const existing = job.sources.find(
      (item) =>
        item.tool === tool &&
        item.revision === source.revision &&
        item.runId === source.runId &&
        item.from === source.from &&
        item.to === source.to &&
        item.excerpt === source.excerpt &&
        JSON.stringify(item.ids ? [...item.ids].sort() : undefined) ===
          sourceIds,
    );
    if (!existing) job.sources = [...job.sources, source];
    updateAssistant(job, (message) => ({
      ...message,
      sources: [...job.sources],
    }));
    return existing ?? source;
  };

  async function executeRun(job: Job, revision: number): Promise<unknown> {
    assertActive(job);
    const current = useWorkspace.getState().data;
    if (current.code.revision !== revision)
      return {
        status: "conflicted",
        message:
          "The code revision changed. Read the current code before requesting a run.",
      };
    if (current.runs.some((run) => run.status === "running"))
      return {
        status: "unavailable",
        message: "A program is already running.",
      };
    useWorkspace.setState({
      activity: "Running the approved Python revision…",
    });
    try {
      const existingIds = new Set(current.runs.map((run) => run.id));
      const running = options.runCode();
      job.ownedRunId = useWorkspace
        .getState()
        .data.runs.find(
          (run) => !existingIds.has(run.id) && run.status === "running",
        )?.id;
      const run = await running;
      assertActive(job);
      if (run.revision !== revision)
        return {
          status: "error",
          message: "The runtime returned a different source revision.",
        };
      const output = textExcerpt(run.output, 0, 8_000);
      const source = makeTextReadReference(
        useWorkspace.getState().data,
        "code",
        output,
        run,
      );
      const reference = rememberSource(
        job,
        "code",
        useWorkspace.getState().data,
        source,
      );
      return {
        ...run,
        code: run.code.slice(0, 20_000),
        output: output.text,
        outputTruncated: output.truncated,
        source: reference,
      };
    } catch {
      assertActive(job);
      return {
        status: "error",
        message:
          "Python could not complete this run. Check the runtime and try again.",
      };
    } finally {
      job.ownedRunId = undefined;
    }
  }

  async function stage(job: Job, call: Call, speech?: string): Promise<unknown> {
    assertActive(job);
    const data = useWorkspace.getState().data;
    const target = (
      call.name === "link_artifacts"
        ? call.args.target
        : call.name.replace("edit_", "")
    ) as Tool;
    if (call.name === "link_artifacts" && target !== "notes")
      return {
        status: "unsupported",
        message:
          "Source links can currently be added to notes. Propose target notes to create a visible, reviewed link.",
      };
    let linkSources: ArtifactRef[] | undefined;
    if (call.name === "link_artifacts") {
      linkSources = (call.args.sourceIds as string[])
        .map((id) => {
          const ref = [...job.sources, ...data.references].find(
            (item) => item.id === id,
          );
          if (ref) return ref;
          if (id === "board" || id === "code" || id === "notes")
            return (
              job.sources.find(
                (item) =>
                  item.tool === id &&
                  item.revision === data[id].revision &&
                  !item.runId,
              ) ?? makeReference(data, id)
            );
          const run = data.runs.find((item) => item.id === id);
          if (run)
            return makeReference(data, "code", {
              tool: "code",
              revision: run.revision,
              text: run.output.slice(0, 2_000),
              runId: id,
            });
          return undefined;
        })
        .filter((ref): ref is ArtifactRef => Boolean(ref));
      if (linkSources.length !== (call.args.sourceIds as string[]).length)
        return {
          status: "not_found",
          message:
            "A source reference does not exist. Use source IDs provided in the workspace or read results.",
        };
    }
    const links = linkSources
      ?.map(
        (ref) =>
          `- [${ref.label} · revision ${ref.revision}](#source:${ref.id})`,
      )
      .join("\n");
    const proposal: Proposal = {
      id: call.id,
      jobId: job.id,
      target,
      baseRevision:
        call.name === "link_artifacts"
          ? data[target].revision
          : Number(call.args.baseRevision),
      summary: String(call.args.summary),
      sources: linkSources ?? [...job.sources],
      sourceRevisions: { ...job.sourceRevisions },
      ...(target === "board"
        ? {
            boardPatch: {
              additions: call.args.additions,
              updates: call.args.updates,
              deleteIds: call.args.deleteIds,
            } as BoardPatch,
          }
        : {
            replacements: links
              ? [
                  {
                    from: data.notes.text.length,
                    to: data.notes.text.length,
                    text: `\n\n### Sources\n\n${links}\n`,
                  },
                ]
              : (call.args.replacements as Replacement[]),
          }),
    };
    try {
      checkProposal(data, proposal, job.id);
      const preview =
        target === "board"
          ? await buildBoardPatch(data.board.elements, proposal.boardPatch!)
          : replaceRanges(data[target].text, proposal.replacements!);
      assertActive(job);
      checkProposal(useWorkspace.getState().data, proposal, job.id);
      if (useWorkspace.getState().autoApplyChanges) {
        return await new Promise((resolve) => {
          job.review = { proposal, preview, speech, resolve };
          void approve();
        });
      }
      useWorkspace.setState({
        activity: `Review the proposed ${target === "code" ? "Python" : target} change`,
      });
      return await new Promise((resolve) => {
        job.review = { proposal, preview, speech, resolve };
        options.onPending({ proposal, preview });
      });
    } catch {
      assertActive(job);
      return {
        status: "conflicted",
        message:
          "The document, referenced source, or proposal is no longer valid. Read the current artifact and propose a fresh change.",
      };
    }
  }

  async function executeCall(job: Job, call: Call): Promise<unknown> {
    assertActive(job);
    if (job.results.has(call.id)) return job.results.get(call.id);
    const args = validateToolCall(call.name, call.args);
    if (!args)
      return {
        status: "error",
        message: "The operation arguments are invalid.",
      };
    call.args = args;
    if (call.name === "teach_step") {
      const speech = String(args.speech);
      const operation = args.operation as { name: string; args: Record<string, unknown> } | undefined;
      job.taught = true;
      updateAssistant(job, (message) => ({ ...message, text: [message.text, speech].filter(Boolean).join("\n\n") }));
      let result: unknown;
      if (operation?.name.startsWith("edit_")) {
        result = await stage(job, { id: call.id, ...operation }, job.voice ? speech : undefined);
      } else if (job.voice && options.voice) {
        let actionResult: unknown;
        await options.voice.play(speech, job.controller.signal, undefined, operation ? async () => {
          actionResult = await executeCall(job, { id: `${call.id}:action`, ...operation });
        } : undefined);
        assertActive(job);
        result = operation ? actionResult : { status: "spoken" };
      } else result = operation ? await executeCall(job, { id: `${call.id}:action`, ...operation }) : { status: "shown" };
      assertActive(job);
      job.results.set(call.id, result);
      return result;
    }
    const data = useWorkspace.getState().data;
    let result: unknown;
    if (call.name === "show_attention") {
      const cue = parseAttention(args)!;
      const status = checkAttention(data, cue);
      if (status) {
        result = {
          status,
          message:
            "That target changed or is unavailable. Read the current artifact before pointing again.",
        };
      } else {
        const state = useWorkspace.getState();
        useWorkspace.setState({
          attention: {
            ...state.attention,
            [cue.target]: {
              ...cue,
              id: call.id,
              jobId: job.id,
              workspaceId: data.id,
            },
          },
        });
        result = {
          status: "shown",
          target: cue.target,
          visible: state.view !== "desk" && (state.view === cue.target || state.visibleTools.includes(cue.target)),
          message:
            "Cue set without editing. If the target domain is hidden, the student can use Show in chat.",
        };
      }
    } else if (call.name === "clear_attention") {
      useWorkspace.getState().clearAttention(args.target as Tool | undefined);
      result = { status: "cleared" };
    } else if (call.name === "read_code" || call.name === "read_notes") {
      const tool = call.name === "read_code" ? "code" : "notes";
      const range = textExcerpt(
        data[tool].text,
        args.from as number | undefined,
        args.to as number | undefined,
      );
      const source = rememberSource(
        job,
        tool,
        data,
        makeTextReadReference(data, tool, range),
      );
      result = { id: tool, revision: data[tool].revision, ...range, source };
    } else if (call.name === "read_board") {
      const excerpt = boardExcerpt(
        data.board.elements,
        args.ids as string[] | undefined,
      );
      const source = rememberSource(job, "board", data, {
        ...makeReference(data, "board"),
        ids: excerpt.elements.map((element) => String(element.id)),
        excerpt: excerpt.elements
          .map((element) => String(element.text ?? element.type))
          .join("\n"),
      });
      result = {
        id: "board",
        revision: data.board.revision,
        ...excerpt,
        source,
      };
    } else if (call.name === "read_run") {
      const run = data.runs.find((item) => item.id === args.id);
      if (run) {
        const output = textExcerpt(
          run.output,
          args.from as number | undefined,
          Math.min(
            Number(args.to ?? run.output.length),
            Number(args.from ?? 0) + 8_000,
          ),
        );
        const source = rememberSource(
          job,
          "code",
          data,
          makeTextReadReference(data, "code", output, run),
        );
        result = { ...run, code: run.code.slice(0, 20_000), output, source };
      } else
        result = {
          status: "not_found",
          message: "That saved run does not exist.",
        };
    } else if (
      call.name.startsWith("edit_") ||
      call.name === "link_artifacts"
    ) {
      result = await stage(job, call);
    } else if (call.name === "run_python") {
      result = explicitlyRequestsExecution(job.prompt)
        ? await executeRun(job, Number(args.revision))
        : {
            status: "not_authorized",
            message:
              "The student did not request execution. Explain or propose code only; do not claim a run occurred.",
          };
    } else
      result = { status: "error", message: "This operation is unavailable." };
    job.results.set(call.id, result);
    return result;
  }

  async function modelRound(
    job: Job,
    continuation?: Continuation,
    toolResults?: unknown[],
    resume?: Resume,
  ) {
    assertActive(job);
    useWorkspace.setState({ activity: "Thinking through your workspace…" });
    const response = await request("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: job.controller.signal,
      body: JSON.stringify({
        messages: job.messages,
        context: job.context,
        ...(continuation ? { continuation, toolResults } : {}),
        ...(resume ? { resume } : {}),
      }),
    });
    assertActive(job);
    if (!response.ok) {
      const fallback =
        response.status === 429
          ? "Gemini is at its request limit. Wait a moment and try again."
          : response.status === 503
            ? "Gemini is unavailable. Check the server configuration and try again."
            : "Gemini could not finish this request. Your work is preserved; try again.";
      const failure: unknown = await response.json().catch(() => undefined);
      throw new CollaborationError(endpointError(failure, fallback));
    }
    if (!response.body)
      throw new CollaborationError(
        "The AI response was empty. Please try again.",
      );
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const calls: Call[] = [];
    const prefix =
      useWorkspace
        .getState()
        .data.messages.find((message) => message.id === job.assistantId)
        ?.text ?? "";
    let displayIds = [job.assistantId];
    let roundText = "";
    let buffer = "",
      next: Continuation | undefined,
      paused: { resume: Resume; message: string } | undefined,
      bytes = 0;
    const display = () => {
      assertActive(job);
      const text =
        prefix +
        (prefix && roundText && !resume?.append ? "\n\n" : "") +
        roundText;
      // Repeated explicit continuations can outgrow the persisted 200,000-char
      // message limit. Split display records with room for status text; retain
      // their IDs so a discarded attempt can still roll back just this round.
      const chunks: string[] = [];
      for (let from = 0; from < text.length; ) {
        let to = Math.min(from + 180_000, text.length);
        if (to < text.length && /[\uD800-\uDBFF]/.test(text[to - 1])) to--;
        chunks.push(text.slice(from, to));
        from = to;
      }
      if (!chunks.length) chunks.push("");
      while (displayIds.length < chunks.length)
        displayIds.push(crypto.randomUUID());
      const previousIds = new Set(displayIds);
      const nextIds = displayIds.slice(0, chunks.length);
      useWorkspace.getState().setData((data) => {
        const original = data.messages.find(
          (message) => message.id === displayIds[0],
        )!;
        const messages = chunks.map((chunk, index) => ({
          ...original,
          id: nextIds[index],
          text: chunk,
          status: index === chunks.length - 1 ? "working" : "complete",
        }));
        return {
          ...data,
          messages: data.messages.flatMap((message) =>
            message.id === displayIds[0]
              ? messages
              : previousIds.has(message.id)
                ? []
                : [message],
          ),
        };
      });
      displayIds = nextIds;
      job.assistantId = nextIds.at(-1)!;
    };
    const consume = (line: string) => {
      if (!line.trim()) return;
      assertActive(job);
      const event = JSON.parse(line) as Record<string, unknown>;
      if (next || paused)
        throw new CollaborationError(
          "The AI response continued after finishing. Please try again.",
        );
      if (event.type === "text" && typeof event.text === "string") {
        roundText += event.text;
        display();
      } else if (event.type === "replace" && typeof event.text === "string") {
        roundText = event.text;
        display();
      } else if (event.type === "status" && typeof event.message === "string") {
        useWorkspace.setState({ activity: event.message.slice(0, 200) });
      } else if (
        event.type === "paused" &&
        typeof event.message === "string" &&
        event.resume &&
        typeof event.resume === "object" &&
        Array.isArray((event.resume as Resume).contents) &&
        typeof (event.resume as Resume).token === "string" &&
        typeof (event.resume as Resume).append === "boolean"
      ) {
        if (calls.length)
          throw new CollaborationError(
            "An unfinished operation cannot be applied.",
          );
        paused = {
          resume: event.resume as Resume,
          message: event.message.slice(0, 500),
        };
      } else if (
        event.type === "call" &&
        typeof event.id === "string" &&
        typeof event.name === "string"
      ) {
        if (calls.length >= 12)
          throw new CollaborationError(
            "Gemini requested too many operations. Try a smaller step.",
          );
        const args = validateToolCall(event.name, event.args);
        if (!args || calls.some((call) => call.id === event.id))
          throw new CollaborationError(
            "Gemini proposed an invalid operation. Please try again.",
          );
        calls.push({ id: event.id, name: event.name, args });
      } else if (
        event.type === "done" &&
        event.continuation &&
        Array.isArray((event.continuation as Continuation).contents)
      )
        next = event.continuation as Continuation;
      else if (event.type === "error")
        throw new CollaborationError(
          endpointError(
            event,
            "Gemini could not finish this step. Your existing work is preserved; try again.",
          ),
        );
      else
        throw new CollaborationError(
          "The AI response was invalid. Please try again.",
        );
    };
    try {
      while (true) {
        const item = await reader.read();
        assertActive(job);
        if (item.done) break;
        bytes += item.value.byteLength;
        if (bytes > 6 * 1024 * 1024)
          throw new CollaborationError(
            "The AI response was too large. Try a smaller step.",
          );
        buffer += decoder.decode(item.value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          consume(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
        }
      }
      buffer += decoder.decode();
      consume(buffer);
      if (!next && !paused)
        throw new CollaborationError(
          "The AI response was interrupted. Please try again.",
        );
      return { calls, continuation: next, paused };
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  async function ask(prompt: string): Promise<void> {
    const initial = useWorkspace.getState();
    const text = prompt.trim();
    if (!text || initial.jobId) return;
    if (text.length > 24_000) {
      options.onError("Try a shorter question.");
      return;
    }
    options.onError("");
    options.onPending(null);
    suspended?.job.controller.abort();
    suspended = null;
    options.onPause?.("");
    const selection = initial.selection
      ? structuredClone(initial.selection)
      : null;
    const source = makeReference(
      initial.data,
      selection?.tool ?? (initial.view === "desk" ? "code" : initial.view),
      selection,
    );
    const sources = [
      source,
      ...(["board", "code", "notes"] as const)
        .filter((tool) => tool !== source.tool || source.runId)
        .map((tool) => makeReference(initial.data, tool)),
    ];
    const job: Job = {
      voice: options.voice?.enabled() ?? false,
      taught: false,
      id: crypto.randomUUID(),
      controller: new AbortController(),
      assistantId: crypto.randomUUID(),
      prompt: text,
      messages: [
        ...initial.data.messages
          .filter(
            (message) => message.text.trim() && message.status !== "working",
          )
          .slice(-7)
          .map(({ role, text }) => ({ role, text: text.slice(-24_000) })),
        { role: "user", text },
      ],
      context: structuredClone({
        voiceMode: options.voice?.enabled() ?? false,
        ...(options.voice?.enabled() ? { voiceDelivery: options.voice.context() } : {}),
        ...captureContext(initial.data, initial.view, selection),
        editPolicy: initial.autoApplyChanges ? "auto-apply" : "review",
        sources,
      }),
      sources,
      sourceRevisions: {
        board: initial.data.board.revision,
        code: initial.data.code.revision,
        notes: initial.data.notes.revision,
        ...(source.runId ? {} : { [source.tool]: source.revision }),
      },
      review: null,
      results: new Map(),
    };
    active = job;
    useWorkspace.setState({
      attention: {},
      jobId: job.id,
      activity: "Reading your workspace…",
      chatOpen: true,
    });
    initial.setData((data) => ({
      ...data,
      messages: [
        ...data.messages,
        { id: crypto.randomUUID(), role: "user", text, sources },
        {
          id: job.assistantId,
          role: "assistant",
          text: "",
          sources,
          status: "working",
        },
      ],
    }));
    await runJob(job, undefined, async () => {
      if (
        (initial.view === "board" || selection?.tool === "board") &&
        adapters.board?.image
      ) {
        const image = await adapters.board.image().catch(() => undefined);
        assertActive(job);
        if (
          image &&
          image.length < 2 * 1024 * 1024 &&
          useWorkspace.getState().data.board.revision ===
            initial.data.board.revision
        )
          job.context.boardImage = image;
      }
    });
  }

  async function runJob(
    job: Job,
    resume?: Resume,
    prepare?: () => Promise<void>,
  ): Promise<void> {
    try {
      await prepare?.();
      let continuation: Continuation | undefined,
        results: unknown[] | undefined;
      // The ninth exchange lets the server pause at its eight-round limit
      // after receiving the final tool results, without generating more output.
      for (let round = 0; round < 9; round++) {
        const response = await modelRound(
          job,
          continuation,
          results,
          round === 0 ? resume : undefined,
        );
        assertActive(job);
        if (response.paused) {
          suspended = {
            job,
            resume: response.paused.resume,
            snapshot: useWorkspace.getState().data,
          };
          updateAssistant(job, (message) => ({ ...message, status: "paused" }));
          options.onPause?.(response.paused.message);
          return;
        }
        if (response.calls.length === 0) {
          if (job.voice && !job.taught && options.voice) {
            const answer = useWorkspace.getState().data.messages.find((message) => message.id === job.assistantId)?.text;
            if (answer?.trim()) await options.voice.play(answer.slice(0, 1200), job.controller.signal);
          }
          break;
        }
        continuation = response.continuation;
        results = [];
        for (const call of response.calls) {
          assertActive(job);
          const result = await executeCall(job, call);
          assertActive(job);
          results.push({ id: call.id, name: call.name, result });
        }
        if (round === 8)
          updateAssistant(job, (message) => ({
            ...message,
            text:
              message.text +
              "\n\nI reached the limit for this request. Your accepted changes are saved. Ask me to continue with the next step.",
          }));
      }
      updateAssistant(job, (message) => ({
        ...message,
        status: "complete",
        text:
          message.text ||
          "The requested step is ready. Review any changes above.",
      }));
    } catch (error) {
      if (isActive(job)) {
        useWorkspace.getState().clearAttention();
        const message =
          error instanceof CollaborationError
            ? error.message
            : "The AI request could not finish. Your workspace is preserved; please try again.";
        options.onError(message);
        updateAssistant(job, (current) => ({
          ...current,
          status: "failed",
          text: current.text || message,
        }));
      }
    } finally {
      if (active === job) options.voice?.clear?.();
      if (active === job) {
        if (useWorkspace.getState().jobId === job.id)
          useWorkspace.setState({ jobId: null, activity: "" });
        job.review?.resolve({ status: "interrupted" });
        job.review = null;
        options.onPending(null);
        active = null;
      }
    }
  }

  async function resume(): Promise<void> {
    const paused = suspended;
    const state = useWorkspace.getState();
    if (!paused || active || state.jobId) return;
    suspended = null;
    options.onPause?.("");
    if (
      paused.job.controller.signal.aborted ||
      !state.data.messages.some(
        (message) => message.id === paused.job.assistantId,
      ) ||
      (["board", "code", "notes"] as const).some(
        (tool) => state.data[tool] !== paused.snapshot[tool],
      )
    ) {
      paused.job.controller.abort();
      options.onError(
        "Your workspace changed while paused. Send a new request to use the current context.",
      );
      return;
    }
    active = paused.job;
    useWorkspace.setState({
      jobId: active.id,
      activity: "Continuing the response…",
    });
    options.onError("");
    updateAssistant(active, (message) => ({ ...message, status: "working" }));
    await runJob(active, paused.resume);
  }

  async function approve(runAfter = false): Promise<void> {
    const job = active,
      review = job?.review;
    if (!job || !review || !isActive(job)) return;
    job.review = null;
    options.onPending(null);
    options.onError("");
    try {
      const state = useWorkspace.getState();
      checkProposal(state.data, review.proposal, state.jobId);
      if (review.speech && options.voice) {
        try {
          await options.voice.play(review.speech, job.controller.signal, review);
        } catch (error) {
          review.resolve({ status: "cancelled", message: "Speech or writing was interrupted. This step was not applied." });
          if (isActive(job)) {
            options.onError(error instanceof Error && error.name !== "AbortError" ? error.message : "Writing paused. Completed changes are saved.");
            cancel();
          }
          return;
        }
        assertActive(job);
        checkProposal(useWorkspace.getState().data, review.proposal, job.id);
      }
      {
        const next = applyProposal(
          useWorkspace.getState().data,
          review.proposal,
          state.jobId,
          Array.isArray(review.preview) ? review.preview : undefined,
        );
        state.setData(() => next);
        options.voice?.clear?.();
        const revision = next[review.proposal.target].revision;
        if (job.sourceRevisions[review.proposal.target] !== undefined)
          job.sourceRevisions[review.proposal.target] = revision;
        let run: unknown;
        if (runAfter && review.proposal.target === "code")
          run = await executeRun(job, revision);
        assertActive(job);
        review.resolve({
          status: "accepted",
          target: review.proposal.target,
          revision,
          operationId: review.proposal.id,
          ...(run ? { run } : {}),
        });
      }
    } catch {
      options.voice?.clear?.();
      if (isActive(job))
        options.onError(
          "The document or source context changed. Your manual edits were preserved; ask for a fresh proposal.",
        );
      review.resolve({
        status: isActive(job) ? "conflicted" : "cancelled",
        message: "This proposal could not be applied to the current workspace.",
      });
    }
  }

  function reject(): void {
    const job = active,
      review = job?.review;
    if (!job || !review || !isActive(job)) return;
    job.review = null;
    options.onPending(null);
    review.resolve({
      status: "rejected",
      message:
        "The student rejected the proposed change. No change was applied.",
    });
  }

  function cancel(): void {
    options.voice?.clear?.();
    suspended?.job.controller.abort();
    suspended = null;
    options.onPause?.("");
    const job = active;
    if (!job) return;
    const state = useWorkspace.getState();
    state.clearAttention();
    job.controller.abort();
    if (
      job.ownedRunId &&
      state.data.runs.some(
        (run) => run.id === job.ownedRunId && run.status === "running",
      )
    )
      options.stopCode?.();
    job.review?.resolve({ status: "cancelled" });
    job.review = null;
    if (state.jobId === job.id) {
      state.setData((data) => ({
        ...data,
        messages: data.messages.map((message) =>
          message.id === job.assistantId
            ? {
                ...message,
                status: "cancelled",
                text: message.text || "Stopped. No pending change was applied.",
              }
            : message,
        ),
      }));
      useWorkspace.setState({ jobId: null, activity: "" });
    }
    options.onPending(null);
    active = null;
  }
  function clearHistory(): void {
    cancel();
    const state = useWorkspace.getState();
    state.clearAttention();
    state.setData((data) => ({ ...data, messages: [], updatedAt: Date.now() }));
    options.onPending(null);
    options.onError("");
  }
  return { ask, resume, approve, reject, cancel, clearHistory };
}

export function useCollaborator(
  runCode: () => Promise<Run>,
  stopCode?: () => void,
  voice?: VoiceHooks,
) {
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [error, setError] = useState("");
  const [paused, setPaused] = useState("");
  const execution = useRef({ runCode, stopCode });
  execution.current = { runCode, stopCode };
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const controller = useRef<ReturnType<typeof createCollaborator> | null>(null);
  if (!controller.current)
    controller.current = createCollaborator({
      voice: {
        enabled: () => voiceRef.current?.enabled() ?? false,
        context: () => voiceRef.current?.context() ?? {},
        play: (...args) => voiceRef.current?.play(...args) ?? Promise.resolve(),
        clear: () => voiceRef.current?.clear?.(),
      },
      runCode: () => execution.current.runCode(),
      stopCode: () => execution.current.stopCode?.(),
      onPending: setPending,
      onError: setError,
      onPause: setPaused,
    });
  useEffect(() => {
    const current = controller.current;
    return () => current?.cancel();
  }, []);
  return { ...controller.current, pending, error, paused };
}
