import { describe, expect, it } from 'bun:test';

import type { LocalSession } from '@/data/local-db';
import { formatDrivingTime, latestTrip, summarizeToday } from '../trip-stats';

const MINUTE = 60_000;
// Утасны цагийн бүсээс үл хамаарахын тулд орон нутгийн цагаар үүсгэнэ.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 8, day, hour, minute);
const trip = (start: Date, minutes: number, patch: Partial<LocalSession> = {}): LocalSession => ({
  client_id: `session-${start.getTime()}`,
  driver_id: 1,
  started_at: start.toISOString(),
  ended_at: new Date(start.getTime() + minutes * MINUTE).toISOString(),
  fatigue_score: 20,
  warning_count: 0,
  critical_event_count: 0,
  status: 'completed',
  revision: 1,
  synced_at: null,
  avg_score: 10,
  ...patch,
});

describe('summarizeToday', () => {
  it('өнөөдөр эхэлсэн, дууссан аяллуудыг л нэгтгэнэ', () => {
    const sessions = [
      trip(at(24, 9), 30, { warning_count: 2, critical_event_count: 1 }),
      trip(at(24, 13), 45, { warning_count: 1 }),
      trip(at(23, 23, 30), 60, { warning_count: 5 }),
      trip(at(24, 17), 0, { status: 'active', ended_at: null, warning_count: 3 }),
    ];
    expect(summarizeToday(sessions, at(24, 18))).toEqual({ trips: 2, drivingMs: 75 * MINUTE, alerts: 4, critical: 1 });
  });

  it('аялалгүй өдөр тэг буцаана', () => {
    expect(summarizeToday([trip(at(23, 9), 30)], at(24, 8))).toEqual({ trips: 0, drivingMs: 0, alerts: 0, critical: 0 });
  });
});

describe('latestTrip', () => {
  it('жагсаалтын дарааллаас үл хамааран хамгийн сүүлийн дууссан аяллыг олно', () => {
    const newest = trip(at(24, 13), 20);
    const sessions = [trip(at(24, 9), 30), newest, trip(at(24, 17), 0, { status: 'active', ended_at: null })];
    expect(latestTrip(sessions)).toBe(newest);
  });

  it('дууссан аялал байхгүй бол null', () => {
    expect(latestTrip([])).toBeNull();
  });
});

describe('formatDrivingTime', () => {
  it('минут, цагаар харуулна', () => {
    expect(formatDrivingTime(0)).toBe('0 мин');
    expect(formatDrivingTime(30_000)).toBe('< 1 мин');
    expect(formatDrivingTime(35 * MINUTE)).toBe('35 мин');
    expect(formatDrivingTime(65 * MINUTE)).toBe('1 ц 5 мин');
  });
});
