import { driverIdentity } from '@/features/driver';

import { getPendingSyncOperations, markSynced } from './local-db';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE ?? 'http://127.0.0.1:8787';
const APP_API_KEY = process.env.EXPO_PUBLIC_APP_API_KEY ?? '';
/** Сервер нэг хүсэлтэд үүнээс олон үйлдэл хүлээж авдаггүй (backend MAX_SYNC_OPERATIONS). */
const MAX_OPERATIONS_PER_REQUEST = 100;

let running: Promise<number> | null = null;
let rerun = false;

/**
 * Апп нээгдэх, сүлжээ сэргэх, жолоодлого дуусах үед зэрэг дуудагддаг. Нэг л sync
 * ажиллаж, түүний үеэр ирсэн хүсэлтийг дуусмагц дахин нэг удаа ажиллуулна.
 */
export function syncPendingData(driverId = 1): Promise<number> {
    if (running) {
        rerun = true;
        return running;
    }
    running = (async () => {
        let synced = 0;
        do {
            rerun = false;
            synced += await syncOnce(driverId);
        } while (rerun);
        return synced;
    })().finally(() => {
        running = null;
    });
    return running;
}

/**
 * `localDriverId` — утасны санд бичигдсэн жолооч (үргэлж 1). Серверт утас бүр
 * тусдаа жолооч тул илгээхдээ бүртгэлээр авсан серверийн дугаарыг хэрэглэнэ.
 */
async function syncOnce(localDriverId: number) {
    const pending = await getPendingSyncOperations(localDriverId);
    if (pending.sessions.length === 0 && pending.events.length === 0) return 0;

    // Бүртгэл амжаагүй (офлайн) бол аяллууд утсанд үлдэж, дараагийн sync-ээр явна.
    const driverId = await driverIdentity.ensureRegistered();
    if (driverId === null) throw new Error('Driver is not registered with the server yet');

    // Сессүүд эхэнд байх тул явдал бүрийн сесс өмнөх эсвэл ижил хүсэлтэд очно.
    const operations = [
        ...pending.sessions.map((session) => ({
            operation_id: `session:${session.client_id}:${session.revision}`,
            resource_type: 'session',
            resource_id: session.client_id,
            payload: {
                client_id: session.client_id,
                driver_id: driverId,
                started_at: session.started_at,
                ended_at: session.ended_at,
                fatigue_score: session.fatigue_score,
                warning_count: session.warning_count,
                critical_event_count: session.critical_event_count,
                status: session.status,
                revision: session.revision,
                // Серверт тусдаа багана хараахан байхгүй. sync_operations-ийн
                // payload_json-д хадгалагдаж, дараа нь багана руу шилжүүлж болно.
                avg_score: session.avg_score,
                distance_km: session.distance_km,
                avg_speed_kmh: session.avg_speed_kmh,
                max_speed_kmh: session.max_speed_kmh,
            },
        })),
        ...pending.events.map((event) => ({
            operation_id: `fatigue_event:${event.client_id}`,
            resource_type: 'fatigue_event',
            resource_id: event.client_id,
            payload: {
                client_id: event.client_id,
                session_client_id: event.session_client_id,
                driver_id: driverId,
                level: event.level,
                fatigue_score: event.fatigue_score,
                event_at: event.event_at,
                metadata: event.metadata_json ? JSON.parse(event.metadata_json) : undefined,
            },
        })),
    ];

    for (let start = 0; start < operations.length; start += MAX_OPERATIONS_PER_REQUEST) {
        const batch = operations.slice(start, start + MAX_OPERATIONS_PER_REQUEST);
        const response = await fetch(`${API_BASE_URL}/api/sync`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${APP_API_KEY}`,
            },
            body: JSON.stringify({ driver_id: driverId, operations: batch }),
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new Error(payload?.error ?? `Sync failed (${response.status})`);
        }
        await markSynced({
            sessions: batch.filter((operation) => operation.resource_type === 'session').map((operation) => operation.resource_id),
            events: batch.filter((operation) => operation.resource_type === 'fatigue_event').map((operation) => operation.resource_id),
        });
    }
    return operations.length;
}
