"use client";
import { create } from "zustand";

export type ProviderKeys = {
  gemini: string;
  elevenLabsKey: string;
  elevenLabsVoiceId: string;
};
export const PROVIDER_KEYS_STORAGE_KEY = "ideate:provider-keys:v1";
export const KEY_PATTERN = /^[\x21-\x7e]{1,256}$/;
const EMPTY: ProviderKeys = { gemini: "", elevenLabsKey: "", elevenLabsVoiceId: "" };

function field(value: unknown): string | null {
  if (value === undefined || value === "") return "";
  return typeof value === "string" && KEY_PATTERN.test(value) ? value : null;
}

/** Malformed storage yields empty keys rather than a crash or a partial key. */
export function parseProviderKeys(raw: string | null): ProviderKeys {
  if (!raw || raw.length > 2000) return { ...EMPTY };
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== "object" || value.version !== 1) return { ...EMPTY };
    const gemini = field(value.gemini);
    const elevenLabsKey = field(value.elevenLabsKey);
    const elevenLabsVoiceId = field(value.elevenLabsVoiceId);
    if (gemini === null || elevenLabsKey === null || elevenLabsVoiceId === null) return { ...EMPTY };
    return { gemini, elevenLabsKey, elevenLabsVoiceId };
  } catch {
    return { ...EMPTY };
  }
}

export function readProviderKeys(): ProviderKeys {
  try {
    if (typeof localStorage === "undefined") return { ...EMPTY };
    return parseProviderKeys(localStorage.getItem(PROVIDER_KEYS_STORAGE_KEY));
  } catch {
    return { ...EMPTY };
  }
}

export const hasVoiceKeys = (keys: ProviderKeys): boolean =>
  Boolean(keys.elevenLabsKey && keys.elevenLabsVoiceId);

export function aiHeaders(keys: ProviderKeys): Record<string, string> {
  return keys.gemini ? { "X-Gemini-Key": keys.gemini } : {};
}

export function voiceHeaders(keys: ProviderKeys): Record<string, string> {
  return {
    ...(keys.elevenLabsKey ? { "X-ElevenLabs-Key": keys.elevenLabsKey } : {}),
    ...(keys.elevenLabsVoiceId ? { "X-ElevenLabs-Voice": keys.elevenLabsVoiceId } : {}),
  };
}

type Store = {
  keys: ProviderKeys;
  hydrated: boolean;
  settingsOpen: boolean;
  storageWarning: string;
  hydrate: () => void;
  save: (keys: ProviderKeys) => void;
  clear: () => void;
  openSettings: () => void;
  closeSettings: () => void;
};

export const useProviderKeys = create<Store>((set) => ({
  keys: { ...EMPTY },
  hydrated: false,
  settingsOpen: false,
  storageWarning: "",
  hydrate: () => set({ keys: readProviderKeys(), hydrated: true }),
  save: (keys) => {
    const clean = parseProviderKeys(JSON.stringify({ version: 1, ...keys }));
    try {
      localStorage.setItem(PROVIDER_KEYS_STORAGE_KEY, JSON.stringify({ version: 1, ...clean }));
      set({ keys: clean, storageWarning: "" });
    } catch {
      set({ keys: clean, storageWarning: "Keys will be forgotten when this tab closes. Your browser could not save them." });
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(PROVIDER_KEYS_STORAGE_KEY);
    } catch {
      /* Nothing stored to remove. */
    }
    set({ keys: { ...EMPTY }, storageWarning: "" });
  },
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}));
