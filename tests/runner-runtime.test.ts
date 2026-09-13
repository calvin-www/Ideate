import { beforeAll, describe, expect, it } from 'vitest';
import { loadPyodide } from 'pyodide';
import { createPythonRuntime } from '../runner/python-runtime.mjs';

let runtime: Awaited<ReturnType<typeof createPythonRuntime>>;
beforeAll(async () => { runtime = await createPythonRuntime(loadPyodide); }, 60_000);

async function run(code: string) {
  const chunks: { channel: string; text: string }[] = [];
  const result = await runtime.execute({ id: 'test-run', code }, (channel: string, text: string) => chunks.push({ channel, text }));
  return { result, chunks, stdout: chunks.filter((chunk) => chunk.channel === 'stdout').map((chunk) => chunk.text).join(''), stderr: chunks.filter((chunk) => chunk.channel === 'stderr').map((chunk) => chunk.text).join('') };
}

describe('real Pyodide execution', () => {
  it('streams exact stdout, stderr and partial lines', async () => {
    const output = await run('import sys\nprint("hello 🦊")\nprint("partial", end="")\nsys.stderr.write("problem\\n")');
    expect(output.result.status).toBe('success');
    expect(output.stdout).toBe('hello 🦊\npartial');
    expect(output.stderr).toBe('problem\n');
  });

  it('runs every captured source in fresh globals', async () => {
    expect((await run('secret_value = 123')).result.status).toBe('success');
    const output = await run('print("secret_value" in globals())');
    expect(output.stdout).toBe('False\n');
  });

  it('keeps actual Python errors and their main.py source line', async () => {
    const { result } = await run('value = 5\nraise ValueError("actual failure")');
    expect(result).toMatchObject({ status: 'error', line: 2, error: expect.stringContaining('ValueError: actual failure') });
  });

  it('completes no-output programs and rejects interactive input', async () => {
    expect((await run('pass')).result.status).toBe('success');
    expect((await run('input("Name? ")')).result).toMatchObject({ status: 'error', error: expect.stringContaining('Interactive input is unavailable') });
  });

  it('does not expose worker globals through the Python js module', async () => {
    const { stdout } = await run('import js\nprint(hasattr(js, "globalThis"), hasattr(js, "fetch"), hasattr(js, "localStorage"), hasattr(js, "postMessage"))');
    expect(stdout).toBe('False False False False\n');
  });

  it('batches excessive short trace lines without dropping their text', async () => {
    const output = await run('for _ in range(10_000):\n print("x")');
    expect(output.result.status).toBe('success');
    expect(output.stdout).toBe('x\n'.repeat(10_000));
    expect(output.chunks.length).toBeLessThan(256);
  });

  it('caps actual output in bytes and reports overflow', async () => {
    const output = await run('print("🦊" * 20_000)');
    expect(new TextEncoder().encode(output.stdout).length).toBeLessThanOrEqual(65_536);
    expect(output.result).toMatchObject({ status: 'error', error: expect.stringContaining('64 KiB') });
  });

  it('notifies its controller of overflow even when Python catches the write error', async () => {
    let limitNotifications = 0;
    await runtime.execute({ id: 'test-run', code: 'try:\n print("x" * 70_000)\nexcept OSError:\n pass' }, () => {}, () => { limitNotifications++; });
    expect(limitNotifications).toBe(1);
  });

  it('restores stdout after a program replaces the sys stream', async () => {
    const isolatedRuntime = await createPythonRuntime(loadPyodide);
    expect((await isolatedRuntime.execute({ id: 'first', code: 'import sys\nsys.stdout = None' }, () => {})).status).toBe('success');
    let output = '';
    const result = await isolatedRuntime.execute({ id: 'second', code: 'print(42)' }, (_channel: string, text: string) => { output += text; });
    expect(result.status).toBe('success');
    expect(output).toBe('42\n');
  }, 30_000);
});
