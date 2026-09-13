import {
  byteLength,
  trimUtf8,
  MAX_CHUNK_BYTES,
  MAX_OUTPUT_BYTES,
} from "./protocol.mjs";

const INPUT_SETUP = `
import builtins as _runner_builtins
__builtins__ = vars(_runner_builtins).copy()
def _runner_no_input(*args, **kwargs):
    raise RuntimeError("Interactive input is unavailable. Assign example values in your code instead.")
__builtins__["input"] = _runner_no_input
del _runner_builtins, _runner_no_input
`;

/** Browser workers supply their local asset URL; Node tests use the installed runtime. */
export async function createPythonRuntime(loadPyodide, options = {}) {
  const pyodide = await loadPyodide({
    ...options,
    jsglobals: Object.freeze(Object.create(null)),
    env: {},
    stdin: () => null,
    stdout: () => {},
    stderr: () => {},
  });
  pyodide.setStdin({ error: true });
  const resetStreams = pyodide.runPython(`
def _ideate_capture_streams():
    import sys
    streams = sys.stdin, sys.stdout, sys.stderr
    def reset():
        sys.stdin, sys.stdout, sys.stderr = streams
    return reset
_ideate_capture_streams()
`);
  pyodide.globals.delete("_ideate_capture_streams");

  return {
    async execute(request, onOutput, onLimit = () => {}) {
      const startedAt = Date.now();
      resetStreams();
      const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
      let outputBytes = 0;
      let overflow = false;
      let outputEvents = 0;
      let pending = "";
      let pendingChannel = "stdout";
      let flushTimer;
      const flush = () => {
        clearTimeout(flushTimer);
        flushTimer = undefined;
        if (pending) {
          outputEvents++;
          onOutput(pendingChannel, pending);
        }
        pending = "";
      };
      const append = (channel, text) => {
        if (pendingChannel !== channel) flush();
        pendingChannel = channel;
        pending += text;
        while (byteLength(pending) >= 4096) {
          const chunk = trimUtf8(pending, 4096);
          outputEvents++;
          onOutput(channel, chunk);
          pending = pending.slice(chunk.length);
        }
        // Timers cannot run while synchronous Python is busy. Surface the first
        // output and ordinary trace lines immediately, then batch noisy loops.
        if (
          pending &&
          outputEvents < 128 &&
          (outputEvents === 0 || pending.includes("\n"))
        )
          flush();
        else if (pending && !flushTimer)
          flushTimer = setTimeout(() => {
            flushTimer = undefined;
            flush();
          }, 16);
      };
      const write = (channel) => (buffer) => {
        const allowed = Math.min(buffer.length, MAX_OUTPUT_BYTES - outputBytes);
        if (allowed > 0) {
          append(
            channel,
            decoders[channel].decode(buffer.subarray(0, allowed), {
              stream: true,
            }),
          );
          outputBytes += allowed;
        }
        if (allowed < buffer.length) {
          flush();
          if (!overflow) {
            overflow = true;
            onLimit();
          }
          throw new pyodide.FS.ErrnoError(pyodide.ERRNO_CODES.EIO);
        }
        return buffer.length;
      };
      pyodide.setStdout({ write: write("stdout") });
      pyodide.setStderr({ write: write("stderr") });
      pyodide.setStdin({ error: true });
      const globals = pyodide.runPython(
        '{"__name__": "__main__", "__file__": "main.py"}',
      );
      let result = { status: "success" };
      try {
        pyodide.runPython(INPUT_SETUP, { globals });
        await pyodide.runPythonAsync(request.code, {
          globals,
          filename: "main.py",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const matches = [...message.matchAll(/File "main\.py", line (\d+)/g)];
        const line = matches.length ? Number(matches.at(-1)[1]) : undefined;
        result = {
          status: "error",
          error: trimUtf8(message, MAX_CHUNK_BYTES),
          ...(line ? { line } : {}),
        };
      } finally {
        try {
          pyodide.runPython(
            "import sys\nsys.stdout.flush()\nsys.stderr.flush()",
          );
        } catch {
          /* Preserve the program's original exception. */
        }
        if (!overflow) {
          append("stdout", decoders.stdout.decode());
          append("stderr", decoders.stderr.decode());
        }
        flush();
        globals.destroy();
      }
      if (overflow)
        result = {
          status: "error",
          error: "Execution stopped: the combined output exceeded 64 KiB.",
        };
      return { ...result, durationMs: Math.max(0, Date.now() - startedAt) };
    },
  };
}
