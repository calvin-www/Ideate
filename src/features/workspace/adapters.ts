import type { ArtifactRef, Tool } from "./model";
import { useWorkspace } from "./store";
export type EditorAdapter = {
  focus: () => void;
  reveal: (ref: ArtifactRef) => void;
  image?: () => Promise<string | undefined>;
};
export const adapters: Partial<Record<Tool, EditorAdapter>> = {};

type PendingReveal = {
  ref: ArtifactRef;
  workspaceId: string;
  editorEpoch: number;
};
type Registration = {
  adapter: EditorAdapter;
  workspaceId: string;
  editorEpoch: number;
};
const pending: Partial<Record<Tool, PendingReveal>> = {};
const registrations: Partial<Record<Tool, Registration>> = {};

function consumeReveal(tool: Tool) {
  const request = pending[tool];
  if (!request) return;
  const state = useWorkspace.getState();
  if (
    request.workspaceId !== state.data.id ||
    request.ref.revision !== state.data[tool].revision ||
    request.editorEpoch !== state.editorEpochs[tool]
  ) {
    delete pending[tool];
    return;
  }
  const registration = registrations[tool];
  if (
    !registration ||
    registration.workspaceId !== request.workspaceId ||
    registration.editorEpoch !== request.editorEpoch
  ) return;
  delete pending[tool];
  registration.adapter.reveal(request.ref);
}

export function requestSourceReveal(ref: ArtifactRef) {
  const state = useWorkspace.getState();
  if (ref.revision !== state.data[ref.tool].revision) return;
  pending[ref.tool] = {
    ref,
    workspaceId: state.data.id,
    editorEpoch: state.editorEpochs[ref.tool],
  };
  consumeReveal(ref.tool);
}

export function registerAdapter(tool: Tool, adapter: EditorAdapter): () => void {
  const state = useWorkspace.getState();
  const registration = {
    adapter,
    workspaceId: state.data.id,
    editorEpoch: state.editorEpochs[tool],
  };
  registrations[tool] = registration;
  adapters[tool] = adapter;
  consumeReveal(tool);
  return () => {
    if (registrations[tool] !== registration) return;
    delete registrations[tool];
    delete adapters[tool];
  };
}
