"use client";
import { useEffect, useRef, useState } from "react";
import { DefaultChatTransport, type UIMessageChunk } from "ai";
import { useWorkspace } from "../workspace/store";
import { workspaceCommands } from "../workspace/commands";
import { presentTeachingStep, type TeachingStep } from "../workspace/teachingPresentation";
import { adapters } from "../workspace/adapters";
import { parseSheet, serializeSheet, patchSheet, type CellUpdate } from "../spreadsheet/sheet";
import {
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
import { parseOperation, type Operation } from "./contracts";
import { checkAttention, parseAttention } from "./attention";
import { aiHeaders, useProviderKeys } from "../settings/providerKeys";
import { boardExcerpt, captureContext, makeReference, makeTextReadReference, spreadsheetExcerpt, spreadsheetSource, textExcerpt } from "./context";

export type PendingChange = {
  proposal: Proposal;
  preview: string | BoardElement[];
};
export type VoiceHooks = {
  enabled: () => boolean;
  context: () => Record<string, unknown>;
  narrate: (id: string, text: string, signal: AbortSignal) => Promise<void> | void;
  clear?: (jobId?: string) => void;
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
type Call = Operation & { id: string };
type EditCall = Extract<Call, { name: "edit_code" | "edit_notes" | "edit_spreadsheet" | "edit_board" | "link_artifacts" }>;
function isEditCall(call: Call): call is EditCall {
  return ["edit_code", "edit_notes", "edit_spreadsheet", "edit_board", "link_artifacts"].includes(call.name);
}
type Checkpoint = { token: string; state: string };
type Resume = { checkpoint: Checkpoint; append: boolean };
type Review = PendingChange & { teaching?: Pick<TeachingStep, "id" | "text">; resolve: (result: unknown) => void };
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

function* spokenParts(text: string) {
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + 1200);
    if (end < text.length) {
      const section = text.slice(start, end);
      const sentence = [...section.matchAll(/[.!?]\s+/g)].at(-1);
      if (sentence) end = start + sentence.index + sentence[0].length;
      else {
        const space = section.lastIndexOf(" ");
        if (space > 0) end = start + space + 1;
      }
    }
    yield text.slice(start, end);
    start = end;
  }
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readCheckpoint(value: unknown): Checkpoint | null {
  if (!isRecord(value)) return null;
  if (typeof value.token !== "string" || !value.token || value.token.length > 200)
    return null;
  if (typeof value.state !== "string" || !value.state || value.state.length > 6 * 1024 * 1024)
    return null;
  return { token: value.token, state: value.state };
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

  async function stage(job: Job, call: EditCall, teaching?: Pick<TeachingStep, "id" | "text">): Promise<unknown> {
    assertActive(job);
    const data = useWorkspace.getState().data;
    let linkSources: ArtifactRef[] | undefined;
    if (call.name === "link_artifacts") {
      linkSources = call.args.sourceIds
        .map((id) => {
          const ref = [...job.sources, ...data.references].find(
            (item) => item.id === id,
          );
          if (ref) return ref;
          if (id === "board" || id === "code" || id === "notes" || id === "spreadsheet")
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
      if (linkSources.length !== call.args.sourceIds.length)
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
    try {
      const common = {
        id: call.id,
        jobId: job.id,
        sources: linkSources ?? [...job.sources],
        sourceRevisions: { ...job.sourceRevisions },
      };
      let proposal: Proposal;
      if (call.name === "edit_board") {
        proposal = {
          ...common,
          target: "board",
          baseRevision: call.args.baseRevision,
          summary: call.args.summary,
          boardPatch: {
            additions: call.args.additions,
            updates: call.args.updates,
            deleteIds: call.args.deleteIds,
          },
        };
      } else if (call.name === "edit_spreadsheet") {
        proposal = {
          ...common,
          target: "spreadsheet",
          baseRevision: call.args.baseRevision,
          summary: call.args.summary,
          replacements: [{
            from: 0,
            to: data.spreadsheet.text.length,
            text: serializeSheet(patchSheet(parseSheet(data.spreadsheet.text), call.args.updates)),
          }],
        };
      } else if (call.name === "link_artifacts") {
        proposal = {
          ...common,
          target: "notes",
          baseRevision: data.notes.revision,
          summary: call.args.summary,
          replacements: [{
            from: data.notes.text.length,
            to: data.notes.text.length,
            text: `\n\n### Sources\n\n${links}\n`,
          }],
        };
      } else {
        proposal = {
          ...common,
          target: call.name === "edit_code" ? "code" : "notes",
          baseRevision: call.args.baseRevision,
          summary: call.args.summary,
          replacements: call.args.replacements,
        };
      }
      const { preview } = await workspaceCommands.propose(proposal);
      assertActive(job);
      workspaceCommands.check({ proposal, preview });
      if (useWorkspace.getState().autoApplyChanges) {
        return await new Promise((resolve) => {
          job.review = { proposal, preview, teaching, resolve };
          void approve();
        });
      }
      useWorkspace.setState({
        activity: `Review the proposed ${proposal.target === "code" ? "Python" : proposal.target} change`,
      });
      return await new Promise((resolve) => {
        job.review = { proposal, preview, teaching, resolve };
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
    const parsed = parseOperation(call.name, call.args);
    if (!parsed)
      return {
        status: "error",
        message: "The operation arguments are invalid.",
      };
    call = { id: call.id, ...parsed };
    if (call.name === "teach_step") {
      const { text, operation } = call.args;
      const nested: Call | undefined = operation ? { id: call.id, ...operation } : undefined;
      job.taught = true;
      updateAssistant(job, (message) => ({ ...message, text: [message.text, text].filter(Boolean).join("\n\n") }));
      let result: unknown;
      if (nested && isEditCall(nested)) {
        result = await stage(job, nested, { id: call.id, text });
      } else {
        await presentTeachingStep(
          { id: call.id, text },
          job.controller.signal,
          job.voice ? options.voice?.narrate : undefined,
        );
        assertActive(job);
        result = operation ? await executeCall(job, { id: `${call.id}:action`, ...operation }) : { status: "shown" };
      }
      assertActive(job);
      job.results.set(call.id, result);
      return result;
    }
    const data = useWorkspace.getState().data;
    let result: unknown;
    if (call.name === "show_attention") {
      const cue = parseAttention(call.args)!;
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
          visible: state.view !== "desk" && state.visibleTools.includes(cue.target),
          message:
            "Cue set without editing. If the target domain is hidden, the student can use Show in chat.",
        };
      }
    } else if (call.name === "clear_attention") {
      useWorkspace.getState().clearAttention(call.args.target);
      result = { status: "cleared" };
    } else if (call.name === "read_spreadsheet") {
      const excerpt = spreadsheetExcerpt(data.spreadsheet.text, call.args.fromRow, call.args.toRow, false, call.args.afterAddress);
      const source = rememberSource(job, "spreadsheet", data, {
        ...makeReference(data, "spreadsheet"),
        ids: excerpt.cells.map(cell => cell.address),
        excerpt: spreadsheetSource(excerpt),
      });
      result = { id: "spreadsheet", revision: data.spreadsheet.revision, ...excerpt, source };
    } else if (call.name === "read_code" || call.name === "read_notes") {
      const tool = call.name === "read_code" ? "code" : "notes";
      const range = textExcerpt(
        data[tool].text,
        call.args.from,
        call.args.to,
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
        call.args.ids,
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
      const run = data.runs.find((item) => item.id === call.args.id);
      if (run) {
        const output = textExcerpt(
          run.output,
          call.args.from,
          Math.min(
            call.args.to ?? run.output.length,
            (call.args.from ?? 0) + 8_000,
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
    } else if (isEditCall(call)) {
      if (job.voice) job.taught = true;
      result = await stage(job, call, job.voice ? { id: call.id, text: call.args.summary } : undefined);
    } else if (call.name === "run_python") {
      result = explicitlyRequestsExecution(job.prompt)
        ? await executeRun(job, call.args.revision)
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
    continuation?: Checkpoint,
    toolResults?: unknown[],
    resume?: Resume,
  ) {
    assertActive(job);
    useWorkspace.setState({ activity: "Thinking through your workspace…" });
    const body = resume
      ? { type: "continue", checkpoint: resume.checkpoint }
      : continuation
        ? { type: "results", checkpoint: continuation, results: toolResults ?? [] }
        : { type: "start", messages: job.messages, context: job.context };
    const transport = new DefaultChatTransport({
      api: "/api/ai",
      headers: () => aiHeaders(useProviderKeys.getState().keys),
      prepareSendMessagesRequest: () => ({ body }),
      fetch: async (input, init) => {
        const response = await request(input, init);
        if (!response.ok || !response.body) return response;
        let bytes = 0;
        const limited = response.body.pipeThrough(new TransformStream({
          transform(chunk: Uint8Array, output) {
            bytes += chunk.byteLength;
            if (bytes > 6 * 1024 * 1024)
              throw new CollaborationError("The AI response was too large. Try a smaller step.");
            output.enqueue(chunk);
          },
        }));
        return new Response(limited, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      },
    });
    let stream: ReadableStream<UIMessageChunk>;
    try {
      // The transport owns SSE decoding; the persisted chat still belongs to Zustand.
      stream = await transport.sendMessages({
        trigger: "submit-message",
        chatId: job.id,
        messageId: undefined,
        messages: [],
        abortSignal: job.controller.signal,
      });
    } catch (error) {
      if (!isRecord(error) || typeof error.statusCode !== "number") throw error;
      const fallback = error.statusCode === 429
        ? "Gemini is at its request limit. Wait a moment and try again."
        : error.statusCode === 503
          ? "Gemini is unavailable. Check your API key in Settings and try again."
          : "Gemini could not finish this request. Your work is preserved; try again.";
      let failure: unknown;
      try {
        failure = JSON.parse(String(error.responseBody));
      } catch {
        failure = undefined;
      }
      throw new CollaborationError(endpointError(failure, fallback));
    }
    assertActive(job);
    const calls: Call[] = [];
    const prefix =
      useWorkspace
        .getState()
        .data.messages.find((message) => message.id === job.assistantId)
        ?.text ?? "";
    let displayIds = [job.assistantId];
    let roundText = "";
    let next: Checkpoint | undefined,
      paused: { resume: Resume; message: string } | undefined,
      done = false;
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
        const messages: Message[] = chunks.map((chunk, index) => ({
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
    const consume = (event: UIMessageChunk) => {
      assertActive(job);
      if (next || paused || done) {
        if (event.type === "text-end" || event.type === "finish") return;
        throw new CollaborationError(
          "The AI response continued after finishing. Please try again.",
        );
      }
      if (event.type === "start" || event.type === "text-start" || event.type === "text-end" || event.type === "finish")
        return;
      if (event.type === "text-delta") {
        roundText += event.delta;
        display();
      } else if (event.type === "data-replace" && isRecord(event.data) && typeof event.data.text === "string") {
        roundText = event.data.text;
        display();
      } else if (event.type === "data-status" && isRecord(event.data) && typeof event.data.message === "string") {
        useWorkspace.setState({ activity: event.data.message.slice(0, 200) });
      } else if (
        event.type === "data-paused" &&
        isRecord(event.data) &&
        typeof event.data.message === "string" &&
        typeof event.data.append === "boolean" &&
        readCheckpoint(event.data.checkpoint)
      ) {
        paused = {
          resume: {
            checkpoint: readCheckpoint(event.data.checkpoint)!,
            append: event.data.append,
          },
          message: event.data.message.slice(0, 500),
        };
      } else if (
        event.type === "data-operationBatch" &&
        isRecord(event.data) &&
        Array.isArray(event.data.operations) &&
        readCheckpoint(event.data.checkpoint)
      ) {
        if (!event.data.operations.length || event.data.operations.length > 12)
          throw new CollaborationError(
            "Gemini requested too many operations. Try a smaller step.",
          );
        for (const value of event.data.operations) {
          if (!isRecord(value) || typeof value.id !== "string" || !value.id || value.id.length > 200 || !isRecord(value.operation))
            throw new CollaborationError("Gemini proposed an invalid operation. Please try again.");
          const operation = parseOperation(String(value.operation.name), value.operation.args);
          if (!operation || calls.some((call) => call.id === value.id))
            throw new CollaborationError("Gemini proposed an invalid operation. Please try again.");
          calls.push({ id: value.id, ...operation });
        }
        next = readCheckpoint(event.data.checkpoint)!;
      } else if (event.type === "data-done") {
        done = true;
      } else if (event.type === "data-error" && isRecord(event.data))
        throw new CollaborationError(
          endpointError(
            { type: "error", message: event.data.message },
            "Gemini could not finish this step. Your existing work is preserved; try again.",
          ),
        );
      else if (event.type === "error")
        throw new CollaborationError("Gemini could not finish this step. Your existing work is preserved; try again.");
      else
        throw new CollaborationError(
          "The AI response was invalid. Please try again.",
        );
    };
    try {
      for await (const event of stream) consume(event);
      if (!next && !paused && !done)
        throw new CollaborationError(
          "The AI response was interrupted. Please try again.",
        );
      return { calls, continuation: next, paused };
    } catch (error) {
      if (error instanceof CollaborationError) throw error;
      throw new CollaborationError("The AI response was invalid. Please try again.");
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
      ...(["board", "code", "notes", "spreadsheet"] as const)
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
        ...captureContext(initial, selection),
        editPolicy: initial.autoApplyChanges ? "auto-apply" : "review",
        sources,
      }),
      sources,
      sourceRevisions: {
        board: initial.data.board.revision,
        code: initial.data.code.revision,
        notes: initial.data.notes.revision,
        spreadsheet: initial.data.spreadsheet.revision,
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
      let continuation: Checkpoint | undefined,
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
            if (answer?.trim()) {
              let index = 0;
              for (const part of spokenParts(answer)) {
                assertActive(job);
                if (part.trim()) options.voice.narrate(`${job.id}:answer:${index++}`, part, job.controller.signal);
              }
            }
          }
          break;
        }
        continuation = response.continuation;
        results = [];
        for (const call of response.calls) {
          assertActive(job);
          const result = await executeCall(job, call);
          assertActive(job);
          results.push({ id: call.id, result });
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
      if (active === job) options.voice?.clear?.(job.id);
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
      (["board", "code", "notes", "spreadsheet"] as const).some(
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
      workspaceCommands.check(review);
      if (review.teaching) {
        try {
          await presentTeachingStep(
            { ...review.teaching, change: review },
            job.controller.signal,
            job.voice ? options.voice?.narrate : undefined,
          );
        } catch (error) {
          review.resolve({ status: "cancelled", message: "The teaching step was interrupted. Visible progress may have been saved; read the current workspace before continuing." });
          if (isActive(job)) {
            options.onError(error instanceof Error && error.name !== "AbortError" ? error.message : "Writing paused. Completed changes are saved.");
            cancel();
          }
          return;
        }
        assertActive(job);
        workspaceCommands.check(review);
      }
      {
        options.voice?.clear?.(job.id);
        const accepted = workspaceCommands.apply(review);
        const revision = accepted.revision;
        if (job.sourceRevisions[review.proposal.target] !== undefined)
          job.sourceRevisions[review.proposal.target] = revision;
        let run: unknown;
        if (runAfter && review.proposal.target === "code")
          run = await executeRun(job, revision);
        assertActive(job);
        review.resolve({
          ...accepted,
          ...(run ? { run } : {}),
        });
      }
    } catch {
      options.voice?.clear?.(job.id);
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
    review.resolve(workspaceCommands.reject(review));
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
        narrate: (...args) => voiceRef.current?.narrate(...args),
        clear: (jobId) => voiceRef.current?.clear?.(jobId),
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
