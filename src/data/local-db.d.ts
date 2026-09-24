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

export function getLocalDatabase(): Promise<unknown>;
export function createLocalSession(driverId?: number): Promise<{ clientId: string; driverId: number; startedAt: string }>;
export function completeLocalSession(clientId: string, summary: { endedAt: string; fatigueScore: number; avgScore: number; warningCount: number; criticalEventCount: number; distanceKm?: number | null; avgSpeedKmh?: number | null; maxSpeedKmh?: number | null }): Promise<void>;
export function addLocalFatigueEvent(event: Omit<LocalFatigueEvent, 'synced_at'>): Promise<void>;
export function getLocalSessions(): Promise<LocalSession[]>;
export function finalizeAbandonedSessions(): Promise<void>;
export function getPendingSyncOperations(driverId?: number): Promise<{ sessions: LocalSession[]; events: LocalFatigueEvent[] }>;
export function markSynced(clientIds: { sessions: string[]; events: string[] }): Promise<void>;
