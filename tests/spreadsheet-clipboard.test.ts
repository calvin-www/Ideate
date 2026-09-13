import { describe, expect, it } from "vitest";
import { parseClipboard, serializeClipboard } from "../src/features/spreadsheet/clipboard";

describe("spreadsheet clipboard", () => {
  it("round trips embedded delimiters, quotes, formulas and empty cells", () => {
    const cells = [["two\tcolumns", "neighbor", ""], ["two\nlines", 'say "hello"', "=SUM(A1:A2)"]];
    expect(parseClipboard(serializeClipboard(cells))).toEqual(cells);
  });
  it("accepts ordinary TSV, CRLF and a trailing record separator", () => {
    expect(parseClipboard("name\tprice\r\npaper\t4\r\n")).toEqual([["name", "price"], ["paper", "4"]]);
    expect(parseClipboard("a\t\n\t")).toEqual([["a", ""], ["", ""]]);
  });
  it("preserves CRLF inside a quoted field", () => {
    expect(parseClipboard('"first\r\nsecond"')).toEqual([["first\r\nsecond"]]);
  });
  it("rejects malformed quoting and bounds allocation and cell size", () => {
    expect(() => parseClipboard('"unclosed')).toThrow();
    expect(() => parseClipboard('"closed"extra')).toThrow();
    expect(() => parseClipboard("x".repeat(6_000_001))).toThrow();
    expect(() => parseClipboard("x".repeat(1001))).toThrow();
    expect(() => parseClipboard(Array(201).fill("x").join("\n"))).toThrow();
    expect(() => parseClipboard(Array(27).fill("x").join("\t"))).toThrow();
    expect(() => parseClipboard(Array(200).fill(Array(26).fill("x").join("\t")).join("\n"))).toThrow();
  });
});
