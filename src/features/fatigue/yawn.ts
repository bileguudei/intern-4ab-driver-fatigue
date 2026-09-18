import type { ComputerVisionObservation } from '@/features/computer-vision';

import { MAX_FRAME_MS } from './eyes';

/** jawOpen үүнээс их бол ам ангайсан. Хэмжилтэд хэвийн ярихад 0.1-0.2 байв. */
const OPEN = 0.5;
/** Гистерезис — ангайлт босгыг шүргэхэд эвшээлт тасрахгүй. */
const CLOSE = 0.35;
/**
 * Эвшээлт гэж үзэх хамгийн богино хугацаа. Ярих, инээх үед ам богино
 * хугацаанд ангайдаг тул 1.2 сек-ээс богиныг тоолохгүй.
 */
const MIN_YAWN_MS = 1_200;
/** Эвшээлтийг тоолох цонх — 5 минут. */
const YAWN_WINDOW_MS = 300_000;

export type YawnState = Readonly<{
  /** Ам одоо ангайсан эсэх. */
  open: boolean;
  /** Одоогийн ангайлт хэдэн мс үргэлжилж байна. */
  openMs: number;
  /** Сүүлийн 5 минутын эвшээлтийн тоо. */
  yawns: number;
}>;

export function createYawnTracker() {
  let openedAt: number | null = null;
  let counted = false;
  let last: number | null = null;
  let yawns: number[] = [];

  return {
    update(observation: ComputerVisionObservation): YawnState {
      const t = observation.timestampMs;
      const jaw = observation.jawOpen;
      const gap = last === null ? 0 : t - last;
      last = t;

      // Нүүр алдагдах, фрэйм тасрахад ангайлтыг үргэлжлүүлэхгүй.
      const broken = !observation.faceDetected || jaw === null || gap > MAX_FRAME_MS;
      const threshold = openedAt === null ? OPEN : CLOSE;
      const open = !broken && (jaw as number) > threshold;
      const started = open && openedAt === null;
      openedAt = started ? t : openedAt;
      openedAt = open ? openedAt : null;
      counted = open ? counted : false;

      const openMs = openedAt === null ? 0 : t - openedAt;
      const isYawn = open && !counted && openMs >= MIN_YAWN_MS;
      yawns = isYawn ? [...yawns, t] : yawns;
      counted = counted || isYawn;
      yawns = yawns.filter((at) => t - at <= YAWN_WINDOW_MS);

      return { open, openMs, yawns: yawns.length };
    },
  };
}
