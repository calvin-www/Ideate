import type { NessieAccount, NessieBill, NessieCustomer, NessieDeposit, NessieMerchant, NessiePurchase, NessieTransfer, NessieWithdrawal } from "../types";

export const NESSIE_BASE_URL = "https://api.nessieisreal.com";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export class NessieError extends Error {
  constructor(message: string, readonly status: number, readonly path: string) {
    super(message);
    this.name = "NessieError";
  }
}

export type NessieClientOptions = {
  key: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
};

type Created<T> = { objectCreated: T };

/** Minimal Nessie client. Every request carries the API key as a query parameter. */
export class NessieClient {
  private readonly key: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: NessieClientOptions) {
    this.key = options.key;
    this.fetchImpl = options.fetch ?? fetch;
    this.baseUrl = options.baseUrl ?? NESSIE_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(this.key)}`;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Race the timeout explicitly so a fetch that ignores its signal still gives up.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("timed out")); }, this.timeoutMs);
    });
    try {
      const response = await Promise.race([
        this.fetchImpl(url, {
          method,
          headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        }),
        timeout,
      ]);
      const text = await Promise.race([response.text(), timeout]);
      if (text.length > MAX_RESPONSE_BYTES) throw new NessieError("Nessie response too large", response.status, path);
      if (!response.ok) throw new NessieError(`Nessie ${method} ${path} failed with ${response.status}`, response.status, path);
      return (text ? JSON.parse(text) : null) as T;
    } catch (error) {
      if (error instanceof NessieError) throw error;
      const reason = controller.signal.aborted ? "timed out" : error instanceof Error ? error.message : String(error);
      throw new NessieError(`Nessie ${method} ${path} ${reason}`, 0, path);
    } finally {
      clearTimeout(timer);
    }
  }

  private get<T>(path: string): Promise<T> { return this.call<T>("GET", path); }
  // Some empty collections come back as a 404 with a message string rather than [].
  private async list<T>(path: string): Promise<T[]> {
    try {
      const result = await this.get<unknown>(path);
      return Array.isArray(result) ? (result as T[]) : [];
    } catch (error) {
      if (error instanceof NessieError && error.status === 404) return [];
      throw error;
    }
  }
  private async remove(path: string): Promise<void> { await this.call<unknown>("DELETE", path); }
  private async create<T>(path: string, body: unknown): Promise<T> {
    const result = await this.call<Created<T>>("POST", path, body);
    if (!result || typeof result !== "object" || !("objectCreated" in result)) throw new NessieError(`Nessie POST ${path} returned no object`, 0, path);
    return result.objectCreated;
  }

  listCustomers(): Promise<NessieCustomer[]> { return this.list("/customers"); }
  createCustomer(body: { first_name: string; last_name: string; address: Record<string, string> }): Promise<NessieCustomer> { return this.create("/customers", body); }
  getAccounts(customerId: string): Promise<NessieAccount[]> { return this.list(`/customers/${customerId}/accounts`); }
  deleteAccount(accountId: string): Promise<void> { return this.remove(`/accounts/${accountId}`); }
  createAccount(customerId: string, body: { type: string; nickname: string; rewards: number; balance: number; account_number?: string }): Promise<NessieAccount> { return this.create(`/customers/${customerId}/accounts`, body); }
  getPurchases(accountId: string): Promise<NessiePurchase[]> { return this.list(`/accounts/${accountId}/purchases`); }
  getDeposits(accountId: string): Promise<NessieDeposit[]> { return this.list(`/accounts/${accountId}/deposits`); }
  getWithdrawals(accountId: string): Promise<NessieWithdrawal[]> { return this.list(`/accounts/${accountId}/withdrawals`); }
  getBills(accountId: string): Promise<NessieBill[]> { return this.list(`/accounts/${accountId}/bills`); }
  getTransfers(accountId: string): Promise<NessieTransfer[]> { return this.list(`/accounts/${accountId}/transfers`); }
  createPurchase(accountId: string, body: { merchant_id: string; medium: "balance"; purchase_date: string; amount: number; status: string; description: string }): Promise<NessiePurchase> { return this.create(`/accounts/${accountId}/purchases`, body); }
  createDeposit(accountId: string, body: { medium: "balance"; transaction_date: string; status: string; amount: number; description: string }): Promise<NessieDeposit> { return this.create(`/accounts/${accountId}/deposits`, body); }
  createBill(accountId: string, body: { status: string; payee: string; nickname: string; payment_date: string; recurring_date: number; payment_amount: number }): Promise<NessieBill> { return this.create(`/accounts/${accountId}/bills`, body); }
  createTransfer(accountId: string, body: { amount: number; transaction_date: string; status: string; description: string }): Promise<NessieTransfer> { return this.create(`/accounts/${accountId}/transfers`, body); }
  getMerchant(id: string): Promise<NessieMerchant> { return this.get(`/merchants/${id}`); }
  listMerchants(): Promise<NessieMerchant[]> { return this.list("/merchants"); }
  createMerchant(body: { name: string; category: string; address: Record<string, string>; geocode: { lat: number; lng: number } }): Promise<NessieMerchant> { return this.create("/merchants", body); }
}
