"use client";
import { useEffect, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { BoardElement } from "../workspace/model";
import { useWorkspace } from "../workspace/store";
import { usePresentation, cancelPresentation } from "./presentation";
import styles from "./Presentation.module.css";

function Element({ element }: { element: BoardElement }) {
  const x = Number(element.x ?? 0), y = Number(element.y ?? 0);
  const width = Number(element.width ?? 0), height = Number(element.height ?? 0);
  const progress = Number(element.voiceProgress ?? 1);
  const common = { stroke: String(element.strokeColor ?? "#355b46"), strokeWidth: Number(element.strokeWidth ?? 2), fill: "none", pathLength: 1, strokeDasharray: `${progress} 1` };
  let drawing;
  if (element.type === "text") drawing = <text x={x} y={y + Number(element.fontSize ?? 20)} fill={String(element.strokeColor ?? "#355b46")} fontSize={Number(element.fontSize ?? 20)} fontFamily="sans-serif">{String(element.text ?? "").split("\n").map((line, index) => <tspan key={index} x={x} dy={index ? "1.25em" : 0}>{line}</tspan>)}</text>;
  else if (element.type === "freedraw" || element.type === "arrow" || element.type === "line") {
    const points = (element.points as number[][] | undefined) ?? [[0, 0], [width, height]];
    drawing = <polyline {...common} strokeDasharray={undefined} strokeLinecap="round" strokeLinejoin="round" points={points.map(([px, py]) => `${x + px},${y + py}`).join(" ")} markerEnd={element.type === "arrow" && progress === 1 ? "url(#voice-arrowhead)" : undefined} />;
  } else if (element.type === "ellipse") drawing = <ellipse {...common} cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} />;
  else if (element.type === "diamond") drawing = <polygon {...common} points={`${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}`} />;
  else drawing = <rect {...common} x={x} y={y} width={width} height={height} />;
  return <g transform={`rotate(${Number(element.angle ?? 0) * 180 / Math.PI} ${x + width / 2} ${y + height / 2})`}>{drawing}</g>;
}

export default function BoardPresentation({ api }: { api: ExcalidrawImperativeAPI }) {
  const current = usePresentation((s) => s.current);
  const board = useWorkspace((s) => s.data.board);
  const [, redraw] = useState(0);
  useEffect(() => api.onChange(() => redraw((n) => n + 1)), [api]);
  if (current?.proposal.target !== "board" || !current.elements) return null;
  const state = api.getAppState();
  const changed = current.elements.filter((element) => !element.isDeleted && JSON.stringify(board.elements.find((old) => old.id === element.id)) !== JSON.stringify(element));
  return <div className={styles.board} aria-label="Study partner drawing preview" onPointerDown={cancelPresentation}>
    <span className={styles.label}>Drawing · click to take over</span>
    <svg width="100%" height="100%" aria-hidden="true">
      <defs><marker id="voice-arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10" fill="none" stroke="context-stroke" /></marker></defs>
      <g transform={`scale(${state.zoom.value}) translate(${state.scrollX} ${state.scrollY})`}>
        {changed.map((element) => <Element key={element.id} element={element} />)}
      </g>
    </svg>
  </div>;
}
