"use client";
import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  Download,
  LoaderCircle,
  MessageCircle,
  Monitor,
  PenTool,
  Settings,
  Table2,
  Upload,
  X,
} from "lucide-react";
import { useWorkspace, hydrateWorkspace, flushSave } from "./store";
import { presets, readPresetId } from "./presets";
import { toolTitles } from "./layoutPersistence";
import { type ArtifactRef, type Tool, type View } from "./model";
import { downloadFile, readSavedWorkspace } from "./persistence";
import { requestSourceReveal } from "./adapters";
import { useExecution } from "../execution/useExecution";
import { RUNNER_URL } from "../execution/runner-client";
import { useCollaborator } from "../ai/useCollaborator";
import ChatPanel from "../ai/ChatPanel";
import { useVoiceSession } from "../voice/useVoiceSession";
import VoiceControls from "../voice/VoiceControls";
import CodePanel from "../code/CodePanel";
import NotePanel from "../notes/NotePanel";
import SpreadsheetPanel from "../spreadsheet/SpreadsheetPanel";
import WorkspaceDataControls from "./WorkspaceDataControls";
import SettingsDialog from "../settings/SettingsDialog";
import { useProviderKeys } from "../settings/providerKeys";

const WorkspaceLayout = dynamic(() => import("./WorkspaceLayout"), { ssr: false });
const StableWorkspaceLayout = memo(WorkspaceLayout);

const BoardEditor = dynamic(() => import("../board/BoardEditor"), {
  ssr: false,
  loading: () => (
    <div className="loading-tool">
      <LoaderCircle className="spin" />
      Getting your whiteboard ready…
    </div>
  ),
});
const DeskScene = dynamic(() => import("../desk/DeskScene"), {
  ssr: false,
  loading: () => (
    <div className="loading-tool">
      <LoaderCircle className="spin" />
      Setting out your desk…
    </div>
  ),
});
const deskTools: { id: Tool; label: string; icon: typeof Monitor }[] = [
  { id: "board", label: "Whiteboard", icon: PenTool },
  { id: "code", label: "Computer", icon: Monitor },
  { id: "notes", label: "Journal", icon: BookOpen },
  { id: "spreadsheet", label: "Spreadsheet", icon: Table2 },
];

