import * as SQLite from 'expo-sqlite';

export type LocalSession = {
    client_id: string;
    driver_id: number;
    started_at: string;
    ended_at: string | null;
    fatigue_score: number;
    warning_count: number;
    critical_event_count: number;
    status: 'active' | 'completed';
    revision: number;
    synced_at: string | null;
    /** Дундаж оноо. Энэ багана нэмэгдэхээс өмнөх сессүүдэд null. */
    avg_score: number | null;
    /** GPS-ээр тооцсон зай, хурд. Хурд хэмжээгүй сессэд null. */
    distance_km: number | null;
    avg_speed_kmh: number | null;
    max_speed_kmh: number | null;
};

const SESSION_COLUMNS = 'client_id, driver_id, started_at, ended_at, fatigue_score, warning_count, critical_event_count, status, revision, synced_at, avg_score, distance_km, avg_speed_kmh, max_speed_kmh';

export type LocalFatigueEvent = {
    client_id: string;
    session_client_id: string;
    driver_id: number;
    level: 'warning' | 'critical';
    fatigue_score: number | null;
    event_at: string;
    metadata_json: string | null;
    synced_at: string | null;
};

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function openDatabase() {
    const database = await SQLite.openDatabaseAsync('driver-fatigue.db');
    await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS drivers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      employee_id TEXT UNIQUE NOT NULL,
      phone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS driving_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT UNIQUE NOT NULL,
      driver_id INTEGER NOT NULL,
      started_at DATETIME NOT NULL,
      ended_at DATETIME,
      fatigue_score REAL DEFAULT 0,
      warning_count INTEGER DEFAULT 0,
      critical_event_count INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      revision INTEGER NOT NULL DEFAULT 0,
      synced_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (driver_id) REFERENCES drivers(id)
    );
    CREATE TABLE IF NOT EXISTS fatigue_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT UNIQUE NOT NULL,
      session_client_id TEXT NOT NULL,
      driver_id INTEGER NOT NULL,
      level TEXT NOT NULL,
      fatigue_score REAL,
      event_at DATETIME NOT NULL,
      metadata_json TEXT,
      synced_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (driver_id) REFERENCES drivers(id),
      FOREIGN KEY (session_client_id) REFERENCES driving_sessions(client_id)
    );
    INSERT OR IGNORE INTO drivers (id, name, employee_id) VALUES (1, 'Local driver', 'local-driver-1');
  `);
    await migrate(database);
    return database;
}

/**
 * Суулгасан апп-ын өгөгдлийн санг `PRAGMA user_version`-оор алхам алхмаар шинэчилнэ.
 * 1: `avg_score` багана нэмнэ. Сервер өмнө нь ядаргааны явдлыг хадгалалгүй
 *    амжилттай гэж буцаадаг байсан тул бүх явдлыг дахин илгээхээр тэмдэглэнэ.
 * 2: зай, дундаж болон дээд хурдны баганууд нэмнэ.
 */
async function migrate(database: SQLite.SQLiteDatabase) {
    let version = (await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
    const addSessionColumn = async (name: string) => {
        const columns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(driving_sessions)');
        if (!columns.some((column) => column.name === name)) {
            await database.execAsync(`ALTER TABLE driving_sessions ADD COLUMN ${name} REAL`);
        }
    };
    if (version < 1) {
        await addSessionColumn('avg_score');
        await database.execAsync('UPDATE fatigue_events SET synced_at = NULL; PRAGMA user_version = 1;');
        version = 1;
    }
    if (version < 2) {
        await addSessionColumn('distance_km');
        await addSessionColumn('avg_speed_kmh');
        await addSessionColumn('max_speed_kmh');
        await database.execAsync('PRAGMA user_version = 2;');
    }
}

export function getLocalDatabase() {
    databasePromise ??= openDatabase();
    return databasePromise;
}

export async function createLocalSession(driverId = 1) {
    const database = await getLocalDatabase();
    const clientId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const startedAt = new Date().toISOString();
    await database.runAsync(
        `INSERT INTO driving_sessions
      (client_id, driver_id, started_at, status, revision, synced_at)
     VALUES (?, ?, ?, 'active', 0, NULL)`,
        clientId,
        driverId,
        startedAt,
    );
    return { clientId, driverId, startedAt };
}

export async function completeLocalSession(clientId: string, summary: { endedAt: string; fatigueScore: number; avgScore: number; warningCount: number; criticalEventCount: number; distanceKm?: number | null; avgSpeedKmh?: number | null; maxSpeedKmh?: number | null }) {
    const database = await getLocalDatabase();
    await database.runAsync(
        `UPDATE driving_sessions
     SET ended_at = ?, fatigue_score = ?, avg_score = ?, warning_count = ?, critical_event_count = ?,
         distance_km = ?, avg_speed_kmh = ?, max_speed_kmh = ?,
         status = 'completed', revision = revision + 1, synced_at = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE client_id = ?`,
        summary.endedAt,
        summary.fatigueScore,
        summary.avgScore,
        summary.warningCount,
        summary.criticalEventCount,
        summary.distanceKm ?? null,
        summary.avgSpeedKmh ?? null,
        summary.maxSpeedKmh ?? null,
        clientId,
    );
}

export async function addLocalFatigueEvent(event: Omit<LocalFatigueEvent, 'synced_at'>) {
    const database = await getLocalDatabase();
    await database.runAsync(
        `INSERT OR IGNORE INTO fatigue_events
      (client_id, session_client_id, driver_id, level, fatigue_score, event_at, metadata_json, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
        event.client_id,
        event.session_client_id,
        event.driver_id,
        event.level,
        event.fatigue_score,
        event.event_at,
        event.metadata_json,
    );
}

