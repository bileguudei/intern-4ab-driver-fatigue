import type { ComputerVisionObservation } from '@/features/computer-vision';

import type { Baseline } from './calibration';

export const PERCLOS_WINDOW_MS = 60_000;

/**
 * Нэг фрэймийн эзлэх хугацааны дээд хязгаар. Хэмжилтэд таб нуугдаж фрэйм
 * 8 сек тасрахад 8.5 сек-ийн хуурамч «анилт» үүссэн тул тасралтыг тоолохгүй.
 */
export const MAX_FRAME_MS = 500;

/**
 * Аньсан нүд нээгдсэн гэж үзэх зай. Толгой доош үед eyeBlink босгыг шүргэж
 * 16–18 мс-ийн хуурамч анилтууд гарсан тул нээгдэх босгыг доогуур тавина.
 */
const REOPEN_MARGIN = 0.1;

export type EyeState = Readonly<{
  closed: boolean;
  /** Одоогийн анилтын үргэлжлэх хугацаа, мс. Нээлттэй бол 0. */
  closureMs: number;
  /** Сүүлийн 60 сек-т аньсан хугацааны хувь, 0 … 1. */
  perclos: number;
}>;

type Frame = { t: number; closed: boolean; counted: boolean; duration: number };

const average = (a: number | null, b: number | null) => (a === null || b === null ? null : (a + b) / 2);

export function createEyeTracker(windowMs = PERCLOS_WINDOW_MS) {
  let frames: Frame[] = [];
  let closed = false;
  let closedSince: number | null = null;

  return {
    update(observation: ComputerVisionObservation, baseline: Baseline): EyeState {
      const t = observation.timestampMs;
      const previous = frames[frames.length - 1];
      const gap = previous === undefined ? 0 : t - previous.t;
      if (previous !== undefined) previous.duration = Math.min(gap, MAX_FRAME_MS);

      const blink = average(observation.leftBlink, observation.rightBlink);
      const counted = observation.faceDetected && blink !== null;
      const threshold = closed ? baseline.blinkClosed - REOPEN_MARGIN : baseline.blinkClosed;
      const nowClosed = counted && (blink as number) > threshold;
      const continuing = closed && gap <= MAX_FRAME_MS;
      const start = continuing ? closedSince : t;
      closedSince = nowClosed ? start : null;
      closed = nowClosed;

      frames.push({ t, closed: nowClosed, counted, duration: 0 });
      frames = frames.filter((frame) => t - frame.t <= windowMs);
      const total = frames.reduce((sum, f) => sum + (f.counted ? f.duration : 0), 0);
      const closedTotal = frames.reduce((sum, f) => sum + (f.counted && f.closed ? f.duration : 0), 0);

      return {
        closed,
        closureMs: closedSince === null ? 0 : t - closedSince,
        perclos: total > 0 ? closedTotal / total : 0,
      };
    },
  };
}
