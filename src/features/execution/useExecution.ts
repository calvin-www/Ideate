"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RunnerClient, type DebugPause } from "./runner-client";
import { useWorkspace } from "../workspace/store";
import type { Run } from "../workspace/model";

export type DebugSession = {
  runId: string;
  revision: number;
  code: string;
  pause: DebugPause | null;
};

export function useExecution() {
  const iframe = useRef<HTMLIFrameElement>(null);
  const client = useRef<RunnerClient | null>(null);
  const pending = useRef<{ id: string; resolve: (run: Run) => void } | null>(
    null,
  );
  const [runtimeStatus, setRuntimeStatus] = useState("loading");
  const [debugSession, setDebugSession] = useState<DebugSession | null>(null);
  useEffect(() => {
    if (!iframe.current) return;
    const runner = new RunnerClient(iframe.current, {
      onStatus: setRuntimeStatus,
      onPaused: (runId, pause) =>
        setDebugSession((current) =>
          current?.runId === runId ? { ...current, pause } : current,
        ),
      onOutput: (runId, _channel, text) =>
        useWorkspace.getState().setData((data) => ({
          ...data,
          runs: data.runs.map((r) =>
            r.id === runId ? { ...r, output: r.output + text } : r,
          ),
        })),
      onComplete: (runId, result) => {
        setDebugSession((current) =>
          current?.runId === runId ? null : current,
        );
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
  const execute = useCallback((debug = false) => {
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
    setDebugSession(
      debug
        ? { runId: run.id, revision: run.revision, code: run.code, pause: null }
        : null,
    );
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
        client.current!.run({ id: run.id, code: run.code, debug });
      } catch (error) {
        pending.current = null;
        setDebugSession(null);
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
  const runCode = useCallback(() => execute(), [execute]);
  const debugCode = useCallback(() => execute(true), [execute]);
  const resumeDebug = useCallback((command: "step" | "continue") => {
    client.current?.resume(command);
    setDebugSession((current) =>
      current ? { ...current, pause: null } : null,
    );
  }, []);
  const stopCode = useCallback(() => client.current?.stop(), []);
  return {
    iframe,
    runCode,
    debugCode,
    resumeDebug,
    debugSession,
    stopCode,
    runtimeStatus,
  };
}
