"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RunnerClient } from "./runner-client";
import { useWorkspace } from "../workspace/store";
import type { Run } from "../workspace/model";

export function useExecution() {
  const iframe = useRef<HTMLIFrameElement>(null);
  const client = useRef<RunnerClient | null>(null);
  const pending = useRef<{ id: string; resolve: (run: Run) => void } | null>(
    null,
  );
  const [runtimeStatus, setRuntimeStatus] = useState("loading");
  useEffect(() => {
    if (!iframe.current) return;
    const runner = new RunnerClient(iframe.current, {
      onStatus: setRuntimeStatus,
      onOutput: (runId, _channel, text) =>
        useWorkspace
          .getState()
          .setData((data) => ({
            ...data,
            runs: data.runs.map((r) =>
              r.id === runId ? { ...r, output: r.output + text } : r,
            ),
          })),
      onComplete: (runId, result) => {
        const state = useWorkspace.getState();
        const current = state.data.runs.find((r) => r.id === runId);
        if (!current || current.status !== "running") return;
        const done: Run = { ...current, ...result };
        state.setData((data) => ({
          ...data,
          runs: data.runs.map((r) => (r.id === runId ? done : r)),
        }));
        if (pending.current?.id === runId) {
          pending.current.resolve(done);
          pending.current = null;
        }
      },
    });
    client.current = runner;
    return () => {
      runner.dispose();
      client.current = null;
    };
  }, []);
  const runCode = useCallback(() => {
    if (pending.current)
      return Promise.reject(new Error("A program is already running."));
    if (!client.current)
      return Promise.reject(new Error("Python is still loading."));
    const state = useWorkspace.getState();
    const run: Run = {
      id: crypto.randomUUID(),
      code: state.data.code.text,
      revision: state.data.code.revision,
      output: "",
      status: "running",
      startedAt: Date.now(),
      durationMs: 0,
    };
    state.setData((data) => {
      const referenced = new Set(data.references.map((ref) => ref.runId));
      return {
        ...data,
        runs: [
          ...data.runs.filter(
            (r, i) => i >= data.runs.length - 15 || referenced.has(r.id),
          ),
          run,
        ],
      };
    });
    state.navigate("code");
    return new Promise<Run>((resolve, reject) => {
      pending.current = { id: run.id, resolve };
      try {
        client.current!.run({ id: run.id, code: run.code });
      } catch (error) {
        pending.current = null;
        state.setData((data) => ({
          ...data,
          runs: data.runs.map((r) =>
            r.id === run.id
              ? { ...r, status: "error", error: "Python could not start." }
              : r,
          ),
        }));
        reject(error);
      }
    });
  }, []);
  const stopCode = useCallback(() => client.current?.stop(), []);
  return { iframe, runCode, stopCode, runtimeStatus };
}
