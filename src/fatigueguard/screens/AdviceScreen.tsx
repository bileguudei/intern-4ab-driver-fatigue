import { Pressable, StyleSheet, Text, View } from "react-native";

export function AdviceScreen({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.screen}>
      <View style={styles.topPill}>
        <Text style={styles.topPillText}>
          ragii tusad ni file bolgoh hadgalah uu
        </Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.paragraph}>
          <Text style={styles.textPrimary}>
            Тийм, тусдаа файл болох нь зөв. Одоо RAG дэлгэц апп-ын үндсэн
            файл{" "}
          </Text>
          <Text style={styles.inlineCode}>index.tsx</Text>
          <Text style={styles.textPrimary}> -ээс авалж тул жоолоодогын.</Text>
        </Text>

        <Text style={styles.paragraph}>Хийх зүйл:</Text>

        <Text style={styles.listItem}>
          <Text style={styles.number}>1.</Text>
          <Text style={styles.textPrimary}> RAG дэлгэцийг </Text>
          <Text style={styles.inlineLink}>
            src/fatigueguard/screens/AdviceScreen.tsx
          </Text>
          <Text style={styles.textPrimary}>
            {" "}
            болгож зөөн. Код өвөрлэгдэхгүй, зохих байршин солигдоно.
          </Text>
        </Text>

        <Text style={styles.listItem}>
          <Text style={styles.number}>2.</Text>
          <Text style={styles.inlineCode}>index.tsx</Text>
          <Text style={styles.textPrimary}>
            {" "}
            -ийг #21-аас өмнөх хувилбараар сэргээх: камер, калибраци,
            жолоодлого, дохио, sync.
          </Text>
        </Text>

        <Text style={styles.listItem}>
          <Text style={styles.number}>3.</Text>
          <Text style={styles.textPrimary}>
            {" "}
            AdviceScreen-ийн үрсгэлд холбох. Хамгийн тохиромжтой нь аяллын
            дүнгийн дэлгэц дээр «AI зөвлөгөө» товч: жолоодлого дууссаны дараа,
            машин зогссон үед нэгтгэнэ. Жолоо барих үед харагдахгүй.
          </Text>
        </Text>

        <Text style={styles.paragraph}>
          <Text style={styles.textPrimary}>Анхаарах: RAG дэлгэц нь </Text>
          <Text style={styles.inlineCode}>zaaanm7-ий</Text>
          <Text style={styles.textPrimary}>, </Text>
          <Text style={styles.inlineCode}>index.tsx</Text>
          <Text style={styles.textPrimary}>
            {" "}
            -ийн UI-тай айлж. Засвар хийсээд өмнө эдгээр нөхцлөөр айлтагаагаа
            зөрчидоно.
          </Text>
        </Text>

        <View style={styles.metaRow}>
          <View style={styles.metaActions}>
            <Text style={styles.metaIcon}>◫</Text>
            <Text style={styles.metaIcon}>⟲</Text>
            <Text style={styles.metaIcon}>⎇</Text>
          </View>
          <Text style={styles.metaTime}>3 minutes ago</Text>
        </View>
      </View>

      <View style={styles.bottomBar}>
        <Text style={styles.branchText}>sergeg main</Text>

        <View style={styles.actionsRow}>
          <Text style={styles.diffText}>+2,556 -118</Text>
          <Pressable
            style={styles.prButton}
            accessibilityRole="button"
            onPress={onBack}
          >
            <Text style={styles.prButtonText}>Back</Text>
          </Pressable>
          <Text style={styles.closeIcon}>×</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#0b1117",
    paddingTop: 18,
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  topPill: {
    alignSelf: "flex-end",
    backgroundColor: "rgba(148, 163, 184, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
    marginTop: 8,
    marginBottom: 28,
  },
  topPillText: {
    color: "#f3f4f6",
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "500",
  },
  content: {
    flex: 1,
    paddingLeft: 6,
    paddingTop: 8,
  },
  paragraph: {
    color: "#ebedf0",
    fontSize: 18,
    lineHeight: 34,
    marginBottom: 12,
  },
  textPrimary: {
    color: "#ebedf0",
  },
  inlineCode: {
    color: "#ef7f7f",
    backgroundColor: "rgba(239, 127, 127, 0.1)",
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 1,
    fontFamily: "monospace",
  },
  inlineLink: {
    color: "#6ec8ff",
    textDecorationLine: "underline",
    textDecorationColor: "#6ec8ff",
  },
  listItem: {
    color: "#ebedf0",
    fontSize: 18,
    lineHeight: 34,
    marginBottom: 12,
  },
  number: {
    color: "#ebedf0",
    fontWeight: "700",
    marginRight: 8,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 20,
    opacity: 0.8,
  },
  metaActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginRight: 18,
  },
  metaIcon: {
    color: "#d1d5db",
    fontSize: 17,
    opacity: 0.9,
  },
  metaTime: {
    color: "#cbd5e1",
    fontSize: 14,
    lineHeight: 22,
  },
  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(17, 24, 39, 0.9)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.12)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 12,
  },
  branchText: {
    color: "#d1d5db",
    fontSize: 15,
    fontWeight: "500",
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  diffText: {
    color: "#34d399",
    fontSize: 14,
    fontWeight: "700",
    marginRight: 12,
  },
  prButton: {
    backgroundColor: "rgba(148, 163, 184, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.2)",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 12,
  },
  prButtonText: {
    color: "#f8fafc",
    fontSize: 14,
    fontWeight: "600",
  },
  closeIcon: {
    color: "#d1d5db",
    fontSize: 22,
    lineHeight: 22,
    fontWeight: "400",
  },
});
