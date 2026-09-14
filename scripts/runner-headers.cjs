/**
 * Response headers for every file under `/runner/`. The app's Next config and
 * the browser test serve the same list so the CSP that ships is the CSP tested.
 *
 * CommonJS on purpose: Next loads `next.config.ts` through `require()`, which
 * cannot pull in an ES module until Node 20.19/22.12. Keeping this file `.cjs`
 * lets the config load on every Node version Next supports.
 */
const RUNNER_HEADERS = [
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

module.exports = { RUNNER_HEADERS };
