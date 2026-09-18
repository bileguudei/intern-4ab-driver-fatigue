interface VectorizeBinding {
    query(vector: number[], options?: { topK?: number; returnMetadata?: boolean }): Promise<{
        matches?: Array<{ id: string; score: number; metadata?: Record<string, unknown> }>;
    }>;
}

interface AiBinding {
    run(model: string, input: { text: string[] } | { messages: Array<{ role: string; content: string }> }): Promise<unknown>;
}

export interface Env {
    DB: D1Database;
    MEDIA?: R2Bucket;
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

function response(body: unknown, status = 200, headers: HeadersInit = corsHeaders) {
    return Response.json(body, { status, headers });
}

function errorResponse(message: string, status: number) {
    return response({ error: message }, status);
}

async function readJson(request: Request): Promise<JsonObject> {
    try {
        const body = await request.json();
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("JSON object required");
        return body as JsonObject;
    } catch {
        throw new Error("Request body must be valid JSON");
    }
}

function requiredString(body: JsonObject, key: string) {
    const value = body[key];
    if (typeof value !== "string" || value.length === 0) throw new Error(`${key} is required`);
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
    const startedAt = typeof body.started_at === "string" ? body.started_at : new Date().toISOString();
    await env.DB.prepare(
        `INSERT INTO driving_sessions (client_id, driver_id, started_at) VALUES (?, ?, ?)
         ON CONFLICT(client_id) DO NOTHING`,
    ).bind(clientId, driverId, startedAt).run();
    const session = await env.DB.prepare("SELECT * FROM driving_sessions WHERE client_id = ?")
        .bind(clientId)
        .first();
    return response(session, 201);
}

async function createFatigueEvent(request: Request, env: Env) {
    const body = await readJson(request);
    const clientId = requiredString(body, "client_id");
    let sessionId = parseId(String(body.session_id ?? ""));
    const sessionClientId = typeof body.session_client_id === "string" ? body.session_client_id : null;
    const driverId = parseId(String(body.driver_id ?? ""));
    const level = requiredString(body, "level");
    if (!sessionId && sessionClientId) {
        const session = await env.DB.prepare("SELECT id FROM driving_sessions WHERE client_id = ?")
            .bind(sessionClientId)
            .first<{ id: number }>();
        sessionId = session?.id ?? null;
    }
    if (!sessionId || !driverId) throw new Error("session_id and driver_id must be positive integers");
    const eventAt = typeof body.event_at === "string" ? body.event_at : new Date().toISOString();
    const metadata = body.metadata && typeof body.metadata === "object" ? JSON.stringify(body.metadata) : null;
    await env.DB.prepare(
        `INSERT INTO fatigue_events
         (client_id, session_id, session_client_id, driver_id, level, fatigue_score, blink_rate, yawn_count, event_at, media_key, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(client_id) DO NOTHING`,
    ).bind(
        clientId,
        sessionId,
        sessionClientId,
        driverId,
        level,
        numberOrNull(body.fatigue_score),
        numberOrNull(body.blink_rate),
        typeof body.yawn_count === "number" ? body.yawn_count : 0,
        eventAt,
        typeof body.media_key === "string" ? body.media_key : null,
        metadata,
    ).run();
    await env.DB.prepare(
        `UPDATE driving_sessions
         SET warning_count = warning_count + ?, critical_event_count = critical_event_count + ?,
             fatigue_score = COALESCE(?, fatigue_score), updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
    ).bind(level === "warning" ? 1 : 0, level === "critical" ? 1 : 0, numberOrNull(body.fatigue_score), sessionId).run();
    const event = await env.DB.prepare("SELECT * FROM fatigue_events WHERE client_id = ?").bind(clientId).first();
    return response(event, 201);
}

async function syncOperations(request: Request, env: Env) {
    const body = await readJson(request);
    const driverId = parseId(String(body.driver_id ?? ""));
    const operations = Array.isArray(body.operations) ? body.operations : [];
    if (!driverId) throw new Error("driver_id must be a positive integer");
    if (operations.length > 100) throw new Error("A maximum of 100 operations can be synced at once");
    for (const operation of operations) {
        if (!operation || typeof operation !== "object") throw new Error("Invalid sync operation");
        const item = operation as JsonObject;
        const operationId = requiredString(item, "operation_id");
        const resourceType = requiredString(item, "resource_type");
        const resourceId = requiredString(item, "resource_id");
        const payload = item.payload && typeof item.payload === "object" ? item.payload as JsonObject : {};
        const alreadySynced = await env.DB.prepare("SELECT id FROM sync_operations WHERE operation_id = ?")
            .bind(operationId)
            .first();
        if (alreadySynced) continue;
        if (resourceType === "session") {
            const clientId = requiredString(payload, "client_id");
            await env.DB.prepare(
                `INSERT INTO driving_sessions (client_id, driver_id, started_at, ended_at, fatigue_score, warning_count, critical_event_count, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(client_id) DO UPDATE SET ended_at = excluded.ended_at,
                 fatigue_score = excluded.fatigue_score, warning_count = excluded.warning_count,
                 critical_event_count = excluded.critical_event_count, status = excluded.status,
                 updated_at = CURRENT_TIMESTAMP`,
            ).bind(
                clientId,
                driverId,
                typeof payload.started_at === "string" ? payload.started_at : new Date().toISOString(),
                typeof payload.ended_at === "string" ? payload.ended_at : null,
                numberOrNull(payload.fatigue_score) ?? 0,
                typeof payload.warning_count === "number" ? payload.warning_count : 0,
                typeof payload.critical_event_count === "number" ? payload.critical_event_count : 0,
                typeof payload.status === "string" ? payload.status : "completed",
            ).run();
        } else if (resourceType === "fatigue_event") {
            const clientId = requiredString(payload, "client_id");
            let sessionId = parseId(String(payload.session_id ?? ""));
            if (!sessionId && typeof payload.session_client_id === "string") {
                const session = await env.DB.prepare("SELECT id FROM driving_sessions WHERE client_id = ?")
                    .bind(payload.session_client_id)
                    .first<{ id: number }>();
                sessionId = session?.id ?? null;
            }
            if (!sessionId) throw new Error("fatigue_event payload requires a synced session_id or session_client_id");
            await env.DB.prepare(
                `INSERT INTO fatigue_events (client_id, session_id, session_client_id, driver_id, level, fatigue_score, blink_rate, yawn_count, event_at, media_key, metadata_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(client_id) DO NOTHING`,
            ).bind(
                clientId,
                sessionId,
                typeof payload.session_client_id === "string" ? payload.session_client_id : null,
                driverId,
                requiredString(payload, "level"),
                numberOrNull(payload.fatigue_score),
                numberOrNull(payload.blink_rate),
                typeof payload.yawn_count === "number" ? payload.yawn_count : 0,
                typeof payload.event_at === "string" ? payload.event_at : new Date().toISOString(),
                typeof payload.media_key === "string" ? payload.media_key : null,
                payload.metadata && typeof payload.metadata === "object" ? JSON.stringify(payload.metadata) : null,
            ).run();
        }
        await env.DB.prepare(
            `INSERT INTO sync_operations (operation_id, driver_id, resource_type, resource_id, payload_json)
             VALUES (?, ?, ?, ?, ?) ON CONFLICT(operation_id) DO NOTHING`,
        ).bind(operationId, driverId, resourceType, resourceId, JSON.stringify(payload)).run();
    }
    return response({ synced: operations.length });
}

async function driverHistory(url: URL, env: Env, driverId: number) {
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50), 1), 200);
    const sessions = await env.DB.prepare(
        "SELECT * FROM driving_sessions WHERE driver_id = ? ORDER BY started_at DESC LIMIT ?",
    ).bind(driverId, limit).all();
    const advice = await env.DB.prepare(
        "SELECT * FROM ai_advice_history WHERE driver_id = ? ORDER BY created_at DESC LIMIT ?",
    ).bind(driverId, limit).all();
    return response({ sessions: sessions.results, advice: advice.results });
}

async function ragSearch(request: Request, env: Env) {
    const body = await readJson(request);
    const query = requiredString(body, "query");
    const limit = Math.min(Math.max(Number(body.limit ?? 5), 1), 20);
    if (!env.VECTORIZE || !env.AI) {
        const history = await env.DB.prepare(
            "SELECT prompt, advice, created_at FROM ai_advice_history WHERE prompt LIKE ? ORDER BY created_at DESC LIMIT ?",
        ).bind(`%${query}%`, limit).all();
        return response({ query, source: "d1-fallback", matches: history.results });
    }
    const embedding = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [query] }) as { data?: number[][] };
    const vector = embedding.data?.[0];
    if (!vector) throw new Error("Workers AI did not return an embedding");
    const matches = await env.VECTORIZE.query(vector, { topK: limit, returnMetadata: true });
    return response({ query, source: "vectorize", matches: matches.matches ?? [] });
}

async function generateAdvice(request: Request, env: Env) {
    const body = await readJson(request);
    const driverId = parseId(String(body.driver_id ?? ""));
    const prompt = requiredString(body, "prompt");
    const sessionId = body.session_id === undefined ? null : parseId(String(body.session_id));
    if (!driverId) throw new Error("driver_id must be a positive integer");
    if (!env.AI) return errorResponse("AI binding is not configured", 503);
    const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [
            { role: "system", content: "You are a concise driver-safety assistant. Give practical fatigue prevention advice." },
            { role: "user", content: prompt },
        ],
    }) as { response?: string };
    const advice = result.response?.trim();
    if (!advice) throw new Error("Workers AI did not return advice");
    await env.DB.prepare("INSERT INTO ai_advice_history (driver_id, session_id, prompt, advice) VALUES (?, ?, ?, ?)")
        .bind(driverId, sessionId, prompt, advice)
        .run();
    return response({ advice }, 201);
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
        if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
        const url = new URL(request.url);
        try {
            if (url.pathname === "/api/health" && request.method === "GET") return response({ ok: true });
            if (url.pathname === "/api/sessions" && request.method === "POST") return await createSession(request, env);
            if (url.pathname === "/api/fatigue-events" && request.method === "POST") return await createFatigueEvent(request, env);
            if (url.pathname === "/api/sync" && request.method === "POST") return await syncOperations(request, env);
            if (url.pathname === "/api/rag/search" && request.method === "POST") return await ragSearch(request, env);
            if (url.pathname === "/api/rag/advice" && request.method === "POST") return await generateAdvice(request, env);
            if (url.pathname === "/api/drivers" && request.method === "POST") {
                const body = await readJson(request);
                const name = requiredString(body, "name");
                const employeeId = requiredString(body, "employee_id");
                await env.DB.prepare("INSERT INTO drivers (name, employee_id, phone) VALUES (?, ?, ?)")
                    .bind(name, employeeId, typeof body.phone === "string" ? body.phone : null)
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
                ).bind(
                    driverId,
                    requiredString(body, "fatigue_level"),
                    numberOrNull(body.blink_rate),
                    typeof body.yawn_count === "number" ? body.yawn_count : 0,
                    typeof body.snapshot_url === "string" ? body.snapshot_url : null,
                ).run();
                return response({ success: true }, 201);
            }
            const sessionMatch = url.pathname.match(/^\/api\/sessions\/(\d+)$/);
            if (sessionMatch) {
                const sessionId = parseId(sessionMatch[1]);
                if (!sessionId) return errorResponse("Invalid session id", 400);
                if (request.method === "GET") {
                    const session = await env.DB.prepare("SELECT * FROM driving_sessions WHERE id = ?").bind(sessionId).first();
                    return session ? response(session) : errorResponse("Session not found", 404);
                }
                if (request.method === "PUT") {
                    const body = await readJson(request);
                    await env.DB.prepare(
                        `UPDATE driving_sessions SET ended_at = COALESCE(?, ended_at), status = COALESCE(?, status),
                         updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                    ).bind(
                        typeof body.ended_at === "string" ? body.ended_at : new Date().toISOString(),
                        typeof body.status === "string" ? body.status : "completed",
                        sessionId,
                    ).run();
                    return response(await env.DB.prepare("SELECT * FROM driving_sessions WHERE id = ?").bind(sessionId).first());
                }
            }
            const eventsMatch = url.pathname.match(/^\/api\/sessions\/(\d+)\/events$/);
            if (eventsMatch && request.method === "GET") {
                const sessionId = parseId(eventsMatch[1]);
                return sessionId
                    ? response((await env.DB.prepare("SELECT * FROM fatigue_events WHERE session_id = ? ORDER BY event_at DESC").bind(sessionId).all()).results)
                    : errorResponse("Invalid session id", 400);
            }
            const historyMatch = url.pathname.match(/^\/api\/drivers\/(\d+)\/history$/);
            if (historyMatch && request.method === "GET") {
                const driverId = parseId(historyMatch[1]);
                return driverId ? await driverHistory(url, env, driverId) : errorResponse("Invalid driver id", 400);
            }
            const mediaMatch = url.pathname.match(/^\/api\/media\/(.+)$/);
            if (mediaMatch) return await mediaObject(request, env, decodeURIComponent(mediaMatch[1]));
            if (url.pathname === "/api/drivers" && request.method === "GET") {
                const { results } = await env.DB.prepare("SELECT * FROM drivers ORDER BY created_at DESC").all();
                return response(results);
            }
            return errorResponse("Not found", 404);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Internal server error";
            const status = message.includes("required") || message.includes("Invalid") || message.includes("must be") ? 400 : 500;
            return errorResponse(message, status);
        }
    },
};