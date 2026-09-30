# Deployment state for Vercel

Ideate's selected deployment is Vercel Functions. A continuation can reach a different instance or a restarted instance, so production AI checkpoints and visitor throttles use Upstash Redis. The browser still owns workspace changes and carries the encoded SDK continuation state; Redis stores only a checkpoint token's state fingerprint, kind, and expiry, never workspace contents or provider credentials.

## Required setup before deployment

1. Add [Upstash Redis through the Vercel Marketplace](https://vercel.com/docs/marketplace-storage) to the Vercel project.
2. Confirm both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are available to every production and preview Function environment that serves `/api/ai`. The [Upstash Node SDK](https://upstash.com/docs/redis/sdks/ts/deployment) reads these names. No real credentials belong in the repository.
3. Deploy only after both variables are present. Production without either variable returns 503 for AI requests. Local development and tests without either variable use process-local memory; that mode does not preserve continuations across restarts or instances.

## Continuation and load policy

- A checkpoint expires after 30 minutes. Redis `SET` supplies the TTL, and [atomic `GETDEL`](https://upstash.com/docs/redis/sdks/ts/commands/string/getdel) lets one instance consume it exactly once. A missing, expired, mismatched, or replayed token returns 409 before contacting the model.
- Once a continuation token is consumed, it is never restored. The server may retry a transient provider 503 within that same request under its existing recovery budget. If the request ultimately fails, replaying the token returns 409; the visitor starts a new request. This avoids duplicate tool rounds after an uncertain provider outcome.
- The shared visitor throttle allows 36 AI requests per minute per Vercel supplied `X-Forwarded-For` address and returns 429 when exceeded. Missing addresses share one conservative bucket. The [Upstash limiter](https://upstash.com/docs/redis/sdks/ratelimit-ts/methods) may report a timeout as an allowed result; Ideate treats that result and Redis errors as 503.
- Separate local overload guards protect each instance: AI admits at most 36 requests per minute per process, and voice speech generation admits at most four concurrent streams per process. These return 503 when busy. They are capacity guards, not cross-instance visitor quotas.

Redis unavailability fails closed for checkpoint issue or consume and visitor throttling. No external Redis resource or credentials are provisioned by the code or its tests.
