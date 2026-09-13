import { emptySheet, serializeSheet, type CellFormat, type Sheet } from "../spreadsheet/sheet";
import { CATEGORIES, type BankSnapshot } from "./types";

export type RowRange = { fromRow: number; toRow: number };
export type BankSheetRanges = { accounts: RowRange; transactions: RowRange; totals: RowRange; categories: RowRange };

const MAX_ROWS = 200;

function isoDate(date: Date): string { return date.toISOString().slice(0, 10); }

/**
 * Lay out a bank snapshot as a sheet: account balances, a dated ledger with
 * separate Money in / Money out columns, column totals, and a by-category
 * block. The formula engine has no SUMIF, so category totals reference the
 * ledger cells explicitly.
 */
export function bankSnapshotToSheet(snapshot: BankSnapshot, importedAt: Date): { sheet: Sheet; ranges: BankSheetRanges } {
  const sheet = emptySheet();
  const set = (address: string, raw: string | number, format?: CellFormat) => {
    sheet.cells[address] = { raw: String(raw), ...(format ? { format } : {}) };
  };
  const names = new Map(snapshot.accounts.map((account) => [account.id, account.name]));
  let row = 1;
  set(`A${row}`, "Bank import");
  set(`B${row}`, snapshot.source === "nessie"
    ? `Capital One Nessie (live) · ${isoDate(importedAt)}`
    : `Offline demo data · ${isoDate(importedAt)} (Nessie unreachable)`);
  row += 2;
  set(`A${row++}`, "Accounts");
  set(`A${row}`, "Account"); set(`B${row}`, "Type"); set(`C${row}`, "Balance"); row++;
  const accounts: RowRange = { fromRow: row, toRow: row + snapshot.accounts.length - 1 };
  for (const account of snapshot.accounts) {
    set(`A${row}`, account.name); set(`B${row}`, account.type); set(`C${row}`, account.balance, "currency"); row++;
  }
  row++;
  set(`A${row++}`, "Transactions");
  set(`A${row}`, "Date"); set(`B${row}`, "Account"); set(`C${row}`, "Description"); set(`D${row}`, "Category"); set(`E${row}`, "Money in"); set(`F${row}`, "Money out"); row++;
  const transactions: RowRange = { fromRow: row, toRow: row + snapshot.transactions.length - 1 };
  const byCategory = new Map<string, string[]>();
  for (const transaction of snapshot.transactions) {
    set(`A${row}`, transaction.date); set(`B${row}`, names.get(transaction.accountId) ?? transaction.accountId);
    set(`C${row}`, transaction.description); set(`D${row}`, transaction.category);
    const column = transaction.amount >= 0 ? "E" : "F";
    set(`${column}${row}`, Math.abs(transaction.amount), "currency");
    byCategory.set(transaction.category, [...(byCategory.get(transaction.category) ?? []), `${column}${row}`]);
    row++;
  }
  row++;
  const totals: RowRange = { fromRow: row, toRow: row + 1 };
  const first = transactions.fromRow, last = Math.max(transactions.toRow, transactions.fromRow);
  set(`A${row}`, "Totals"); set(`E${row}`, `=SUM(E${first}:E${last})`, "currency"); set(`F${row}`, `=SUM(F${first}:F${last})`, "currency"); row++;
  set(`A${row}`, "Net"); set(`E${row}`, `=E${row - 1}-F${row - 1}`, "currency"); row += 2;
  set(`A${row++}`, "By category");
  set(`A${row}`, "Category"); set(`B${row}`, "Amount"); row++;
  const categories: RowRange = { fromRow: row, toRow: row + CATEGORIES.length - 1 };
  for (const category of CATEGORIES) {
    const refs = byCategory.get(category) ?? [];
    set(`A${row}`, category); set(`B${row}`, refs.length ? `=${refs.join("+")}` : 0, "currency"); row++;
  }
  if (row - 1 > MAX_ROWS) throw new Error(`The bank import needs ${row - 1} rows; the spreadsheet allows ${MAX_ROWS}.`);
  serializeSheet(sheet); // enforces cell and size limits
  return { sheet, ranges: { accounts, transactions, totals, categories } };
}
