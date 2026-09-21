var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.ts
var jsonHeaders = { "content-type": "application/json; charset=utf-8" };
var corsHeaders = {
  ...jsonHeaders,
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-driver-id"
};
function response(body, status = 200, headers = corsHeaders) {
  return Response.json(body, { status, headers });
}
__name(response, "response");
function errorResponse(message, status) {
  return response({ error: message }, status);
}
__name(errorResponse, "errorResponse");
async function readJson(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("JSON object required");
    return body;
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}
__name(readJson, "readJson");
function requiredString(body, key) {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${key} is required`);
  return value;
}
__name(requiredString, "requiredString");
function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
__name(numberOrNull, "numberOrNull");
function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}
__name(parseId, "parseId");
async function createSession(request, env) {
  const body = await readJson(request);
  const clientId = requiredString(body, "client_id");
  const driverId = parseId(String(body.driver_id ?? ""));
  if (!driverId) throw new Error("driver_id must be a positive integer");
  const startedAt = typeof body.started_at === "string" ? body.started_at : (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(
    `INSERT INTO driving_sessions (client_id, driver_id, started_at) VALUES (?, ?, ?)
         ON CONFLICT(client_id) DO NOTHING`
  ).bind(clientId, driverId, startedAt).run();
  const session = await env.DB.prepare("SELECT * FROM driving_sessions WHERE client_id = ?").bind(clientId).first();
  return response(session, 201);
}
__name(createSession, "createSession");
async function createFatigueEvent(request, env) {
  const body = await readJson(request);
  const clientId = requiredString(body, "client_id");
  let sessionId = parseId(String(body.session_id ?? ""));
  const sessionClientId = typeof body.session_client_id === "string" ? body.session_client_id : null;
  const driverId = parseId(String(body.driver_id ?? ""));
  const level = requiredString(body, "level");
  if (!sessionId && sessionClientId) {
    const session = await env.DB.prepare("SELECT id FROM driving_sessions WHERE client_id = ?").bind(sessionClientId).first();
    sessionId = session?.id ?? null;
  }
  if (!sessionId || !driverId) throw new Error("session_id and driver_id must be positive integers");
  const eventAt = typeof body.event_at === "string" ? body.event_at : (/* @__PURE__ */ new Date()).toISOString();
  const metadata = body.metadata && typeof body.metadata === "object" ? JSON.stringify(body.metadata) : null;
  await env.DB.prepare(
    `INSERT INTO fatigue_events
         (client_id, session_id, session_client_id, driver_id, level, fatigue_score, blink_rate, yawn_count, event_at, media_key, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(client_id) DO NOTHING`
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
    metadata
  ).run();
  await env.DB.prepare(
    `UPDATE driving_sessions
         SET warning_count = warning_count + ?, critical_event_count = critical_event_count + ?,
             fatigue_score = COALESCE(?, fatigue_score), updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
  ).bind(level === "warning" ? 1 : 0, level === "critical" ? 1 : 0, numberOrNull(body.fatigue_score), sessionId).run();
  const event = await env.DB.prepare("SELECT * FROM fatigue_events WHERE client_id = ?").bind(clientId).first();
  return response(event, 201);
}
__name(createFatigueEvent, "createFatigueEvent");
async function syncOperations(request, env) {
  const body = await readJson(request);
  const driverId = parseId(String(body.driver_id ?? ""));
  const operations = Array.isArray(body.operations) ? body.operations : [];
  if (!driverId) throw new Error("driver_id must be a positive integer");
  if (operations.length > 100) throw new Error("A maximum of 100 operations can be synced at once");
  for (const operation of operations) {
    if (!operation || typeof operation !== "object") throw new Error("Invalid sync operation");
    const item = operation;
    const operationId = requiredString(item, "operation_id");
    const resourceType = requiredString(item, "resource_type");
    const resourceId = requiredString(item, "resource_id");
    const payload = item.payload && typeof item.payload === "object" ? item.payload : {};
    const alreadySynced = await env.DB.prepare("SELECT id FROM sync_operations WHERE operation_id = ?").bind(operationId).first();
    if (alreadySynced) continue;
    if (resourceType === "session") {
      const clientId = requiredString(payload, "client_id");
      await env.DB.prepare(
        `INSERT INTO driving_sessions (client_id, driver_id, started_at, ended_at, fatigue_score, warning_count, critical_event_count, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(client_id) DO UPDATE SET ended_at = excluded.ended_at,
                 fatigue_score = excluded.fatigue_score, warning_count = excluded.warning_count,
                 critical_event_count = excluded.critical_event_count, status = excluded.status,
                 updated_at = CURRENT_TIMESTAMP`
      ).bind(
        clientId,
        driverId,
        typeof payload.started_at === "string" ? payload.started_at : (/* @__PURE__ */ new Date()).toISOString(),
        typeof payload.ended_at === "string" ? payload.ended_at : null,
        numberOrNull(payload.fatigue_score) ?? 0,
        typeof payload.warning_count === "number" ? payload.warning_count : 0,
        typeof payload.critical_event_count === "number" ? payload.critical_event_count : 0,
        typeof payload.status === "string" ? payload.status : "completed"
      ).run();
    } else if (resourceType === "fatigue_event") {
      const clientId = requiredString(payload, "client_id");
      let sessionId = parseId(String(payload.session_id ?? ""));
      if (!sessionId && typeof payload.session_client_id === "string") {
        const session = await env.DB.prepare("SELECT id FROM driving_sessions WHERE client_id = ?").bind(payload.session_client_id).first();
        sessionId = session?.id ?? null;
      }
      if (!sessionId) throw new Error("fatigue_event payload requires a synced session_id or session_client_id");
      await env.DB.prepare(
        `INSERT INTO fatigue_events (client_id, session_id, session_client_id, driver_id, level, fatigue_score, blink_rate, yawn_count, event_at, media_key, metadata_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(client_id) DO NOTHING`
      ).bind(
        clientId,
        sessionId,
        typeof payload.session_client_id === "string" ? payload.session_client_id : null,
        driverId,
        requiredString(payload, "level"),
        numberOrNull(payload.fatigue_score),
        numberOrNull(payload.blink_rate),
        typeof payload.yawn_count === "number" ? payload.yawn_count : 0,
        typeof payload.event_at === "string" ? payload.event_at : (/* @__PURE__ */ new Date()).toISOString(),
        typeof payload.media_key === "string" ? payload.media_key : null,
        payload.metadata && typeof payload.metadata === "object" ? JSON.stringify(payload.metadata) : null
      ).run();
    }
    await env.DB.prepare(
      `INSERT INTO sync_operations (operation_id, driver_id, resource_type, resource_id, payload_json)
             VALUES (?, ?, ?, ?, ?) ON CONFLICT(operation_id) DO NOTHING`
    ).bind(operationId, driverId, resourceType, resourceId, JSON.stringify(payload)).run();
  }
  return response({ synced: operations.length });
}
__name(syncOperations, "syncOperations");
async function driverHistory(url, env, driverId) {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50), 1), 200);
  const sessions = await env.DB.prepare(
    "SELECT * FROM driving_sessions WHERE driver_id = ? ORDER BY started_at DESC LIMIT ?"
  ).bind(driverId, limit).all();
  const advice = await env.DB.prepare(
    "SELECT * FROM ai_advice_history WHERE driver_id = ? ORDER BY created_at DESC LIMIT ?"
  ).bind(driverId, limit).all();
  return response({ sessions: sessions.results, advice: advice.results });
}
__name(driverHistory, "driverHistory");
async function ragSearch(request, env) {
  const body = await readJson(request);
  const query = requiredString(body, "query");
  const limit = Math.min(Math.max(Number(body.limit ?? 5), 1), 20);
  if (!env.VECTORIZE || !env.AI) {
    const history = await env.DB.prepare(
      "SELECT prompt, advice, created_at FROM ai_advice_history WHERE prompt LIKE ? ORDER BY created_at DESC LIMIT ?"
    ).bind(`%${query}%`, limit).all();
    return response({ query, source: "d1-fallback", matches: history.results });
  }
  const embedding = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [query] });
  const vector = embedding.data?.[0];
  if (!vector) throw new Error("Workers AI did not return an embedding");
  const matches = await env.VECTORIZE.query(vector, { topK: limit, returnMetadata: true });
  return response({ query, source: "vectorize", matches: matches.matches ?? [] });
}
__name(ragSearch, "ragSearch");
async function generateAdvice(request, env) {
  const body = await readJson(request);
  const driverId = parseId(String(body.driver_id ?? ""));
  const prompt = requiredString(body, "prompt");
  const sessionId = body.session_id === void 0 ? null : parseId(String(body.session_id));
  if (!driverId) throw new Error("driver_id must be a positive integer");
  if (!env.AI) return errorResponse("AI binding is not configured", 503);
  const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
    messages: [
      { role: "system", content: "You are a concise driver-safety assistant. Give practical fatigue prevention advice." },
      { role: "user", content: prompt }
    ]
  });
  const advice = result.response?.trim();
  if (!advice) throw new Error("Workers AI did not return advice");
  await env.DB.prepare("INSERT INTO ai_advice_history (driver_id, session_id, prompt, advice) VALUES (?, ?, ?, ?)").bind(driverId, sessionId, prompt, advice).run();
  return response({ advice }, 201);
}
__name(generateAdvice, "generateAdvice");
async function mediaObject(request, env, key) {
  if (!env.MEDIA) return errorResponse("MEDIA binding is not configured", 503);
  if (request.method !== "GET") return errorResponse("Method not allowed", 405);
  const object = await env.MEDIA.get(key);
  if (!object) return errorResponse("Media not found", 404);
  const headers = new Headers(corsHeaders);
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
}
__name(mediaObject, "mediaObject");
var src_default = {
  async fetch(request, env) {
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
        await env.DB.prepare("INSERT INTO drivers (name, employee_id, phone) VALUES (?, ?, ?)").bind(name, employeeId, typeof body.phone === "string" ? body.phone : null).run();
        return response({ success: true }, 201);
      }
      if (url.pathname === "/api/fatigue-logs" && request.method === "POST") {
        const body = await readJson(request);
        const driverId = parseId(String(body.driver_id ?? ""));
        if (!driverId) throw new Error("driver_id must be a positive integer");
        await env.DB.prepare(
          `INSERT INTO fatigue_logs (driver_id, fatigue_level, blink_rate, yawn_count, snapshot_url)
                     VALUES (?, ?, ?, ?, ?)`
        ).bind(
          driverId,
          requiredString(body, "fatigue_level"),
          numberOrNull(body.blink_rate),
          typeof body.yawn_count === "number" ? body.yawn_count : 0,
          typeof body.snapshot_url === "string" ? body.snapshot_url : null
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
                         updated_at = CURRENT_TIMESTAMP WHERE id = ?`
          ).bind(
            typeof body.ended_at === "string" ? body.ended_at : (/* @__PURE__ */ new Date()).toISOString(),
            typeof body.status === "string" ? body.status : "completed",
            sessionId
          ).run();
          return response(await env.DB.prepare("SELECT * FROM driving_sessions WHERE id = ?").bind(sessionId).first());
        }
      }
      const eventsMatch = url.pathname.match(/^\/api\/sessions\/(\d+)\/events$/);
      if (eventsMatch && request.method === "GET") {
        const sessionId = parseId(eventsMatch[1]);
        return sessionId ? response((await env.DB.prepare("SELECT * FROM fatigue_events WHERE session_id = ? ORDER BY event_at DESC").bind(sessionId).all()).results) : errorResponse("Invalid session id", 400);
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
  }
};

// ../node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-kxoIOW/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-kxoIOW/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
