import { get, set } from "idb-keyval";
import { validateImport, type Workspace } from "./model";
import { fitWorkspace } from "./backup";

export class SaveQueue<T> {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly write: (value: T) => Promise<unknown>) {}
  save(value: T): Promise<unknown> {
    const next = this.pending
      .catch(() => undefined)
      .then(() => this.write(value));
    this.pending = next;
    return next;
  }
}
const KEY = "ideate-workspace-v1";
const queue = new SaveQueue<Workspace>((data) => set(KEY, data));
let saveWorker: Worker | undefined;
let nextSaveId = 0;
const waiting = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();

function workerForSave(): Worker {
  if (saveWorker) return saveWorker;
  const worker = new Worker(new URL("./saveWorker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = ({ data }: MessageEvent<{ id: number; error?: string }>) => {
    const save = waiting.get(data.id);
    if (!save) return;
    waiting.delete(data.id);
    if (data.error) save.reject(new Error(data.error));
    else save.resolve();
  };
  const fail = () => {
    worker.terminate();
    if (saveWorker === worker) saveWorker = undefined;
    for (const save of waiting.values())
      save.reject(new Error("Workspace save worker stopped unexpectedly."));
    waiting.clear();
  };
  worker.onerror = fail;
  worker.onmessageerror = fail;
  saveWorker = worker;
  return worker;
}

export function readSavedWorkspace(): Promise<unknown> {
  return get(KEY);
}
export async function loadWorkspace(): Promise<Workspace | undefined> {
  const value = await get(KEY);
  return value === undefined ? undefined : validateImport(value);
}
export async function saveWorkspace(data: Workspace): Promise<unknown> {
  if (typeof Worker === "undefined")
    return queue.save(fitWorkspace(structuredClone(data)));

  const worker = workerForSave();
  const id = ++nextSaveId;
  return new Promise<void>((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    try {
      worker.postMessage({ id, data });
    } catch (error) {
      waiting.delete(id);
      reject(error);
    }
  });
}
export function downloadFile(
  filename: string,
  content: string,
  type = "text/plain",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
