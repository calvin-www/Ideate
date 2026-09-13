import { z } from "zod";
import type { BoardElement } from "../workspace/model";

export const MAX_IMAGE_BYTES = 5_000_000;
// Base64 bytes count toward the existing 15 MB workspace import limit.
export const MAX_BOARD_IMAGE_DATA = 10_000_000;
const imageTypes = ["image/png", "image/jpeg", "image/webp"] as const;
const fileIdSchema = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (id) => !Object.hasOwn(Object.prototype, id),
    "Invalid image file ID.",
  );

const fileSchema = z
  .object({
    id: fileIdSchema,
    mimeType: z.enum(imageTypes),
    dataURL: z
      .string()
      .max(
        Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64,
        "This image exceeds 5 MB. Choose a smaller image.",
      ),
    created: z.number().finite(),
    lastRetrieved: z.number().finite().optional(),
    version: z.number().finite().optional(),
  })
  .superRefine((file, ctx) => {
    const prefix = `data:${file.mimeType};base64,`;
    const encoded = file.dataURL.slice(prefix.length);
    if (
      !file.dataURL.startsWith(prefix) ||
      encoded.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Image data must be an embedded PNG, JPEG, or WebP file.",
      });
    }
  });

export const boardFilesSchema = z
  .record(fileIdSchema, fileSchema)
  .superRefine((files, ctx) => {
    let total = 0;
    for (const [id, file] of Object.entries(files)) {
      total += file.dataURL.length;
      if (id !== file.id)
        ctx.addIssue({
          code: "custom",
          message: "Image file IDs do not match.",
        });
    }
    if (total > MAX_BOARD_IMAGE_DATA)
      ctx.addIssue({
        code: "custom",
        message:
          "This board has reached its 10 MB image storage limit. Export your work and clear the whiteboard before adding more images.",
      });
  });
export type BoardFiles = z.infer<typeof boardFilesSchema>;

export function validateImageUpload(file: Pick<File, "type" | "size">) {
  if (!(imageTypes as readonly string[]).includes(file.type))
    throw new Error("Use a PNG, JPEG, or WebP image.");
  if (file.size > MAX_IMAGE_BYTES)
    throw new Error("This image exceeds 5 MB. Choose a smaller image.");
}

/** Copy new binary data out of Excalidraw's mutable file map. Retain old files for undo. */
export function captureBoardFiles(
  elements: readonly BoardElement[],
  incoming: Record<string, unknown>,
  saved: BoardFiles,
): BoardFiles {
  let next = saved;
  for (const element of elements) {
    if (
      element.type !== "image" ||
      element.isDeleted ||
      typeof element.fileId !== "string"
    )
      continue;
    const value = incoming[element.fileId] as BoardFiles[string] | undefined;
    if (!value) continue;
    const previous = saved[element.fileId];
    if (
      previous?.dataURL === value.dataURL &&
      previous.mimeType === value.mimeType
    )
      continue;
    if (next === saved) next = { ...saved };
    next[element.fileId] = value;
  }
  // Zod clones the files as it validates, so later library mutations cannot alter a saved snapshot.
  if (next === saved) return saved;
  const result = boardFilesSchema.safeParse(next);
  if (!result.success) throw new Error(result.error.issues[0].message);
  return result.data;
}

export function checkImageReferences(
  elements: readonly BoardElement[],
  files: BoardFiles,
) {
  for (const element of elements) {
    if (element.type !== "image" || element.isDeleted) continue;
    if (
      typeof element.fileId !== "string" ||
      !Object.hasOwn(files, element.fileId)
    )
      throw new Error("An image is missing its saved file data.");
  }
}
