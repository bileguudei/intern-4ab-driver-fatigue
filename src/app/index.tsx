import { SafeAreaView } from "react-native-safe-area-context";
import { Pressable, StatusBar, StyleSheet, Text, View } from "react-native";

const listItems = [
  { label: "R2 Storage", value: "10 GB/month" },
  { label: "Class A operations", value: "1 million/month" },
  { label: "Class B operations", value: "10 million/month" },
];

const coverageRows = [
  { label: "R2 Storage", value: "$0.015/GB-month" },
  { label: "Class A operations", value: "$4.50/million" },
  { label: "Class B operations", value: "$0.36/million" },
];

export default function GuardApp() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#f3f3f3" />
      <View style={styles.page}>
        <View style={styles.cardRow}>
          <View style={styles.card}>
            <View style={styles.headerRow}>
              <Text style={styles.lockIcon}>◌</Text>
              <Text style={styles.secureText}>Secure billing</Text>
            </View>

            <Text style={styles.title}>Activate R2</Text>

            <Text style={styles.captionTitle}>Purchase complete</Text>
            <Text style={styles.captionText}>
              Thank you for your purchase! The subscription is active and you
              can begin using the service.
            </Text>

            <Pressable style={styles.primaryButton} accessibilityRole="button">
              <Text style={styles.primaryButtonText}>
                Continue to Data Catalog
              </Text>
            </Pressable>
          </View>

          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Order summary</Text>

            <View style={styles.rowBetween}>
              <Text style={styles.rowLabel}>R2</Text>
              <Text style={styles.rowValue}>$0 / month</Text>
            </View>

            <Text style={styles.sectionTitle}>Included features</Text>
            <Text style={styles.featureIntro}>
              S3-compatible object storage with zero egress fees
            </Text>

            {listItems.map((item) => (
              <View key={item.label} style={styles.featureRow}>
                <Text style={styles.check}>✓</Text>
                <Text style={styles.featureText}>{item.label}</Text>
                <Text style={styles.featureValue}>{item.value}</Text>
              </View>
            ))}

            <Text style={styles.sectionTitle}>Overage rates</Text>
            {coverageRows.map((item) => (
              <View key={item.label} style={styles.rowBetween}>
                <Text style={styles.rowLabel}>{item.label}</Text>
                <Text style={styles.rowValue}>{item.value}</Text>
              </View>
            ))}

            <View style={styles.footerDivider} />

            <View style={styles.rowBetween}>
              <Text style={styles.rowLabel}>Due today*</Text>
              <Text style={styles.rowValue}>$0/month</Text>
            </View>

            <Text style={styles.footerNote}>
              Base fee charged today. Additional usage beyond included allowance
              billed monthly.
            </Text>
          </View>
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
  cardRow: {
    width: "100%",
    maxWidth: 1020,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "stretch",
    gap: 28,
  },
  card: {
    flex: 1,
    maxWidth: 480,
    minHeight: 420,
    backgroundColor: "#f7f7f7",
    borderColor: "#d9d9d9",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 26,
    paddingTop: 22,
    paddingBottom: 24,
    shadowColor: "#000",
    shadowOpacity: 0.03,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
  },
  summaryCard: {
    flex: 1,
    maxWidth: 480,
    minHeight: 420,
    backgroundColor: "#f7f7f7",
    borderColor: "#d9d9d9",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 26,
    paddingTop: 18,
    paddingBottom: 18,
    shadowColor: "#000",
    shadowOpacity: 0.03,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 34,
  },
  lockIcon: {
    color: "#37a66d",
    fontSize: 17,
    fontWeight: "700",
  },
  secureText: {
    color: "#2d7a58",
    fontSize: 16,
    fontWeight: "600",
  },
  title: {
    color: "#1d1d1f",
    fontSize: 44,
    fontWeight: "700",
    lineHeight: 52,
    marginBottom: 18,
  },
  captionTitle: {
    color: "#1d1d1f",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 10,
  },
  captionText: {
    color: "#4a4a4a",
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 420,
  },
  primaryButton: {
    marginTop: 26,
    backgroundColor: "#1f8de5",
    borderRadius: 10,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#1f8de5",
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
  },
  summaryTitle: {
    color: "#1d1d1f",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 18,
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  rowLabel: {
    color: "#2f2f32",
    fontSize: 15,
    fontWeight: "500",
  },
  rowValue: {
    color: "#2f2f32",
    fontSize: 15,
    fontWeight: "500",
  },
  sectionTitle: {
    marginTop: 14,
    marginBottom: 8,
    color: "#1d1d1f",
    fontSize: 16,
    fontWeight: "700",
  },
  featureIntro: {
    color: "#4a4a4a",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  featureText: {
    flex: 1,
    marginLeft: 10,
    color: "#2f2f32",
    fontSize: 15,
    fontWeight: "500",
  },
  featureValue: {
    color: "#2f2f32",
    fontSize: 15,
    fontWeight: "500",
    textAlign: "right",
  },
  check: {
    color: "#2ab16d",
    fontSize: 17,
    fontWeight: "700",
  },
  footerDivider: {
    height: 1,
    backgroundColor: "#d7d7d7",
    marginTop: 16,
    marginBottom: 16,
  },
  footerNote: {
    color: "#4a4a4a",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    maxWidth: 330,
  },
});
