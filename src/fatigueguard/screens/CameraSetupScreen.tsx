import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  ComputerVisionCamera,
  getComputerVisionCameraPermissionStatus,
  requestComputerVisionCameraPermission,
  type CameraPermissionStatus,
  type ComputerVisionObservation,
  type VisionStatus,
} from '@/features/computer-vision';
import { Card, Header, PrimaryButton, SectionTitle } from '../components/ui';
import { colors } from '../theme';

type Conditions = { face: boolean; light: boolean; position: boolean };

const notReady: Conditions = { face: false, light: false, position: false };

const MINIMUM_BRIGHTNESS = 0.25;
const MAXIMUM_HEAD_ANGLE_DEGREES = 20;

function readConditions(observation: ComputerVisionObservation): Conditions {
  const { faceDetected, brightness, headPose } = observation;

  return {
    face: faceDetected,
    light: brightness !== null && brightness >= MINIMUM_BRIGHTNESS,
    position:
      faceDetected &&
      headPose !== null &&
      Math.abs(headPose.yaw) <= MAXIMUM_HEAD_ANGLE_DEGREES &&
      Math.abs(headPose.pitch) <= MAXIMUM_HEAD_ANGLE_DEGREES,
  };
}

function isSame(current: Conditions, next: Conditions): boolean {
  return current.face === next.face && current.light === next.light && current.position === next.position;
}

function Condition({ icon, label, good, bad, value, advisory = false }: { icon: string; label: string; good: string; bad: string; value: boolean; advisory?: boolean }) { const badColor = advisory ? colors.warning : colors.critical; return <Card style={styles.condition}><Text style={styles.conditionIcon}>{icon}</Text><Text style={styles.conditionLabel}>{label}</Text><Text style={[styles.conditionValue, { color: value ? colors.normal : badColor }]}>{value ? `✓ ${good}` : `! ${bad}`}</Text></Card>; }

