import { APP_ORIGINS } from "./config.mjs";
import { RunnerController } from "./controller.mjs";
import { isTrustedParentEvent } from "./protocol.mjs";

let parentOrigin;
const controller = new RunnerController({
  createWorker: () =>
    new Worker(new URL("./worker.mjs", import.meta.url), {
      type: "module",
      credentials: "omit",
    }),
  send: (message) => {
    if (parentOrigin) window.parent.postMessage(message, parentOrigin);
  },
});

window.addEventListener("message", (event) => {
  if (
    window.parent === window ||
    !isTrustedParentEvent(event, window.parent, APP_ORIGINS)
  )
    return;
  if (!parentOrigin && event.data.type !== "init") return;
  if (parentOrigin && parentOrigin !== event.origin) return;
  parentOrigin = event.origin;
  controller.handle(event.data);
});
window.addEventListener("pagehide", () => controller.dispose());
