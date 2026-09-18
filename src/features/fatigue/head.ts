import type { ComputerVisionObservation } from '@/features/computer-vision';

import type { Baseline } from './calibration';
import { MAX_FRAME_MS } from './eyes';

/**
 * iPhone дээр хэмжихэд толгой доошлоход pitch БУУРДАГ: шулуун −8.6°,
 * бага зэрэг доош −18.6°, эрүү цээж рүү −38.0°. Computer Vision-ий README
 * «эерэг = доош» гэж бичсэн нь бодит хэмжилттэй зөрж байгааг тэдэнд мэдэгдэв.
 * Тэр талд засагдвал энэ тэмдгийг +1 болгоно.
 */
const DOWN_SIGN = -1;

/** Суурь байрлалаас доош хэдэн градус бөхийвөл дохилт эхэлсэн гэж үзэх. */
const NOD_START_DEG = 10;
/** Гистерезис — босгыг шүргэх хэлбэлзэлд дохилт тасрахгүй. */
const NOD_END_DEG = 5;
/**
 * «Унжаад гэнэт өндийх» жижиг дохилт. Хэмжилтэд толгой 0.75 сек-т +30° хүртэл
 * бөхийсөн. Удаан доош харах (утас, самбар) 3 сек-ээс урт тул тоологдохгүй.
 */
const QUICK_NOD = { minMs: 300, maxMs: 3_000, maxRecoveryMs: 700 };
const NOD_WINDOW_MS = 60_000;

export type HeadState = Readonly<{
  /** Суурьтай харьцуулсан бөхийлт, градус. Эерэг = доош. */
  downDeg: number;
  /** Одоогийн дохилт хэдэн мс үргэлжилж байна. Толгой шулуун бол 0. */
  droopMs: number;
  /** Сүүлийн 60 сек-ийн жижиг, хурдан өндийсөн дохилтын тоо. */
  quickNods: number;
}>;

type Episode = { start: number; peak: number; peakAt: number; last: number };

const isQuickNod = (episode: Episode, end: number) =>
  end - episode.start >= QUICK_NOD.minMs &&
  end - episode.start <= QUICK_NOD.maxMs &&
  end - episode.peakAt <= QUICK_NOD.maxRecoveryMs;

export function createHeadTracker() {
  let episode: Episode | null = null;
  let nods: number[] = [];

  return {
    update(observation: ComputerVisionObservation, baseline: Baseline): HeadState {
      const t = observation.timestampMs;
      const pitch = observation.headPose?.pitch;
      const valid = observation.faceDetected && typeof pitch === 'number';
      const down = valid ? ((pitch as number) - baseline.headPitch) * DOWN_SIGN : 0;

      // Нүүр алдагдах, фрэйм тасрахад дохилтыг дуусгасан гэж тоолохгүй — зүгээр хаяна.
      const broken = episode !== null && (!valid || t - episode.last > MAX_FRAME_MS);
      if (broken) episode = null;

      const current: Episode | null = episode;
      if (current !== null && down < NOD_END_DEG) {
        nods = isQuickNod(current, t) ? [...nods, t] : nods;
        episode = null;
      }
      if (episode === null && down > NOD_START_DEG) episode = { start: t, peak: down, peakAt: t, last: t };

      const active: Episode | null = episode;
      if (active !== null) {
        active.peakAt = down > active.peak ? t : active.peakAt;
        active.peak = Math.max(active.peak, down);
        active.last = t;
      }
      nods = nods.filter((at) => t - at <= NOD_WINDOW_MS);

      return { downDeg: down, droopMs: active === null ? 0 : t - active.start, quickNods: nods.length };
    },
  };
}
