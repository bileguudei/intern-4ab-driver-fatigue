import type { ComputerVisionObservation, FaceBounds } from '@/features/computer-vision';

import type { Baseline } from './calibration';
import { MAX_FRAME_MS } from './eyes';

/**
 * Калибраци нь суурийг нэг л удаа, эхэнд хэмждэг. Жолооч суудлаа тохируулах,
 * утсаа шилжүүлэх, бүслүүрээ янзлахад толгойн өнцөг тэр суурьтай таарахаа
 * больдог. Тэгэхэд raw downDeg өсөж, толгойн дохио болон нүдний blendshape-г
 * хуучин байрлалтай харьцуулсан хэвээр байвал хуурамч эсвэл дутуу илрэл гарна.
 *
 * Энэ модуль жижиг drift-ийг аажим дагуулна. Нүүр түр алга болох, эсвэл нүүрний
 * хэвтээ байрлал/хэмжээ мэдэгдэхүйц солигдвол нүд нээлттэй, тогтвортой нэг
 * секундын цонхоор шинэ суудлын байрлалыг батлаад толгойн суурийг дахин төвлөрүүлнэ.
 */

/** Дүгнэлтийн цонх. Богино цонх шинэ байрлалд хурдан дасах ч шуугианд мэдрэг. */
const WINDOW_MS = 8_000;
/** Ийм хугацааг хамраагүй цонхонд итгэхгүй — хэдэн фрэйм суурийг хөдөлгөх ёсгүй. */
const MIN_SPAN_MS = 3_000;
const MIN_SAMPLES = 20;
/** Нүүр эргэсэн үед pitch найдваргүй — толин харцыг цонхонд оруулахгүй. */
const YAW_LIMIT_DEG = 25;
/** Нүүр ийм удаан алга бол жолооч байрлалаа өөрчилсөн байж болно. */
const REACQUIRE_GAP_MS = 1_000;
/** Буцаж ирсний дараа нүд нээлттэй, тогтвортой байх баталгаажуулах хугацаа. */
const RECENTER_SPAN_MS = 1_000;
const RECENTER_MIN_SAMPLES = 10;
const RECENTER_WINDOW_MS = 2_000;
const RECENTER_MAX_PITCH_MAD_DEG = 2;
/** Хэвтээ шилжилт нүүрний өргөний ийм хувиас их бол шинэ суудлын байрлал гэж шалгана. */
const RECENTER_X_SHIFT_FACE_RATIO = 0.2;
/** Камерт ойртох/холдох үед нүүрний хэмжээ ийм хувиас их өөрчлөгдвөл шалгана. */
const RECENTER_SCALE_CHANGE_RATIO = 0.2;
/** Шинэ байрлал тогтвортой эсэхийг normalized координатын MAD-аар хамгаална. */
const RECENTER_MAX_BOUNDS_MAD = 0.015;
/** Эвшээлт, ярианы үеийн фрэймийг хэвийн байрлал гэж сурахгүй. */
const MAX_JAW_OPEN = 0.35;
/** Хэт налсан нүүрний pitch найдвартай бус. */
const ROLL_LIMIT_DEG = 20;
/** Одоогийн төвлөрсөн сууриас ихдээ ийм хэмжээгээр жижиг drift дагуулна. */
const MAX_PITCH_DRIFT_DEG = 5;
/**
 * Засварын хурд — алдааны хувиар. Том шилжилт хурдан, жижиг хэлбэлзэл зөөлөн
 * засагдана. Дээд хязгаар нь гэнэтийн үсрэлтээс хамгаална.
 */
const PITCH = { gainPerS: 0.3, maxDegPerS: 3 };

type Sample = {
  t: number;
  blink: number;
  pitch: number;
  centerX: number | null;
  faceHeight: number | null;
};

const isNumber = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const average = (a: number | null, b: number | null) =>
  isNumber(a) && isNumber(b) ? (a + b) / 2 : null;

/** Эрэмбэлсэн массивын q хувийн утга. */
function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

const median = (values: readonly number[]) => quantile([...values].sort((a, b) => a - b), 0.5);

