"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { exportToSvg, getCommonBounds } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { BoardElement } from "../workspace/model";
import { useWorkspace } from "../workspace/store";
import { frameBoardCamera, ownsBoardCamera, recordBoardCameraChange } from "../board/camera";
import { cancelPresentation, takeOverPresentation, usePresentation } from "./presentation";
import {
  boardChangedElements,
  boardRenderElements,
} from "./progression";
import styles from "./Presentation.module.css";

const FRAME_INTERVAL_MS = 1_000 / 15;
const ELEMENT_LINK_PREFIX = "https://ideate.invalid/voice-preview/";

type AppState = ReturnType<ExcalidrawImperativeAPI["getAppState"]>;
type RenderRequest = {
  elements: BoardElement[];
  appState: AppState;
  files: ReturnType<ExcalidrawImperativeAPI["getFiles"]>;
  generation: number;
};
type RenderQueue = {
  activeProposal: string | null;
  disposed: boolean;
  generation: number;
  lastFinishedAt: number;
  pending: RenderRequest | null;
  rendering: boolean;
  timer: number | null;
};

function applyProgress(svg: SVGSVGElement, elements: BoardElement[]) {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const progressById = new Map(
    elements
      .map((element) => [element.id, Number(element.voiceProgress)] as const)
      .filter((entry) => Number.isFinite(entry[1]) && entry[1] < 1),
  );
  if (!progressById.size) return;

  for (const group of svg.querySelectorAll<SVGGElement>("[data-id]")) {
    const id = group.getAttribute("data-id");
    const progress = id ? progressById.get(id) : undefined;
    if (progress === undefined) continue;
    const element = elementsById.get(id!);
    if (element?.type === "image") {
      group.style.opacity = String(Math.max(0, progress));
      continue;
    }
    // Linear elements already carry a truncated native points list.
    if (
      element?.type === "freedraw" ||
      element?.type === "arrow" ||
      element?.type === "line"
    ) {
      continue;
    }
    for (const path of group.querySelectorAll<SVGGeometryElement>(
      "path, line, polyline, polygon, rect, ellipse, circle",
    )) {
      if (path.getAttribute("stroke") === "none") continue;
      path.setAttribute("pathLength", "1");
      path.style.strokeDasharray = `${Math.max(0, progress)} ${Math.max(0.001, 1 - progress)}`;
    }
  }
}

function identifyNativeElements(
  svg: SVGSVGElement,
  elements: ExcalidrawElement[],
) {
  for (const anchor of svg.querySelectorAll<SVGAElement>(
    `a[href^="${ELEMENT_LINK_PREFIX}"]`,
  )) {
    const token = anchor.getAttribute("href")?.slice(ELEMENT_LINK_PREFIX.length);
    if (!token) continue;
    const index = Number(token);
    const element = elements[index];
    if (!element) continue;
    anchor.dataset.id = element.id;
    if (element.link) anchor.setAttribute("href", element.link);
    else anchor.removeAttribute("href");
  }
}

