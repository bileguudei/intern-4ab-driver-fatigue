import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  ComputerVisionCamera, evaluateFaceQuality, faceQualityMessage,
  getComputerVisionCameraPermissionStatus, requestComputerVisionCameraPermission,
  type CameraPermissionStatus, type ComputerVisionObservation, type FaceQuality,
} from '@/features/computer-vision';
import { useAndroidBack } from '@/hooks/use-android-back';
import { PrimaryButton } from '../components/ui';
import { colors } from '../theme';

const REQUIRED_STABLE_MS = 1_500;

/**
 * `autoContinue` false үед нүүр тогтвортой болсон ч автоматаар урагшлахгүй.
 * Калибрациас буцаж ирсэн хэрэглэгч дахин калибраци руу шидэгдэхгүйн тулд.
 */
export function CameraSetupScreen({ onBack, onContinue, autoContinue = true }: { onBack: () => void; onContinue: () => void; autoContinue?: boolean }) {
  const [permission, setPermission] = useState<CameraPermissionStatus | null>(null);
  const [quality, setQuality] = useState<FaceQuality>({ ready: false, issue: 'no-face' });
  const [stableMs, setStableMs] = useState(0);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const readySince = useRef<number | null>(null);
  const continuedRef = useRef(false);

  useEffect(() => { getComputerVisionCameraPermissionStatus().then(setPermission); }, []);

  const handleObservation = useCallback((observation: ComputerVisionObservation) => {
    const next = evaluateFaceQuality(observation);
    setQuality(next);
    if (!next.ready) {
      readySince.current = null;
      setStableMs(0);
      return;
    }
    readySince.current ??= observation.timestampMs;
    setStableMs(observation.timestampMs - readySince.current);
  }, []);

  const requestPermission = async () => {
    setCameraError(null);
    setPermission(await requestComputerVisionCameraPermission());
  };
  const granted = permission === 'granted';
  const canContinue = quality.ready && stableMs >= REQUIRED_STABLE_MS;
  const message = cameraError ?? (canContinue ? 'Нүүр зөв байрлалаа' : quality.issue ? faceQualityMessage[quality.issue] : 'Тогтвортой байна уу');

  useAndroidBack(onBack);

  useEffect(() => {
    if (!autoContinue || !canContinue || continuedRef.current) return;
    continuedRef.current = true;
    onContinue();
  }, [autoContinue, canContinue, onContinue]);

  return (
    <View style={styles.screen}>
      {granted ? <ComputerVisionCamera active style={StyleSheet.absoluteFill} onObservation={handleObservation} onError={(error) => setCameraError(error.message)} /> : null}
      <View pointerEvents="none" style={styles.shade} />
      <View style={styles.topBar}>
        <Pressable onPress={onBack} style={styles.circleButton}><Text style={styles.backText}>‹</Text></Pressable>
        <View><Text style={styles.step}>АЛХАМ 1 / 2</Text><Text style={styles.title}>Нүүрээ тааруулна уу</Text></View>
        <View style={styles.circleButton} />
      </View>

      <View pointerEvents="none" style={[styles.faceFrame, canContinue && styles.faceFrameReady]} />

      {!granted ? <View style={styles.permissionBox}>
        {permission === null ? <ActivityIndicator color={colors.primary} size="large" /> : <>
          <Text style={styles.permissionTitle}>Камерын зөвшөөрөл хэрэгтэй</Text>
          <Text style={styles.permissionText}>Нүүр, нүд болон толгойн байрлалыг төхөөрөмж дээр шалгана.</Text>
          <Pressable onPress={requestPermission} style={styles.permissionButton}><Text style={styles.permissionButtonText}>Камер зөвшөөрөх</Text></Pressable>
        </>}
      </View> : null}

      <View style={styles.bottomPanel}>
        <Text style={[styles.status, { color: canContinue ? colors.normal : colors.warning }]}>{canContinue ? '✓ ' : ''}{message}</Text>
        <Text style={styles.hint}>Нүүр бүхэлдээ хүрээнд, хоёр нүд ил, толгой эгц байх ёстой.</Text>
        <View style={styles.checks}>
          <Check label="Нүүр" good={quality.issue !== 'no-face'} />
          <Check label="Төв" good={!['no-face', 'too-far', 'too-close', 'off-center'].includes(quality.issue ?? '')} />
          <Check label="Харц" good={quality.ready} />
        </View>
        {autoContinue ? null : <PrimaryButton label={canContinue ? 'Үргэлжлүүлэх →' : 'Нүүрээ хүрээнд тогтвортой барина уу'} onPress={onContinue} disabled={!canContinue} />}
      </View>
    </View>
  );
}

function Check({ label, good }: { label: string; good: boolean }) {
  return <View style={styles.check}><Text style={{ color: good ? colors.normal : '#FFFFFF70' }}>{good ? '●' : '○'}</Text><Text style={styles.checkLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#050A12' }, shade: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#00000030' },
  topBar: { paddingHorizontal: 16, paddingTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  circleButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#07111CCC', alignItems: 'center', justifyContent: 'center' }, backText: { color: colors.white, fontSize: 34, lineHeight: 38 },
  step: { color: '#FFFFFFB8', fontSize: 10, fontWeight: '800', letterSpacing: 1, textAlign: 'center' }, title: { color: colors.white, fontSize: 19, fontWeight: '800', textAlign: 'center', marginTop: 2 },
  faceFrame: { position: 'absolute', alignSelf: 'center', top: '17%', width: '70%', height: '49%', borderRadius: 150, borderWidth: 3, borderColor: colors.warning }, faceFrameReady: { borderColor: colors.normal },
  permissionBox: { position: 'absolute', left: 28, right: 28, top: '32%', padding: 22, borderRadius: 20, backgroundColor: '#07111CEF', alignItems: 'center' },
  permissionTitle: { color: colors.white, fontSize: 18, fontWeight: '800' }, permissionText: { color: '#FFFFFFA8', textAlign: 'center', lineHeight: 19, marginTop: 8 },
  permissionButton: { marginTop: 16, backgroundColor: colors.primary, borderRadius: 14, paddingHorizontal: 20, paddingVertical: 13 }, permissionButtonText: { color: colors.white, fontWeight: '800' },
  bottomPanel: { position: 'absolute', left: 16, right: 16, bottom: 16, padding: 18, borderRadius: 22, backgroundColor: '#07111CEF', borderWidth: 1, borderColor: '#FFFFFF24' },
  status: { fontSize: 18, fontWeight: '800', textAlign: 'center' }, hint: { color: '#FFFFFFA8', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 6 },
  checks: { flexDirection: 'row', justifyContent: 'center', gap: 20, marginVertical: 14 }, check: { flexDirection: 'row', alignItems: 'center', gap: 5 }, checkLabel: { color: colors.white, fontSize: 12, fontWeight: '700' },
});
