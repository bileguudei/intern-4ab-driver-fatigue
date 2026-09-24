import { describe, expect, it } from 'bun:test';

import {
  type AlertSettingsStorage,
  clampVolume,
  createAlertSettingsStore,
  DEFAULT_ALERT_SETTINGS,
  parseAlertSettings,
} from '../alert-settings';

const memoryStorage = (initial: string | null = null) => {
  let value = initial;
  const storage: AlertSettingsStorage = {
    read: () => value,
    write: (next) => {
      value = next;
    },
  };
  return { storage, saved: () => value };
};

describe('parseAlertSettings', () => {
  it('хадгалсан утга байхгүй бол анхдагч тохиргоо', () => {
    expect(parseAlertSettings(null)).toEqual(DEFAULT_ALERT_SETTINGS);
  });

  it('эвдэрсэн JSON-оос болж унахгүй', () => {
    expect(parseAlertSettings('{bad')).toEqual(DEFAULT_ALERT_SETTINGS);
    expect(parseAlertSettings('"text"')).toEqual(DEFAULT_ALERT_SETTINGS);
  });

  it('буруу төрлийн утгыг анхдагчаар сольж, дууны хэмжээг хязгаарлана', () => {
    expect(parseAlertSettings(JSON.stringify({ sound: 'no', vibration: false, volume: 250 }))).toEqual({
      sound: true,
      vibration: false,
      volume: 100,
    });
  });
});

describe('clampVolume', () => {
  it('10-ын алхамд тааруулж, 10–100 хооронд барина', () => {
    expect(clampVolume(73)).toBe(70);
    expect(clampVolume(0)).toBe(10);
    expect(clampVolume(-20)).toBe(10);
    expect(clampVolume(140)).toBe(100);
  });
});

describe('createAlertSettingsStore', () => {
  it('өөрчлөлтийг хадгалж, дараагийн нээлтэд уншина', () => {
    const { storage, saved } = memoryStorage();
    const store = createAlertSettingsStore(storage);
    store.update({ sound: false, volume: 40 });

    expect(store.get()).toEqual({ sound: false, vibration: true, volume: 40 });
    expect(createAlertSettingsStore(memoryStorage(saved()).storage).get()).toEqual(store.get());
  });

  it('өөрчлөлт бүрийг сонсогчдод мэдэгдэнэ', () => {
    const store = createAlertSettingsStore(memoryStorage().storage);
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.update({ vibration: false });
    unsubscribe();
    store.update({ vibration: true });

    expect(calls).toBe(1);
  });

  it('хадгалах сан ажиллахгүй байсан ч тохиргоо ажилласаар байна', () => {
    const broken: AlertSettingsStorage = {
      read: () => {
        throw new Error('storage unavailable');
      },
      write: () => {
        throw new Error('storage unavailable');
      },
    };
    const store = createAlertSettingsStore(broken);
    store.update({ sound: false });

    expect(store.get().sound).toBe(false);
  });
});
