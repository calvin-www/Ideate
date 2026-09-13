import { expect, it, vi } from "vitest";
import { DEMO_LAST_NAME, DEMO_OPERATIONS } from "../src/features/bank/demo";
import { handleBankImport, importBankData } from "../src/features/bank/server/import";
import { NessieClient, NessieError } from "../src/features/bank/server/nessie";
import { ensureDemoCustomer } from "../src/features/bank/server/seed";

type Row = Record<string, unknown> & { _id: string };
let id = 0; // shared across fakes so ids never collide between instances

/**
 * An in-memory Nessie mirroring the sandbox's quirks: empty lists come back as
 * a message string, purchase/deposit/withdrawal amounts are truncated to whole
 * dollars, transfers have no counterparty, and accounts (not customers) can be
 * deleted.
 */
function fakeNessie(options: { key?: string; failAfter?: number } = {}) {
  const key = options.key ?? "k";
  const store = { customers: [] as Row[], accounts: [] as Row[], merchants: [] as Row[], purchases: [] as Row[], deposits: [] as Row[], withdrawals: [] as Row[], bills: [] as Row[], transfers: [] as Row[] };
  const calls: { method: string; path: string }[] = [];
  let inFlight = 0, maxInFlight = 0;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const list = (rows: unknown[]) => rows.length ? json(rows) : json("Nothing found for this account", 404);
  const created = (collection: Row[], body: Record<string, unknown>, whole = false) => {
    const row = { _id: `id${++id}`, ...body, ...(whole ? { amount: Math.trunc(Number(body.amount)) } : {}) };
    collection.push(row);
    return json({ code: 201, message: "Created", objectCreated: row }, 201);
  };
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.searchParams.get("key") !== key) return json({ code: 401, message: "Invalid key" }, 401);
    const method = init?.method ?? "GET", path = url.pathname;
    calls.push({ method, path });
    if (options.failAfter !== undefined && calls.length > options.failAfter) return json({ message: "boom" }, 500);
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight--;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    let match: RegExpExecArray | null;
    if (path === "/customers") return method === "GET" ? list(store.customers) : created(store.customers, body);
    if ((match = /^\/customers\/([^/]+)\/accounts$/.exec(path))) return method === "GET" ? list(store.accounts.filter((a) => a.customer_id === match![1])) : created(store.accounts, { ...body, customer_id: match[1] });
    if ((match = /^\/accounts\/([^/]+)$/.exec(path)) && method === "DELETE") { store.accounts = store.accounts.filter((a) => a._id !== match![1]); return json({ code: 200 }); }
    if (path === "/merchants") return method === "GET" ? list(store.merchants) : created(store.merchants, body);
    if ((match = /^\/merchants\/([^/]+)$/.exec(path))) { const merchant = store.merchants.find((m) => m._id === match![1]); return merchant ? json(merchant) : json({ message: "missing" }, 404); }
    if ((match = /^\/accounts\/([^/]+)\/(purchases|deposits|withdrawals|bills|transfers)$/.exec(path))) {
      const account = match[1], kind = match[2] as keyof typeof store;
      if (method === "POST") {
        if (kind === "purchases") return created(store.purchases, { ...body, payer_id: account }, true);
        if (kind === "deposits") return created(store.deposits, { ...body, payee_id: account }, true);
        if (kind === "bills") return created(store.bills, { ...body, account_id: account });
        if ("payee_id" in body || "medium" in body) return json("validation errors for TransferCreate: extra fields not permitted", 400);
        return created(store.transfers, { ...body, owner: account });
      }
      const rows = store[kind].filter((row) => (row.payer_id ?? row.payee_id ?? row.account_id ?? row.owner) === account)
        .map((row) => kind === "transfers" ? { id: row._id, transaction_date: row.transaction_date, status: row.status, amount: row.amount, description: row.description } : row);
      return list(rows);
    }
    return json({ message: "not found" }, 404);
  });
  return { fetch: fetch as unknown as typeof fetch, store, calls, maxInFlight: () => maxInFlight };
}

