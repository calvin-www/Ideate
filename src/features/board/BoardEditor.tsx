'use client';
import { useEffect, useRef, useState } from 'react';
import { Excalidraw, CaptureUpdateAction, exportToBlob } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI, NormalizedZoomValue } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { useWorkspace } from '../workspace/store';
import { adapters } from '../workspace/adapters';
import type { BoardElement } from '../workspace/model';
import { sampleBoard } from './adapter';

export default function BoardEditor({ active }: { active: boolean }) {
  const board = useWorkspace(s => s.data.board);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const hash = useRef('');
  const lastSelection = useRef('');
  useEffect(() => {
    if (!api) return;
    adapters.board = {
      focus: () => api.refresh(),
      reveal: ref => { api.updateScene({ appState: { selectedElementIds: Object.fromEntries((ref.ids ?? []).map(id => [id,true])) } }); api.scrollToContent(api.getSceneElements().filter(e => ref.ids?.includes(e.id))); },
      image: async () => {
        const elements = api.getSceneElements(); if (!elements.length) return;
        const blob = await exportToBlob({ elements, appState: { exportBackground: true, viewBackgroundColor: '#fafaf7' }, files: api.getFiles(), maxWidthOrHeight: 1000 });
        return new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob); });
      },
    };
    return () => { delete adapters.board; };
  }, [api]);
  useEffect(() => {
    if (!api) return;
    const value = JSON.stringify(board.elements);
    if (value !== hash.current) { hash.current = value; api.updateScene({ elements: board.elements as unknown as ExcalidrawElement[], captureUpdate: CaptureUpdateAction.IMMEDIATELY }); }
  }, [board.elements, api]);
  useEffect(() => {
    if (active) { requestAnimationFrame(() => { api?.refresh(); }); }
    else if (api) { adapters.board?.image?.().then(image => { useWorkspace.setState({ boardPreview: image ?? '' }); }).catch(() => {}); }
  }, [active, api]);
  return <div className="board-editor">
    <div className="editor-toolbar"><div><strong>Your whiteboard</strong><span>Draw it. Question it. Make it click.</span></div><button className="button quiet" onClick={async () => {
      if (board.elements.some(e => !e.isDeleted) && !window.confirm('Replace the board with the binary search example?')) return;
      useWorkspace.getState().setBoard(await sampleBoard()); setTimeout(() => api?.scrollToContent(undefined,{fitToViewport:true,viewportZoomFactor:0.75,animate:false}), 50);
    }}>Load binary search example</button><button className="button quiet" onClick={()=>api?.scrollToContent(undefined,{fitToViewport:true,viewportZoomFactor:0.75,animate:false})}>Fit drawing</button></div>
    <div className="excalidraw-frame"><Excalidraw excalidrawAPI={setApi}
      initialData={{ elements: board.elements as unknown as ExcalidrawElement[], appState: { viewBackgroundColor: '#fafaf7', currentItemStrokeColor: '#24342e', ...(board.viewport ? { scrollX: board.viewport.scrollX, scrollY: board.viewport.scrollY, zoom: { value: Math.max(0.1, Math.min(30, board.viewport.zoom)) as NormalizedZoomValue } } : {}) } }}
      UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false }, tools: { image: false } }}
      onPaste={data=>{
        if(Object.keys(data.files??{}).length || data.elements?.some(e=>e.type==='image'||e.type==='embeddable') || data.mixedContent?.some(e=>e.type==='imageUrl')){
          useWorkspace.setState({notice:'This whiteboard supports drawings, shapes, and text. Image and embedded-site pastes are not saved.'});
          return false;
        }
        return true;
      }}
      onChange={(elements, appState) => {
        const value = JSON.stringify(elements);
        if (value !== hash.current) { hash.current = value; useWorkspace.getState().setBoard(elements as unknown as BoardElement[]); }
        const ids = Object.keys(appState.selectedElementIds).filter(id => appState.selectedElementIds[id]);
        const selectionKey = `${ids.join(',')}:${useWorkspace.getState().data.board.revision}`;
        if (active && lastSelection.current !== selectionKey) {
          lastSelection.current = selectionKey;
          useWorkspace.setState({ selection: ids.length ? { tool: 'board', revision: useWorkspace.getState().data.board.revision, ids, text: elements.filter(e => ids.includes(e.id)).map(e => 'text' in e ? e.text : e.type).join(', ') } : null });
        }
        const viewport = { scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: appState.zoom.value };
        const old = useWorkspace.getState().data.board.viewport;
        if (!old || old.scrollX !== viewport.scrollX || old.scrollY !== viewport.scrollY || old.zoom !== viewport.zoom) useWorkspace.getState().setData(data => ({...data,board:{...data.board,viewport}}));
      }} />
    </div>
  </div>;
}
