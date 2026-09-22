import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
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

export function DrivingScreen({ engine, onFinish }: { engine: FatigueEngine; onFinish: (summary: SessionSummary) => void }) {
  const live = useFatigueState(engine);
  const [seconds, setSeconds] = useState(0);
  const [permission, setPermission] = useState<CameraPermissionStatus | null>(null);
  const [observation, setObservation] = useState<ComputerVisionObservation | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [dismissedLevel, setDismissedLevel] = useState<FatigueState | null>(null);

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
  const eyesVisible = observation?.averageEar !== null && observation?.averageEar !== undefined;
  const headCentered = observation?.headPose !== null && observation?.headPose !== undefined && Math.abs(observation.headPose.yaw) <= 18 && Math.abs(observation.headPose.pitch) <= 18;
  const finish = () => onFinish({ ...engine.finish(), durationSeconds: seconds });

  return (
    <View style={styles.screen}>
      {active ? <ComputerVisionCamera active targetFps={12} style={StyleSheet.absoluteFill} onObservation={handleObservation} onStatusChange={handleStatus} onError={(error) => setCameraError(error.message)} /> : null}
      <View pointerEvents="none" style={styles.cameraShade} />

      <View style={styles.topHud}>
        <View><Text style={styles.microLabel}>ЖОЛООДЛОГЫН ХУГАЦАА</Text><Text style={styles.time}>{formatted}</Text></View>
        <View style={styles.statusStack}>
          <Text style={[styles.cameraState, { color: live.cameraStatus === 'running' ? colors.normal : colors.warning }]}>{live.cameraStatus === 'running' ? '● КАМЕР ИДЭВХТЭЙ' : '● КАМЕР АСАЖ БАЙНА'}</Text>
          <View style={[styles.levelPill, { borderColor: current.color }]}><Text style={[styles.levelText, { color: current.color }]}>{current.label}</Text></View>
        </View>
      </View>

      {dismissedLevel !== live.level && live.level !== 'normal' ? <View style={[styles.alert, { borderColor: current.color, backgroundColor: live.level === 'critical' ? colors.criticalDark : colors.warningDark }]}>
        <Text style={[styles.alertText, { color: current.color }]}>{live.level === 'critical' ? '⚠ ЯАРАЛТАЙ ЗОГСОЖ АМАРНА УУ' : '⚠ ЯДРАЛТЫН ШИНЖ ИЛЭРЛЭЭ'}</Text>
        <Pressable onPress={() => setDismissedLevel(live.level)} hitSlop={12}><Text style={styles.close}>×</Text></Pressable>
      </View> : null}

      <View style={styles.guideArea} pointerEvents="none">
        <View style={styles.detectBadge}><Text style={[styles.detectText, { color: faceDetected ? colors.normal : colors.warning }]}>{faceDetected ? '● ЖОЛООЧИЙГ ХЯНАЖ БАЙНА' : '○ НҮҮР ИЛЭРСЭНГҮЙ'}</Text></View>
        {active && live.cameraStatus !== 'running' ? <ActivityIndicator color={colors.white} size="large" style={styles.loader} /> : null}
        {!active ? <Text style={styles.cameraMessage}>{cameraError ?? 'Камерын зөвшөөрөл эсвэл native module шаардлагатай.'}</Text> : null}
      </View>

      <View style={styles.bottomHud}>
        <View style={styles.summaryRow}>
          <View><Text style={[styles.levelTitle, { color: current.color }]}>{current.label}</Text><Text style={styles.levelMessage}>{current.message}</Text></View>
          <View style={[styles.scorePill, { borderColor: current.color }]}><Text style={[styles.score, { color: current.color }]}>{live.score}</Text><Text style={styles.scoreSuffix}>/100</Text></View>
        </View>
        <View style={styles.checkRow}>
          <Check label="Нүүр" value={faceDetected ? 'Илэрсэн' : 'Алга'} good={faceDetected} />
          <View style={styles.divider} />
          <Check label="Нүд" value={eyesVisible ? 'Хянаж байна' : 'Харагдахгүй'} good={eyesVisible} />
          <View style={styles.divider} />
          <Check label="Толгой" value={headCentered ? 'Төвд' : 'Хазайсан'} good={headCentered} />
        </View>
        <Pressable onPress={() => setShowConfirm(true)} style={styles.endButton}><Text style={styles.endText}>■  Жолоодлого дуусгах</Text></Pressable>
      </View>

      <Modal transparent visible={showConfirm} animationType="fade" onRequestClose={() => setShowConfirm(false)}>
        <View style={styles.modalBackdrop}><Card style={styles.modal}><Text style={styles.modalTitle}>Жолоодлого дуусгах уу?</Text><Text style={styles.modalText}>Одоогийн сесс хадгалагдаж, хураангуй мэдээлэл харагдана.</Text><PrimaryButton label="Тийм, дуусгах" onPress={finish} /><Pressable onPress={() => setShowConfirm(false)} style={styles.cancel}><Text style={styles.cancelText}>Үргэлжлүүлэн жолоодох</Text></Pressable></Card></View>
      </Modal>
    </View>
  );
}

