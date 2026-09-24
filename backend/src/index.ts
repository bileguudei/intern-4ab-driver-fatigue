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
  deleteByIds(ids: string[]): Promise<unknown>;
}

export interface Env {
  DB: D1Database;
  MEDIA?: R2Bucket;
  KNOWLEDGE?: R2Bucket;
  VECTORIZE?: VectorizeBinding;
  GEMINI_API_KEY?: string;
  INGEST_API_KEY?: string;
  APP_API_KEY?: string;
}

type JsonObject = Record<string, unknown>;

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
const corsHeaders = {
  ...jsonHeaders,
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-driver-id",
};

const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
const GEMINI_EMBEDDING_DIMENSIONS = 768;
const GEMINI_LLM_MODEL = "gemini-flash-lite-latest";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_EMBED_BATCH_SIZE = 100;
const DEFAULT_RAG_TOP_K = 5;
const DEFAULT_RAG_THRESHOLD = 0.45;

async function embedTexts(env: Env, texts: string[]): Promise<number[][]> {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  if (texts.length === 0) return [];

  const results: number[][] = [];
  for (let start = 0; start < texts.length; start += GEMINI_EMBED_BATCH_SIZE) {
    const batch = texts.slice(start, start + GEMINI_EMBED_BATCH_SIZE);
    const res = await fetch(
      `${GEMINI_API_BASE}/models/${GEMINI_EMBEDDING_MODEL}:batchEmbedContents?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requests: batch.map((text) => ({
            model: `models/${GEMINI_EMBEDDING_MODEL}`,
            content: { parts: [{ text }] },
            outputDimensionality: GEMINI_EMBEDDING_DIMENSIONS,
          })),
        }),
      },
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Gemini embedding request failed (${res.status}): ${errText}`);
    }
    const data = (await res.json()) as {
      embeddings?: Array<{ values?: number[] }>;
    };
    const embeddings = data.embeddings ?? [];
    if (embeddings.length !== batch.length)
      throw new Error("Gemini embedding response did not match request count");
    for (const item of embeddings) {
      if (!item.values)
        throw new Error("Gemini embedding response missing values");
      results.push(item.values);
    }
  }
  return results;
}

