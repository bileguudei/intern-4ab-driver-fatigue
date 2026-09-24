/**
 * GPS-ийн хурдыг (м/с) бүхэл км/ц болгоно. iOS хурдыг тодорхойлж чадаагүй үед
 * -1, вэб null өгдөг тул эдгээрт null буцаана.
 */
export function toKmh(speedMps: number | null | undefined): number | null {
  if (typeof speedMps !== 'number' || !Number.isFinite(speedMps) || speedMps < 0) return null;
  return Math.round(speedMps * 3.6);
}
