import * as SecureStore from 'expo-secure-store';

import type { IdentityStorage } from './driver-identity';

/** iPhone-д Keychain-д хадгалагддаг тул апп-ыг дахин суулгасны дараа ч ID ихэвчлэн хэвээр үлдэнэ. */
export const identityStorage: IdentityStorage = {
  read: (key) => SecureStore.getItemAsync(key),
  write: (key, value) => SecureStore.setItemAsync(key, value),
};
