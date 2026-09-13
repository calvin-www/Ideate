import { replaceRanges, type BoardElement, type Replacement } from "../workspace/model";

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

export function textFrame(before: string, replacements: Replacement[], progress: number): string {
  if (progress <= 0) return before;
  if (progress >= 1) return replaceRanges(before, replacements);
  const ordered = [...replacements].sort((a, b) => a.from - b.from);
  const total = ordered.reduce((sum, range) => sum + Math.max(1, lines(range.text).length), 0);
  let remaining = Math.floor(clamp(progress) * total);
  const shown: Replacement[] = [];
  for (const range of ordered) {
    const parts = lines(range.text);
    const count = Math.max(1, parts.length);
    if (remaining <= 0) break;
    shown.push({ ...range, text: parts.slice(0, remaining).join("") });
    remaining -= count;
  }
  return replaceRanges(before, shown);
}

export function boardFrame(before: BoardElement[], after: BoardElement[], progress: number): BoardElement[] {
  if (progress <= 0) return before;
  if (progress >= 1) return after;
  const previous = new Map(before.map((element) => [element.id, element]));
  const changes = after.filter((element) => JSON.stringify(previous.get(element.id)) !== JSON.stringify(element));
  const position = clamp(progress) * changes.length;
  const result = new Map(before.map((element) => [element.id, element]));
  changes.forEach((element, index) => {
    const amount = clamp(position - index);
    if (amount <= 0) return;
    if (amount === 1) { result.set(element.id, element); return; }
    if (element.type === "freedraw" || element.type === "arrow" || element.type === "line") {
      const points = element.points as number[][] | undefined;
      if (points && points.length >= 2) {
        const cursor = amount * (points.length - 1);
        const whole = Math.floor(cursor);
        const start = points[whole], end = points[Math.min(whole + 1, points.length - 1)];
        const shown = points.slice(0, whole + 1).map((point) => [...point]);
        if (cursor > whole) shown.push([start[0] + (end[0] - start[0]) * (cursor - whole), start[1] + (end[1] - start[1]) * (cursor - whole)]);
        result.set(element.id, { ...element, points: shown, voiceProgress: amount });
      }
    } else if (element.type !== "text") result.set(element.id, { ...element, voiceProgress: amount });
  });
  return [...result.values()];
}
