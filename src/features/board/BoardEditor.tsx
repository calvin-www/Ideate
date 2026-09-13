"use client";
import { useEffect, useRef, useState } from "react";
import {
  Excalidraw,
  CaptureUpdateAction,
  exportToBlob,
  restoreElements,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import type {
  ExcalidrawImperativeAPI,
  NormalizedZoomValue,
  BinaryFiles,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useWorkspace } from "../workspace/store";
import { adapters } from "../workspace/adapters";
import type { BoardElement } from "../workspace/model";
import { sampleBoard } from "./adapter";
import BoardAttention from "./BoardAttention";
import {
  captureBoardFiles,
  checkImageReferences,
  validateImageUpload,
} from "./images";
import { readBoardImage } from "./readImage";

export default function BoardEditor({ active }: { active: boolean }) {
  const board = useWorkspace((s) => s.data.board);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const hash = useRef("");
  const lastSelection = useRef("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function insertImages(
    files: File[],
    point?: { clientX: number; clientY: number },
  ) {
    if (!api) return;
    const start = useWorkspace.getState();
    for (const [index, file] of files.entries()) {
      try {
        const image = await readBoardImage(file);
        const current = useWorkspace.getState();
        if (
          !mounted.current ||
          current.data.id !== start.data.id ||
          current.editorEpochs.board !== start.editorEpochs.board
        )
          return;
        const state = api.getAppState();
        const position = viewportCoordsToSceneCoords(
          point ?? {
            clientX: state.offsetLeft + state.width / 2,
            clientY: state.offsetTop + state.height / 2,
          },
          state,
        );
        const scale = Math.min(1, 800 / image.width, 600 / image.height);
        const width = image.width * scale,
          height = image.height * scale;
        const element = restoreElements(
          [
            {
              id: crypto.randomUUID(),
              type: "image",
              fileId: image.file.id,
              x: position.x - width / 2 + index * 24,
              y: position.y - height / 2 + index * 24,
              width,
              height,
              status: "saved",
              scale: [1, 1],
              crop: null,
            },
          ] as unknown as ExcalidrawElement[],
          null,
        )[0];
        captureBoardFiles(
          [element],
          { [image.file.id]: image.file },
          current.data.board.files,
        );
        api.addFiles([image.file] as unknown as Parameters<
          typeof api.addFiles
        >[0]);
        api.updateScene({
          elements: [...api.getSceneElementsIncludingDeleted(), element],
          appState: { selectedElementIds: { [element.id]: true } },
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        api.setActiveTool({ type: "selection" });
      } catch (error) {
        if (mounted.current)
          useWorkspace.setState({
            notice:
              error instanceof Error
                ? error.message
                : "This image could not be inserted.",
          });
      }
    }
  }
  useEffect(() => {
    if (!api) return;
    adapters.board = {
      focus: () => api.refresh(),
      reveal: (ref) => {
        api.updateScene({
          appState: {
            selectedElementIds: Object.fromEntries(
              (ref.ids ?? []).map((id) => [id, true]),
            ),
          },
        });
        api.scrollToContent(
          api.getSceneElements().filter((e) => ref.ids?.includes(e.id)),
        );
      },
      image: async () => {
        const elements = api.getSceneElements();
        if (!elements.length) return;
        const blob = await exportToBlob({
          elements,
          appState: { exportBackground: true, viewBackgroundColor: "#fafaf7" },
          files: api.getFiles(),
          maxWidthOrHeight: 1000,
        });
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.readAsDataURL(blob);
        });
      },
    };
    return () => {
      delete adapters.board;
    };
  }, [api]);
  useEffect(() => {
    if (!api) return;
    const value = JSON.stringify(board.elements);
    const missingFiles = Object.values(board.files).filter(
      (file) => api.getFiles()[file.id]?.dataURL !== file.dataURL,
    );
    if (missingFiles.length)
      api.addFiles(
        missingFiles as unknown as Parameters<typeof api.addFiles>[0],
      );
    if (value !== hash.current) {
      hash.current = value;
      api.updateScene({
        elements: board.elements as unknown as ExcalidrawElement[],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    }
  }, [board.elements, board.files, api]);
  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => {
        api?.refresh();
      });
    } else if (api) {
      const snapshot = useWorkspace.getState().data;
      adapters.board
        ?.image?.()
        .then((image) => {
          const current = useWorkspace.getState().data;
          if (
            current.id !== snapshot.id ||
            current.board.revision !== snapshot.board.revision
          )
            return;
          useWorkspace.setState({ boardPreview: image ?? "" });
        })
        .catch(() => {});
    }
  }, [active, api]);
  return (
    <div className="board-editor">
      <div className="editor-toolbar">
        <div>
          <strong>Your whiteboard</strong>
          <span>Draw, drop an image, or paste a screenshot.</span>
        </div>
        <button
          className="button quiet"
          onClick={async () => {
            if (
              board.elements.some((e) => !e.isDeleted) &&
              !window.confirm(
                "Replace the board with the binary search example?",
              )
            )
              return;
            useWorkspace.getState().setBoard(await sampleBoard());
            setTimeout(
              () =>
                api?.scrollToContent(undefined, {
                  fitToViewport: true,
                  viewportZoomFactor: 0.75,
                  animate: false,
                }),
              50,
            );
          }}
        >
          Load binary search example
        </button>
        <button
          className="button quiet"
          onClick={() =>
            api?.scrollToContent(undefined, {
              fitToViewport: true,
              viewportZoomFactor: 0.75,
              animate: false,
            })
          }
        >
          Fit drawing
        </button>
      </div>
      <div
        className="excalidraw-frame"
        onDropCapture={(event) => {
          const files = Array.from(event.dataTransfer.files);
          if (files.length) {
            event.preventDefault();
            event.stopPropagation();
            void insertImages(files, {
              clientX: event.clientX,
              clientY: event.clientY,
            });
          } else if (
            event.dataTransfer.types.some(
              (type) =>
                type === "text/uri-list" ||
                type === "text/html" ||
                type === "text/plain",
            )
          ) {
            event.preventDefault();
            event.stopPropagation();
            useWorkspace.setState({
              notice:
                "Download the image, then drop the file onto the whiteboard.",
            });
          }
        }}
        onPasteCapture={(event) => {
          if (
            (event.target as HTMLElement).closest?.(
              'input, textarea, [contenteditable="true"]',
            )
          )
            return;
          const files = Array.from(event.clipboardData.files);
          if (files.length) {
            event.preventDefault();
            event.stopPropagation();
            void insertImages(files);
          } else if (/<img\b/i.test(event.clipboardData.getData("text/html"))) {
            event.preventDefault();
            event.stopPropagation();
            useWorkspace.setState({
              notice:
                "Download the image, then drop the file onto the whiteboard.",
            });
          }
        }}
      >
        <Excalidraw
          excalidrawAPI={setApi}
          validateEmbeddable={false}
          initialData={{
            elements: board.elements as unknown as ExcalidrawElement[],
            files: board.files as unknown as BinaryFiles,
            appState: {
              viewBackgroundColor: "#fafaf7",
              currentItemStrokeColor: "#24342e",
              ...(board.viewport
                ? {
                    scrollX: board.viewport.scrollX,
                    scrollY: board.viewport.scrollY,
                    zoom: {
                      value: Math.max(
                        0.1,
                        Math.min(30, board.viewport.zoom),
                      ) as NormalizedZoomValue,
                    },
                  }
                : {}),
            },
          }}
          UIOptions={{
            canvasActions: {
              loadScene: false,
              saveToActiveFile: false,
              export: false,
              toggleTheme: false,
            },
            tools: { image: true },
          }}
          generateIdForFile={async (file) => {
            validateImageUpload(file);
            const digest = await crypto.subtle.digest(
              "SHA-256",
              await file.arrayBuffer(),
            );
            return Array.from(new Uint8Array(digest), (byte) =>
              byte.toString(16).padStart(2, "0"),
            ).join("");
          }}
          onPaste={(data) => {
            if (data.elements?.some((e) => e.type === "embeddable")) {
              useWorkspace.setState({
                notice:
                  "Embedded websites are not supported on this whiteboard.",
              });
              return false;
            }
            try {
              const elements = (data.elements ??
                []) as unknown as BoardElement[];
              const files = captureBoardFiles(
                elements,
                data.files ?? {},
                useWorkspace.getState().data.board.files,
              );
              checkImageReferences(elements, files);
            } catch (error) {
              useWorkspace.setState({
                notice:
                  error instanceof Error
                    ? error.message
                    : "This image could not be pasted.",
              });
              return false;
            }
            return true;
          }}
          onChange={(elements, appState, incomingFiles) => {
            if (!mounted.current) return;
            const saved = useWorkspace.getState().data.board;
            let files;
            try {
              files = captureBoardFiles(
                elements as unknown as BoardElement[],
                incomingFiles,
                saved.files,
              );
            } catch (error) {
              // Reject the insertion before it can replace the last valid saved board.
              useWorkspace.setState({
                notice:
                  error instanceof Error
                    ? error.message
                    : "This image could not be saved.",
              });
              api?.updateScene({
                elements: saved.elements as unknown as ExcalidrawElement[],
                captureUpdate: CaptureUpdateAction.NEVER,
              });
              return;
            }
            // Insertion emits a placeholder before its asynchronous file read completes.
            const loadingImage = elements.some(
              (element) =>
                element.type === "image" &&
                !element.isDeleted &&
                (!element.fileId || !Object.hasOwn(files, element.fileId)),
            );
            const value = JSON.stringify(elements);
            if (
              !loadingImage &&
              (value !== hash.current || files !== saved.files)
            ) {
              hash.current = value;
              useWorkspace
                .getState()
                .setBoard(elements as unknown as BoardElement[], files);
            }
            const ids = Object.keys(appState.selectedElementIds).filter(
              (id) => appState.selectedElementIds[id],
            );
            const selectionKey = `${ids.join(",")}:${useWorkspace.getState().data.board.revision}`;
            if (active && lastSelection.current !== selectionKey) {
              lastSelection.current = selectionKey;
              useWorkspace.setState({
                selection: ids.length
                  ? {
                      tool: "board",
                      revision: useWorkspace.getState().data.board.revision,
                      ids,
                      text: elements
                        .filter((e) => ids.includes(e.id))
                        .map((e) => ("text" in e ? e.text : e.type))
                        .join(", "),
                    }
                  : null,
              });
            }
            const viewport = {
              scrollX: appState.scrollX,
              scrollY: appState.scrollY,
              zoom: appState.zoom.value,
            };
            const old = useWorkspace.getState().data.board.viewport;
            if (
              !old ||
              old.scrollX !== viewport.scrollX ||
              old.scrollY !== viewport.scrollY ||
              old.zoom !== viewport.zoom
            )
              useWorkspace.getState().setData((data) => ({
                ...data,
                board: { ...data.board, viewport },
              }));
          }}
        />
        {api && <BoardAttention api={api} active={active} />}
      </div>
    </div>
  );
}
