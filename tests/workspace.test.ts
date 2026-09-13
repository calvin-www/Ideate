import { describe, it, expect } from 'vitest';
import { applyProposal, createWorkspace, editText, undoChange, restoreChange, compactWorkspace, validateImport } from '../src/features/workspace/model';
import type { Proposal } from '../src/features/workspace/model';

function proposal(baseRevision = 0): Proposal {
  return { id: 'op1', jobId: 'job1', target: 'code', baseRevision, summary: 'Add example',
    replacements: [{ from: 0, to: 0, text: '# New example\n' }], sources: [], sourceRevisions: {} };
}
describe('workspace edit boundaries', () => {
  it('retains recent history and linked sources while keeping a long session reloadable', () => {
    const data=createWorkspace();
    data.messages=Array.from({length:510},(_,i)=>({id:`m${i}`,role:i%2?'assistant':'user',text:`message ${i}`}));
    data.runs=Array.from({length:105},(_,i)=>({id:`r${i}`,code:'print(42)',revision:0,output:'42',status:'success',startedAt:i,durationMs:1}));
    data.references=Array.from({length:2010},(_,i)=>({id:`ref${i}`,tool:'code',revision:0,label:'Python',excerpt:`source ${i}`}));
    data.notes.text='[Important earlier result](#source:ref0)';
    const saved=validateImport(compactWorkspace(data));
    expect(saved.messages.at(-1)?.text).toBe('message 509');
    expect(saved.messages.length).toBeLessThanOrEqual(500);
    expect(saved.runs.at(-1)?.id).toBe('r104');
    expect(saved.runs.length).toBeLessThanOrEqual(100);
    expect(saved.references.some(ref=>ref.id==='ref0')).toBe(true);
    expect(saved.references.length).toBeLessThanOrEqual(2000);
  });
  it('rejects a stale AI edit and retains the manual text', () => {
    const data = editText(createWorkspace(), 'code', 'my manual work');
    expect(() => applyProposal(data, proposal(), 'job1')).toThrow(/changed/i);
    expect(data.code.text).toBe('my manual work');
  });
  it('applies once and refuses duplicate operations', () => {
    const before = createWorkspace();
    const after = applyProposal(before, proposal(), 'job1');
    expect(after.code.text).toBe('# New example\n' + before.code.text);
    expect(after.code.revision).toBe(1);
    expect(() => applyProposal(after, proposal(), 'job1')).toThrow(/already/i);
  });
  it('does not apply a cancelled job', () => {
    expect(() => applyProposal(createWorkspace(), proposal(), null)).toThrow(/cancel/i);
  });
  it('rejects stale source context even when the target has not changed', () => {
    const data = editText(createWorkspace(), 'notes', 'New interpretation');
    expect(() => applyProposal(data, { ...proposal(), sourceRevisions: { notes: 0 } }, 'job1')).toThrow(/source/i);
  });
  it('rejects overlapping replacement ranges', () => {
    expect(() => applyProposal(createWorkspace(), { ...proposal(), replacements: [
      { from: 0, to: 5, text: 'one' }, { from: 3, to: 8, text: 'two' },
    ] }, 'job1')).toThrow(/overlap/i);
  });
  it('undoes an accepted edit as a new revision', () => {
    const before = createWorkspace();
    const after = undoChange(applyProposal(before, proposal(), 'job1'), 'op1');
    expect(after.code.text).toBe(before.code.text);
    expect(after.code.revision).toBe(2);
  });
  it('preserves later manual edits when undo would conflict', () => {
    const after = editText(applyProposal(createWorkspace(), proposal(), 'job1'), 'code', 'keep this');
    expect(() => undoChange(after, 'op1')).toThrow(/changed/i);
    expect(after.code.text).toBe('keep this');
  });
  it('restores empty documents and interrupts unfinished runs on import', () => {
    const data = editText(createWorkspace(), 'code', '');
    data.runs = [{ id: 'r1', code: 'while True: pass', revision: 1, output: '', status: 'running', startedAt: 1, durationMs: 0 }];
    const restored = validateImport(JSON.parse(JSON.stringify(data)));
    expect(restored.code.text).toBe('');
    expect(restored.runs[0].status).toBe('interrupted');
  });
  it('rejects an invalid or future workspace before replacing data', () => {
    expect(() => validateImport({ schemaVersion: 500 })).toThrow();
    expect(() => validateImport({ ...createWorkspace(), code: { text: 3 } })).toThrow();
  });
  it('rejects invalid drawing geometry and mismatched undo snapshots', () => {
    const data = createWorkspace();
    data.board.elements = [{id:'bad',type:'not-a-drawing',points:'not-points'}];
    expect(() => validateImport(data)).toThrow();
    data.board.elements = [{id:'arrow',type:'arrow',x:0,y:0,width:20,height:20,points:'bad'}];
    expect(() => validateImport(data)).toThrow();
    const changed = applyProposal(createWorkspace(),proposal(),'job1');
    changed.changes[0].before = [];
    expect(() => validateImport(changed)).toThrow();
  });
  it('restores an older version only after reviewing the current revision', () => {
    const before=createWorkspace();
    const edited=editText(applyProposal(before,proposal(),'job1'),'code','later manual edit');
    expect(() => restoreChange(edited,'op1',1)).toThrow(/changed/i);
    const restored=restoreChange(edited,'op1',2);
    expect(restored.code.text).toBe(before.code.text);
    expect(restored.changes[0].undone).toBe(true);
    expect(restored.changes.at(-1)?.before).toBe('later manual edit');
    expect(undoChange(restored,restored.changes.at(-1)!.id).code.text).toBe('later manual edit');
  });
});
