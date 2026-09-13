import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { BoardElement, BoardPatch } from "../src/features/workspace/model";

let server: ViteDevServer;
let browser: Browser;
let page: Page;
let cacheDirectory: string;
beforeAll(async () => {
  cacheDirectory = await mkdtemp(join(tmpdir(), "ideate-board-tests-"));
  server = await createServer({
    configFile: false,
    root: resolve("."),
    cacheDir: cacheDirectory,
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0 },
    optimizeDeps: { include: ["@excalidraw/excalidraw"] },
    plugins: [
      {
        name: "adapter-test-page",
        configureServer(vite) {
          vite.middlewares.use((request, response, next) => {
            if (request.url !== "/") return next();
            response.setHeader("Content-Type", "text/html");
            response.end(
              "<!doctype html><html><body>Board adapter test</body></html>",
            );
          });
        },
      },
    ],
  });
  await server.listen();
  browser = await chromium.launch(
    existsSync(chromium.executablePath())
      ? { headless: true }
      : { channel: "chrome", headless: true },
  );
  page = await browser.newPage();
  await page.goto(server.resolvedUrls!.local[0]);
  await page.evaluate(
    "import('/src/features/board/adapter.ts').then(module => { window.buildBoardPatch = module.buildBoardPatch; window.normalizeBoardImport = module.normalizeBoardImport; window.sampleBoard = module.sampleBoard; })",
  );
  await patch([], {});
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await server?.close();
  if (
    cacheDirectory &&
    dirname(resolve(cacheDirectory)) === resolve(tmpdir()) &&
    basename(cacheDirectory).startsWith("ideate-board-tests-")
  ) {
    await rm(cacheDirectory, { recursive: true, force: true });
  }
}, 30_000);

async function patch(
  elements: BoardElement[],
  changes: BoardPatch,
): Promise<BoardElement[]> {
  return page.evaluate(
    async ({ elements, changes }) => {
      const bridge = window as unknown as {
        buildBoardPatch: (
          elements: BoardElement[],
          changes: BoardPatch,
        ) => Promise<BoardElement[]>;
      };
      return bridge.buildBoardPatch(elements, changes);
    },
    { elements, changes },
  );
}
const shape = { type: "rectangle", x: 20, y: 20, width: 100, height: 80 };
async function connectedScene() {
  const elements = await patch([], {
    additions: [shape, { ...shape, x: 300 }],
  });
  return patch(elements, {
    additions: [
      {
        type: "arrow",
        x: 125,
        y: 60,
        width: 170,
        height: 1,
        startId: elements[0].id,
        endId: elements[1].id,
      },
    ],
  });
}

