import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ComputerVisionCamera, evaluateFaceQuality, faceQualityMessage, type ComputerVisionObservation } from '@/features/computer-vision';
import type { FatigueEngine } from '@/features/fatigue/engine';
import { useFatigueState } from '@/features/fatigue/use-fatigue-state';
import { PrimaryButton } from '../components/ui';
import { colors } from '../theme';

export function CalibrationScreen({ engine, onBack, onComplete }: {
  engine: FatigueEngine;
  onBack: () => void;
  onComplete: () => void;
}) {
  const live = useFatigueState(engine);
  const [observation, setObservation] = useState<ComputerVisionObservation | null>(null);
  const quality = evaluateFaceQuality(observation);
  const calibrationReady = quality.ready || quality.issue === 'eyes-closed';

  useEffect(() => { engine.startCalibration(); }, [engine]);

  const handleObservation = useCallback((next: ComputerVisionObservation) => {
    setObservation(next);
    engine.accept(next);
  }, [engine]);

  const complete = live.calibration === 'done';
  const progress = Math.round(live.calibrationProgress * 100);
  const message = complete
    ? 'Калибраци амжилттай'
    : quality.issue && quality.issue !== 'eyes-closed'
      ? faceQualityMessage[quality.issue]
      : live.calibrationPhase === 'eye'
        ? 'Урагшаа харж, нүдээ хэвийн анивчина уу'
        : 'Толгойгоо эгц, хөдөлгөөнгүй байлгана уу';

  return (
    <View style={styles.screen}>
      <ComputerVisionCamera
        active
        style={StyleSheet.absoluteFill}
        onObservation={handleObservation}
        onStatusChange={engine.onCameraStatus}
      />
      <View pointerEvents="none" style={styles.shade} />
      <View style={styles.topBar}>
        <Pressable onPress={onBack} style={styles.back}><Text style={styles.backText}>‹</Text></Pressable>
        <View><Text style={styles.step}>АЛХАМ 2 / 2</Text><Text style={styles.title}>Калибраци</Text></View>
        <View style={styles.back} />
      </View>

      <View pointerEvents="none" style={[styles.faceFrame, (calibrationReady || complete) && styles.faceFrameReady]}>
        <View style={[styles.corner, styles.topLeft]} /><View style={[styles.corner, styles.topRight]} />
        <View style={[styles.corner, styles.bottomLeft]} /><View style={[styles.corner, styles.bottomRight]} />
      </View>

      <View style={styles.bottomPanel}>
        <Text style={[styles.status, { color: calibrationReady || complete ? colors.normal : colors.warning }]}>{message}</Text>
        {!complete ? <Text style={styles.phaseLabel}>{live.calibrationPhase === 'eye' ? '1. НҮДНИЙ ШАЛГАЛТ' : '2. ТОЛГОЙН ШАЛГАЛТ'}</Text> : null}
        <Text style={styles.hint}>{complete ? 'Нүд болон толгойн хэвийн утгыг амжилттай хадгаллаа.' : calibrationReady ? 'Ердийн анивчилт хэмжилтийг таслахгүй. Нүүрээ буруулах эсвэл хүрээнээс гарахад 0-ээс эхэлнэ.' : 'Зөв байрлалдаа орсны дараа хэмжилт автоматаар эхэлнэ.'}</Text>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
        <Text style={styles.progressText}>{complete ? '100%' : `${progress}% · ${Math.ceil((1 - live.calibrationProgress) * 10)} сек`}</Text>
        {complete ? <PrimaryButton label="Жолоодлого эхлүүлэх" onPress={onComplete} /> : null}
        {live.calibration === 'failed' ? <PrimaryButton label="Дахин оролдох" onPress={() => engine.startCalibration()} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'space-between' }, shade: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#00000038' },
  topBar: { paddingHorizontal: 16, paddingTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#07111CCC', alignItems: 'center', justifyContent: 'center' }, backText: { color: colors.white, fontSize: 34, lineHeight: 38 },
  step: { color: '#FFFFFFB8', fontSize: 10, fontWeight: '800', letterSpacing: 1, textAlign: 'center' }, title: { color: colors.white, fontSize: 20, fontWeight: '800', textAlign: 'center', marginTop: 2 },
  faceFrame: { position: 'absolute', alignSelf: 'center', top: '18%', width: '68%', height: '47%', borderRadius: 140, borderWidth: 2, borderColor: colors.warning }, faceFrameReady: { borderColor: colors.normal },
  corner: { position: 'absolute', width: 28, height: 28, borderColor: colors.white },
  topLeft: { top: -3, left: -3, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 16 }, topRight: { top: -3, right: -3, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 16 },
  bottomLeft: { bottom: -3, left: -3, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 16 }, bottomRight: { bottom: -3, right: -3, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 16 },
  bottomPanel: { margin: 16, padding: 18, borderRadius: 22, backgroundColor: '#07111CEB', borderWidth: 1, borderColor: '#FFFFFF24' },
  status: { fontSize: 18, fontWeight: '800', textAlign: 'center' }, hint: { color: '#FFFFFFB8', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6 },
  phaseLabel: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1, textAlign: 'center', marginTop: 10 },
  progressTrack: { height: 7, borderRadius: 4, backgroundColor: '#FFFFFF24', overflow: 'hidden', marginTop: 16 }, progressFill: { height: '100%', backgroundColor: colors.normal },
  progressText: { color: colors.white, fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 7, marginBottom: 14 },
});
