import { set } from "idb-keyval";
import { fitWorkspace } from "./backup";
import type { Workspace } from "./model";

type SaveRequest = { id: number; data: Workspace };
type SaveResponse = { id: number; error?: string };
type WorkerScope = {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<SaveRequest>) => void,
  ) => void;
  postMessage: (response: SaveResponse) => void;
};

const worker = self as unknown as WorkerScope;
let pending: Promise<unknown> = Promise.resolve();

worker.addEventListener("message", ({ data: { id, data } }) => {
  const next = pending.catch(() => undefined).then(async () => {
    await set("ideate-workspace-v1", fitWorkspace(data));
  });
  pending = next;
  void next.then(
    () => worker.postMessage({ id }),
    (error: unknown) =>
      worker.postMessage({
        id,
        error: error instanceof Error ? error.message : "Could not save locally.",
      }),
  );
});
