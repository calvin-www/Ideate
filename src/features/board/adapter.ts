import type { BoardElement, BoardPatch } from "../workspace/model";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { freehandSkeleton } from "./freehand";

type Binding = { elementId: string; [key: string]: unknown };
type BoundElement = { id: string; type: "arrow" | "text" };
const shapeTypes = new Set(["rectangle", "ellipse", "diamond"]);
const allowedTypes = new Set([...shapeTypes, "text", "arrow"]);

function position(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > 100_000
  )
    throw new Error("Invalid diagram position.");
  return value;
}
function dimension(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 1 ||
    value > 10_000
  )
    throw new Error("Invalid diagram dimensions.");
  return value;
}
function arrowDisplacement(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 10_000)
    throw new Error("Invalid arrow displacement.");
  return value;
}
function textValue(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_000)
    throw new Error("Invalid diagram text.");
  return value;
}
function binding(
  element: BoardElement,
  edge: "startBinding" | "endBinding",
): Binding | null {
  const value = element[edge];
  return value &&
    typeof value === "object" &&
    "elementId" in value &&
    typeof value.elementId === "string"
    ? (value as Binding)
    : null;
}

function repairRelationships(elements: BoardElement[]) {
  const alive = new Map(
    elements
      .filter((element) => !element.isDeleted)
      .map((element) => [element.id, element]),
  );
  const reciprocal = new Map<string, BoundElement[]>();
  const add = (targetId: string, item: BoundElement) => {
    const bindings = reciprocal.get(targetId) ?? [];
    if (!bindings.some((binding) => binding.id === item.id))
      bindings.push(item);
    reciprocal.set(targetId, bindings);
  };
  for (const element of elements) {
    if (element.type === "arrow")
      for (const edge of ["startBinding", "endBinding"] as const) {
        const value = binding(element, edge);
        const target = value ? alive.get(value.elementId) : undefined;
        if (
          element.isDeleted ||
          !target ||
          ![
            "rectangle",
            "ellipse",
            "diamond",
            "text",
            "frame",
            "magicframe",
            "image",
          ].includes(target.type) ||
          (target.type === "text" && target.containerId)
        )
          element[edge] = null;
        else add(target.id, { id: element.id, type: "arrow" });
      }
    if (element.type === "text" && typeof element.containerId === "string") {
      const container = alive.get(element.containerId);
      if (
        element.isDeleted ||
        !container ||
        !["rectangle", "ellipse", "diamond", "arrow"].includes(container.type)
      )
        element.containerId = null;
      else add(container.id, { id: element.id, type: "text" });
    }
    if (
      typeof element.frameId === "string" &&
      !["frame", "magicframe"].includes(alive.get(element.frameId)?.type ?? "")
    )
      element.frameId = null;
  }
  for (const element of elements) {
    const bound = reciprocal.get(element.id) ?? [];
    element.boundElements =
      element.isDeleted || bound.length === 0
        ? Array.isArray(element.boundElements)
          ? []
          : null
        : bound;
  }
}

const snapshotFields = new Set(
  `id type x y width height angle strokeColor backgroundColor fillStyle strokeWidth strokeStyle roundness roughness opacity seed version versionNonce index isDeleted groupIds frameId boundElements updated link locked text originalText fontSize fontFamily textAlign verticalAlign containerId autoResize lineHeight points pressures simulatePressure startBinding endBinding startArrowhead endArrowhead elbowed fixedSegments startIsSpecial endIsSpecial name fileId status scale crop`.split(
    " ",
  ),
);

