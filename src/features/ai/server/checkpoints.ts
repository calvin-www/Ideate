import { createHash, randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import { AiRequestError } from "./validation";

function digest(value: unknown): string {
  return createHash("sha256")
    .update(
      JSON.stringify(value, (_key, item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? Object.fromEntries(
              Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
            )
          : item,
      ),
    )
    .digest("hex");
}

type CheckpointKind = "tool" | "resume";
type CheckpointEntry = {
  kind: CheckpointKind;
  fingerprint: string;
  expires: number;
};
export type CheckpointStore = {
  issue(kind: CheckpointKind, value: unknown): Promise<string>;
  take(kind: CheckpointKind, token: string | undefined, value: unknown): Promise<void>;
};
type RedisCheckpointCommands = {
  set(key: string, value: CheckpointEntry, options: { ex: number; nx: true }): Promise<unknown>;
  getdel<T>(key: string): Promise<T | null>;
};
const CHECKPOINT_TTL_MS = 30 * 60_000;

function invalidCheckpoint(): never {
  throw new AiRequestError(409, "This continuation expired or was already used. Send a new request to continue.");
}

// Development-only process-local store. Production uses the shared Redis store.
export function createCheckpointStore(now = Date.now) {
  const entries = new Map<string, CheckpointEntry>();
  const prune = () => {
    for (const [token, entry] of entries)
      if (entry.expires <= now()) entries.delete(token);
  };
  return {
    async issue(kind: CheckpointKind, value: unknown) {
      prune();
      if (entries.size >= 1000) entries.delete(entries.keys().next().value!);
      const token = randomUUID();
      entries.set(token, {
        kind,
        fingerprint: digest(value),
        expires: now() + CHECKPOINT_TTL_MS,
      });
      return token;
    },
    async take(
      kind: CheckpointKind,
      token: string | undefined,
      value: unknown,
    ): Promise<void> {
      prune();
      const entry = token ? entries.get(token) : undefined;
      if (token) entries.delete(token);
      if (!entry || entry.kind !== kind || entry.fingerprint !== digest(value))
        invalidCheckpoint();
    },
  } satisfies CheckpointStore;
}

export function createSharedCheckpointStore(redis: RedisCheckpointCommands, now = Date.now): CheckpointStore {
  return {
    async issue(kind, value) {
      const token = randomUUID();
      try {
        const saved = await redis.set(`ideate:checkpoint:${token}`, {
          kind,
          fingerprint: digest(value),
          expires: now() + CHECKPOINT_TTL_MS,
        }, { ex: CHECKPOINT_TTL_MS / 1000, nx: true });
        if (saved !== "OK") throw new Error("Checkpoint collision");
      } catch {
        throw new AiRequestError(503, "Continuation storage is unavailable. Try again shortly.");
      }
      return token;
    },
    async take(kind, token, value) {
      if (!token) invalidCheckpoint();
      let entry: CheckpointEntry | null;
      try {
        entry = await redis.getdel<CheckpointEntry>(`ideate:checkpoint:${token}`);
      } catch {
        throw new AiRequestError(503, "Continuation storage is unavailable. Try again shortly.");
      }
      if (!entry || entry.expires <= now() || entry.kind !== kind || entry.fingerprint !== digest(value))
        invalidCheckpoint();
    },
  };
}

const localCheckpoints = createCheckpointStore();
let sharedCheckpoints: CheckpointStore | undefined;

export function configuredCheckpointStore(): CheckpointStore {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (process.env.NODE_ENV !== "production" && !url && !token) return localCheckpoints;
    throw new AiRequestError(503, "Continuation storage is not configured.");
  }
  if (!sharedCheckpoints) {
    const redis = Redis.fromEnv();
    sharedCheckpoints = createSharedCheckpointStore({
      set: (key, value, options) => redis.set(key, value, options),
      getdel: <T>(key: string) => redis.getdel<T>(key),
    });
  }
  return sharedCheckpoints;
}
