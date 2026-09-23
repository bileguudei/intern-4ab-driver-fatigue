import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

import { toKmh } from './speed';

/** Ийм удаан шинэ байршил ирэхгүй бол (хонгил, дохио тасрах) хурдыг мэдэхгүй гэж үзнэ. */
const STALE_MS = 5_000;

/**
 * Жолоодлогын үеийн хурдыг GPS-ээс км/ц-ээр гаргана. Байршлын зөвшөөрөл
 * өгөөгүй, эсвэл дохио тасарсан үед null.
 */
export function useDrivingSpeed(): number | null {
  const [speedKmh, setSpeedKmh] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let subscription: { remove: () => void } | null = null;
    let staleTimer: ReturnType<typeof setTimeout> | null = null;

    const start = async () => {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (!granted || cancelled) return;
      const watcher = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1_000, distanceInterval: 0 },
        (location) => {
          setSpeedKmh(toKmh(location.coords.speed));
          if (staleTimer !== null) clearTimeout(staleTimer);
          staleTimer = setTimeout(() => setSpeedKmh(null), STALE_MS);
        },
      );
      if (cancelled) watcher.remove();
      else subscription = watcher;
    };
    start().catch((error) => console.warn('Unable to read driving speed:', error));

    return () => {
      cancelled = true;
      subscription?.remove();
      if (staleTimer !== null) clearTimeout(staleTimer);
    };
  }, []);

  return speedKmh;
}
