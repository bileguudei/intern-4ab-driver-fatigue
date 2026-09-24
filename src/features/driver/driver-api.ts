import type { DriverApi, RegisteredDriver } from './driver-identity';

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE ?? 'http://127.0.0.1:8787';
const APP_API_KEY = process.env.EXPO_PUBLIC_APP_API_KEY ?? '';
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${APP_API_KEY}` };

/** Автомат бүртгэлд хувийн мэдээлэл илгээхгүй: нэр нь ерөнхий, ID санамсаргүй. */
const ANONYMOUS_DRIVER_NAME = 'Жолооч';

export const driverApi: DriverApi = {
  async register(deviceId) {
    const response = await fetch(`${API_BASE_URL}/api/drivers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: ANONYMOUS_DRIVER_NAME, employee_id: deviceId }),
    });
    if (!response.ok) throw new Error(`Driver registration failed (${response.status})`);
  },
  async list() {
    const response = await fetch(`${API_BASE_URL}/api/drivers`, { headers });
    if (!response.ok) throw new Error(`Driver list failed (${response.status})`);
    return (await response.json()) as RegisteredDriver[];
  },
};
