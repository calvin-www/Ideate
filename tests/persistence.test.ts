import { it, expect } from "vitest";
import { SaveQueue } from "../src/features/workspace/persistence";
it("serializes writes so a slower old save cannot replace newer work", async () => {
  const written: number[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queue = new SaveQueue<number>(async (value) => {
    if (value === 1) await blocked;
    written.push(value);
  });
  const first = queue.save(1);
  const second = queue.save(2);
  await Promise.resolve();
  expect(written).toEqual([]);
  release();
  await Promise.all([first, second]);
  expect(written).toEqual([1, 2]);
});
it("allows a fresh save after a failed write", async () => {
  const values: number[] = [];
  const queue = new SaveQueue<number>(async (value) => {
    if (value === 1) throw new Error("storage full");
    values.push(value);
  });
  await expect(queue.save(1)).rejects.toThrow("storage full");
  await queue.save(2);
  expect(values).toEqual([2]);
});