/** Normalize schema-validated imported boards and change snapshots without applying edits. */
export async function normalizeBoardImport(
  elements: BoardElement[],
): Promise<BoardElement[]> {
  const { restoreElements } = await import("@excalidraw/excalidraw");
  const clean = elements.map((element) => {
    const result = Object.fromEntries(
      Object.entries(structuredClone(element)).filter(([key]) =>
        snapshotFields.has(key),
      ),
    ) as BoardElement;
    for (const edge of ["startBinding", "endBinding"] as const) {
      const value = binding(result, edge);
      if (value)
        result[edge] = Object.fromEntries(
          Object.entries(value).filter(([key]) =>
            ["elementId", "focus", "gap", "fixedPoint"].includes(key),
          ),
        );
    }
    if (
      result.fixedSegments !== undefined &&
      !Array.isArray(result.fixedSegments)
    )
      result.fixedSegments = null;
    return result;
  });
  repairRelationships(clean);
  const originals = new Map(elements.map((element) => [element.id, element]));
  const restored = restoreElements(
    clean as unknown as ExcalidrawElement[],
    null,
    { refreshDimensions: true, repairBindings: true },
  );
  return restored.map((element) => {
    const original = originals.get(element.id);
    return {
      ...element,
      ...(typeof original?.version === "number" && original.version > 0
        ? { version: original.version }
        : {}),
      ...(typeof original?.versionNonce === "number"
        ? { versionNonce: original.versionNonce }
        : {}),
      ...(typeof original?.updated === "number"
        ? { updated: original.updated }
        : {}),
    } as unknown as BoardElement;
  });
}

