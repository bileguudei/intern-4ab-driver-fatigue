import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { needsAiAdvice } from "@/features/fatigue/advice-gate";
import { colors } from "../theme";
import type { SessionSummary } from "../types";

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE ?? "http://127.0.0.1:8787";
const APP_API_KEY = process.env.EXPO_PUBLIC_APP_API_KEY ?? "";

export function AdviceScreen({
  summary,
  sessionClientId,
  onBack,
}: {
  summary: SessionSummary;
  sessionClientId: string | null;
  onBack: () => void;
}) {
  // Ядаргааны шинж илрээгүй аялалд AI дуудахгүй — апп өөрөө мессеж харуулна.
  const lowRisk = !needsAiAdvice(summary);
  const [advice, setAdvice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!lowRisk);

  useEffect(() => {
    if (lowRisk) return;
    let isMounted = true;

    const loadAdvice = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`${API_BASE_URL}/api/rag/advice`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${APP_API_KEY}`,
          },
          body: JSON.stringify({
            sessionId: sessionClientId,
            driverId: 1,
            fatigueScore: summary.maxScore,
            averageFatigueScore: summary.avgScore,
            maxFatigueScore: summary.maxScore,
            driveDurationMinutes: Math.max(
              1,
              Math.round(summary.durationSeconds / 60),
            ),
            prolongedEyeClosureCount: summary.longClosureCount ?? 0,
            headNodCount: summary.quickNodCount ?? 0,
            perclos: summary.perclos ?? null,
            // Сервер эрсдэлийн түвшинг тогтооход хэрэглэнэ. Хуучин сервер тоохгүй.
            warningCount: summary.warningCount,
            criticalCount: summary.criticalCount,
          }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(
            payload?.error ?? `Request failed (${response.status})`,
          );
        }

        const payload = await response.json();
        const nextAdvice =
          typeof payload?.advice === "string" &&
          payload.advice.trim().length > 0
            ? payload.advice
            : "No safety advice was returned from the backend.";

        if (isMounted) setAdvice(nextAdvice);
      } catch (fetchError) {
        if (!isMounted) return;

        const message =
          fetchError instanceof Error
            ? fetchError.message
            : "Unable to load driver guidance.";
        setError(message);
        setAdvice(
          "Take a break and find a safe stopping area before continuing to drive.",
        );
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    void loadAdvice();
    return () => {
      isMounted = false;
    };
  }, [summary, sessionClientId, lowRisk]);

  return (
    <View style={styles.screen}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>AI guidance</Text>
        <Pressable style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.label}>Driver fatigue summary</Text>
          <Text style={styles.metricLine}>
            Max score: {summary.maxScore} · Avg score: {summary.avgScore}
          </Text>
          {/* Оноо бага ч дохио гарсан бол AI зөвлөгөө яагаад гарсныг харуулна. */}
          <Text style={styles.metricLine}>
            Анхааруулга: {summary.warningCount} · Аюултай дохио:{" "}
            {summary.criticalCount}
          </Text>
          <Text style={styles.metricLine}>
            Duration: {Math.floor(summary.durationSeconds / 60)}m{" "}
            {summary.durationSeconds % 60}s
          </Text>
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primary} size="small" />
            <Text style={styles.loadingText}>Loading AI guidance...</Text>
          </View>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {lowRisk ? (
          <View style={styles.adviceBox}>
            <Text style={styles.adviceTitle}>Ядаргааны шинж илрээгүй</Text>
            <Text style={styles.adviceText}>
              Энэ аялалд анхааруулга гараагүй, ядаргааны оноо хэвийн байлаа
              (дээд тал нь {summary.maxScore}/100). Урт замд 2 цаг тутам 15
              минут амарч, шөнө хангалттай унтаарай.
            </Text>
            <Text style={styles.note}>
              AI зөвлөгөө ядаргааны шинж илэрсэн аялалд гарна.
            </Text>
          </View>
        ) : null}

        {advice ? (
          <View style={styles.adviceBox}>
            <Text style={styles.adviceTitle}>Recommended action</Text>
            <Text style={styles.adviceText}>{advice}</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: 18,
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "800",
  },
  backButton: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  content: {
    gap: 14,
    paddingBottom: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  metricLine: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 24,
  },
  loadingBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 18,
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  errorText: {
    color: "#fca5a5",
    backgroundColor: "rgba(239, 68, 68, 0.08)",
    borderColor: "rgba(239, 68, 68, 0.2)",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 13,
  },
  adviceBox: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  adviceTitle: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 10,
  },
  adviceText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 24,
  },
  note: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 10,
  },
});
