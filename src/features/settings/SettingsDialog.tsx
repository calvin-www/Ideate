"use client";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { X } from "lucide-react";
import { KEY_PATTERN, useProviderKeys, type ProviderKeys } from "./providerKeys";
import styles from "./SettingsDialog.module.css";

const LABELS: Record<keyof ProviderKeys, string> = {
  gemini: "Gemini API key",
  elevenLabsKey: "ElevenLabs API key",
  elevenLabsVoiceId: "ElevenLabs voice ID",
};
const FIELDS = Object.keys(LABELS) as (keyof ProviderKeys)[];

export default function SettingsDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const open = useProviderKeys((s) => s.settingsOpen);
  const keys = useProviderKeys((s) => s.keys);
  const warning = useProviderKeys((s) => s.storageWarning);
  const [draft, setDraft] = useState<ProviderKeys>(keys);
  const [invalid, setInvalid] = useState("");

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setDraft(useProviderKeys.getState().keys);
      setInvalid("");
      element.showModal();
    } else if (!open && element.open) element.close();
  }, [open]);

  const close = () => useProviderKeys.getState().closeSettings();
  // save() rejects the whole draft when any field fails KEY_PATTERN, so a bad
  // entry would otherwise discard the visitor's other, working keys in silence.
  const firstInvalid = () =>
    FIELDS.find((key) => draft[key] !== "" && !KEY_PATTERN.test(draft[key]));
  const field = (key: keyof ProviderKeys) => ({
    value: draft[key],
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      setDraft({ ...draft, [key]: event.target.value.trim() }),
  });

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="settings-title"
      onClose={close}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          const bad = firstInvalid();
          if (bad) {
            setInvalid(
              `Check your ${LABELS[bad]}. It has to be 1 to 256 characters with no spaces, accents or emoji — paste it exactly as the provider shows it.`,
            );
            return;
          }
          setInvalid("");
          useProviderKeys.getState().save(draft);
          // A storage failure is only reported here, so stay open to show it.
          if (!useProviderKeys.getState().storageWarning) close();
        }}
      >
        <div className={styles.heading}>
          <h2 id="settings-title">Settings</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close settings"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <p>
          Keys stay in this browser and are only sent to this site&apos;s own
          API, which forwards them to the provider. Nothing is stored on the
          server.
        </p>
        <label className={styles.field}>
          Gemini API key
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            {...field("gemini")}
          />
          <small>
            Required for the study partner. Create one at{" "}
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noreferrer"
            >
              Google AI Studio
            </a>
            .
          </small>
        </label>
        <label className={styles.field}>
          ElevenLabs API key
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            {...field("elevenLabsKey")}
          />
        </label>
        <label className={styles.field}>
          ElevenLabs voice ID
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            {...field("elevenLabsVoiceId")}
          />
          <small>
            Optional. Voice stays off until both ElevenLabs fields are set; chat
            works as text.
          </small>
        </label>
        {(invalid || warning) && (
          <p className={styles.warning} role="alert">
            {invalid || warning}
          </p>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            className="button quiet"
            onClick={() => {
              useProviderKeys.getState().clear();
              setDraft({ gemini: "", elevenLabsKey: "", elevenLabsVoiceId: "" });
              setInvalid("");
            }}
          >
            Clear keys
          </button>
          <button type="submit" className="button primary">
            Save keys
          </button>
        </div>
      </form>
    </dialog>
  );
}
