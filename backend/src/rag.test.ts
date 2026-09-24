import { afterEach, describe, expect, it } from "bun:test";

import worker from "./index";
import {
  buildAdviceQuery,
  chunkText,
  createVectorMetadata,
  normalizeAdviceRequest,
  selectRelevantChunks,
} from "./rag";

const makeDb = (ragRows: Array<Record<string, unknown>> = []) => ({
  prepare: (sql: string) => ({
    bind: (..._args: unknown[]) => ({
      run: async () => ({ meta: { changes: 1 } }),
      all: async () => {
        if (sql.includes("FROM rag_chunks")) {
          return { results: ragRows };
        }
        return { results: [] };
      },
      first: async () => null,
    }),
  }),
});

const makeVectorize = (matches: Array<Record<string, unknown>> = []) => ({
  query: async () => ({ matches }),
  upsert: async () => ({ ok: true }),
});

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockGeminiFetch(options: {
  adviceText?: string;
  throwOnEmbed?: boolean;
} = {}) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes(":batchEmbedContents")) {
      if (options.throwOnEmbed) throw new Error("Gemini embedding failure");
      const body = JSON.parse((init?.body as string) ?? "{}") as {
        requests?: unknown[];
      };
      const count = body.requests?.length ?? 1;
      return new Response(
        JSON.stringify({
          embeddings: Array.from({ length: count }, () => ({
            values: [0.1, 0.2, 0.3],
          })),
        }),
        { status: 200 },
      );
    }
    if (url.includes(":generateContent")) {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: options.adviceText ?? "Take a break." }],
              },
            },
          ],
        }),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected fetch to ${url}`);
  }) as typeof fetch;
}

describe("RAG helpers", () => {
  it("splits text into overlapping chunks", () => {
    const text =
      "Driver fatigue safety guidelines. Rest breaks are important. Avoid driving while drowsy. Stop when tired.";
    const chunks = chunkText(text, { chunkSize: 40, overlap: 10 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].length).toBeLessThanOrEqual(40);
    expect(chunks[0]).toContain("Driver");
    expect(chunks[1]).toContain("Rest");
  });

  it("normalizes request data and rejects invalid fatigue values", () => {
    const request = normalizeAdviceRequest({
      sessionId: "session-123",
      driverId: 7,
      fatigueScore: 82,
      averageFatigueScore: 71,
      maxFatigueScore: 94,
      driveDurationMinutes: 165,
      prolongedEyeClosureCount: 5,
      headNodCount: 3,
      perclos: 0.21,
    });

    expect(request.sessionId).toBe("session-123");
    expect(request.fatigueScore).toBe(82);
    expect(() => normalizeAdviceRequest({ sessionId: "x" })).toThrow(
      "fatigueScore",
    );
  });

  it("builds a useful query from fatigue data", () => {
    const query = buildAdviceQuery({
      sessionId: "session-123",
      driverId: 7,
      fatigueScore: 82,
      averageFatigueScore: 71,
      maxFatigueScore: 94,
      driveDurationMinutes: 165,
      prolongedEyeClosureCount: 5,
      headNodCount: 3,
      perclos: 0.21,
    });

    expect(query).toContain("fatigue score is 82");
    expect(query).toContain("165");
    expect(query).toContain("prolonged eye closure");
  });

  it("filters chunks below the similarity threshold", () => {
    const matches = [
      { id: "low", score: 0.12, metadata: { chunkId: "low" } },
      { id: "good", score: 0.84, metadata: { chunkId: "good" } },
    ];

    const selected = selectRelevantChunks(matches, 0.5);
    expect(selected).toHaveLength(1);
    expect(selected[0].id).toBe("good");
  });

  it("creates vector metadata with source traceability", () => {
    const metadata = createVectorMetadata({
      documentId: "doc-1",
      chunkId: "doc-1-0",
      category: "fatigue",
      title: "Drowsy Driving Guidelines",
      source: "https://example.com/guidelines",
    });

    expect(metadata).toMatchObject({
      documentId: "doc-1",
      chunkId: "doc-1-0",
      category: "fatigue",
      title: "Drowsy Driving Guidelines",
    });
  });
});

describe("App-wide authentication", () => {
  it("rejects requests without the app API key", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/advice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fatigueScore: 82 }),
      }),
      { DB: makeDb(), APP_API_KEY: "test-key" } as any,
    );

    expect(response.status).toBe(401);
  });

  it("rejects requests with the wrong app API key", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/advice", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer wrong-key",
        },
        body: JSON.stringify({ fatigueScore: 82 }),
      }),
      { DB: makeDb(), APP_API_KEY: "test-key" } as any,
    );

    expect(response.status).toBe(401);
  });

  it("does not require the app API key for /api/rag/ingest, which has its own key", async () => {
    // APP_API_KEY is set but no Authorization header is sent, and
    // INGEST_API_KEY is deliberately left unset. If the app-wide gate applied
    // here it would reject with its own "Unauthorized" 401 before ever
    // reaching ingestKnowledgeDocument. Getting ingest's distinct 500 message
    // instead proves the gate was skipped for this route.
    const response = await worker.fetch(
      new Request("https://example.com/api/rag/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "x",
          category: "x",
          source: "x",
          documentText: "x",
        }),
      }),
      { DB: makeDb(), APP_API_KEY: "test-key" } as any,
    );

    expect(response.status).toBe(500);
    const json = (await response.json()) as { error: string };
    expect(json.error).toContain("INGEST_API_KEY");
  });
});

describe("Advice API", () => {
  it("validates the request and returns advice with sources", async () => {
    const ragRows = [
      {
        id: "chunk-1",
        content:
          "Take a break if fatigue score is high and eye closure is frequent. Pull over in a safe location and rest for at least 15 minutes.",
        category: "fatigue",
        title: "Drowsy Driving Safety Guidelines",
        source: "https://example.com/fatigue-guidelines",
      },
    ];

    globalThis.fetch = mockGeminiFetch({
      adviceText:
        "Take a break and stop driving if your fatigue score remains elevated.",
    });

    const env = {
      DB: makeDb(ragRows),
      GEMINI_API_KEY: "test-key",
      APP_API_KEY: "test-key",
      VECTORIZE: makeVectorize([
        { id: "chunk-1", score: 0.91, metadata: { chunkId: "chunk-1" } },
      ]),
    } as any;

    const response = await worker.fetch(
      new Request("https://example.com/api/advice", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-key",
        },
        body: JSON.stringify({
          sessionId: "session-123",
          fatigueScore: 82,
          averageFatigueScore: 71,
          maxFatigueScore: 94,
          driveDurationMinutes: 165,
          prolongedEyeClosureCount: 5,
          headNodCount: 3,
          perclos: 0.21,
        }),
      }),
      env,
    );

    expect(response.status).toBe(201);
    const json = (await response.json()) as {
      advice: string;
      sources: Array<{ title: string }>;
    };
    expect(json.advice).toContain("break");
    expect(json.sources[0].title).toBe("Drowsy Driving Safety Guidelines");
  });

  it("returns an empty-source response when retrieval is irrelevant", async () => {
    globalThis.fetch = mockGeminiFetch({
      adviceText:
        "No direct fatigue guidance was retrieved, so consider pulling over and resting.",
    });

    const env = {
      DB: makeDb(),
      GEMINI_API_KEY: "test-key",
      APP_API_KEY: "test-key",
      VECTORIZE: makeVectorize([]),
    } as any;

    const response = await worker.fetch(
      new Request("https://example.com/api/advice", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-key",
        },
        body: JSON.stringify({ fatigueScore: 82 }),
      }),
      env,
    );

    expect(response.status).toBe(201);
    const json = (await response.json()) as {
      sources: unknown[];
      advice: string;
    };
    expect(json.sources).toEqual([]);
    expect(json.advice).toContain("rest");
  });

  it("returns a validation error when fatigue data is missing", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/advice", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-key",
        },
        body: JSON.stringify({ sessionId: "session-123" }),
      }),
      {
        DB: makeDb(),
        GEMINI_API_KEY: "test-key",
        APP_API_KEY: "test-key",
        VECTORIZE: makeVectorize(),
      } as any,
    );

    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toContain("fatigueScore");
  });

  it("fails safely when the Gemini embedding call errors", async () => {
    globalThis.fetch = mockGeminiFetch({ throwOnEmbed: true });

    const env = {
      DB: makeDb(),
      GEMINI_API_KEY: "test-key",
      APP_API_KEY: "test-key",
      VECTORIZE: makeVectorize(),
    } as any;

    const response = await worker.fetch(
      new Request("https://example.com/api/advice", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-key",
        },
        body: JSON.stringify({ fatigueScore: 82 }),
      }),
      env,
    );

    expect(response.status).toBe(500);
    const json = (await response.json()) as { error: string };
    expect(json.error).toContain("Gemini");
  });
});

describe("Advice generation fallback", () => {
  const env = () =>
    ({
      DB: makeDb(),
      GEMINI_API_KEY: "test-key",
      APP_API_KEY: "test-key",
      VECTORIZE: makeVectorize(),
    }) as any;

  const requestAdvice = () =>
    worker.fetch(
      new Request("https://example.com/api/advice", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-key",
        },
        body: JSON.stringify({ fatigueScore: 82 }),
      }),
      env(),
    );

  function mockGeneration(
    respond: (model: string) => Response | Promise<Response>,
  ) {
    const models: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes(":batchEmbedContents")) {
        return mockGeminiFetch()(input, init);
      }
      const model = url.match(/models\/([^:]+):generateContent/)?.[1] ?? "";
      models.push(model);
      return respond(model);
    }) as typeof fetch;
    return models;
  }

  const answer = (parts: Array<{ text: string; thought?: boolean }>) =>
    new Response(JSON.stringify({ candidates: [{ content: { parts } }] }), {
      status: 200,
    });

  it("falls back to the next model when one is overloaded", async () => {
    const models = mockGeneration((model) =>
      model === "gemini-3.6-flash"
        ? new Response("{}", { status: 503 })
        : answer([{ text: "Түр зогсоод амраарай." }]),
    );

    const response = await requestAdvice();

    expect(response.status).toBe(201);
    expect(((await response.json()) as { advice: string }).advice).toBe(
      "Түр зогсоод амраарай.",
    );
    expect(models).toEqual(["gemini-3.6-flash", "gemini-flash-lite-latest"]);
  });

  it("falls back when a model times out", async () => {
    const models = mockGeneration((model) => {
      if (model === "gemini-3.6-flash") {
        throw new DOMException("timed out", "TimeoutError");
      }
      return answer([{ text: "Амраарай." }]);
    });

    const response = await requestAdvice();

    expect(response.status).toBe(201);
    expect(models).toEqual(["gemini-3.6-flash", "gemini-flash-lite-latest"]);
  });

  it("hides the model's thought parts from the driver", async () => {
    mockGeneration(() =>
      answer([
        { text: "Role: driver-safety assistant...", thought: true },
        { text: "Анхааруулга! Түр зогсоорой." },
      ]),
    );

    const response = await requestAdvice();

    expect(((await response.json()) as { advice: string }).advice).toBe(
      "Анхааруулга! Түр зогсоорой.",
    );
  });

  it("reports an error only after every model fails", async () => {
    const models = mockGeneration(() => new Response("{}", { status: 503 }));

    const response = await requestAdvice();

    expect(response.status).toBe(500);
    expect(((await response.json()) as { error: string }).error).toContain(
      "all models",
    );
    expect(models).toHaveLength(3);
  });

  it("does not retry on a non-transient error such as a bad API key", async () => {
    const models = mockGeneration(() => new Response("{}", { status: 403 }));

    const response = await requestAdvice();

    expect(response.status).toBe(500);
    expect(models).toEqual(["gemini-3.6-flash"]);
  });
});
