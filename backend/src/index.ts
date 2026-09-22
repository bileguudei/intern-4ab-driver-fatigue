import {
  buildAdviceQuery,
  chunkText,
  createVectorMetadata,
  normalizeAdviceRequest,
  selectRelevantChunks,
  type NormalizedAdviceRequest,
} from "./rag";

interface VectorizeBinding {
  query(
    vector: number[],
    options?: { topK?: number; returnMetadata?: boolean },
  ): Promise<{
    matches?: Array<{
      id: string;
      score: number;
      metadata?: Record<string, unknown>;
    }>;
  }>;
  upsert(
    vectors: Array<{
      id: string;
      values: number[];
      metadata?: Record<string, unknown>;
    }>,
  ): Promise<unknown>;
}

interface AiBinding {
  run(
    model: string,
    input:
      | { text: string[] }
      | { messages: Array<{ role: string; content: string }> },
  ): Promise<unknown>;
}

export interface Env {
  DB: D1Database;
  MEDIA?: R2Bucket;
  KNOWLEDGE?: R2Bucket;
  VECTORIZE?: VectorizeBinding;
  AI?: AiBinding;
}

type JsonObject = Record<string, unknown>;

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
const corsHeaders = {
  ...jsonHeaders,
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-driver-id",
};

const VECTOR_EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
const LLM_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const DEFAULT_RAG_TOP_K = 5;
const DEFAULT_RAG_THRESHOLD = 0.45;

function response(
  body: unknown,
  status = 200,
  headers: HeadersInit = corsHeaders,
) {
  return Response.json(body, { status, headers });
}

function errorResponse(message: string, status: number) {
  return response({ error: message }, status);
}

async function readJson(request: Request): Promise<JsonObject> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("JSON object required");
    return body as JsonObject;
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

function requiredString(body: JsonObject, key: string) {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${key} is required`);
  return value;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseId(value: string | undefined) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function extractModelText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.response === "string") return value.response.trim();
  if (typeof value.result === "string") return value.result.trim();
  if (Array.isArray(value.response)) {
    const text = value.response
      .map((item) =>
        typeof item === "string"
          ? item
          : typeof item === "object" &&
              item &&
              "text" in item &&
              typeof (item as { text?: unknown }).text === "string"
            ? (item as { text: string }).text
            : "",
      )
      .join(" ");
    if (text.trim()) return text.trim();
  }
  if (Array.isArray(value.result)) {
    const text = value.result
      .map((item) =>
        typeof item === "string"
          ? item
          : typeof item === "object" &&
              item &&
              "text" in item &&
              typeof (item as { text?: unknown }).text === "string"
            ? (item as { text: string }).text
            : "",
      )
      .join(" ");
    if (text.trim()) return text.trim();
  }
  if (Array.isArray(value.output)) {
    const text = value.output
      .map((item) =>
        typeof item === "string"
          ? item
          : typeof item === "object" &&
              item &&
              "text" in item &&
              typeof (item as { text?: unknown }).text === "string"
            ? (item as { text: string }).text
            : "",
      )
      .join(" ");
    if (text.trim()) return text.trim();
  }
  return null;
}

async function createSession(request: Request, env: Env) {
  const body = await readJson(request);
  const clientId = requiredString(body, "client_id");
  const driverId = parseId(String(body.driver_id ?? ""));
  if (!driverId) throw new Error("driver_id must be a positive integer");
  const startedAt =
    typeof body.started_at === "string"
      ? body.started_at
      : new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO driving_sessions (client_id, driver_id, started_at) VALUES (?, ?, ?)
         ON CONFLICT(client_id) DO NOTHING`,
  )
    .bind(clientId, driverId, startedAt)
    .run();
  const session = await env.DB.prepare(
    "SELECT * FROM driving_sessions WHERE client_id = ?",
  )
    .bind(clientId)
    .first();
  return response(session, 201);
}