export async function buildBoardPatch(
  elements: BoardElement[],
  patch: BoardPatch,
): Promise<BoardElement[]> {
  const { convertToExcalidrawElements, restoreElements, newElementWith } =
    await import("@excalidraw/excalidraw");
  type Skeleton = NonNullable<
    Parameters<typeof convertToExcalidrawElements>[0]
  >[number];
  const originals = new Map(elements.map((element) => [element.id, element]));
  const live = new Map(
    elements
      .filter((element) => !element.isDeleted)
      .map((element) => [element.id, element]),
  );
  const additions = patch.additions ?? [],
    updates = patch.updates ?? [],
    deleteIds = patch.deleteIds ?? [];
  if (additions.length + updates.length + deleteIds.length > 100)
    throw new Error("Limit a diagram change to 100 elements.");
  const deleted = new Set(deleteIds);
  const updatedIds = new Set<string>();
  for (const update of updates) {
    if (typeof update.id !== "string" || !live.has(update.id))
      throw new Error("An element being updated no longer exists.");
    if (deleted.has(update.id) || updatedIds.has(update.id))
      throw new Error(
        "A diagram element cannot be changed twice in one proposal.",
      );
    updatedIds.add(update.id);
  }
  for (const id of deleted)
    if (!live.has(id))
      throw new Error("An element being deleted no longer exists.");
  for (const element of elements)
    if (
      element.type === "text" &&
      typeof element.containerId === "string" &&
      deleted.has(element.containerId)
    )
      deleted.add(element.id);

  const result = structuredClone(elements);
  const resultMap = new Map(result.map((element) => [element.id, element]));
  for (const update of updates) {
    const element = resultMap.get(String(update.id))!;
    if (
      (update.x !== undefined || update.y !== undefined) &&
      element.type === "text" &&
      element.containerId
    )
      throw new Error("Move the text’s container to keep its label attached.");
    if (
      (update.x !== undefined || update.y !== undefined) &&
      element.type === "arrow" &&
      (element.startBinding || element.endBinding)
    )
      throw new Error(
        "Move a bound arrow directly on the board, or move its connected shapes.",
      );
    for (const key of Object.keys(update)) {
      if (
        !["id", "text", "strokeColor", "backgroundColor", "x", "y"].includes(
          key,
        )
      )
        throw new Error("Unsupported diagram update.");
      if (key === "id") continue;
      if (key === "x" || key === "y") element[key] = position(update[key]);
      else if (key === "text") {
        if (element.type !== "text")
          throw new Error(
            "Update the shape’s label element to change its text.",
          );
        element.text = element.originalText = textValue(update.text);
      } else {
        if (
          typeof update[key] !== "string" ||
          update[key].length > 32 ||
          !CSS.supports("color", update[key])
        )
          throw new Error("Invalid diagram color.");
        element[key] = update[key];
      }
    }
  }
  for (const element of result)
    if (deleted.has(element.id)) element.isDeleted = true;

  // Use the public constructor to reflow bound text and grow its container.
  // Keep the student's IDs, styles, and other existing connectors.
  function reflowLabel(label: BoardElement) {
    const container =
      typeof label.containerId === "string"
        ? resultMap.get(label.containerId)
        : undefined;
    if (!container || container.isDeleted || label.isDeleted) return;
    if (!shapeTypes.has(container.type) && container.type !== "arrow")
      throw new Error(
        "This text container must be edited directly on the board.",
      );
    const skeleton = {
      ...container,
      boundElements:
        (container.boundElements as BoundElement[] | null)?.filter(
          (item) => item.id !== label.id,
        ) ?? [],
      label: { ...label, text: label.originalText ?? label.text },
    } as unknown as Skeleton;
    const refreshed = convertToExcalidrawElements([skeleton], {
      regenerateIds: false,
    });
    const refreshedLabel = refreshed.find((element) => element.id === label.id);
    const refreshedContainer = refreshed.find(
      (element) => element.id === container.id,
    );
    if (!refreshedLabel || !refreshedContainer)
      throw new Error("The label could not be resized.");
    Object.assign(label, refreshedLabel);
    if (container.type !== "arrow")
      Object.assign(container, {
        width: refreshedContainer.width,
        height: refreshedContainer.height,
      });
  }
  for (const label of result) {
    if (label.type !== "text" || !label.containerId) continue;
    if (updatedIds.has(label.id) || updatedIds.has(String(label.containerId)))
      reflowLabel(label);
  }

  // Translate or resize only the endpoints attached to changed containers.
  // Excalidraw's public restore utility normalizes the resulting point geometry.
  const changedArrows = new Set<string>();
  for (const arrow of result) {
    if (
      arrow.type !== "arrow" ||
      arrow.isDeleted ||
      !Array.isArray(arrow.points)
    )
      continue;
    const points = (arrow.points as number[][]).map((point) => [...point]);
    let changed = false;
    for (const [edge, pointIndex] of [
      ["startBinding", 0],
      ["endBinding", points.length - 1],
    ] as const) {
      const targetId = binding(arrow, edge)?.elementId;
      const before = targetId ? originals.get(targetId) : undefined;
      const after = targetId ? resultMap.get(targetId) : undefined;
      if (!before || !after || after.isDeleted) continue;
      if (
        before.x === after.x &&
        before.y === after.y &&
        before.width === after.width &&
        before.height === after.height
      )
        continue;
      if (arrow.elbowed)
        throw new Error(
          "Move this shape and its elbow connector directly on the board.",
        );
      const point = points[pointIndex];
      if (!point || point.length !== 2)
        throw new Error("The arrow has invalid points.");
      const angle = Number(before.angle ?? 0),
        cos = Math.cos(angle),
        sin = Math.sin(angle);
      const x =
        Number(arrow.x) +
        point[0] -
        Number(before.x) -
        Number(before.width) / 2;
      const y =
        Number(arrow.y) +
        point[1] -
        Number(before.y) -
        Number(before.height) / 2;
      const localX =
        ((cos * x + sin * y) * Number(after.width)) / Number(before.width);
      const localY =
        ((-sin * x + cos * y) * Number(after.height)) / Number(before.height);
      point[0] =
        Number(after.x) +
        Number(after.width) / 2 +
        cos * localX -
        sin * localY -
        Number(arrow.x);
      point[1] =
        Number(after.y) +
        Number(after.height) / 2 +
        sin * localX +
        cos * localY -
        Number(arrow.y);
      changed = true;
    }
    if (changed) {
      arrow.points = points;
      changedArrows.add(arrow.id);
    }
  }
  for (const label of result)
    if (label.type === "text" && changedArrows.has(String(label.containerId)))
      reflowLabel(label);

  const bindingTargets = new Map<string, BoardElement>();
  function target(value: unknown) {
    if (value === undefined) return undefined;
    const element =
      typeof value === "string" ? resultMap.get(value) : undefined;
    if (
      !element ||
      element.isDeleted ||
      (!shapeTypes.has(element.type) &&
        (element.type !== "text" || element.containerId))
    )
      throw new Error(
        "The arrow binding target is missing or cannot receive a connector.",
      );
    bindingTargets.set(element.id, element);
    return { id: element.id, x: element.x, y: element.y };
  }
  const skeletons = additions.map((item, index) => {
    const id = `ai-${crypto.randomUUID()}-${index}`;
    if (item.type === "freedraw") {
      // Conversion passes freedraw through unchanged, so restore its metadata first.
      return restoreElements(
        [freehandSkeleton(item, id)] as unknown as ExcalidrawElement[],
        null,
      )[0];
    }
    if (!allowedTypes.has(String(item.type)))
      throw new Error("Unsupported diagram element.");
    const x = position(item.x),
      y = position(item.y),
      width = item.type === "arrow" ? arrowDisplacement(item.width) : dimension(item.width),
      height = item.type === "arrow" ? arrowDisplacement(item.height) : dimension(item.height);
    if (item.type === "arrow" && width === 0 && height === 0)
      throw new Error("An arrow must have distinct start and end points.");
    const text = item.text === undefined ? undefined : textValue(item.text);
    const base = {
      id,
      type: item.type,
      x,
      y,
      width: Math.abs(width),
      height: Math.abs(height),
      strokeColor: "#355b46",
      backgroundColor:
        item.type === "text" || item.type === "arrow"
          ? "transparent"
          : "#edf3e6",
      fillStyle: "solid",
      roughness: 1,
    };
    if (
      item.type !== "arrow" &&
      (item.startId !== undefined || item.endId !== undefined)
    )
      throw new Error("Only arrows can have binding targets.");
    if (item.type === "text")
      return { ...base, text: text ?? "", fontSize: 20 };
    const label = text ? { label: { text, fontSize: 18 } } : {};
    if (item.type === "arrow")
      return {
        ...base,
        ...label,
        points: [
          [0, 0],
          [width, height],
        ],
        endArrowhead: "arrow",
        start: target(item.startId),
        end: target(item.endId),
      };
    return { ...base, ...label };
  });
  // Conversion must see existing targets to calculate proper focus and gap.
  // Its temporary target copies are discarded so existing geometry is preserved.
  const converted = convertToExcalidrawElements(
    [...bindingTargets.values(), ...skeletons] as Skeleton[],
    { regenerateIds: false },
  );
  const added = converted.filter((element) => !bindingTargets.has(element.id));
  const combined: BoardElement[] = [...result, ...added];
  repairRelationships(combined);
  const restored = restoreElements(
    combined as unknown as ExcalidrawElement[],
    null,
    { refreshDimensions: true, repairBindings: true },
  );
  return restored.map((element) => {
    const original = originals.get(element.id);
    if (!original) return element as unknown as BoardElement;
    if (JSON.stringify(original) === JSON.stringify(element)) return original;
    return newElementWith(
      original as unknown as ExcalidrawElement,
      element,
      true,
    ) as unknown as BoardElement;
  });
}

export async function sampleBoard(): Promise<BoardElement[]> {
  return buildBoardPatch([], {
    additions: [
      {
        type: "text",
        x: 90,
        y: 60,
        width: 500,
        height: 30,
        text: "Why can we discard half the array?",
      },
      ...[2, 5, 8, 12, 16, 23, 38, 56].map((n, i) => ({
        type: "rectangle",
        x: 90 + i * 82,
        y: 150,
        width: 70,
        height: 66,
        text: String(n),
      })),
      { type: "text", x: 93, y: 240, width: 180, height: 30, text: "low = 0" },
      { type: "text", x: 336, y: 240, width: 180, height: 30, text: "mid = 3" },
      {
        type: "text",
        x: 644,
        y: 240,
        width: 180,
        height: 30,
        text: "high = 7",
      },
      {
        type: "text",
        x: 90,
        y: 335,
        width: 600,
        height: 30,
        text: "Sorted array · target = 16\nWhich half would you search next?",
      },
    ],
  });
}
