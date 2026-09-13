"use client";
import { useCallback } from "react";
import {
  getCommonBounds,
  sceneCoordsToViewportCoords,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useWorkspace } from "../workspace/store";
import AttentionOverlay from "../ai/AttentionOverlay";

export default function BoardAttention({
  api,
  active,
}: {
  api: ExcalidrawImperativeAPI;
  active: boolean;
}) {
  const cue = useWorkspace((s) => s.attention.board);
  const elements = useCallback(
    () =>
      api
        .getSceneElements()
        .filter(
          (e) =>
            !e.isDeleted && cue?.target === "board" && cue.ids.includes(e.id),
        ),
    [api, cue],
  );
  const measure = useCallback(
    () =>
      elements().map((element) => {
        const [left, top, right, bottom] = getCommonBounds([element]);
        const state = api.getAppState();
        const start = sceneCoordsToViewportCoords(
          { sceneX: left, sceneY: top },
          state,
        );
        const end = sceneCoordsToViewportCoords(
          { sceneX: right, sceneY: bottom },
          state,
        );
        return {
          left: start.x - 5,
          top: start.y - 5,
          right: end.x + 5,
          bottom: end.y + 5,
        };
      }),
    [api, elements],
  );
  const reveal = useCallback(() => {
    const targets = elements();
    if (targets.length)
      api.scrollToContent(targets, {
        fitToViewport: true,
        viewportZoomFactor: 0.7,
        maxZoom: api.getAppState().zoom.value,
        animate: false,
      });
  }, [api, elements]);
  const subscribe = useCallback(
    (update: () => void) => api.onChange(update),
    [api],
  );
  return (
    <AttentionOverlay
      cue={cue}
      active={active}
      measure={measure}
      reveal={reveal}
      subscribe={subscribe}
    />
  );
}
