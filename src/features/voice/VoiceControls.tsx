"use client";
import { useId, type ReactNode } from "react";
import { LoaderCircle, Mic, MicOff, Square } from "lucide-react";
import type { useVoiceSession } from "./useVoiceSession";
import { useWorkspace } from "../workspace/store";
import { usePresentation } from "./presentation";
import styles from "./VoiceControls.module.css";

type Props = {
  voice: ReturnType<typeof useVoiceSession>;
  disabled?: boolean;
  children?: ReactNode;
};

export default function VoiceControls({ voice, disabled, children }: Props) {
  const statusId = useId();
  const writing = usePresentation((s) => s.current?.proposal.target);
  const working = useWorkspace((s) => Boolean(s.jobId));
  const labels = { off: "Microphone off", connecting: "Connecting microphone", listening: "Listening", thinking: "Thinking", speaking: "Speaking", paused: "Listening" };
  const connected = voice.status !== "off";
  const microphoneLabel = !connected ? "Turn on microphone" : voice.muted ? "Unmute microphone" : "Mute microphone";
  const status = `${voice.muted && connected && voice.status !== "connecting" ? "Microphone muted" : labels[voice.status]}${writing ? ` · ${writing === "board" ? "drawing" : "writing"}` : ""}`;

  return (
    <section className={styles.controls} aria-label="Voice controls">
      <button
        className={`icon-button ${styles.microphone} ${connected && !voice.muted ? styles.active : ""}`}
        aria-label={microphoneLabel}
        aria-describedby={statusId}
        aria-pressed={connected && !voice.muted}
        title={`${microphoneLabel} · ${status}`}
        disabled={disabled || voice.status === "connecting"}
        onClick={() => connected ? voice.toggleMute() : void voice.start()}
      >
        {voice.status === "connecting" ? <LoaderCircle size={17} className="spin" /> : voice.muted ? <MicOff size={17} /> : <Mic size={17} />}
        {connected && !voice.muted && <i className={styles.indicator} aria-hidden="true" />}
      </button>
      {children}
      <button
        className={`icon-button ${styles.stop}`}
        aria-label="Stop"
        title="Stop speech and writing, and turn off microphone"
        disabled={disabled || (!connected && !working && !writing)}
        onClick={voice.stop}
      >
        <Square size={15} fill="currentColor" />
      </button>
      <span id={statusId} className={styles.status} role="status">{status}</span>
      {voice.transcript && <span className={styles.transcript}>{voice.transcript}</span>}
      {voice.error && <p className={styles.error} role="alert">{voice.error}</p>}
    </section>
  );
}