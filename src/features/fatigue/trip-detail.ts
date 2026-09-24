import type { LocalFatigueEvent, LocalSession } from '@/data/local-db';

export type TripMarker = Readonly<{
  id: string;
  level: LocalFatigueEvent['level'];
  at: Date;
  /** Аялал эхэлснээс хойшх хугацаа, мс. */
  offsetMs: number;
  /** Аяллын шугам дээрх байрлал, 0...1. */
  position: number;
  /** Явдал гарах үеийн хурд. Хурд хэмжээгүй аялалд null. */
  speedKmh: number | null;
  fatigueScore: number | null;
}>;

export type TripDetail = Readonly<{
  startedAt: Date;
  endedAt: Date | null;
  durationMs: number;
  markers: readonly TripMarker[];
  /** Анхны дохио хүртэлх хугацаа — ядаргаа аяллын хэр эрт эхэлснийг харуулна. */
  firstAlertOffsetMs: number | null;
}>;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Явдлын metadata-аас хурдыг уншина. Эвдэрсэн эсвэл хурдгүй бол null. */
export function readEventSpeed(metadataJson: string | null): number | null {
  if (metadataJson === null) return null;
  try {
    const speed: unknown = JSON.parse(metadataJson)?.speedKmh;
    return typeof speed === 'number' && Number.isFinite(speed) ? speed : null;
  } catch {
    return null;
  }
}

/** Аяллын явдлуудыг цагийн шугам болгоно. Дуусаагүй аяллыг сүүлийн явдлаар хэмжинэ. */
export function buildTripDetail(session: LocalSession, events: readonly LocalFatigueEvent[]): TripDetail {
  const startedAt = new Date(session.started_at);
  const endedAt = session.ended_at ? new Date(session.ended_at) : null;
  const sorted = [...events].sort((a, b) => a.event_at.localeCompare(b.event_at));
  const lastEventMs = sorted.length > 0 ? Date.parse(sorted[sorted.length - 1].event_at) : startedAt.getTime();
  const durationMs = Math.max(0, (endedAt?.getTime() ?? lastEventMs) - startedAt.getTime());

  const markers = sorted.map((event): TripMarker => {
    const at = new Date(event.event_at);
    const offsetMs = Math.max(0, at.getTime() - startedAt.getTime());
    return {
      id: event.client_id,
      level: event.level,
      at,
      offsetMs,
      position: durationMs > 0 ? clamp01(offsetMs / durationMs) : 0,
      speedKmh: readEventSpeed(event.metadata_json),
      fatigueScore: event.fatigue_score,
    };
  });

  return { startedAt, endedAt, durationMs, markers, firstAlertOffsetMs: markers[0]?.offsetMs ?? null };
}

export type TripSpeed = Readonly<{
  distanceKm: number;
  avgSpeedKmh: number | null;
  maxSpeedKmh: number | null;
}>;

/** GPS-ээр хэмжсэн аяллын зай, хурд. Хурд хэмжээгүй (байршлын зөвшөөрөлгүй) аялалд null. */
export function readTripSpeed(session: LocalSession): TripSpeed | null {
  if (typeof session.distance_km !== 'number') return null;
  return { distanceKm: session.distance_km, avgSpeedKmh: session.avg_speed_kmh, maxSpeedKmh: session.max_speed_kmh };
}

/** Аялал эхэлснээс хойшх хугацаа: «+12:34», цагаас давбал «+1:02:03». */
export function formatTripOffset(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return hours > 0 ? `+${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `+${minutes}:${seconds}`;
}