export function CameraSetupScreen({ onBack, onContinue }: { onBack: () => void; onContinue: () => void }) {
  const [permission, setPermission] = useState<CameraPermissionStatus | null>(null);
  const [conditions, setConditions] = useState<Conditions>(notReady);
  const [status, setStatus] = useState<VisionStatus>('idle');
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getComputerVisionCameraPermissionStatus().then((current) => {
      if (!cancelled) {
        setPermission(current);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleObservation = useCallback((observation: ComputerVisionObservation) => {
    const next = readConditions(observation);
    setConditions((current) => (isSame(current, next) ? current : next));
  }, []);

  const handleRequestPermission = useCallback(async () => {
    setCameraError(null);
    setPermission(await requestComputerVisionCameraPermission());
  }, []);

  const granted = permission === 'granted';
  // Шөнө гудамжны гэрэлд нүүр харагдаж байсан ч зургийн дундаж гэрэл бага гардаг.
  // Нойрмоглолт ихэвчлэн шөнө тул гэрлийг хаах нөхцөл биш, анхааруулга болгов.
  const canContinue = conditions.face && conditions.position;
  const waitingForCamera = status !== 'running' && cameraError === null;

  return <View style={styles.screen}><Header title="Камераа тохируулна уу" onBack={onBack} badge="1 / 2" /><ScrollView contentContainerStyle={styles.content}><Text style={styles.help}>Таны нүүр болон нүд бүрэн харагдах шаардлагатай.</Text><View style={[styles.preview, !conditions.face && styles.previewBad]}>{granted ? <><ComputerVisionCamera active style={StyleSheet.absoluteFill} onObservation={handleObservation} onStatusChange={setStatus} onError={(error) => setCameraError(error.message)} /><View pointerEvents="none" style={styles.cameraShade} /><View pointerEvents="none" style={styles.faceFrame} />{waitingForCamera ? <ActivityIndicator color={colors.primary} size="large" /> : null}<View pointerEvents="none" style={styles.previewStatus}><Text style={[styles.previewTitle, !conditions.face && { color: colors.critical }]}>{cameraError ? 'Камер ассангүй' : conditions.face ? 'Нүүрээ хүрээнд байрлуулна уу' : 'Нүүр илэрсэнгүй'}</Text><Text style={styles.previewText}>{cameraError ?? 'Утсаа нүүрний төвд тогтвортой байрлуулна уу'}</Text></View></> : <View style={styles.permissionBox}>{permission === null ? <ActivityIndicator color={colors.primary} size="large" /> : <><Text style={styles.permissionIcon}>◉</Text><Text style={styles.permissionTitle}>Камерын зөвшөөрөл хэрэгтэй</Text><Text style={styles.permissionText}>Жолоочийн нүүр болон нүдийг харахын тулд камер ашиглана.</Text><Pressable onPress={handleRequestPermission} style={styles.permissionButton}><Text style={styles.permissionButtonText}>Камер зөвшөөрөх</Text></Pressable></>}</View>}</View><SectionTitle>Нөхцлийн шалгалт</SectionTitle><Condition icon="☺" label="Нүүр харагдаж байна" good="Тодорхой" bad="Илрэхгүй байна" value={conditions.face} /><Condition icon="☀" label="Гэрэлтүүлэг" good="Сайн" bad="Бага — нарийвчлал буурч магадгүй" value={conditions.light} advisory /><Condition icon="▣" label="Утасны байрлал" good="Сайн" bad="Тохируулна уу" value={conditions.position} /></ScrollView><View style={styles.footer}>{!canContinue ? <Text style={styles.warning}>⚠ Нүүр харагдаж, утас зөв байрласны дараа үргэлжлүүлнэ үү</Text> : !conditions.light ? <Text style={styles.warning}>⚠ Гэрэл бага байна. Нүүр илэрч байгаа тул үргэлжлүүлж болно</Text> : null}<PrimaryButton label="Үргэлжлүүлэх →" onPress={onContinue} disabled={!canContinue} /></View></View>;
}

const styles = StyleSheet.create({ screen: { flex: 1 }, content: { paddingHorizontal: 20, paddingBottom: 20 }, help: { color: colors.textMuted, fontSize: 14, marginBottom: 18 }, preview: { height: 240, borderRadius: 22, borderWidth: 2, borderColor: colors.normal, backgroundColor: '#0D1625', justifyContent: 'center', alignItems: 'center', marginBottom: 24, overflow: 'hidden' }, previewBad: { borderColor: colors.critical }, cameraShade: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#00000018' }, faceFrame: { width: 130, height: 172, borderRadius: 66, borderColor: colors.primary, borderWidth: 2, backgroundColor: 'transparent' }, previewStatus: { position: 'absolute', left: 12, right: 12, bottom: 12, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, backgroundColor: '#0A0E1ACC', alignItems: 'center' }, previewTitle: { color: colors.text, fontWeight: '700', fontSize: 14 }, previewText: { color: colors.textMuted, fontSize: 12, marginTop: 5 }, permissionBox: { paddingHorizontal: 28, alignItems: 'center' }, permissionIcon: { color: colors.primary, fontSize: 40 }, permissionTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 10 }, permissionText: { color: colors.textMuted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 6 }, permissionButton: { backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 11, marginTop: 14 }, permissionButtonText: { color: colors.white, fontWeight: '700' }, condition: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, paddingVertical: 13 }, conditionIcon: { color: colors.textSecondary, fontSize: 22, width: 34 }, conditionLabel: { color: colors.text, flex: 1, fontSize: 14, fontWeight: '600' }, conditionValue: { fontSize: 12, fontWeight: '700' }, footer: { padding: 20, borderTopColor: colors.border, borderTopWidth: 1, backgroundColor: colors.background }, warning: { color: colors.warning, backgroundColor: colors.warningDark, borderRadius: 10, padding: 10, marginBottom: 10, fontSize: 12 } });
