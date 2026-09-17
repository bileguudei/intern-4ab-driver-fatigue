import type { PropsWithChildren, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../theme';

export function Card({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) { return <View style={[styles.card, style]}>{children}</View>; }
export function PrimaryButton({ label, onPress, disabled = false, icon }: { label: string; onPress: () => void; disabled?: boolean; icon?: ReactNode }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>{icon}<Text style={styles.buttonText}>{label}</Text></Pressable>;
}
export function Header({ title, subtitle, onBack, badge }: { title: string; subtitle?: string; onBack?: () => void; badge?: string }) {
  return <View style={styles.header}>{onBack ? <Pressable accessibilityLabel="Буцах" onPress={onBack} style={styles.backButton}><Text style={styles.backText}>‹</Text></Pressable> : null}<View style={styles.headerCopy}><Text style={styles.headerTitle}>{title}</Text>{subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}</View>{badge ? <Text style={styles.badge}>{badge}</Text> : null}</View>;
}
export function SectionTitle({ children }: PropsWithChildren) { return <Text style={styles.sectionTitle}>{children}</Text>; }
const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 18, padding: 16 },
  button: { minHeight: 56, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 20 }, buttonText: { color: colors.white, fontSize: 17, fontWeight: '700' }, disabled: { opacity: 0.4 }, pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  header: { minHeight: 68, paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }, backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, backText: { color: colors.text, fontSize: 32, lineHeight: 34 }, headerCopy: { flex: 1 }, headerTitle: { color: colors.text, fontSize: 21, fontWeight: '700' }, headerSubtitle: { color: colors.textMuted, fontSize: 13, marginTop: 2 }, badge: { color: colors.textMuted, backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderWidth: 1, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6, overflow: 'hidden', fontWeight: '600' }, sectionTitle: { color: colors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, marginBottom: 10, textTransform: 'uppercase' },
});
