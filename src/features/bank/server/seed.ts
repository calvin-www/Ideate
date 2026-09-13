import { DEMO_ACCOUNTS, DEMO_CUSTOMER, DEMO_LAST_NAME, DEMO_MERCHANTS, DEMO_OPERATIONS, transferLegs, type DemoAccountKey, type DemoOperation } from "../demo";
import type { NessieAccount } from "../types";
import type { NessieClient } from "./nessie";

const BATCH = 5;
const MERCHANT_ADDRESS = { street_number: "1", street_name: "Main St", city: "Houston", state: "TX", zip: "77002" };
const MERCHANT_GEOCODE = { lat: 29.7604, lng: -95.3698 };
const ACCOUNT_KEYS = Object.keys(DEMO_ACCOUNTS) as DemoAccountKey[];

async function inBatches<T>(items: T[], run: (item: T) => Promise<unknown>): Promise<void> {
  for (let index = 0; index < items.length; index += BATCH) await Promise.all(items.slice(index, index + BATCH).map(run));
}

/** Expected record counts per account nickname, used to recognize a complete seed. */
function expectedCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (key: DemoAccountKey) => counts.set(DEMO_ACCOUNTS[key].nickname, (counts.get(DEMO_ACCOUNTS[key].nickname) ?? 0) + 1);
  for (const op of DEMO_OPERATIONS) {
    if (op.kind === "transfer") { bump(op.from); bump(op.to); } else bump(op.account);
  }
  return counts;
}

async function isComplete(client: NessieClient, accounts: NessieAccount[]): Promise<boolean> {
  const byName = new Map(accounts.map((account) => [account.nickname, account]));
  if (ACCOUNT_KEYS.some((key) => !byName.has(DEMO_ACCOUNTS[key].nickname))) return false;
  for (const [nickname, expected] of expectedCounts()) {
    const account = byName.get(nickname)!;
    const [purchases, deposits, bills, transfers] = await Promise.all([
      client.getPurchases(account._id), client.getDeposits(account._id), client.getBills(account._id), client.getTransfers(account._id),
    ]);
    if (purchases.length + deposits.length + bills.length + transfers.length < expected) return false;
  }
  return true;
}

async function seedAccounts(client: NessieClient, customerId: string): Promise<void> {
  const accountIds = {} as Record<DemoAccountKey, string>;
  for (const key of ACCOUNT_KEYS) {
    const spec = DEMO_ACCOUNTS[key];
    const account = await client.createAccount(customerId, { type: spec.type, nickname: spec.nickname, rewards: 0, balance: spec.balance });
    accountIds[key] = account._id;
  }
  const merchantIds = new Map((await client.listMerchants()).filter((merchant) => merchant.name in DEMO_MERCHANTS).map((merchant) => [merchant.name, merchant._id]));
  await inBatches(Object.entries(DEMO_MERCHANTS).filter(([name]) => !merchantIds.has(name)), async ([name, category]) => {
    const merchant = await client.createMerchant({ name, category, address: MERCHANT_ADDRESS, geocode: MERCHANT_GEOCODE });
    merchantIds.set(name, merchant._id);
  });
  const post = async (op: DemoOperation) => {
    if (op.kind === "deposit") return client.createDeposit(accountIds[op.account], { medium: "balance", transaction_date: op.date, status: "completed", amount: op.amount, description: op.description });
    if (op.kind === "bill") return client.createBill(accountIds[op.account], { status: "pending", payee: op.payee, nickname: op.payee, payment_date: op.date, recurring_date: Number(op.date.slice(-2)), payment_amount: op.amount });
    if (op.kind === "purchase") return client.createPurchase(accountIds[op.account], { merchant_id: merchantIds.get(op.merchant)!, medium: "balance", purchase_date: op.date, amount: op.amount, status: "completed", description: op.merchant });
    const [outgoing, incoming] = transferLegs(op);
    await client.createTransfer(accountIds[op.from], { amount: op.amount, transaction_date: op.date, status: "completed", description: outgoing });
    await client.createTransfer(accountIds[op.to], { amount: op.amount, transaction_date: op.date, status: "completed", description: incoming });
  };
  await inBatches(DEMO_OPERATIONS, post);
}

/**
 * Find the app's demo customer under this API key, creating it with the demo
 * ledger on first use. Nessie cannot delete customers, so a partially seeded
 * customer is repaired by replacing its accounts.
 */
export async function ensureDemoCustomer(client: NessieClient): Promise<{ customerId: string; created: boolean }> {
  const existing = (await client.listCustomers()).find((customer) => customer.last_name === DEMO_LAST_NAME);
  const customerId = existing?._id ?? (await client.createCustomer(DEMO_CUSTOMER))._id;
  const accounts = existing ? await client.getAccounts(customerId) : [];
  if (existing && (await isComplete(client, accounts))) return { customerId, created: false };
  await inBatches(accounts, (account) => client.deleteAccount(account._id));
  await seedAccounts(client, customerId);
  return { customerId, created: true };
}
