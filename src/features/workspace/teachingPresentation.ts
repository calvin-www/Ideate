import type { PendingWorkspaceChange } from "./commands";
import { estimateSpeechDuration, playStep } from "../voice/playback";
import { presentChange } from "../voice/presentation";

export type TeachingStep = {
  id: string;
  text: string;
  change?: PendingWorkspaceChange;
};

export function presentTeachingStep(
  step: TeachingStep,
  signal: AbortSignal,
  narrate?: (id: string, text: string, signal: AbortSignal) => Promise<void> | void,
): Promise<void> {
  const change = step.change;
  return playStep(step.text, signal, {
    narrate: narrate ? (text, audioSignal) => narrate(step.id, text, audioSignal) : undefined,
    present: change
      ? (visualSignal) => presentChange(
          change.proposal,
          change.preview,
          visualSignal,
          estimateSpeechDuration(step.text),
        )
      : undefined,
  });
}
