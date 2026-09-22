import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, StatusBar, StyleSheet, View } from "react-native";
import * as Network from "expo-network";
import { SafeAreaView } from "react-native-safe-area-context";
import { ComputerVisionCamera } from "@/features/computer-vision";
import { createFatigueEngine } from "@/features/fatigue/engine";
import { FatigueAlarm } from "@/features/fatigue/fatigue-alarm";
import { KeepScreenAwake } from "@/features/fatigue/keep-screen-awake";
import { BottomNav } from "@/fatigueguard/components/BottomNav";
import { AdviceScreen } from "@/fatigueguard/screens/AdviceScreen";
import { CalibrationScreen } from "@/fatigueguard/screens/CalibrationScreen";
import { CameraSetupScreen } from "@/fatigueguard/screens/CameraSetupScreen";
import { DrivingScreen } from "@/fatigueguard/screens/DrivingScreen";
import { HistoryScreen } from "@/fatigueguard/screens/HistoryScreen";
import { HomeScreen } from "@/fatigueguard/screens/HomeScreen";
import { SessionSummaryScreen } from "@/fatigueguard/screens/SessionSummaryScreen";
import { SettingsScreen } from "@/fatigueguard/screens/SettingsScreen";
import { colors } from "@/fatigueguard/theme";
import type { Route, SessionSummary, TabName } from "@/fatigueguard/types";
import {
  addLocalFatigueEvent,
  completeLocalSession,
  createLocalSession,
} from "@/data/local-db";
import { syncPendingData } from "@/data/sync";

const emptySummary: SessionSummary = {
  durationSeconds: 0,
  warningCount: 0,
  criticalCount: 0,
  maxScore: 24,
  avgScore: 24,
};

export default function GuardApp() {
  const [route, setRoute] = useState<Route>({ kind: "tabs", tab: "home" });
  const [summary, setSummary] = useState<SessionSummary>(emptySummary);
  const activeSessionClientId = useRef<string | null>(null);
  const engine = useMemo(() => createFatigueEngine(), []);

  useEffect(() => {
    void syncPendingData().catch((error) =>
      console.warn("Background sync unavailable:", error),
    );
    const networkSubscription = Network.addNetworkStateListener(
      ({ isConnected }) => {
        if (isConnected)
          void syncPendingData().catch((error) =>
            console.warn("Background sync unavailable:", error),
          );
      },
    );
    const appStateSubscription = AppState.addEventListener(
      "change",
      (state) => {
        if (state === "active")
          void syncPendingData().catch((error) =>
            console.warn("Background sync unavailable:", error),
          );
      },
    );
    return () => {
      networkSubscription.remove();
      appStateSubscription.remove();
    };
  }, []);

  // DrivingScreen өөрийн preview camera-г эзэмшинэ. Калибрацийн дэлгэцэд л
  // харагдахгүй camera хэрэгтэй; driving үед хоёрыг зэрэг mount хийж болохгүй.
  const calibrating = route.kind === "flow" && route.screen === "calibration";
  const keepAwake =
    route.kind === "flow" &&
    route.screen !== "summary" &&
    route.screen !== "advice";
  const showTab = (tab: TabName) => setRoute({ kind: "tabs", tab });
  const showFlow = (
    screen: "camera" | "calibration" | "driving" | "summary" | "advice",
  ) => setRoute({ kind: "flow", screen });

  const handleCalibrationComplete = async () => {
    const session = await createLocalSession();
    activeSessionClientId.current = session.clientId;
    showFlow("driving");
  };

  const handleFinish = async (data: SessionSummary) => {
    const clientId = activeSessionClientId.current;
    if (clientId) {
      await completeLocalSession(clientId, {
        endedAt: new Date().toISOString(),
        fatigueScore: data.maxScore,
        warningCount: data.warningCount,
        criticalEventCount: data.criticalCount,
      });
      for (const event of engine.getEvents()) {
        if (
          event.type !== "fatigue_warning" &&
          event.type !== "fatigue_critical"
        )
          continue;
        await addLocalFatigueEvent({
          client_id: `event:${event.id}`,
          session_client_id: clientId,
          driver_id: 1,
          level: event.type === "fatigue_warning" ? "warning" : "critical",
          fatigue_score: null,
          event_at: new Date(event.occurredAt).toISOString(),
          metadata_json: null,
        });
      }
      void syncPendingData().catch((error) =>
        console.warn("Session sync deferred:", error),
      );
    }
    setSummary(data);
    showFlow("summary");
  };

  let screen: React.ReactNode;
  if (route.kind === "tabs") {
    screen =
      route.tab === "home" ? (
        <HomeScreen onStart={() => showFlow("camera")} />
      ) : route.tab === "history" ? (
        <HistoryScreen />
      ) : (
        <SettingsScreen />
      );
  } else if (route.screen === "camera") {
    screen = (
      <CameraSetupScreen
        onBack={() => showTab("home")}
        onContinue={() => showFlow("calibration")}
      />
    );
  } else if (route.screen === "calibration") {
    screen = (
      <CalibrationScreen
        engine={engine}
        onBack={() => showFlow("camera")}
        onComplete={handleCalibrationComplete}
      />
    );
  } else if (route.screen === "driving") {
    screen = <DrivingScreen engine={engine} onFinish={handleFinish} />;
  } else if (route.screen === "summary") {
    screen = (
      <SessionSummaryScreen
        data={summary}
        onHome={() => showTab("home")}
        onAdvice={() => showFlow("advice")}
      />
    );
  } else if (route.screen === "advice") {
    screen = (
      <AdviceScreen summary={summary} onBack={() => showFlow("summary")} />
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <View style={styles.app}>
        {keepAwake ? <KeepScreenAwake /> : null}
        {route.kind === "flow" && route.screen === "driving" ? (
          <FatigueAlarm engine={engine} />
        ) : null}
        {calibrating ? (
          <ComputerVisionCamera
            active
            style={styles.monitorCamera}
            onObservation={engine.accept}
            onStatusChange={engine.onCameraStatus}
          />
        ) : null}
        {screen}
        {route.kind === "tabs" ? (
          <BottomNav active={route.tab} onChange={showTab} />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  app: { flex: 1, backgroundColor: colors.background },
  monitorCamera: { position: "absolute", width: 1, height: 1, opacity: 0 },
});
