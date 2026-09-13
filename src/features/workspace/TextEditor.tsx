"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { markdown } from "@codemirror/lang-markdown";
import { foldedRanges, unfoldEffect } from "@codemirror/language";
import { Decoration, EditorView } from "@codemirror/view";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { useWorkspace } from "./store";
import { adapters } from "./adapters";
import AttentionOverlay, { type AttentionRect } from "../ai/AttentionOverlay";

const theme = EditorView.theme({
  "&": {
    backgroundColor: "#fafaf7",
    color: "#26382f",
    height: "100%",
    fontSize: "14px",
  },
  ".cm-content": {
    fontFamily: "'Cascadia Code', 'SFMono-Regular', Consolas, monospace",
    padding: "22px 0",
    caretColor: "#355b46",
  },
  ".cm-line": { padding: "0 22px", lineHeight: "1.8" },
  ".cm-gutters": {
    backgroundColor: "#f2f3ed",
    color: "#8a938c",
    border: "none",
    padding: "0 5px",
  },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "#edf1e7" },
  ".cm-scroller": { overflow: "auto" },
  "&.cm-focused": { outline: "none" },
});
const documentLimit = EditorState.transactionFilter.of((transaction) => {
  if (transaction.docChanged && transaction.newDoc.length > 200_000) {
    queueMicrotask(() =>
      useWorkspace.setState({
        notice:
          "This document has reached its 200,000 character limit. Download a copy before starting a smaller example.",
      }),
    );
    return [];
  }
  return transaction;
});
const setExecutionLine = StateEffect.define<number | undefined>();
const executionLineField = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    if (transaction.docChanged) value = Decoration.none;
    for (const effect of transaction.effects) {
      if (effect.is(setExecutionLine)) {
        value =
          effect.value && effect.value <= transaction.state.doc.lines
            ? Decoration.set([
                Decoration.line({ class: "cm-execution-line" }).range(
                  transaction.state.doc.line(effect.value).from,
                ),
              ])
            : Decoration.none;
      }
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
const pythonExtensions = [python(), theme, documentLimit, executionLineField];
const noteExtensions = [
  markdown(),
  theme,
  documentLimit,
  EditorView.lineWrapping,
];
export default function TextEditor({
  target,
  active,
  executionLine,
}: {
  target: "code" | "notes";
  active: boolean;
  executionLine?: number;
}) {
  const text = useWorkspace((s) => s.data[target].text);
  const editor = useRef<ReactCodeMirrorRef>(null);
  const cue = useWorkspace((s) => s.attention[target]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const view = editor.current?.view;
    if (!view || target !== "code") return;
    const effects: StateEffect<unknown>[] = [
      setExecutionLine.of(executionLine),
    ];
    if (executionLine && executionLine <= view.state.doc.lines && active) {
      const line = view.state.doc.line(executionLine);
      effects.push(EditorView.scrollIntoView(line.from, { y: "center" }));
      foldedRanges(view.state).between(line.from, line.to, (from, to) => {
        effects.push(unfoldEffect.of({ from, to }));
      });
    }
    view.dispatch({ effects });
  }, [executionLine, active, ready, target]);
  const listeners = useRef(new Set<() => void>());
  const subscribe = useCallback((update: () => void) => {
    listeners.current.add(update);
    return () => {
      listeners.current.delete(update);
    };
  }, []);
  const measure = useCallback((): AttentionRect[] => {
    const view = editor.current?.view;
    if (
      !view ||
      !cue ||
      cue.target === "board" ||
      cue.to > view.state.doc.length
    )
      return [];
    if (cue.mode === "point") {
      const rect = view.coordsAtPos(cue.from);
      return rect ? [{ ...rect, right: rect.left + 2 }] : [];
    }
    return view.visibleRanges.flatMap((visible) => {
      const from = Math.max(cue.from, visible.from),
        to = Math.min(cue.to, visible.to);
      if (from >= to) return [];
      const start = view.domAtPos(from),
        end = view.domAtPos(to);
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      // Merge syntax-token rectangles on the same visual line.
      const lines: AttentionRect[] = [];
      for (const rect of Array.from(range.getClientRects())) {
        if (!rect.width || !rect.height) continue;
        const existing = lines.find(
          (line) =>
            Math.abs(line.top - rect.top) < 2 &&
            Math.abs(line.bottom - rect.bottom) < 2,
        );
        if (existing) {
          existing.left = Math.min(existing.left, rect.left);
          existing.right = Math.max(existing.right, rect.right);
        } else
          lines.push({
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
          });
      }
      return lines;
    });
  }, [cue]);
  const revealAttention = useCallback(() => {
    const view = editor.current?.view;
    if (
      view &&
      cue &&
      cue.target !== "board" &&
      cue.to <= view.state.doc.length
    ) {
      const effects = [EditorView.scrollIntoView(cue.from, { y: "center" })];
      foldedRanges(view.state).between(cue.from, cue.to, (from, to) => {
        effects.push(unfoldEffect.of({ from, to }));
      });
      view.dispatch({ effects });
    }
  }, [cue]);
  useEffect(() => {
    adapters[target] = {
      focus: () => editor.current?.view?.focus(),
      reveal: (ref) => {
        const view = editor.current?.view;
        if (!view) return;
        const from = Math.max(
          0,
          Math.min(ref.from ?? 0, view.state.doc.length),
        );
        const to = Math.max(
          from,
          Math.min(ref.to ?? from, view.state.doc.length),
        );
        view.dispatch({
          selection: { anchor: from, head: to },
          scrollIntoView: true,
        });
        view.focus();
      },
    };
    return () => {
      delete adapters[target];
    };
  }, [target]);
  useEffect(() => {
    if (active)
      requestAnimationFrame(() => {
        editor.current?.view?.requestMeasure();
        if (useWorkspace.getState().view === target)
          editor.current?.view?.focus();
      });
  }, [active, target, navigationEpoch]);
  return (
    <div className="attention-editor">
      <CodeMirror
        className="attention-text-editor"
        ref={editor}
        aria-label={target === "code" ? "Python source" : "Markdown source"}
        value={text}
        height="100%"
        onCreateEditor={() => setReady(true)}
        extensions={target === "code" ? pythonExtensions : noteExtensions}
        basicSetup={{
          lineNumbers: target === "code",
          foldGutter: target === "code",
          highlightActiveLine: true,
          autocompletion: target === "code",
        }}
        onChange={(value) => useWorkspace.getState().setText(target, value)}
        onUpdate={(update) => {
          listeners.current.forEach((notify) => notify());
          if (
            !active ||
            !update.view.hasFocus ||
            (!update.selectionSet && !update.docChanged)
          )
            return;
          const { from, to } = update.state.selection.main;
          useWorkspace.setState({
            selection:
              from !== to
                ? {
                    tool: target,
                    revision: useWorkspace.getState().data[target].revision,
                    from,
                    to,
                    text: update.state.sliceDoc(from, to),
                  }
                : null,
          });
        }}
      />
      <AttentionOverlay
        cue={cue}
        active={active && ready}
        measure={measure}
        reveal={revealAttention}
        subscribe={subscribe}
      />
    </div>
  );
}
