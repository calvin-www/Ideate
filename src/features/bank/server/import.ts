import { demoSnapshot, normalize } from "../normalize";
import type { BankSnapshot, NessieAccountRecords, NessieMerchant } from "../types";
import { NessieClient, type NessieClientOptions } from "./nessie";
import { ensureDemoCustomer } from "./seed";

export type BankImportDependencies = {
  key?: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  warn?: (message: string) => void;
};

async function liveSnapshot(options: NessieClientOptions): Promise<BankSnapshot> {
  const client = new NessieClient(options);
  const { customerId } = await ensureDemoCustomer(client);
  const customer = (await client.listCustomers()).find((item) => item._id === customerId);
  if (!customer) throw new Error("The demo customer disappeared after seeding");
  const accounts = await client.getAccounts(customerId);
  const records: Record<string, NessieAccountRecords> = {};
  for (const account of accounts) {
    const [purchases, deposits, withdrawals, bills, transfers] = await Promise.all([
      client.getPurchases(account._id), client.getDeposits(account._id), client.getWithdrawals(account._id), client.getBills(account._id), client.getTransfers(account._id),
    ]);
    records[account._id] = { purchases, deposits, withdrawals, bills, transfers };
  }
  const merchantIds = [...new Set(Object.values(records).flatMap((own) => own.purchases.map((purchase) => purchase.merchant_id)))];
  const merchants: Record<string, NessieMerchant> = {};
  for (let index = 0; index < merchantIds.length; index += 5) {
    const batch = merchantIds.slice(index, index + 5);
    const found = await Promise.all(batch.map((id) => client.getMerchant(id).catch(() => undefined)));
    found.forEach((merchant, position) => { if (merchant) merchants[batch[position]] = merchant; });
  }
  return normalize(customer, accounts, records, merchants);
}

/** Import the demo customer's bank data, falling back to bundled data on any failure. */
export async function importBankData(deps: BankImportDependencies = {}): Promise<BankSnapshot> {
  const key = deps.key ?? process.env.NESSIE_API_KEY;
  if (!key) return demoSnapshot("no_key");
  try {
    return await liveSnapshot({ key, fetch: deps.fetch, baseUrl: deps.baseUrl, timeoutMs: deps.timeoutMs });
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).slice(0, 200);
    (deps.warn ?? ((message) => console.warn(message)))(`Bank import fell back to offline demo data: ${reason}`);
    return demoSnapshot(reason);
  }
}

export async function handleBankImport(deps: BankImportDependencies = {}): Promise<Response> {
  const snapshot = await importBankData(deps);
  return Response.json(snapshot, { headers: { "cache-control": "no-store" } });
}
