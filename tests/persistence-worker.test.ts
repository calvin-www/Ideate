import { beforeEach, expect, it, vi } from "vitest";
import { createWorkspace, type Workspace } from "../src/features/workspace/model";

const storage = vi.hoisted(() => ({
  value: undefined as Workspace | undefined,
  writes: [] as Workspace[],
  holdFirst: undefined as Promise<void> | undefined,
}));

vi.mock("idb-keyval", () => ({
  set: async (_key: string, value: Workspace) => {
    if (storage.writes.length === 0) await storage.holdFirst;
    storage.writes.push(value);
    storage.value = value;
  },
}));

function workspaceWithImage(): Workspace {
  const data = createWorkspace();
  data.board.elements = [{
    id: "picture",
    type: "image",
    x: 20,
    y: 30,
    width: 100,
    height: 80,
    fileId: "file-one",
    status: "saved",
    scale: [1, 1],
    crop: null,
  }];
  data.board.files = {
    "file-one": {
      id: "file-one",
      mimeType: "image/png",
      created: 1,
      dataURL:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4ioAAAAASUVORK5CYII=",
    },
  };
  return data;
}

async function startWorker() {
  let receive!: (event: MessageEvent<{ id: number; data: Workspace }>) => void;
  const responses: Array<{ id: number; error?: string }> = [];
  vi.stubGlobal("self", {
    addEventListener: (_type: string, listener: typeof receive) => {
      receive = listener;
    },
    postMessage: (response: { id: number; error?: string }) => {
      responses.push(response);
    },
  });
  await import("../src/features/workspace/saveWorker");
  return {
    send: (id: number, data: Workspace) => receive({ data: { id, data } } as MessageEvent),
    responses,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  storage.value = undefined;
  storage.writes = [];
  storage.holdFirst = undefined;
});

it("orders rapid chat snapshots and keeps unchanged board assets in the saved record", async () => {
  let release!: () => void;
  storage.holdFirst = new Promise<void>((resolve) => {
    release = resolve;
  });
  const worker = await startWorker();
  const first = workspaceWithImage();
  first.messages = [{ id: "one", role: "assistant", text: "First chunk" }];
  const second = { ...first, messages: [{ id: "one", role: "assistant" as const, text: "Second chunk" }] };
  const third = { ...first, messages: [{ id: "one", role: "assistant" as const, text: "Final answer" }] };

  worker.send(1, first);
  worker.send(2, second);
  worker.send(3, third);
  await vi.waitFor(() => expect(storage.writes).toHaveLength(0));
  release();
  await vi.waitFor(() => expect(worker.responses).toHaveLength(3));

  expect(storage.writes.map((data) => data.messages[0].text)).toEqual([
    "First chunk",
    "Second chunk",
    "Final answer",
  ]);
  expect(storage.value?.board).toEqual(first.board);
  expect(storage.value?.messages).toEqual(third.messages);
  expect(worker.responses).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
});

it("keeps the last valid record after validation failure and accepts the next save", async () => {
  const worker = await startWorker();
  const valid = workspaceWithImage();
  worker.send(1, valid);
  await vi.waitFor(() => expect(worker.responses).toHaveLength(1));

  const invalid = { ...valid, code: { ...valid.code, text: "x".repeat(200_001) } };
  worker.send(2, invalid);
  await vi.waitFor(() => expect(worker.responses).toHaveLength(2));
  expect(worker.responses[1]).toMatchObject({ id: 2, error: expect.any(String) });
  expect(storage.value).toEqual(valid);

  worker.send(3, { ...valid, messages: [{ id: "retry", role: "user", text: "Retry" }] });
  await vi.waitFor(() => expect(worker.responses).toHaveLength(3));
  expect(worker.responses[2]).toEqual({ id: 3 });
  expect(storage.value?.messages[0].text).toBe("Retry");
  expect(storage.value?.board).toEqual(valid.board);
});

it("captures a save at dispatch and starts a fresh worker after a worker crash", async () => {
  class FakeWorker {
    onmessage: ((event: MessageEvent<{ id: number; error?: string }>) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessageerror: (() => void) | null = null;
    messages: Array<{ id: number; data: Workspace }> = [];
    terminated = false;

    constructor() {
      workers.push(this);
    }

    postMessage(value: { id: number; data: Workspace }) {
      this.messages.push(structuredClone(value));
    }

    terminate() {
      this.terminated = true;
    }
  }
  const workers: FakeWorker[] = [];
  vi.stubGlobal("Worker", FakeWorker);
  const { saveWorkspace } = await import("../src/features/workspace/persistence");
  const data = workspaceWithImage();
  const first = saveWorkspace(data);
  data.messages.push({ id: "later", role: "user", text: "Edited after dispatch" });
  expect(workers[0].messages[0].data.messages).toEqual([]);

  const rejection = expect(first).rejects.toThrow("stopped unexpectedly");
  workers[0].onerror?.();
  await rejection;
  expect(workers[0].terminated).toBe(true);

  const retry = saveWorkspace(data);
  expect(workers).toHaveLength(2);
  const { id } = workers[1].messages[0];
  workers[1].onmessage?.({ data: { id } } as MessageEvent);
  await expect(retry).resolves.toBeUndefined();
  expect(workers[1].messages[0].data.board).toEqual(data.board);
  expect(workers[1].messages[0].data.messages).toEqual(data.messages);
});

it("reports worker startup failure and can retry startup", async () => {
  let attempts = 0;
  class StartupWorker {
    onmessage: ((event: MessageEvent<{ id: number }>) => void) | null = null;
    onerror = null;
    onmessageerror = null;
    savedId = 0;

    constructor() {
      attempts++;
      if (attempts === 1) throw new Error("Worker unavailable");
      active = this;
    }

    postMessage(value: { id: number }) {
      this.savedId = value.id;
    }
  }
  let active!: StartupWorker;
  vi.stubGlobal("Worker", StartupWorker);
  const { saveWorkspace } = await import("../src/features/workspace/persistence");

  await expect(saveWorkspace(workspaceWithImage())).rejects.toThrow("Worker unavailable");
  const retry = saveWorkspace(workspaceWithImage());
  active.onmessage?.({ data: { id: active.savedId } } as MessageEvent);
  await expect(retry).resolves.toBeUndefined();
  expect(attempts).toBe(2);
});
