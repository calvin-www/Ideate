"use client";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { usePresentation, takeOverPresentation } from "./presentation";
import styles from "./Presentation.module.css";

const codeExtensions = [python()];
const noteExtensions = [markdown(), EditorView.lineWrapping];
export default function TextPresentation({ target }: { target: "code" | "notes" }) {
  const current = usePresentation((s) => s.current);
  if (current?.proposal.target !== target || current.text === undefined) return null;
  const recordVisible = (text: string) => {
    if (usePresentation.getState().current?.proposal.id === current.proposal.id)
      usePresentation.setState({ paintedText: { proposalId: current.proposal.id, text } });
  };
  return <div className={styles.text} aria-label="Study partner writing preview" onPointerDown={takeOverPresentation}>
    <span className={styles.label}>Writing · click to take over</span>
    <CodeMirror value={current.text} readOnly editable={false} height="100%" extensions={target === "code" ? codeExtensions : noteExtensions}
      onCreateEditor={(view) => {
        recordVisible(view.state.doc.toString());
        const position = Math.min(current.proposal.replacements?.[0]?.from ?? 0, view.state.doc.length);
        view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: "center" }) });
      }}
      onUpdate={(update) => {
        if (!update.docChanged) return;
        recordVisible(update.state.doc.toString());
        // The React wrapper replaces the whole document for value updates.
        // Locate the actual changed suffix rather than following that full
        // replacement to the document's end.
        const before = update.startState.doc.toString(), after = update.state.doc.toString();
        let position = after.length, previous = before.length;
        while (position > 0 && previous > 0 && after[position - 1] === before[previous - 1]) { position--; previous--; }
        requestAnimationFrame(() => {
          if (!update.view.dom.isConnected) return;
          position = Math.min(position, update.view.state.doc.length);
          update.view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: "center" }) });
        });
      }}
      basicSetup={{ lineNumbers: target === "code", foldGutter: false, highlightActiveLine: true }} />
  </div>;
}
