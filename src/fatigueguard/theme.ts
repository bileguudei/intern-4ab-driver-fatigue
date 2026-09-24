import { DynamicColorIOS, Platform, PlatformColor, type ColorValue } from 'react-native';

const adaptive = (
  light: string,
  dark: string,
  android: string,
): ColorValue => {
  if (Platform.OS === 'ios') return DynamicColorIOS({ light, dark });
  if (Platform.OS === 'android') return PlatformColor(android);
  return dark;
};

export const colors = {
  primary: '#3B82F6', primaryDark: '#1D4ED8', normal: '#22C55E', normalDark: '#14532D',
  warning: '#F59E0B', warningDark: '#78350F', critical: '#EF4444', criticalDark: '#7F1D1D',
  background: adaptive('#F8FAFC', '#0A0E1A', '?android:attr/colorBackground'),
  surface: adaptive('#FFFFFF', '#131929', '?android:attr/colorBackgroundFloating'),
  surfaceAlt: adaptive('#E8EEF7', '#1C2438', '?android:attr/colorButtonNormal'),
  border: adaptive('#D9E2EF', '#1E2D45', '?android:attr/colorControlNormal'),
  borderBright: adaptive('#C3D0E2', '#2A3F5F', '?android:attr/colorControlNormal'),
  text: adaptive('#0F172A', '#F1F5F9', '?android:attr/textColorPrimary'),
  textSecondary: adaptive('#475569', '#94A3B8', '?android:attr/textColorSecondary'),
  textMuted: adaptive('#64748B', '#64748B', '?android:attr/textColorSecondary'),
  white: '#FFFFFF', black: '#000000',
} as const;

export const spacing = { xs: 6, sm: 10, md: 16, lg: 20, xl: 24 } as const;
