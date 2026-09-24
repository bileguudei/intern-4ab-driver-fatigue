import { API_BASE_URL, driverApi } from './driver-api';
import { createDriverIdentity } from './driver-identity';
import { identityStorage } from './identity-storage';

/** Апп даяар нэг жолоочийн таних тэмдэг. */
export const driverIdentity = createDriverIdentity(identityStorage, driverApi, API_BASE_URL);
