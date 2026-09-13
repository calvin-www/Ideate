import type { AccountType, Category, NessieAccount, NessieAccountRecords, NessieCustomer, NessieMerchant } from "./types";

// One month of ordinary spending for the app-managed demo customer. The seeder
// writes exactly this into Nessie and the offline fallback normalizes the same
// records, so both paths produce the same sheet.
export const DEMO_LAST_NAME = "Ideate Demo";
export const DEMO_CUSTOMER = {
  first_name: "Sam",
  last_name: DEMO_LAST_NAME,
  address: { street_number: "12", street_name: "Study Lane", city: "Houston", state: "TX", zip: "77005" },
};
export type DemoAccountKey = "everyday" | "rainy" | "card";
export const DEMO_ACCOUNTS: Record<DemoAccountKey, { type: AccountType; nickname: string; balance: number }> = {
  everyday: { type: "Checking", nickname: "Everyday", balance: 1800 },
  rainy: { type: "Savings", nickname: "Rainy day", balance: 4000 },
  card: { type: "Credit Card", nickname: "Card", balance: 0 },
};
export const DEMO_MERCHANTS: Record<string, Category> = {
  "Corner Market": "Groceries",
  "Fresh Fields Grocery": "Groceries",
  "Bean There Coffee": "Dining",
  "Taco Loco": "Dining",
  "Noodle House": "Dining",
  "Pizza Corner": "Dining",
  "Metro Transit": "Transport",
  "Sunset Fuel": "Transport",
  RideNow: "Transport",
  StreamFlix: "Entertainment",
  "Cinema 12": "Entertainment",
  "Page Turner Books": "Entertainment",
  "Arcade Alley": "Entertainment",
};
// Bills are categorized by payee; Nessie bills carry no merchant.
export const BILL_CATEGORIES: Record<string, Category> = {
  "Maple Street Apartments": "Housing",
  "City Power": "Utilities",
  "Fiber Co Internet": "Utilities",
  "Mobile One": "Utilities",
};
export type DemoOperation =
  | { kind: "deposit"; account: DemoAccountKey; date: string; amount: number; description: string }
  | { kind: "bill"; account: DemoAccountKey; date: string; amount: number; payee: string }
  | { kind: "purchase"; account: DemoAccountKey; date: string; amount: number; merchant: string }
  | { kind: "transfer"; from: DemoAccountKey; to: DemoAccountKey; date: string; amount: number; description: string };
const buy = (account: DemoAccountKey, day: string, amount: number, merchant: string): DemoOperation => ({ kind: "purchase", account, date: `2026-08-${day}`, amount, merchant });
// Nessie stores purchase, deposit and withdrawal amounts as whole dollars, so
// those stay integers here; bills keep cents.
export const DEMO_OPERATIONS: DemoOperation[] = [
  { kind: "deposit", account: "everyday", date: "2026-08-01", amount: 2100, description: "Paycheck" },
  { kind: "deposit", account: "everyday", date: "2026-08-15", amount: 2100, description: "Paycheck" },
  { kind: "bill", account: "everyday", date: "2026-08-02", amount: 1150, payee: "Maple Street Apartments" },
  { kind: "bill", account: "everyday", date: "2026-08-05", amount: 84.3, payee: "City Power" },
  { kind: "bill", account: "everyday", date: "2026-08-06", amount: 60, payee: "Fiber Co Internet" },
  { kind: "bill", account: "everyday", date: "2026-08-12", amount: 45.5, payee: "Mobile One" },
  { kind: "transfer", from: "everyday", to: "rainy", date: "2026-08-03", amount: 300, description: "Monthly savings" },
  { kind: "transfer", from: "everyday", to: "rainy", date: "2026-08-17", amount: 300, description: "Monthly savings" },
  buy("everyday", "02", 62, "Corner Market"), buy("everyday", "09", 72, "Corner Market"), buy("everyday", "16", 59, "Corner Market"),
  buy("everyday", "23", 66, "Corner Market"), buy("everyday", "27", 45, "Corner Market"), buy("everyday", "30", 74, "Corner Market"),
  buy("everyday", "06", 25, "Fresh Fields Grocery"), buy("everyday", "20", 31, "Fresh Fields Grocery"),
  buy("card", "02", 5, "Bean There Coffee"), buy("card", "04", 5, "Bean There Coffee"), buy("card", "07", 6, "Bean There Coffee"),
  buy("card", "11", 5, "Bean There Coffee"), buy("card", "14", 6, "Bean There Coffee"), buy("card", "18", 5, "Bean There Coffee"),
  buy("card", "21", 6, "Bean There Coffee"), buy("card", "25", 5, "Bean There Coffee"), buy("card", "28", 6, "Bean There Coffee"),
  buy("card", "08", 15, "Taco Loco"), buy("card", "22", 16, "Taco Loco"), buy("card", "13", 23, "Noodle House"), buy("card", "29", 29, "Pizza Corner"),
  buy("everyday", "01", 40, "Metro Transit"), buy("everyday", "10", 38, "Sunset Fuel"), buy("everyday", "24", 41, "Sunset Fuel"), buy("everyday", "31", 40, "Sunset Fuel"),
  buy("card", "19", 13, "RideNow"),
  buy("card", "03", 16, "StreamFlix"), buy("card", "15", 28, "Cinema 12"), buy("card", "27", 19, "Page Turner Books"), buy("card", "30", 20, "Arcade Alley"),
];

