import { afterEach, expect, it, vi } from "vitest";
import {
  createCheckpointStore,
  createSharedCheckpointStore,
  configuredCheckpointStore,
} from "../src/features/ai/server/checkpoints";
import { configuredVisitorLimiter } from "../src/features/ai/server/validation";

afterEach(() => vi.unstubAllEnvs());

it("requires shared checkpoint and visitor stores in production", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  expect(() => configuredCheckpointStore()).toThrow("Continuation storage is not configured");
  expect(() => configuredVisitorLimiter()).toThrow("Visitor throttling is not configured");
});

it("takes a shared checkpoint once across instances and rejects replay and expiry", async () => {
  let now = 1_000;
  const records = new Map<string, { value: unknown; expires: number }>();
  const redis = {
    async set(key: string, value: unknown, options: { ex: number; nx: true }) {
      expect(options.nx).toBe(true);
      if (records.has(key)) return null;
      records.set(key, { value, expires: now + options.ex * 1000 });
      return "OK" as const;
    },
    async getdel<T>(key: string): Promise<T | null> {
      const record = records.get(key);
      records.delete(key);
      return record && record.expires > now ? record.value as T : null;
    },
  };
  const instanceA = createSharedCheckpointStore(redis, () => now);
  const instanceB = createSharedCheckpointStore(redis, () => now);
  const request = { messages: ["first turn"], contextRevision: 1 };
  const token = await instanceA.issue("tool", request);

  await expect(instanceB.take("tool", token, request)).resolves.toBeUndefined();
  await expect(instanceA.take("tool", token, request)).rejects.toThrow(
    "This continuation expired or was already used",
  );

  const expired = await instanceA.issue("resume", request);
  now += 30 * 60_000;
  await expect(instanceB.take("resume", expired, request)).rejects.toThrow(
    "This continuation expired or was already used",
  );
});

it("keeps local development checkpoints single use", async () => {
  const store = createCheckpointStore();
  const request = { messages: ["hello"] };
  const token = await store.issue("tool", request);
  await store.take("tool", token, request);
  await expect(store.take("tool", token, request)).rejects.toThrow(
    "This continuation expired or was already used",
  );
});

it("consumes a presented token even when its payload does not match", async () => {
  const store = createCheckpointStore();
  const request = { messages: ["hello"] };
  const token = await store.issue("tool", request);
  await expect(store.take("tool", token, { messages: ["tampered"] })).rejects.toThrow(
    "This continuation expired or was already used",
  );
  await expect(store.take("tool", token, request)).rejects.toThrow(
    "This continuation expired or was already used",
  );
});
