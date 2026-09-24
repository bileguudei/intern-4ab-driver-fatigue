import type { LocalSession } from '@/data/local-db';

/** Нүүр дэлгэцийн «Өнөөдөр» хэсэг. */
export type TodayStats = Readonly<{
  trips: number;
  drivingMs: number;
  /** Анхааруулга ба аюултай төлөвийн нийт тоо. */
  alerts: number;
  critical: number;
}>;

const completed = (sessions: readonly LocalSession[]) => sessions.filter((session) => session.status === 'completed');

export const tripDurationMs = (session: LocalSession) =>
  session.ended_at === null ? 0 : Math.max(0, Date.parse(session.ended_at) - Date.parse(session.started_at));

/** Өнөөдөр (утасны цагийн бүсээр) эхэлсэн, дууссан аяллуудыг нэгтгэнэ. */
export function summarizeToday(sessions: readonly LocalSession[], now: Date): TodayStats {
  const today = completed(sessions).filter((session) => new Date(session.started_at).toDateString() === now.toDateString());
  return {
    trips: today.length,
    drivingMs: today.reduce((sum, session) => sum + tripDurationMs(session), 0),
    alerts: today.reduce((sum, session) => sum + session.warning_count + session.critical_event_count, 0),
    critical: today.reduce((sum, session) => sum + session.critical_event_count, 0),
  };
}

/** Хамгийн сүүлд эхэлсэн, дууссан аялал. */
export function latestTrip(sessions: readonly LocalSession[]): LocalSession | null {
  return completed(sessions).reduce<LocalSession | null>(
    (latest, session) => (latest === null || Date.parse(session.started_at) > Date.parse(latest.started_at) ? session : latest),
    null,
  );
}

/** «< 1 мин», «35 мин», «1 ц 5 мин». */
export function formatDrivingTime(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes === 0) return ms > 0 ? '< 1 мин' : '0 мин';
  return minutes >= 60 ? `${Math.floor(minutes / 60)} ц ${minutes % 60} мин` : `${minutes} мин`;
}
