import type { ArtifactRef, Tool } from "./model";
export type EditorAdapter = {
  focus: () => void;
  reveal: (ref: ArtifactRef) => void;
  image?: () => Promise<string | undefined>;
};
export const adapters: Partial<Record<Tool, EditorAdapter>> = {};
