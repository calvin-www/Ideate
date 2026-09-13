'use client';
import { useEffect, useRef } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { useWorkspace } from './store';
import { adapters } from './adapters';

const theme = EditorView.theme({
  '&': { backgroundColor: '#fafaf7', color: '#26382f', height: '100%', fontSize: '14px' },
  '.cm-content': { fontFamily: "'Cascadia Code', 'SFMono-Regular', Consolas, monospace", padding: '22px 0', caretColor: '#355b46' },
  '.cm-line': { padding: '0 22px', lineHeight: '1.8' },
  '.cm-gutters': { backgroundColor: '#f2f3ed', color: '#8a938c', border: 'none', padding: '0 5px' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#edf1e7' },
  '.cm-scroller': { overflow: 'auto' },
  '&.cm-focused': { outline: 'none' },
});
const documentLimit = EditorState.transactionFilter.of(transaction=>{
  if(transaction.docChanged&&transaction.newDoc.length>200_000){
    queueMicrotask(()=>useWorkspace.setState({notice:'This document has reached its 200,000 character limit. Download a copy before starting a smaller example.'}));
    return [];
  }
  return transaction;
});
const pythonExtensions = [python(), theme, documentLimit];
const noteExtensions = [markdown(), theme, documentLimit, EditorView.lineWrapping];
export default function TextEditor({ target, active }: { target: 'code' | 'notes'; active: boolean }) {
  const text = useWorkspace(s => s.data[target].text);
  const editor = useRef<ReactCodeMirrorRef>(null);
  useEffect(() => {
    adapters[target] = { focus: () => editor.current?.view?.focus(), reveal: ref => {
      const view = editor.current?.view; if (!view) return;
      const from = Math.max(0, Math.min(ref.from ?? 0, view.state.doc.length));
      const to = Math.max(from, Math.min(ref.to ?? from, view.state.doc.length));
      view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true }); view.focus();
    } };
    return () => { delete adapters[target]; };
  }, [target]);
  useEffect(() => { if (active) requestAnimationFrame(() => { editor.current?.view?.requestMeasure(); editor.current?.view?.focus(); }); }, [active]);
  return <CodeMirror ref={editor} aria-label={target === 'code' ? 'Python source' : 'Markdown source'}
    value={text} height="100%" extensions={target === 'code' ? pythonExtensions : noteExtensions}
    basicSetup={{ lineNumbers: target === 'code', foldGutter: target === 'code', highlightActiveLine: true, autocompletion: target === 'code' }}
    onChange={value => useWorkspace.getState().setText(target, value)}
    onUpdate={update => {
      if (!active || !update.view.hasFocus || (!update.selectionSet && !update.docChanged)) return;
      const { from, to } = update.state.selection.main;
      useWorkspace.setState({ selection: from !== to ? { tool: target, revision: useWorkspace.getState().data[target].revision, from, to, text: update.state.sliceDoc(from, to) } : null });
    }} />;
}
