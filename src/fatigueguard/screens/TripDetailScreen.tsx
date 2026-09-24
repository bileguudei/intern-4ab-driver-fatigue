import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { getLocalSessionEvents, type LocalFatigueEvent, type LocalSession } from '@/data/local-db';
import { buildTripDetail, formatTripOffset, readTripSpeed } from '@/features/fatigue/trip-detail';
import { useAndroidBack } from '@/hooks/use-android-back';
import { Card, Header, SectionTitle } from '../components/ui';
import { colors } from '../theme';

const levelColor = (level: LocalFatigueEvent['level']) => (level === 'critical' ? colors.critical : colors.warning);
const scoreColor = (score: number) => (score >= 70 ? colors.critical : score >= 40 ? colors.warning : colors.normal);
const clock = (date: Date, seconds = false) =>
  date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) });

function formatDuration(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} ц ${minutes % 60} мин` : `${minutes} мин`;
}

/** Түүхээс сонгосон нэг жолоодлогын дэлгэрэнгүй: гол үзүүлэлт, дохионы цагийн шугам, явдал бүр. */
export function TripDetailScreen({ session, onBack }: { session: LocalSession; onBack: () => void }) {
  const [events, setEvents] = useState<LocalFatigueEvent[] | null>(null);
  useAndroidBack(onBack);

  useEffect(() => {
    void getLocalSessionEvents(session.client_id)
      .then(setEvents)
      .catch((error) => {
        console.warn('Unable to load trip events:', error);
        setEvents([]);
      });
  }, [session.client_id]);

  const detail = useMemo(() => buildTripDetail(session, events ?? []), [session, events]);
  const maxScore = Math.round(session.fatigue_score);
  const speed = readTripSpeed(session);
  const endLabel = detail.endedAt ? clock(detail.endedAt) : 'үргэлжилж байна';

  return (
    <View style={styles.screen}>
      <Header
        title={`${detail.startedAt.getMonth() + 1}-р сарын ${detail.startedAt.getDate()}`}
        subtitle={`${clock(detail.startedAt)} – ${endLabel}`}
        onBack={onBack}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.grid}>
          <Kpi label="Хугацаа" value={formatDuration(detail.durationMs)} color={colors.primary} />
          <Kpi label="Дээд оноо" value={String(maxScore)} color={scoreColor(maxScore)} />
          <Kpi label="Дундаж оноо" value={typeof session.avg_score === 'number' ? String(Math.round(session.avg_score)) : '—'} color={colors.text} />
          <Kpi label="Анхааруулга · Аюултай" value={`${session.warning_count} · ${session.critical_event_count}`} color={session.critical_event_count > 0 ? colors.critical : colors.text} />
          {speed ? <Kpi label="Явсан зай" value={`${speed.distanceKm} км`} color={colors.primary} /> : null}
          {speed ? <Kpi label="Дундаж / дээд хурд, км/ц" value={`${speed.avgSpeedKmh ?? '—'} / ${speed.maxSpeedKmh ?? '—'}`} color={colors.primary} /> : null}
        </View>

        <SectionTitle>АЯЛЛЫН ШУГАМ</SectionTitle>
        <Card>
          <Text style={styles.insight}>
            {events === null
              ? 'Уншиж байна…'
              : detail.firstAlertOffsetMs === null
                ? 'Ядаргааны дохио гараагүй.'
                : `Анхны дохио аялал эхэлснээс ${Math.max(1, Math.round(detail.firstAlertOffsetMs / 60_000))} минутын дараа гарсан.`}
          </Text>
          <View style={styles.track}>
            {detail.markers.map((marker) => (
              <View key={marker.id} style={[styles.marker, { left: `${marker.position * 100}%`, backgroundColor: levelColor(marker.level) }]} />
            ))}
          </View>
          <View style={styles.trackLabels}>
            <Text style={styles.muted}>{clock(detail.startedAt)}</Text>
            <Text style={styles.muted}>{endLabel}</Text>
          </View>
          <View style={styles.legend}>
            <Legend color={colors.warning} label="Анхааруулга" />
            <Legend color={colors.critical} label="Аюултай" />
          </View>
        </Card>

        <SectionTitle>ҮЙЛ ЯВДАЛ</SectionTitle>
        <Card>
          {events !== null && detail.markers.length === 0 ? <Text style={styles.muted}>Энэ жолоодлогод дохио гараагүй.</Text> : null}
          {detail.markers.map((marker, index) => (
            <View key={marker.id} style={[styles.eventRow, index > 0 && styles.eventDivider]}>
              <View style={[styles.dot, { backgroundColor: levelColor(marker.level) }]} />
              <View style={styles.eventCopy}>
                <Text style={styles.eventTitle}>{marker.level === 'critical' ? 'Аюултай төлөв' : 'Анхааруулга'}</Text>
                <Text style={styles.muted}>
                  {[
                    clock(marker.at, true),
                    formatTripOffset(marker.offsetMs),
                    marker.speedKmh === null ? null : `${Math.round(marker.speedKmh)} км/ц`,
                    marker.fatigueScore === null ? null : `оноо ${Math.round(marker.fatigueScore)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
            </View>
          ))}
        </Card>

        <Text style={[styles.online, { color: session.synced_at ? colors.normal : colors.textMuted }]}>
          {session.synced_at ? '● Серверт илгээгдсэн' : '○ Офлайн хадгалсан'}
        </Text>
      </ScrollView>
    </View>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Card style={styles.kpi}>
      <Text style={[styles.kpiValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </Card>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 110 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 6 },
  kpi: { width: '48%', alignItems: 'center' },
  kpiValue: { fontSize: 22, fontWeight: '800' },
  kpiLabel: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
  insight: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 18 },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.borderBright, marginHorizontal: 6 },
  marker: { position: 'absolute', top: -4, width: 12, height: 12, marginLeft: -6, borderRadius: 6, borderWidth: 2, borderColor: colors.surface },
  trackLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  legend: { flexDirection: 'row', gap: 16, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  eventDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  dot: { width: 10, height: 10, borderRadius: 5 },
  eventCopy: { flex: 1 },
  eventTitle: { color: colors.text, fontSize: 14, fontWeight: '700', marginBottom: 3 },
  muted: { color: colors.textMuted, fontSize: 12 },
  online: { fontSize: 11, marginTop: 16, textAlign: 'center' },
});
