import { describe, expect, it } from "vitest";
import { columnName, emptySheet, evaluateSheet, exportCsv, formatCell, parseSheet, patchSheet, serializeSheet } from "../src/features/spreadsheet/sheet";

const sheet = (cells: Record<string, string>) => patchSheet(emptySheet(), Object.entries(cells).map(([address, raw]) => ({ address, raw })));

describe("spreadsheet engine", () => {
  it("persists cells and formats and patches without mutating the original", () => {
    const original = sheet({ A1: "Income" });
    const next = patchSheet(original, [{ address: "B1", raw: "1200", format: "currency" }]);
    expect(parseSheet(serializeSheet(next))).toEqual({ cells: { A1: { raw: "Income" }, B1: { raw: "1200", format: "currency" } } });
    expect(original.cells.B1).toBeUndefined();
    expect(parseSheet("")).toEqual({ cells: {} });
    expect(patchSheet(next, [{ address: "A1", raw: "" }]).cells.A1).toBeUndefined();
  });
  it("rejects malformed and oversized persisted data and edits", () => {
    for (const cells of [{ AA1: { raw: "1" } }, { A201: { raw: "1" } }, { A0: { raw: "1" } }, { A1: { raw: 1 } }, { A1: { raw: "1", format: "evil" } }, { A1: { raw: "x".repeat(1001) } }]) {
      expect(() => parseSheet(JSON.stringify({ cells }))).toThrow();
    }
    expect(() => parseSheet("null")).toThrow();
    expect(() => patchSheet(emptySheet(), [{ address: "__proto__", raw: "x" }])).toThrow();
    const cells = Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [`${String.fromCharCode(65 + i % 26)}${Math.floor(i / 26) + 1}`, { raw: "1" }]));
    expect(() => parseSheet(JSON.stringify({ cells }))).toThrow();
  });
  it("recalculates arithmetic, dependencies, percent literals and finance functions", () => {
    const data = sheet({ A1: "100", A2: "200", A3: "=SUM(A1:A2)", B1: "=A3*(1-20%)", B2: "=ROUND(AVERAGE(A1:A2)/7,2)", B3: "=MIN(A1:A3)+MAX(A1:A3)+COUNT(A1:A3)", C1: "=-(2+3)*4+10/2" });
    expect(evaluateSheet(data)).toMatchObject({ A3: 300, B1: 240, B2: 21.43, B3: 403, C1: -15 });
    expect(evaluateSheet(patchSheet(data, [{ address: "A1", raw: "300" }])).B1).toBe(400);
  });
  it("shows errors for cycles, invalid references, arithmetic and untrusted syntax", () => {
    expect(evaluateSheet(sheet({ A1: "=B1", B1: "=A1", C1: "=1/0", D1: "=AA1", E1: "=process.exit()", F1: "=1e308*100", G1: "hello", H1: "=G1+1" }))).toMatchObject({ A1: "#CYCLE!", B1: "#CYCLE!", C1: "#DIV/0!", D1: "#REF!", E1: "#VALUE!", F1: "#NUM!", H1: "#VALUE!" });
  });
  it("aggregates ranges ignoring text and empty cells", () => {
    expect(evaluateSheet(sheet({ A1: "name", A2: "5", B1: "=SUM(A1:A3)", B2: "=COUNT(A1:A3)", B3: "=AVERAGE(C1:C3)", B4: "=C1+2" }))).toMatchObject({ B1: 5, B2: 1, B3: "#DIV/0!", B4: 2 });
  });
  it("exports calculated values with CSV quoting and text injection protection", () => {
    expect(exportCsv(sheet({ A1: "Total, net", B1: "=10+5", A2: "@SUM(1)", B2: 'a"b\nc', A3: "-evil" }))).toBe('"Total, net",15\r\n\'@SUM(1),"a""b\nc"\r\n\'-evil,');
    expect(exportCsv(emptySheet())).toBe("");
  });
  it("formats monetary and percent values while leaving text errors readable", () => {
    expect(formatCell(1234.5, "currency")).toBe("$1,234.50");
    expect(formatCell(0.125, "percent")).toBe("12.5%");
    expect(formatCell("#REF!", "currency")).toBe("#REF!");
    expect(columnName(25)).toBe("Z");
    expect(() => columnName(26)).toThrow();
  });
  it("bounds nested formulas and expensive ranges without throwing", () => {
    expect(evaluateSheet(sheet({ A1: `=${"(".repeat(70)}1${")".repeat(70)}` })).A1).toBe("#LIMIT!");
    const data = sheet(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`A${i + 1}`, "=SUM(B1:Z200)"])));
    const values = evaluateSheet(data);
    expect(values.A1).toBe(0);
    expect(Object.values(values)).toContain("#LIMIT!");
  });
  it("rejects aggregate serialized content above the workspace snapshot limit", () => {
    const cells = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`${String.fromCharCode(65 + i % 26)}${Math.floor(i / 26) + 1}`, { raw: "x".repeat(1000) }]));
    expect(() => parseSheet(JSON.stringify({ cells }))).toThrow();
    expect(() => serializeSheet({ cells })).toThrow();
    expect(() => patchSheet(emptySheet(), Object.entries(cells).map(([address, cell]) => ({ address, ...cell })))).toThrow();
  });
  it("rounds decimal financial ties away from zero", () => {
    expect(evaluateSheet(sheet({ A1: "=ROUND(1.005,2)", A2: "=ROUND(10.075,2)", A3: "=ROUND(-10.075,2)", A4: "=ROUND(125,-1)", A5: "=ROUND(-1.005,2)" }))).toEqual({ A1: 1.01, A2: 10.08, A3: -10.08, A4: 130, A5: -1.01 });
  });
  it("preserves ROUND argument positions and rejects text references", () => {
    expect(evaluateSheet(sheet({ A2: "unknown", B1: "=ROUND(A1,2)", B2: "=ROUND(A2,2)" }))).toMatchObject({ B1: 0, B2: "#VALUE!" });
  });
  it("ignores hash-prefixed labels in aggregates while propagating errors", () => {
    expect(evaluateSheet(sheet({ A1: "# Income", A2: "5", B1: "=SUM(A1:A2)", B2: "=COUNT(A1:A2)", B3: "=SUM(A1,A2)", C1: "=1/0", C2: "=SUM(C1:C1)" }))).toMatchObject({ B1: 5, B2: 1, B3: 5, C2: "#DIV/0!" });
  });
});
