import type { CameraPermissionStatus } from '@/features/computer-vision';

export type NotificationPermission = 'granted' | 'denied' | 'undetermined';
export type LocationPermission = 'granted' | 'denied' | 'undetermined';

export type Readiness = Readonly<{
  level: 'ready' | 'attention' | 'blocked';
  title: string;
  message: string;
  /** Утасны тохиргоо руу орж засах шаардлагатай эсэх. */
  openSettings: boolean;
}>;

/**
 * Нүүр дэлгэцийн «Систем бэлэн» картын төлөв. Хамгийн ноцтой асуудлыг эхэлж
 * харуулна: камергүй бол хяналт огт ажиллахгүй, мэдэгдэлгүй бол апп ард
 * гарахад сануулга ирэхгүй, байршилгүй бол хурд, зай хэмжигдэхгүй. Мэдэгдэл,
 * байршлын зөвшөөрлийг анхны жолоодлогод асуудаг тул асуугаагүй байхыг асуудал
 * гэж үзэхгүй.
 */
export function assessReadiness(
  camera: CameraPermissionStatus,
  notifications: NotificationPermission,
  location: LocationPermission = 'undetermined',
): Readiness {
  if (camera === 'denied' || camera === 'restricted') {
    return { level: 'blocked', title: 'Камер хаалттай', message: 'Хяналт ажиллахгүй. Дарж тохиргооноос камерыг зөвшөөрнө үү.', openSettings: true };
  }
  if (camera === 'undetermined') {
    return { level: 'attention', title: 'Камерын зөвшөөрөл хэрэгтэй', message: 'Жолоодлого эхлүүлэхэд зөвшөөрөл асууна.', openSettings: false };
  }
  if (notifications === 'denied') {
    return { level: 'attention', title: 'Мэдэгдэл хаалттай', message: 'Апп ард гарахад сануулга ирэхгүй. Дарж тохиргооноос зөвшөөрнө үү.', openSettings: true };
  }
  if (location === 'denied') {
    return { level: 'attention', title: 'Байршил хаалттай', message: 'Хурд, зай хэмжигдэхгүй. Дарж тохиргооноос зөвшөөрнө үү.', openSettings: true };
  }
  return { level: 'ready', title: 'Систем бэлэн', message: 'Камер, мэдэгдэл, байршлын зөвшөөрөл хэвийн байна', openSettings: false };
}