/**
 * Nessie transfers carry no payer/payee, so each leg is a separate record on
 * its own account and the direction is encoded in the description.
 */
export const TRANSFER_IN_PREFIX = "Transfer from ";
export const TRANSFER_OUT_PREFIX = "Transfer to ";
export function transferLegs(op: Extract<DemoOperation, { kind: "transfer" }>): [outgoing: string, incoming: string] {
  return [`${TRANSFER_OUT_PREFIX}${DEMO_ACCOUNTS[op.to].nickname}`, `${TRANSFER_IN_PREFIX}${DEMO_ACCOUNTS[op.from].nickname}`];
}

/** The demo ledger expressed as Nessie records, for the offline fallback and tests. */
export function demoRecords(): {
  customer: NessieCustomer;
  accounts: NessieAccount[];
  records: Record<string, NessieAccountRecords>;
  merchants: Record<string, NessieMerchant>;
} {
  const customer: NessieCustomer = { _id: "cus_demo", ...DEMO_CUSTOMER };
  const ids: Record<DemoAccountKey, string> = { everyday: "acc_everyday", rainy: "acc_rainy", card: "acc_card" };
  const accounts = (Object.keys(DEMO_ACCOUNTS) as DemoAccountKey[]).map((key) => ({ _id: ids[key], customer_id: customer._id, ...DEMO_ACCOUNTS[key] }));
  const merchants: Record<string, NessieMerchant> = {};
  for (const [name, category] of Object.entries(DEMO_MERCHANTS)) {
    const _id = `mer_${name.toLowerCase().replace(/\W+/g, "_")}`;
    merchants[_id] = { _id, name, category };
  }
  const merchantId = (name: string) => Object.values(merchants).find((m) => m.name === name)!._id;
  const records: Record<string, NessieAccountRecords> = Object.fromEntries(accounts.map((a) => [a._id, { purchases: [], deposits: [], withdrawals: [], bills: [], transfers: [] }]));
  DEMO_OPERATIONS.forEach((op, index) => {
    const _id = `tx_${index}`;
    if (op.kind === "deposit") records[ids[op.account]].deposits.push({ _id, transaction_date: op.date, amount: op.amount, description: op.description, payee_id: ids[op.account] });
    else if (op.kind === "bill") records[ids[op.account]].bills.push({ _id, payee: op.payee, payment_date: op.date, payment_amount: op.amount, account_id: ids[op.account] });
    else if (op.kind === "purchase") records[ids[op.account]].purchases.push({ _id, merchant_id: merchantId(op.merchant), purchase_date: op.date, amount: op.amount, payer_id: ids[op.account] });
    else {
      const [outgoing, incoming] = transferLegs(op);
      records[ids[op.from]].transfers.push({ _id: `${_id}_out`, transaction_date: op.date, amount: op.amount, description: outgoing });
      records[ids[op.to]].transfers.push({ _id: `${_id}_in`, transaction_date: op.date, amount: op.amount, description: incoming });
    }
  });
  return { customer, accounts, records, merchants };
}
