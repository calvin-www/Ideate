import { handleBankImport } from "@/features/bank/server/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(): Promise<Response> {
  return handleBankImport();
}
