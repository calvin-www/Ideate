import { describe, expect, it } from "vitest";
import {
  isParentMessage,
  isRunnerMessage,
  trimUtf8,
} from "../runner/protocol.mjs";

const run = {
  protocol: "ideate-python",
  version: 1,
  type: "run",
  id: "run-1",
  code: "print(1)",
  artifactId: "code",
  sourceRevision: 3,
};

describe("isolated Python message protocol", () => {
  it("bounds debugger snapshots and accepts only valid resume commands", () => {
    const paused = {
      ...run,
      type: "paused",
      pauseId: 1,
      line: 1,
      functionName: "main",
      locals: [{ name: "value", value: "2" }],
    };
    expect(isRunnerMessage(paused)).toBe(true);
    for (const invalid of [
      { line: 0 },
      { pauseId: NaN },
      { locals: Array(26).fill({ name: "x", value: "1" }) },
      { locals: [{ name: "x", value: "x".repeat(961) }] },
    ])
      expect(isRunnerMessage({ ...paused, ...invalid })).toBe(false);
    expect(
      isParentMessage({ ...run, type: "resume", pauseId: 1, command: "step" }),
    ).toBe(true);
    expect(
      isParentMessage({ ...run, type: "resume", pauseId: 1, command: "eval" }),
    ).toBe(false);
    expect(isParentMessage({ ...run, debug: "yes" })).toBe(false);
  });

  it("accepts only bounded run requests with an identifiable captured program", () => {
    expect(isParentMessage(run)).toBe(true);
    for (const message of [
      null,
      {},
      { ...run, version: 2 },
      { ...run, id: "" },
      { ...run, code: "é".repeat(140_000) },
      { ...run, sourceRevision: -1 },
      { ...run, type: "apply_edit" },
    ]) {
      expect(isParentMessage(message)).toBe(false);
    }
  });

  it("rejects malformed or oversized output and completion messages", () => {
    const output = {
      protocol: "ideate-python",
      version: 1,
      type: "output",
      id: "run-1",
      sequence: 0,
      channel: "stdout",
      text: "hello\n",
    };
    expect(isRunnerMessage(output)).toBe(true);
    expect(isRunnerMessage({ ...output, channel: "html" })).toBe(false);
    expect(isRunnerMessage({ ...output, sequence: -1 })).toBe(false);
    expect(isRunnerMessage({ ...output, text: "x".repeat(9000) })).toBe(false);
    expect(
      isRunnerMessage({
        protocol: "ideate-python",
        version: 1,
        type: "complete",
        id: "run-1",
        status: "success",
        durationMs: 10,
      }),
    ).toBe(true);
    expect(
      isRunnerMessage({
        protocol: "ideate-python",
        version: 1,
        type: "complete",
        id: "run-1",
        status: "success",
        durationMs: Number.NaN,
      }),
    ).toBe(false);
  });

  it("caps UTF-8 bytes without emitting a broken character", () => {
    expect(trimUtf8("aé🦊z", 6)).toBe("aé");
    expect(trimUtf8("aé🦊z", 7)).toBe("aé🦊");
  });
});
