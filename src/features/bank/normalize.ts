import { BILL_CATEGORIES, demoRecords, TRANSFER_IN_PREFIX, TRANSFER_OUT_PREFIX } from "./demo";
import { CATEGORIES, type AccountType, type BankSnapshot, type BankTransaction, type Category, type NessieAccount, type NessieAccountRecords, type NessieCustomer, type NessieMerchant } from "./types";

const FALLBACK_CATEGORY: Category = "Entertainment";

function category(value: string | string[] | undefined): Category {
  const candidates = Array.isArray(value) ? value : [value];
  for (const candidate of candidates) {
    const match = CATEGORIES.find((name) => name.toLowerCase() === String(candidate ?? "").trim().toLowerCase());
    if (match) return match;
  }
  return FALLBACK_CATEGORY;
}

function accountType(value: string): AccountType {
  if (value === "Savings" || value === "Credit Card") return value;
  return "Checking";
}

function money(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("Nessie returned a non-numeric amount");
  return Math.round(amount * 100) / 100;
}

function day(value: string | undefined): string {
  const match = /^\d{4}-\d{2}-\d{2}/.exec(String(value ?? ""));
  if (!match) throw new Error("Nessie returned an unreadable date");
  return match[0];
}

/** Convert Nessie records for one customer into the app's bank snapshot. */
export function normalize(
  customer: NessieCustomer,
  accounts: NessieAccount[],
  records: Record<string, NessieAccountRecords>,
  merchants: Record<string, NessieMerchant>,
): BankSnapshot {
  const names = new Map(accounts.map((account) => [account._id, account.nickname || account.type]));
  const transactions: BankTransaction[] = [];
  const seenTransfers = new Set<string>();
  for (const account of accounts) {
    const own = records[account._id] ?? { purchases: [], deposits: [], withdrawals: [], bills: [], transfers: [] };
    for (const purchase of own.purchases) {
      const merchant = merchants[purchase.merchant_id];
      transactions.push({ date: day(purchase.purchase_date), accountId: account._id, kind: "purchase", description: merchant?.name ?? purchase.description ?? "Purchase", category: category(merchant?.category), amount: -money(purchase.amount) });
    }
    for (const deposit of own.deposits)
      transactions.push({ date: day(deposit.transaction_date), accountId: account._id, kind: "deposit", description: deposit.description || "Deposit", category: "Income", amount: money(deposit.amount) });
    for (const withdrawal of own.withdrawals)
      transactions.push({ date: day(withdrawal.transaction_date), accountId: account._id, kind: "withdrawal", description: withdrawal.description || "Withdrawal", category: FALLBACK_CATEGORY, amount: -money(withdrawal.amount) });
    for (const bill of own.bills)
      transactions.push({ date: day(bill.payment_date ?? bill.upcoming_payment_date), accountId: account._id, kind: "bill", description: bill.payee, category: BILL_CATEGORIES[bill.payee] ?? "Utilities", amount: -money(bill.payment_amount) });
    for (const transfer of own.transfers) {
      const date = day(transfer.transaction_date);
      const amount = money(transfer.amount);
      if (transfer.payer_id && transfer.payee_id) {
        // Full-featured Nessie lists a transfer under both accounts; emit both legs exactly once.
        const id = transfer._id ?? transfer.id ?? `${date}:${amount}:${transfer.payer_id}:${transfer.payee_id}`;
        if (seenTransfers.has(id)) continue;
        seenTransfers.add(id);
        if (names.has(transfer.payer_id))
          transactions.push({ date, accountId: transfer.payer_id, kind: "transfer", description: `${TRANSFER_OUT_PREFIX}${names.get(transfer.payee_id) ?? "another account"}`, category: "Savings", amount: -amount });
        if (names.has(transfer.payee_id))
          transactions.push({ date, accountId: transfer.payee_id, kind: "transfer", description: `${TRANSFER_IN_PREFIX}${names.get(transfer.payer_id) ?? "another account"}`, category: "Savings", amount });
        continue;
      }
      // The current sandbox records each leg on its own account with no counterparty;
      // the seeder encodes direction in the description.
      const description = transfer.description || "Transfer";
      const incoming = description.startsWith(TRANSFER_IN_PREFIX);
      transactions.push({ date, accountId: account._id, kind: "transfer", description, category: "Savings", amount: incoming ? amount : -amount });
    }
  }
  transactions.sort((a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description) || a.amount - b.amount);
  return {
    source: "nessie",
    customer: { id: customer._id, name: `${customer.first_name} ${customer.last_name}`.trim() },
    accounts: accounts.map((account) => ({ id: account._id, name: account.nickname || account.type, type: accountType(account.type), balance: money(account.balance) })),
    transactions,
  };
}

/** The bundled demo data, used when Nessie is unavailable. */
export function demoSnapshot(reason: string): BankSnapshot {
  const { customer, accounts, records, merchants } = demoRecords();
  return { ...normalize(customer, accounts, records, merchants), source: "snapshot", reason };
}
