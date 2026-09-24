import type { AlertSettingsStorage } from './alert-settings';

const KEY = 'alert-settings';

export const alertSettingsStorage: AlertSettingsStorage = {
  read: () => globalThis.localStorage?.getItem(KEY) ?? null,
  write: (value) => globalThis.localStorage?.setItem(KEY, value),
};
