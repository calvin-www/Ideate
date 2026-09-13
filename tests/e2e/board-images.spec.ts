import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import type { Workspace } from "../../src/features/workspace/model";

test.use({ reducedMotion: "reduce" });

async function redPixels(page: Page) {
  return page.locator(".excalidraw__canvas.static").evaluate((canvas) => {
    const context = (canvas as HTMLCanvasElement).getContext("2d")!;
    const pixels = context.getImageData(
      0,
      0,
      (canvas as HTMLCanvasElement).width,
      (canvas as HTMLCanvasElement).height,
    ).data;
    let red = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] > 240 && pixels[i + 1] < 20 && pixels[i + 2] < 20) red++;
    return red;
  });
}
async function openBoard(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await navigate(page, "Whiteboard");
  await page.locator(".excalidraw__canvas.interactive").waitFor();
}

async function navigate(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Workspace tools" })
    .getByRole("button", { name, exact: true })
    .click();
}
async function snapshot(page: Page): Promise<Workspace> {
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export workspace", exact: true })
    .click();
  return JSON.parse(
    await readFile((await (await downloading).path())!, "utf8"),
  );
}
async function insertImage(
  page: Page,
  method: "drop" | "paste" = "drop",
  embeddedScene = false,
) {
  await page.locator(".excalidraw__canvas.interactive").waitFor();
  await page.evaluate(
    ({ method, embeddedScene }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 120;
      canvas.height = 80;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(0, 0, 120, 80);
      let bytes = Uint8Array.from(atob(canvas.toDataURL().split(",")[1]), (c) =>
        c.charCodeAt(0),
      );
      if (embeddedScene) {
        // Valid PNG tEXt chunk using Excalidraw's legacy, uncompressed scene encoding.
        const data = new TextEncoder().encode(
          "application/vnd.excalidraw+json\0" +
            JSON.stringify({
              type: "excalidraw",
              version: 2,
              source: "test",
              elements: [],
              appState: {},
              files: {},
            }),
        );
        const chunk = new Uint8Array(data.length + 12);
        new DataView(chunk.buffer).setUint32(0, data.length);
        chunk.set(new TextEncoder().encode("tEXt"), 4);
        chunk.set(data, 8);
        let crc = 0xffffffff;
        for (const value of chunk.slice(4, -4)) {
          crc ^= value;
          for (let bit = 0; bit < 8; bit++)
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
        new DataView(chunk.buffer).setUint32(
          chunk.length - 4,
          (crc ^ 0xffffffff) >>> 0,
        );
        const encoded = new Uint8Array(bytes.length + chunk.length);
        encoded.set(bytes.slice(0, -12));
        encoded.set(chunk, bytes.length - 12);
        encoded.set(bytes.slice(-12), bytes.length - 12 + chunk.length);
        bytes = encoded;
      }
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "red.png", { type: "image/png" }));
      const target = document.querySelector(".excalidraw__canvas.interactive")!;
      const rect = target.getBoundingClientRect();
      if (method === "drop")
        target.dispatchEvent(
          new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
            clientX: rect.left + 250,
            clientY: rect.top + 200,
          }),
        );
      else {
        (target as HTMLElement).focus();
        target.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: transfer,
          }),
        );
      }
    },
    { method, embeddedScene },
  );
}

