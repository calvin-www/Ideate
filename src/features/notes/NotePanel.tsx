"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { BookOpen, Download, PencilLine } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import { mathRemarkPlugins, mathRehypePlugins } from "../markdown/math";
import TextEditor from "../workspace/TextEditor";
import { adapters } from "../workspace/adapters";
import { useWorkspace } from "../workspace/store";
import styles from "./NotePanel.module.css";
import AttentionOverlay from "../ai/AttentionOverlay";
import { attentionPreview } from "./attentionPreview";
import TextPresentation from "../voice/TextPresentation";

export interface NotePanelProps {
  active: boolean;
  onReference: (id: string) => void;
}

function downloadNotes(text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/markdown;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "notes.md";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sourceId(href?: string) {
  const match = href?.match(/^#source[:=](.+)$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export default function NotePanel({ active, onReference }: NotePanelProps) {
  const notes = useWorkspace((state) => state.data.notes.text);
  const saveStatus = useWorkspace((state) => state.saveStatus);
  const saveError = useWorkspace((state) => state.saveError);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const id = useId();
  const preview = useRef<HTMLDivElement>(null);
  const cue = useWorkspace((state) => state.attention.notes);
  const previewTargets = useCallback(() => {
    if (!cue || cue.target === "board" || !preview.current) return [];
    const matches = Array.from(
      preview.current.querySelectorAll<HTMLElement>("[data-study-from]"),
    ).filter((node) => {
      const from = Number(node.dataset.studyFrom),
        to = Number(node.dataset.studyTo);
      return cue.from === cue.to
        ? cue.from >= from && cue.from <= to
        : cue.from < to && cue.to > from;
    });
    // Drop a parent only when a child contains the entire requested passage.
    // A range spanning a parent list item and its children needs the parent box.
    const specific = matches.filter(
      (node) =>
        !matches.some(
          (child) =>
            child !== node &&
            node.contains(child) &&
            Number(child.dataset.studyFrom) <= cue.from &&
            Number(child.dataset.studyTo) >= cue.to,
        ),
    );
    return specific.filter(
      (node) =>
        !specific.some((parent) => parent !== node && parent.contains(node)),
    );
  }, [cue]);
  const measurePreview = useCallback(
    () => previewTargets().map((node) => node.getBoundingClientRect()),
    [previewTargets],
  );
  const revealPreview = useCallback(
    () =>
      previewTargets()[0]?.scrollIntoView({
        block: "center",
        behavior: "instant",
      }),
    [previewTargets],
  );
  const subscribePreview = useCallback(
    (update: () => void) => {
      const observer = new ResizeObserver(update);
      const article = preview.current?.querySelector("article");
      if (article) observer.observe(article);
      previewTargets().forEach((node) => observer.observe(node));
      return () => observer.disconnect();
    },
    [previewTargets],
  );
  useEffect(() => {
    // Definitions, raw markup, and empty passages have no rendered block.
    // Show the exact source range instead of pointing at unrelated prose.
    if (active && mode === "preview" && cue && !previewTargets().length)
      setMode("edit");
  }, [active, mode, cue, previewTargets]);
  const markdownComponents = useMemo<Components>(
    () => ({
      a: ({ href, children }) => {
        const reference = sourceId(href);
        if (reference)
          return (
            <a
              href={href}
              className={styles.sourceLink}
              onClick={(event) => {
                event.preventDefault();
                onReference(reference);
              }}
            >
              {children}
            </a>
          );
        const external = /^https?:\/\//i.test(href || "");
        return (
          <a
            href={href}
            {...(external
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {})}
          >
            {children}
          </a>
        );
      },
    }),
    [onReference],
  );

  // References can reopen a selected passage even if the journal was in Preview.
  useEffect(() => {
    const editor = adapters.notes;
    if (!editor) return;
    const revealable = {
      ...editor,
      focus: () => {
        setMode("edit");
        requestAnimationFrame(() => editor.focus());
      },
      reveal: (ref: Parameters<typeof editor.reveal>[0]) => {
        setMode("edit");
        requestAnimationFrame(() => editor.reveal(ref));
      },
    };
    adapters.notes = revealable;
    return () => {
      if (adapters.notes === revealable) adapters.notes = editor;
    };
  }, []);

  const savedLabel =
    saveStatus === "saved"
      ? "Saved on this device"
      : saveStatus === "saving"
        ? "Saving…"
        : saveStatus === "error"
          ? "Could not save"
          : "Loading notes…";

  return (
    <section
      className={styles.panel}
      hidden={!active}
      inert={!active}
      aria-label="Study journal"
    >
      <div className={styles.toolbar}>
        <div className={styles.filename}>
          <BookOpen size={16} strokeWidth={1.7} aria-hidden="true" />
          <span>notes.md</span>
        </div>
        <div className={styles.actions}>
          <div className={styles.tabs} role="tablist" aria-label="Journal view">
            <button
              type="button"
              id={`${id}-edit-tab`}
              role="tab"
              aria-selected={mode === "edit"}
              aria-controls={`${id}-edit`}
              tabIndex={mode === "edit" ? 0 : -1}
              className={mode === "edit" ? styles.selectedTab : ""}
              onClick={() => setMode("edit")}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                  event.preventDefault();
                  setMode("preview");
                  document.getElementById(`${id}-preview-tab`)?.focus();
                }
              }}
            >
              <PencilLine size={13} aria-hidden="true" />
              Edit
            </button>
            <button
              type="button"
              id={`${id}-preview-tab`}
              role="tab"
              aria-selected={mode === "preview"}
              aria-controls={`${id}-preview`}
              tabIndex={mode === "preview" ? 0 : -1}
              className={mode === "preview" ? styles.selectedTab : ""}
              onClick={() => setMode("preview")}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                  event.preventDefault();
                  setMode("edit");
                  document.getElementById(`${id}-edit-tab`)?.focus();
                }
              }}
            >
              <BookOpen size={13} aria-hidden="true" />
              Preview
            </button>
          </div>
          <button
            type="button"
            className={styles.download}
            onClick={() => downloadNotes(notes)}
            aria-label="Download notes.md"
            title="Download notes.md"
          >
            <Download size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      {saveStatus === "error" && (
        <div className={styles.saveError} role="alert">
          {saveError ||
            "Your notes could not be saved locally. Download a copy to keep your work."}
        </div>
      )}
      <div
        className={styles.edit}
        id={`${id}-edit`}
        role="tabpanel"
        aria-labelledby={`${id}-edit-tab`}
        hidden={mode !== "edit"}
        inert={mode !== "edit"}
      >
        <TextEditor target="notes" active={active && mode === "edit"} />
      </div>
      <div
        className={styles.previewSurface}
        hidden={mode !== "preview"}
        inert={mode !== "preview"}
      >
        {active && mode === "preview" && <TextPresentation target="notes" />}
        <div
          ref={preview}
          className={styles.preview}
          id={`${id}-preview`}
          role="tabpanel"
          aria-labelledby={`${id}-preview-tab`}
          tabIndex={0}
          hidden={mode !== "preview"}
          inert={mode !== "preview"}
        >
          <article className={styles.markdown}>
            {notes.trim() ? (
              <ReactMarkdown
                remarkPlugins={mathRemarkPlugins}
                rehypePlugins={[attentionPreview, ...mathRehypePlugins]}
                skipHtml
                components={markdownComponents}
              >
                {notes}
              </ReactMarkdown>
            ) : (
              <div className={styles.emptyNotes}>
                <BookOpen size={24} strokeWidth={1.3} aria-hidden="true" />
                <h2>Leave yourself a useful thought.</h2>
                <p>
                  A question, a prediction, or the step that finally made sense.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setMode("edit");
                    requestAnimationFrame(() => adapters.notes?.focus());
                  }}
                >
                  Start writing
                </button>
              </div>
            )}
          </article>
        </div>
        <AttentionOverlay
          cue={cue}
          active={active && mode === "preview"}
          measure={measurePreview}
          reveal={revealPreview}
          subscribe={subscribePreview}
        />
      </div>
      <div className={styles.footer}>
        <span
          className={saveStatus === "error" ? styles.saveFailed : ""}
          role="status"
        >
          <span className={styles.saveDot} />
          {savedLabel}
        </span>
        <span>
          {mode === "edit" ? "Markdown supported" : "Your study notes"}
        </span>
      </div>
    </section>
  );
}
