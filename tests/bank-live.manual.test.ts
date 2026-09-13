// Manual check against the real Nessie sandbox. Run with:
//   NESSIE_API_KEY=... npx vitest run tests/bank-live.manual.test.ts --testTimeout 120000
// It skips itself unless NESSIE_API_KEY is set.
// 
import { it, expect } from "vitest";
import { importBankData } from "../src/features/bank/server/import";

it.skipIf(!process.env.NESSIE_API_KEY)("imports from the live sandbox", async () => {
  const t0 = Date.now();
  const snap = await importBankData();
  console.log("source", snap.source, snap.reason ?? "", `${Date.now() - t0}ms`);
  console.log("accounts", JSON.stringify(snap.accounts));
  console.log("tx", snap.transactions.length, JSON.stringify(snap.transactions.slice(0, 4)));
  console.log("kinds", JSON.stringify(Object.fromEntries(["purchase","deposit","bill","transfer","withdrawal"].map(k => [k, snap.transactions.filter(t => t.kind === k).length]))));
  expect(snap.source).toBe("nessie");
});
