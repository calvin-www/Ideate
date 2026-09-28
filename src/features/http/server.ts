export const CREDENTIAL_PATTERN = /^[\x21-\x7e]{1,256}$/;

export class InvalidCredentialError extends Error {
  constructor(public readonly header: string) {
    super(`The ${header} header is not a valid credential.`);
  }
}

export function readCredential(request: Request, header: string): string | undefined {
  const value = request.headers.get(header);
  if (value === null || value === "") return undefined;
  if (!CREDENTIAL_PATTERN.test(value)) throw new InvalidCredentialError(header);
  return value;
}

export function isTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return (
    origin === new URL(request.url).origin &&
    (!fetchSite || fetchSite === "same-origin")
  );
}

export function errorResponse(status: number, message: string): Response {
  return Response.json(
    { type: "error", message },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export class RequestBodyTooLargeError extends Error {}

export async function readRequestText(
  request: Request,
  maxBytes: number,
  timeoutMs: number,
): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new RequestBodyTooLargeError();

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
  signal.throwIfAborted();
  if (!request.body) return "";

  const reader = request.body.getReader();
  const stopReading = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener("abort", stopReading, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", stopReading);
    reader.releaseLock();
  }

  const result = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(result);
}
