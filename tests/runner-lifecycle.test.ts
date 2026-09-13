import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunnerController } from '../runner/controller.mjs';

const envelope = { protocol: 'ideate-python', version: 1 };
type Message = Record<string, unknown>;
class WorkerDouble {
  onmessage: ((event: { data: Message }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: Message[] = [];
  terminated = false;
  postMessage(message: Message) { this.sent.push(message); }
  terminate() { this.terminated = true; }
  emit(message: Message) { this.onmessage?.({ data: { ...envelope, ...message } }); }
}
function setup() {
  const workers: WorkerDouble[] = [];
  const events: Message[] = [];
  const controller = new RunnerController({
    createWorker: () => { const worker = new WorkerDouble(); workers.push(worker); return worker; },
    send: (message: Message) => events.push(message),
  });
  controller.start();
  return { workers, events, controller };
}
afterEach(() => vi.useRealTimers());

describe('runner lifecycle', () => {
  it('queues a captured run during initialization and starts its limit only when ready', () => {
    vi.useFakeTimers();
    const { workers, events, controller } = setup();
    controller.handle({ ...envelope, type: 'run', id: 'run-1', code: 'print(1)' });
    vi.advanceTimersByTime(12_000);
    expect(events.some((event) => event.type === 'complete')).toBe(false);
    workers[0].emit({ type: 'status', status: 'ready' });
    expect(workers[0].sent.at(-1)).toMatchObject({ type: 'run', id: 'run-1', code: 'print(1)' });
    vi.advanceTimersByTime(10_000);
    expect(events.find((event) => event.type === 'complete')).toMatchObject({ id: 'run-1', status: 'timeout', durationMs: 10_000 });
    expect(workers[0].terminated).toBe(true);
    expect(workers.length).toBe(2);
    controller.dispose();
  });

  it('stops the active worker and ignores its late output after restarting', () => {
    const { workers, events, controller } = setup();
    workers[0].emit({ type: 'status', status: 'ready' });
    controller.handle({ ...envelope, type: 'run', id: 'run-1', code: 'while True: pass' });
    controller.handle({ ...envelope, type: 'stop', id: 'run-1' });
    workers[0].emit({ type: 'output', id: 'run-1', sequence: 0, channel: 'stdout', text: 'late' });
    expect(events.filter((event) => event.type === 'complete')).toMatchObject([{ id: 'run-1', status: 'cancelled' }]);
    expect(events.some((event) => event.type === 'output')).toBe(false);
    workers[1].emit({ type: 'status', status: 'ready' });
    controller.handle({ ...envelope, type: 'run', id: 'run-2', code: 'print(42)' });
    workers[1].emit({ type: 'complete', id: 'run-2', status: 'success', durationMs: 1 });
    expect(events.filter((event) => event.type === 'complete').at(-1)).toMatchObject({ id: 'run-2', status: 'success' });
    controller.dispose();
  });

  it('enforces a combined 64 KiB output limit and terminates the program', () => {
    const { workers, events, controller } = setup();
    workers[0].emit({ type: 'status', status: 'ready' });
    controller.handle({ ...envelope, type: 'run', id: 'run-1', code: 'print("lots")' });
    for (let sequence = 0; sequence < 9; sequence++) {
      workers[0].emit({ type: 'output', id: 'run-1', sequence, channel: sequence % 2 ? 'stderr' : 'stdout', text: 'x'.repeat(8192) });
    }
    expect(events.filter((event) => event.type === 'output').reduce((sum, event) => sum + String(event.text).length, 0)).toBe(65536);
    expect(events.filter((event) => event.type === 'complete').at(-1)).toMatchObject({ status: 'error', error: expect.stringContaining('64 KiB') });
    expect(workers[0].terminated).toBe(true);
    controller.dispose();
  });

  it('ignores wrong run IDs and replayed output sequences', () => {
    const { workers, events, controller } = setup();
    workers[0].emit({ type: 'status', status: 'ready' });
    controller.handle({ ...envelope, type: 'run', id: 'run-1', code: 'print(1)' });
    workers[0].emit({ type: 'output', id: 'wrong', sequence: 0, channel: 'stdout', text: 'wrong' });
    workers[0].emit({ type: 'output', id: 'run-1', sequence: 0, channel: 'stdout', text: 'first' });
    workers[0].emit({ type: 'output', id: 'run-1', sequence: 0, channel: 'stdout', text: 'replay' });
    expect(events.filter((event) => event.type === 'output').map((event) => event.text)).toEqual(['first']);
    controller.dispose();
  });

  it('discards a successful program’s worker so module mutations cannot affect the next run', () => {
    const { workers, events, controller } = setup();
    workers[0].emit({ type: 'status', status: 'ready' });
    controller.handle({ ...envelope, type: 'run', id: 'run-1', code: 'import sys; sys.stdout = None' });
    workers[0].emit({ type: 'complete', id: 'run-1', status: 'success', durationMs: 1 });
    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
    controller.handle({ ...envelope, type: 'run', id: 'run-2', code: 'print(42)' });
    workers[1].emit({ type: 'status', status: 'ready' });
    workers[1].emit({ type: 'output', id: 'run-2', sequence: 0, channel: 'stdout', text: '42\n' });
    expect(events.filter((event) => event.type === 'output').at(-1)).toMatchObject({ id: 'run-2', text: '42\n' });
    controller.dispose();
  });
});