export default function WorkspaceShell() {
  const workspaceId = useWorkspace((state) => state.data.id);
  const codePreview = useWorkspace((state) => state.data.code.text);
  const notePreview = useWorkspace((state) => state.data.notes.text);
  const runStatus = useWorkspace((state) => state.data.runs.at(-1)?.status);
  const boardPreview = useWorkspace((state) => state.boardPreview);
  const editorEpochs = useWorkspace((state) => state.editorEpochs);
  const view = useWorkspace((state) => state.view);
  const chatOpen = useWorkspace((state) => state.chatOpen);
  const hydrated = useWorkspace((state) => state.hydrated);
  const recoveryNeeded = useWorkspace((state) => state.recoveryNeeded);
  const saveStatus = useWorkspace((state) => state.saveStatus);
  const saveError = useWorkspace((state) => state.saveError);
  const notice = useWorkspace((state) => state.notice);
  const execution = useExecution();
  const voice = useVoiceSession();
  const engine = useCollaborator(execution.runCode, execution.stopCode, voice.hooks);
  voice.bind(engine);
  const voiceSubmit = useRef(voice.submit);
  voiceSubmit.current = voice.submit;
  const ask = useCallback((text: string) => voiceSubmit.current(text), []);
  const collaborator = useMemo(
    () => ({ ...engine, ask }),
    [ask, engine.ask, engine.resume, engine.approve, engine.reject, engine.cancel, engine.clearHistory, engine.pending, engine.error, engine.paused],
  );
  const [source, setSource] = useState<ArtifactRef | null>(null);
  const sourceRevision = useWorkspace((state) => source ? state.data[source.tool].revision : null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [flat, setFlat] = useState(false);
  const [layoutToolbar, setLayoutToolbar] = useState<HTMLDivElement | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const lastTool = useRef<Tool | null>(null);
  const sourceDialog = useRef<HTMLDialogElement>(null);
  const sourceOpener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    useProviderKeys.getState().hydrate();
    const wantsDesk = new URLSearchParams(window.location.search).get("view") === "desk";
    const presetId = readPresetId();
    void hydrateWorkspace(
      wantsDesk ? { view: "desk" } : { view: presets[presetId].start, preset: presetId },
    );
    try {
      setFlat(localStorage.getItem("ideate:desk-view") === "simple");
    } catch {
      // Keep the default desk when storage is unavailable.
    }
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReducedMotion(media.matches);
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const save = () => {
      void flushSave();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (document.querySelector("dialog[open]")) return;
      if (event.key === "Escape" && document.querySelector("[popover]:popover-open")) return;
      const composer = (event.target as HTMLElement)?.closest(".chat-composer");
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        save();
      }
      if (
        event.altKey &&
        !event.shiftKey &&
        ["1", "2", "3", "4"].includes(event.key)
      ) {
        event.preventDefault();
        useWorkspace
          .getState()
          .navigate(
            (["board", "code", "notes", "spreadsheet"] as Tool[])[Number(event.key) - 1],
          );
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key === "Enter" &&
        !composer &&
        useWorkspace.getState().view === "code"
      ) {
        event.preventDefault();
        void execution
          .runCode()
          .catch((error) => useWorkspace.setState({ notice: error.message }));
      }
      if (event.key === "Escape" && !event.defaultPrevented) {
        if (composer) {
          useWorkspace.setState({ chatOpen: false });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", save);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", save);
    };
  }, [execution.runCode]);
  useEffect(() => {
    if (view === "desk" && lastTool.current) {
      const desk = document.querySelector(".desk-home");
      if (!desk) return;
      const opener = document.activeElement;
      // 3D labels mount asynchronously; wait for the visible object button.
      const focusObject = () => {
        if (document.activeElement !== opener && document.activeElement !== document.body) {
          observer.disconnect();
          return;
        }
        const button = Array.from(desk.querySelectorAll<HTMLButtonElement>(
          `[data-desk-tool="${lastTool.current}"]`,
        )).find((element) => element.getClientRects().length > 0);
        if (button) {
          button.focus({ preventScroll: true });
          observer.disconnect();
        }
      };
      const observer = new MutationObserver(focusObject);
      observer.observe(desk, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
      const frame = requestAnimationFrame(focusObject);
      return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
      };
    } else if (view !== "desk") {
      lastTool.current = view;
    }
  }, [view]);
  useEffect(() => {
    if (!source) return;
    const dialog = sourceDialog.current;
    dialog?.showModal();
    return () => {
      sourceOpener.current?.focus({ preventScroll: true });
    };
  }, [source]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => useWorkspace.setState({ notice: "" }), 7000);
    return () => clearTimeout(timer);
  }, [notice]);
  const openSource = useCallback((id: string) => {
    const data = useWorkspace.getState().data;
    const ref =
      data.references.find((r) => r.id === id) ??
      data.messages.flatMap((m) => m.sources ?? []).find((r) => r.id === id) ??
      data.changes.flatMap((change) => change.sources).find((r) => r.id === id);
    if (ref) {
      sourceOpener.current = document.activeElement as HTMLElement | null;
      setSource(ref);
    } else
      useWorkspace.setState({
        notice: "This source is not available in the saved workspace.",
      });
  }, []);
  const exportWorkspace = async () => {
    try {
      const { serializeWorkspaceBackup } = await import("./backup");
      downloadFile(
        "ideate-workspace.json",
        serializeWorkspaceBackup(useWorkspace.getState().data),
        "application/json",
      );
    } catch (error) {
      useWorkspace.setState({ notice: error instanceof Error ? error.message : "Could not export this workspace." });
    }
  };
  const open = (tool: View) => useWorkspace.getState().navigate(tool);
  const renderEditor = useCallback((tool: Tool, visible: boolean) =>
    tool === "board" ? (
      <BoardEditor key={`${workspaceId}-${editorEpochs.board}`} active={visible} />
    ) : tool === "code" ? (
      <CodePanel
        key={`${workspaceId}-${editorEpochs.code}`}
        active={visible}
        runCode={execution.runCode}
        stopCode={execution.stopCode}
        runtimeStatus={execution.runtimeStatus}
        debugCode={execution.debugCode}
        debugSession={execution.debugSession}
        resumeDebug={execution.resumeDebug}
      />
    ) : tool === "spreadsheet" ? (
      <SpreadsheetPanel key={`${workspaceId}-${editorEpochs.spreadsheet}`} visible={visible} />
    ) : (
      <NotePanel key={`${workspaceId}-${editorEpochs.notes}`} active={visible} onReference={openSource} />
    ), [workspaceId, editorEpochs, execution.runCode, execution.stopCode, execution.runtimeStatus, execution.debugCode, execution.debugSession, execution.resumeDebug, openSource]);
  return (
    <div className="app-shell">
      <header className="app-header">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            open("desk");
          }}
          aria-label="Ideate, desk"
          title={view === "desk" ? "Ideate" : "Desk"}
        >
          <svg
            width="30"
            height="33"
            viewBox="0 0 30 33"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M8 26V8c0-5 12-5 12 0v18M3 19h22M8 10l12 12"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
            />
            <circle cx="25" cy="5" r="2" fill="currentColor" />
          </svg>
          <span className="brand-text">
            <span>
            ideate<span className="brand-dot">.</span>
            </span>
            {view !== "desk" && <small className="brand-back">Desk</small>}
          </span>
        </a>
        <div className="header-actions">
          <div ref={setLayoutToolbar} className="editor-layout-controls" hidden={view === "desk"} />
          <span
            className={`save-status ${saveStatus}`}
            title={saveError || "Saved in this browser"}
            aria-live="polite"
          >
            {saveStatus === "saving" ? (
              <LoaderCircle size={13} className="spin" />
            ) : (
              <Check size={13} />
            )}
            <span>
              {saveStatus === "saved"
                ? "Saved locally"
                : saveStatus === "error"
                  ? "Save needs attention"
                  : saveStatus === "loading"
                    ? "Loading"
                    : "Saving"}
            </span>
          </span>
          <button
            className="icon-button"
            title="Export workspace"
            aria-label="Export workspace"
            onClick={exportWorkspace}
          >
            <Download size={17} />
          </button>
          <button
            className="icon-button"
            title="Import workspace"
            aria-label="Import workspace"
            onClick={() => importInput.current?.click()}
          >
            <Upload size={17} />
          </button>
          <button
            className="icon-button"
            title="Settings"
            aria-label="Settings"
            onClick={() => useProviderKeys.getState().openSettings()}
          >
            <Settings size={17} />
          </button>
          <VoiceControls voice={voice} disabled={!hydrated}>
            <button
              className={`icon-button partner-toggle ${chatOpen ? "selected" : ""}`}
              aria-label="Toggle study partner"
              title={chatOpen ? "Close study partner" : "Open study partner"}
              aria-expanded={chatOpen}
              onClick={() => useWorkspace.setState({ chatOpen: !chatOpen })}
            >
              <MessageCircle size={17} />
            </button>
          </VoiceControls>
          <WorkspaceDataControls
            disabled={!hydrated}
            onExport={exportWorkspace}
            onClear={(scope) => {
              if (scope === "all") collaborator.clearHistory();
              else collaborator.cancel();
              if (scope === "all" || scope === "code") execution.stopCode();
              setSource(null);
              useWorkspace.getState().clearData(scope);
              if (scope !== "all")
                useWorkspace.setState({
                  notice: `${scope === "board" ? "Whiteboard" : scope === "code" ? "Python" : "Notes"} cleared.`,
                });
            }}
          />
        </div>
      </header>
      <SettingsDialog />
      <input
        ref={importInput}
        type="file"
        hidden
        accept=".json,application/json"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          try {
            const { MAX_WORKSPACE_BYTES, parseWorkspaceBackup } = await import("./backup");
            if (file.size > MAX_WORKSPACE_BYTES)
              throw new Error("Workspace file exceeds the 32 MiB backup limit.");
            const imported = await parseWorkspaceBackup(await file.text());
            if (
              !window.confirm(
                "Replace this workspace with the imported copy? Export first if you want to keep your current work.",
              )
            )
              return;
            voice.stop();
            collaborator.cancel();
            execution.stopCode();
            useWorkspace.getState().replaceWorkspace(imported, "Workspace imported.");
          } catch (error) {
            useWorkspace.setState({
              notice:
                error instanceof Error
                  ? error.message
                  : "Could not import this workspace.",
            });
          }
        }}
      />
      {saveError && (
        <div className="storage-error" role="alert">
          {saveError}
          <button onClick={exportWorkspace}>Export current work</button>
          {recoveryNeeded ? (
            <button
              onClick={async () => {
                try {
                  downloadFile(
                    "ideate-recovery.json",
                    JSON.stringify(await readSavedWorkspace(), null, 2),
                    "application/json",
                  );
                } catch {
                  useWorkspace.setState({
                    notice:
                      "Browser storage is unavailable. Your saved data has not been replaced.",
                  });
                }
              }}
            >
              Download saved recovery copy
            </button>
          ) : (
            <button onClick={() => void flushSave()}>Retry save</button>
          )}
        </div>
      )}
      <div className="workspace-body">
        <main
          className={`workspace-main ${view === "desk" ? "desk-view" : "tool-view"}`}
        >
          {!hydrated ? (
            <div className="loading-tool">
              <LoaderCircle className="spin" />
              Opening your workspace…
            </div>
          ) : (
            <>
              {view === "desk" ? (
                <section className="desk-home" aria-label="Your study desk">
                  <div className="desk-intro">
                    <div>
                      <p className="quiet-label">Your quiet corner</p>
                      <h1>
                        A little space for
                        <br />
                        big understanding.
                      </h1>
                      <p>
                        Sketch an idea. Try it in code.
                        <br />
                        Keep the part that clicks.
                      </p>
                    </div>
                    <button
                      className="view-switch"
                      onClick={() => {
                        setFlat(!flat);
                        try {
                          localStorage.setItem("ideate:desk-view", flat ? "3d" : "simple");
                        } catch {
                          // The preference still works for this session.
                        }
                      }}
                    >
                      {flat ? "Show 3D desk" : "Use simple view"}
                    </button>
                  </div>
                  <div className="scene-container">
                    {flat ? (
                      <div className="flat-desk">
                        {deskTools.map((item, index) => (
                            <button key={item.id} onClick={() => open(item.id)} data-desk-tool={item.id} aria-keyshortcuts={`Alt+${index + 1}`}>
                              <item.icon size={40} />
                              <strong>{item.label}<kbd className="desk-shortcut">Alt+{index + 1}</kbd></strong>
                              <span>
                                {item.id === "board"
                                  ? "Make your thinking visible"
                                  : item.id === "code"
                                    ? "Turn a thought into an experiment"
                                    : item.id === "spreadsheet"
                                      ? "Work through the numbers"
                                      : "Keep what you discover"}
                              </span>
                            </button>
                          ))}
                      </div>
                    ) : (
                      <DeskScene
                        onOpen={open}
                        codePreview={codePreview}
                        notePreview={notePreview}
                        boardPreview={boardPreview || undefined}
                        runStatus={runStatus}
                        reducedMotion={reducedMotion}
                      />
                    )}
                  </div>
                  <div className="desk-footer">
                    <span>
                      <span className="small-sun">✳</span>Choose an object.
                      Your work stays right here.
                    </span>
                    <button
                      onClick={() => {
                        open("board");
                      }}
                    >
                      Start at the whiteboard <span aria-hidden="true">↗</span>
                    </button>
                  </div>
                </section>
              ) : null}
              <StableWorkspaceLayout toolbar={layoutToolbar} renderEditor={renderEditor} />
            </>
          )}
        </main>
        {chatOpen && (
          <ChatPanel
            key={workspaceId}
            collaborator={collaborator}
            onReference={openSource}
          />
        )}
      </div>
      <iframe
        ref={execution.iframe}
        src={RUNNER_URL}
        title="Isolated Python runner"
        className="runner-frame"
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        aria-hidden="true"
        tabIndex={-1}
      />
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => useWorkspace.setState({ notice: "" })}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {source && (
          <dialog
            ref={sourceDialog}
            className="source-dialog"
            aria-labelledby="source-title"
            onClose={() => setSource(null)}
            onClick={(event) => {
              if (event.target !== event.currentTarget) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              if (
                event.clientX < bounds.left || event.clientX > bounds.right ||
                event.clientY < bounds.top || event.clientY > bounds.bottom
              ) event.currentTarget.close();
            }}
          >
            <button
              className="icon-button modal-close"
              aria-label="Close source"
              onClick={() => sourceDialog.current?.close()}
              autoFocus
            >
              <X size={18} />
            </button>
            <p className="quiet-label">
              Saved source · revision {source.revision}
            </p>
            <h2 id="source-title">{source.label}</h2>
            {sourceRevision !== source.revision && (
              <p className="source-outdated">
                This source has changed. The excerpt below is from the original
                revision.
              </p>
            )}
            <pre>
              {source.excerpt || "A visual selection from the whiteboard."}
            </pre>
            <button
              className="button primary"
              onClick={() => {
                sourceOpener.current = null;
                sourceDialog.current?.close();
                useWorkspace.getState().navigate(source.tool, { reveal: true });
                if (sourceRevision === source.revision)
                  requestSourceReveal(source);
              }}
            >
              Open{" "}
              {toolTitles[source.tool]}
            </button>
          </dialog>
      )}
    </div>
  );
}
