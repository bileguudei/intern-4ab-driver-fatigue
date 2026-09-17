import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  ComputerVisionCamera,
  getComputerVisionCameraPermissionStatus,
  isDriverFatigueVisionAvailable,
  type CameraPermissionStatus,
  type ComputerVisionObservation,
  type VisionStatus,
} from '@/features/computer-vision';
import type { FatigueEngine } from '@/features/fatigue/engine';
import { useFatigueState } from '@/features/fatigue/use-fatigue-state';
import { Card, PrimaryButton } from '../components/ui';
import { colors } from '../theme';
import type { FatigueState, SessionSummary } from '../types';

const stateCopy: Record<FatigueState, { label: string; color: string; message: string }> = {
  normal: { label: 'Хэвийн', color: colors.normal, message: 'Таны төлөв хэвийн байна' },
  warning: { label: 'Анхаар', color: colors.warning, message: 'Ядралтын шинж илэрч байна' },
  critical: { label: 'АЮУЛТАЙ', color: colors.critical, message: 'ЯАРАЛТАЙ ЗОГСОЖ АМАРНА УУ' },
};

function Metric({ label, value, good }: { label: string; value: string; good: boolean }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={[styles.metricValue, { color: good ? colors.normal : colors.warning }]}>{value}</Text></View>;
}

