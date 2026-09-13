import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// IndexedDB is a browser boundary; preference and request behavior use the real store.
vi.mock("idb-keyval", () => ({
  get: async () => undefined,
  set: async () => undefined,
}));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { localStorage: storage });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("study partner preferences", () => {
  it.each([
    [null, true],
    ["true", true],
    ["false", false],
    ["invalid", true],
  ])("hydrates saved preference %s as auto-apply %s", async (saved, expected) => {
    if (saved !== null) localStorage.setItem("ideate:auto-apply-changes", saved);
    const { hydrateWorkspace, useWorkspace } = await import("../src/features/workspace/store");
    await hydrateWorkspace();
    expect(useWorkspace.getState().autoApplyChanges).toBe(expected);
    expect(useWorkspace.getState().chatOpen).toBe(false);
  });

  it("keeps auto-apply on when browser preferences cannot be read", async () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("Storage unavailable");
      },
    });
    const { hydrateWorkspace, useWorkspace } = await import("../src/features/workspace/store");
    expect(useWorkspace.getState().autoApplyChanges).toBe(true);
    await hydrateWorkspace();
    expect(useWorkspace.getState().autoApplyChanges).toBe(true);
    expect(useWorkspace.getState().hydrated).toBe(true);
  });

  it("remembers an explicit opt-out after reloading the workspace", async () => {
    const first = await import("../src/features/workspace/store");
    await first.hydrateWorkspace();
    first.useWorkspace.getState().setAutoApplyChanges(false);
    vi.resetModules();
    const reloaded = await import("../src/features/workspace/store");
    await reloaded.hydrateWorkspace();
    expect(reloaded.useWorkspace.getState().autoApplyChanges).toBe(false);
  });

  it("full clear restores and persists auto-apply on", async () => {
    const first = await import("../src/features/workspace/store");
    await first.hydrateWorkspace();
    first.useWorkspace.getState().setAutoApplyChanges(false);
    first.useWorkspace.getState().clearData("all");
    expect(first.useWorkspace.getState().autoApplyChanges).toBe(true);
    vi.resetModules();
    const reloaded = await import("../src/features/workspace/store");
    await reloaded.hydrateWorkspace();
    expect(reloaded.useWorkspace.getState().autoApplyChanges).toBe(true);
  });

  it.each(["board", "code", "notes"] as const)("clearing %s preserves an explicit opt-out", async (scope) => {
    const { hydrateWorkspace, useWorkspace } = await import("../src/features/workspace/store");
    await hydrateWorkspace();
    useWorkspace.getState().setAutoApplyChanges(false);
    useWorkspace.getState().clearData(scope);
    expect(useWorkspace.getState().autoApplyChanges).toBe(false);
  });
});

describe("study partner panel ownership", () => {
  it.each([
    { voice: false, chatOpen: false },
    { voice: true, chatOpen: false },
    { voice: false, chatOpen: true },
    { voice: true, chatOpen: true },
  ])("preserves chatOpen=$chatOpen during a voice=$voice request", async ({ voice, chatOpen }) => {
    const { useWorkspace } = await import("../src/features/workspace/store");
    const { createCollaborator } = await import("../src/features/ai/useCollaborator");
    useWorkspace.setState({ chatOpen, view: "notes" });
    const collaborator = createCollaborator({
      request: async () => new Response(
        [{ type: "text", text: "Keep comparing the bounds." }, { type: "done", continuation: { contents: [] } }]
          .map((event) => JSON.stringify(event)).join("\n") + "\n",
      ),
      voice: { enabled: () => voice, context: () => ({}), play: async () => {} },
      runCode: vi.fn(),
      onPending: vi.fn(),
      onError: vi.fn(),
    });
    const request = collaborator.ask("Explain these notes.");
    expect(useWorkspace.getState().chatOpen).toBe(chatOpen);
    await request;
    expect(useWorkspace.getState().data.messages.at(-1)).toMatchObject({
      text: "Keep comparing the bounds.",
      status: "complete",
    });
    expect(useWorkspace.getState().chatOpen).toBe(chatOpen);
  });
});