async function createFatigueEvent(request: Request, env: Env) {
  const body = await readJson(request);
  const clientId = requiredString(body, "client_id");
  const sessionId = parseId(String(body.session_id ?? ""));
  const driverId = parseId(String(body.driver_id ?? ""));
  const level = requiredString(body, "level");
  if (!sessionId || !driverId)
    throw new Error("session_id and driver_id must be positive integers");
  const eventAt =
    typeof body.event_at === "string"
      ? body.event_at
      : new Date().toISOString();
  const metadata =
    body.metadata && typeof body.metadata === "object"
      ? JSON.stringify(body.metadata)
      : null;
  const insertResult = await env.DB.prepare(
    `INSERT INTO fatigue_events
         (client_id, session_id, driver_id, level, fatigue_score, blink_rate, yawn_count, event_at, media_key, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(client_id) DO NOTHING`,
  )
    .bind(
      clientId,
      sessionId,
      driverId,
      level,
      numberOrNull(body.fatigue_score),
      numberOrNull(body.blink_rate),
      typeof body.yawn_count === "number" ? body.yawn_count : 0,
      eventAt,
      typeof body.media_key === "string" ? body.media_key : null,
      metadata,
    )
    .run();
  if (insertResult.meta.changes > 0) {
    await env.DB.prepare(
      `UPDATE driving_sessions
             SET warning_count = warning_count + ?, critical_event_count = critical_event_count + ?,
                 fatigue_score = COALESCE(?, fatigue_score), updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
    )
      .bind(
        level === "warning" ? 1 : 0,
        level === "critical" ? 1 : 0,
        numberOrNull(body.fatigue_score),
        sessionId,
      )
      .run();
  }
  const event = await env.DB.prepare(
    "SELECT * FROM fatigue_events WHERE client_id = ?",
  )
    .bind(clientId)
    .first();
  return response(event, 201);
}

async function syncOperations(request: Request, env: Env) {
  const body = await readJson(request);
  const driverId = parseId(String(body.driver_id ?? ""));
  const operations = Array.isArray(body.operations) ? body.operations : [];
  if (!driverId) throw new Error("driver_id must be a positive integer");
  if (operations.length > 100)
    throw new Error("A maximum of 100 operations can be synced at once");
  for (const operation of operations) {
    if (!operation || typeof operation !== "object")
      throw new Error("Invalid sync operation");
    const item = operation as JsonObject;
    const operationId = requiredString(item, "operation_id");
    const resourceType = requiredString(item, "resource_type");
    const resourceId = requiredString(item, "resource_id");
    const payload =
      item.payload && typeof item.payload === "object"
        ? (item.payload as JsonObject)
        : {};
    const operationResult = await env.DB.prepare(
      `INSERT INTO sync_operations (operation_id, driver_id, resource_type, resource_id, payload_json)
             VALUES (?, ?, ?, ?, ?) ON CONFLICT(operation_id) DO NOTHING`,
    )
      .bind(
        operationId,
        driverId,
        resourceType,
        resourceId,
        JSON.stringify(payload),
      )
      .run();
    if (operationResult.meta.changes === 0) continue;
    if (resourceType === "session") {
      const clientId = requiredString(payload, "client_id");
      await env.DB.prepare(
        `INSERT INTO driving_sessions (client_id, driver_id, started_at, ended_at, fatigue_score, warning_count, critical_event_count, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(client_id) DO UPDATE SET ended_at = excluded.ended_at,
                 fatigue_score = excluded.fatigue_score, warning_count = excluded.warning_count,
                 critical_event_count = excluded.critical_event_count, status = excluded.status,
                 updated_at = CURRENT_TIMESTAMP`,
      )
        .bind(
          clientId,
          driverId,
          typeof payload.started_at === "string"
            ? payload.started_at
            : new Date().toISOString(),
          typeof payload.ended_at === "string" ? payload.ended_at : null,
          numberOrNull(payload.fatigue_score) ?? 0,
          typeof payload.warning_count === "number" ? payload.warning_count : 0,
          typeof payload.critical_event_count === "number"
            ? payload.critical_event_count
            : 0,
          typeof payload.status === "string" ? payload.status : "completed",
        )
        .run();
    } else if (resourceType === "fatigue_event") {
      const clientId = requiredString(payload, "client_id");
      const sessionId = parseId(String(payload.session_id ?? ""));
      if (!sessionId)
        throw new Error("fatigue_event payload requires session_id");
      await env.DB.prepare(
        `INSERT INTO fatigue_events (client_id, session_id, driver_id, level, fatigue_score, blink_rate, yawn_count, event_at, media_key, metadata_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(client_id) DO NOTHING`,
      )
        .bind(
          clientId,
          sessionId,
          driverId,
          requiredString(payload, "level"),
          numberOrNull(payload.fatigue_score),
          numberOrNull(payload.blink_rate),
          typeof payload.yawn_count === "number" ? payload.yawn_count : 0,
          typeof payload.event_at === "string"
            ? payload.event_at
            : new Date().toISOString(),
          typeof payload.media_key === "string" ? payload.media_key : null,
          payload.metadata && typeof payload.metadata === "object"
            ? JSON.stringify(payload.metadata)
            : null,
        )
        .run();
    }
  }
  return response({ synced: operations.length });
}

async function driverHistory(url: URL, env: Env, driverId: number) {
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? 50), 1),
    200,
  );
  const sessions = await env.DB.prepare(
    "SELECT * FROM driving_sessions WHERE driver_id = ? ORDER BY started_at DESC LIMIT ?",
  )
    .bind(driverId, limit)
    .all();
  const advice = await env.DB.prepare(
    "SELECT * FROM ai_advice_history WHERE driver_id = ? ORDER BY created_at DESC LIMIT ?",
  )
    .bind(driverId, limit)
    .all();
  return response({ sessions: sessions.results, advice: advice.results });
}

async function ragSearch(request: Request, env: Env) {
  const body = await readJson(request);
  const query = requiredString(body, "query");
  const topK = Math.min(
    Math.max(Number(body.topK ?? body.limit ?? DEFAULT_RAG_TOP_K), 1),
    20,
  );
  const threshold = Number(body.threshold ?? DEFAULT_RAG_THRESHOLD);
  if (!env.VECTORIZE || !env.AI) {
    return response({ query, source: "d1-fallback", matches: [] });
  }
  const embedding = (await env.AI.run(VECTOR_EMBEDDING_MODEL, {
    text: [query],
  })) as { data?: number[][] };
  const vector = embedding.data?.[0];
  if (!vector) throw new Error("Workers AI did not return an embedding");
  const matches = await env.VECTORIZE.query(vector, {
    topK,
    returnMetadata: true,
  });
  const filtered = selectRelevantChunks(matches.matches ?? [], threshold);
  return response({ query, source: "vectorize", matches: filtered, threshold });
}

async function ingestKnowledgeDocument(request: Request, env: Env) {
  const body = await readJson(request);
  const title = requiredString(body, "title");
  const category = requiredString(body, "category");
  const source = requiredString(body, "source");
  const documentText =
    typeof body.documentText === "string" ? body.documentText : null;
  const fileKey =
    typeof body.fileKey === "string" && body.fileKey.trim().length > 0
      ? body.fileKey.trim()
      : null;
  const bucket = env.KNOWLEDGE;
  if (!bucket) throw new Error("KNOWLEDGE R2 bucket is not configured");
  if (!env.AI || !env.VECTORIZE) {
    throw new Error(
      "AI and VECTORIZE bindings are required for knowledge ingestion",
    );
  }
  if (!documentText && !fileKey)
    throw new Error("documentText or fileKey is required");

  let text = documentText ?? "";
  if (!text && fileKey) {
    const object = await bucket.get(fileKey);
    if (!object) throw new Error("Knowledge document not found in R2");
    text = await object.text();
  }

  const documentId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO rag_documents (id, title, source, file_key, category) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(documentId, title, source, fileKey, category)
    .run();

  const chunks = chunkText(text, { chunkSize: 800, overlap: 120 });
  const vectors: Array<{
    id: string;
    values: number[];
    metadata: Record<string, unknown>;
  }> = [];
  const chunkRows: Array<{
    id: string;
    document_id: string;
    chunk_index: number;
    category: string;
    title: string;
    source: string;
    content: string;
    vector_id: string;
  }> = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const content = chunks[index];
    const chunkId = `${documentId}-${index}`;
    const vectorId = `chunk-${chunkId}`;
    const embeddingResult = (await env.AI.run(VECTOR_EMBEDDING_MODEL, {
      text: [content],
    })) as { data?: number[][] };
    const vector = embeddingResult.data?.[0];
    if (!vector)
      throw new Error(
        "Workers AI did not return an embedding for the document chunk",
      );
    vectors.push({
      id: vectorId,
      values: vector,
      metadata: createVectorMetadata({
        documentId,
        chunkId,
        category,
        title,
        source,
      }),
    });
    chunkRows.push({
      id: chunkId,
      document_id: documentId,
      chunk_index: index,
      category,
      title,
      source,
      content,
      vector_id: vectorId,
    });
  }

  if (vectors.length > 0) {
    await env.VECTORIZE.upsert(vectors);
  }

  for (const row of chunkRows) {
    await env.DB.prepare(
      `INSERT INTO rag_chunks (id, document_id, chunk_index, category, title, source, content, vector_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        row.id,
        row.document_id,
        row.chunk_index,
        row.category,
        row.title,
        row.source,
        row.content,
        row.vector_id,
      )
      .run();
  }

  return response({ success: true, documentId, chunks: chunkRows.length }, 201);
}

async function buildAdviceResponse(data: NormalizedAdviceRequest, env: Env) {
  const query = buildAdviceQuery(data);
  if (!env.AI || !env.VECTORIZE) {
    throw new Error(
      "AI and VECTORIZE bindings are required for RAG advice generation",
    );
  }

  const embedding = (await env.AI.run(VECTOR_EMBEDDING_MODEL, {
    text: [query],
  })) as { data?: number[][] };
  const vector = embedding.data?.[0];
  if (!vector)
    throw new Error(
      "Workers AI did not return an embedding for the advice query",
    );

  const matches = await env.VECTORIZE.query(vector, {
    topK: DEFAULT_RAG_TOP_K,
    returnMetadata: true,
  });
  const relevant = selectRelevantChunks(
    matches.matches ?? [],
    DEFAULT_RAG_THRESHOLD,
  );
  const chunkIds = relevant.map((match) =>
    String(match.metadata?.chunkId ?? match.id),
  );

  let retrievedRows: Array<{
    id: string;
    content: string;
    category: string;
    title: string;
    source: string;
  }> = [];
  if (chunkIds.length > 0) {
    const placeholders = chunkIds.map(() => "?").join(", ");
    const { results } = await env.DB.prepare(
      `SELECT id, content, category, title, source FROM rag_chunks WHERE id IN (${placeholders}) ORDER BY chunk_index ASC`,
    )
      .bind(...chunkIds)
      .all();
    retrievedRows = results as Array<{
      id: string;
      content: string;
      category: string;
      title: string;
      source: string;
    }>;
  }

  const sources = Array.from(
    new Map(
      retrievedRows.map((row) => [
        row.source,
        { title: row.title, category: row.category, source: row.source },
      ]),
    ).values(),
  );
  const context =
    retrievedRows.length > 0
      ? retrievedRows
          .map(
            (row) =>
              `Source: ${row.title}\nCategory: ${row.category}\n${row.content}`,
          )
          .join("\n\n")
      : "No directly relevant safety guidance was retrieved from the knowledge base for this session.";

  const systemPrompt =
    "You are a driver-safety assistant. Base your answer only on the retrieved guidance and the current session facts. Never claim to diagnose a medical condition or certainty about the driver's health. Keep the advice practical, concise, and suitable for a mobile app. Mention key risk indicators only as observed facts. When relevant, recommend a rest break or stopping point. Do not invent sources or guidelines.";
  const userPrompt = `Session facts:\n- sessionId: ${data.sessionId ?? "unknown"}\n- fatigueScore: ${data.fatigueScore}\n- averageFatigueScore: ${data.averageFatigueScore ?? "n/a"}\n- maxFatigueScore: ${data.maxFatigueScore ?? "n/a"}\n- driveDurationMinutes: ${data.driveDurationMinutes ?? "n/a"}\n- prolongedEyeClosureCount: ${data.prolongedEyeClosureCount ?? "n/a"}\n- headNodCount: ${data.headNodCount ?? "n/a"}\n- perclos: ${data.perclos ?? "n/a"}\n\nRetrieved knowledge:\n${context}\n\nProvide brief safety guidance, explicitly separate observed fatigue indicators from recommendations, and keep the final answer under 200 words.`;

  const modelResult = await env.AI.run(LLM_MODEL, {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  const advice =
    extractModelText(modelResult) ??
    "No safety advice could be generated from the retrieved knowledge.";
  const logId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO advice_logs (id, session_id, fatigue_score, query, retrieved_chunk_ids, advice)
         VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      logId,
      data.sessionId,
      data.fatigueScore,
      query,
      JSON.stringify(chunkIds),
      advice,
    )
    .run();

  if (data.driverId !== null) {
    await env.DB.prepare(
      `INSERT INTO ai_advice_history (driver_id, session_id, prompt, advice) VALUES (?, ?, ?, ?)`,
    )
      .bind(data.driverId, null, query, advice)
      .run();
  }

  return {
    advice,
    fatigueScore: data.fatigueScore,
    sessionId: data.sessionId,
    sources,
  };
}

async function onAdviceRequest(request: Request, env: Env) {
  const body = await readJson(request);
  const data = normalizeAdviceRequest(body);
  const result = await buildAdviceResponse(data, env);
  return response(result, 201);
}

async function mediaObject(request: Request, env: Env, key: string) {
  if (!env.MEDIA) return errorResponse("MEDIA binding is not configured", 503);
  if (request.method !== "GET") return errorResponse("Method not allowed", 405);
  const object = await env.MEDIA.get(key);
  if (!object) return errorResponse("Media not found", 404);
  const headers = new Headers(corsHeaders);
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS")
      return new Response(null, { headers: corsHeaders });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health" && request.method === "GET")
        return response({ ok: true });
      if (url.pathname === "/api/advice" && request.method === "POST")
        return await onAdviceRequest(request, env);
      if (url.pathname === "/api/sessions" && request.method === "POST")
        return await createSession(request, env);
      if (url.pathname === "/api/fatigue-events" && request.method === "POST")
        return await createFatigueEvent(request, env);
      if (url.pathname === "/api/sync" && request.method === "POST")
        return await syncOperations(request, env);
      if (url.pathname === "/api/rag/search" && request.method === "POST")
        return await ragSearch(request, env);
      if (url.pathname === "/api/rag/advice" && request.method === "POST")
        return await onAdviceRequest(request, env);
      if (url.pathname === "/api/rag/ingest" && request.method === "POST")
        return await ingestKnowledgeDocument(request, env);
      if (url.pathname === "/api/drivers" && request.method === "POST") {
        const body = await readJson(request);
        const name = requiredString(body, "name");
        const employeeId = requiredString(body, "employee_id");
        await env.DB.prepare(
          "INSERT INTO drivers (name, employee_id, phone) VALUES (?, ?, ?)",
        )
          .bind(
            name,
            employeeId,
            typeof body.phone === "string" ? body.phone : null,
          )
          .run();
        return response({ success: true }, 201);
      }
      if (url.pathname === "/api/fatigue-logs" && request.method === "POST") {
        const body = await readJson(request);
        const driverId = parseId(String(body.driver_id ?? ""));
        if (!driverId) throw new Error("driver_id must be a positive integer");
        await env.DB.prepare(
          `INSERT INTO fatigue_logs (driver_id, fatigue_level, blink_rate, yawn_count, snapshot_url)
                     VALUES (?, ?, ?, ?, ?)`,
        )
          .bind(
            driverId,
            requiredString(body, "fatigue_level"),
            numberOrNull(body.blink_rate),
            typeof body.yawn_count === "number" ? body.yawn_count : 0,
            typeof body.snapshot_url === "string" ? body.snapshot_url : null,
          )
          .run();
        return response({ success: true }, 201);
      }
      const sessionMatch = url.pathname.match(/^\/api\/sessions\/(\d+)$/);
      if (sessionMatch) {
        const sessionId = parseId(sessionMatch[1]);
        if (!sessionId) return errorResponse("Invalid session id", 400);
        if (request.method === "GET") {
          const session = await env.DB.prepare(
            "SELECT * FROM driving_sessions WHERE id = ?",
          )
            .bind(sessionId)
            .first();
          return session
            ? response(session)
            : errorResponse("Session not found", 404);
        }
        if (request.method === "PUT") {
          const body = await readJson(request);
          await env.DB.prepare(
            `UPDATE driving_sessions SET ended_at = COALESCE(?, ended_at), status = COALESCE(?, status),
                         updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          )
            .bind(
              typeof body.ended_at === "string"
                ? body.ended_at
                : new Date().toISOString(),
              typeof body.status === "string" ? body.status : "completed",
              sessionId,
            )
            .run();
          return response(
            await env.DB.prepare("SELECT * FROM driving_sessions WHERE id = ?")
              .bind(sessionId)
              .first(),
          );
        }
      }
      const eventsMatch = url.pathname.match(
        /^\/api\/sessions\/(\d+)\/events$/,
      );
      if (eventsMatch && request.method === "GET") {
        const sessionId = parseId(eventsMatch[1]);
        return sessionId
          ? response(
              (
                await env.DB.prepare(
                  "SELECT * FROM fatigue_events WHERE session_id = ? ORDER BY event_at DESC",
                )
                  .bind(sessionId)
                  .all()
              ).results,
            )
          : errorResponse("Invalid session id", 400);
      }
      const historyMatch = url.pathname.match(
        /^\/api\/drivers\/(\d+)\/history$/,
      );
      if (historyMatch && request.method === "GET") {
        const driverId = parseId(historyMatch[1]);
        return driverId
          ? await driverHistory(url, env, driverId)
          : errorResponse("Invalid driver id", 400);
      }
      const mediaMatch = url.pathname.match(/^\/api\/media\/(.+)$/);
      if (mediaMatch)
        return await mediaObject(
          request,
          env,
          decodeURIComponent(mediaMatch[1]),
        );
      if (url.pathname === "/api/drivers" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT * FROM drivers ORDER BY created_at DESC",
        ).all();
        return response(results);
      }
      return errorResponse("Not found", 404);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Internal server error";
      const status =
        message.includes("required") ||
        message.includes("Invalid") ||
        message.includes("must be") ||
        message.includes("is required")
          ? 400
          : 500;
      return errorResponse(message, status);
    }
  },
};
