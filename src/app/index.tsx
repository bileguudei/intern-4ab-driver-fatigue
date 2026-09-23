import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, BackHandler, StatusBar, StyleSheet, View } from "react-native";
import * as Network from "expo-network";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  createFatigueEngine,
  type FatigueEngine,
} from "@/features/fatigue/engine";
import { FatigueAlarm } from "@/features/fatigue/fatigue-alarm";
import { KeepScreenAwake } from "@/features/fatigue/keep-screen-awake";
import { cancelLeftoverStoppedReminders } from "@/features/fatigue/stopped-reminders";
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
  finalizeAbandonedSessions,
} from "@/data/local-db";
import { syncPendingData } from "@/data/sync";

const emptySummary: SessionSummary = {
  durationSeconds: 0,
  warningCount: 0,
  criticalCount: 0,
  maxScore: 24,
  avgScore: 24,
};

/** Engine-ийн шинэ warning, critical явдлуудыг локал санд бичнэ. */
async function saveFatigueEvents(
  engine: FatigueEngine,
  sessionClientId: string,
  saved: Set<string>,
) {
  for (const event of engine.getEvents()) {
    if (event.type !== "fatigue_warning" && event.type !== "fatigue_critical")
      continue;
    if (saved.has(event.id)) continue;
    saved.add(event.id);
    await addLocalFatigueEvent({
      client_id: `event:${event.id}`,
      session_client_id: sessionClientId,
      driver_id: 1,
      level: event.type === "fatigue_warning" ? "warning" : "critical",
      fatigue_score: null,
      event_at: new Date(event.occurredAt).toISOString(),
      metadata_json: null,
    });
  }
}

export default function GuardApp() {
  const [route, setRoute] = useState<Route>({ kind: "tabs", tab: "home" });
  const [summary, setSummary] = useState<SessionSummary>(emptySummary);
  // Калибрациас буцаж ирэхэд камерын дэлгэц дахин автоматаар урагшилбал
  // хэрэглэгч гарч чадахгүй давталтад ордог.
  const [cameraAutoContinue, setCameraAutoContinue] = useState(true);
  const activeSessionClientId = useRef<string | null>(null);
  const savedEventIds = useRef(new Set<string>());
  const engine = useMemo(() => createFatigueEngine(), []);

  // Явдлыг гармагц хадгална. Өмнө нь зөвхөн «дуусгах» дарахад бичдэг байсан
  // тул апп унах, хаагдахад тухайн аяллын бүх явдал алдагддаг байв.
  useEffect(
    () =>
      engine.subscribe(() => {
        const sessionClientId = activeSessionClientId.current;
        if (sessionClientId === null) return;
        void saveFatigueEvents(
          engine,
          sessionClientId,
          savedEventIds.current,
        ).catch((error) => console.warn("Unable to save fatigue event:", error));
      }),
    [engine],
  );

  useEffect(() => {
    // Апп жолоодлогын дундуур хаагдсан бол «хяналт зогслоо» сануулга үлдсэн байж
    // болно. Одоо жолоодлого явагдаагүй тул цуцална.
    void cancelLeftoverStoppedReminders().catch((error) =>
      console.warn("Unable to clear monitoring reminders:", error),
    );
    // Өмнө нь дуусаагүй үлдсэн сессийг эхлээд хааж, дараа нь sync хийнэ.
    void finalizeAbandonedSessions()
      .catch((error) =>
        console.warn("Unable to close unfinished sessions:", error),
      )
      .then(() => syncPendingData())
      .catch((error) => console.warn("Background sync unavailable:", error));
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

  // Android-ийн back: табуудаас нүүр рүү, хураангуй болон зөвлөгөөнөөс өмнөх
  // алхам руу. Камер, калибраци, жолоодлогын дэлгэцүүд back-аа өөрсдөө барина.
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (route.kind === "tabs") {
          if (route.tab === "home") return false;
          setRoute({ kind: "tabs", tab: "home" });
          return true;
        }
        if (route.screen === "summary") {
          setRoute({ kind: "tabs", tab: "home" });
          return true;
        }
        if (route.screen === "advice") {
          setRoute({ kind: "flow", screen: "summary" });
          return true;
        }
        return false;
      },
    );
    return () => subscription.remove();
  }, [route]);

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
        avgScore: data.avgScore,
        warningCount: data.warningCount,
        criticalEventCount: data.criticalCount,
      });
      await saveFatigueEvents(engine, clientId, savedEventIds.current);
      // Дараагийн аяллын калибрацийн үеийн явдлыг энэ сесст бичихгүй.
      activeSessionClientId.current = null;
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
        <HomeScreen
          onStart={() => {
            setCameraAutoContinue(true);
            showFlow("camera");
          }}
        />
      ) : route.tab === "history" ? (
        <HistoryScreen />
      ) : (
        <SettingsScreen />
      );
  } else if (route.screen === "camera") {
    screen = (
      <CameraSetupScreen
        autoContinue={cameraAutoContinue}
        onBack={() => showTab("home")}
        onContinue={() => showFlow("calibration")}
      />
    );
  } else if (route.screen === "calibration") {
    screen = (
      <CalibrationScreen
        engine={engine}
        onBack={() => {
          setCameraAutoContinue(false);
          showFlow("camera");
        }}
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
});
