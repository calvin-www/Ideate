import { validateImageUpload } from "./images";

/** Read pixels as an image, never as an embedded Excalidraw scene. */
export async function readBoardImage(file: File) {
  validateImageUpload(file);
  const dataURL = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("This image could not be read."));
    reader.readAsDataURL(file);
  });
  const image = new Image();
  image.src = dataURL;
  try {
    await image.decode();
  } catch {
    throw new Error(
      "This image could not be opened. Choose a valid PNG, JPEG, or WebP file.",
    );
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  const id = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return {
    file: { id, dataURL, mimeType: file.type, created: Date.now() },
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}
