import { SafeAreaView } from "react-native-safe-area-context";
import { Pressable, StatusBar, StyleSheet, Text, View } from "react-native";

const recommendations = [
  "Pull over at the nearest safe stop and rest for 15–20 minutes.",
  "Drink water and cool down before continuing the drive.",
  "Avoid long stretches of night driving until the fatigue level drops.",
];

export default function GuardApp() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#f3f3f3" />
      <View style={styles.page}>
        <View style={styles.card}>
          <Text style={styles.badge}>RAG AI guidance</Text>
          <Text style={styles.title}>Driver recommendations</Text>

          <Text style={styles.subtitle}>Current fatigue state</Text>
          <Text style={styles.body}>
            Based on the latest driving indicators, the system recommends a
            short break and a lower-risk driving plan.
          </Text>

          <View style={styles.priorityBox}>
            <Text style={styles.priorityLabel}>Priority action</Text>
            <Text style={styles.priorityText}>
              Find a safe stopping point and take a rest break immediately.
            </Text>
          </View>

          <Text style={styles.sectionTitle}>Recommended actions</Text>
          {recommendations.map((item, index) => (
            <View key={item} style={styles.row}>
              <Text style={styles.check}>{index + 1}</Text>
              <Text style={styles.itemText}>{item}</Text>
            </View>
          ))}

          <Pressable style={styles.primaryButton} accessibilityRole="button">
            <Text style={styles.primaryButtonText}>
              Continue driving safely
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f3f3f3",
  },
  page: {
    flex: 1,
    backgroundColor: "#f3f3f3",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  card: {
    width: "100%",
    maxWidth: 640,
    backgroundColor: "#f7f7f7",
    borderColor: "#d7d7d7",
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 24,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "#eaf7ef",
    color: "#2a7a54",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 18,
  },
  title: {
    color: "#1d1d1f",
    fontSize: 30,
    fontWeight: "700",
    marginBottom: 12,
  },
  subtitle: {
    color: "#4d4d52",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  body: {
    color: "#4a4a4a",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 18,
  },
  priorityBox: {
    backgroundColor: "#fff7e8",
    borderLeftWidth: 4,
    borderLeftColor: "#f59e0b",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 18,
  },
  priorityLabel: {
    color: "#8a5b00",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  priorityText: {
    color: "#2d2d2d",
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 22,
  },
  sectionTitle: {
    color: "#1d1d1f",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 12,
    gap: 12,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#dff7e9",
    color: "#1b8f5a",
    textAlign: "center",
    lineHeight: 24,
    fontWeight: "700",
    fontSize: 12,
  },
  itemText: {
    flex: 1,
    color: "#2f2f32",
    fontSize: 15,
    lineHeight: 22,
  },
  primaryButton: {
    marginTop: 18,
    backgroundColor: "#1f8de5",
    borderRadius: 10,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "700",
  },
});
