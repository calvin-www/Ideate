"use client";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { usePresentation, cancelPresentation } from "./presentation";
import styles from "./Presentation.module.css";

const codeExtensions = [python()];
const noteExtensions = [markdown(), EditorView.lineWrapping];
export default function TextPresentation({ target }: { target: "code" | "notes" }) {
  const current = usePresentation((s) => s.current);
  if (current?.proposal.target !== target || current.text === undefined) return null;
  return <div className={styles.text} aria-label="Study partner writing preview" onPointerDown={cancelPresentation}>
    <span className={styles.label}>Writing · click to take over</span>
    <CodeMirror value={current.text} readOnly editable={false} height="100%" extensions={target === "code" ? codeExtensions : noteExtensions}
      basicSetup={{ lineNumbers: target === "code", foldGutter: false, highlightActiveLine: false }} />
  </div>;
}
