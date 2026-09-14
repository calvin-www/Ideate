import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

/**
 * Response headers for every file under `/runner/`. The app's Next config and
 * the browser test serve the same list so the CSP that ships is the CSP tested.
 */
export const RUNNER_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'none'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "connect-src 'self'",
      "worker-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'self'",
    ].join("; "),
  },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

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
