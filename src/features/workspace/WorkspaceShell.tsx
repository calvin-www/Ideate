'use client';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Check, Download, Home, LoaderCircle, Monitor, PenTool, Sparkles, Upload, X } from 'lucide-react';
import { useWorkspace, hydrateWorkspace, flushSave } from './store';
import { type ArtifactRef, type Tool, type View } from './model';
import { downloadFile, readSavedWorkspace } from './persistence';
import { adapters } from './adapters';
import { useExecution } from '../execution/useExecution';
import { RUNNER_URL } from '../execution/runner-client';
import { useCollaborator } from '../ai/useCollaborator';
import ChatPanel from '../ai/ChatPanel';
import CodePanel from '../code/CodePanel';
import NotePanel from '../notes/NotePanel';

const BoardEditor = dynamic(() => import('../board/BoardEditor'), { ssr:false, loading:()=> <div className="loading-tool"><LoaderCircle className="spin"/>Getting your whiteboard ready…</div> });
const DeskScene = dynamic(() => import('../desk/DeskScene'), { ssr:false, loading:()=> <div className="loading-tool"><LoaderCircle className="spin"/>Setting out your desk…</div> });
const nav: {id:View;label:string;icon:typeof Home}[] = [{id:'desk',label:'Desk',icon:Home},{id:'board',label:'Whiteboard',icon:PenTool},{id:'code',label:'Computer',icon:Monitor},{id:'notes',label:'Journal',icon:BookOpen}];

