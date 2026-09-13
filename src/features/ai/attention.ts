import { z } from "zod";
import type { Tool, Workspace } from "../workspace/model";

const offset = z.number().int().nonnegative().max(1_000_000);
export const attentionSchema = z.strictObject({
  target: z.enum(["board", "code", "notes"]),
  revision: z.number().int().nonnegative(),
  mode: z.enum(["point", "highlight"]),
  label: z.string().trim().min(1).max(100),
  ids: z.array(z.string().min(1).max(200)).min(1).max(12).optional(),
  from: offset.optional(),
  to: offset.optional(),
});
type Common = { revision: number; mode: "point" | "highlight"; label: string };
export type AttentionRequest = Common &
  (
    | { target: "board"; ids: string[] }
    | { target: "code" | "notes"; from: number; to: number }
  );
export type AttentionCue = AttentionRequest & {
  id: string;
  jobId: string;
  workspaceId: string;
};
export type AttentionState = Partial<Record<Tool, AttentionCue>>;

export function parseAttention(value: unknown): AttentionRequest | undefined {
  const result = attentionSchema.safeParse(value);
  if (!result.success) return;
  const cue = result.data;
  if (cue.target === "board") {
    if (!cue.ids || cue.from !== undefined || cue.to !== undefined) return;
  } else if (
    cue.ids !== undefined ||
    cue.from === undefined ||
    cue.to === undefined ||
    cue.to < cue.from ||
    (cue.mode === "highlight" && cue.to === cue.from)
  )
    return;
  return cue as AttentionRequest;
}

export function checkAttention(
  data: Workspace,
  cue: AttentionRequest,
): "conflicted" | "not_found" | null {
  if (data[cue.target].revision !== cue.revision) return "conflicted";
  if (cue.target === "board") {
    const available = new Set(
      data.board.elements.filter((e) => !e.isDeleted).map((e) => e.id),
    );
    if (cue.ids.some((id) => !available.has(id))) return "not_found";
  } else if (cue.to > data[cue.target].text.length) return "not_found";
  return null;
}
