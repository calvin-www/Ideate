"use client";
import { useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import type { ClearScope } from "./clearWorkspace";
import styles from "./WorkspaceDataControls.module.css";

const labels: Record<ClearScope, string> = {
  all: "all workspace data",
  board: "whiteboard",
  code: "Python",
  notes: "notes",
};

export default function WorkspaceDataControls({
  onClear,
  onExport,
  disabled,
}: {
  onClear: (scope: ClearScope) => void;
  onExport: () => void;
  disabled: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [scope, setScope] = useState<ClearScope | null>(null);
  const [flipping, setFlipping] = useState(false);
  const keepWork = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (scope) keepWork.current?.focus();
  }, [scope]);
  useEffect(() => {
    if (!flipping) return;
    const timer = setTimeout(() => setFlipping(false), 1400);
    return () => clearTimeout(timer);
  }, [flipping]);

  return (
    <>
      <button
        type="button"
        className="icon-button workspace-data-clear"
        aria-label="Clear workspace data"
        title="Clear workspace data"
        disabled={disabled}
        onClick={() => {
          setScope(null);
          dialog.current?.showModal();
        }}
      >
        <Trash2 size={17} />
      </button>
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby="clear-data-title"
        onCancel={() => setScope(null)}
      >
        <div className={styles.heading}>
          <h2 id="clear-data-title">Clear workspace data</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close clear workspace data"
            onClick={() => dialog.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        {scope ? (
          <>
            <h3>Clear {labels[scope]}?</h3>
            <p>
              {scope === "all"
                ? "This removes the whiteboard, Python, notes, chat, saved runs, source excerpts, and undo history from this workspace. Auto-apply switches off."
                : `This empties your ${labels[scope]} and removes its undo history${scope === "code" ? " and saved Python runs" : ""}. Other documents, chat, and their saved source excerpts stay.`}
            </p>
            <p>
              Active AI work will stop. This cannot be undone. Export a copy
              first if you want to keep it.
            </p>
            <div className={styles.actions}>
              <button type="button" className="button" onClick={onExport}>
                Export a copy
              </button>
              <button
                type="button"
                className="button quiet"
                ref={keepWork}
                onClick={() => setScope(null)}
              >
                Keep my work
              </button>
              <button
                type="button"
                className={styles.clearAll}
                onClick={() => {
                  onClear(scope);
                  dialog.current?.close();
                  if (scope === "all") setFlipping(true);
                  setScope(null);
                }}
              >
                Yes, clear {labels[scope]}
              </button>
            </div>
          </>
        ) : (
          <>
            <p>Make room for a new idea. Choose what to clear.</p>
            <div className={styles.domains}>
              {(["board", "code", "notes"] as const).map((target) => (
                <button
                  key={target}
                  type="button"
                  className="button"
                  onClick={() => setScope(target)}
                >
                  <Trash2 size={14} /> Clear {labels[target]}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={styles.clearAll}
              onClick={() => setScope("all")}
            >
              Clear all workspace data
            </button>
          </>
        )}
      </dialog>
      {flipping && (
        <div
          className={styles.celebration}
          role="status"
          aria-label="Workspace cleared. A fresh desk."
        >
          <svg
            width="210"
            height="135"
            viewBox="0 0 240 150"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M25 129H215"
              stroke="#ccd5c6"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <g className={styles.table}>
              <path
                d="M49 85H191V95H49Z"
                fill="#b58d59"
                stroke="#6b5135"
                strokeWidth="3"
                strokeLinejoin="round"
              />
              <path
                d="M65 96L59 125M175 96L181 125"
                stroke="#6b5135"
                strokeWidth="8"
                strokeLinecap="round"
              />
              <g className={styles.objects}>
                <rect
                  x="77"
                  y="52"
                  width="49"
                  height="29"
                  rx="3"
                  fill="#355b46"
                />
                <path
                  d="M70 83H133"
                  stroke="#263f32"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
                <path
                  d="M143 73L168 69L171 80L146 83Z"
                  fill="#e7dcae"
                  stroke="#89794b"
                  strokeWidth="2"
                />
              </g>
            </g>
            <path
              className={styles.spark}
              d="M198 49V61M192 55H204M39 63V71M35 67H43"
              stroke="#77945e"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
          <span>A fresh desk.</span>
        </div>
      )}
    </>
  );
}
