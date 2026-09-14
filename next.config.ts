import type { NextConfig } from "next";
// Imported from the `.cjs` module, not `build-runner.mjs`: Next loads this
// config through `require()`, which cannot pull in an ES module on Node < 22.12.
import { RUNNER_HEADERS } from "./scripts/runner-headers.cjs";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Everything except the runner, which must be frameable by the app.
        source: "/((?!runner/).*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      { source: "/runner/:path*", headers: RUNNER_HEADERS },
      {
        source: "/runner/pyodide/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
    ];
  },
};
export default config;
