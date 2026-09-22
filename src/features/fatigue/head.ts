import type { ComputerVisionObservation } from '@/features/computer-vision';

import type { Baseline } from './calibration';
import { MAX_FRAME_MS } from './eyes';

/** Суурь байрлалаас доош хэдэн градус бөхийвөл дохилт эхэлсэн гэж үзэх. */
const NOD_START_DEG = 10;
/** Гистерезис — босгыг шүргэх хэлбэлзэлд дохилт тасрахгүй. */
const NOD_END_DEG = 5;
/** Нэг буруу pose утга дохилтыг таслахгүйн тулд сүүлийн хэдэн фрэймийн медиан. */
const POSE_FILTER_WINDOW_MS = 400;
const POSE_FILTER_MAX_SAMPLES = 5;
/** Толгой доошлоход landmark түр алга болдог тул богино тасалдлыг үргэлжлэл гэж үзнэ. */
const TRACKING_LOSS_GRACE_MS = 700;
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
type DownSample = { t: number; value: number };

const isQuickNod = (episode: Episode, end: number) =>
  end - episode.start >= QUICK_NOD.minMs &&
  end - episode.start <= QUICK_NOD.maxMs &&
  end - episode.peakAt <= QUICK_NOD.maxRecoveryMs;

export function createHeadTracker() {
  let episode: Episode | null = null;
  let nods: number[] = [];
  let downSamples: DownSample[] = [];
  let lastObservationAt: number | null = null;
  let filteredDown = 0;

  return {
    update(observation: ComputerVisionObservation, baseline: Baseline): HeadState {
      const t = observation.timestampMs;
      const pitch = observation.headPose?.pitch;
      const valid = observation.faceDetected && typeof pitch === 'number';
      const frameGap = lastObservationAt !== null && t - lastObservationAt > MAX_FRAME_MS;
      lastObservationAt = t;

      // Апп/камерын бодит frame тасралтыг доош унжилтын хугацаанд оруулахгүй.
      if (frameGap) {
        episode = null;
        downSamples = [];
        filteredDown = 0;
      }

      if (!valid) {
        const held = episode !== null && !frameGap && t - episode.last <= TRACKING_LOSS_GRACE_MS;
        if (!held) {
          episode = null;
          downSamples = [];
          filteredDown = 0;
        }
        nods = nods.filter((at) => t - at <= NOD_WINDOW_MS);
        return {
          downDeg: held ? filteredDown : 0,
          droopMs: held && episode !== null ? t - episode.start : 0,
          quickNods: nods.length,
        };
      }

      const rawDown = (pitch as number) - baseline.headPitch;
      downSamples = [...downSamples, { t, value: rawDown }]
        .filter((sample) => t - sample.t <= POSE_FILTER_WINDOW_MS)
        .slice(-POSE_FILTER_MAX_SAMPLES);
      const sortedDown = downSamples.map((sample) => sample.value).sort((a, b) => a - b);
      filteredDown = sortedDown[Math.floor(sortedDown.length / 2)];
      const down = filteredDown;

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
