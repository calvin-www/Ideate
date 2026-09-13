import { get, set } from 'idb-keyval';
import { validateImport, validateWorkspace, type Workspace } from './model';

export class SaveQueue<T> {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly write: (value: T) => Promise<unknown>) {}
  save(value: T): Promise<unknown> {
    const next = this.pending.catch(() => undefined).then(() => this.write(value));
    this.pending = next;
    return next;
  }
}
const KEY = 'ideate-workspace-v1';
const queue = new SaveQueue<Workspace>(data => set(KEY, data));
export function readSavedWorkspace(): Promise<unknown> { return get(KEY); }
export async function loadWorkspace(): Promise<Workspace | undefined> {
  const value = await get(KEY);
  return value === undefined ? undefined : validateImport(value);
}
export async function saveWorkspace(data: Workspace) { return queue.save(validateWorkspace(structuredClone(data))); }
export function downloadFile(filename: string, content: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
