import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";

import worker, { type Env } from "./index";

type Row = Record<string, unknown>;

/** D1-ийн ашиглагдаж буй хэсгийг bun:sqlite дээр дуурайлгана. */
function createD1(schema: string) {
  const db = new Database(":memory:");
  db.exec(schema);

  class Statement {
    constructor(
      readonly sql: string,
      readonly params: unknown[] = [],
    ) {}
    bind(...params: unknown[]) {
      return new Statement(this.sql, params);
    }
    runSync() {
      const result = db.query(this.sql).run(...(this.params as never[]));
      return { meta: { changes: result.changes } };
    }
    async run() {
      return this.runSync();
    }
    async first() {
      return (db.query(this.sql).get(...(this.params as never[])) as Row | null) ?? null;
    }
    async all() {
      return { results: db.query(this.sql).all(...(this.params as never[])) as Row[] };
    }
  }

  const d1 = {
    prepare: (sql: string) => new Statement(sql),
    batch: async (statements: Statement[]) =>
      db.transaction(() => statements.map((statement) => statement.runSync()))(),
  };
  return { d1, db };
}

const schema = await Bun.file(new URL("../schema.sql", import.meta.url)).text();

let db: Database;
let env: Env;

beforeEach(() => {
  const created = createD1(schema);
  db = created.db;
  env = { DB: created.d1 } as unknown as Env;
});

function sync(operations: unknown[]) {
  return worker.fetch(
    new Request("http://localhost/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ driver_id: 1, operations }),
    }),
    env,
  );
}

/** Апп-ын src/data/sync.ts-ийн илгээдэг хэлбэр. */
const sessionOperation = {
  operation_id: "session:session-a:1",
  resource_type: "session",
  resource_id: "session-a",
  payload: {
    client_id: "session-a",
    driver_id: 1,
    started_at: "2026-09-23T01:00:00.000Z",
    ended_at: "2026-09-23T01:30:00.000Z",
    fatigue_score: 72,
    warning_count: 1,
    critical_event_count: 1,
    status: "completed",
    revision: 1,
  },
};

const eventOperation = (id: string, level: "warning" | "critical") => ({
  operation_id: `fatigue_event:event:${id}`,
  resource_type: "fatigue_event",
  resource_id: `event:${id}`,
  payload: {
    client_id: `event:${id}`,
    session_client_id: "session-a",
    driver_id: 1,
    level,
    fatigue_score: null,
    event_at: "2026-09-23T01:10:00.000Z",
  },
});

const storedEvents = () =>
  db
    .query(
      "SELECT e.client_id, e.level, e.session_client_id, e.session_id = s.id AS linked FROM fatigue_events e JOIN driving_sessions s ON s.client_id = 'session-a' ORDER BY e.client_id",
    )
    .all();

describe("POST /api/sync", () => {
  it("апп-ын илгээсэн явдлыг сесстэй нь холбож хадгална", async () => {
    const response = await sync([sessionOperation, eventOperation("e1", "warning"), eventOperation("e2", "critical")]);

    expect(response.status).toBe(200);
    expect(storedEvents()).toEqual([
      { client_id: "event:e1", level: "warning", session_client_id: "session-a", linked: 1 },
      { client_id: "event:e2", level: "critical", session_client_id: "session-a", linked: 1 },
    ]);
  });

  it("ижил үйлдлийг дахин илгээхэд давхардуулахгүй", async () => {
    const operations = [sessionOperation, eventOperation("e1", "warning")];
    await sync(operations);
    const response = await sync(operations);

    expect(response.status).toBe(200);
    expect(storedEvents()).toHaveLength(1);
  });

  it("өмнө нь бүртгэгдсэн ч хадгалагдаагүй явдлыг дахин илгээхэд хадгална", async () => {
    await sync([sessionOperation]);
    // Хуучин хувилбар үйлдлийг бүртгээд явдлыг хадгалалгүй алгасдаг байсан.
    db.query(
      "INSERT INTO sync_operations (operation_id, driver_id, resource_type, resource_id, payload_json) VALUES (?, 1, 'fatigue_event', 'event:e1', '{}')",
    ).run("fatigue_event:event:e1");

    const response = await sync([eventOperation("e1", "warning")]);

    expect(response.status).toBe(200);
    expect(storedEvents()).toHaveLength(1);
  });

  it("үл мэдэгдэх сессийн явдлыг 400-аар татгалзаж, үйлдлийг бүртгэхгүй", async () => {
    const response = await sync([eventOperation("e1", "warning")]);

    expect(response.status).toBe(400);
    expect(db.query("SELECT COUNT(*) AS count FROM sync_operations").get()).toEqual({ count: 0 });
  });

  it("100-аас олон үйлдлийг 400-аар татгалзана", async () => {
    const operations = Array.from({ length: 101 }, (_, index) => eventOperation(`e${index}`, "warning"));
    const response = await sync(operations);

    expect(response.status).toBe(400);
  });
});
