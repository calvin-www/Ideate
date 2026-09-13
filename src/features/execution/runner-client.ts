import {
  envelope,
  isParentMessage,
  isRunnerMessage,
  byteLength,
  trimUtf8,
  MAX_OUTPUT_BYTES,
  INIT_TIMEOUT_MS,
} from "../../../runner/protocol.mjs";

export const RUNNER_URL = `${(process.env.NEXT_PUBLIC_RUNNER_ORIGIN || "http://localhost:3001").replace(/\/$/, "")}/`;
export type RunnerResult = {
  status: "success" | "error" | "cancelled" | "timeout";
  error?: string;
  line?: number;
  durationMs: number;
};
export type RunnerRequest = {
  id: string;
  code: string;
  artifactId?: string;
  sourceRevision?: number;
  sourceHash?: string;
};
export type RunnerCallbacks = {
  onStatus: (status: string) => void;
  onOutput: (runId: string, channel: "stdout" | "stderr", text: string) => void;
  onComplete: (runId: string, result: RunnerResult) => void;
};
type RunnerMessage =
  | { type: "status"; status: string; error?: string }
  | {
      type: "output";
      id: string;
      sequence: number;
      channel: "stdout" | "stderr";
      text: string;
    }
  | ({ type: "complete"; id: string } & RunnerResult);
type ActiveRun = {
  request: RunnerRequest;
  sent: boolean;
  sequence: number;
  bytes: number;
  startedAt: number | null;
};

/** Narrow, text-only bridge to a credential-free origin. No workspace operations cross it. */
export class RunnerClient {
  private readonly origin: string;
  private active: ActiveRun | null = null;
  private connected = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly iframe: HTMLIFrameElement,
    private readonly callbacks: RunnerCallbacks,
  ) {
    this.origin = new URL(RUNNER_URL).origin;
    if (this.origin === window.location.origin)
      throw new Error("Python must run on a separate origin.");
    window.addEventListener("message", this.receive);
    iframe.addEventListener("load", this.handleLoad);
    this.initialize();
  }

  private post(message: object) {
    this.iframe.contentWindow?.postMessage(
      { ...envelope, ...message },
      this.origin,
    );
  }

  private handleLoad = () => {
    if (this.active?.sent)
      this.finish({
        status: "error",
        error: "Python runner reloaded and interrupted this run.",
        durationMs: this.elapsed(),
      });
    this.connected = false;
    this.initialize();
  };

  private initialize = () => {
    if (this.disposed) return;
    this.callbacks.onStatus("loading");
    this.post({ type: "init" });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.connected = false;
      this.finish({
        status: "error",
        error:
          "Python could not load. Check that the runner server is running, then try Run again.",
        durationMs: 0,
      });
      this.callbacks.onStatus("error");
    }, INIT_TIMEOUT_MS + 5_000);
  };

  run(request: RunnerRequest): void {
    if (this.disposed) return;
    if (!isParentMessage({ ...envelope, type: "run", ...request })) {
      this.callbacks.onComplete(request.id, {
        status: "error",
        error: "The program is invalid or exceeds the 256 KiB source limit.",
        durationMs: 0,
      });
      return;
    }
    if (this.active) this.stop();
    this.active = {
      request: { ...request },
      sent: false,
      sequence: 0,
      bytes: 0,
      startedAt: null,
    };
    if (!this.connected) this.initialize();
    this.sendPending();
  }

  private sendPending() {
    if (!this.connected || !this.active || this.active.sent) return;
    this.active.sent = true;
    this.post({ type: "run", ...this.active.request });
  }

  stop(): void {
    if (!this.active || this.disposed) return;
    this.post({ type: "stop", id: this.active.request.id });
    this.finish({ status: "cancelled", durationMs: this.elapsed() });
    this.callbacks.onStatus("loading");
  }

  private elapsed() {
    return this.active?.startedAt == null
      ? 0
      : Math.max(0, Date.now() - this.active.startedAt);
  }

  private finish(result: RunnerResult) {
    if (!this.active) return;
    clearTimeout(this.timer);
    const id = this.active.request.id;
    this.active = null;
    this.callbacks.onComplete(id, result);
  }

  private receive = (event: MessageEvent<unknown>) => {
    if (
      this.disposed ||
      event.origin !== this.origin ||
      event.source !== this.iframe.contentWindow ||
      !isRunnerMessage(event.data)
    )
      return;
    const message = event.data as RunnerMessage;
    if (message.type === "status") {
      this.connected = true;
      if (message.status === "ready" || message.status === "error")
        clearTimeout(this.timer);
      if (message.status === "running" && this.active) {
        this.active.startedAt = Date.now();
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          if (this.active)
            this.post({ type: "stop", id: this.active.request.id });
          this.finish({
            status: "timeout",
            error: "Execution exceeded the 10 second limit.",
            durationMs: this.elapsed(),
          });
          this.callbacks.onStatus("error");
        }, 12_000);
      }
      if (message.status === "error")
        this.finish({
          status: "error",
          error:
            message.error || "Python runtime is unavailable. Try Run again.",
          durationMs: this.elapsed(),
        });
      this.callbacks.onStatus(message.status);
      if (message.status !== "error") this.sendPending();
      return;
    }
    if (!this.active || message.id !== this.active.request.id) return;
    if (message.type === "output") {
      if (message.sequence !== this.active.sequence) return;
      this.active.sequence++;
      const remaining = MAX_OUTPUT_BYTES - this.active.bytes;
      const text = trimUtf8(message.text, remaining);
      this.active.bytes += byteLength(text);
      if (text) this.callbacks.onOutput(message.id, message.channel, text);
      if (byteLength(message.text) > remaining) {
        this.post({ type: "stop", id: message.id });
        this.finish({
          status: "error",
          error: "Execution stopped: the combined output exceeded 64 KiB.",
          durationMs: this.elapsed(),
        });
      }
    } else {
      this.finish({
        status: message.status,
        durationMs: message.durationMs,
        ...(message.error ? { error: message.error } : {}),
        ...(message.line ? { line: message.line } : {}),
      });
    }
  };

  dispose(): void {
    if (this.disposed) return;
    if (this.active) this.post({ type: "stop", id: this.active.request.id });
    this.disposed = true;
    clearTimeout(this.timer);
    window.removeEventListener("message", this.receive);
    this.iframe.removeEventListener("load", this.handleLoad);
    this.active = null;
  }
}
