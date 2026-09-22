import { describe, expect, it } from "bun:test";

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

const makeAi = (responses: unknown[] = []) => ({
  run: async () => {
    const value = responses.shift();
    if (value === undefined) {
      return { data: [[0.1, 0.2, 0.3]] };
    }
    return value;
  },
});

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

    const env = {
      DB: makeDb(ragRows),
      AI: makeAi([
        { data: [[0.1, 0.2, 0.3]] },
        {
          response:
            "Take a break and stop driving if your fatigue score remains elevated.",
        },
      ]),
      VECTORIZE: makeVectorize([
        { id: "chunk-1", score: 0.91, metadata: { chunkId: "chunk-1" } },
      ]),
    } as any;

    const response = await worker.fetch(
      new Request("https://example.com/api/advice", {
        method: "POST",
        headers: { "content-type": "application/json" },
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
    const env = {
      DB: makeDb(),
      AI: makeAi([
        { data: [[0.1, 0.2, 0.3]] },
        {
          response:
            "No direct fatigue guidance was retrieved, so consider pulling over and resting.",
        },
      ]),
      VECTORIZE: makeVectorize([]),
    } as any;

    const response = await worker.fetch(
      new Request("https://example.com/api/advice", {
        method: "POST",
        headers: { "content-type": "application/json" },
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
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-123" }),
      }),
      {
        DB: makeDb(),
        AI: makeAi(),
        VECTORIZE: makeVectorize(),
      } as any,
    );

    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toContain("fatigueScore");
  });

  it("fails safely when the Workers AI embedding call errors", async () => {
    const env = {
      DB: makeDb(),
      AI: {
        run: async () => {
          throw new Error("Workers AI failure");
        },
      },
      VECTORIZE: makeVectorize(),
    } as any;

    const response = await worker.fetch(
      new Request("https://example.com/api/advice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fatigueScore: 82 }),
      }),
      env,
    );

    expect(response.status).toBe(500);
    const json = (await response.json()) as { error: string };
    expect(json.error).toContain("Workers AI");
  });
});
