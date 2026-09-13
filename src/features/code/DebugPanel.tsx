"use client";
import { Play, StepForward } from "lucide-react";
import type { DebugSession } from "../execution/useExecution";
import styles from "./CodePanel.module.css";

export default function DebugPanel({
  session,
  stale,
  onResume,
}: {
  session: DebugSession;
  stale: boolean;
  onResume: (command: "step" | "continue") => void;
}) {
  const pause = session.pause;
  return (
    <section className={styles.debugPanel} aria-label="Python debugger">
      <div className={styles.debugToolbar}>
        <strong role="status">
          {pause ? `Paused before line ${pause.line}` : "Debugging…"}
        </strong>
        <div className={styles.toolbarActions}>
          <button
            className="button"
            disabled={!pause}
            onClick={() => onResume("step")}
            title="Execute the next line, stepping into function calls"
          >
            <StepForward size={14} /> Step
          </button>
          <button
            className="button"
            disabled={!pause}
            onClick={() => onResume("continue")}
            title="Run the rest of this program"
          >
            <Play size={14} /> Continue
          </button>
        </div>
      </div>
      {stale && (
        <p className={styles.stale}>
          Code changed. This debug session is using the version you started.
          Stop and debug again to use your edits.
        </p>
      )}
      {pause && (
        <>
          <div className={styles.debugLocation}>
            <span>
              {pause.functionName === "<module>"
                ? "main.py"
                : `${pause.functionName}() · main.py`}
            </span>
            <code>{session.code.split("\n")[pause.line - 1]}</code>
          </div>
          <div className={styles.debugVariables}>
            {pause.locals.length ? (
              <table aria-label="Local variables">
                <thead>
                  <tr>
                    <th>Variable</th>
                    <th>Value before this line</th>
                  </tr>
                </thead>
                <tbody>
                  {pause.locals.map((variable, index) => (
                    <tr key={`${variable.name}-${index}`}>
                      <td>
                        <code>{variable.name}</code>
                      </td>
                      <td>
                        <code>{variable.value}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>No local variables yet. Step to execute this line.</p>
            )}
          </div>
          <small>
            Local values are shortened for readability. Step enters your
            function calls.
          </small>
        </>
      )}
    </section>
  );
}
