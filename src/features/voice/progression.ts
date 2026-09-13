import { replaceRanges, type BoardElement, type Replacement } from "../workspace/model";

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
type Point = [number, number];

function pointBounds(points: Point[]) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

function tracedPoints(points: Point[], amount: number): Point[] {
  const drawProgress = amount < 0.5 ? Math.sqrt(amount / 2) : amount;
  const cursor = drawProgress * (points.length - 1);
  const whole = Math.floor(cursor);
  const start = points[whole];
  const end = points[Math.min(whole + 1, points.length - 1)];
  const shown = points.slice(0, whole + 1).map((point) => [...point] as Point);
  if (cursor > whole)
    shown.push([
      start[0] + (end[0] - start[0]) * (cursor - whole),
      start[1] + (end[1] - start[1]) * (cursor - whole),
    ]);
  return shown;
}

function partialLinear(element: BoardElement, amount: number): BoardElement {
  const points = tracedPoints(element.points as Point[], amount);
  const { voiceProgress: _voiceProgress, ...clean } = element;
  return { ...clean, ...pointBounds(points), points, ...(element.type === "arrow" ? { endBinding: null } : {}) };
}

function shapeOutline(element: BoardElement): Point[] {
  const width = Number(element.width);
  const height = Number(element.height);
  if (element.type === "rectangle")
    return [[0, 0], [width, 0], [width, height], [0, height], [0, 0]];
  if (element.type === "diamond")
    return [[width / 2, 0], [width, height / 2], [width / 2, height], [0, height / 2], [width / 2, 0]];
  return Array.from({ length: 33 }, (_, index) => {
    const angle = -Math.PI / 2 + (index / 32) * Math.PI * 2;
    return [
      width / 2 + Math.cos(angle) * width / 2,
      height / 2 + Math.sin(angle) * height / 2,
    ] as Point;
  });
}

function partialShape(element: BoardElement, amount: number): BoardElement {
  const outline = shapeOutline(element);
  const [originX, originY] = outline[0];
  const relative = outline.map(
    ([x, y]) => [x - originX, y - originY] as Point,
  );
  const points = tracedPoints(relative, amount);
  const { voiceProgress: _voiceProgress, ...clean } = element;
  return {
    ...clean,
    type: "freedraw",
    x: Number(element.x) + originX,
    y: Number(element.y) + originY,
    ...pointBounds(points),
    points,
    backgroundColor: "transparent",
    pressures: [],
    simulatePressure: true,
    lastCommittedPoint: null,
  };
}

export function checkpointBoard(elements: BoardElement[]): BoardElement[] {
  const checkpoint = structuredClone(elements);
  const alive = new Map(
    checkpoint
      .filter((element) => !element.isDeleted)
      .map((element) => [element.id, element]),
  );
  const bindingTargets = new Set([
    "rectangle",
    "ellipse",
    "diamond",
    "text",
    "frame",
    "magicframe",
    "image",
  ]);
  const containers = new Set(["rectangle", "ellipse", "diamond", "arrow"]);

  for (const element of checkpoint) {
    delete element.voiceProgress;
    if (typeof element.containerId === "string") {
      const container = alive.get(element.containerId);
      if (!container || !containers.has(container.type)) element.containerId = null;
    }
    if (element.type !== "arrow") continue;
    for (const edge of ["startBinding", "endBinding"] as const) {
      const binding = element[edge];
      const target =
        binding && typeof binding === "object" && "elementId" in binding
          ? alive.get(String(binding.elementId))
          : undefined;
      if (
        !target ||
        !bindingTargets.has(target.type) ||
        (target.type === "text" && target.containerId)
      )
        element[edge] = null;
    }
  }
  for (const element of checkpoint) {
    if (!Array.isArray(element.boundElements)) continue;
    element.boundElements = element.boundElements.filter((bound) => {
      if (
        !bound ||
        typeof bound !== "object" ||
        !("id" in bound) ||
        !("type" in bound)
      )
        return false;
      const child = alive.get(String(bound.id));
      if (!child) return false;
      if (bound.type === "text")
        return child.type === "text" && child.containerId === element.id;
      if (bound.type !== "arrow" || child.type !== "arrow") return false;
      return [child.startBinding, child.endBinding].some(
        (value) =>
          value &&
          typeof value === "object" &&
          "elementId" in value &&
          value.elementId === element.id,
      );
    });
  }
  return checkpoint;
}

export function boardRenderElements(elements: BoardElement[]): BoardElement[] {
  return elements.filter((element) => !element.isDeleted);
}

export function boardChangedElements(
  before: BoardElement[],
  after: BoardElement[],
): BoardElement[] {
  const previous = new Map(before.map((element) => [element.id, element]));
  const nextIds = new Set(after.map((element) => element.id));
  const changed: BoardElement[] = [];
  for (const element of after) {
    const old = previous.get(element.id);
    if (JSON.stringify(old) === JSON.stringify(element)) continue;
    if (!element.isDeleted) changed.push(element);
    else if (old && !old.isDeleted) changed.push(old);
  }
  for (const element of before) {
    if (!element.isDeleted && !nextIds.has(element.id)) changed.push(element);
  }
  return changed;
}

export function textFrame(before: string, replacements: Replacement[], progress: number): string {
  if (progress <= 0) return before;
  if (progress >= 1) return replaceRanges(before, replacements);
  const ordered = [...replacements].sort((a, b) => a.from - b.from);
  const total = ordered.reduce((sum, range) => sum + Math.max(1, lines(range.text).length), 0);
  let remaining = Math.floor(clamp(progress) * total);
  const shown: Replacement[] = [];
  for (const range of ordered) {
    const parts = lines(range.text);
    const count = Math.max(1, parts.length);
    if (remaining <= 0) break;
    shown.push({ ...range, text: parts.slice(0, remaining).join("") });
    remaining -= count;
  }
  return replaceRanges(before, shown);
}

export function boardFrame(before: BoardElement[], after: BoardElement[], progress: number): BoardElement[] {
  if (progress <= 0) return before;
  if (progress >= 1) return after;
  const previous = new Map(before.map((element) => [element.id, element]));
  const changes = after.filter((element) => JSON.stringify(previous.get(element.id)) !== JSON.stringify(element));
  const position = clamp(progress) * changes.length;
  const result = new Map(before.map((element) => [element.id, element]));
  changes.forEach((element, index) => {
    const amount = clamp(position - index);
    if (amount <= 0) return;
    if (amount === 1) { result.set(element.id, element); return; }
    if (element.isDeleted) return;
    if (previous.has(element.id)) return;
    if (element.type === "freedraw" || element.type === "arrow" || element.type === "line") {
      const points = element.points as number[][] | undefined;
      if (points && points.length >= 2) {
        result.set(element.id, partialLinear(element, amount));
      }
    } else if (["rectangle", "ellipse", "diamond"].includes(element.type)) {
      result.set(element.id, partialShape(element, amount));
    } else if (element.type !== "text") result.set(element.id, { ...element, voiceProgress: amount });
  });
  return [...result.values()];
}