it("seeds the demo customer once and reuses it", async () => {
  const nessie = fakeNessie();
  const client = new NessieClient({ key: "k", fetch: nessie.fetch, baseUrl: "https://nessie.test" });
  const first = await ensureDemoCustomer(client);
  expect(first.created).toBe(true);
  expect(nessie.store.customers).toHaveLength(1);
  expect(nessie.store.customers[0].last_name).toBe(DEMO_LAST_NAME);
  expect(nessie.store.accounts).toHaveLength(3);
  const transfers = DEMO_OPERATIONS.filter((op) => op.kind === "transfer").length;
  expect(nessie.store.purchases.length + nessie.store.deposits.length + nessie.store.bills.length + nessie.store.transfers.length).toBe(DEMO_OPERATIONS.length + transfers);
  expect(nessie.maxInFlight()).toBeLessThanOrEqual(5);
  const posts = nessie.calls.filter((c) => c.method === "POST").length;
  const second = await ensureDemoCustomer(client);
  expect(second).toEqual({ customerId: first.customerId, created: false });
  expect(nessie.calls.filter((c) => c.method === "POST")).toHaveLength(posts);
});

it("repairs a partially seeded customer by replacing its accounts", async () => {
  const nessie = fakeNessie({ failAfter: 12 });
  const client = new NessieClient({ key: "k", fetch: nessie.fetch, baseUrl: "https://nessie.test" });
  await expect(ensureDemoCustomer(client)).rejects.toThrow(/500/);
  expect(nessie.store.customers).toHaveLength(1);
  const partialAccounts = nessie.store.accounts.map((a) => a._id);
  expect(partialAccounts.length).toBeGreaterThan(0);
  const healthy = fakeNessie();
  Object.assign(healthy.store, nessie.store);
  const repaired = await ensureDemoCustomer(new NessieClient({ key: "k", fetch: healthy.fetch, baseUrl: "https://nessie.test" }));
  expect(repaired).toEqual({ customerId: nessie.store.customers[0]._id, created: true });
  expect(healthy.store.customers).toHaveLength(1);
  expect(healthy.store.accounts).toHaveLength(3);
  expect(healthy.store.accounts.some((a) => partialAccounts.includes(a._id))).toBe(false);
  expect(healthy.calls.filter((c) => c.method === "DELETE")).toHaveLength(partialAccounts.length);
  const again = await ensureDemoCustomer(new NessieClient({ key: "k", fetch: healthy.fetch, baseUrl: "https://nessie.test" }));
  expect(again.created).toBe(false);
});

it("imports live data that matches the offline snapshot", async () => {
  const nessie = fakeNessie();
  const live = await importBankData({ key: "k", fetch: nessie.fetch, baseUrl: "https://nessie.test" });
  const offline = await importBankData({ key: undefined, fetch: nessie.fetch, baseUrl: "https://nessie.test" });
  expect(live.source).toBe("nessie");
  expect(live.reason).toBeUndefined();
  expect(offline).toMatchObject({ source: "snapshot", reason: "no_key" });
  const strip = (s: typeof live) => ({ accounts: s.accounts.map(({ name, type, balance }) => [name, type, balance]), transactions: s.transactions.map(({ date, kind, description, category, amount }) => [date, kind, description, category, amount]) });
  expect(strip(live)).toEqual(strip(offline));
  expect(live.transactions.filter((t) => t.kind === "transfer")).toHaveLength(4);
});

it.each([
  ["a network error", () => { throw new TypeError("fetch failed"); }],
  ["a non-2xx response", () => new Response("nope", { status: 503 })],
  ["a hung request", () => new Promise<Response>(() => {})],
])("falls back to offline data on %s", async (_label, respond) => {
  const warn = vi.fn();
  const snapshot = await importBankData({ key: "k", fetch: (async () => respond()) as unknown as typeof fetch, timeoutMs: 20, warn });
  expect(snapshot.source).toBe("snapshot");
  expect(snapshot.reason).toMatch(/fetch failed|503|timed out/);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(snapshot.transactions.length).toBeGreaterThan(30);
});

it("falls back when seeding fails midway and still answers 200", async () => {
  const nessie = fakeNessie({ failAfter: 6 });
  const response = await handleBankImport({ key: "k", fetch: nessie.fetch, baseUrl: "https://nessie.test", warn: vi.fn() });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const snapshot = await response.json();
  expect(snapshot.source).toBe("snapshot");
  expect(snapshot.reason).toContain("500");
});

it("keeps the key out of error messages and rejects unexpected create payloads", async () => {
  const client = new NessieClient({ key: "secret", fetch: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch, baseUrl: "https://nessie.test" });
  await expect(client.createCustomer({ first_name: "a", last_name: "b", address: {} })).rejects.toThrow(NessieError);
  const bad = new NessieClient({ key: "secret", fetch: (async () => new Response("denied", { status: 401 })) as unknown as typeof fetch, baseUrl: "https://nessie.test" });
  await expect(bad.listCustomers()).rejects.toSatisfy((error: unknown) => error instanceof NessieError && error.status === 401 && !error.message.includes("secret"));
});
