import { useKeepAwake } from 'expo-keep-awake';

/**
 * Хяналтын үед дэлгэцийг түгжигдүүлэхгүй. Дэлгэц түгжигдвэл iOS камерыг
 * зогсоож хяналт тасардаг. Mount хийгдсэн хугацаанд л идэвхтэй.
 */
export function KeepScreenAwake() {
  useKeepAwake('fatigue-monitoring');
  return null;
}