export function DrivingScreen({ engine, onFinish }: { engine: FatigueEngine; onFinish: (summary: SessionSummary) => void }) {
  const live = useFatigueState(engine);
  const [seconds, setSeconds] = useState(0);
  const [permission, setPermission] = useState<CameraPermissionStatus | null>(null);
  const [observation, setObservation] = useState<ComputerVisionObservation | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => { const timer = setInterval(() => setSeconds((value) => value + 1), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { getComputerVisionCameraPermissionStatus().then(setPermission); }, []);

  const handleObservation = useCallback((next: ComputerVisionObservation) => {
    setObservation(next);
    engine.accept(next);
  }, [engine]);
  const handleStatus = useCallback((status: VisionStatus) => engine.onCameraStatus(status), [engine]);
  const formatted = useMemo(() => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`, [seconds]);
  const current = stateCopy[live.level];
  const active = permission === 'granted' && isDriverFatigueVisionAvailable;
  const faceDetected = observation?.faceDetected === true;
  const eyeOpen = observation?.averageEar !== null && observation?.averageEar !== undefined && observation.averageEar >= 0.18;
  const headCentered = observation?.headPose !== null && observation?.headPose !== undefined && Math.abs(observation.headPose.yaw) <= 25 && Math.abs(observation.headPose.pitch) <= 25;
  const finish = () => onFinish({ ...engine.finish(), durationSeconds: seconds });

  return <View style={styles.screen}>
    <View style={styles.statusBar}><View><Text style={styles.statusLabel}>ЖОЛООДЛОГЫН ХУГАЦАА</Text><Text style={styles.time}>{formatted}</Text></View><View style={styles.statusRight}><Text style={[styles.connection, { color: live.cameraStatus === 'running' ? colors.normal : colors.warning }]}>{live.cameraStatus === 'running' ? '● Камер идэвхтэй' : '● Камер холбогдож байна'}</Text><Text style={[styles.statePill, { color: current.color, borderColor: current.color }]}>{current.label}</Text></View></View>
    {!dismissed && live.level !== 'normal' ? <View style={[styles.alert, { backgroundColor: live.level === 'critical' ? colors.criticalDark : colors.warningDark, borderColor: current.color }]}><Text style={[styles.alertTitle, { color: current.color }]}>{live.level === 'critical' ? '⚠ ЯАРАЛТАЙ АМАРНА УУ' : '⚠ ЯДРАЛТ ИЛЭРЛЭЭ'}</Text><Pressable onPress={() => setDismissed(true)}><Text style={styles.dismiss}>×</Text></Pressable></View> : null}
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.preview}>
        {active ? <ComputerVisionCamera active targetFps={12} style={StyleSheet.absoluteFill} onObservation={handleObservation} onStatusChange={handleStatus} onError={(error) => setCameraError(error.message)} /> : null}
        <View pointerEvents="none" style={styles.shade} /><View pointerEvents="none" style={[styles.faceFrame, { borderColor: faceDetected ? colors.normal : colors.warning }]} />
        {active && live.cameraStatus !== 'running' ? <ActivityIndicator color={colors.white} size="large" /> : null}
        {!active ? <Text style={styles.cameraMessage}>{cameraError ?? 'Камерын зөвшөөрөл эсвэл native module шаардлагатай.'}</Text> : null}
        <View pointerEvents="none" style={styles.badge}><Text style={styles.badgeText}>{faceDetected ? '● НҮҮР ИЛЭРСЭН' : '○ НҮҮР ХАЙЖ БАЙНА'}</Text></View>
      </View>
      <Text style={styles.caption}>Камерын шууд дүрс · өгөгдөл төхөөрөмжөөс гарахгүй</Text>
      <View style={styles.metrics}><Metric label="Нүүр" value={faceDetected ? 'Илэрсэн' : 'Илрээгүй'} good={faceDetected} /><Metric label="Нүд (EAR)" value={observation?.averageEar?.toFixed(3) ?? '—'} good={eyeOpen} /><Metric label="Толгой" value={observation?.headPose ? `${Math.round(observation.headPose.yaw)}°` : '—'} good={headCentered} /></View>
      <View style={[styles.scoreCircle, { borderColor: current.color }]}><Text style={styles.score}>{live.score}</Text><Text style={styles.scoreOf}>/ 100</Text></View><Text style={[styles.stateTitle, { color: current.color }]}>{current.label}</Text><Text style={styles.stateMessage}>{current.message}</Text>
      {live.level !== 'normal' ? <Card style={styles.advice}><Text style={styles.adviceTitle}>✦ Зөвлөгөө</Text><Text style={styles.adviceText}>Ойрын аюулгүй газарт зогсож, 15–20 минут амрахыг зөвлөж байна.</Text></Card> : null}
    </ScrollView>
    <View style={styles.footer}><Pressable onPress={() => setShowConfirm(true)} style={styles.endButton}><Text style={styles.endText}>■ Жолоодлого дуусгах</Text></Pressable></View>
    <Modal transparent visible={showConfirm} animationType="fade" onRequestClose={() => setShowConfirm(false)}><View style={styles.modalBackdrop}><Card style={styles.modal}><Text style={styles.modalIcon}>■</Text><Text style={styles.modalTitle}>Жолоодлого дуусгах уу?</Text><Text style={styles.modalText}>Одоогийн сесс хадгалагдаж, хураангуй мэдээлэл харагдана.</Text><PrimaryButton label="Тийм, дуусгах" onPress={finish} /><Pressable onPress={() => setShowConfirm(false)} style={styles.cancel}><Text style={styles.cancelText}>Үргэлжлүүлэн жолоодох</Text></Pressable></Card></View></Modal>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, statusBar: { paddingHorizontal: 20, paddingVertical: 12, borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, statusLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 0.8 }, time: { color: colors.text, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }, statusRight: { alignItems: 'flex-end', gap: 4 }, connection: { fontSize: 11, fontWeight: '600' }, statePill: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, fontSize: 10, fontWeight: '800' }, alert: { margin: 12, marginBottom: 0, borderWidth: 1, borderRadius: 14, padding: 12, flexDirection: 'row', justifyContent: 'space-between' }, alertTitle: { fontWeight: '800', fontSize: 14 }, dismiss: { color: colors.text, fontSize: 22 }, content: { alignItems: 'center', padding: 20, paddingBottom: 110 }, preview: { height: 220, width: '100%', borderRadius: 20, overflow: 'hidden', backgroundColor: '#0D1625', alignItems: 'center', justifyContent: 'center', borderColor: colors.borderBright, borderWidth: 1 }, shade: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#00000024' }, faceFrame: { width: 104, height: 142, borderRadius: 54, borderWidth: 2 }, badge: { position: 'absolute', top: 12, left: 12, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: '#07111CDD' }, badgeText: { color: colors.white, fontSize: 10, fontWeight: '800' }, cameraMessage: { color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 24 }, caption: { color: colors.textMuted, fontSize: 10, marginTop: 8, alignSelf: 'flex-start' }, metrics: { alignSelf: 'stretch', flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 14, marginTop: 16, paddingVertical: 13, borderWidth: 1, borderColor: colors.border }, metric: { flex: 1, alignItems: 'center' }, metricLabel: { color: colors.textMuted, fontSize: 10, marginBottom: 5 }, metricValue: { fontSize: 12, fontWeight: '800' }, scoreCircle: { width: 144, height: 144, borderRadius: 72, borderWidth: 8, alignItems: 'center', justifyContent: 'center', marginTop: 20, backgroundColor: colors.surface }, score: { color: colors.text, fontSize: 46, fontWeight: '800' }, scoreOf: { color: colors.textMuted }, stateTitle: { fontSize: 24, fontWeight: '800', marginTop: 12 }, stateMessage: { color: colors.textSecondary, marginTop: 5 }, advice: { alignSelf: 'stretch', marginTop: 16, borderColor: colors.primary }, adviceTitle: { color: colors.primary, fontWeight: '800', marginBottom: 7 }, adviceText: { color: colors.textSecondary, lineHeight: 20 }, footer: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: colors.background, borderTopColor: colors.border, borderTopWidth: 1 }, endButton: { height: 50, borderRadius: 14, borderColor: colors.critical, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, endText: { color: colors.critical, fontWeight: '700' }, modalBackdrop: { flex: 1, backgroundColor: '#000000B3', alignItems: 'center', justifyContent: 'center', padding: 24 }, modal: { width: '100%', maxWidth: 420, alignItems: 'center', padding: 22 }, modalIcon: { color: colors.critical, fontSize: 36 }, modalTitle: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: 14 }, modalText: { color: colors.textSecondary, textAlign: 'center', lineHeight: 20, marginVertical: 12 }, cancel: { padding: 14 }, cancelText: { color: colors.textSecondary, fontWeight: '600' },
});
