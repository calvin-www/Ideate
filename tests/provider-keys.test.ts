import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROVIDER_KEYS_STORAGE_KEY,
  hasVoiceKeys,
  keyHeaders,
  parseProviderKeys,
  useProviderKeys,
} from "../src/features/settings/providerKeys";

const empty = { gemini: "", elevenLabsKey: "", elevenLabsVoiceId: "" };

// Tests run in Node (see vitest.config.ts); stub storage the same way
// tests/partner-defaults.test.ts does.
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("provider keys", () => {
  beforeEach(() => {
    useProviderKeys.setState({ keys: empty, hydrated: false, settingsOpen: false, storageWarning: "" });
  });

  it("parses stored keys and rejects anything malformed", () => {
    expect(parseProviderKeys(null)).toEqual(empty);
    expect(parseProviderKeys("not json")).toEqual(empty);
    expect(parseProviderKeys(JSON.stringify({ version: 2, gemini: "abc" }))).toEqual(empty);
    expect(
      parseProviderKeys(JSON.stringify({ version: 1, gemini: "AIza-1", elevenLabsKey: "el", elevenLabsVoiceId: "v1" })),
    ).toEqual({ gemini: "AIza-1", elevenLabsKey: "el", elevenLabsVoiceId: "v1" });
    expect(parseProviderKeys(JSON.stringify({ version: 1, gemini: "has space" }))).toEqual(empty);
    expect(parseProviderKeys(JSON.stringify({ version: 1, gemini: "x".repeat(257) }))).toEqual(empty);
    expect(parseProviderKeys(JSON.stringify({ version: 1, gemini: "ключ" }))).toEqual(empty);
  });

  it("saves to localStorage and hydrates back", () => {
    useProviderKeys.getState().save({ gemini: "g", elevenLabsKey: "", elevenLabsVoiceId: "" });
    expect(JSON.parse(localStorage.getItem(PROVIDER_KEYS_STORAGE_KEY)!)).toEqual({
      version: 1, gemini: "g", elevenLabsKey: "", elevenLabsVoiceId: "",
    });
    useProviderKeys.setState({ keys: empty, hydrated: false });
    useProviderKeys.getState().hydrate();
    expect(useProviderKeys.getState().keys.gemini).toBe("g");
    expect(useProviderKeys.getState().hydrated).toBe(true);
    useProviderKeys.getState().clear();
    expect(localStorage.getItem(PROVIDER_KEYS_STORAGE_KEY)).toBeNull();
    expect(useProviderKeys.getState().keys).toEqual(empty);
  });

  it("builds headers only for present keys and reports voice readiness", () => {
    expect(keyHeaders(empty)).toEqual({});
    expect(keyHeaders({ gemini: "g", elevenLabsKey: "e", elevenLabsVoiceId: "v" })).toEqual({
      "X-Gemini-Key": "g", "X-ElevenLabs-Key": "e", "X-ElevenLabs-Voice": "v",
    });
    expect(hasVoiceKeys(empty)).toBe(false);
    expect(hasVoiceKeys({ ...empty, elevenLabsKey: "e" })).toBe(false);
    expect(hasVoiceKeys({ ...empty, elevenLabsKey: "e", elevenLabsVoiceId: "v" })).toBe(true);
  });
});
