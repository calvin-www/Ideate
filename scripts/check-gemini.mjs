import { GoogleGenAI, FunctionCallingConfigMode } from "@google/genai";
import { deflateSync } from "node:zlib";

// Tiny deterministic visual fixture: a blue square followed by an orange circle.
// No external image, credential, or workspace content is used by this check.
function fixturePng() {
  const width = 128,
    height = 64;
  const rows = Buffer.alloc(height * (1 + width * 3), 255);
  for (let y = 0; y < height; y++) {
    rows[y * (1 + width * 3)] = 0;
    for (let x = 0; x < width; x++) {
      let color = [255, 255, 255];
      if (x >= 14 && x <= 48 && y >= 15 && y <= 49) color = [15, 70, 220];
      if ((x - 96) ** 2 + (y - 32) ** 2 <= 18 ** 2) color = [245, 125, 20];
      const offset = y * (1 + width * 3) + 1 + x * 3;
      rows.set(color, offset);
    }
  }
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const name = Buffer.from(type);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, crc]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function safeFailure(error) {
  const status = typeof error?.status === "number" ? error.status : null;
  return {
    ok: false,
    status,
    reason:
      status === 429
        ? "rate_limited"
        : [401, 403].includes(status)
          ? "access_denied"
          : status === 404
            ? "model_unavailable"
            : status === 503
              ? "provider_temporarily_unavailable"
              : error?.name === "TimeoutError" || error?.name === "AbortError"
                ? "timed_out"
                : "request_failed",
  };
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.log(
      JSON.stringify({ ok: false, reason: "GEMINI_API_KEY is missing" }),
    );
    process.exitCode = 1;
    return;
  }
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const config = () => ({
    maxOutputTokens: 2_048,
    thinkingConfig: { includeThoughts: false },
    httpOptions: { timeout: 40_000 },
    abortSignal: AbortSignal.timeout(45_000),
  });
  let passed = true;
  async function check(name, fn) {
    const start = Date.now();
    try {
      const result = await fn();
      passed &&= result.ok;
      console.log(
        JSON.stringify({
          check: name,
          model,
          elapsedMs: Date.now() - start,
          ...result,
        }),
      );
    } catch (error) {
      passed = false;
      console.log(
        JSON.stringify({
          check: name,
          model,
          elapsedMs: Date.now() - start,
          ...safeFailure(error),
        }),
      );
    }
  }
  await check("streamed_text", async () => {
    const stream = await client.models.generateContentStream({
      model,
      contents:
        "In at most 35 words, explain why binary search assumes sorted input.",
      config: config(),
    });
    let answer = "",
      chunks = 0,
      finishReason;
    for await (const item of stream) {
      finishReason = item.candidates?.[0]?.finishReason || finishReason;
      for (const part of item.candidates?.[0]?.content?.parts ?? [])
        if (part.text && !part.thought) {
          answer += part.text;
          chunks++;
        }
    }
    return {
      ok: answer.length > 0 && finishReason === "STOP",
      chunks,
      finishReason,
      answer: answer.slice(0, 600),
    };
  });
  await check("image_understanding", async () => {
    const response = await client.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: "image/png",
                data: fixturePng().toString("base64"),
              },
            },
            {
              text: "Name the two shapes and their colors from left to right. One short sentence.",
            },
          ],
        },
      ],
      config: config(),
    });
    const answer = response.text || "";
    return {
      ok:
        /blue/i.test(answer) &&
        /square/i.test(answer) &&
        /orange/i.test(answer) &&
        /circle/i.test(answer),
      answer: answer.slice(0, 300),
    };
  });
  await check("function_call_and_continuation", async () => {
    const contents = [
      {
        role: "user",
        parts: [
          {
            text: "Read my code using read_code. Then say which exact code revision you received, in one sentence. Do not execute it.",
          },
        ],
      },
    ];
    const tool = {
      functionDeclarations: [
        {
          name: "read_code",
          description: "Read Python text and its revision.",
          parametersJsonSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      ],
    };
    const response = await client.models.generateContent({
      model,
      contents,
      config: {
        ...config(),
        tools: [tool],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.ANY,
            allowedFunctionNames: ["read_code"],
          },
        },
      },
    });
    const content = response.candidates?.[0]?.content;
    const call = content?.parts?.find(
      (part) => part.functionCall,
    )?.functionCall;
    if (!content || call?.name !== "read_code")
      return { ok: false, reason: "expected_function_call_missing" };
    const continued = await client.models.generateContent({
      model,
      contents: [
        ...contents,
        content,
        {
          role: "user",
          parts: [
            {
              functionResponse: {
                ...(call.id ? { id: call.id } : {}),
                name: call.name,
                response: {
                  output: {
                    id: "code",
                    revision: 7,
                    text: "def midpoint(low, high):\n    return (low + high) // 2\n",
                  },
                },
              },
            },
          ],
        },
      ],
      config: {
        ...config(),
        tools: [tool],
        toolConfig: {
          functionCallingConfig: { mode: FunctionCallingConfigMode.NONE },
        },
      },
    });
    const answer = continued.text || "";
    return {
      ok: /7/.test(answer),
      function: call.name,
      preservedThoughtSignature: content.parts.some((part) =>
        Boolean(part.thoughtSignature),
      ),
      answer: answer.slice(0, 300),
    };
  });
  process.exitCode = passed ? 0 : 1;
}

main().catch((error) => {
  console.log(JSON.stringify(safeFailure(error)));
  process.exitCode = 1;
});
