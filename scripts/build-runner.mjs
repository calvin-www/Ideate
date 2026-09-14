import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export { RUNNER_HEADERS } from "./runner-headers.cjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runnerDirectory = join(root, "runner");
const runtimeDirectory = join(root, "node_modules", "pyodide");

/** Files copied from `runner/` into the served runner directory. */
export const RUNNER_MODULES = [
  "bridge.mjs",
  "controller.mjs",
  "protocol.mjs",
  "worker.mjs",
  "python-runtime.mjs",
  "debugger.mjs",
];
/** Files copied from the installed Pyodide package into `pyodide/`. */
export const RUNTIME_ASSETS = [
  "pyodide.mjs",
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
];
export const RUNNER_INDEX_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Ideate Python runner</title></head><body><script type="module" src="./bridge.mjs"></script></body></html>\n';


/** Assemble the static runner at `outDir`, replacing any previous build. */
export async function buildRunner(outDir = join(root, "public", "runner")) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, "pyodide"), { recursive: true });
  await writeFile(join(outDir, "index.html"), RUNNER_INDEX_HTML);
  await Promise.all([
    ...RUNNER_MODULES.map((name) =>
      copyFile(join(runnerDirectory, name), join(outDir, name)),
    ),
    ...RUNTIME_ASSETS.map((name) =>
      copyFile(join(runtimeDirectory, name), join(outDir, "pyodide", name)),
    ),
  ]);
  return outDir;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  // No top-level await: next.config.ts loads this module through require().
  buildRunner().then(
    (outDir) =>
      process.stdout.write(`Python runner assets written to ${outDir}\n`),
    (error) => {
      process.stderr.write(`${error?.stack || error}\n`);
      process.exitCode = 1;
    },
  );
}
