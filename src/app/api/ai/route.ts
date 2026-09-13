import { handleAiRequest } from "@/features/ai/server/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleAiRequest(request);
}
