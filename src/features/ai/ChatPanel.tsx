'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, BookOpen, Check, LoaderCircle, Sparkles, Square, Undo2, X } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { diffLines } from 'diff';
import { useWorkspace } from '../workspace/store';
import { undoChange, restoreChange, type BoardElement, type Change, type Proposal, type Tool } from '../workspace/model';

type Props = {
  collaborator: {ask:(prompt:string)=>Promise<void>;cancel:()=>void;pending:null|{proposal:Proposal;preview:string|BoardElement[]};approve:(runAfter?:boolean)=>Promise<void>;reject:()=>void;error:string};
  onReference:(id:string)=>void;
};
function BoardPreview({ elements }: { elements: BoardElement[] }) {
  const [url,setUrl] = useState('');
  useEffect(() => {
    let disposed=false; let objectUrl='';
    import('@excalidraw/excalidraw').then(async ({exportToBlob}) => {
      const blob=await exportToBlob({elements:elements as unknown as Parameters<typeof exportToBlob>[0]['elements'],appState:{exportBackground:true,viewBackgroundColor:'#fafaf7'},files:{},maxWidthOrHeight:700});
      if(!disposed){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}
    }).catch(()=>{});
    return()=>{disposed=true;if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[elements]);
  return url?<img className="proposal-board-image" src={url} alt="Preview of the proposed whiteboard changes"/>:<p>Preparing board preview…</p>;
}
export default function ChatPanel({collaborator,onReference}:Props){
  const markdownComponents=useMemo<Components>(()=>({a:({href,children})=>href?.startsWith('#source')?<button className="inline-link" onClick={()=>onReference(href.replace(/^#source[:=]/,''))}>{children}</button>:<a href={href} target="_blank" rel="noreferrer">{children}</a>}),[onReference]);
  const {data,activity,jobId,selection}=useWorkspace();
  const [prompt,setPrompt]=useState('');
  const [undoError,setUndoError]=useState('');
  const [inverse,setInverse]=useState<{change:Change;revision:number;current:string|BoardElement[]}|null>(null);
  const bottom=useRef<HTMLDivElement>(null);
  useEffect(()=>{bottom.current?.scrollIntoView({block:'nearest',behavior:'instant'});},[data.messages,collaborator.pending,activity]);
  const send=()=>{if(!prompt.trim()||jobId)return;const text=prompt;setPrompt('');void collaborator.ask(text);};
  const pending=collaborator.pending;
  const lastChange=[...data.changes].reverse().find(c=>!c.undone);
  const toolNames:Record<Tool,string>={board:'whiteboard',code:'Python',notes:'notes'};
  return <aside className="chat-panel" aria-label="AI study partner">
    <header className="chat-heading"><div className="partner-symbol"><Sparkles size={18}/></div><div><strong>Your study partner</strong><span>Here to think it through with you</span></div><button className="icon-button" aria-label="Close study partner" onClick={()=>useWorkspace.setState({chatOpen:false})}><X size={18}/></button></header>
    <div className="chat-scroll">
      {!data.messages.length&&<div className="chat-welcome"><BookOpen size={26}/><h2>Let’s make it click.</h2><p>Select a part of your drawing, code, or output. We can work through it together.</p><div className="starter-questions">{['Help me understand binary search','Give me a hint about my diagram','Explain the last Python result'].map(text=><button key={text} onClick={()=>void collaborator.ask(text)}>{text}<ArrowUp size={14}/></button>)}</div></div>}
      {data.messages.map(message=><article key={message.id} className={`chat-message ${message.role}`}><span className="message-author">{message.role==='user'?'You':'Study partner'}</span><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{message.text||'Thinking through your question…'}</ReactMarkdown></div>{message.sources?.length?<div className="message-sources">{message.sources.map(source=><button key={source.id} onClick={()=>onReference(source.id)}>{source.label}</button>)}</div>:null}{message.status==='interrupted'&&<small>Interrupted when the workspace reloaded.</small>}</article>)}
      {pending&&<section className="change-preview"><div className="proposal-title"><Sparkles size={16}/><strong>Proposed change to {toolNames[pending.proposal.target]}</strong></div><p>{pending.proposal.summary}</p>{typeof pending.preview==='string'?<pre className="code-diff">{diffLines(data[pending.proposal.target==='notes'?'notes':'code'].text,pending.preview).map((part,i)=><span key={i} className={part.added?'added':part.removed?'removed':''}>{part.value}</span>)}</pre>:<BoardPreview elements={pending.preview}/>}<div className="proposal-actions"><button className="button primary" onClick={()=>void collaborator.approve()}><Check size={14}/>Apply</button>{pending.proposal.target==='code'&&<button className="button" onClick={()=>void collaborator.approve(true)}>Apply & run</button>}<button className="button quiet" onClick={collaborator.reject}>Reject</button></div></section>}
      {inverse&&<section className="change-preview"><strong>Review restoring an earlier version</strong><p>You edited this {toolNames[inverse.change.target]} after the AI change. Restoring replaces those later edits. This restore will also be undoable.</p>{typeof inverse.current==='string'&&typeof inverse.change.before==='string'?<pre className="code-diff">{diffLines(inverse.current,inverse.change.before).map((part,i)=><span key={i} className={part.added?'added':part.removed?'removed':''}>{part.value}</span>)}</pre>:<><p>Current board</p><BoardPreview elements={inverse.current as BoardElement[]}/><p>After restore</p><BoardPreview elements={inverse.change.before as BoardElement[]}/></>}<div className="proposal-actions"><button className="button primary" onClick={()=>{try{useWorkspace.getState().setData(d=>restoreChange(d,inverse.change.id,inverse.revision));setInverse(null);setUndoError('');}catch(error){setUndoError((error as Error).message);setInverse(null);}}}>Restore this version</button><button className="button quiet" onClick={()=>setInverse(null)}>Keep current work</button></div></section>}
      {(collaborator.error||undoError)&&<p className="inline-error" role="alert">{collaborator.error||undoError}</p>}
      {activity&&<div className="activity" role="status"><LoaderCircle size={14} className="spin"/>{activity}</div>}
      <div ref={bottom}/>
    </div>
    {lastChange&&<div className="undo-strip"><button disabled={!!pending} onClick={()=>{try{useWorkspace.getState().setData(d=>undoChange(d,lastChange.id));setUndoError('');setInverse(null);}catch{const current=useWorkspace.getState().data;setUndoError('');setInverse({change:lastChange,revision:current[lastChange.target].revision,current:lastChange.target==='board'?current.board.elements:current[lastChange.target].text});}}}><Undo2 size={13}/>Undo last AI change</button></div>}
    <form className="chat-composer" onSubmit={e=>{e.preventDefault();send();}}>
      {selection&&<div className="context-chip"><span>{selection.runId?'Python output':toolNames[selection.tool]} · {selection.ids?`${selection.ids.length} elements`:'selection'}</span><button type="button" aria-label="Remove selection context" onClick={()=>useWorkspace.setState({selection:null})}><X size={12}/></button></div>}
      <textarea aria-label="Ask your study partner" value={prompt} placeholder="Ask a question, or share your thinking…" rows={3} onChange={e=>setPrompt(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send();}}}/>
      <div className="composer-bottom"><span>Gemini · your workspace in context</span>{jobId?<button type="button" className="send-button" aria-label="Stop AI request" onClick={collaborator.cancel}><Square size={15}/></button>:<button className="send-button" aria-label="Send message" disabled={!prompt.trim()}><ArrowUp size={18}/></button>}</div>
    </form>
  </aside>;
}
