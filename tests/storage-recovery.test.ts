import { beforeEach, expect, it, vi } from 'vitest';
const db=vi.hoisted(()=>({value:undefined as unknown,write:vi.fn()}));
vi.mock('idb-keyval',()=>({get:async()=>db.value,set:async(_key:string,value:unknown)=>{db.write(value);db.value=value;}}));
beforeEach(()=>{vi.resetModules();db.value=undefined;db.write.mockReset();});
it('does not replace unreadable saved data after editing or retrying save',async()=>{
  db.value={schemaVersion:999,valuable:'original work'};
  const {useWorkspace,hydrateWorkspace,flushSave}=await import('../src/features/workspace/store');
  await hydrateWorkspace();
  useWorkspace.getState().setText('code','new scratch work');
  await flushSave();
  expect(db.write).not.toHaveBeenCalled();
  expect(useWorkspace.getState().recoveryNeeded).toBe(true);
  const {readSavedWorkspace}=await import('../src/features/workspace/persistence');
  expect(await readSavedWorkspace()).toEqual({schemaVersion:999,valuable:'original work'});
});
it('refuses to save content that the next reload would reject',async()=>{
  const {createWorkspace}=await import('../src/features/workspace/model');
  const {saveWorkspace}=await import('../src/features/workspace/persistence');
  const data=createWorkspace();data.code.text='x'.repeat(200001);
  await expect(saveWorkspace(data)).rejects.toThrow();
  expect(db.write).not.toHaveBeenCalled();
});
