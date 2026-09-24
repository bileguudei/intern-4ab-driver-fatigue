import type { IdentityStorage } from './driver-identity';

export const identityStorage: IdentityStorage = {
  read: async (key) => globalThis.localStorage?.getItem(key) ?? null,
  write: async (key, value) => {
    globalThis.localStorage?.setItem(key, value);
  },
};
