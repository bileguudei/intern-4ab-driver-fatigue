import { describe, expect, it } from 'bun:test';

import {
  createDeviceId,
  createDriverIdentity,
  type DriverApi,
  type IdentityStorage,
  type RegisteredDriver,
  serverIdKey,
} from '../driver-identity';

const BASE = 'https://example.workers.dev';

const memoryStorage = () => {
  const values = new Map<string, string>();
  const storage: IdentityStorage = {
    read: async (key) => values.get(key) ?? null,
    write: async (key, value) => {
      values.set(key, value);
    },
  };
  return { storage, values };
};

/** Жинхэнэ сервер шиг: давхар employee_id-д алдаа өгч, ID-г буцаадаггүй. */
const fakeServer = (options: { offline?: boolean } = {}) => {
  const drivers: RegisteredDriver[] = [{ id: 1, employee_id: 'local-driver-1' }];
  const calls = { register: 0, list: 0 };
  const api: DriverApi = {
    async register(deviceId) {
      calls.register += 1;
      if (options.offline) throw new Error('Network request failed');
      if (drivers.some((driver) => driver.employee_id === deviceId)) throw new Error('Driver registration failed (500)');
      drivers.push({ id: drivers.length + 1, employee_id: deviceId });
    },
    async list() {
      calls.list += 1;
      if (options.offline) throw new Error('Network request failed');
      return drivers;
    },
  };
  return { api, drivers, calls };
};

describe('createDeviceId', () => {
  it('UUID v4 хэлбэртэй, давтагдахгүй ID үүсгэнэ', () => {
    const id = createDeviceId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(Array.from({ length: 200 }, () => createDeviceId())).size).toBe(200);
  });
});

describe('createDriverIdentity', () => {
  it('анх нээхэд ID үүсгэж бүртгүүлээд серверийн дугаарыг хадгална', async () => {
    const { storage, values } = memoryStorage();
    const server = fakeServer();
    const identity = createDriverIdentity(storage, server.api, BASE);

    const id = await identity.ensureRegistered();

    expect(id).toBe(2);
    expect(server.drivers[1].employee_id).toBe(await identity.deviceId());
    expect(values.get(serverIdKey(BASE))).toBe('2');
  });

  it('дараагийн нээлтэд хадгалсан ID-гаа ашиглаж сервер рүү хандахгүй', async () => {
    const { storage } = memoryStorage();
    const server = fakeServer();
    await createDriverIdentity(storage, server.api, BASE).ensureRegistered();

    const reopened = createDriverIdentity(storage, server.api, BASE);
    expect(await reopened.ensureRegistered()).toBe(2);
    expect(server.calls.register).toBe(1);
    expect(server.drivers).toHaveLength(2);
  });

  it('өмнө бүртгүүлсэн ч дугаараа алдсан бол давхар бүртгэлийн алдааг давж жагсаалтаас олно', async () => {
    const { storage, values } = memoryStorage();
    const server = fakeServer();
    await createDriverIdentity(storage, server.api, BASE).ensureRegistered();
    values.delete(serverIdKey(BASE));

    expect(await createDriverIdentity(storage, server.api, BASE).ensureRegistered()).toBe(2);
    expect(server.drivers).toHaveLength(2);
  });

  it('офлайн бол null буцааж, ID-гаа хадгалаад дараа нь бүртгүүлнэ', async () => {
    const { storage } = memoryStorage();
    const offline = createDriverIdentity(storage, fakeServer({ offline: true }).api, BASE);
    expect(await offline.ensureRegistered()).toBeNull();
    const deviceId = await offline.deviceId();

    const server = fakeServer();
    const online = createDriverIdentity(storage, server.api, BASE);
    expect(await online.ensureRegistered()).toBe(2);
    expect(server.drivers[1].employee_id).toBe(deviceId);
  });

  it('өөр сервер рүү шилжихэд хуучин серверийн дугаарыг ашиглахгүй', async () => {
    const { storage } = memoryStorage();
    await createDriverIdentity(storage, fakeServer().api, BASE).ensureRegistered();

    const other = fakeServer();
    other.drivers.push({ id: 2, employee_id: 'someone-else' });
    expect(await createDriverIdentity(storage, other.api, 'https://other.workers.dev').ensureRegistered()).toBe(3);
  });

  it('зэрэг дуудахад нэг л удаа бүртгүүлнэ', async () => {
    const { storage } = memoryStorage();
    const server = fakeServer();
    const identity = createDriverIdentity(storage, server.api, BASE);

    const ids = await Promise.all([identity.ensureRegistered(), identity.ensureRegistered(), identity.ensureRegistered()]);
    expect(ids).toEqual([2, 2, 2]);
    expect(server.calls.register).toBe(1);
  });
});
