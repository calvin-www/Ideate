import { expect, it } from "vitest";
import {
  createWorkspace,
  validateWorkspace,
  validateImport,
  applyProposal,
  undoChange,
} from "../src/features/workspace/model";
import { clearWorkspaceData } from "../src/features/workspace/clearWorkspace";
import {
  captureBoardFiles,
  validateImageUpload,
  type BoardFiles,
} from "../src/features/board/images";

const image = {
  id: "picture",
  type: "image",
  x: 20,
  y: 30,
  width: 100,
  height: 80,
  fileId: "file-one",
  status: "saved",
  scale: [-1, 1],
  crop: null,
};
const file = {
  id: "file-one",
  mimeType: "image/png",
  created: 1,
  dataURL:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4ioAAAAASUVORK5CYII=",
};
function withImage() {
  return {
    ...createWorkspace(),
    board: {
      id: "board" as const,
      revision: 1,
      elements: [image],
      files: { [file.id]: file },
    },
  };
}

it("round trips image bytes and placement through the workspace save format", () => {
  const saved = validateWorkspace(withImage());
  const restored = validateImport(JSON.parse(JSON.stringify(saved)));
  expect(restored.board).toMatchObject({
    elements: [image],
    files: { [file.id]: file },
  });
});

it("opens older workspaces with no image collection", () => {
  const legacy = createWorkspace();
  delete (legacy.board as { files?: unknown }).files;
  expect(validateImport(legacy).board).toMatchObject({ files: {} });
});

it("rejects missing image bytes and files with mismatched IDs or remote URLs", () => {
  const missing = withImage();
  missing.board.files = {};
  expect(() => validateImport(missing)).toThrow();
  for (const fileId of ["toString", "__proto__"]) {
    const inherited = withImage();
    inherited.board.elements = [{ ...image, fileId }];
    inherited.board.files = {};
    expect(() => validateImport(inherited)).toThrow();
  }
  for (const invalid of [
    { id: "wrong" },
    { dataURL: "https://example.com/image.png" },
    { mimeType: "image/jpeg" },
  ]) {
    const data = withImage();
    data.board.files[file.id] = { ...file, ...invalid };
    expect(() => validateImport(data)).toThrow();
  }
});

it("retains image bytes when an AI change is applied, exported, and undone", () => {
  const before = validateImport(withImage());
  const changed = applyProposal(
    before,
    {
      id: "move-picture",
      jobId: "job",
      target: "board",
      baseRevision: 1,
      summary: "Move image",
      sources: [],
      sourceRevisions: {},
    },
    "job",
    [{ ...image, x: 200 }],
  );
  const restored = validateImport(JSON.parse(JSON.stringify(changed)));
  const undone = undoChange(restored, "move-picture");
  expect(undone.board).toMatchObject({
    elements: [image],
    files: { [file.id]: file },
  });
});

it("rejects a missing file referenced only by an undo snapshot", () => {
  const data = withImage();
  data.board.elements = [];
  data.board.files = {};
  data.changes.push({
    id: "deleted",
    target: "board",
    summary: "Delete image",
    before: [image],
    after: [],
    resultRevision: 1,
    sources: [],
  });
  expect(() => validateImport(data)).toThrow();
});

it("clears image files with the board but preserves them when clearing notes", () => {
  const data = validateImport(withImage());
  expect(clearWorkspaceData(data, "notes").board).toEqual(data.board);
  expect(clearWorkspaceData(data, "board").board).toMatchObject({
    elements: [],
    files: {},
  });
  expect(clearWorkspaceData(data, "all").board).toMatchObject({
    elements: [],
    files: {},
  });
});

it("captures files that arrive after their image element, without retaining mutable library objects", () => {
  const original = {};
  expect(captureBoardFiles([image], {}, original)).toBe(original);
  const incoming = { [file.id]: { ...file } };
  const saved = captureBoardFiles([image], incoming, original);
  incoming[file.id].dataURL = "mutated";
  expect(saved[file.id].dataURL).toBe(file.dataURL);
  expect(captureBoardFiles([{ ...image, isDeleted: true }], {}, saved)).toBe(
    saved,
  );
});

it("rejects oversized and unsupported uploads", () => {
  expect(() =>
    validateImageUpload({ type: "image/png", size: 6_000_000 }),
  ).toThrow(/5 MB/);
  expect(() =>
    validateImageUpload({ type: "image/svg+xml", size: 100 }),
  ).toThrow(/PNG, JPEG, or WebP/);
  for (const type of ["image/png", "image/jpeg", "image/webp"])
    expect(() => validateImageUpload({ type, size: 100 })).not.toThrow();
});

it("rejects a new image over the board budget without changing already saved files", () => {
  const saved: BoardFiles = {
    old: {
      ...file,
      id: "old",
      mimeType: "image/png",
      dataURL: "data:image/png;base64," + "A".repeat(6_000_000),
    },
  };
  const incoming = {
    next: {
      ...file,
      id: "next",
      dataURL: "data:image/png;base64," + "A".repeat(5_000_000),
    },
  };
  expect(() =>
    captureBoardFiles([{ ...image, fileId: "next" }], incoming, saved),
  ).toThrow(/10 MB/);
  expect(Object.keys(saved)).toEqual(["old"]);
});