test("dropped images remain visible after reload and workspace import", async ({
  page,
}) => {
  await openBoard(page);
  await insertImage(page);
  let saved!: Workspace;
  await expect
    .poll(async () => {
      saved = await snapshot(page);
      return saved.board.elements.filter(
        (e) => e.type === "image" && !e.isDeleted,
      ).length;
    })
    .toBe(1);
  const picture = saved.board.elements.find((e) => e.type === "image")!;
  expect(saved.board.files[picture.fileId as string].dataURL).toMatch(
    /^data:image\/png;base64,/,
  );
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await navigate(page, "Whiteboard");
  expect((await snapshot(page)).board).toMatchObject({
    elements: saved.board.elements,
    files: saved.board.files,
  });
  // Assert rendered pixels as well as serialized bytes: a missing-image placeholder is not a pass.
  await expect.poll(() => redPixels(page)).toBeGreaterThan(100);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .locator('input[type="file"][accept=".json,application/json"]')
    .setInputFiles({
      name: "images.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(saved)),
    });
  await expect(
    page.getByText("Workspace imported.", { exact: true }),
  ).toBeVisible();
  const imported = await snapshot(page);
  expect(
    imported.board.elements.find((e) => e.id === picture.id),
  ).toMatchObject({ type: "image", fileId: picture.fileId });
  expect(imported.board.files).toEqual(saved.board.files);
  await expect.poll(() => redPixels(page)).toBeGreaterThan(100);
  // Importing a newer copy can reuse workspace, element, and file IDs with new bytes.
  const replacement = structuredClone(saved);
  replacement.board.files[picture.fileId as string].dataURL =
    await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 120;
      canvas.height = 80;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#0000ff";
      ctx.fillRect(0, 0, 120, 80);
      return canvas.toDataURL();
    });
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .locator('input[type="file"][accept=".json,application/json"]')
    .setInputFiles({
      name: "updated-images.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(replacement)),
    });
  await expect
    .poll(
      async () =>
        (await snapshot(page)).board.files[picture.fileId as string].dataURL,
    )
    .toBe(replacement.board.files[picture.fileId as string].dataURL);
  await expect.poll(() => redPixels(page)).toBe(0);
});

test("pasted screenshots survive native deletion, undo, and redo", async ({
  page,
}) => {
  await openBoard(page);
  await page
    .locator(".excalidraw__canvas.interactive")
    .click({ position: { x: 250, y: 200 } });
  await insertImage(page, "paste");
  await expect.poll(() => redPixels(page)).toBeGreaterThan(100);
  await page.keyboard.press("Delete");
  await expect.poll(() => redPixels(page)).toBe(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => redPixels(page)).toBeGreaterThan(100);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => redPixels(page)).toBe(0);
  const deleted = await snapshot(page);
  expect(Object.keys(deleted.board.files)).toHaveLength(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => redPixels(page)).toBeGreaterThan(100);
});

test("a PNG containing embedded drawing data is added without replacing the board", async ({
  page,
}) => {
  await openBoard(page);
  await insertImage(page);
  await expect.poll(() => redPixels(page)).toBeGreaterThan(100);
  const before = await snapshot(page);
  await insertImage(page, "drop", true);
  await expect
    .poll(
      async () =>
        (await snapshot(page)).board.elements.filter(
          (e) => e.type === "image" && !e.isDeleted,
        ).length,
    )
    .toBe(2);
  expect((await snapshot(page)).board.elements).toEqual(
    expect.arrayContaining(before.board.elements),
  );
});

test("image upload failures leave the existing board saveable", async ({
  page,
}) => {
  await openBoard(page);
  await insertImage(page);
  await expect.poll(() => redPixels(page)).toBeGreaterThan(100);
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array(5_000_001)], "oversized.png", {
        type: "image/png",
      }),
    );
    document.querySelector(".excalidraw__canvas.interactive")!.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        clientX: 400,
        clientY: 300,
      }),
    );
  });
  await expect(
    page.getByText("This image exceeds 5 MB. Choose a smaller image.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  const saved = await snapshot(page);
  expect(
    saved.board.elements.filter((e) => e.type === "image" && !e.isDeleted),
  ).toHaveLength(1);
  expect(Object.keys(saved.board.files)).toHaveLength(1);
});

