import { useMemo, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ComputerVisionCamera } from '@/features/computer-vision';
import { createFatigueEngine } from '@/features/fatigue/engine';
import { BottomNav } from '@/fatigueguard/components/BottomNav';
import { CalibrationScreen } from '@/fatigueguard/screens/CalibrationScreen';
import { CameraSetupScreen } from '@/fatigueguard/screens/CameraSetupScreen';
import { DrivingScreen } from '@/fatigueguard/screens/DrivingScreen';
import { HistoryScreen } from '@/fatigueguard/screens/HistoryScreen';
import { HomeScreen } from '@/fatigueguard/screens/HomeScreen';
import { SessionSummaryScreen } from '@/fatigueguard/screens/SessionSummaryScreen';
import { SettingsScreen } from '@/fatigueguard/screens/SettingsScreen';
import { colors } from '@/fatigueguard/theme';
import type { Route, SessionSummary, TabName } from '@/fatigueguard/types';

const emptySummary: SessionSummary = { durationSeconds: 0, warningCount: 0, criticalCount: 0, maxScore: 24, avgScore: 24 };

export default function GuardApp() {
  const [route, setRoute] = useState<Route>({ kind: 'tabs', tab: 'home' });
  const [summary, setSummary] = useState<SessionSummary>(emptySummary);
  // Калибраци, жолоодлогын турш нэг engine, нэг камер. Камерыг дэлгэц бүрт
  // тусад нь байрлуулбал солигдох бүрд ~1 сек унтарч, калибраци тасарна.
  const engine = useMemo(() => createFatigueEngine(), []);
  const monitoring = route.kind === 'flow' && (route.screen === 'calibration' || route.screen === 'driving');
  const showTab = (tab: TabName) => setRoute({ kind: 'tabs', tab });
  const showFlow = (screen: 'camera' | 'calibration' | 'driving' | 'summary') => setRoute({ kind: 'flow', screen });
  let screen: React.ReactNode;
  if (route.kind === 'tabs') screen = route.tab === 'home' ? <HomeScreen onStart={() => showFlow('camera')} /> : route.tab === 'history' ? <HistoryScreen /> : <SettingsScreen />;
  else if (route.screen === 'camera') screen = <CameraSetupScreen onBack={() => showTab('home')} onContinue={() => showFlow('calibration')} />;
  else if (route.screen === 'calibration') screen = <CalibrationScreen engine={engine} onBack={() => showFlow('camera')} onComplete={() => showFlow('driving')} />;
  else if (route.screen === 'driving') screen = <DrivingScreen engine={engine} onFinish={(data) => { setSummary(data); showFlow('summary'); }} />;
  else screen = <SessionSummaryScreen data={summary} onHome={() => showTab('home')} />;
  return <SafeAreaView style={styles.safe}><StatusBar barStyle="light-content" backgroundColor={colors.background} /><View style={styles.app}>{monitoring ? <ComputerVisionCamera active style={styles.monitorCamera} onObservation={engine.accept} onStatusChange={engine.onCameraStatus} /> : null}{screen}{route.kind === 'tabs' ? <BottomNav active={route.tab} onChange={showTab} /> : null}</View></SafeAreaView>;
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.background }, app: { flex: 1, backgroundColor: colors.background }, monitorCamera: { position: 'absolute', width: 1, height: 1, opacity: 0 } });
