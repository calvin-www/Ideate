"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Bug, Download, FileCode2, Play, Square, Trash2 } from "lucide-react";
import type { DebugSession } from "../execution/useExecution";
import DebugPanel from "./DebugPanel";
import TextEditor from "../workspace/TextEditor";
import { adapters } from "../workspace/adapters";
import type { Run } from "../workspace/model";
import { useWorkspace } from "../workspace/store";
import styles from "./CodePanel.module.css";

export interface CodePanelProps {
  active: boolean;
  runCode: () => Promise<Run>;
  stopCode: () => void;
  runtimeStatus: string;
  debugCode: () => Promise<Run>;
  debugSession: DebugSession | null;
  resumeDebug: (command: "step" | "continue") => void;
}

const RUN_LABELS: Record<Run["status"], string> = {
  running: "Running",
  success: "Completed",
  error: "Python error",
  cancelled: "Stopped",
  timeout: "Time limit reached",
  interrupted: "Run interrupted",
};

function downloadCode(text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/x-python;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "main.py";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function CodePanel({
  active,
  runCode,
  stopCode,
  runtimeStatus,
  debugCode,
  debugSession,
  resumeDebug,
}: CodePanelProps) {
  const code = useWorkspace((state) => state.data.code);
  const runs = useWorkspace((state) => state.data.runs);
  const selection = useWorkspace((state) => state.selection);
  const latestRun = runs.at(-1);
  const [clearedRun, setClearedRun] = useState<string | null>(null);
  const [outputHeight, setOutputHeight] = useState(228);
  const [requestError, setRequestError] = useState("");
  const [starting, setStarting] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const output = useRef<HTMLPreElement>(null);
  const stopDragging = useRef<(() => void) | null>(null);
  const run = latestRun?.id === clearedRun ? undefined : latestRun;
  const running =
    runtimeStatus === "running" || latestRun?.status === "running" || starting;
  const preparing =
    runtimeStatus === "loading" || runtimeStatus === "restarting";
  const stale = Boolean(run && run.revision !== code.revision);

  useEffect(() => () => stopDragging.current?.(), []);

  async function startRun(debug = false) {
    setRequestError("");
    setStarting(true);
    try {
      await (debug ? debugCode() : runCode());
    } catch (error) {
      setRequestError(
        error instanceof Error
          ? error.message
          : "Python could not run. Try again.",
      );
    } finally {
      setStarting(false);
    }
  }

  function resizeOutput(height: number) {
    const max = Math.max(
      140,
      Math.floor((panel.current?.clientHeight ?? 680) * 0.7),
    );
    setOutputHeight(Math.min(max, Math.max(110, height)));
  }

  function beginResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = outputHeight;
    const move = (next: PointerEvent) =>
      resizeOutput(startHeight + startY - next.clientY);
    const done = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
      window.removeEventListener("pointercancel", done);
      stopDragging.current = null;
    };
    stopDragging.current?.();
    stopDragging.current = done;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done);
    window.addEventListener("pointercancel", done);
  }

  function captureOutputSelection() {
    if (!run || !output.current) return;
    const selected = window.getSelection();
    if (
      !selected?.anchorNode ||
      !selected.focusNode ||
      !output.current.contains(selected.anchorNode) ||
      !output.current.contains(selected.focusNode)
    )
      return;
    const text = selected.toString();
    if (text.trim())
      useWorkspace.setState({
        selection: {
          tool: "code",
          revision: run.revision,
          runId: run.id,
          text,
        },
      });
    else if (useWorkspace.getState().selection?.runId === run.id)
      useWorkspace.setState({ selection: null });
  }

  function revealErrorLine() {
    if (!run?.line || stale) return;
    const lines = run.code.split("\n");
    const line = Math.min(Math.max(run.line, 1), lines.length);
    const from = lines
      .slice(0, line - 1)
      .reduce((length, text) => length + text.length + 1, 0);
    adapters.code?.reveal({
      id: `${run.id}-line-${line}`,
      tool: "code",
      revision: run.revision,
      label: `main.py, line ${line}`,
      excerpt: lines[line - 1],
      from,
      to: from + lines[line - 1].length,
      runId: run.id,
    });
  }

  const runtimeLabel = preparing
    ? runtimeStatus === "restarting"
      ? "Restarting Python…"
      : "Loading Python…"
    : runtimeStatus === "error"
      ? "Python unavailable"
      : runtimeStatus === "paused"
        ? "Python paused"
        : running
          ? "Python is running"
          : "Python ready";

  return (
    <section
      ref={panel}
      className={styles.panel}
      hidden={!active}
      inert={!active}
      aria-label="Python workspace"
    >
      <div className={styles.toolbar}>
        <div className={styles.filename}>
          <FileCode2 size={16} strokeWidth={1.7} aria-hidden="true" />
          <span>main.py</span>
        </div>
        <div className={styles.toolbarActions}>
          <span
            className={`${styles.runtime} ${runtimeStatus === "error" ? styles.runtimeFailed : ""}`}
            role="status"
          >
            <span className={styles.statusDot} />
            {runtimeLabel}
          </span>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => downloadCode(code.text)}
            aria-label="Download main.py"
            title="Download main.py"
          >
            <Download size={16} aria-hidden="true" />
          </button>
          {running ? (
            <button
              type="button"
              className={styles.stopButton}
              onClick={stopCode}
            >
              <Square size={13} fill="currentColor" aria-hidden="true" />
              Stop
            </button>
          ) : (
            <>
              <button
                type="button"
                className="button"
                onClick={() => void startRun(true)}
                disabled={preparing}
                title="Pause before each Python line and inspect variables"
              >
                <Bug size={14} /> Debug
              </button>
              <button
                type="button"
                className={styles.runButton}
                onClick={() => void startRun()}
                disabled={preparing}
                title="Run Python (Ctrl or Command + Enter)"
              >
                <Play size={14} fill="currentColor" aria-hidden="true" />
                {preparing ? "Getting ready" : "Run Python"}
              </button>
            </>
          )}
        </div>
      </div>
      {requestError && (
        <div className={styles.requestError} role="alert">
          {requestError}
        </div>
      )}
      <div className={styles.source}>
        <TextEditor
          target="code"
          active={active}
          executionLine={
            debugSession?.revision === code.revision
              ? debugSession.pause?.line
              : undefined
          }
        />
      </div>
      {debugSession && (
        <DebugPanel
          session={debugSession}
          stale={debugSession.revision !== code.revision}
          onResume={resumeDebug}
        />
      )}
      <div
        className={styles.divider}
        role="separator"
        aria-label="Resize output panel"
        aria-orientation="horizontal"
        aria-valuemin={110}
        aria-valuemax={Math.max(
          140,
          Math.floor((panel.current?.clientHeight ?? 680) * 0.7),
        )}
        aria-valuenow={outputHeight}
        tabIndex={0}
        onPointerDown={beginResize}
        onDoubleClick={() => resizeOutput(228)}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            resizeOutput(outputHeight + (event.key === "ArrowUp" ? 24 : -24));
          }
          if (event.key === "Home") {
            event.preventDefault();
            resizeOutput(110);
          }
          if (event.key === "End") {
            event.preventDefault();
            resizeOutput(10000);
          }
        }}
      >
        <span />
      </div>
      <div className={styles.outputPanel} style={{ height: outputHeight }}>
        <div className={styles.outputToolbar}>
          <div className={styles.outputHeading}>
            <h2>Output</h2>
            {run && (
              <span
                className={`${styles.runStatus} ${run.status === "error" || run.status === "timeout" ? styles.errorStatus : ""}`}
                role="status"
              >
                {debugSession?.pause && run.status === "running"
                  ? "Paused"
                  : RUN_LABELS[run.status]}
                {run.status === "success" && run.durationMs > 0
                  ? ` in ${run.durationMs < 1000 ? `${Math.round(run.durationMs)} ms` : `${(run.durationMs / 1000).toFixed(1)} s`}`
                  : ""}
              </span>
            )}
          </div>
          <button
            type="button"
            className={styles.clearButton}
            disabled={!run || running}
            onClick={() => {
              if (run) {
                setClearedRun(run.id);
                if (selection?.runId === run.id)
                  useWorkspace.setState({ selection: null });
              }
            }}
            title="Clear displayed output"
          >
            <Trash2 size={13} aria-hidden="true" />
            Clear
          </button>
        </div>
        {stale && (
          <div className={styles.stale}>
            This output is from an earlier version of main.py. Run again to use
            your latest changes.
          </div>
        )}
        <div className={styles.outputScroll}>
          {run ? (
            <>
              {(run.output || run.error) && (
                <pre
                  ref={output}
                  className={styles.outputText}
                  tabIndex={0}
                  aria-label="Python output"
                  onMouseUp={captureOutputSelection}
                  onTouchEnd={captureOutputSelection}
                  onKeyUp={captureOutputSelection}
                >
                  {run.output}
                  {run.error && !run.output.includes(run.error)
                    ? `${run.output && !run.output.endsWith("\n") ? "\n" : ""}${run.error}`
                    : ""}
                </pre>
              )}
              {run.status === "success" && !run.output && !run.error && (
                <p className={styles.emptyResult}>
                  Completed successfully. This program did not print any output.
                </p>
              )}
              {run.status === "running" && !run.output && (
                <p className={styles.emptyResult}>
                  {debugSession?.pause
                    ? "Paused. Step or Continue to execute the next line."
                    : "Running your Python…"}
                </p>
              )}
              {run.status === "cancelled" && (
                <p className={styles.emptyResult}>
                  Run stopped. You can edit your code and try again.
                </p>
              )}
              {run.status === "interrupted" && (
                <p className={styles.emptyResult}>
                  This run was interrupted. Run it again to get a complete
                  result.
                </p>
              )}
              {run.status === "timeout" && !run.error && (
                <p className={styles.emptyResult}>
                  This program reached the time limit. Check loops that may not
                  finish, then run again.
                </p>
              )}
              {run.line && !stale && (
                <button
                  type="button"
                  className={styles.lineLink}
                  onClick={revealErrorLine}
                >
                  Go to main.py, line {run.line}
                </button>
              )}
            </>
          ) : (
            <div className={styles.emptyOutput}>
              <Play size={19} strokeWidth={1.4} aria-hidden="true" />
              <p>{clearedRun ? "Output cleared" : "See what your code does"}</p>
              <span>
                {clearedRun
                  ? "Run Python to see the next result."
                  : "Run Python to see printed values and errors here."}
              </span>
            </div>
          )}
        </div>
        {run?.output && (
          <div className={styles.outputHint}>
            {selection?.runId === run.id
              ? "Selected output is attached to your next chat message."
              : "Select a few lines of output to discuss them with your study partner."}
          </div>
        )}
      </div>
    </section>
  );
}