export async function getLocalSessions() {
    const database = await getLocalDatabase();
    return database.getAllAsync<LocalSession>(`SELECT ${SESSION_COLUMNS} FROM driving_sessions ORDER BY started_at DESC`);
}

/**
 * Апп жолоодлогын дундуур унах, хаагдахад сесс 'active' хэвээр үлдэж хэзээ ч
 * sync хийгддэггүй байсан. Апп эхлэхэд идэвхтэй жолоодлого байхгүй тул ийм
 * сессийг хадгалагдсан явдлуудаар нь дуусгана.
 */
export async function finalizeAbandonedSessions() {
    const database = await getLocalDatabase();
    await database.runAsync(`
      UPDATE driving_sessions
      SET status = 'completed',
          ended_at = COALESCE((SELECT MAX(event_at) FROM fatigue_events WHERE session_client_id = driving_sessions.client_id), started_at),
          warning_count = (SELECT COUNT(*) FROM fatigue_events WHERE session_client_id = driving_sessions.client_id AND level = 'warning'),
          critical_event_count = (SELECT COUNT(*) FROM fatigue_events WHERE session_client_id = driving_sessions.client_id AND level = 'critical'),
          revision = revision + 1, synced_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE status = 'active'`);
}

export async function getPendingSyncOperations(driverId = 1) {
    const database = await getLocalDatabase();
    const sessions = await database.getAllAsync<LocalSession>(`SELECT ${SESSION_COLUMNS} FROM driving_sessions WHERE synced_at IS NULL AND status = 'completed' ORDER BY started_at ASC`);
    // Сервер явдлыг сессээр нь холбодог тул зөвхөн дууссан сессийн явдлыг илгээнэ.
    const events = await database.getAllAsync<LocalFatigueEvent>(`SELECT e.client_id, e.session_client_id, e.driver_id, e.level, e.fatigue_score, e.event_at, e.metadata_json, e.synced_at
     FROM fatigue_events e JOIN driving_sessions s ON s.client_id = e.session_client_id
     WHERE e.synced_at IS NULL AND s.status = 'completed' ORDER BY e.event_at ASC`);
    return { sessions: sessions.filter((session) => session.driver_id === driverId), events: events.filter((event) => event.driver_id === driverId) };
}

export async function markSynced(clientIds: { sessions: string[]; events: string[] }) {
    const database = await getLocalDatabase();
    const syncedAt = new Date().toISOString();
    await database.withTransactionAsync(async () => {
        for (const clientId of clientIds.sessions) await database.runAsync('UPDATE driving_sessions SET synced_at = ? WHERE client_id = ?', syncedAt, clientId);
        for (const clientId of clientIds.events) await database.runAsync('UPDATE fatigue_events SET synced_at = ? WHERE client_id = ?', syncedAt, clientId);
    });
}
