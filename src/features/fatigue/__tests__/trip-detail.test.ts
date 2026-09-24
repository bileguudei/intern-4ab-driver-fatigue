import { describe, expect, it } from 'bun:test';

import type { LocalFatigueEvent, LocalSession } from '@/data/local-db';

import { buildTripDetail, formatTripOffset, readEventSpeed, readTripSpeed } from '../trip-detail';

const session = (overrides: Partial<LocalSession> = {}): LocalSession => ({
  client_id: 'session-1',
  driver_id: 1,
  started_at: '2026-09-23T23:00:00.000Z',
  ended_at: '2026-09-23T23:20:00.000Z',
  fatigue_score: 72,
  warning_count: 1,
  critical_event_count: 1,
  status: 'completed',
  revision: 1,
  synced_at: null,
  avg_score: 31,
  distance_km: null,
  avg_speed_kmh: null,
  max_speed_kmh: null,
  ...overrides,
});

const event = (clientId: string, eventAt: string, level: LocalFatigueEvent['level'], metadata: string | null = null): LocalFatigueEvent => ({
  client_id: clientId,
  session_client_id: 'session-1',
  driver_id: 1,
  level,
  fatigue_score: null,
  event_at: eventAt,
  metadata_json: metadata,
  synced_at: null,
});

describe('buildTripDetail', () => {
  it('явдлуудыг цагаар эрэмбэлж, аяллын шугам дээр байрлуулна', () => {
    const detail = buildTripDetail(session(), [
      event('b', '2026-09-23T23:15:00.000Z', 'critical'),
      event('a', '2026-09-23T23:05:00.000Z', 'warning', JSON.stringify({ speedKmh: 48 })),
    ]);

    expect(detail.durationMs).toBe(20 * 60_000);
    expect(detail.markers.map((marker) => marker.id)).toEqual(['a', 'b']);
    expect(detail.markers.map((marker) => marker.position)).toEqual([0.25, 0.75]);
    expect(detail.markers[0].speedKmh).toBe(48);
    expect(detail.markers[1].speedKmh).toBeNull();
    expect(detail.firstAlertOffsetMs).toBe(5 * 60_000);
  });

  it('анхааруулгагүй аялалд анхны дохио байхгүй', () => {
    const detail = buildTripDetail(session(), []);
    expect(detail.markers).toEqual([]);
    expect(detail.firstAlertOffsetMs).toBeNull();
  });

  it('дуусаагүй аяллыг сүүлийн явдлаар хэмжиж, шугамаас гаргахгүй', () => {
    const detail = buildTripDetail(session({ ended_at: null, status: 'active' }), [
      event('a', '2026-09-23T22:59:00.000Z', 'warning'),
      event('b', '2026-09-23T23:10:00.000Z', 'critical'),
    ]);

    expect(detail.durationMs).toBe(10 * 60_000);
    expect(detail.markers.map((marker) => marker.position)).toEqual([0, 1]);
  });
});

describe('readEventSpeed', () => {
  it('хурдгүй эсвэл эвдэрсэн metadata-д null', () => {
    expect(readEventSpeed(null)).toBeNull();
    expect(readEventSpeed('{bad')).toBeNull();
    expect(readEventSpeed(JSON.stringify({ speedKmh: 'fast' }))).toBeNull();
    expect(readEventSpeed(JSON.stringify({ speedKmh: 0 }))).toBe(0);
  });
});

describe('readTripSpeed', () => {
  it('хурд хэмжээгүй аялалд null', () => {
    expect(readTripSpeed(session())).toBeNull();
  });

  it('GPS-ээр хэмжсэн зай, хурдыг буцаана', () => {
    expect(readTripSpeed(session({ distance_km: 18.4, avg_speed_kmh: 46, max_speed_kmh: 88 }))).toEqual({
      distanceKm: 18.4,
      avgSpeedKmh: 46,
      maxSpeedKmh: 88,
    });
  });
});

describe('formatTripOffset', () => {
  it('цагаас бага бол мин:сек, их бол ц:мин:сек', () => {
    expect(formatTripOffset(754_000)).toBe('+12:34');
    expect(formatTripOffset(3_723_000)).toBe('+1:02:03');
    expect(formatTripOffset(-5)).toBe('+0:00');
  });
});
