import { expect, it } from "vitest";
import { demoSnapshot } from "../src/features/bank/normalize";
import { bankSnapshotToSheet } from "../src/features/bank/toSheet";
import { CATEGORIES, type BankSnapshot } from "../src/features/bank/types";
import { evaluateSheet, serializeSheet } from "../src/features/spreadsheet/sheet";

const when = new Date("2026-09-13T12:00:00Z");
const round = (n: number) => Math.round(n * 100) / 100;

it("lays out accounts, ledger, totals and categories that evaluate to the fixture sums", () => {
  const snapshot: BankSnapshot = { ...demoSnapshot("test"), source: "nessie" };
  const { sheet, ranges } = bankSnapshotToSheet(snapshot, when);
  const values = evaluateSheet(sheet);
  expect(sheet.cells.A1.raw).toBe("Bank import");
  expect(sheet.cells.B1.raw).toBe("Capital One Nessie (live) · 2026-09-13");
  expect(ranges.accounts).toEqual({ fromRow: 5, toRow: 7 });
  expect([sheet.cells.A5.raw, sheet.cells.B5.raw, sheet.cells.C5]).toEqual(["Everyday", "Checking", { raw: "1800", format: "currency" }]);
  expect(ranges.transactions).toEqual({ fromRow: 11, toRow: 10 + snapshot.transactions.length });
  const first = snapshot.transactions[0];
  expect([sheet.cells.A11.raw, sheet.cells.B11.raw, sheet.cells.C11.raw, sheet.cells.D11.raw]).toEqual([first.date, "Everyday", first.description, first.category]);
  for (let i = 0; i < snapshot.transactions.length; i++) {
    const t = snapshot.transactions[i], r = 11 + i;
    const inCell = sheet.cells[`E${r}`], outCell = sheet.cells[`F${r}`];
    expect(!!inCell).toBe(t.amount >= 0);
    expect(!!outCell).toBe(t.amount < 0);
    expect((inCell ?? outCell).format).toBe("currency");
  }
  const moneyIn = round(snapshot.transactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0));
  const moneyOut = round(-snapshot.transactions.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0));
  const totalsRow = ranges.totals.fromRow;
  expect(sheet.cells[`A${totalsRow}`].raw).toBe("Totals");
  expect(round(values[`E${totalsRow}`] as number)).toBe(moneyIn);
  expect(round(values[`F${totalsRow}`] as number)).toBe(moneyOut);
  expect(round(values[`E${totalsRow + 1}`] as number)).toBe(round(moneyIn - moneyOut));
  expect(ranges.categories.toRow - ranges.categories.fromRow + 1).toBe(CATEGORIES.length);
  CATEGORIES.forEach((category, i) => {
    const r = ranges.categories.fromRow + i;
    expect(sheet.cells[`A${r}`].raw).toBe(category);
    const expected = round(snapshot.transactions.filter((t) => t.category === category).reduce((s, t) => s + Math.abs(t.amount), 0));
    expect(round(values[`B${r}`] as number)).toBe(expected);
  });
  expect(Object.values(values).some((v) => typeof v === "string" && v.startsWith("#"))).toBe(false);
  expect(ranges.categories.toRow).toBeLessThanOrEqual(200);
  expect(() => serializeSheet(sheet)).not.toThrow();
});

it("labels offline data, handles an empty ledger and refuses oversized imports", () => {
  const base = demoSnapshot("down");
  const offline = bankSnapshotToSheet(base, when).sheet;
  expect(offline.cells.B1.raw).toBe("Offline demo data · 2026-09-13 (Nessie unreachable)");
  const none = bankSnapshotToSheet({ ...base, transactions: [] }, when);
  const values = evaluateSheet(none.sheet);
  expect(values[`E${none.ranges.totals.fromRow}`]).toBe(0);
  expect(values[`B${none.ranges.categories.fromRow}`]).toBe(0);
  const huge = { ...base, transactions: Array.from({ length: 190 }, () => base.transactions[0]) };
  expect(() => bankSnapshotToSheet(huge, when)).toThrow(/rows/);
});
