import Storage from 'expo-sqlite/kv-store';

import type { AlertSettingsStorage } from './alert-settings';

const KEY = 'alert-settings';

/** Утасны SQLite key-value сан. Синхрон уншдаг тул апп нээгдэхэд анхдагч утга түр харагдахгүй. */
export const alertSettingsStorage: AlertSettingsStorage = {
  read: () => Storage.getItemSync(KEY),
  write: (value) => Storage.setItemSync(KEY, value),
};