test("the image tool inserts a file that can be deleted and restored with undo", async ({
  page,
}) => {
  // Exercise the library's standard file-input fallback; OS-native pickers are outside Playwright.
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "showOpenFilePicker");
  });
  await openBoard(page);
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 80;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 120, 80);
    return canvas.toDataURL().split(",")[1];
  });
  const choosing = page.waitForEvent("filechooser", { timeout: 15_000 });
  await page
    .locator("label")
    .filter({
      has: page.getByRole("radio", { name: "Insert image", exact: true }),
    })
    .click();
  await (
    await choosing
  ).setFiles({
    name: "red.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  const canvas = page.locator(".excalidraw__canvas.interactive");
  await expect(canvas).toHaveCSS("cursor", /url\(/);
  await canvas.click({ position: { x: 250, y: 200 } });
  await expect.poll(() => redPixels(page)).toBeGreaterThan(100);
  await page.keyboard.press("Delete");
  await expect.poll(() => redPixels(page)).toBe(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => redPixels(page)).toBeGreaterThan(100);
  expect(Object.keys((await snapshot(page)).board.files)).toHaveLength(1);
});

test("remote HTML image paste asks for a local file without fetching the image", async ({
  page,
}) => {
  let requests = 0;
  await page.route("https://remote.example/**", (route) => {
    requests++;
    return route.abort();
  });
  await openBoard(page);
  await page
    .locator(".excalidraw__canvas.interactive")
    .click({ position: { x: 250, y: 200 } });
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.setData(
      "text/html",
      '<img src="https://remote.example/image.png">',
    );
    document.querySelector(".excalidraw__canvas.interactive")!.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    );
  });
  await expect(
    page.getByText(
      "Download the image, then drop the file onto the whiteboard.",
      { exact: true },
    ),
  ).toBeVisible();
  expect((await snapshot(page)).board.elements).toEqual([]);
  expect(requests).toBe(0);
});

test("AI board previews include existing images and applying then undoing an edit preserves them", async ({
  page,
}) => {
  let boardImage: string | undefined;
  await page.route("**/api/ai", async (route) => {
    const body = route.request().postDataJSON();
    boardImage = body.context.boardImage;
    const events = body.continuation
      ? [
          { type: "text", text: "Added the label." },
          { type: "done", continuation: { contents: [] } },
        ]
      : [
          {
            type: "call",
            id: "image-label",
            name: "edit_board",
            args: {
              baseRevision: body.context.board.revision,
              summary: "Label the screenshot",
              additions: [
                {
                  type: "text",
                  text: "Screenshot",
                  x: 10,
                  y: 10,
                  width: 100,
                  height: 30,
                },
              ],
              updates: [],
              deleteIds: [],
            },
          },
          { type: "done", continuation: { contents: [] } },
        ];
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    });
  });
  await openBoard(page);
  await insertImage(page);
  await expect.poll(() => redPixels(page)).toBeGreaterThan(100);
  const original = await snapshot(page);
  await page
    .getByRole("button", { name: "Toggle study partner", exact: true })
    .click();
  const partner = page.getByRole("complementary", { name: "AI study partner" });
  await partner.getByRole("switch", { name: "Auto-apply changes" }).uncheck();
  await partner
    .getByRole("textbox", { name: "Ask your study partner" })
    .fill("Label this screenshot.");
  await partner
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  const preview = partner.getByRole("img", {
    name: "Preview of the proposed whiteboard changes",
    exact: true,
  });
  await expect(preview).toBeVisible();
  await expect
    .poll(() =>
      preview.evaluate((image) => {
        const img = image as HTMLImageElement;
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        if (!canvas.width) return 0;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let red = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i] > 240 && pixels[i + 1] < 20 && pixels[i + 2] < 20)
            red++;
        return red;
      }),
    )
    .toBeGreaterThan(100);
  expect(boardImage).toMatch(/^data:image\/png;base64,/);
  await partner.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    partner.getByRole("button", { name: "Stop AI request", exact: true }),
  ).toHaveCount(0);
  const applied = await snapshot(page);
  expect(applied.board.files).toEqual(original.board.files);
  expect(
    applied.board.elements.filter((e) => e.type === "image" && !e.isDeleted),
  ).toHaveLength(1);
  await partner
    .getByRole("button", { name: "Undo last AI change", exact: true })
    .click();
  expect((await snapshot(page)).board.files).toEqual(original.board.files);
  await expect.poll(() => redPixels(page)).toBeGreaterThan(100);
});
