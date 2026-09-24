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
    /** Дундаж оноо. Энэ талбар нэмэгдэхээс өмнөх сессүүдэд null. */
    avg_score: number | null;
    /** GPS-ээр тооцсон зай, хурд. Хурд хэмжээгүй сессэд null. */
    distance_km: number | null;
    avg_speed_kmh: number | null;
    max_speed_kmh: number | null;
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

type WebStore = { sessions: LocalSession[]; events: LocalFatigueEvent[] };
const storageKey = 'driver-fatigue-local-db';
let memoryStore: WebStore = { sessions: [], events: [] };

function readStore(): WebStore {
    if (typeof localStorage === 'undefined') return memoryStore;
    try {
        const value = localStorage.getItem(storageKey);
        return value ? JSON.parse(value) as WebStore : memoryStore;
    } catch {
        return memoryStore;
    }
}

function writeStore(store: WebStore) {
    memoryStore = store;
    if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey, JSON.stringify(store));
}

export function getLocalDatabase() {
    return Promise.resolve(null);
}

export async function createLocalSession(driverId = 1) {
    const store = readStore();
    const clientId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const startedAt = new Date().toISOString();
    store.sessions.unshift({ client_id: clientId, driver_id: driverId, started_at: startedAt, ended_at: null, fatigue_score: 0, warning_count: 0, critical_event_count: 0, status: 'active', revision: 0, synced_at: null, avg_score: null, distance_km: null, avg_speed_kmh: null, max_speed_kmh: null });
    writeStore(store);
    return { clientId, driverId, startedAt };
}

export async function completeLocalSession(clientId: string, summary: { endedAt: string; fatigueScore: number; avgScore: number; warningCount: number; criticalEventCount: number; distanceKm?: number | null; avgSpeedKmh?: number | null; maxSpeedKmh?: number | null }) {
    const store = readStore();
    const session = store.sessions.find((item) => item.client_id === clientId);
    if (!session) return;
    Object.assign(session, { ended_at: summary.endedAt, fatigue_score: summary.fatigueScore, avg_score: summary.avgScore, warning_count: summary.warningCount, critical_event_count: summary.criticalEventCount, distance_km: summary.distanceKm ?? null, avg_speed_kmh: summary.avgSpeedKmh ?? null, max_speed_kmh: summary.maxSpeedKmh ?? null, status: 'completed', revision: session.revision + 1, synced_at: null });
    writeStore(store);
}

export async function addLocalFatigueEvent(event: Omit<LocalFatigueEvent, 'synced_at'>) {
    const store = readStore();
    if (!store.events.some((item) => item.client_id === event.client_id)) store.events.push({ ...event, synced_at: null });
    writeStore(store);
}

export async function getLocalSessions() {
    return readStore().sessions.map((session) => ({
        ...session,
        avg_score: session.avg_score ?? null,
        distance_km: session.distance_km ?? null,
        avg_speed_kmh: session.avg_speed_kmh ?? null,
        max_speed_kmh: session.max_speed_kmh ?? null,
    }));
}

export async function getLocalSessionEvents(sessionClientId: string) {
    return readStore()
        .events.filter((event) => event.session_client_id === sessionClientId)
        .sort((a, b) => a.event_at.localeCompare(b.event_at));
}

/** local-db.native.ts-ийн адил: дуусаагүй үлдсэн сессийг явдлуудаар нь дуусгана. */
export async function finalizeAbandonedSessions() {
    const store = readStore();
    for (const session of store.sessions) {
        if (session.status !== 'active') continue;
        const events = store.events.filter((event) => event.session_client_id === session.client_id);
        const lastEventAt = events.map((event) => event.event_at).sort().at(-1);
        Object.assign(session, {
            status: 'completed',
            ended_at: lastEventAt ?? session.started_at,
            warning_count: events.filter((event) => event.level === 'warning').length,
            critical_event_count: events.filter((event) => event.level === 'critical').length,
            revision: session.revision + 1,
            synced_at: null,
        });
    }
    writeStore(store);
}

export async function getPendingSyncOperations(driverId = 1) {
    const store = readStore();
    const completed = new Set(store.sessions.filter((session) => session.status === 'completed').map((session) => session.client_id));
    return {
        sessions: store.sessions.filter((session) => session.driver_id === driverId && session.status === 'completed' && session.synced_at === null),
        events: store.events.filter((event) => event.driver_id === driverId && event.synced_at === null && completed.has(event.session_client_id)),
    };
}

export async function markSynced(clientIds: { sessions: string[]; events: string[] }) {
    const store = readStore();
    const syncedAt = new Date().toISOString();
    store.sessions.forEach((session) => { if (clientIds.sessions.includes(session.client_id)) session.synced_at = syncedAt; });
    store.events.forEach((event) => { if (clientIds.events.includes(event.client_id)) event.synced_at = syncedAt; });
    writeStore(store);
}
