import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createRunnerServer } from "../runner/server.mjs";

let server: Server;
let base: string;
beforeAll(async () => {
  server = createRunnerServer({ appOrigins: ["http://localhost:3000"] });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing server port");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("credential-free runner server", () => {
  it("serves runtime assets locally with restrictive policies", async () => {
    const response = await fetch(`${base}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain(
      "connect-src 'self'",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors http://localhost:3000",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).toContain("/bridge.mjs");
    const runtime = await fetch(`${base}/pyodide/pyodide.asm.wasm`, {
      method: "HEAD",
    });
    expect(runtime.status).toBe(200);
    expect(runtime.headers.get("content-type")).toBe("application/wasm");
  });

  it("exposes only an explicit asset allowlist and no application endpoints", async () => {
    for (const path of [
      "/package.json",
      "/api/ai",
      "/%2e%2e/package.json",
      "/pyodide/package.json",
      "/server.mjs",
    ]) {
      const response = await fetch(`${base}${path}`);
      expect(response.status).toBe(404);
    }
    expect(
      (await fetch(`${base}/`, { method: "POST", body: "ignored" })).status,
    ).toBe(405);
  });
});