export default function WorkspaceShell() {
  const state = useWorkspace();
  const {data,view,visited,chatOpen,hydrated,saveStatus,saveError,selection,notice} = state;
  const execution = useExecution();
  const collaborator = useCollaborator(execution.runCode, execution.stopCode);
  const [source,setSource]=useState<ArtifactRef|null>(null);
  const [reducedMotion,setReducedMotion]=useState(false);
  const [flat,setFlat]=useState(false);
  const importInput=useRef<HTMLInputElement>(null);
  const lastTool=useRef<Tool|null>(null);
  const sourceDialog=useRef<HTMLElement>(null);
  const sourceOpener=useRef<HTMLElement|null>(null);
  useEffect(()=>{void hydrateWorkspace(); const media=matchMedia('(prefers-reduced-motion: reduce)'); const change=()=>setReducedMotion(media.matches);change();media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  useEffect(()=>{
    const save=()=>{void flushSave();};
    const onKey=(event:KeyboardEvent)=>{
      if(event.isComposing)return;
      const composer=(event.target as HTMLElement)?.closest('.chat-composer');
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();save();}
      if(event.altKey&&['1','2','3'].includes(event.key)){event.preventDefault();useWorkspace.getState().navigate((['board','code','notes'] as Tool[])[Number(event.key)-1]);}
      if((event.ctrlKey||event.metaKey)&&event.key==='Enter'&&!composer&&useWorkspace.getState().view==='code'){event.preventDefault();void execution.runCode().catch(error=>useWorkspace.setState({notice:error.message}));}
      if(event.key==='Escape'&&!event.defaultPrevented){if(source){setSource(null);}else if(composer){useWorkspace.setState({chatOpen:false});}else if(!(event.target as HTMLElement)?.closest('.excalidraw'))useWorkspace.getState().navigate('desk');}
    };
    window.addEventListener('keydown',onKey);window.addEventListener('pagehide',save);document.addEventListener('visibilitychange',save);
    return()=>{window.removeEventListener('keydown',onKey);window.removeEventListener('pagehide',save);document.removeEventListener('visibilitychange',save);};
  },[execution.runCode,source]);
  useEffect(()=>{if(view==='desk'&&lastTool.current){requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>(`[data-open="${lastTool.current}"]`)?.focus({preventScroll:true}));}else if(view!=='desk'){lastTool.current=view;}},[view]);
  useEffect(()=>{
    if(!source)return;
    const previous=sourceOpener.current;
    const dialog=sourceDialog.current;
    const trap=(event:KeyboardEvent)=>{if(event.key!=='Tab'||!dialog)return;const buttons=Array.from(dialog.querySelectorAll<HTMLElement>('button,a[href],[tabindex="0"]'));const first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}};
    dialog?.addEventListener('keydown',trap);
    return()=>{dialog?.removeEventListener('keydown',trap);previous?.focus({preventScroll:true});};
  },[source]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>useWorkspace.setState({notice:''}),7000);return()=>clearTimeout(timer);},[notice]);
  const openSource=useCallback((id:string)=>{
    const data=useWorkspace.getState().data;
    const ref=data.references.find(r=>r.id===id)??data.messages.flatMap(m=>m.sources??[]).find(r=>r.id===id)??data.changes.flatMap(change=>change.sources).find(r=>r.id===id);
    if(ref){sourceOpener.current=document.activeElement as HTMLElement|null;setSource(ref);}else useWorkspace.setState({notice:'This source is not available in the saved workspace.'});
  },[]);
  const exportWorkspace=()=>downloadFile('ideate-workspace.json',JSON.stringify(useWorkspace.getState().data,null,2),'application/json');
  const open=(tool:View)=>useWorkspace.getState().navigate(tool);
  return <div className="app-shell">
    <header className="app-header">
      <a className="brand" href="#" onClick={e=>{e.preventDefault();open('desk');}} aria-label="Ideate, back to desk"><svg width="30" height="33" viewBox="0 0 30 33" fill="none" aria-hidden="true"><path d="M8 26V8c0-5 12-5 12 0v18M3 19h22M8 10l12 12" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"/><circle cx="25" cy="5" r="2" fill="currentColor"/></svg><span>ideate<span className="brand-dot">.</span></span></a>
      <nav className="tool-nav" aria-label="Workspace tools">{nav.map(item=><button key={item.id} className={view===item.id?'active':''} aria-label={item.label} title={item.id==='desk'?'Back to desk':`${item.label} (Alt+${['board','code','notes'].indexOf(item.id)+1})`} aria-current={view===item.id?'page':undefined} onClick={()=>open(item.id)} data-open={item.id}><item.icon size={16}/><span>{item.label}</span></button>)}</nav>
      <div className="header-actions"><span className={`save-status ${saveStatus}`} title={saveError||'Saved in this browser'} aria-live="polite">{saveStatus==='saving'?<LoaderCircle size={13} className="spin"/>:<Check size={13}/>}<span>{saveStatus==='saved'?'Saved locally':saveStatus==='error'?'Save needs attention':saveStatus==='loading'?'Loading':'Saving'}</span></span><button className="icon-button" title="Export workspace" aria-label="Export workspace" onClick={exportWorkspace}><Download size={17}/></button><button className="icon-button" title="Import workspace" aria-label="Import workspace" onClick={()=>importInput.current?.click()}><Upload size={17}/></button><button className={`partner-toggle ${chatOpen?'selected':''}`} aria-label="Toggle study partner" aria-expanded={chatOpen} onClick={()=>useWorkspace.setState({chatOpen:!chatOpen})}><Sparkles size={16}/><span>Study partner</span></button></div>
    </header>
    <input ref={importInput} type="file" hidden accept=".json,application/json" onChange={async event=>{
      const file=event.target.files?.[0];event.target.value='';if(!file)return;
      try{if(file.size>15_000_000)throw new Error('Workspace file exceeds 15 MB.');const {prepareWorkspaceImport}=await import('./importWorkspace');const imported=await prepareWorkspaceImport(JSON.parse(await file.text()));if(!window.confirm('Replace this workspace with the imported copy? Export first if you want to keep your current work.'))return;collaborator.cancel();execution.stopCode();useWorkspace.setState({data:imported,selection:null,boardPreview:'',recoveryNeeded:false,saveError:'',notice:'Workspace imported.'});void flushSave();}catch(error){useWorkspace.setState({notice:error instanceof Error?error.message:'Could not import this workspace.'});}
    }}/>
    {saveError&&<div className="storage-error" role="alert">{saveError}<button onClick={exportWorkspace}>Export current work</button>{state.recoveryNeeded?<button onClick={async()=>{try{downloadFile('ideate-recovery.json',JSON.stringify(await readSavedWorkspace(),null,2),'application/json');}catch{useWorkspace.setState({notice:'Browser storage is unavailable. Your saved data has not been replaced.'});}}}>Download saved recovery copy</button>:<button onClick={()=>void flushSave()}>Retry save</button>}</div>}
    <div className="workspace-body">
      <main className={`workspace-main ${view==='desk'?'desk-view':'tool-view'}`}>
        {!hydrated?<div className="loading-tool"><LoaderCircle className="spin"/>Opening your workspace…</div>:<>
          {view==='desk'?<section className="desk-home" aria-label="Your study desk">
            <div className="desk-intro"><div><p className="quiet-label">Your quiet corner</p><h1>A little space for<br/>big understanding.</h1><p>Sketch an idea. Try it in code.<br/>Keep the part that clicks.</p></div><button className="view-switch" onClick={()=>setFlat(!flat)}>{flat?'Show 3D desk':'Use simple view'}</button></div>
            <div className="scene-container">{flat?<div className="flat-desk">{nav.filter(item=>item.id!=='desk').map(item=><button key={item.id} onClick={()=>open(item.id)}><item.icon size={40}/><strong>{item.label}</strong><span>{item.id==='board'?'Make your thinking visible':item.id==='code'?'Turn a thought into an experiment':'Keep what you discover'}</span></button>)}</div>:<DeskScene onOpen={open} codePreview={data.code.text} notePreview={data.notes.text} boardPreview={state.boardPreview||undefined} runStatus={data.runs.at(-1)?.status} reducedMotion={reducedMotion}/>}</div>
            <div className="desk-footer"><span><span className="small-sun">✳</span>Choose an object. Your work stays right here.</span><button onClick={()=>{open('board');}}>Start at the whiteboard <span aria-hidden="true">↗</span></button></div>
          </section>:<div className="tool-context"><button className="back-button" onClick={()=>open('desk')}><ArrowLeft size={15}/>Back to desk</button><span className="workspace-title">{data.title}</span><span className="tool-subtitle">{view==='board'?'A thought, made visible':view==='code'?'Try it. See what happens.':'Keep the part that clicks.'}</span></div>}
          {visited.includes('board')&&<section className="tool-container" hidden={view!=='board'} inert={view!=='board'} aria-label="Whiteboard tool"><BoardEditor active={view==='board'}/></section>}
          {visited.includes('code')&&<section className="tool-container" hidden={view!=='code'} inert={view!=='code'} aria-label="Python tool"><CodePanel active={view==='code'} runCode={execution.runCode} stopCode={execution.stopCode} runtimeStatus={execution.runtimeStatus}/></section>}
          {visited.includes('notes')&&<section className="tool-container" hidden={view!=='notes'} inert={view!=='notes'} aria-label="Notebook tool"><NotePanel active={view==='notes'} onReference={openSource}/></section>}
          {view!=='desk'&&<div className="study-actions"><span>{selection?'Work with your selection':'Think it through together'}</span>{[{label:'Explain visually',prompt:'Explain this visually using the whiteboard.'},{label:'Give me a hint',prompt:'Give me one helpful hint about this, without the full solution.'},{label:'Show Python',prompt:'Show this in Python with trace prints. Propose an edit to my code.'},{label:'Add to notes',prompt:'Add what we learned from this to my notes, with source references.'}].map(action=><button key={action.label} disabled={!!state.jobId} onClick={()=>void collaborator.ask(action.prompt)}>{action.label}</button>)}</div>}
        </>}
      </main>
      {chatOpen&&<ChatPanel collaborator={collaborator} onReference={openSource}/>} 
    </div>
    <iframe ref={execution.iframe} src={RUNNER_URL} title="Isolated Python runner" className="runner-frame" sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" aria-hidden="true" tabIndex={-1}/>
    {notice&&<div className="toast" role="status">{notice}<button aria-label="Dismiss notification" onClick={()=>useWorkspace.setState({notice:''})}><X size={15}/></button></div>}
    {source&&<div className="modal-scrim" onClick={()=>setSource(null)}><section ref={sourceDialog} className="source-dialog" role="dialog" aria-modal="true" aria-labelledby="source-title" onClick={e=>e.stopPropagation()}><button className="icon-button modal-close" aria-label="Close source" onClick={()=>setSource(null)} autoFocus><X size={18}/></button><p className="quiet-label">Saved source · revision {source.revision}</p><h2 id="source-title">{source.label}</h2>{data[source.tool].revision!==source.revision&&<p className="source-outdated">This source has changed. The excerpt below is from the original revision.</p>}<pre>{source.excerpt||'A visual selection from the whiteboard.'}</pre><button className="button primary" onClick={()=>{open(source.tool);if(data[source.tool].revision===source.revision)setTimeout(()=>adapters[source.tool]?.reveal(source),100);setSource(null);}}>Open {source.tool==='code'?'Python':source.tool==='board'?'whiteboard':'journal'}</button></section></div>}
  </div>;
}

