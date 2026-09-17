import type { ComputerVisionObservation } from '@/features/computer-vision';

/** Калибрацийн хугацаа — UI-ийн нүд, толгойн хоёр үе шат (5 + 5 сек). */
export const CALIBRATION_MS = 10_000;

/** 15 фр/сек-т 10 сек ~150 фрэйм. Үүнээс цөөн бол нүүр тогтвортой харагдаагүй. */
const MIN_SAMPLES = 60;

/**
 * Нээлттэй нүднээс «аньсан» хүртэлх зай. Хэмжилтээр нээлттэй eyeBlink
 * 0.18–0.29, аньсан 0.65–0.77 байсан тул суурь + 0.35 нь хоёрын дунд буудаг.
 */
const BLINK_CLOSED_OFFSET = 0.35;
/** Суурийн 72% үед хуурамч илрэл их байсан; ~40% нь гүн анилтыг ялгасан. */
const EAR_CLOSED_RATIO = 0.4;

export type Baseline = Readonly<{
  blinkOpen: number;
  /** eyeBlink үүнээс их бол аньсан. */
  blinkClosed: number;
  earOpen: number;
  /** EAR үүнээс бага бол аньсан (туслах хэмжүүр). */
  earClosed: number;
  /** Градус, эерэг = доош. */
  headPitch: number;
}>;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const isNumber = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Жолоочийн хэвийн төлвийг хэмжинэ. Медиан ашигладаг тул калибрацийн
 * үеэр хэдэн удаа анивчих нь суурийг өөрчлөхгүй. Өгөгдөл хүрэлцэхгүй бол null.
 */
export function calibrate(observations: readonly ComputerVisionObservation[]): Baseline | null {
  const samples = observations.flatMap((o) => {
    const blink = average(o.leftBlink, o.rightBlink);
    const pitch = o.headPose?.pitch;
    const usable = o.faceDetected && isNumber(blink) && isNumber(o.averageEar) && isNumber(pitch);
    return usable ? [{ blink, ear: o.averageEar as number, pitch: pitch as number }] : [];
  });
  if (samples.length < MIN_SAMPLES) return null;

  const blinkOpen = median(samples.map((s) => s.blink as number));
  const earOpen = median(samples.map((s) => s.ear));
  return {
    blinkOpen,
    blinkClosed: clamp(blinkOpen + BLINK_CLOSED_OFFSET, 0.45, 0.85),
    earOpen,
    earClosed: earOpen * EAR_CLOSED_RATIO,
    headPitch: median(samples.map((s) => s.pitch)),
  };
}

function average(a: number | null, b: number | null): number | null {
  return isNumber(a) && isNumber(b) ? (a + b) / 2 : null;
}
