import { flushSync } from "react-dom";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useWorkspace } from "../workspace/store";

type CameraOwner = { manualJobId: string | null; automatic: boolean };
const owners = new WeakMap<ExcalidrawImperativeAPI, CameraOwner>();

function owner(api: ExcalidrawImperativeAPI) {
  let state = owners.get(api);
  if (!state) {
    state = { manualJobId: null, automatic: false };
    owners.set(api, state);
  }
  return state;
}

export function recordBoardCameraChange(api: ExcalidrawImperativeAPI) {
  const state = owner(api);
  if (!state.automatic) state.manualJobId = useWorkspace.getState().jobId;
}

export function ownsBoardCamera(api: ExcalidrawImperativeAPI, jobId?: string | null) {
  return Boolean(jobId) && owner(api).manualJobId === jobId;
}

/** Run from an animation frame or event, outside a React lifecycle. */
export function frameBoardCamera(api: ExcalidrawImperativeAPI, frame: () => void) {
  const state = owner(api);
  state.automatic = true;
  try {
    // Excalidraw emits camera changes when its React update commits.
    // Keep the automatic marker set until those notifications finish.
    flushSync(frame);
  } finally {
    state.automatic = false;
  }
}
