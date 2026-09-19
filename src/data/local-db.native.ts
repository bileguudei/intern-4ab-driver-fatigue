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
};

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
    return database;
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

export async function completeLocalSession(clientId: string, summary: { endedAt: string; fatigueScore: number; warningCount: number; criticalEventCount: number }) {
    const database = await getLocalDatabase();
    await database.runAsync(
        `UPDATE driving_sessions
     SET ended_at = ?, fatigue_score = ?, warning_count = ?, critical_event_count = ?,
         status = 'completed', revision = revision + 1, synced_at = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE client_id = ?`,
        summary.endedAt,
        summary.fatigueScore,
        summary.warningCount,
        summary.criticalEventCount,
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
    return database.getAllAsync<LocalSession>('SELECT client_id, driver_id, started_at, ended_at, fatigue_score, warning_count, critical_event_count, status, revision, synced_at FROM driving_sessions ORDER BY started_at DESC');
}

export async function getPendingSyncOperations(driverId = 1) {
    const database = await getLocalDatabase();
    const sessions = await database.getAllAsync<LocalSession>("SELECT client_id, driver_id, started_at, ended_at, fatigue_score, warning_count, critical_event_count, status, revision, synced_at FROM driving_sessions WHERE synced_at IS NULL AND status = 'completed' ORDER BY started_at ASC");
    const events = await database.getAllAsync<LocalFatigueEvent>('SELECT client_id, session_client_id, driver_id, level, fatigue_score, event_at, metadata_json, synced_at FROM fatigue_events WHERE synced_at IS NULL ORDER BY event_at ASC');
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
