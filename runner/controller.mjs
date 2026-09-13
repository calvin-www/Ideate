import { envelope, isParentMessage, isRunnerMessage, byteLength, trimUtf8, MAX_OUTPUT_BYTES, MAX_CHUNK_BYTES, RUN_TIMEOUT_MS, INIT_TIMEOUT_MS } from './protocol.mjs';

/** Owns the worker lifecycle on the runner origin, outside the executing thread. */
export class RunnerController {
  constructor({ createWorker, send }) {
    this.createWorker = createWorker;
    this.send = send;
    this.worker = null;
    this.ready = false;
    this.active = null;
    this.disposed = false;
    this.timer = null;
  }

  status(status, error) { this.send({ ...envelope, type: 'status', status, ...(error ? { error } : {}) }); }

  start() {
    if (this.disposed || this.worker) return;
    this.ready = false;
    this.status('loading');
    try {
      const worker = this.createWorker();
      this.worker = worker;
      this.timer = setTimeout(() => {
        if (this.worker !== worker) return;
        this.failRuntime('Python could not finish loading. Run again to retry.');
      }, INIT_TIMEOUT_MS);
      worker.onmessage = (event) => {
        if (this.worker !== worker || this.disposed) return;
        this.receive(event.data);
      };
      worker.onerror = () => {
        if (this.worker === worker) this.failRuntime('Python runtime failed. Run again to retry.');
      };
    } catch {
      this.failRuntime('Python worker is unavailable in this browser.');
    }
  }

  handle(message) {
    if (this.disposed || !isParentMessage(message)) return;
    if (message.type === 'init') {
      if (!this.worker) this.start();
      else this.status(this.active?.startedAt !== null && this.active ? 'running' : this.ready ? 'ready' : 'loading');
      return;
    }
    if (message.type === 'stop') {
      if (this.active?.request.id === message.id) this.finish('cancelled', undefined, undefined, true);
      return;
    }
    if (this.active) return;
    this.active = { request: { ...message }, startedAt: null, bytes: 0, sequence: 0 };
    if (!this.worker) this.start();
    if (this.ready) this.execute();
  }

  execute() {
    if (!this.active || !this.ready || this.active.startedAt !== null) return;
    clearTimeout(this.timer);
    this.active.startedAt = Date.now();
    this.status('running');
    this.timer = setTimeout(() => this.finish('timeout', 'Execution stopped after the 10 second limit.', undefined, true), RUN_TIMEOUT_MS);
    this.worker.postMessage(this.active.request);
  }

  receive(message) {
    if (!isRunnerMessage(message)) {
      if (this.active) this.finish('error', 'Python returned an invalid or oversized response.', undefined, true);
      return;
    }
    if (message.type === 'status') {
      if (message.status === 'ready' && !this.ready) {
        clearTimeout(this.timer);
        this.ready = true;
        this.status('ready');
        this.execute();
      } else if (message.status === 'error') this.failRuntime(message.error || 'Python failed to initialize.');
      return;
    }
    if (!this.active || this.active.request.id !== message.id || this.active.startedAt === null) return;
    if (message.type === 'output') {
      if (message.sequence !== this.active.sequence) return;
      this.active.sequence++;
      const remaining = MAX_OUTPUT_BYTES - this.active.bytes;
      const text = trimUtf8(message.text, remaining);
      if (text) {
        this.active.bytes += byteLength(text);
        this.send({ ...envelope, type: 'output', id: message.id, sequence: message.sequence, channel: message.channel, text });
      }
      if (byteLength(message.text) > remaining) this.finish('error', 'Execution stopped: the combined output exceeded 64 KiB.', undefined, true);
    } else if (message.type === 'complete') {
      // A program can mutate imported modules or close Python's original streams.
      // A fresh worker makes all execution state run-local, even after success.
      this.finish(message.status, message.error, message.line, true);
    }
  }

  finish(status, error, line, restart = false) {
    const active = this.active;
    if (!active) return;
    clearTimeout(this.timer);
    this.active = null;
    this.send({ ...envelope, type: 'complete', id: active.request.id, status,
      durationMs: active.startedAt === null ? 0 : Math.max(0, Date.now() - active.startedAt),
      ...(error ? { error: trimUtf8(error, MAX_CHUNK_BYTES) } : {}), ...(line ? { line } : {}) });
    if (restart) { this.terminate(); this.start(); }
    else this.status('ready');
  }

  failRuntime(error) {
    if (this.active) this.finish('error', error);
    this.terminate();
    this.status('error', error);
  }

  terminate() {
    clearTimeout(this.timer);
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
  }

  dispose() { this.disposed = true; this.active = null; this.terminate(); }
}
