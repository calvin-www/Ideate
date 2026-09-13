import { loadPyodide } from "./pyodide/pyodide.mjs";
import { createPythonRuntime } from "./python-runtime.mjs";
import {
  envelope,
  isParentMessage,
  isRunnerMessage,
  trimUtf8,
  MAX_CHUNK_BYTES,
} from "./protocol.mjs";

let runtime;
let running = false;
let pendingPause = null;
let pauseQueue = [];
const send = (message) => self.postMessage({ ...envelope, ...message });
const showNextPause = () => {
  if (pendingPause || !pauseQueue.length) return;
  pendingPause = pauseQueue.shift();
  send(pendingPause.message);
};

self.onmessage = async ({ data }) => {
  if (!isParentMessage(data)) return;
  if (data.type === "resume") {
    if (pendingPause?.id === data.id && pendingPause.pauseId === data.pauseId) {
      const { resolve } = pendingPause;
      pendingPause = null;
      resolve(data.command);
      if (data.command === "continue") {
        for (const queued of pauseQueue) queued.resolve("continue");
        pauseQueue = [];
      } else {
        // Let the resumed Python stack run before announcing another queued
        // pause. A synchronous step must remain under the controller watchdog;
        // this timer cannot run until the worker yields or suspends again.
        setTimeout(showNextPause, 0);
      }
    }
    return;
  }
  if (!runtime || running || !isParentMessage(data) || data.type !== "run")
    return;
  running = true;
  const heartbeat = setInterval(
    () => send({ type: "heartbeat", id: data.id }),
    1000,
  );
  let sequence = 0;
  let pauseId = 0;
  try {
    const result = await runtime.execute(
      data,
      (channel, text) =>
        send({
          type: "output",
          id: data.id,
          sequence: sequence++,
          channel,
          text,
        }),
      () =>
        send({
          type: "complete",
          id: data.id,
          status: "error",
          error: "Execution stopped: the combined output exceeded 64 KiB.",
          durationMs: 0,
        }),
      (snapshot) =>
        new Promise((resolve) => {
          const message = {
            ...envelope,
            type: "paused",
            id: data.id,
            pauseId: ++pauseId,
            line: snapshot.line,
            functionName: snapshot.functionName,
            locals: snapshot.locals?.map(({ name, value }) => ({
              name,
              value,
            })),
          };
          if (!isRunnerMessage(message))
            throw new Error("Python returned an invalid debug snapshot.");
          if (pauseQueue.length >= 100)
            throw new Error(
              "Too many concurrent Python tasks are paused. Debug a smaller example.",
            );
          pauseQueue.push({ id: data.id, pauseId, resolve, message });
          showNextPause();
        }),
    );
    send({ type: "complete", id: data.id, ...result });
  } catch (error) {
    send({
      type: "complete",
      id: data.id,
      status: "error",
      durationMs: 0,
      error: trimUtf8(String(error), MAX_CHUNK_BYTES),
    });
  } finally {
    clearInterval(heartbeat);
    running = false;
    pendingPause = null;
    pauseQueue = [];
  }
};

try {
  runtime = await createPythonRuntime(loadPyodide, {
    indexURL: new URL("./pyodide/", import.meta.url).href,
  });
  send({ type: "status", status: "ready" });
} catch (error) {
  send({
    type: "status",
    status: "error",
    error: trimUtf8(`Python could not load: ${String(error)}`, MAX_CHUNK_BYTES),
  });
}