const medianAbsoluteDeviation = (values: readonly number[]) => {
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Зорилтот утга руу нэг алхам — алдааны хувиар, дээд хурдаар хязгаарласан. */
function approach(current: number, target: number, rate: { gain: number; max: number }, dtMs: number) {
  const error = target - current;
  const step = Math.min(Math.abs(error) * rate.gain, rate.max) * (dtMs / 1_000);
  return current + Math.sign(error) * Math.min(step, Math.abs(error));
}

export type BaselineTracker = Readonly<{
  /** Энэ фрэймийн дараах суурь. Дасан зохицох нөхцөл бүрдээгүй бол өмнөхөө буцаана. */
  update(observation: ComputerVisionObservation): Baseline;
  current(): Baseline;
}>;

export function createBaselineTracker(
  initial: Baseline,
  initialBounds: FaceBounds | null = null,
): BaselineTracker {
  let baseline = initial;
  let samples: Sample[] = [];
  let anchorHeadPitch = initial.headPitch;
  let lastSampleAt: number | null = null;
  let lastPoseAt: number | null = null;
  let missingSince: number | null = null;
  let recenterPending = false;
  let anchorBounds: FaceBounds | null = initialBounds;

  return {
    current: () => baseline,

    update(observation: ComputerVisionObservation): Baseline {
      const t = observation.timestampMs;
      const blink = average(observation.leftBlink, observation.rightBlink);
      const { pitch, yaw, roll } = observation.headPose ?? { pitch: null, yaw: null, roll: null };
      const poseAvailable =
        observation.faceDetected && isNumber(pitch) && isNumber(yaw) && isNumber(roll);
      if (!poseAvailable) {
        missingSince ??= t;
        return baseline;
      }

      const poseGap = lastPoseAt === null ? 0 : t - lastPoseAt;
      const missingFor = missingSince === null ? 0 : t - missingSince;
      lastPoseAt = t;
      missingSince = null;
      const bounds = observation.faceBounds;
      if (anchorBounds === null && bounds !== null) anchorBounds = bounds;
      const positionChanged =
        anchorBounds !== null &&
        bounds !== null &&
        (Math.abs(bounds.centerX - anchorBounds.centerX) /
          Math.max(anchorBounds.width, 0.01) >= RECENTER_X_SHIFT_FACE_RATIO ||
          Math.abs(bounds.height / Math.max(anchorBounds.height, 0.01) - 1) >=
            RECENTER_SCALE_CHANGE_RATIO);
      const reacquired = poseGap > REACQUIRE_GAP_MS || missingFor > REACQUIRE_GAP_MS;
      if (reacquired) {
        // Нүүр алга болсон нь дангаараа суудал солигдсоны баталгаа биш. Жолооч
        // доош хараад буцаж ирэхийг шинэ хэвийн байрлал гэж сурахаас хамгаална.
        samples = [];
        recenterPending = recenterPending || positionChanged;
      } else if (!recenterPending && positionChanged) {
        samples = [];
        recenterPending = true;
      }

      const usable =
        isNumber(blink) &&
        isNumber(observation.averageEar) &&
        isNumber(observation.jawOpen) &&
        Math.abs(yaw) <= YAW_LIMIT_DEG &&
        Math.abs(roll) <= ROLL_LIMIT_DEG &&
        observation.jawOpen <= MAX_JAW_OPEN &&
        blink < baseline.blinkClosed &&
        observation.averageEar > baseline.earClosed;
      if (!usable) {
        // Том байрлалын өөрчлөлтийг зөвхөн тасралтгүй нээлттэй нүдээр батална.
        if (recenterPending) samples = [];
        return baseline;
      }

      const gap = lastSampleAt === null ? 0 : t - lastSampleAt;
      const dt = samples.length === 0 ? 0 : Math.min(gap, MAX_FRAME_MS);
      lastSampleAt = t;

      samples = [...samples, {
        t,
        blink,
        pitch,
        centerX: bounds?.centerX ?? null,
        faceHeight: bounds?.height ?? null,
      }].filter(
        (s) => t - s.t <= (recenterPending ? RECENTER_WINDOW_MS : WINDOW_MS),
      );

      const targetPitch = median(samples.map((s) => s.pitch));
      const centerXs = samples.flatMap((s) => s.centerX === null ? [] : [s.centerX]);
      const faceHeights = samples.flatMap((s) => s.faceHeight === null ? [] : [s.faceHeight]);
      const stableBounds =
        (centerXs.length === 0 || medianAbsoluteDeviation(centerXs) <= RECENTER_MAX_BOUNDS_MAD) &&
        (faceHeights.length === 0 || medianAbsoluteDeviation(faceHeights) <= RECENTER_MAX_BOUNDS_MAD);
      if (
        recenterPending &&
        samples.length >= RECENTER_MIN_SAMPLES &&
        t - samples[0].t >= RECENTER_SPAN_MS &&
        medianAbsoluteDeviation(samples.map((s) => s.pitch)) <= RECENTER_MAX_PITCH_MAD_DEG &&
        stableBounds
      ) {
        baseline = { ...baseline, headPitch: targetPitch };
        anchorHeadPitch = targetPitch;
        anchorBounds = bounds ?? anchorBounds;
        recenterPending = false;
        samples = [];
        return baseline;
      }

      if (samples.length < MIN_SAMPLES || t - samples[0].t < MIN_SPAN_MS) return baseline;

      const headPitch = clamp(
        approach(
          baseline.headPitch,
          targetPitch,
          { gain: PITCH.gainPerS, max: PITCH.maxDegPerS },
          dt,
        ),
        anchorHeadPitch - MAX_PITCH_DRIFT_DEG,
        anchorHeadPitch + MAX_PITCH_DRIFT_DEG,
      );

      // Нүдний босгыг аяллын дунд өөрчилбөл аажим нойрмоглолтыг хэвийн гэж
      // сурах эрсдэлтэй. Тэдгээрийг зөвхөн ил калибраци шинэчилнэ.
      baseline = { ...baseline, headPitch };
      return baseline;
    },
  };
}
