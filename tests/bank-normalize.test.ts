import { expect, it } from "vitest";
import { demoRecords, DEMO_OPERATIONS } from "../src/features/bank/demo";
import { demoSnapshot, normalize } from "../src/features/bank/normalize";
import type { NessieAccountRecords } from "../src/features/bank/types";

const empty = (): NessieAccountRecords => ({ purchases: [], deposits: [], withdrawals: [], bills: [], transfers: [] });

it("normalizes the demo ledger with signed amounts and both transfer legs", () => {
  const { customer, accounts, records, merchants } = demoRecords();
  const snapshot = normalize(customer, accounts, records, merchants);
  expect(snapshot.source).toBe("nessie");
  expect(snapshot.customer).toEqual({ id: "cus_demo", name: "Sam Ideate Demo" });
  expect(snapshot.accounts.map((a) => [a.name, a.type, a.balance])).toEqual([["Everyday", "Checking", 1800], ["Rainy day", "Savings", 4000], ["Card", "Credit Card", 0]]);
  const transfers = DEMO_OPERATIONS.filter((op) => op.kind === "transfer").length;
  expect(snapshot.transactions).toHaveLength(DEMO_OPERATIONS.length + transfers);
  const legs = snapshot.transactions.filter((t) => t.kind === "transfer");
  expect(legs.filter((t) => t.amount < 0).map((t) => [t.accountId, t.description])).toEqual([["acc_everyday", "Transfer to Rainy day"], ["acc_everyday", "Transfer to Rainy day"]]);
  expect(legs.filter((t) => t.amount > 0).map((t) => [t.accountId, t.description])).toEqual([["acc_rainy", "Transfer from Everyday"], ["acc_rainy", "Transfer from Everyday"]]);
  expect(snapshot.transactions.find((t) => t.description === "Maple Street Apartments")).toMatchObject({ kind: "bill", category: "Housing", amount: -1150 });
  expect(snapshot.transactions.find((t) => t.description === "Paycheck")).toMatchObject({ kind: "deposit", category: "Income", amount: 2100 });
  expect(snapshot.transactions.find((t) => t.description === "Corner Market")).toMatchObject({ kind: "purchase", category: "Groceries", amount: -62 });
  const dates = snapshot.transactions.map((t) => t.date);
  expect(dates).toEqual([...dates].sort());
});

it("dedupes two-sided transfers listed under both accounts", () => {
  const customer = { _id: "c", first_name: "A", last_name: "B" };
  const accounts = [{ _id: "x", type: "Checking", nickname: "Main", balance: 1, customer_id: "c" }, { _id: "y", type: "Savings", nickname: "Save", balance: 1, customer_id: "c" }];
  const transfer = { _id: "t", transaction_date: "2026-01-04", amount: 5, payer_id: "x", payee_id: "y" };
  const snapshot = normalize(customer, accounts, { x: { ...empty(), transfers: [transfer] }, y: { ...empty(), transfers: [transfer] } }, {});
  expect(snapshot.transactions.map((t) => [t.accountId, t.description, t.amount])).toEqual([["y", "Transfer from Main", 5], ["x", "Transfer to Save", -5]]);
});

it("falls back to a fixed category, handles array categories and unknown transfer partners", () => {
  const customer = { _id: "c", first_name: "A", last_name: "B" };
  const accounts = [{ _id: "x", type: "Checking", nickname: "", balance: 10.005, customer_id: "c" }];
  const records = { x: { ...empty(),
    purchases: [{ _id: "p1", merchant_id: "m1", purchase_date: "2026-01-02T00:00:00Z", amount: 3, payer_id: "x" }, { _id: "p2", merchant_id: "missing", purchase_date: "2026-01-01", amount: 4, description: "Cash app", payer_id: "x" }],
    withdrawals: [{ _id: "w", transaction_date: "2026-01-03", amount: 20, payer_id: "x" }],
    transfers: [{ _id: "t", transaction_date: "2026-01-04", amount: 5, payer_id: "x", payee_id: "elsewhere" }, { id: "t2", transaction_date: "2026-01-05", amount: 7, description: "Transfer from Mom" }, { id: "t3", transaction_date: "2026-01-06", amount: 8 }],
  } };
  const snapshot = normalize(customer, accounts, records, { m1: { _id: "m1", name: "Shop", category: ["food", "groceries"] } });
  expect(snapshot.accounts[0]).toEqual({ id: "x", name: "Checking", type: "Checking", balance: 10.01 });
  expect(snapshot.transactions.map((t) => [t.description, t.category, t.amount])).toEqual([
    ["Cash app", "Entertainment", -4], ["Shop", "Groceries", -3], ["Withdrawal", "Entertainment", -20], ["Transfer to another account", "Savings", -5], ["Transfer from Mom", "Savings", 7], ["Transfer", "Savings", -8],
  ]);
});

it("rejects unreadable amounts and dates", () => {
  const customer = { _id: "c", first_name: "A", last_name: "B" };
  const accounts = [{ _id: "x", type: "Checking", nickname: "", balance: 1, customer_id: "c" }];
  expect(() => normalize(customer, accounts, { x: { ...empty(), deposits: [{ _id: "d", transaction_date: "2026-01-01", amount: Number.NaN, payee_id: "x" }] } }, {})).toThrow(/amount/);
  expect(() => normalize(customer, accounts, { x: { ...empty(), deposits: [{ _id: "d", transaction_date: "soon", amount: 1, payee_id: "x" }] } }, {})).toThrow(/date/);
});

it("produces the offline snapshot with a reason", () => {
  const snapshot = demoSnapshot("no_key");
  expect(snapshot.source).toBe("snapshot");
  expect(snapshot.reason).toBe("no_key");
  expect(snapshot.transactions.length).toBeGreaterThan(30);
});
