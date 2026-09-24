/**
 * Нэвтрэх бүртгэлгүйгээр утас бүрийг серверт тусдаа жолооч болгон ялгана.
 * Апп анх нээгдэхэд санамсаргүй төхөөрөмжийн ID үүсгэж хадгална, дараа нь
 * түүгээрээ серверт бүртгүүлж серверийн жолоочийн дугаарыг авна. Хэрэглэгч
 * юу ч бөглөхгүй.
 */

export type IdentityStorage = Readonly<{
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
}>;

export type RegisteredDriver = Readonly<{ id: number; employee_id: string }>;

export type DriverApi = Readonly<{
  /** Сервер ID-г хариундаа буцаадаггүй, давхар бүртгэлд алдаа өгдөг. */
  register(deviceId: string): Promise<void>;
  list(): Promise<readonly RegisteredDriver[]>;
}>;

const DEVICE_ID_KEY = 'driver.device-id';

/**
 * Серверийн дугаарыг серверийн хаягаар нь хадгална. Апп өөр сервер рүү
 * шилжихэд хуучин серверийн дугаарыг андуурч ашиглахгүй.
 * SecureStore зөвхөн үсэг, тоо, ".", "-", "_" тэмдэгттэй түлхүүр зөвшөөрдөг.
 */
export const serverIdKey = (apiBaseUrl: string) =>
  `driver.server-id.${apiBaseUrl.replace(/[^A-Za-z0-9._-]/g, '_')}`;

const randomBytes = (count: number): number[] => {
  const cryptoApi = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (cryptoApi?.getRandomValues) return Array.from(cryptoApi.getRandomValues(new Uint8Array(count)));
  return Array.from({ length: count }, () => Math.floor(Math.random() * 256));
};

/** UUID v4 хэлбэрийн төхөөрөмжийн ID. */
export function createDeviceId(bytes: readonly number[] = randomBytes(16)): string {
  const b = [...bytes];
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const parseDriverId = (value: string | null) => {
  const id = value === null ? NaN : Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

export type DriverIdentity = Readonly<{
  deviceId(): Promise<string>;
  /** Серверийн жолоочийн дугаар. Сүлжээгүй эсвэл бүртгэл амжаагүй бол null — дараа дахин оролдоно. */
  ensureRegistered(): Promise<number | null>;
}>;

export function createDriverIdentity(storage: IdentityStorage, api: DriverApi, apiBaseUrl: string): DriverIdentity {
  let deviceIdPromise: Promise<string> | null = null;
  let registering: Promise<number | null> | null = null;

  const deviceId = () => {
    deviceIdPromise ??= (async () => {
      const saved = await storage.read(DEVICE_ID_KEY);
      if (saved) return saved;
      const created = createDeviceId();
      await storage.write(DEVICE_ID_KEY, created);
      return created;
    })().catch((error) => {
      deviceIdPromise = null;
      throw error;
    });
    return deviceIdPromise;
  };

  const register = async (): Promise<number | null> => {
    const saved = parseDriverId(await storage.read(serverIdKey(apiBaseUrl)));
    if (saved !== null) return saved;

    const id = await deviceId();
    // Өмнө бүртгүүлчихсэн бол сервер давхар бүртгэлд алдаа өгнө — жагсаалтаас олно.
    await api.register(id).catch(() => undefined);
    const match = (await api.list()).find((driver) => driver.employee_id === id);
    if (!match) return null;
    await storage.write(serverIdKey(apiBaseUrl), String(match.id));
    return match.id;
  };

  return {
    deviceId,
    ensureRegistered() {
      // Апп нээгдэх, sync, зөвлөгөө зэрэг дуудахад нэг л бүртгэл явна.
      registering ??= register()
        .catch((error) => {
          console.warn('Driver registration deferred:', error);
          return null;
        })
        .finally(() => {
          registering = null;
        });
      return registering;
    },
  };
}
