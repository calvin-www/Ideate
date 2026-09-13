import { z } from "zod";

const coordinate = z.number().min(-100_000).max(100_000);
function bounds(points: { x: number; y: number }[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

// Shared by the model-facing tool and the browser adapter.
export const freehandAdditionSchema = z
  .strictObject({
    type: z.literal("freedraw"),
    points: z
      .array(z.strictObject({ x: coordinate, y: coordinate }))
      .min(2)
      .max(512)
      .describe(
        "Ordered absolute board coordinates, not screen pixels. Use 2-512 points, spanning at most 10000 units per axis.",
      ),
    strokeColor: z
      .string()
      .regex(/^#(?:[\da-fA-F]{3}|[\da-fA-F]{6})$/)
      .optional()
      .describe("Optional hex color, for example #355b46."),
    strokeWidth: z
      .number()
      .min(0.5)
      .max(10)
      .optional()
      .describe("Optional pen thickness in board units; defaults to 2."),
  })
  .superRefine(({ points }, ctx) => {
    if (points.length < 2 || points.length > 512) return;
    const { width, height } = bounds(points);
    if (width > 10_000 || height > 10_000 || (width === 0 && height === 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["points"],
        message:
          "A pen stroke must move and span at most 10000 units per axis.",
      });
    }
  });

export function freehandSkeleton(value: unknown, id: string) {
  const stroke = freehandAdditionSchema.parse(value);
  const origin = stroke.points[0];
  return {
    id,
    type: "freedraw" as const,
    x: origin.x,
    y: origin.y,
    ...bounds(stroke.points),
    points: stroke.points.map((point) => [
      point.x - origin.x,
      point.y - origin.y,
    ]),
    strokeColor: stroke.strokeColor ?? "#355b46",
    strokeWidth: stroke.strokeWidth ?? 2,
    backgroundColor: "transparent",
    fillStyle: "solid" as const,
    roughness: 0,
    pressures: [],
    simulatePressure: true,
  };
}
