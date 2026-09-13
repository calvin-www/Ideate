export type CellFormat = "general" | "currency" | "percent";
export type CellUpdate = { address: string; raw: string; format?: CellFormat };
export type Sheet = { cells: Record<string, { raw: string; format?: CellFormat }> };
type Value = string | number;
const addressPattern = /^[A-Z]([1-9]\d{0,2})$/;
const numericPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/i;
const errorPattern = /^#(?:CYCLE!|DIV\/0!|REF!|VALUE!|NUM!|LIMIT!)$/;

function validAddress(address: string): boolean {
  return addressPattern.test(address) && Number(address.slice(1)) <= 200;
}

export function emptySheet(): Sheet { return { cells: {} }; }

function validate(value: unknown): Sheet {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid spreadsheet");
  const cells = (value as Sheet).cells;
  if (!cells || typeof cells !== "object" || Array.isArray(cells) || Object.keys(cells).length > 5000) throw new Error("Invalid spreadsheet cells");
  const result = emptySheet();
  for (const [address, cell] of Object.entries(cells)) {
    if (!validAddress(address) || !cell || typeof cell !== "object" || Array.isArray(cell) || typeof cell.raw !== "string" || cell.raw.length > 1000 || (cell.format !== undefined && !["general", "currency", "percent"].includes(cell.format))) throw new Error(`Invalid cell: ${address}`);
    if (cell.raw !== "" || cell.format) result.cells[address] = { raw: cell.raw, ...(cell.format ? { format: cell.format } : {}) };
  }
  if (JSON.stringify(result).length > 200_000) throw new Error("Spreadsheet is too large");
  return result;
}

export function parseSheet(text: string): Sheet {
  if (!text.trim()) return emptySheet();
  if (text.length > 200_000) throw new Error("Spreadsheet is too large");
  return validate(JSON.parse(text));
}

export function serializeSheet(sheet: Sheet): string { return JSON.stringify(validate(sheet)); }

export function patchSheet(sheet: Sheet, updates: CellUpdate[]): Sheet {
  if (updates.length > 5000) throw new Error("Too many cell updates");
  const next = validate(sheet);
  for (const update of updates) {
    const { address, raw, format } = update;
    const cell = { raw, ...(format !== undefined ? { format } : next.cells[address]?.format ? { format: next.cells[address].format } : {}) };
    validate({ cells: { [address]: cell } });
    if (raw === "" && !cell.format) delete next.cells[address];
    else next.cells[address] = cell;
  }
  return validate(next);
}

export function columnName(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index > 25) throw new Error("Column is outside A–Z");
  return String.fromCharCode(65 + index);
}

class FormulaError extends Error {}
function fail(message: string): never { throw new FormulaError(message); }
function finite(value: number): number { return Number.isFinite(value) ? value : fail("#NUM!"); }
// Shift the decimal representation so binary multiplication cannot move a tie
// (for example 10.075 * 100) just below the rounding boundary.
function shiftDecimal(value: number, places: number): number {
  const [coefficient, exponent = "0"] = String(value).split("e");
  return finite(Number(`${coefficient}e${Number(exponent) + places}`));
}
function number(value: Value): number {
  if (typeof value === "number") return value;
  if (value === "") return 0;
  if (errorPattern.test(value)) return fail(value);
  return fail("#VALUE!");
}

