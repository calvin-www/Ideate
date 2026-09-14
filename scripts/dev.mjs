import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const production = process.argv.includes("--production");
const children = [];
let shuttingDown = false;

// The static runner needs no model keys, app secrets, or .env files.
const runnerEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|LOCALAPPDATA|RUNNER_PORT|RUNNER_APP_ORIGINS)$/i.test(
      key,
    ),
  ),
);

function start(script, args, env) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  children.push(child);
  child.on("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    shutdown(1);
  });
  child.on("exit", (code, signal) => {
    if (!shuttingDown) shutdown(code ?? (signal ? 1 : 0));
  });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    if (process.platform === "win32") {
      // Next starts a child server, so terminate the process tree we created.
      const terminator = spawn(
        "taskkill",
        ["/pid", String(child.pid), "/T", "/F"],
        { stdio: "ignore", windowsHide: true },
      );
      terminator.on("error", () => child.kill());
    } else child.kill("SIGTERM");
  }
  process.exitCode = code;
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
start(resolve(root, "runner/server.mjs"), [], runnerEnv);
start(
  resolve(root, "node_modules/next/dist/bin/next"),
  [production ? "start" : "dev", "--hostname", "127.0.0.1"],
  process.env,
);
