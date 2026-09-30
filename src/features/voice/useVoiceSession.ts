"use client";
import { useEffect, useRef, useState } from "react";
import type { PendingChange, VoiceHooks } from "../ai/useCollaborator";
import { useWorkspace } from "../workspace/store";
import { closeAudio, connectMicrophone, speak, unlockAudio } from "./transport";
import { checkpointPresentation, clearPresentation, usePresentation } from "./presentation";
import { createNarrationQueue } from "./playback";
import { hasVoiceKeys, useProviderKeys } from "../settings/providerKeys";

type Collaborator = {
  ask: (prompt: string) => Promise<void>;
  cancel: () => void;
  approve: () => Promise<void>;
  reject: () => void;
  pending: PendingChange | null;
};
export type VoiceStatus = "off" | "connecting" | "listening" | "thinking" | "speaking" | "paused";
type Delivery = { id: string; text: string; status: "heard" | "interrupted" };

export function useVoiceSession() {
  const [status, setStatus] = useState<VoiceStatus>("off");
  const [muted, setMuted] = useState(true);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const session = useRef<AbortController | null>(null);
  const microphone = useRef<Awaited<ReturnType<typeof connectMicrophone>> | null>(null);
  const collaborator = useRef<Collaborator | null>(null);
  const active = useRef(false);
  const muteRef = useRef(true);
  const goal = useRef("");
  const unfinishedGoal = useRef("");
  const deliveries = useRef<Delivery[]>([]);
  const workspaceId = useRef("");
  const mounted = useRef(true);
  const turn = useRef(0);
  const narration = useRef(createNarrationQueue(() => {
    if (mounted.current) setError("Audio could not play. The explanation is still available in text.");
  }));

  function pause() {
    turn.current++;
    if (usePresentation.getState().current && goal.current) unfinishedGoal.current = goal.current;
    checkpointPresentation();
    narration.current.stop();
    collaborator.current?.cancel();
    clearPresentation();
    if (active.current && mounted.current) setStatus("paused");
  }
  function end() {
    checkpointPresentation();
    active.current = false;
    goal.current = ""; unfinishedGoal.current = ""; deliveries.current = [];
    session.current?.abort(); session.current = null;
    microphone.current?.close(); microphone.current = null;
    pause();
    void closeAudio().catch(() => undefined);
    muteRef.current = true;
    if (mounted.current) { setStatus("off"); setMuted(true); setTranscript(""); }
  }
  async function ask(text: string) {
    if (!active.current || !collaborator.current || !text.trim()) return;
    const command = text.trim().replace(/[.!?]+$/, "").toLowerCase();
    setTranscript(""); setError("");
    if (/^(stop|stop listening|turn off (the )?(mic|microphone)|end voice|end session)$/.test(command)) { end(); return; }
    if (/^(pause|wait)$/.test(command)) { pause(); return; }
    if (collaborator.current.pending && /^(apply|apply it|yes apply it|approve|go ahead)$/.test(command)) {
      const identity = session.current, turnId = ++turn.current;
      setStatus("thinking");
      await collaborator.current.approve();
      if (active.current && identity === session.current && turnId === turn.current && !narration.current.isPlaying()) setStatus("listening");
      return;
    }
    if (collaborator.current.pending && /^(reject|reject it|no|don't apply it)$/.test(command)) {
      collaborator.current.reject(); return;
    }
    pause();
    narration.current.resume();
    const resumeGoal = unfinishedGoal.current || goal.current;
    const continuing = /^(continue|resume|keep going)$/.test(command) && resumeGoal;
    const request = continuing
      ? `Continue the previous task from the work already present, including any paused partial edits. Address the latest clarification first. Previous request: ${resumeGoal}`
      : text;
    goal.current = continuing ? resumeGoal : text;
    const identity = session.current;
    const turnId = ++turn.current;
    setStatus("thinking");
    await collaborator.current.ask(request);
    if (active.current && identity === session.current && turnId === turn.current && !narration.current.isPlaying()) {
      if (continuing && useWorkspace.getState().data.messages.at(-1)?.status === "complete") unfinishedGoal.current = "";
      setStatus("listening");
    }
  }
  const actions = useRef({ pause, end, ask });
  actions.current = { pause, end, ask };
  useEffect(() => {
    mounted.current = true;
    const takeover = () => actions.current.pause();
    const unload = () => actions.current.end();
    window.addEventListener("ideate:voice-takeover", takeover);
    window.addEventListener("pagehide", unload);
    const unsubscribe = useWorkspace.subscribe((state, previous) => {
      if (state.data.id !== previous.data.id || (previous.data.messages.length > 0 && !state.data.messages.length)) {
        goal.current = ""; unfinishedGoal.current = ""; deliveries.current = [];
        if (session.current) actions.current.end();
      }
    });
    return () => {
      mounted.current = false;
      actions.current.end();
      unsubscribe();
      window.removeEventListener("ideate:voice-takeover", takeover);
      window.removeEventListener("pagehide", unload);
    };
  }, []);

  async function start() {
    if (session.current) return;
    if (!hasVoiceKeys(useProviderKeys.getState().keys)) {
      setError("Add your ElevenLabs API key and voice ID in Settings to use voice.");
      return;
    }
    setError(""); setStatus("connecting");
    const controller = new AbortController();
    session.current = controller;
    workspaceId.current = useWorkspace.getState().data.id;
    try {
      await unlockAudio();
      const mic = await connectMicrophone({
        onSpeechStart: () => {
          if (!active.current || muteRef.current || controller !== session.current) return;
          if (!collaborator.current?.pending) actions.current.pause();
        },
        onPartial: (text) => {
          if (active.current && !muteRef.current && controller === session.current) {
            setTranscript(text);
            if (text.trim() && narration.current.isPlaying()) actions.current.pause();
          }
        },
        onUtterance: (text) => {
          if (active.current && !muteRef.current && controller === session.current) void actions.current.ask(text);
        },
        onError: (message) => {
          if (controller !== session.current) return;
          actions.current.end(); setError(message);
        },
      }, controller.signal);
      if (controller.signal.aborted || controller !== session.current || workspaceId.current !== useWorkspace.getState().data.id) { mic.close(); return; }
      microphone.current = mic; active.current = true;
      narration.current.resume();
      muteRef.current = false; setMuted(false);
      setStatus("listening");
    } catch (failure) {
      if (controller !== session.current) return;
      end();
      setError(failure instanceof Error ? failure.message : "Voice could not connect. You can keep typing.");
    }
  }
  function toggleMute() {
    if (!active.current || !microphone.current) return;
    muteRef.current = !muteRef.current;
    microphone.current?.mute(muteRef.current);
    setMuted(muteRef.current); setTranscript("");
  }
  function stopAudio() {
    narration.current.stop();
    if (active.current && mounted.current)
      setStatus(useWorkspace.getState().jobId ? "thinking" : "listening");
  }
  const hooks: VoiceHooks = {
    enabled: () => active.current,
    context: () => ({ recentSpeech: deliveries.current.slice(-8), previousGoal: goal.current, unfinishedGoal: unfinishedGoal.current }),
    clear: clearPresentation,
    narrate: (id, text, signal) => {
      if (!active.current || !session.current) return;
      const identity = session.current;
      narration.current.enqueue(id, signal, async (audioSignal) => {
        if (identity !== session.current || !active.current) return;
        let delivery: Delivery | undefined;
        try {
          await speak(text, AbortSignal.any([audioSignal, identity.signal]), () => {
            if (identity !== session.current || audioSignal.aborted) return;
            delivery = { id, text, status: "interrupted" };
            deliveries.current = [...deliveries.current.slice(-7), delivery];
            setStatus("speaking");
          });
          if (delivery && identity === session.current) delivery.status = "heard";
        } finally {
          if (active.current && identity === session.current && !audioSignal.aborted)
            setStatus(useWorkspace.getState().jobId ? "thinking" : "listening");
        }
      });
    },
  };
  return { status, muted, transcript, error, start, stop: end, stopAudio, toggleMute,
    submit: (text: string) => active.current ? ask(text) : collaborator.current?.ask(text) ?? Promise.resolve(),
    hooks,
    bind: (value: Collaborator) => { collaborator.current = value; },
  };
}