describe("real Excalidraw board adapter", () => {
  it("preserves leftward, upward, and straight connector directions", async () => {
    for (const [dx, dy] of [[0, 100], [100, 0], [-80, 100], [80, -100]]) {
      const result = await patch([], { additions: [{ type: "arrow", x: 450, y: 295, width: dx, height: dy }] });
      const arrow = result.find((element) => element.type === "arrow")!;
      const points = arrow.points as number[][];
      // Native Excalidraw conversion insets endpoints by a half stroke width.
      for (const [actual, expected] of [[points.at(-1)![0] - points[0][0], dx], [points.at(-1)![1] - points[0][1], dy]]) {
        expect(Math.sign(actual)).toBe(Math.sign(expected));
        expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1.5);
      }
      expect(Number(arrow.width)).toBeGreaterThanOrEqual(0);
      expect(Number(arrow.height)).toBeGreaterThanOrEqual(0);
    }
    await expect(patch([], { additions: [{ type: "arrow", x: 0, y: 0, width: 0, height: 0 }] })).rejects.toThrow();
  });
  it("creates an editable pen stroke with derived geometry and preserves existing work", async () => {
    const existing = await patch([], { additions: [shape] });
    const result = await patch(existing, {
      additions: [
        {
          type: "freedraw",
          points: [
            { x: 100, y: 100 },
            { x: 80, y: 140 },
            { x: 150, y: 120 },
          ],
          strokeColor: "#c92a2a",
          strokeWidth: 3,
        },
      ],
    });
    expect(result[0]).toEqual(existing[0]);
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      type: "freedraw",
      x: 100,
      y: 100,
      width: 70,
      height: 40,
      points: [
        [0, 0],
        [-20, 40],
        [50, 20],
      ],
      strokeColor: "#c92a2a",
      strokeWidth: 3,
      backgroundColor: "transparent",
      pressures: [],
      simulatePressure: true,
      isDeleted: false,
    });
    expect(result[1].id).not.toBe(existing[0].id);
  });

  it("keeps horizontal and vertical pen strokes through import, move, and delete", async () => {
    const elements = await patch([], {
      additions: [
        {
          type: "freedraw",
          points: [
            { x: 10, y: 20 },
            { x: 80, y: 20 },
          ],
        },
        {
          type: "freedraw",
          points: [
            { x: 90, y: 20 },
            { x: 90, y: 90 },
          ],
        },
      ],
    });
    expect(elements).toHaveLength(2);
    expect(elements[0]).toMatchObject({ width: 70, height: 0 });
    expect(elements[1]).toMatchObject({ width: 0, height: 70 });
    const imported = await page.evaluate(async (elements) => {
      const bridge = window as unknown as {
        normalizeBoardImport: (
          elements: BoardElement[],
        ) => Promise<BoardElement[]>;
      };
      return bridge.normalizeBoardImport(elements);
    }, elements);
    expect(imported).toEqual(elements);
    const moved = await patch(imported, {
      updates: [{ id: elements[0].id, x: 50, strokeColor: "#ff0000" }],
    });
    expect(moved[0]).toMatchObject({
      x: 50,
      y: 20,
      points: [
        [0, 0],
        [70, 0],
      ],
      strokeColor: "#ff0000",
    });
    expect(moved[1]).toEqual(elements[1]);
    const deleted = await patch(moved, { deleteIds: [elements[0].id] });
    expect(deleted[0].isDeleted).toBe(true);
    expect(deleted[1]).toEqual(elements[1]);
  });

  it("validates pen geometry at the adapter boundary", async () => {
    for (const points of [
      [],
      [{ x: 0, y: 0 }],
      [
        { x: 0, y: 0 },
        { x: 10001, y: 0 },
      ],
    ]) {
      await expect(
        patch([], { additions: [{ type: "freedraw", points }] }),
      ).rejects.toThrow();
    }
  });

  it("binds a new arrow to existing IDs in both directions without replacing the shapes", async () => {
    const elements = await connectedScene();
    const [start, end, arrow] = elements;
    expect(elements).toHaveLength(3);
    expect(arrow.startBinding).toMatchObject({ elementId: start.id });
    expect(arrow.endBinding).toMatchObject({ elementId: end.id });
    expect(start.boundElements).toContainEqual({ id: arrow.id, type: "arrow" });
    expect(end.boundElements).toContainEqual({ id: arrow.id, type: "arrow" });
    expect(start).toMatchObject({ x: 20, y: 20, width: 100, height: 80 });
    expect(end).toMatchObject({ x: 300, y: 20, width: 100, height: 80 });
  });

  it("rejects missing or unbindable arrow targets rather than silently dropping the binding", async () => {
    const [text] = await patch([], {
      additions: [
        { type: "text", x: 20, y: 20, width: 100, height: 30, text: "label" },
      ],
    });
    await expect(
      patch([text], {
        additions: [
          {
            type: "arrow",
            x: 0,
            y: 0,
            width: 100,
            height: 1,
            endId: "missing",
          },
        ],
      }),
    ).rejects.toThrow(/binding/i);
    const [arrow] = await patch([], {
      additions: [{ type: "arrow", x: 0, y: 0, width: 100, height: 1 }],
    });
    await expect(
      patch([arrow], {
        additions: [
          {
            type: "arrow",
            x: 0,
            y: 10,
            width: 100,
            height: 1,
            endId: arrow.id,
          },
        ],
      }),
    ).rejects.toThrow(/binding/i);
  });

  it("resizes text from its real font metrics after an edit", async () => {
    const [text] = await patch([], {
      additions: [
        { type: "text", x: 20, y: 20, width: 100, height: 30, text: "a" },
      ],
    });
    const [updated] = await patch([text], {
      updates: [
        {
          id: text.id,
          text: "A considerably longer label\nwith a second line",
        },
      ],
    });
    expect(updated.id).toBe(text.id);
    // The requested width is kept; the longer label wraps and grows downward.
    expect(Number(updated.width)).toBe(100);
    expect(Number(updated.height)).toBeGreaterThan(Number(text.height));
    expect(updated.originalText).toBe(
      "A considerably longer label\nwith a second line",
    );
    expect(Number(updated.version)).toBeGreaterThan(Number(text.version));
  });

  it("wraps free text to its requested width instead of running off in one line", async () => {
    const [text] = await patch([], {
      additions: [
        {
          type: "text",
          x: 20,
          y: 20,
          width: 320,
          height: 230,
          text: "Managed APIs\n\nPros: the fastest path to a working prototype with zero infrastructure burden.",
        },
      ],
    });
    expect(text.autoResize).toBe(false);
    expect(Number(text.width)).toBe(320);
    expect(text.originalText).toBe(
      "Managed APIs\n\nPros: the fastest path to a working prototype with zero infrastructure burden.",
    );
    expect(String(text.text).split("\n").length).toBeGreaterThan(3);
  });

  it("keeps a resized bound label inside its container with the original label ID", async () => {
    const elements = await patch([], { additions: [{ ...shape, text: "a" }] });
    const label = elements.find((element) => element.type === "text")!;
    const result = await patch(elements, {
      updates: [{ id: label.id, text: "one\ntwo\nthree\nfour\nfive\nsix" }],
    });
    const container = result.find((element) => element.type === "rectangle")!;
    const updated = result.find((element) => element.id === label.id)!;
    expect(Number(updated.height)).toBeGreaterThan(Number(label.height));
    expect(updated.containerId).toBe(container.id);
    expect(Number(updated.y)).toBeGreaterThanOrEqual(Number(container.y));
    expect(Number(updated.y) + Number(updated.height)).toBeLessThanOrEqual(
      Number(container.y) + Number(container.height),
    );
    expect(container.boundElements).toContainEqual({
      id: label.id,
      type: "text",
    });
  });

  it("removes reciprocal arrow bindings when a target is deleted", async () => {
    const elements = await connectedScene();
    const result = await patch(elements, { deleteIds: [elements[0].id] });
    const arrow = result.find((element) => element.type === "arrow")!;
    expect(arrow.startBinding).toBeNull();
    expect(arrow.endBinding).toMatchObject({ elementId: elements[1].id });
    const noArrow = await patch(result, { deleteIds: [arrow.id] });
    expect(
      noArrow.find((element) => element.id === elements[1].id)!.boundElements,
    ).toEqual([]);
  });

  it("deletes bound labels along with their container", async () => {
    const elements = await patch([], {
      additions: [{ ...shape, text: "inside" }],
    });
    const result = await patch(elements, { deleteIds: [elements[0].id] });
    expect(result.filter((element) => !element.isDeleted)).toHaveLength(0);
  });

  it("moves a container with its label and attached arrow endpoint", async () => {
    const withLabel = await patch([], {
      additions: [
        { ...shape, text: "inside" },
        { ...shape, x: 300 },
      ],
    });
    const elements = await patch(withLabel, {
      additions: [
        {
          type: "arrow",
          x: 125,
          y: 60,
          width: 170,
          height: 1,
          startId: withLabel[0].id,
          endId: withLabel[1].id,
        },
      ],
    });
    const oldLabel = elements.find((element) => element.type === "text")!;
    const oldArrow = elements.find((element) => element.type === "arrow")!;
    const result = await patch(elements, {
      updates: [{ id: withLabel[0].id, x: 70, y: 50 }],
    });
    const label = result.find((element) => element.id === oldLabel.id)!;
    const arrow = result.find((element) => element.id === oldArrow.id)!;
    expect(Number(label.x) - Number(oldLabel.x)).toBeCloseTo(50);
    expect(Number(label.y) - Number(oldLabel.y)).toBeCloseTo(30);
    expect(Number(arrow.x) - Number(oldArrow.x)).toBeCloseTo(50);
    expect(Number(arrow.y) - Number(oldArrow.y)).toBeCloseTo(30);
    const oldEnd = (oldArrow.points as number[][]).at(-1)!;
    const end = (arrow.points as number[][]).at(-1)!;
    expect(Number(arrow.x) + end[0]).toBeCloseTo(
      Number(oldArrow.x) + oldEnd[0],
    );
    expect(Number(arrow.y) + end[1]).toBeCloseTo(
      Number(oldArrow.y) + oldEnd[1],
    );
    expect(arrow.startBinding).toMatchObject({ elementId: withLabel[0].id });
  });

  it("does not mutate the source snapshot while creating reciprocal bindings", async () => {
    const result = await page.evaluate(async (shape) => {
      const bridge = window as unknown as {
        buildBoardPatch: (
          elements: BoardElement[],
          changes: BoardPatch,
        ) => Promise<BoardElement[]>;
      };
      const elements = await bridge.buildBoardPatch([], { additions: [shape] });
      const snapshot = JSON.stringify(elements);
      await bridge.buildBoardPatch(elements, {
        additions: [
          {
            type: "arrow",
            x: 125,
            y: 60,
            width: 100,
            height: 1,
            startId: elements[0].id,
          },
        ],
      });
      return JSON.stringify(elements) === snapshot;
    }, shape);
    expect(result).toBe(true);
  });

  it("preserves earlier arrows when adding another connector to the same target", async () => {
    const elements = await connectedScene();
    const oldArrow = elements.find((element) => element.type === "arrow")!;
    const result = await patch(elements, {
      additions: [
        {
          type: "arrow",
          x: 125,
          y: 70,
          width: 170,
          height: 1,
          startId: elements[0].id,
          endId: elements[1].id,
        },
      ],
    });
    expect(
      result.find((element) => element.id === oldArrow.id)!.startBinding,
    ).toEqual(oldArrow.startBinding);
    const bindings = result.find((element) => element.id === elements[0].id)!
      .boundElements as { id: string }[];
    expect(bindings).toHaveLength(2);
    expect(new Set(bindings.map((item) => item.id)).size).toBe(2);
  });

  it("preserves an unrelated element’s geometry and version when applying an update", async () => {
    const elements = await patch([], {
      additions: [shape, { ...shape, x: 300 }],
    });
    const result = await patch(elements, {
      updates: [{ id: elements[0].id, strokeColor: "#ff0000" }],
    });
    expect(result[0].strokeColor).toBe("#ff0000");
    expect(result[1]).toEqual(elements[1]);
  });

  it("preserves image file references, flips, crops, and arrow bindings on import", async () => {
    const image = {
      id: "image-one",
      type: "image",
      fileId: "file-one",
      status: "saved",
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      scale: [-1, 1],
      crop: {
        x: 5,
        y: 10,
        width: 100,
        height: 80,
        naturalWidth: 200,
        naturalHeight: 160,
      },
      boundElements: [{ id: "arrow-one", type: "arrow" }],
    };
    const result = await page.evaluate(async (image) => {
      const api = window as unknown as {
        normalizeBoardImport: (
          elements: BoardElement[],
        ) => Promise<BoardElement[]>;
      };
      return api.normalizeBoardImport([
        image,
        {
          id: "arrow-one",
          type: "arrow",
          x: 110,
          y: 60,
          width: 90,
          height: 1,
          points: [
            [0, 0],
            [90, 0],
          ],
          startBinding: { elementId: image.id, focus: 0, gap: 1 },
        },
      ]);
    }, image);
    expect(result[0]).toMatchObject(image);
    expect(result[1].startBinding).toMatchObject({ elementId: image.id });
  });

  it("normalizes imported freehand strokes without losing their points or pressure", async () => {
    const drawing = {
      id: "manual-stroke",
      type: "freedraw",
      x: 10,
      y: 20,
      width: 40,
      height: 20,
      version: 7,
      versionNonce: 33,
      points: [
        [0, 0],
        [20, 20],
        [40, 5],
      ],
      pressures: [0.2, 0.7, 0.3],
      simulatePressure: false,
      runtimeHandle: { private: true },
    };
    const result = await page.evaluate(async (drawing) => {
      const api = window as unknown as {
        normalizeBoardImport: (
          elements: BoardElement[],
        ) => Promise<BoardElement[]>;
      };
      return api.normalizeBoardImport([drawing]);
    }, drawing);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: drawing.id,
      type: "freedraw",
      points: drawing.points,
      pressures: drawing.pressures,
      simulatePressure: false,
      version: 7,
    });
    expect(result[0]).not.toHaveProperty("runtimeHandle");
  });

  it("normalizes imported array diagrams without changing IDs or their source snapshot", async () => {
    const result = await page.evaluate(async () => {
      const api = window as unknown as {
        normalizeBoardImport: (
          elements: BoardElement[],
        ) => Promise<BoardElement[]>;
        sampleBoard: () => Promise<BoardElement[]>;
      };
      const elements = await api.sampleBoard();
      const before = JSON.stringify(elements);
      const normalized = await api.normalizeBoardImport(elements);
      return {
        beforeIds: elements.map((element) => element.id),
        afterIds: normalized.map((element) => element.id),
        labels: normalized
          .filter((element) => element.type === "text")
          .map((element) => element.text),
        untouched: before === JSON.stringify(elements),
      };
    });
    expect(result.afterIds).toEqual(result.beforeIds);
    expect(result.labels).toEqual(
      expect.arrayContaining(["2", "5", "8", "12", "16", "23", "38", "56"]),
    );
    expect(result.untouched).toBe(true);
  });
});
