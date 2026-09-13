import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const runnerDirectory = dirname(fileURLToPath(import.meta.url));
const runtimeDirectory = resolve(runnerDirectory, '../node_modules/pyodide');
const runtimeAssets = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];
const runnerAssets = ['bridge.mjs', 'controller.mjs', 'protocol.mjs', 'worker.mjs', 'python-runtime.mjs'];
const mimeTypes = { '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.zip': 'application/zip', '.json': 'application/json; charset=utf-8' };

export function createRunnerServer({ appOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'] } = {}) {
  const origins = appOrigins.map((origin) => {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) throw new Error('Runner app origins must be exact HTTP(S) origins.');
    return url.origin;
  });
  const csp = ["default-src 'none'", "script-src 'self' 'wasm-unsafe-eval'", "connect-src 'self'", "worker-src 'self'", "base-uri 'none'", "form-action 'none'", `frame-ancestors ${origins.join(' ')}`].join('; ');
  const assets = new Map([
    ...runnerAssets.map((name) => [`/${name}`, join(runnerDirectory, name)]),
    ...runtimeAssets.map((name) => [`/pyodide/${name}`, join(runtimeDirectory, name)]),
  ]);
  return createServer(async (request, response) => {
    response.setHeader('Content-Security-Policy', csp);
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    response.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
    }
    let path;
    try { path = new URL(request.url, 'http://runner.invalid').pathname; }
    catch { response.writeHead(400); response.end(); return; }
    if (path === '/' || path === '/index.html') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(request.method === 'HEAD' ? undefined : '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Ideate Python runner</title></head><body><script type="module" src="/bridge.mjs"></script></body></html>');
      return;
    }
    if (path === '/config.mjs') {
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      response.end(request.method === 'HEAD' ? undefined : `export const APP_ORIGINS = ${JSON.stringify(origins)};`);
      return;
    }
    const file = assets.get(path);
    if (!file) { response.writeHead(404); response.end('Not found'); return; }
    try {
      const details = await stat(file);
      if (!details.isFile()) throw new Error('Not a file');
      const extension = path.slice(path.lastIndexOf('.'));
      response.setHeader('Content-Type', mimeTypes[extension] || 'application/octet-stream');
      response.setHeader('Content-Length', details.size);
      if (path.startsWith('/pyodide/')) response.setHeader('Cache-Control', 'public, max-age=86400');
      if (request.method === 'HEAD') response.end();
      else createReadStream(file).on('error', () => response.destroy()).pipe(response);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.RUNNER_PORT || 3001);
  const appOrigins = process.env.RUNNER_APP_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean);
  const server = createRunnerServer({ appOrigins });
  server.listen(port, '127.0.0.1', () => process.stdout.write(`Python runner ready at http://localhost:${port}\n`));
  const shutdown = () => { server.close(); server.closeAllConnections(); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
