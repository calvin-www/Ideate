import { loadPyodide } from "./pyodide/pyodide.mjs";
import { createPythonRuntime } from "./python-runtime.mjs";
import {
  envelope,
  isParentMessage,
  trimUtf8,
  MAX_CHUNK_BYTES,
} from "./protocol.mjs";

let runtime;
let running = false;
const send = (message) => self.postMessage({ ...envelope, ...message });

self.onmessage = async ({ data }) => {
  if (!runtime || running || !isParentMessage(data) || data.type !== "run")
    return;
  running = true;
  let sequence = 0;
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
    running = false;
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
