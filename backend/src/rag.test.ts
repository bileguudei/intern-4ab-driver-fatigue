import { afterEach, describe, expect, it } from "bun:test";

import worker from "./index";
import {
  adviceRiskInstruction,
  buildAdviceQuery,
  chunkText,
  classifyFatigueRisk,
  createVectorMetadata,
  formatPerclos,
  normalizeAdviceRequest,
  selectRelevantChunks,
  toPlainText,
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

  it("strips Markdown so the app shows clean text", () => {
    const markdown =
      "## Зөвлөгөө\n**Ажиглагдсан үзүүлэлт:**\n* Ядаргааны оноо: **80**\n*   Хугацаа: 140 минут\n\n\n\n• Амраарай";

    expect(toPlainText(markdown)).toBe(
      "Зөвлөгөө\nАжиглагдсан үзүүлэлт:\n- Ядаргааны оноо: 80\n- Хугацаа: 140 минут\n\n- Амраарай",
    );
    expect(toPlainText("- Энгийн мөр")).toBe("- Энгийн мөр");
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

describe("fatigue risk in advice", () => {
  const base = {
    sessionId: "session-1",
    driverId: 2,
    fatigueScore: 5,
    averageFatigueScore: 1,
    maxFatigueScore: 5,
    driveDurationMinutes: 1,
    prolongedEyeClosureCount: 0,
    headNodCount: 0,
    perclos: 0.02,
    warningCount: 0,
    criticalCount: 0,
  };

  it("classifies risk with the app's 40/70 thresholds and alert counts", () => {
    expect(classifyFatigueRisk(base)).toBe("low");
    expect(classifyFatigueRisk({ ...base, maxFatigueScore: 45 })).toBe("moderate");
    expect(classifyFatigueRisk({ ...base, warningCount: 1 })).toBe("moderate");
    expect(classifyFatigueRisk({ ...base, headNodCount: 2 })).toBe("moderate");
    expect(classifyFatigueRisk({ ...base, fatigueScore: 75 })).toBe("high");
    expect(classifyFatigueRisk({ ...base, criticalCount: 1 })).toBe("high");
    expect(classifyFatigueRisk({ ...base, prolongedEyeClosureCount: 1 })).toBe("high");
  });

  it("tells retrieval the 0-100 scale and asks for preventive guidance when risk is low", () => {
    const query = buildAdviceQuery(base);
    expect(query).toContain("0-100");
    expect(query).toContain("LOW");
    expect(query).toContain("preventive");
    expect(query).not.toContain("urgent");
  });

  it("does not ask the model to stop the driver when risk is low", () => {
    expect(adviceRiskInstruction("low")).toContain("Do NOT tell the driver to stop");
    expect(adviceRiskInstruction("high")).toContain("Recommend stopping");
  });

  it("reads alert counts in camelCase and snake_case", () => {
    expect(normalizeAdviceRequest({ fatigueScore: 5, warningCount: 2, criticalCount: 1 })).toMatchObject({ warningCount: 2, criticalCount: 1 });
    expect(normalizeAdviceRequest({ fatigueScore: 5, warning_count: 3, critical_count: 0 })).toMatchObject({ warningCount: 3, criticalCount: 0 });
    expect(normalizeAdviceRequest({ fatigueScore: 5 })).toMatchObject({ warningCount: null, criticalCount: null });
  });

  it("formats PERCLOS as a percentage", () => {
    expect(formatPerclos(0.18)).toBe("18%");
    expect(formatPerclos(null)).toBe("n/a");
  });

  it("sends the risk level and scale to Gemini and returns it to the app", async () => {
    let generationBody = "";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes(":batchEmbedContents")) {
        return new Response(JSON.stringify({ embeddings: [{ values: [0.1, 0.2, 0.3] }] }), { status: 200 });
      }
      generationBody = String(init?.body ?? "");
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "Ядаргааны шинж илрээгүй." }] } }] }),
        { status: 200 },
      );
    }) as typeof fetch;

    const response = await worker.fetch(
      new Request("https://example.com/api/rag/advice", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test-key" },
        body: JSON.stringify(base),
      }),
      { DB: makeDb([]), GEMINI_API_KEY: "test-key", APP_API_KEY: "test-key", VECTORIZE: makeVectorize([]) } as any,
    );

    expect(response.status).toBe(201);
    expect(((await response.json()) as { riskLevel: string }).riskLevel).toBe("low");
    expect(generationBody).toContain("Overall fatigue risk: LOW.");
    expect(generationBody).toContain("0-100 scale");
    expect(generationBody).toContain("Do NOT tell the driver to stop");
    expect(generationBody).toContain("2%");
  });
});
