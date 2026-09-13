export const CATEGORIES = ["Housing", "Groceries", "Dining", "Transport", "Utilities", "Entertainment", "Income", "Savings"] as const;
export type Category = (typeof CATEGORIES)[number];
export type AccountType = "Checking" | "Savings" | "Credit Card";
export type TransactionKind = "purchase" | "deposit" | "withdrawal" | "bill" | "transfer";

export type BankAccount = { id: string; name: string; type: AccountType; balance: number };
export type BankTransaction = {
  date: string; // YYYY-MM-DD
  accountId: string;
  kind: TransactionKind;
  description: string;
  category: Category;
  amount: number; // positive = money in, negative = money out
};
export type BankSnapshot = {
  source: "nessie" | "snapshot";
  reason?: string;
  customer: { id: string; name: string };
  accounts: BankAccount[];
  transactions: BankTransaction[];
};

// Nessie record shapes, limited to the fields this feature reads.
export type NessieCustomer = { _id: string; first_name: string; last_name: string; account_ids?: string[] };
export type NessieAccount = { _id: string; type: string; nickname: string; balance: number; customer_id: string };
export type NessieMerchant = { _id: string; name: string; category?: string | string[] };
export type NessiePurchase = { _id: string; merchant_id: string; purchase_date: string; amount: number; description?: string; payer_id: string };
export type NessieDeposit = { _id: string; transaction_date: string; amount: number; description?: string; payee_id: string };
export type NessieWithdrawal = { _id: string; transaction_date: string; amount: number; description?: string; payer_id: string };
export type NessieBill = { _id: string; payee: string; nickname?: string; payment_date?: string; upcoming_payment_date?: string; payment_amount: number; account_id: string };
export type NessieTransfer = { _id?: string; id?: string; transaction_date: string; amount: number; description?: string; payer_id?: string; payee_id?: string };
export type NessieAccountRecords = {
  purchases: NessiePurchase[];
  deposits: NessieDeposit[];
  withdrawals: NessieWithdrawal[];
  bills: NessieBill[];
  transfers: NessieTransfer[];
};