function Check({ label, value, good }: { label: string; value: string; good: boolean }) {
  return <View style={styles.check}><Text style={styles.checkLabel}>{label}</Text><View style={styles.checkValueRow}><View style={[styles.dot, { backgroundColor: good ? colors.normal : colors.warning }]} /><Text style={[styles.checkValue, { color: good ? colors.white : colors.warning }]}>{value}</Text></View></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#050A12' },
  cameraShade: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#00000024' },
  topHud: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', margin: 14, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 18, backgroundColor: '#07111CE8', borderWidth: 1, borderColor: '#FFFFFF20' },
  microLabel: { color: '#FFFFFF8F', fontSize: 9, fontWeight: '800', letterSpacing: 1 }, time: { color: colors.white, fontSize: 25, fontWeight: '900', fontVariant: ['tabular-nums'], marginTop: 2 },
  statusStack: { alignItems: 'flex-end', gap: 6 }, cameraState: { fontSize: 10, fontWeight: '800' }, levelPill: { borderWidth: 1, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: '#00000050' }, levelText: { fontSize: 11, fontWeight: '900' },
  alert: { marginHorizontal: 14, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, alertText: { fontSize: 13, fontWeight: '900' }, close: { color: colors.white, fontSize: 22 },
  guideArea: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 12 },
  detectBadge: { marginTop: 12, paddingHorizontal: 13, paddingVertical: 7, borderRadius: 99, backgroundColor: '#07111CE8' }, detectText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.4 }, loader: { position: 'absolute' }, cameraMessage: { position: 'absolute', color: colors.white, textAlign: 'center', paddingHorizontal: 30 },
  bottomHud: { marginHorizontal: 14, marginBottom: 14, padding: 16, borderRadius: 22, backgroundColor: '#07111CF2', borderWidth: 1, borderColor: '#FFFFFF20' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, levelTitle: { fontSize: 22, fontWeight: '900' }, levelMessage: { color: '#FFFFFFA8', fontSize: 12, marginTop: 2 }, scorePill: { minWidth: 78, height: 50, borderWidth: 2, borderRadius: 16, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center' }, score: { fontSize: 27, fontWeight: '900' }, scoreSuffix: { color: '#FFFFFF80', fontSize: 10 },
  checkRow: { flexDirection: 'row', alignItems: 'center', marginTop: 15, paddingVertical: 11, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#FFFFFF18' }, check: { flex: 1, alignItems: 'center' }, checkLabel: { color: '#FFFFFF70', fontSize: 9, fontWeight: '700', marginBottom: 4 }, checkValueRow: { flexDirection: 'row', alignItems: 'center', gap: 5 }, dot: { width: 7, height: 7, borderRadius: 4 }, checkValue: { fontSize: 11, fontWeight: '800' }, divider: { width: 1, height: 28, backgroundColor: '#FFFFFF18' },
  endButton: { height: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.critical, alignItems: 'center', justifyContent: 'center', marginTop: 14 }, endText: { color: colors.critical, fontWeight: '800' },
  modalBackdrop: { flex: 1, backgroundColor: '#000000B8', alignItems: 'center', justifyContent: 'center', padding: 24 }, modal: { width: '100%', maxWidth: 420, alignItems: 'center', padding: 22 }, modalTitle: { color: colors.text, fontSize: 20, fontWeight: '800' }, modalText: { color: colors.textSecondary, textAlign: 'center', lineHeight: 20, marginVertical: 12 }, cancel: { padding: 14 }, cancelText: { color: colors.textSecondary, fontWeight: '600' },
});
