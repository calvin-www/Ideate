# Nessie bank import — design

Date: 2026-09-13
Status: implemented (commit 8952c6c). See "Sandbox findings" for where the
live API differed from the plan.

## Goal

Let a student connect a mock bank (Capital One's Nessie sandbox) and pull their
accounts and transactions into the Spreadsheet, so the study partner can explain
their spending, build a budget, sketch cash flow on the board, and journal the
takeaway. This targets the Capital One hackathon challenge ("reimagine the
banking experience ... leverages the Nessie API"). Nessie is a mock ledger; no
real money or bank linkage is involved.

Demo story: click **Connect mock bank** (or say "pull in my bank transactions"),
the sheet fills with accounts, a transaction ledger, totals, and a by-category
block; then ask the partner questions about it.

## Non-goals

- Writing back to Nessie (paying bills, transfers).
- Choosing among customers; there is exactly one app-managed demo customer.
- Categories beyond the fixed seed set.
- Multiple sheets, a Bank pane on the desk, or any desk UI.
- End-to-end browser tests for this feature.

## Facts about Nessie (verified 2026-09-13)

- Base URL `https://api.nessieisreal.com`. Plain HTTP does not respond.
- Auth is `?key=<NESSIE_API_KEY>` on every request.
- `GET /customers` lists customers owned by the key (empty for a fresh key).
  `GET /enterprise/*` lists the whole shared sandbox, including other teams'
  data, and must not be used for lookup.
- Shapes: customer `{ _id, first_name, last_name, address, account_ids }`;
  account `{ _id, type: "Checking" | "Savings" | "Credit Card", nickname,
  balance, rewards, account_number, customer_id }`; purchases, deposits,
  withdrawals, bills, transfers hang off an account id; purchases reference a
  merchant `_id`.
- The service is known to go down during hackathons. The feature must degrade
  to bundled data without user action.

## Sandbox findings (during implementation)

Live probing changed four details:

- Purchase, deposit and withdrawal amounts are truncated to whole dollars;
  bills keep cents. Demo amounts are integers except bills.
- `POST /accounts/{id}/transfers` rejects `payee_id` and `medium`; a transfer
  is just `{ amount, transaction_date, status, description }` on one account.
  The seeder posts one leg per account with descriptions `Transfer to …` /
  `Transfer from …`, and `normalize` reads the direction from that prefix.
  Two-sided transfers (with `payer_id`/`payee_id`) are still handled and
  de-duplicated in case a fuller Nessie returns them.
- Some empty collections return HTTP 404 with a message string; the client
  treats that as `[]`.
- Customers cannot be deleted but accounts can, so a partially seeded customer
  is repaired by deleting its accounts and re-seeding rather than reused as-is.
- The bundled snapshot is derived from the same `demo.ts` ledger via
  `normalize` (`demoSnapshot()`), not a separate `snapshot.json`, so live and
  offline output are identical by construction.

## Architecture

```
SpreadsheetPanel button ─┐
                         ├─► POST /api/bank/import ─► ensureDemoCustomer + fetch ─► normalize ─► BankSnapshot
import_bank_data tool ───┘         (server)               │ on any failure
                                                          └─► bundled snapshot.json (source: "snapshot")
                         ◄──────────────── BankSnapshot JSON ──────────────────┘
bankSnapshotToSheet(snapshot, importedAt) : { sheet, ranges }   (client, pure)
  button  → SpreadsheetPanel.save(sheet)               (panel undo)
  tool    → Proposal { target: "spreadsheet", replacements: [whole text] }  (review/auto-apply, Change history)
```

Nessie is only ever called from the server; the key stays in `.env.local`.
The model never sees raw Nessie JSON; the sheet is built deterministically.

## Server

### `src/features/bank/server/nessie.ts`

Thin client. Constructed with `{ key, fetch, baseUrl?, timeoutMs = 10_000 }` so
tests inject a fake `fetch`. Every call appends `key`, sends/receives JSON,
aborts on timeout, and throws `NessieError { status, path }` on non-2xx.

Functions: `listCustomers`, `createCustomer`, `getAccounts(customerId)`,
`createAccount(customerId, ...)`, `getPurchases/Deposits/Withdrawals/Bills/
Transfers(accountId)`, `createPurchase/Deposit/Withdrawal/Bill/Transfer`,
`getMerchant(id)`, `createMerchant`.

### `src/features/bank/server/seed.ts`

`ensureDemoCustomer(client): Promise<{ customerId, created: boolean }>`.

- Looks up `/customers` for `last_name === "Ideate Demo"`. If found, reuses it.
- Otherwise creates the customer, three accounts (`Everyday` Checking,
  `Rainy day` Savings, `Card` Credit Card), the merchants it needs, and the
  transactions listed in `snapshot.json`, batched five at a time to bound
  first-connect latency (~45 POSTs; expect 10–20 s once, never again).
- Idempotency is by last-name match only. A partially failed seed leaves a
  customer with missing data; the next connect reuses it as-is. That is
  acceptable for a hackathon and documented in the README.

### `src/features/bank/server/normalize.ts`

`normalize(customer, accounts, txByAccount, merchantsById): BankSnapshot`.

```ts
type BankSnapshot = {
  source: "nessie" | "snapshot";
  reason?: string;                       // why we fell back
  customer: { id: string; name: string };
  accounts: { id: string; name: string; type: "Checking" | "Savings" | "Credit Card"; balance: number }[];
  transactions: {
    date: string;                        // YYYY-MM-DD
    accountId: string;
    kind: "purchase" | "deposit" | "withdrawal" | "bill" | "transfer";
    description: string;                 // merchant name, payee, or "Transfer to Rainy day"
    category: Category;
    amount: number;                      // positive = money in, negative = money out
  }[];
};
type Category = "Housing" | "Groceries" | "Dining" | "Transport" | "Utilities" | "Entertainment" | "Income" | "Savings";
```

- A transfer between two of the customer's accounts yields two rows: negative on
  the payer, positive on the payee, category `Savings`.
- Merchant category comes from the merchant record's `category`; unknown values
  map to `Entertainment` so the by-category block stays fixed.
- Transactions are sorted by date ascending, then by description.

### `src/features/bank/snapshot.json`

The demo dataset, already in `BankSnapshot` form with `source: "snapshot"`,
account ids `acc_everyday` / `acc_rainy` / `acc_card`, and about 45
transactions spanning one calendar month (rent, paycheck ×2, groceries,
coffee, transit, utilities, streaming, two transfers to savings, one card
payment). The seeder reads this same file, so live and offline data are
identical apart from ids and `source`.

### `src/app/api/bank/import/route.ts`

`POST`, no body, `dynamic = "force-dynamic"`.

1. If `NESSIE_API_KEY` is unset → return snapshot with `reason: "no_key"`.
2. Else `ensureDemoCustomer`, fetch accounts and all five transaction types per
   account, resolve merchants, `normalize`, return with `source: "nessie"`.
3. Any thrown error (network, timeout, non-2xx, malformed JSON, seed failure)
   → `console.warn` once and return snapshot with `reason` set to the error's
   short message. The route never returns a non-200 status for Nessie problems.

Response is `BankSnapshot` JSON.

## Client

### `src/features/bank/toSheet.ts`

`bankSnapshotToSheet(snapshot: BankSnapshot, importedAt: Date): { sheet: Sheet; ranges: Ranges }`.
Pure. `Ranges` is `{ accounts, transactions, totals, categories }`, each a
`{ fromRow, toRow }`, returned so the tool result can tell the partner where
things landed.

Layout (rows shift with the data; addresses below are for the demo snapshot):

```
A1  Bank import        B1  Capital One Nessie (live) · 2026-09-13
                            or: Offline demo data · 2026-09-13 (Nessie unreachable)
A3  Accounts
A4  Account   B4 Type          C4 Balance
A5  Everyday  B5 Checking      C5 2314.20   (currency)
A6  Rainy day B6 Savings       C6 5000      (currency)
A7  Card      B7 Credit Card   C7 -412.55   (currency)

A9  Transactions
A10 Date   B10 Account   C10 Description   D10 Category   E10 Money in   F10 Money out
A11 …      one row per transaction, oldest first; E or F filled, the other blank; currency format

A<T>   Totals                       E<T> =SUM(E11:E<last>)   F<T> =SUM(F11:F<last>)
A<T+1> Net                          E<T+1> =E<T>-F<T>

A<C>   By category
A<C+1> Category   B<C+1> Spent
A<C+2> Groceries  B<C+2> =F14+F19+F27   (explicit refs to Money-out cells of that category; "0" if none)
…      one row per Category in fixed order; Income is listed with Money-in refs instead
```

Rationale: the formula engine has `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`,
`ROUND` only — no `SUMIF` — so income and spending are separate columns and the
category block uses explicit references. Every formula must evaluate without
error under `evaluateSheet`. The converter throws if the result would exceed
200 rows, 5,000 cells, or the 200,000-character limit; the demo data is ~70
rows.

### `SpreadsheetPanel.tsx`

Header gains a **Connect mock bank** button (lucide `Landmark`).

- If the sheet has any cells, `confirm("Replace the spreadsheet with your bank import? You can undo this.")` first.
- Click → button disabled with label "Connecting…"; after ~3 s with no
  response the label becomes "Setting up demo bank…" (first-connect seeding).
- On response → `save(bankSnapshotToSheet(snapshot, new Date()).sheet)` so the
  panel's own Undo reverses it; a status line under the header reads
  "Imported from Capital One Nessie (live)" or
  "Imported offline demo data — Nessie unreachable". The status clears on the
  next edit.
- Only a failed `fetch` to our own route shows an error ("Bank import failed:
  …") — the route itself never fails for Nessie reasons.

### Agent tool `import_bank_data`

- `tools.ts`: `import_bank_data: z.strictObject({ baseRevision, summary })`.
  Declaration text: "Import the student's mock bank accounts and transactions
  (Capital One Nessie sandbox) into the spreadsheet, replacing its contents.
  Use when the student asks to connect, pull, or import their bank,
  transactions, or spending."
- `useCollaborator.ts` `stage()`: for this call, `fetch("/api/bank/import", { method: "POST" })`,
  convert, and build a `Proposal` with `target: "spreadsheet"` and
  `replacements: [{ from: 0, to: current.length, text: serializeSheet(sheet) }]`
  — the same shape `edit_spreadsheet` already uses, so review/auto-apply,
  revision checks, Change history, and undo all apply unchanged. The tool result
  adds `{ source, reason?, ranges }` so the partner can cite rows without a
  second read and can say "offline demo data" truthfully when `source` is
  `snapshot`. If the fetch to our route fails, return
  `{ status: "unavailable", message }` like other tool failures.
- `prompt.ts`: one paragraph — the tool exists; the bank is a sandbox with mock
  money; on `source: "snapshot"` tell the student it is offline demo data;
  column meanings (Money in / Money out, category block) and that formulas
  already total the ledger; prefer reading the sheet over asking the student
  for numbers that are in it.

## Configuration and docs

- `.env.example`: `NESSIE_API_KEY=` with a comment pointing at
  nessieisreal.com signup.
- README: a "Connect a mock bank" section — what the button does, where the key
  goes, that the first connect seeds data and takes a moment, that the sheet is
  replaced (undoable), the offline fallback, and that everything is mock money.
  Update the "does not ... connect to banks" sentence.

## Error handling summary

| Failure | Behaviour |
|---|---|
| No `NESSIE_API_KEY` | snapshot, `reason: "no_key"` |
| DNS/timeout/non-2xx from Nessie | snapshot, `reason` = short message, one `console.warn` |
| Seed partially fails | error propagates → snapshot this time; next connect reuses the partial customer |
| Our route unreachable | button error text / tool `unavailable` result |
| Converter limit exceeded | throws; surfaced as button error / tool `unavailable` (cannot happen with seed data) |

## Testing (vitest, `tests/`)

- `bank-normalize.test.ts` — Nessie-shaped fixtures → `BankSnapshot`: sign
  convention, transfer double-entry, category mapping and fallback, sort order.
- `bank-seed.test.ts` — with a fake `fetch`: empty `/customers` → creates
  customer, accounts, merchants, transactions, batched ≤5 in flight; existing
  "Ideate Demo" → no POSTs.
- `bank-route.test.ts` — missing key → snapshot/`no_key`; fetch throws →
  snapshot with reason and 200; non-2xx → same; happy path → `source: "nessie"`.
- `bank-sheet.test.ts` — converter on the bundled snapshot: header cells,
  account rows, one row per transaction with E/F split, `evaluateSheet` totals
  equal the fixture sums, net = in − out, every category cell equals the
  fixture's per-category sum, no formula errors, within limits, live vs.
  offline header text.
- `spreadsheet-ai.test.ts` (extend) — `import_bank_data` staging: mocked
  fetch → one whole-text replacement proposal, result carries `source` and
  `ranges`; fetch failure → `unavailable`.

## Open risks

- Nessie may reject or rate-limit a burst of ~45 POSTs; batching at 5 is a
  guess. If seeding proves flaky, the fallback still keeps the demo working.
- The shared sandbox means `/customers` could in theory show a customer created
  by someone else using the same key; the last-name match makes that harmless.
