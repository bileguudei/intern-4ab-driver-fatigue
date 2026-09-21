CREATE TABLE IF NOT EXISTS drivers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    employee_id TEXT UNIQUE NOT NULL,
    phone TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO drivers (id, name, employee_id)
VALUES (1, 'Local driver', 'local-driver-1');

CREATE TABLE IF NOT EXISTS fatigue_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_id INTEGER NOT NULL,
    fatigue_level TEXT NOT NULL,
    blink_rate REAL,
    yawn_count INTEGER DEFAULT 0,
    snapshot_url TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (driver_id) REFERENCES drivers(id)
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (driver_id) REFERENCES drivers(id)
);

CREATE TABLE IF NOT EXISTS fatigue_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT UNIQUE NOT NULL,
    session_id INTEGER,
    session_client_id TEXT,
    driver_id INTEGER NOT NULL,
    level TEXT NOT NULL,
    fatigue_score REAL,
    blink_rate REAL,
    yawn_count INTEGER DEFAULT 0,
    event_at DATETIME NOT NULL,
    media_key TEXT,
    metadata_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES driving_sessions(id),
    FOREIGN KEY (driver_id) REFERENCES drivers(id)
);

CREATE TABLE IF NOT EXISTS sync_operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id TEXT UNIQUE NOT NULL,
    driver_id INTEGER NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (driver_id) REFERENCES drivers(id)
);

CREATE TABLE IF NOT EXISTS ai_advice_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_id INTEGER NOT NULL,
    session_id INTEGER,
    prompt TEXT NOT NULL,
    advice TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (driver_id) REFERENCES drivers(id),
    FOREIGN KEY (session_id) REFERENCES driving_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_driver_started
    ON driving_sessions(driver_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_session_time
    ON fatigue_events(session_id, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_driver_time
    ON fatigue_events(driver_id, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_driver_time
    ON sync_operations(driver_id, id);