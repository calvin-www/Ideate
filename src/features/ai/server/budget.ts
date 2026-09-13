import { createHash, randomUUID } from "node:crypto";
import { AiRequestError } from "./validation";

export type GenerationLimits = {
  generation: number;
  total: number;
  recoveries: number;
};
export type GenerationBudget = GenerationLimits & {
  remaining: number;
  recovered: number;
  rounds: number;
};

export function generationLimits(): GenerationLimits {
  const read = (name: string, fallback: number, maximum: number) => {
    const value = process.env[name];
    if (!value) return fallback;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum)
      throw new AiRequestError(
        503,
        "The AI output limits are not configured correctly.",
      );
    return parsed;
  };
  return {
    generation: read("AI_MAX_OUTPUT_TOKENS", 16_384, 65_536),
    total: read("AI_MAX_JOB_OUTPUT_TOKENS", 32_768, 262_144),
    recoveries: 2,
  };
}

export function newBudget(limits: GenerationLimits): GenerationBudget {
  return { ...limits, remaining: limits.total, recovered: 0, rounds: 0 };
}

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

// Single-use, process-local checkpoints: a restart or another worker fails
// closed instead of silently granting a new budget. Store only hashes, never
// workspace contents. A shared atomic store is needed for multiple replicas.
export function createBudgetStore(now = Date.now) {
  const entries = new Map<
    string,
    {
      kind: "tool" | "resume";
      fingerprint: string;
      budget: GenerationBudget;
      expires: number;
    }
  >();
  const prune = () => {
    for (const [token, entry] of entries)
      if (entry.expires <= now()) entries.delete(token);
  };
  return {
    issue(kind: "tool" | "resume", value: unknown, budget: GenerationBudget) {
      prune();
      if (entries.size >= 1000) entries.delete(entries.keys().next().value!);
      const token = randomUUID();
      entries.set(token, {
        kind,
        fingerprint: digest(value),
        budget: { ...budget },
        expires: now() + 30 * 60_000,
      });
      return token;
    },
    take(
      kind: "tool" | "resume",
      token: string | undefined,
      value: unknown,
    ): GenerationBudget {
      prune();
      const entry = token ? entries.get(token) : undefined;
      if (!entry || entry.kind !== kind || entry.fingerprint !== digest(value))
        throw new AiRequestError(
          409,
          "This continuation expired or was already used. Send a new request to continue.",
        );
      entries.delete(token!);
      return entry.budget;
    },
  };
}
