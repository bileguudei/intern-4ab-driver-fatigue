import * as SecureStore from 'expo-secure-store';
import { Appearance, Platform } from 'react-native';
import { useSyncExternalStore } from 'react';

export type ThemePreference = 'light' | 'dark';

const STORAGE_KEY = 'fatigueguard.theme-preference';
const listeners = new Set<() => void>();
let preference: ThemePreference = 'dark';
let initialized = false;

const isThemePreference = (value: string | null): value is ThemePreference =>
  value === 'light' || value === 'dark';

const applyPreference = (next: ThemePreference) => {
  if (Platform.OS === 'web') return;
  Appearance.setColorScheme(next);
};

const publish = (next: ThemePreference) => {
  preference = next;
  applyPreference(next);
  listeners.forEach((listener) => listener());
};

export const themePreference = {
  async initialize() {
    if (initialized) return;
    initialized = true;
    const saved = await SecureStore.getItemAsync(STORAGE_KEY).catch(() => null);
    const systemTheme = Appearance.getColorScheme() === 'light' ? 'light' : 'dark';
    publish(isThemePreference(saved) ? saved : systemTheme);
  },
  update(next: ThemePreference) {
    publish(next);
    void SecureStore.setItemAsync(STORAGE_KEY, next).catch((error) =>
      console.warn('Unable to save theme preference:', error),
    );
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => preference,
};

export const useThemePreference = () =>
  useSyncExternalStore(
    themePreference.subscribe,
    themePreference.getSnapshot,
    themePreference.getSnapshot,
  );
