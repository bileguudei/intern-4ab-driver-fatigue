import { useSyncExternalStore } from 'react';

import { type AlertSettings, createAlertSettingsStore } from './alert-settings';
import { alertSettingsStorage } from './alert-settings-storage';

/** Апп даяар нэг тохиргоо — дохио болон Тохиргоо дэлгэц хоёулаа үүнийг уншина. */
export const alertSettings = createAlertSettingsStore(alertSettingsStorage);

export function useAlertSettings(): AlertSettings {
  return useSyncExternalStore(alertSettings.subscribe, alertSettings.get);
}
