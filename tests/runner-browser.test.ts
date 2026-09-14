import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRunner, RUNNER_HEADERS } from "../scripts/build-runner.mjs";

let app: Server;
let browser: Browser;
let page: Page;
let appOrigin: string;
let runnerOrigin: string;
let runnerDirectory: string;
type Message = Record<string, unknown>;
const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".zip": "application/zip",
  ".json": "application/json; charset=utf-8",
};

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  return `http://127.0.0.1:${address.port}`;
}
/** Serves the parent page and the built `/runner/` files the way the app does. */
function createAppServer() {
  return createServer(async (request, response) => {
    const path = new URL(request.url!, "http://app.invalid").pathname;
    if (!path.startsWith("/runner/")) {
      response.setHeader("Content-Type", "text/html");
      response.end("<!doctype html><html><body>Parent workspace</body></html>");
      return;
    }
    for (const { key, value } of RUNNER_HEADERS) response.setHeader(key, value);
    const relative = path.slice(8);
    const file = join(runnerDirectory, relative);
    try {
      if (!(await stat(file)).isFile()) throw new Error("Not a file");
    } catch {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.setHeader(
      "Content-Type",
      mimeTypes[relative.slice(relative.lastIndexOf("."))] ||
        "application/octet-stream",
    );
    createReadStream(file).pipe(response);
  });
}
beforeAll(async () => {
  runnerDirectory = await buildRunner(
    await mkdtemp(join(tmpdir(), "ideate-runner-")),
  );
  app = createAppServer();
  appOrigin = await listen(app);
  runnerOrigin = appOrigin;
  browser = await chromium.launch(
    existsSync(chromium.executablePath())
      ? { headless: true }
      : { channel: "chrome", headless: true },
  );
  page = await browser.newPage();
  await page.goto(appOrigin);
  await page.evaluate((runnerOrigin) => {
    const frame = document.createElement("iframe");
    frame.sandbox.add("allow-scripts", "allow-same-origin");
    frame.src = `${runnerOrigin}/runner/index.html`;
    const events: Message[] = [];
    Object.assign(window, { runnerEvents: events, runnerFrame: frame });
    window.addEventListener("message", (event) => {
      if (event.source === frame.contentWindow && event.origin === runnerOrigin)
        events.push(event.data);
    });
    frame.onload = () =>
      frame.contentWindow!.postMessage(
        { protocol: "ideate-python", version: 1, type: "init" },
        runnerOrigin,
      );
    document.body.append(frame);
  }, runnerOrigin);
  await ready();
}, 60_000);
afterAll(async () => {
  await browser?.close();
  if (app)
    await new Promise<void>((resolve) => {
      app.close(() => resolve());
      app.closeAllConnections();
    });
  if (runnerDirectory)
    await rm(runnerDirectory, { recursive: true, force: true });
});

async function events(): Promise<Message[]> {
  return page.evaluate(
    () => (window as unknown as { runnerEvents: Message[] }).runnerEvents,
  );
}
async function ready() {
  await page.waitForFunction(
    () => {
      const messages = (window as unknown as { runnerEvents: Message[] })
        .runnerEvents;
      return ["ready", "error"].includes(
        String(
          messages.filter((event) => event.type === "status").at(-1)?.status,
        ),
      );
    },
    undefined,
    { timeout: 50_000 },
  );
  const status = (await events())
    .filter((event) => event.type === "status")
    .at(-1)!;
  if (status.status !== "ready")
    throw new Error(String(status.error || "Runner failed to load"));
}
async function send(message: Message) {
  await page.evaluate(
    ({ message, runnerOrigin }) => {
      const frame = (window as unknown as { runnerFrame: HTMLIFrameElement })
        .runnerFrame;
      frame.contentWindow!.postMessage(
        { protocol: "ideate-python", version: 1, ...message },
        runnerOrigin,
      );
    },
    { message, runnerOrigin },
  );
}
async function complete(id: string) {
  await expect
    .poll(
      async () =>
        (await events()).some(
          (event) => event.type === "complete" && event.id === id,
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
  return (await events()).find(
    (event) => event.type === "complete" && event.id === id,
  )!;
}

describe("app-served Python runner in a real browser", () => {
  it.each(["concurrent", "scheduled"])(
    "enforces the watchdog when %s work blocks an apparently paused debugger",
    async (scenario) => {
      await ready();
      const id = `debug-busy-${scenario}`;
      const code =
        scenario === "concurrent"
          ? 'import asyncio\nasync def first():\n    sum(range(10**10))\nasync def second():\n    x = 1\nawait asyncio.gather(first(), second())\nprint("done")'
          : "import asyncio\nloop = asyncio.get_event_loop()\nloop.call_later(0.2, sum, range(10**10))\nx = 1";
      await send({ type: "run", id, debug: true, code });
      const last = scenario === "concurrent" ? 5 : 4;
      for (let pauseId = 1; pauseId <= last; pauseId++) {
        await expect
          .poll(
            async () =>
              (await events()).some(
                (event) =>
                  event.id === id &&
                  event.type === "paused" &&
                  event.pauseId === pauseId,
              ),
            { timeout: 5000 },
          )
          .toBe(true);
        if (scenario === "concurrent" || pauseId < last)
          await send({ type: "resume", id, pauseId, command: "step" });
      }
      expect(await complete(id)).toMatchObject({ status: "timeout" });
    },
    30_000,
  );

  it("queues concurrent coroutine pauses without losing a suspended task", async () => {
    await ready();
    const id = "debug-concurrent";
    await page.evaluate(
      ({ id, runnerOrigin }) => {
        const frame = (window as unknown as { runnerFrame: HTMLIFrameElement })
          .runnerFrame;
        const advance = (event: MessageEvent) => {
          if (
            event.source !== frame.contentWindow ||
            event.origin !== runnerOrigin ||
            event.data.id !== id
          )
            return;
          if (event.data.type === "complete")
            window.removeEventListener("message", advance);
          if (event.data.type === "paused")
            frame.contentWindow!.postMessage(
              {
                protocol: "ideate-python",
                version: 1,
                type: "resume",
                id,
                pauseId: event.data.pauseId,
                command: "step",
              },
              runnerOrigin,
            );
        };
        window.addEventListener("message", advance);
      },
      { id, runnerOrigin },
    );
    await send({
      type: "run",
      id,
      debug: true,
      code: "import asyncio\nasync def task(n):\n    await asyncio.sleep(0)\n    return n * 2\nvalues = await asyncio.gather(task(1), task(2))\nprint(values)",
    });
    expect(await complete(id)).toMatchObject({ status: "success" });
    expect(
      (await events())
        .filter((event) => event.id === id && event.type === "output")
        .map((event) => event.text)
        .join(""),
    ).toBe("[2, 4]\n");
  }, 30_000);

  it("steps across top-level await and preserves actual Python errors", async () => {
    await ready();
    const id = "debug-await";
    await send({
      type: "run",
      id,
      debug: true,
      code: 'import asyncio\nawait asyncio.sleep(0)\nraise ValueError("after await")',
    });
    for (let pauseId = 1; pauseId <= 3; pauseId++) {
      await expect
        .poll(
          async () =>
            (await events()).find(
              (event) =>
                event.id === id &&
                event.type === "paused" &&
                event.pauseId === pauseId,
            ),
          { timeout: 5000 },
        )
        .toMatchObject({ line: pauseId });
      await send({ type: "resume", id, pauseId, command: "step" });
    }
    expect(await complete(id)).toMatchObject({
      status: "error",
      line: 3,
      error: expect.stringContaining("ValueError: after await"),
    });
  }, 30_000);

  it("inspects custom objects without calling their metaclass or repr and tolerates non-string globals", async () => {
    await ready();
    const id = "debug-inspection";
    await page.evaluate(
      ({ id, runnerOrigin }) => {
        const frame = (window as unknown as { runnerFrame: HTMLIFrameElement })
          .runnerFrame;
        const step = (event: MessageEvent) => {
          if (
            event.source !== frame.contentWindow ||
            event.origin !== runnerOrigin ||
            event.data.id !== id
          )
            return;
          if (event.data.type === "complete")
            window.removeEventListener("message", step);
          if (event.data.type === "paused")
            frame.contentWindow!.postMessage(
              {
                protocol: "ideate-python",
                version: 1,
                type: "resume",
                id,
                pauseId: event.data.pauseId,
                command: "step",
              },
              runnerOrigin,
            );
        };
        window.addEventListener("message", step);
      },
      { id, runnerOrigin },
    );
    await send({
      type: "run",
      id,
      debug: true,
      code: 'class Meta(type):\n    def __eq__(self, other):\n        raise ValueError("inspection called equality")\n    def __getattribute__(self, name):\n        raise ValueError("inspection called attribute")\nclass Thing(metaclass=Meta):\n    def __repr__(self):\n        raise ValueError("inspection called repr")\nx = Thing()\nglobals()[1] = 2\nprint("completed without inspection side effects")',
    });
    expect(await complete(id)).toMatchObject({ status: "success" });
    expect(
      (await events())
        .filter((event) => event.id === id && event.type === "output")
        .map((event) => event.text)
        .join(""),
    ).toBe("completed without inspection side effects\n");
  }, 30_000);

  it("pauses real Python before each source line, steps into functions, and continues once", async () => {
    await ready();
    const id = "debug-browser";
    await send({
      type: "run",
      id,
      debug: true,
      code: "x = 1\ndef double(value):\n    answer = value * 2\n    return answer\nx = double(x)\nprint(x)",
    });
    async function paused(pauseId: number, line: number) {
      await expect
        .poll(
          async () =>
            (await events()).find(
              (event) =>
                event.id === id &&
                event.type === "paused" &&
                event.pauseId === pauseId,
            ),
          { timeout: 5000 },
        )
        .toMatchObject({ line });
      return (await events()).find(
        (event) =>
          event.id === id &&
          event.type === "paused" &&
          event.pauseId === pauseId,
      )!;
    }
    expect((await paused(1, 1)).locals).toEqual([]);
    expect(
      (await events()).some(
        (event) => event.id === id && event.type === "complete",
      ),
    ).toBe(false);
    await send({ type: "resume", id, pauseId: 1, command: "step" });
    expect((await paused(2, 2)).locals).toContainEqual({
      name: "x",
      value: "1",
    });
    await send({ type: "resume", id, pauseId: 2, command: "step" });
    await paused(3, 5);
    await send({ type: "resume", id, pauseId: 3, command: "step" });
    expect(await paused(4, 3)).toMatchObject({
      functionName: "double",
      locals: [{ name: "value", value: "1" }],
    });
    await send({ type: "resume", id, pauseId: 4, command: "step" });
    expect((await paused(5, 4)).locals).toContainEqual({
      name: "answer",
      value: "2",
    });
    await send({ type: "resume", id, pauseId: 5, command: "continue" });
    expect(await complete(id)).toMatchObject({ status: "success" });
    expect(
      (await events())
        .filter((event) => event.id === id && event.type === "output")
        .map((event) => event.text)
        .join(""),
    ).toBe("2\n");
  }, 30_000);

  it("loads under its actual CSP and runs with no application globals", async () => {
    await send({
      type: "run",
      id: "browser-run",
      code: 'import js\nprint(42)\nprint(hasattr(js, "localStorage"), hasattr(js, "fetch"), hasattr(js, "postMessage"))',
    });
    expect(await complete("browser-run")).toMatchObject({ status: "success" });
    const output = (await events())
      .filter((event) => event.type === "output" && event.id === "browser-run")
      .map((event) => event.text)
      .join("");
    expect(output).toBe("42\nFalse False False\n");
  }, 30_000);

  it("ignores messages that do not come from its own origin's parent", async () => {
    const frame = page
      .frames()
      .find((frame) => frame.url().startsWith(`${runnerOrigin}/runner/`))!;
    // A message the frame posts to itself has the right origin but the wrong
    // source window, so the bridge must drop it rather than start a run.
    await frame.evaluate(() =>
      window.postMessage(
        {
          protocol: "ideate-python",
          version: 1,
          type: "run",
          id: "self-posted",
          code: 'print("should not run")',
        },
        window.location.origin,
      ),
    );
    await send({ type: "run", id: "after-self", code: 'print("ok")' });
    expect(await complete("after-self")).toMatchObject({ status: "success" });
    expect(
      (await events()).some((event) => event.id === "self-posted"),
    ).toBe(false);
  }, 30_000);

  it("stops an infinite loop while the parent stays responsive, then runs again", async () => {
    await ready();
    await send({
      type: "run",
      id: "loop",
      code: 'print("loop started")\nwhile True:\n pass',
    });
    await expect
      .poll(
        async () =>
          (await events()).filter((event) => event.type === "status").at(-1)
            ?.status,
      )
      .toBe("running");
    await expect
      .poll(
        async () =>
          (await events())
            .filter((event) => event.type === "output" && event.id === "loop")
            .map((event) => event.text)
            .join(""),
        { timeout: 3_000 },
      )
      .toBe("loop started\n");
    expect(await page.evaluate(() => 6 * 7)).toBe(42);
    await send({ type: "stop", id: "loop" });
    expect(await complete("loop")).toMatchObject({ status: "cancelled" });
    await ready();
    await send({ type: "run", id: "after-stop", code: 'print("ready again")' });
    expect(await complete("after-stop")).toMatchObject({ status: "success" });
  }, 45_000);

  it("isolates closed streams and modified builtins from the next successful run", async () => {
    await ready();
    await send({
      type: "run",
      id: "mutate-runtime",
      code: "import builtins, sys\nsys.stdout.close()\nbuiltins.print = lambda *args, **kwargs: None",
    });
    expect(await complete("mutate-runtime")).toMatchObject({
      status: "success",
    });
    await ready();
    await send({ type: "run", id: "fresh-runtime", code: "print(42)" });
    expect(await complete("fresh-runtime")).toMatchObject({
      status: "success",
    });
    expect(
      (await events())
        .filter(
          (event) => event.type === "output" && event.id === "fresh-runtime",
        )
        .map((event) => event.text)
        .join(""),
    ).toBe("42\n");
  }, 45_000);
});
