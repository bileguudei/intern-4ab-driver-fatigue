/**
 * Жолоочийн тохируулдаг дохионы тохиргоо. Зөвхөн анхааруулгад (warning)
 * хамаарна. Аюултай (critical) дохио нойрмоглосон жолоочийг сэрээх ёстой тул
 * тохиргооноос үл хамааран бүрэн дуугарч, чичирнэ.
 */
export type AlertSettings = Readonly<{
  sound: boolean;
  vibration: boolean;
  /** Анхааруулгын дууны хэмжээ, хувиар. */
  volume: number;
}>;

export const DEFAULT_ALERT_SETTINGS: AlertSettings = { sound: true, vibration: true, volume: 70 };

export const VOLUME_STEP = 10;
/** 0% болговол дуу асаалттай мэт харагдаад сонсогдохгүй — дууг унтраах бол sound-ыг хаана. */
export const MIN_VOLUME = 10;
export const MAX_VOLUME = 100;

export const clampVolume = (volume: number) =>
  Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, Math.round(volume / VOLUME_STEP) * VOLUME_STEP));

/** Хадгалсан JSON-ыг уншина. Эвдэрсэн эсвэл дутуу утгыг анхдагч утгаар нөхнө. */
export function parseAlertSettings(raw: string | null): AlertSettings {
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object') stored = parsed as Record<string, unknown>;
  } catch {
    // Эвдэрсэн утга — анхдагч тохиргоогоор үргэлжилнэ.
  }
  const pick = (key: 'sound' | 'vibration') =>
    typeof stored[key] === 'boolean' ? (stored[key] as boolean) : DEFAULT_ALERT_SETTINGS[key];
  return {
    sound: pick('sound'),
    vibration: pick('vibration'),
    volume:
      typeof stored.volume === 'number' && Number.isFinite(stored.volume)
        ? clampVolume(stored.volume)
        : DEFAULT_ALERT_SETTINGS.volume,
  };
}

export type AlertSettingsStorage = Readonly<{
  read(): string | null;
  write(value: string): void;
}>;

export type AlertSettingsStore = Readonly<{
  get(): AlertSettings;
  subscribe(listener: () => void): () => void;
  update(patch: Partial<AlertSettings>): void;
}>;

/**
 * Тохиргоог санах ойд барьж, өөрчлөлт бүрийг хадгална. Хадгалах сан ажиллахгүй
 * байсан ч тохиргоо тухайн нээлтийн турш ажилласаар байна.
 */
export function createAlertSettingsStore(storage: AlertSettingsStorage): AlertSettingsStore {
  let settings = DEFAULT_ALERT_SETTINGS;
  try {
    settings = parseAlertSettings(storage.read());
  } catch (error) {
    console.warn('Unable to read alert settings:', error);
  }
  const listeners = new Set<() => void>();

  return {
    get: () => settings,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update(patch) {
      settings = parseAlertSettings(JSON.stringify({ ...settings, ...patch }));
      try {
        storage.write(JSON.stringify(settings));
      } catch (error) {
        console.warn('Unable to save alert settings:', error);
      }
      listeners.forEach((listener) => listener());
    },
  };
}