// A recursive-descent grammar, deliberately restricted to spreadsheet arithmetic.
class FormulaParser {
  private tokens: string[];
  private position = 0;
  private depth = 0;
  constructor(source: string, private read: (address: string) => Value, private tick: () => void) {
    this.tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z]+\d*|[^\s]/g) ?? [];
  }
  private peek(): string { return this.tokens[this.position] ?? ""; }
  private take(): string { this.tick(); return this.tokens[this.position++] ?? ""; }
  private expect(token: string): void { if (this.take() !== token) fail("#VALUE!"); }
  run(): number {
    const result = this.expression();
    if (this.position !== this.tokens.length) fail("#VALUE!");
    return finite(result);
  }
  private expression(): number {
    let result = this.product();
    while (this.peek() === "+" || this.peek() === "-") {
      const op = this.take(); const right = this.product();
      result = finite(op === "+" ? result + right : result - right);
    }
    return result;
  }
  private product(): number {
    let result = this.atom();
    while (this.peek() === "*" || this.peek() === "/") {
      const op = this.take(); const right = this.atom();
      if (op === "/" && right === 0) fail("#DIV/0!");
      result = finite(op === "*" ? result * right : result / right);
    }
    return result;
  }
  private atom(): number {
    if (++this.depth > 64) fail("#LIMIT!");
    const token = this.take().toUpperCase();
    let value: number;
    if (token === "+" || token === "-") value = this.atom() * (token === "-" ? -1 : 1);
    else if (token === "(") { value = this.expression(); this.expect(")"); }
    else if (/^[A-Z]+\d+$/.test(token)) value = number(this.read(token));
    else if (/^[A-Z]+$/.test(token)) value = this.call(token);
    else if (numericPattern.test(token)) value = finite(Number(token));
    else return fail("#VALUE!");
    while (this.peek() === "%") { this.take(); value /= 100; }
    this.depth--;
    return finite(value);
  }
  private call(name: string): number {
    if (!["SUM", "AVERAGE", "MIN", "MAX", "COUNT", "ROUND"].includes(name)) fail("#VALUE!");
    this.expect("(");
    const values: number[] = [];
    if (this.peek() !== ")") {
      do {
        const start = this.peek().toUpperCase();
        if (/^[A-Z]+\d+$/.test(start) && this.tokens[this.position + 1] === ":") {
          if (name === "ROUND") fail("#VALUE!");
          this.take(); this.take();
          const end = this.take().toUpperCase();
          if (!validAddress(start) || !validAddress(end)) fail("#REF!");
          const [c1, c2] = [start.charCodeAt(0), end.charCodeAt(0)].sort((a, b) => a - b);
          const [r1, r2] = [Number(start.slice(1)), Number(end.slice(1))].sort((a, b) => a - b);
          for (let row = r1; row <= r2; row++) for (let col = c1; col <= c2; col++) {
            this.tick(); const value = this.read(`${String.fromCharCode(col)}${row}`);
            if (typeof value === "number") values.push(value);
            else if (errorPattern.test(value)) number(value);
          }
        } else if (name !== "ROUND" && /^[A-Z]+\d+$/.test(start) && [",", ")"].includes(this.tokens[this.position + 1])) {
          this.take(); const value = this.read(start);
          if (typeof value === "number") values.push(value);
          else if (errorPattern.test(value)) number(value);
        } else values.push(this.expression());
        if (this.peek() !== ",") break;
        this.take();
      } while (true);
    }
    this.expect(")");
    if (name === "ROUND") {
      if (values.length < 1 || values.length > 2) fail("#VALUE!");
      const places = values[1] ?? 0;
      if (!Number.isInteger(places) || Math.abs(places) > 100) fail("#NUM!");
      return finite(Math.sign(values[0]) * shiftDecimal(Math.round(shiftDecimal(Math.abs(values[0]), places)), -places));
    }
    if (name === "COUNT") return values.length;
    if (name === "MIN") return values.length ? Math.min(...values) : 0;
    if (name === "MAX") return values.length ? Math.max(...values) : 0;
    const total = finite(values.reduce((sum, value) => sum + value, 0));
    if (name === "AVERAGE") return values.length ? finite(total / values.length) : fail("#DIV/0!");
    return total;
  }
}

export function evaluateSheet(sheet: Sheet): Record<string, Value> {
  const cells = validate(sheet).cells;
  const results: Record<string, Value> = {};
  const active = new Set<string>();
  let operations = 0;
  const tick = () => { if (++operations > 250_000) fail("#LIMIT!"); };
  const read = (address: string): Value => {
    if (!validAddress(address)) return "#REF!";
    if (Object.hasOwn(results, address)) return results[address];
    if (active.has(address)) return "#CYCLE!";
    if (active.size >= 128) return "#LIMIT!";
    const cell = cells[address];
    if (!cell) return "";
    active.add(address);
    let value: Value = cell.raw;
    try {
      const raw = cell.raw.trim();
      if (raw.startsWith("=")) value = new FormulaParser(raw.slice(1), read, tick).run();
      else if (numericPattern.test(raw)) value = finite(Number(raw.endsWith("%") ? raw.slice(0, -1) : raw) / (raw.endsWith("%") ? 100 : 1));
    } catch (error) { value = error instanceof FormulaError ? error.message : "#VALUE!"; }
    active.delete(address);
    results[address] = value;
    return value;
  };
  for (const address of Object.keys(cells)) read(address);
  return results;
}

export function formatCell(value: Value, format: CellFormat = "general"): string {
  if (typeof value === "string") return value;
  if (format === "currency") return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
  if (format === "percent") return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2 }).format(value);
  return String(Number(value.toPrecision(12)));
}

export function exportCsv(sheet: Sheet): string {
  const values = evaluateSheet(sheet);
  const addresses = Object.keys(values);
  if (!addresses.length) return "";
  const rows = Math.max(...addresses.map((address) => Number(address.slice(1))));
  const columns = Math.max(...addresses.map((address) => address.charCodeAt(0) - 65)) + 1;
  return Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, col) => {
    const value = values[`${columnName(col)}${row + 1}`] ?? "";
    let text = String(value);
    if (typeof value === "string" && /^[\s]*[=+\-@\t\r\n]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(",")).join("\r\n");
}