export default function BoardPresentation({
  api,
  active,
  container,
}: {
  api: ExcalidrawImperativeAPI;
  active: boolean;
  container: RefObject<HTMLDivElement | null>;
}) {
  const current = usePresentation((state) => state.current);
  const board = useWorkspace((state) => state.data.board);
  const [viewportEpoch, redraw] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const apiRef = useRef(api);
  apiRef.current = api;
  const scrolledProposal = useRef<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const holdingSpace = useRef(false);
  const touches = useRef(new Set<number>());
  const touchTool = useRef<AppState["activeTool"] | null>(null);
  const queue = useRef<RenderQueue>({
    activeProposal: null,
    disposed: false,
    generation: 0,
    lastFinishedAt: 0,
    pending: null,
    rendering: false,
    timer: null,
  });

  const updateCamera = useCallback(() => {
    const state = apiRef.current.getAppState();
    if (viewport.current) {
      viewport.current.style.transform = `translate(${state.scrollX * state.zoom.value}px, ${state.scrollY * state.zoom.value}px) scale(${state.zoom.value})`;
    }
  }, []);

  useEffect(() => api.onChange(() => {
    updateCamera();
    redraw((value) => value + 1);
  }), [api, updateCamera]);

  useEffect(() => api.onScrollChange(() => {
    recordBoardCameraChange(api);
    updateCamera();
  }), [api, updateCamera]);

  useEffect(() => {
    const editor = container.current?.querySelector(".excalidraw");
    const restoreTouchTool = () => {
      if (touches.current.size || !touchTool.current) return;
      const activeTool = touchTool.current;
      touchTool.current = null;
      api.updateScene({ appState: { activeTool } });
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.code === "Space" && editor?.contains(event.target as Node))
        holdingSpace.current = true;
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === "Space") holdingSpace.current = false;
    };
    const releaseTouch = (event: PointerEvent) => {
      if (!touches.current.delete(event.pointerId)) return;
      // Let Excalidraw finish its native pan/pinch teardown first. This also
      // keeps navigation intact if a preview finishes while fingers are down.
      queueMicrotask(restoreTouchTool);
    };
    const blur = () => {
      holdingSpace.current = false;
      touches.current.clear();
      queueMicrotask(restoreTouchTool);
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("pointerup", releaseTouch);
    window.addEventListener("pointercancel", releaseTouch);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("pointerup", releaseTouch);
      window.removeEventListener("pointercancel", releaseTouch);
      window.removeEventListener("blur", blur);
      holdingSpace.current = false;
      touches.current.clear();
      restoreTouchTool();
    };
  }, [api, container]);

  const renderLatest = useCallback(async () => {
    const state = queue.current;
    state.timer = null;
    if (state.disposed || state.rendering || !state.pending) return;
    const request = state.pending;
    state.pending = null;
    state.rendering = true;
    try {
      const elements = boardRenderElements(request.elements);
      let svg: SVGSVGElement | null = null;
      if (elements.length) {
        const nativeElements = elements as unknown as ExcalidrawElement[];
        // Excalidraw only emits data-id in its own Vite test mode. Temporary
        // links give every exported native element a stable wrapper which we
        // relabel after export without changing the source scene.
        const identifiableElements = nativeElements.map((element, index) => ({
          ...element,
          link: `${ELEMENT_LINK_PREFIX}${index}`,
        }));
        const rendered = await exportToSvg({
          elements: identifiableElements,
          appState: {
            exportBackground: false,
            exportWithDarkMode: request.appState.theme === "dark",
            viewBackgroundColor: request.appState.viewBackgroundColor,
          },
          files: request.files,
          exportPadding: 0,
          renderEmbeddables: false,
          reuseImages: true,
          skipInliningFonts: true,
        });
        identifyNativeElements(rendered, nativeElements);
        const [minX, minY, maxX, maxY] = getCommonBounds(nativeElements);
        const viewBox = rendered.viewBox.baseVal;
        if (viewBox.width <= 0 || viewBox.height <= 0) {
          rendered.setAttribute(
            "viewBox",
            `${viewBox.x} ${viewBox.y} ${Math.max(1, viewBox.width)} ${Math.max(1, viewBox.height)}`,
          );
        }
        rendered.style.position = "absolute";
        rendered.style.left = `${minX}px`;
        rendered.style.top = `${minY}px`;
        rendered.style.width = `${Math.max(1, maxX - minX)}px`;
        rendered.style.height = `${Math.max(1, maxY - minY)}px`;
        rendered.style.overflow = "visible";
        rendered.style.pointerEvents = "none";
        rendered.setAttribute("aria-hidden", "true");
        applyProgress(rendered, elements);
        svg = rendered;
      }
      if (
        state.disposed ||
        request.generation !== state.generation ||
        !host.current
      ) {
        return;
      }
      host.current.replaceChildren(...(svg ? [svg] : []));
      updateCamera();
      if (usePresentation.getState().current?.proposal.id === state.activeProposal)
        usePresentation.setState({ paintedBoard: { proposalId: state.activeProposal!, elements: request.elements } });
    } catch (error) {
      // A superseded export can fail after its preview has already been
      // replaced. A failure for the active preview must stop the paired commit.
      const activePreview = usePresentation.getState().current;
      if (
        !state.disposed &&
        request.generation === state.generation &&
        activePreview?.proposal.id === state.activeProposal
      ) {
        state.generation += 1;
        state.pending = null;
        useWorkspace.setState({
          notice: "Whiteboard preview could not be drawn. The change was not applied.",
        });
        cancelPresentation();
      }
    } finally {
      state.rendering = false;
      state.lastFinishedAt = performance.now();
      if (!state.disposed && state.pending && state.timer === null) {
        state.timer = window.setTimeout(
          () => void renderLatest(),
          FRAME_INTERVAL_MS,
        );
      }
    }
  }, [updateCamera]);

  const boardPreview =
    active && current?.proposal.target === "board" && current.elements
      ? current
      : null;

  useEffect(() => {
    const state = queue.current;
    // This effect also reactivates the queue after React's development
    // Strict Mode setup/cleanup probe.
    state.disposed = false;
    const nextProposal = boardPreview?.proposal.id ?? null;
    if (state.activeProposal !== nextProposal) {
      state.activeProposal = nextProposal;
      state.generation += 1;
    }
    if (!boardPreview) {
      state.pending = null;
      if (state.timer !== null) window.clearTimeout(state.timer);
      state.timer = null;
      host.current?.replaceChildren();
      return;
    }
    state.pending = {
      elements: boardPreview.elements!,
      appState: apiRef.current.getAppState(),
      files: apiRef.current.getFiles(),
      generation: state.generation,
    };
    if (!state.rendering && state.timer === null) {
      const delay = Math.max(
        0,
        FRAME_INTERVAL_MS - (performance.now() - state.lastFinishedAt),
      );
      state.timer = window.setTimeout(() => void renderLatest(), delay);
    }
  }, [board.files, boardPreview, renderLatest, viewportEpoch]);

  const proposalId = boardPreview?.proposal.id;
  const finalElements = boardPreview?.finalElements;
  const jobId = boardPreview?.proposal.jobId;

  useEffect(() => {
    if (!boardPreview) return;
    const canvas = container.current?.querySelector<HTMLCanvasElement>("canvas.interactive");
    if (!canvas) return;
    const pointerdown = (event: PointerEvent) => {
      const state = api.getAppState();
      if (event.pointerType === "touch") {
        touches.current.add(event.pointerId);
        if (!touchTool.current) {
          touchTool.current = state.activeTool;
          // During the preview fingers navigate. The explicit takeover button
          // checkpoints the drawing before touch editing can change the scene.
          flushSync(() => api.setActiveTool({ type: "hand" }));
        }
        return;
      }
      if (
        (event.button !== 0 && event.button !== 5) ||
        (event.button === 0 && holdingSpace.current) ||
        state.activeTool.type === "hand" || state.viewModeEnabled
      ) return;
      // Retain the visible frame before the first editing gesture can change
      // the canonical scene. Camera gestures continue to Excalidraw unchanged.
      event.preventDefault();
      event.stopPropagation();
      takeOverPresentation();
    };
    canvas.addEventListener("pointerdown", pointerdown, true);
    return () => {
      canvas.removeEventListener("pointerdown", pointerdown, true);
    };
  }, [api, container, Boolean(boardPreview)]);

  useEffect(() => {
    if (
      !proposalId ||
      !finalElements ||
      ownsBoardCamera(api, jobId) ||
      scrolledProposal.current === proposalId
    )
      return;
    const targets = boardChangedElements(board.elements, finalElements);
    if (!targets.length) return;
    const frame = requestAnimationFrame(() => {
      if (ownsBoardCamera(api, jobId)) return;
      scrolledProposal.current = proposalId;
      frameBoardCamera(api, () => api.scrollToContent(targets as unknown as ExcalidrawElement[], {
        fitToViewport: true,
        viewportZoomFactor: 0.6,
        maxZoom: Math.min(1, api.getAppState().zoom.value),
        animate: false,
      }));
    });
    return () => cancelAnimationFrame(frame);
  }, [api, board.elements, finalElements, jobId, proposalId]);

  useEffect(() => {
    queue.current.disposed = false;
    return () => {
      const state = queue.current;
      state.disposed = true;
      state.generation += 1;
      state.pending = null;
      if (state.timer !== null) window.clearTimeout(state.timer);
      state.timer = null;
    };
  }, []);

  if (!boardPreview) return null;
  const background = api.getAppState().viewBackgroundColor || "#fafaf7";
  const previewText = boardRenderElements(boardPreview.elements!)
    .filter((element) => element.type === "text")
    .map((element) => String(element.text ?? ""))
    .filter(Boolean)
    .join("\n");
  return (
    <div
      className={styles.board}
      aria-label="Study partner drawing preview"
      style={{ background }}
    >
      <button className={`${styles.label} ${styles.boardTakeover}`} type="button" onClick={takeOverPresentation}>Take over drawing</button>
      <span
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {previewText}
      </span>
      <div
        ref={viewport}
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, transformOrigin: "top left" }}
      ><div ref={host} /></div>
    </div>
  );
}
