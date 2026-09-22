import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Card, Header, PrimaryButton, SectionTitle } from "../components/ui";
import { colors } from "../theme";
import type { SessionSummary } from "../types";

const duration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export function SessionSummaryScreen({
  data,
  onHome,
  onAdvice,
}: {
  data: SessionSummary;
  onHome: () => void;
  onAdvice: () => void;
}) {
  const safety = data.criticalCount === 0 ? "Сайн" : "Анхаарах";

  return (
    <View style={styles.screen}>
      <Header title="Сессийн хураангуй" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.check}>
            <Text style={styles.checkText}>✓</Text>
          </View>
          <Text style={styles.title}>Жолоодлого дууслаа</Text>
          <Text style={styles.subtitle}>Таны сесс амжилттай хадгалагдлаа</Text>
        </View>

        <View style={styles.grid}>
          <Kpi
            label="Хугацаа"
            value={duration(data.durationSeconds)}
            color={colors.primary}
          />
          <Kpi
            label="Дундаж оноо"
            value={String(data.avgScore)}
            color={colors.normal}
          />
          <Kpi
            label="Их оноо"
            value={String(data.maxScore)}
            color={data.maxScore >= 70 ? colors.critical : colors.warning}
          />
          <Kpi
            label="Аюулгүй байдал"
            value={safety}
            color={safety === "Сайн" ? colors.normal : colors.warning}
          />
        </View>

        <SectionTitle>ҮЙЛ ЯВДЛЫН ТҮҮХ</SectionTitle>
        <Card>
          <Timeline
            color={colors.normal}
            time="00:00"
            title="Жолоодлого эхэлсэн"
          />
          {data.warningCount > 0 ? (
            <Timeline
              color={colors.warning}
              time="Сессийн үед"
              title={`Анхааруулга · ${data.warningCount} удаа`}
            />
          ) : null}
          {data.criticalCount > 0 ? (
            <Timeline
              color={colors.critical}
              time="Сессийн үед"
              title={`Аюултай төлөв · ${data.criticalCount} удаа`}
            />
          ) : null}
          <Timeline
            color={colors.primary}
            time={duration(data.durationSeconds)}
            title="Жолоодлого дууссан"
            last
          />
        </Card>

        <Card style={styles.tip}>
          <Text style={styles.tipTitle}>✦ AI дүгнэлт</Text>
          <Text style={styles.tipText}>
            {data.criticalCount === 0
              ? "Жолоодлогын төлөв тогтвортой байлаа. Тогтмол завсарлага авч хэвшээрэй."
              : "Ядралтын өндөр түвшин илэрсэн. Дараагийн удаа жолоодохоос өмнө хангалттай амарна уу."}
          </Text>
        </Card>

        <PrimaryButton label="AI зөвлөгөө" onPress={onAdvice} />
        <View style={styles.footerSpacer} />
        <PrimaryButton label="Нүүр хуудас руу" onPress={onHome} />
      </ScrollView>
    </View>
  );
}

function Kpi({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <Card style={styles.kpi}>
      <Text style={[styles.kpiValue, { color }]}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </Card>
  );
}

function Timeline({
  color,
  time,
  title,
  last = false,
}: {
  color: string;
  time: string;
  title: string;
  last?: boolean;
}) {
  return (
    <View style={styles.timeline}>
      <View style={styles.timelineRail}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        {!last ? <View style={styles.verticalLine} /> : null}
      </View>
      <View style={styles.timelineCopy}>
        <Text style={styles.timelineTitle}>{title}</Text>
        <Text style={styles.timelineTime}>{time}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  hero: { alignItems: "center", marginBottom: 24 },
  check: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: colors.normalDark,
    alignItems: "center",
    justifyContent: "center",
  },
  checkText: { color: colors.normal, fontSize: 42, fontWeight: "800" },
  title: { color: colors.text, fontSize: 24, fontWeight: "800", marginTop: 14 },
  subtitle: { color: colors.textMuted, marginTop: 5 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 24 },
  kpi: { width: "48%", alignItems: "center" },
  kpiValue: { fontSize: 24, fontWeight: "800" },
  kpiLabel: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  timeline: { flexDirection: "row", minHeight: 58 },
  timelineRail: { width: 24, alignItems: "center" },
  dot: { width: 11, height: 11, borderRadius: 6, marginTop: 4 },
  verticalLine: {
    flex: 1,
    width: 1,
    backgroundColor: colors.borderBright,
    marginVertical: 4,
  },
  timelineCopy: { flex: 1, paddingBottom: 16 },
  timelineTitle: { color: colors.text, fontWeight: "600" },
  timelineTime: { color: colors.textMuted, fontSize: 11, marginTop: 3 },
  tip: { marginVertical: 18, borderColor: colors.primary },
  tipTitle: { color: colors.primary, fontWeight: "800", marginBottom: 7 },
  tipText: { color: colors.textSecondary, lineHeight: 20 },
  footerSpacer: { height: 12 },
});