async function generateAdviceText(
  env: Env,
  systemPrompt: string,
  userPrompt: string,
): Promise<string | null> {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const res = await fetch(
    `${GEMINI_API_BASE}/models/${GEMINI_LLM_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      }),
    },
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini generation request failed (${res.status}): ${errText}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();
  return text && text.length > 0 ? text : null;
}

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

/** Хүсэлтийн өгөгдөл буруу үед 500 биш 400 буцаана. */
class ValidationError extends Error {}

/** Апп нэг хүсэлтэд үүнээс ихийг илгээхгүйгээр хувааж илгээнэ (src/data/sync.ts). */
const MAX_SYNC_OPERATIONS = 100;

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
  if (operations.length > MAX_SYNC_OPERATIONS)
    throw new ValidationError(
      `A maximum of ${MAX_SYNC_OPERATIONS} operations can be synced at once`,
    );
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
    // Үйлдлийг нөөц нь амжилттай бичигдсэн үед л, нэг batch-д бүртгэнэ. Өмнө нь
    // эхлээд бүртгэдэг байсан тул алдаа гарсан үйлдэл дараагийн оролдлогод
    // «хийгдсэн» гэж алгасагдаж, өгөгдөл нь хэзээ ч хадгалагддаггүй байв.
    const recordOperation = env.DB.prepare(
      `INSERT INTO sync_operations (operation_id, driver_id, resource_type, resource_id, payload_json)
             VALUES (?, ?, ?, ?, ?) ON CONFLICT(operation_id) DO NOTHING`,
    ).bind(
      operationId,
      driverId,
      resourceType,
      resourceId,
      JSON.stringify(payload),
    );
    if (resourceType === "session") {
      const applied = await env.DB.prepare(
        "SELECT 1 FROM sync_operations WHERE operation_id = ?",
      )
        .bind(operationId)
        .first();
      if (applied) continue;
      const clientId = requiredString(payload, "client_id");
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO driving_sessions (client_id, driver_id, started_at, ended_at, fatigue_score, warning_count, critical_event_count, status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(client_id) DO UPDATE SET ended_at = excluded.ended_at,
                   fatigue_score = excluded.fatigue_score, warning_count = excluded.warning_count,
                   critical_event_count = excluded.critical_event_count, status = excluded.status,
                   updated_at = CURRENT_TIMESTAMP`,
        ).bind(
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
        ),
        recordOperation,
      ]);
    } else if (resourceType === "fatigue_event") {
      // Явдал client_id-аараа давхардахгүй тул дахин илгээхэд аюулгүй. Тиймээс
      // sync_operations-ийг шалгахгүй. Ингэснээр өмнө нь бүртгэгдсэн ч
      // хадгалагдаагүй үлдсэн явдлууд дахин илгээхэд сэргэнэ.
      const clientId = requiredString(payload, "client_id");
      const session = await findEventSession(env, driverId, payload);
      if (!session)
        throw new ValidationError(
          `Invalid fatigue_event ${clientId}: unknown session`,
        );
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO fatigue_events (client_id, session_id, session_client_id, driver_id, level, fatigue_score, blink_rate, yawn_count, event_at, media_key, metadata_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(client_id) DO NOTHING`,
        ).bind(
          clientId,
          session.id,
          session.client_id,
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
        ),
        recordOperation,
      ]);
    } else {
      await recordOperation.run();
    }
  }
  return response({ synced: operations.length });
}

/**
 * Явдлын сессийг олно. Апп сессийг зөвхөн өөрийн client_id-аар мэддэг тул
 * `session_client_id`-г үндсэн гэж үзэж, серверийн `session_id`-г нөөц болгоно.
 */
async function findEventSession(
  env: Env,
  driverId: number,
  payload: JsonObject,
) {
  if (
    typeof payload.session_client_id === "string" &&
    payload.session_client_id.length > 0
  ) {
    return env.DB.prepare(
      "SELECT id, client_id FROM driving_sessions WHERE client_id = ? AND driver_id = ?",
    )
      .bind(payload.session_client_id, driverId)
      .first<{ id: number; client_id: string }>();
  }
  const sessionId = parseId(String(payload.session_id ?? ""));
  if (!sessionId) return null;
  return env.DB.prepare(
    "SELECT id, client_id FROM driving_sessions WHERE id = ? AND driver_id = ?",
  )
    .bind(sessionId, driverId)
    .first<{ id: number; client_id: string }>();
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
  const rawTopK = Number(body.topK ?? body.limit ?? DEFAULT_RAG_TOP_K);
  const topK = Math.min(
    Math.max(Number.isFinite(rawTopK) ? rawTopK : DEFAULT_RAG_TOP_K, 1),
    20,
  );
  const rawThreshold = Number(body.threshold ?? DEFAULT_RAG_THRESHOLD);
  const threshold = Number.isFinite(rawThreshold)
    ? rawThreshold
    : DEFAULT_RAG_THRESHOLD;
  if (!env.VECTORIZE || !env.GEMINI_API_KEY) {
    return response({ query, source: "d1-fallback", matches: [] });
  }
  const [vector] = await embedTexts(env, [query]);
  if (!vector) throw new Error("Gemini did not return an embedding");
  const matches = await env.VECTORIZE.query(vector, {
    topK,
    returnMetadata: true,
  });
  const filtered = selectRelevantChunks(matches.matches ?? [], threshold);
  return response({ query, source: "vectorize", matches: filtered, threshold });
}

async function ingestKnowledgeDocument(request: Request, env: Env) {
  if (!env.INGEST_API_KEY)
    throw new Error("INGEST_API_KEY is not configured; refusing to ingest");
  const authHeader = request.headers.get("authorization") ?? "";
  const providedKey = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";
  if (providedKey !== env.INGEST_API_KEY)
    return errorResponse("Unauthorized", 401);

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
  if (!env.GEMINI_API_KEY || !env.VECTORIZE) {
    throw new Error(
      "GEMINI_API_KEY and VECTORIZE are required for knowledge ingestion",
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

  // Ижил source-той хуучин баримт байвал эхлээд түүнийг хасна — эс тэгвээс
  // шинэчилж дахин ingest хийх бүрд хуучин, шинэ chunk хамт давхцаж үлдэнэ.
  const staleDocuments = await env.DB.prepare(
    "SELECT id FROM rag_documents WHERE source = ?",
  )
    .bind(source)
    .all<{ id: string }>();
  for (const stale of staleDocuments.results) {
    const staleChunks = await env.DB.prepare(
      "SELECT vector_id FROM rag_chunks WHERE document_id = ?",
    )
      .bind(stale.id)
      .all<{ vector_id: string }>();
    const staleVectorIds = staleChunks.results.map((row) => row.vector_id);
    if (staleVectorIds.length > 0 && env.VECTORIZE) {
      await env.VECTORIZE.deleteByIds(staleVectorIds);
    }
    await env.DB.batch([
      env.DB.prepare("DELETE FROM rag_chunks WHERE document_id = ?").bind(
        stale.id,
      ),
      env.DB.prepare("DELETE FROM rag_documents WHERE id = ?").bind(stale.id),
    ]);
  }

  const documentId = crypto.randomUUID();
  const chunks = chunkText(text, { chunkSize: 800, overlap: 120 });
  if (chunks.length === 0)
    throw new Error("Document text is empty after chunking");

  // Эмбеддинг тооцоолсны дараа л D1/Vectorize-д бичнэ — эс тэгвээс Gemini
  // дуудлага бүтэлгүйтвэл агуулгагүй "сүнс" баримт rag_documents-д үлддэг.
  const chunkEmbeddings = await embedTexts(env, chunks);

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
    const vector = chunkEmbeddings[index];
    if (!vector)
      throw new Error(
        "Gemini did not return an embedding for the document chunk",
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

  await env.DB.prepare(
    "INSERT INTO rag_documents (id, title, source, file_key, category) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(documentId, title, source, fileKey, category)
    .run();

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
  if (!env.GEMINI_API_KEY || !env.VECTORIZE) {
    throw new Error(
      "GEMINI_API_KEY and VECTORIZE are required for RAG advice generation",
    );
  }

  const [vector] = await embedTexts(env, [query]);
  if (!vector)
    throw new Error("Gemini did not return an embedding for the advice query");

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
    "You are a driver-safety assistant. Base your answer only on the retrieved guidance and the current session facts. Never claim to diagnose a medical condition or certainty about the driver's health. Keep the advice practical, concise, and suitable for a mobile app. Mention key risk indicators only as observed facts. When relevant, recommend a rest break or stopping point. Do not invent sources or guidelines. Always respond in Mongolian (Cyrillic script), regardless of the language of the retrieved knowledge or session facts.";
  const userPrompt = `Session facts:\n- sessionId: ${data.sessionId ?? "unknown"}\n- fatigueScore: ${data.fatigueScore}\n- averageFatigueScore: ${data.averageFatigueScore ?? "n/a"}\n- maxFatigueScore: ${data.maxFatigueScore ?? "n/a"}\n- driveDurationMinutes: ${data.driveDurationMinutes ?? "n/a"}\n- prolongedEyeClosureCount: ${data.prolongedEyeClosureCount ?? "n/a"}\n- headNodCount: ${data.headNodCount ?? "n/a"}\n- perclos: ${data.perclos ?? "n/a"}\n\nRetrieved knowledge:\n${context}\n\nProvide brief safety guidance in Mongolian, explicitly separate observed fatigue indicators from recommendations, and keep the final answer under 200 words.`;

  const advice =
    (await generateAdviceText(env, systemPrompt, userPrompt)) ??
    "Хадгалагдсан мэдлэгийн сангаас зөвлөгөө үүсгэж чадсангүй.";
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
    let resolvedSessionId: number | null = null;
    if (data.sessionId !== null) {
      const session = await env.DB.prepare(
        "SELECT id FROM driving_sessions WHERE client_id = ?",
      )
        .bind(data.sessionId)
        .first<{ id: number }>();
      resolvedSessionId = session?.id ?? null;
    }
    await env.DB.prepare(
      `INSERT INTO ai_advice_history (driver_id, session_id, prompt, advice) VALUES (?, ?, ?, ?)`,
    )
      .bind(data.driverId, resolvedSessionId, query, advice)
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

      // /api/rag/ingest хамгаалдаг өөрийн (INGEST_API_KEY) шалгалттай тул энд
      // давхар шаардахгүй. Бусад бүх endpoint энэ апп-ын нэгдсэн key-г шаардана —
      // энэ нь тухайн жолоочийг мэдэгддэггүй, зөвхөн энэ манай апп мөн гэдгийг
      // баталгаажуулна (mobile apps дотор орсон key нь bundle-с задалж авах
      // боломжтой тул зөвхөн санамсаргүй/олон нийтийн хандалтаас хамгаална).
      if (url.pathname !== "/api/rag/ingest") {
        if (!env.APP_API_KEY)
          throw new Error("APP_API_KEY is not configured; refusing all requests");
        const authHeader = request.headers.get("authorization") ?? "";
        const providedKey = authHeader.startsWith("Bearer ")
          ? authHeader.slice("Bearer ".length)
          : "";
        if (providedKey !== env.APP_API_KEY)
          return errorResponse("Unauthorized", 401);
      }

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
        error instanceof ValidationError ||
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
