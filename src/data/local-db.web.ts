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
    store.sessions.unshift({ client_id: clientId, driver_id: driverId, started_at: startedAt, ended_at: null, fatigue_score: 0, warning_count: 0, critical_event_count: 0, status: 'active', revision: 0, synced_at: null });
    writeStore(store);
    return { clientId, driverId, startedAt };
}

export async function completeLocalSession(clientId: string, summary: { endedAt: string; fatigueScore: number; warningCount: number; criticalEventCount: number }) {
    const store = readStore();
    const session = store.sessions.find((item) => item.client_id === clientId);
    if (!session) return;
    Object.assign(session, { ended_at: summary.endedAt, fatigue_score: summary.fatigueScore, warning_count: summary.warningCount, critical_event_count: summary.criticalEventCount, status: 'completed', revision: session.revision + 1, synced_at: null });
    writeStore(store);
}

export async function addLocalFatigueEvent(event: Omit<LocalFatigueEvent, 'synced_at'>) {
    const store = readStore();
    if (!store.events.some((item) => item.client_id === event.client_id)) store.events.push({ ...event, synced_at: null });
    writeStore(store);
}

export async function getLocalSessions() {
    return readStore().sessions;
}

export async function getPendingSyncOperations(driverId = 1) {
    const store = readStore();
    return { sessions: store.sessions.filter((session) => session.driver_id === driverId && session.status === 'completed' && session.synced_at === null), events: store.events.filter((event) => event.driver_id === driverId && event.synced_at === null) };
}

export async function markSynced(clientIds: { sessions: string[]; events: string[] }) {
    const store = readStore();
    const syncedAt = new Date().toISOString();
    store.sessions.forEach((session) => { if (clientIds.sessions.includes(session.client_id)) session.synced_at = syncedAt; });
    store.events.forEach((event) => { if (clientIds.events.includes(event.client_id)) event.synced_at = syncedAt; });
    writeStore(store);
}
