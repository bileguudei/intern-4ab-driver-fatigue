import { getPendingSyncOperations, markSynced } from './local-db';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE ?? 'http://127.0.0.1:8787';

export async function syncPendingData(driverId = 1) {
    const pending = await getPendingSyncOperations(driverId);
    if (pending.sessions.length === 0 && pending.events.length === 0) return 0;

    const operations = [
        ...pending.sessions.map((session) => ({
            operation_id: `session:${session.client_id}:${session.revision}`,
            resource_type: 'session',
            resource_id: session.client_id,
            payload: {
                client_id: session.client_id,
                driver_id: session.driver_id,
                started_at: session.started_at,
                ended_at: session.ended_at,
                fatigue_score: session.fatigue_score,
                warning_count: session.warning_count,
                critical_event_count: session.critical_event_count,
                status: session.status,
                revision: session.revision,
            },
        })),
        ...pending.events.map((event) => ({
            operation_id: `fatigue_event:${event.client_id}`,
            resource_type: 'fatigue_event',
            resource_id: event.client_id,
            payload: {
                client_id: event.client_id,
                session_client_id: event.session_client_id,
                driver_id: event.driver_id,
                level: event.level,
                fatigue_score: event.fatigue_score,
                event_at: event.event_at,
                metadata: event.metadata_json ? JSON.parse(event.metadata_json) : undefined,
            },
        })),
    ];

    const response = await fetch(`${API_BASE_URL}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver_id: driverId, operations }),
    });
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? `Sync failed (${response.status})`);
    }

    await markSynced({
        sessions: pending.sessions.map((session) => session.client_id),
        events: pending.events.map((event) => event.client_id),
    });
    return operations.length;
}
