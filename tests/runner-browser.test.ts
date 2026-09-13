import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { createRunnerServer } from '../runner/server.mjs';

let app: Server;
let runner: Server;
let browser: Browser;
let page: Page;
let appOrigin: string;
let runnerOrigin: string;
type Message = Record<string, unknown>;

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  return `http://127.0.0.1:${address.port}`;
}
beforeAll(async () => {
  app = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><body>Parent workspace</body></html>'); });
  appOrigin = await listen(app);
  runner = createRunnerServer({ appOrigins: [appOrigin] });
  runnerOrigin = await listen(runner);
  browser = await chromium.launch(existsSync(chromium.executablePath()) ? { headless: true } : { channel: 'chrome', headless: true });
  page = await browser.newPage();
  await page.goto(appOrigin);
  await page.evaluate((runnerOrigin) => {
    const frame = document.createElement('iframe');
    frame.sandbox.add('allow-scripts', 'allow-same-origin');
    frame.src = runnerOrigin;
    const events: Message[] = [];
    Object.assign(window, { runnerEvents: events, runnerFrame: frame });
    window.addEventListener('message', (event) => {
      if (event.source === frame.contentWindow && event.origin === runnerOrigin) events.push(event.data);
    });
    frame.onload = () => frame.contentWindow!.postMessage({ protocol: 'ideate-python', version: 1, type: 'init' }, runnerOrigin);
    localStorage.setItem('workspace-private-marker', 'parent-only');
    document.body.append(frame);
  }, runnerOrigin);
  await ready();
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await Promise.all([app, runner].filter(Boolean).map(server => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); })));
});

async function events(): Promise<Message[]> {
  return page.evaluate(() => (window as unknown as { runnerEvents: Message[] }).runnerEvents);
}
async function ready() {
  await page.waitForFunction(() => {
    const messages = (window as unknown as { runnerEvents: Message[] }).runnerEvents;
    return ['ready', 'error'].includes(String(messages.filter(event => event.type === 'status').at(-1)?.status));
  }, undefined, { timeout: 50_000 });
  const status = (await events()).filter(event => event.type === 'status').at(-1)!;
  if (status.status !== 'ready') throw new Error(String(status.error || 'Runner failed to load'));
}
async function send(message: Message) {
  await page.evaluate(({ message, runnerOrigin }) => {
    const frame = (window as unknown as { runnerFrame: HTMLIFrameElement }).runnerFrame;
    frame.contentWindow!.postMessage({ protocol: 'ideate-python', version: 1, ...message }, runnerOrigin);
  }, { message, runnerOrigin });
}
async function complete(id: string) {
  await expect.poll(async () => (await events()).some(event => event.type === 'complete' && event.id === id), { timeout: 20_000 }).toBe(true);
  return (await events()).find(event => event.type === 'complete' && event.id === id)!;
}

describe('separate-origin Python in a real browser', () => {
  it('loads under its actual CSP and runs with no application globals', async () => {
    await send({ type: 'run', id: 'browser-run', code: 'import js\nprint(42)\nprint(hasattr(js, "localStorage"), hasattr(js, "fetch"), hasattr(js, "postMessage"))' });
    expect(await complete('browser-run')).toMatchObject({ status: 'success' });
    const output = (await events()).filter(event => event.type === 'output' && event.id === 'browser-run').map(event => event.text).join('');
    expect(output).toBe('42\nFalse False False\n');
  }, 30_000);

  it('cannot read parent storage or connect to the application origin', async () => {
    const frame = page.frames().find(frame => frame.url().startsWith(runnerOrigin))!;
    const result = await frame.evaluate(async (appOrigin) => {
      let parentStorage = '';
      try { parentStorage = parent.localStorage.getItem('workspace-private-marker') || ''; }
      catch (error) { parentStorage = (error as Error).name; }
      let network = '';
      try { await fetch(appOrigin); network = 'allowed'; }
      catch (error) { network = (error as Error).name; }
      return { parentStorage, network };
    }, appOrigin);
    expect(result).toEqual({ parentStorage: 'SecurityError', network: 'TypeError' });
  });

  it('stops an infinite loop while the parent stays responsive, then runs again', async () => {
    await ready();
    await send({ type: 'run', id: 'loop', code: 'print("loop started")\nwhile True:\n pass' });
    await expect.poll(async () => (await events()).filter(event => event.type === 'status').at(-1)?.status).toBe('running');
    await expect.poll(async () => (await events()).filter(event => event.type === 'output' && event.id === 'loop').map(event => event.text).join(''), { timeout: 3_000 }).toBe('loop started\n');
    expect(await page.evaluate(() => 6 * 7)).toBe(42);
    await send({ type: 'stop', id: 'loop' });
    expect(await complete('loop')).toMatchObject({ status: 'cancelled' });
    await ready();
    await send({ type: 'run', id: 'after-stop', code: 'print("ready again")' });
    expect(await complete('after-stop')).toMatchObject({ status: 'success' });
  }, 45_000);

  it('isolates closed streams and modified builtins from the next successful run', async () => {
    await ready();
    await send({ type: 'run', id: 'mutate-runtime', code: 'import builtins, sys\nsys.stdout.close()\nbuiltins.print = lambda *args, **kwargs: None' });
    expect(await complete('mutate-runtime')).toMatchObject({ status: 'success' });
    await ready();
    await send({ type: 'run', id: 'fresh-runtime', code: 'print(42)' });
    expect(await complete('fresh-runtime')).toMatchObject({ status: 'success' });
    expect((await events()).filter(event => event.type === 'output' && event.id === 'fresh-runtime').map(event => event.text).join('')).toBe('42\n');
  }, 45_000);
});
