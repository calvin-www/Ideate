"use client";

import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { ContactShadows, Html, RoundedBox } from "@react-three/drei";
import { CanvasTexture, Color, SRGBColorSpace, Vector3, type Texture } from "three";
import styles from "./DeskScene.module.css";

type Tool = "board" | "code" | "notes";
type Triple = [number, number, number];

export interface DeskSceneProps {
  onOpen: (tool: Tool) => void;
  codePreview: string;
  notePreview: string;
  boardPreview?: string;
  runStatus?: string;
  reducedMotion?: boolean;
}

const OBJECTS = {
  board: { name: "Whiteboard", detail: "Make the idea visible", key: "1" },
  code: { name: "Computer", detail: "Put it into practice", key: "2" },
  notes: { name: "Journal", detail: "Keep what clicks", key: "3" },
};
const CAMERA_POSITION = new Vector3(8.6, 8.5, 12.8);
const CAMERA_LOOK_AT = new Vector3(0, 0.6, 0);
const OBJECT_POSITION: Record<Tool, Vector3> = {
  board: new Vector3(-3.55, 1.5, -1.55),
  code: new Vector3(0.35, 1.7, -1.4),
  notes: new Vector3(3.1, 0.2, 1.65),
};
const NO_RAYCAST = () => null;

function makeTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context) draw(context);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function usePreviewTexture(kind: Tool, content: string, status?: string) {
  const texture = useMemo(() => makeTexture(1200, 760, (ctx) => {
    if (kind === "code") {
      ctx.fillStyle = "#142d28";
      ctx.fillRect(0, 0, 1200, 760);
      ctx.fillStyle = "#1d3a32";
      ctx.fillRect(0, 0, 1200, 92);
      ctx.fillStyle = "#dfded0";
      ctx.font = "26px monospace";
      ctx.fillText("main.py", 42, 58);
      ["#b87463", "#c5ab72", "#81a183"].forEach((color, i) => {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(1080 + i * 35, 45, 8, 0, Math.PI * 2); ctx.fill();
      });
      const lines = content.split("\n").slice(0, 11);
      ctx.font = "25px monospace";
      lines.forEach((line, i) => {
        ctx.fillStyle = "#658176";
        ctx.fillText(String(i + 1).padStart(2, " "), 35, 142 + i * 45);
        ctx.fillStyle = line.trim().startsWith("#") ? "#8fa892" : /\b(def|return|while|if|else|elif|for)\b/.test(line) ? "#e1c28a" : "#d9e5d7";
        ctx.fillText(line.slice(0, 64), 96, 142 + i * 45);
      });
      ctx.fillStyle = "#28443b";
      ctx.fillRect(0, 690, 1200, 70);
      ctx.fillStyle = "#a6c3a2";
      ctx.beginPath(); ctx.arc(43, 725, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#c8d8c6";
      ctx.font = "23px monospace";
      ctx.fillText((status || "Python · ready when you are").slice(0, 70), 65, 734);
      return;
    }

    ctx.fillStyle = kind === "notes" ? "#f6efd9" : "#faf9f0";
    ctx.fillRect(0, 0, 1200, 760);
    if (kind === "notes") {
      ctx.strokeStyle = "#dcd7c1";
      ctx.lineWidth = 1.6;
      for (let y = 194; y < 710; y += 54) { ctx.beginPath(); ctx.moveTo(74, y); ctx.lineTo(1116, y); ctx.stroke(); }
      ctx.fillStyle = "#355343";
      ctx.font = "italic 47px Georgia, serif";
      const heading = content.split("\n").find((line) => line.trim())?.replace(/^#+\s*/, "") || "A little clearer, each day.";
      ctx.fillText(heading.slice(0, 39), 78, 123);
      ctx.fillStyle = "#64715a";
      ctx.font = "28px Georgia, serif";
      content.split("\n").filter((line) => line.trim()).slice(1, 9).forEach((line, i) => {
        ctx.fillText(line.replace(/^[#>*-]+\s*/, "").replace(/\*\*/g, "").slice(0, 72), 80, 230 + i * 54);
      });
      return;
    }

    ctx.fillStyle = "#355443";
    ctx.font = "52px Georgia, serif";
    ctx.fillText("Your whiteboard", 94, 170);
    ctx.fillStyle = "#80927a";
    ctx.font = "32px sans-serif";
    ctx.fillText("Sketch the idea here", 96, 231);
    ctx.strokeStyle = "#c2cbb4";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(96, 427);
    ctx.bezierCurveTo(211, 411, 270, 445, 379, 425);
    ctx.bezierCurveTo(457, 411, 504, 423, 552, 419);
    ctx.stroke();
  }), [kind, content, status]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

function useBoardTexture(source?: string) {
  const fallback = usePreviewTexture("board", "");
  const [loaded, setLoaded] = useState<{ source: string; texture: Texture } | null>(null);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    if (!source) return;
    let disposed = false;
    let imageTexture: CanvasTexture | undefined;
    const img = new window.Image();
    img.onload = () => {
      if (disposed) return;
      imageTexture = makeTexture(1200, 760, (ctx) => {
        ctx.fillStyle = "#faf9f0";
        ctx.fillRect(0, 0, 1200, 760);
        const ratio = Math.min(1120 / img.width, 680 / img.height);
        const width = img.width * ratio;
        const height = img.height * ratio;
        ctx.drawImage(img, (1200 - width) / 2, (760 - height) / 2, width, height);
      });
      setLoaded({ source, texture: imageTexture });
      invalidate();
    };
    img.src = source.startsWith("<svg") ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}` : source;
    return () => { disposed = true; img.onload = null; imageTexture?.dispose(); };
  }, [source, invalidate]);
  return loaded && loaded.source === source ? loaded.texture : fallback;
}

function useWoodTexture() {
  const texture = useMemo(() => makeTexture(1024, 512, (ctx) => {
    ctx.fillStyle = "#997654";
    ctx.fillRect(0, 0, 1024, 512);
    // Deterministic, fine grain keeps the tabletop tactile without external assets.
    for (let i = 0; i < 380; i++) {
      const y = i * 1.4;
      ctx.strokeStyle = i % 4 === 0 ? "rgba(74,45,24,.075)" : "rgba(233,201,158,.055)";
      ctx.lineWidth = i % 7 === 0 ? 1.4 : 0.7;
      ctx.beginPath(); ctx.moveTo(0, y);
      ctx.bezierCurveTo(280, y + Math.sin(i * 0.21) * 9, 710, y + Math.cos(i * 0.18) * 8, 1024, y + 1);
      ctx.stroke();
    }
    for (const y of [128, 258, 387]) { ctx.fillStyle = "rgba(71,41,24,.11)"; ctx.fillRect(0, y, 1024, 1); }
  }), []);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

function Block({ size, position = [0, 0, 0], rotation = [0, 0, 0], color, radius = 0.035, decorative = false, ...props }: {
  size: Triple;
  position?: Triple;
  rotation?: Triple;
  color: string;
  radius?: number;
  decorative?: boolean;
  castShadow?: boolean;
}) {
  return <RoundedBox args={size} position={position} rotation={rotation} radius={radius} smoothness={3} bevelSegments={2} castShadow receiveShadow raycast={decorative ? NO_RAYCAST : undefined} {...props}>
    <meshStandardMaterial color={color} roughness={0.75} />
  </RoundedBox>;
}

function PreviewPlane({ texture, size, position, rotation = [0, 0, 0] }: { texture: Texture; size: [number, number]; position: Triple; rotation?: Triple }) {
  return <mesh position={position} rotation={rotation}>
    <planeGeometry args={size} />
    <meshBasicMaterial map={texture} toneMapped={false} />
  </mesh>;
}

function ObjectLabel({ tool, position, active, onOpen, onHover }: {
  tool: Tool;
  position: Triple;
  active: boolean;
  onOpen: (tool: Tool) => void;
  onHover: (tool: Tool | null) => void;
}) {
  const object = OBJECTS[tool];
  return <Html position={position} center zIndexRange={[10, 0]}>
    <button type="button" className={`${styles.objectLabel} ${active ? styles.objectLabelActive : ""}`} aria-label={`Open ${object.name}`} onClick={() => onOpen(tool)} onPointerEnter={() => onHover(tool)} onPointerLeave={() => onHover(null)} onFocus={() => onHover(tool)} onBlur={() => onHover(null)} data-desk-tool={tool}>
      <span className={styles.labelName}>{object.name}<span aria-hidden="true" className={styles.openIcon}>↗</span></span>
      <span className={styles.labelDetail}>{object.detail}</span>
    </button>
  </Html>;
}

function SceneObjects({ codePreview, notePreview, boardPreview, runStatus, active, onOpen, onHover }: DeskSceneProps & { active: Tool | null; onHover: (tool: Tool | null) => void }) {
  const wood = useWoodTexture();
  const code = usePreviewTexture("code", codePreview, runStatus);
  const paper = usePreviewTexture("notes", notePreview);
  const board = useBoardTexture(boardPreview);
  const hit = (tool: Tool) => ({
    onClick: (event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onOpen(tool); },
    onPointerOver: (event: ThreeEvent<PointerEvent>) => { event.stopPropagation(); onHover(tool); },
    onPointerOut: () => onHover(null),
  });

  return <group>
    <RoundedBox args={[12.2, 0.4, 7.2]} radius={0.17} smoothness={4} position={[0, -0.32, 0.15]} receiveShadow castShadow raycast={NO_RAYCAST}>
      <meshStandardMaterial map={wood} roughness={0.74} color="#eee1ce" />
    </RoundedBox>
    <Block size={[11.4, 0.08, 6.6]} position={[0, -0.55, 0.12]} color="#745135" radius={0.04} decorative />
    <Block size={[4.3, 0.025, 3.6]} position={[0.55, -0.093, 0.18]} color="#546554" radius={0.012} decorative />

    <group position={[-3.6, 1.42, -1.72]} rotation={[0, 0.19, 0]} {...hit("board")}>
      <Block size={[3.45, 2.44, 0.17]} color={active === "board" ? "#5d8064" : "#b6b198"} radius={0.065} />
      <Block size={[3.3, 2.28, 0.06]} position={[0, 0, 0.105]} color="#eeeade" radius={0.035} />
      <PreviewPlane texture={board} size={[3.17, 2.13]} position={[0, 0, 0.142]} />
      <Block size={[3.5, 0.10, 0.29]} position={[0, -1.2, 0.13]} color="#bab7a2" radius={0.025} />
      <Block size={[0.09, 1.50, 0.10]} position={[-1.35, -0.75, -0.36]} rotation={[-0.24, 0, 0]} color="#a7a58e" />
      <Block size={[0.09, 1.50, 0.10]} position={[1.35, -0.75, -0.36]} rotation={[-0.24, 0, 0]} color="#a7a58e" />
      <Block size={[0.62, 0.075, 0.075]} position={[0.78, -1.12, 0.19]} color="#315d47" radius={0.025} />
      <Block size={[0.19, 0.077, 0.077]} position={[1.11, -1.12, 0.19]} color="#213c31" radius={0.025} />
      <Block size={[0.54, 0.11, 0.16]} position={[-1.0, -1.1, 0.18]} color="#d6cfb9" radius={0.035} />
    </group>

    <group {...hit("code")}>
      <Block size={[1.23, 0.11, 0.85]} position={[0.35, -0.028, -1.35]} color="#263e34" radius={0.05} />
      <Block size={[0.32, 0.95, 0.18]} position={[0.35, 0.43, -1.63]} color="#304c3e" radius={0.065} />
      <group position={[0.35, 1.76, -1.64]} rotation={[-0.075, 0, 0]}>
        <Block size={[3.94, 2.57, 0.23]} color={active === "code" ? "#6e9276" : "#223b31"} radius={0.11} />
        <Block size={[3.81, 2.43, 0.08]} position={[0, 0.02, 0.135]} color="#162b24" radius={0.07} />
        <PreviewPlane texture={code} size={[3.58, 2.18]} position={[0, 0.055, 0.181]} />
        <mesh position={[1.6, -1.175, 0.182]}><circleGeometry args={[0.021, 12]} /><meshBasicMaterial color="#a4bb8b" /></mesh>
      </group>
      <group position={[0.25, 0.023, 0.70]}>
        <Block size={[3.0, 0.15, 1.08]} color={active === "code" ? "#aab69a" : "#cbcdb9"} radius={0.085} />
        {Array.from({ length: 4 }, (_, row) => Array.from({ length: 12 }, (_, col) => <Block key={`${row}-${col}`} size={[0.195, 0.045, 0.16]} position={[-1.28 + col * 0.231, 0.095, -0.355 + row * 0.219]} color={row === 3 && col > 3 && col < 8 ? "#d3d5c2" : col === 11 ? "#859b7a" : "#e4e3ce"} radius={0.018} castShadow={false} />))}
      </group>
      <mesh position={[2.14, 0.039, 0.62]} scale={[0.24, 0.115, 0.37]} castShadow><sphereGeometry args={[1, 28, 16]} /><meshStandardMaterial color="#d9dbc7" roughness={0.62} /></mesh>
    </group>

    <group position={[3.58, -0.012, 1.77]} rotation={[0, -0.15, 0]} {...hit("notes")}>
      <Block size={[3.34, 0.11, 2.22]} color={active === "notes" ? "#78906a" : "#667a54"} radius={0.065} />
      <Block size={[1.60, 0.12, 2.08]} position={[-0.805, 0.10, 0]} rotation={[0, 0, -0.017]} color="#e5dcc0" radius={0.035} />
      <Block size={[1.60, 0.12, 2.08]} position={[0.805, 0.10, 0]} rotation={[0, 0, 0.017]} color="#e5dcc0" radius={0.035} />
      <mesh position={[0, 0.18, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[3.15, 1.97]} /><meshBasicMaterial map={paper} toneMapped={false} /></mesh>
      <mesh position={[0, 0.185, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.035, 2.0]} /><meshStandardMaterial color="#cfc3a4" /></mesh>
      <Block size={[0.075, 0.01, 0.63]} position={[0.40, 0.059, 1.29]} color="#b99955" radius={0.004} />
      <Block size={[0.15, 0.14, 1.52]} position={[1.21, 0.26, 0.16]} rotation={[0, -0.16, 0]} color="#b3945a" radius={0.035} />
      <Block size={[0.15, 0.14, 0.28]} position={[1.09, 0.26, -0.64]} rotation={[0, -0.16, 0]} color="#263d30" radius={0.035} />
    </group>

    <DeskAccessories />
    <ObjectLabel tool="board" position={[-3.45, 0.23, 0.2]} active={active === "board"} onOpen={onOpen} onHover={onHover} />
    <ObjectLabel tool="code" position={[0.25, 0.22, 1.96]} active={active === "code"} onOpen={onOpen} onHover={onHover} />
    <ObjectLabel tool="notes" position={[3.59, 0.25, 3.14]} active={active === "notes"} onOpen={onOpen} onHover={onHover} />
  </group>;
}

function DeskAccessories() {
  return <group>
    <group position={[4.7, 0, -2.18]}>
      <mesh position={[0, 0.015, 0]} castShadow raycast={NO_RAYCAST}><cylinderGeometry args={[0.49, 0.54, 0.19, 40]} /><meshStandardMaterial color="#546c48" roughness={0.75} /></mesh>
      <mesh position={[0, 1.32, 0]} raycast={NO_RAYCAST}><cylinderGeometry args={[0.043, 0.055, 2.58, 16]} /><meshStandardMaterial color="#8a895c" roughness={0.5} metalness={0.25} /></mesh>
      <group position={[-0.27, 2.55, 0.08]} rotation={[0, 0, -0.30]}>
        <mesh castShadow raycast={NO_RAYCAST}><coneGeometry args={[0.67, 0.64, 40, 1, true]} /><meshStandardMaterial color="#4b6444" roughness={0.65} side={2} /></mesh>
        <mesh position={[0, -0.30, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={NO_RAYCAST}><circleGeometry args={[0.61, 40]} /><meshBasicMaterial color="#f1df9a" side={2} /></mesh>
      </group>
    </group>

    <group position={[-4.42, 0, 1.36]} rotation={[0, 0.1, 0]}>
      <Block size={[1.5, 0.22, 1.94]} position={[0, 0.02, 0]} color="#c2b88f" radius={0.025} decorative />
      <Block size={[1.47, 0.15, 1.89]} position={[0.025, 0.035, 0]} color="#e4ddc6" radius={0.015} decorative />
      <Block size={[1.52, 0.055, 1.95]} position={[0, 0.152, 0]} color="#53684e" radius={0.02} decorative />
      <Block size={[1.52, 0.24, 1.95]} position={[-0.07, 0.30, -0.03]} rotation={[0, -0.09, 0]} color="#9f674e" radius={0.025} decorative />
      <Block size={[1.43, 0.17, 1.85]} position={[-0.04, 0.30, -0.03]} rotation={[0, -0.09, 0]} color="#e8dfc5" radius={0.012} decorative />
      <Block size={[1.54, 0.055, 1.97]} position={[-0.07, 0.44, -0.03]} rotation={[0, -0.09, 0]} color="#aa765b" radius={0.02} decorative />
    </group>

    <group position={[-2.42, 0.17, 1.45]}>
      <mesh castShadow raycast={NO_RAYCAST}><cylinderGeometry args={[0.29, 0.24, 0.56, 40]} /><meshStandardMaterial color="#eee9cf" roughness={0.65} /></mesh>
      <mesh position={[0, 0.286, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={NO_RAYCAST}><circleGeometry args={[0.241, 40]} /><meshStandardMaterial color="#62482f" roughness={0.45} /></mesh>
      <mesh position={[-0.29, 0.03, 0]} rotation={[0, Math.PI / 2, 0]} raycast={NO_RAYCAST}><torusGeometry args={[0.17, 0.045, 12, 28]} /><meshStandardMaterial color="#eee9cf" roughness={0.65} /></mesh>
    </group>

    <group position={[3.08, -0.02, -0.32]} rotation={[0, -0.13, 0]}>
      <Block size={[0.85, 0.05, 0.80]} color="#dfcc87" radius={0.012} decorative />
      <Block size={[0.47, 0.004, 0.016]} position={[-0.025, 0.03, -0.17]} color="#a59054" radius={0.002} decorative />
      <Block size={[0.36, 0.004, 0.016]} position={[-0.08, 0.03, -0.02]} color="#a59054" radius={0.002} decorative />
      <Block size={[0.41, 0.004, 0.016]} position={[-0.055, 0.03, 0.13]} color="#a59054" radius={0.002} decorative />
    </group>
  </group>;
}

function CameraMotion({ transition, onComplete }: { transition: { tool: Tool; id: number } | null; onComplete: (tool: Tool) => void }) {
  const { camera, size, invalidate } = useThree();
  const motion = useRef<{ started: number; position: Vector3; lookAt: Vector3; endPosition: Vector3; endLookAt: Vector3; tool: Tool } | null>(null);
  const complete = useRef(onComplete);
  complete.current = onComplete;
  useEffect(() => {
    const zoom = size.width / Math.max(size.height, 1) < 1.45 ? 1.18 : 1;
    camera.position.copy(CAMERA_POSITION).multiplyScalar(zoom);
    camera.lookAt(CAMERA_LOOK_AT);
    invalidate();
  }, [camera, size.width, size.height, invalidate]);
  useEffect(() => {
    if (!transition) { motion.current = null; return; }
    const target = OBJECT_POSITION[transition.tool];
    motion.current = {
      started: performance.now(),
      position: camera.position.clone(),
      lookAt: CAMERA_LOOK_AT.clone(),
      endPosition: camera.position.clone().lerp(target.clone().add(new Vector3(3.1, 3.2, 5.0)), 0.25),
      endLookAt: CAMERA_LOOK_AT.clone().lerp(target, 0.17),
      tool: transition.tool,
    };
    invalidate();
  }, [transition, camera, invalidate]);
  useFrame(() => {
    const current = motion.current;
    if (!current) return;
    const progress = Math.min((performance.now() - current.started) / 240, 1);
    const eased = 1 - (1 - progress) ** 3;
    camera.position.lerpVectors(current.position, current.endPosition, eased);
    camera.lookAt(current.lookAt.clone().lerp(current.endLookAt, eased));
    if (progress < 1) invalidate();
    else {
      motion.current = null;
      complete.current(current.tool);
      // The workspace can retain this component while a tool is open.
      camera.position.copy(current.position);
      camera.lookAt(CAMERA_LOOK_AT);
      invalidate();
    }
  });
  return null;
}

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function DeskFallback({ onOpen, codePreview, notePreview, boardPreview, runStatus }: DeskSceneProps) {
  return <div className={styles.fallback}>
    <div className={styles.fallbackObjects}>
      {(["board", "code", "notes"] as const).map((tool) => <button type="button" key={tool} className={`${styles.fallbackObject} ${styles[`${tool}Fallback`]}`} onClick={() => onOpen(tool)} data-desk-tool={tool}>
        <span className={styles.fallbackPreview} aria-hidden="true">
          {tool === "board" ? boardPreview ? <img src={boardPreview} alt="" /> : <span className={styles.paperHeading}>Sketch the idea here</span> : tool === "code" ? <><span className={styles.fileName}>main.py</span><code>{codePreview.split("\n").slice(0, 6).join("\n")}</code><span className={styles.fallbackStatus}>{runStatus || "Python is ready"}</span></> : <><span className={styles.paperHeading}>{notePreview.split("\n").find((line) => line.trim())?.replace(/^#+\s*/, "") || "Your study journal"}</span><span className={styles.paperLines} /></>}
        </span>
        <span className={styles.fallbackName}>{OBJECTS[tool].name}<span aria-hidden="true">↗</span></span>
        <span className={styles.fallbackDetail}>{OBJECTS[tool].detail}</span>
      </button>)}
    </div>
  </div>;
}

export default function DeskScene(props: DeskSceneProps) {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<Tool | null>(null);
  const [transition, setTransition] = useState<{ tool: Tool; id: number } | null>(null);
  const [smallScreen, setSmallScreen] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const cleanContextListener = useRef<(() => void) | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setPrefersReducedMotion(media.matches);
    updateMotion();
    media.addEventListener("change", updateMotion);
    const observer = new ResizeObserver((entries) => setSmallScreen(entries[0].contentRect.width < 680));
    if (root.current) observer.observe(root.current);
    return () => { observer.disconnect(); media.removeEventListener("change", updateMotion); cleanContextListener.current?.(); };
  }, []);

  const open = (tool: Tool) => {
    if (props.reducedMotion ?? prefersReducedMotion) { props.onOpen(tool); return; }
    setTransition({ tool, id: performance.now() });
  };
  const fallback = <DeskFallback {...props} />;

  return <div ref={root} className={styles.scene} data-active-object={active || undefined} aria-label="Your study desk">
    {smallScreen || contextLost ? fallback : <SceneBoundary fallback={fallback}>
      <Canvas frameloop="demand" dpr={[1, 1.65]} shadows="percentage" camera={{ position: CAMERA_POSITION.toArray(), fov: 38, near: 0.1, far: 70 }} gl={{ antialias: true, alpha: true, powerPreference: "low-power" }} fallback={fallback} onCreated={({ gl, scene }) => {
        scene.background = new Color("#ebece2");
        const canvas = gl.domElement;
        const lost = (event: Event) => { event.preventDefault(); setContextLost(true); };
        canvas.addEventListener("webglcontextlost", lost, false);
        cleanContextListener.current = () => canvas.removeEventListener("webglcontextlost", lost, false);
      }}>
        <ambientLight intensity={1.35} color="#fff4db" />
        <hemisphereLight intensity={1.3} color="#f8f9ed" groundColor="#b1a586" />
        <directionalLight position={[-4, 10, 6]} intensity={3.0} color="#fff0d4" castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-9} shadow-camera-right={9} shadow-camera-top={8} shadow-camera-bottom={-8} shadow-bias={-0.001} shadow-normalBias={0.035} />
        <Suspense fallback={null}>
          <SceneObjects {...props} active={active} onHover={setActive} onOpen={open} />
          <ContactShadows position={[0, -0.61, 0]} scale={22} opacity={0.31} blur={2.8} far={8} frames={1} resolution={512} color="#504a34" />
        </Suspense>
        <CameraMotion transition={transition} onComplete={(tool) => { setTransition(null); props.onOpen(tool); }} />
      </Canvas>
    </SceneBoundary>}
    <p className={styles.deskHint}>Choose an object to start.</p>
  </div>;
}
