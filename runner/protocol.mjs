export const PROTOCOL = "ideate-python";
export const VERSION = 1;
export const MAX_CODE_BYTES = 256 * 1024;
export const MAX_OUTPUT_BYTES = 64 * 1024;
export const MAX_CHUNK_BYTES = 8192;
export const RUN_TIMEOUT_MS = 10_000;
export const INIT_TIMEOUT_MS = 45_000;
export const envelope = Object.freeze({ protocol: PROTOCOL, version: VERSION });
const encoder = new TextEncoder();

export function byteLength(text) {
  return encoder.encode(text).byteLength;
}
export function validId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function boundedString(value, maximum) {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    byteLength(value) <= maximum
  );
}
function base(message) {
  return (
    !!message &&
    typeof message === "object" &&
    !Array.isArray(message) &&
    message.protocol === PROTOCOL &&
    message.version === VERSION
  );
}

export function isParentMessage(message) {
  if (!base(message)) return false;
  if (message.type === "init") return true;
  if (!validId(message.id)) return false;
  if (message.type === "stop") return true;
  return (
    message.type === "run" &&
    boundedString(message.code, MAX_CODE_BYTES) &&
    (message.artifactId === undefined || validId(message.artifactId)) &&
    (message.sourceRevision === undefined ||
      (Number.isSafeInteger(message.sourceRevision) &&
        message.sourceRevision >= 0)) &&
    (message.sourceHash === undefined || boundedString(message.sourceHash, 128))
  );
}

export function isRunnerMessage(message) {
  if (!base(message)) return false;
  if (message.type === "status")
    return (
      ["loading", "ready", "running", "error"].includes(message.status) &&
      (message.error === undefined ||
        boundedString(message.error, MAX_CHUNK_BYTES))
    );
  if (!validId(message.id)) return false;
  if (message.type === "output")
    return (
      Number.isSafeInteger(message.sequence) &&
      message.sequence >= 0 &&
      ["stdout", "stderr"].includes(message.channel) &&
      boundedString(message.text, MAX_CHUNK_BYTES)
    );
  return (
    message.type === "complete" &&
    ["success", "error", "cancelled", "timeout"].includes(message.status) &&
    Number.isFinite(message.durationMs) &&
    message.durationMs >= 0 &&
    (message.error === undefined ||
      boundedString(message.error, MAX_CHUNK_BYTES)) &&
    (message.line === undefined ||
      (Number.isSafeInteger(message.line) && message.line > 0))
  );
}

export function trimUtf8(text, maximum) {
  const bytes = encoder.encode(text);
  if (bytes.length <= maximum) return text;
  let end = Math.max(0, maximum);
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return new TextDecoder().decode(bytes.subarray(0, end));
}

export function isTrustedParentEvent(event, parent, origins) {
  return (
    event.source === parent &&
    origins.includes(event.origin) &&
    isParentMessage(event.data)
  );
}
