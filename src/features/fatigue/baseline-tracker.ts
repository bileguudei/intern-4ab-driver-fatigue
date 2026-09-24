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
 *
 * Толгойн хэвтээ чиглэл (yaw): калибраци жолоочийг камер руу харуулдаг тул утас
 * хажуу талд (самбарын голд) байвал зам руу харах чиглэл калибрацийнхаас 25–35°
 * зөрж, head.ts жолоочийг байнга «эргэсэн» гэж үзнэ. Тиймээс калибрацийн дараах
 * эхний тогтвортой харцаар суурийг шууд түгжиж, дараа нь жолооч хамгийн их харж
 * буй чиглэлийг урт цонхоор аажим дагана. Толь руу харах мэт богино эргэлт
 * урт цонхны медианыг хөдөлгөхгүй.
 */

/** Дүгнэлтийн цонх. Богино цонх шинэ байрлалд хурдан дасах ч шуугианд мэдрэг. */
const WINDOW_MS = 8_000;
/** Ийм хугацааг хамраагүй цонхонд итгэхгүй — хэдэн фрэйм суурийг хөдөлгөх ёсгүй. */
const MIN_SPAN_MS = 3_000;
const MIN_SAMPLES = 20;
/**
 * Нүүр эргэсэн үед pitch найдваргүй — толин харцыг цонхонд оруулахгүй. Утас
 * хажуу талд байж болох тул камер биш, сурсан зам руу харах чиглэлээс хэмжинэ.
 */
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

/** Толгойн хэвтээ чиглэлийн суурь. Туршилтаар тааруулна. */
const YAW = {
  /**
   * Калибрацийн дараах анхны түгжээ. Жолооч эхлээд зам руу харж жолоодож
   * эхэлдэг — head.ts-ийн «эргэсэн» дохио (2 сек) гарахаас өмнө түгжинэ.
   */
  lockWindowMs: 1_500,
  lockSpanMs: 1_300,
  lockMinSamples: 12,
  /**
   * Кадруудын 90% нь медианаас ийм зайд байх ёстой. Калибрацийн дараах утас
   * руу харсан хэдэн кадр холилдсон үед түгжихгүй — MAD үүнийг барьдаггүй.
   */
  lockMaxSpreadDeg: 4,
  /**
   * Калибрацийн чиглэлээс үүнээс хол тогтвортой харц нь утасны байрлал биш,
   * анхаарал сарнилт байх магадлалтай — түгжихгүй, дохио нь ажилласаар байна.
   */
  lockMaxOffsetDeg: 35,
  /**
   * Анхны түгжээ зөвхөн калибрацийн дараах энэ хугацаанд идэвхтэй. Жолоодлогын
   * дундуур утас руу 1.5 сек харахад суурь гэнэт үсрэхгүй.
   */
  lockArmMs: 30_000,
  /**
   * Түгжсэний дараа: цонхны талаас илүүг эзлэх чиглэл л суурийг хөдөлгөнө.
   * Зорчигч, гадагш удаан (10+ сек) харсан ч зам руу харах чиглэл давамгайлна.
   */
  windowMs: 30_000,
  minSpanMs: 15_000,
  minSamples: 90,
  maxMadDeg: 4,
  gainPerS: 0.5,
  maxDegPerS: 4,
  /** Калибрацийн чиглэлээс ихдээ ийм хэмжээгээр шилжинэ (самбарын голын утас ~35°). */
  maxDriftDeg: 40,
  /** Үүнээс их эргэсэн нүүрний pose найдваргүй. */
  maxAbsDeg: 45,
  /** Доош (утас, самбар) харж байхад чиглэл сурахгүй. */
  maxPitchOffsetDeg: 12,
};

type YawSample = { t: number; yaw: number };

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

export type TrackerContext = Readonly<{
  /** Машин зогсож байгаа эсэх. Зогсож байхад (утас, зорчигч руу харах) чиглэл сурахгүй. */
  stationary?: boolean;
}>;

export type BaselineTracker = Readonly<{
  /** Энэ фрэймийн дараах суурь. Дасан зохицох нөхцөл бүрдээгүй бол өмнөхөө буцаана. */
  update(observation: ComputerVisionObservation, context?: TrackerContext): Baseline;
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
  /** Урт цонх — зөвхөн машин явж байх үеийн (эсвэл хурд тодорхойгүй) кадр. */
  let yawSamples: YawSample[] = [];
  /** Анхны түгжээний богино цонх — зогсож байсан ч ашиглана. */
  let lockSamples: YawSample[] = [];
  let lastYawSampleAt: number | null = null;
  let lockArmedAt: number | null = null;
  let yawLocked = false;

  /** Анхны түгжээ амжаагүй бол урт цонх үүнийг орлоно — 35°-аас хол утсыг ч засна. */
  const tryLock = (t: number): boolean => {
    if (lockSamples.length < YAW.lockMinSamples || t - lockSamples[0].t < YAW.lockSpanMs) return false;
    const yaws = lockSamples.map((s) => s.yaw);
    const target = median(yaws);
    const spread = quantile(yaws.map((value) => Math.abs(value - target)).sort((a, b) => a - b), 0.9);
    if (spread > YAW.lockMaxSpreadDeg || Math.abs(target - initial.headYaw) > YAW.lockMaxOffsetDeg) return false;
    baseline = { ...baseline, headYaw: target };
    yawLocked = true;
    yawSamples = [];
    lockSamples = [];
    return true;
  };

  /** Нүд нээлттэй, толгой тэгш, тогтвортой үеийн чиглэлээр yaw-ийн суурийг сурна. */
  const learnYaw = (
    t: number,
    observation: ComputerVisionObservation,
    pose: { pitch: number; yaw: number; roll: number },
    blink: number | null,
    stationary: boolean,
  ) => {
    const eyesOpen =
      isNumber(blink) &&
      isNumber(observation.averageEar) &&
      blink < baseline.blinkClosed &&
      observation.averageEar > baseline.earClosed;
    const steadyHead =
      Math.abs(pose.yaw) <= YAW.maxAbsDeg &&
      Math.abs(pose.roll) <= ROLL_LIMIT_DEG &&
      Math.abs(pose.pitch - baseline.headPitch) <= YAW.maxPitchOffsetDeg &&
      isNumber(observation.jawOpen) &&
      observation.jawOpen <= MAX_JAW_OPEN;
    if (!eyesOpen || !steadyHead) return;

    lockArmedAt ??= t;
    if (!yawLocked && t - lockArmedAt <= YAW.lockArmMs) {
      lockSamples = [...lockSamples, { t, yaw: pose.yaw }].filter((s) => t - s.t <= YAW.lockWindowMs);
      if (tryLock(t)) return;
    } else if (lockSamples.length > 0) {
      lockSamples = [];
    }
    // Зогсож байхдаа (утас, зорчигч руу харах) урт цонхонд сурахгүй.
    if (stationary) return;

    const gap = lastYawSampleAt === null ? 0 : t - lastYawSampleAt;
    const dt = yawSamples.length === 0 ? 0 : Math.min(gap, MAX_FRAME_MS);
    lastYawSampleAt = t;
    yawSamples = [...yawSamples, { t, yaw: pose.yaw }].filter((s) => t - s.t <= YAW.windowMs);
    const yaws = yawSamples.map((s) => s.yaw);
    const span = t - yawSamples[0].t;

    if (
      yawSamples.length < YAW.minSamples ||
      span < YAW.minSpanMs ||
      medianAbsoluteDeviation(yaws) > YAW.maxMadDeg
    ) {
      return;
    }
    const headYaw = clamp(
      approach(baseline.headYaw, median(yaws), { gain: YAW.gainPerS, max: YAW.maxDegPerS }, dt),
      initial.headYaw - YAW.maxDriftDeg,
      initial.headYaw + YAW.maxDriftDeg,
    );
    baseline = { ...baseline, headYaw };
  };

  return {
    current: () => baseline,

    update(observation: ComputerVisionObservation, context: TrackerContext = {}): Baseline {
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
        yawSamples = [];
        lockSamples = [];
        recenterPending = recenterPending || positionChanged;
      } else if (!recenterPending && positionChanged) {
        samples = [];
        recenterPending = true;
      }

      learnYaw(t, observation, { pitch, yaw, roll }, blink, context.stationary === true);

      const usable =
        isNumber(blink) &&
        isNumber(observation.averageEar) &&
        isNumber(observation.jawOpen) &&
        Math.abs(yaw - baseline.headYaw) <= YAW_LIMIT_DEG &&
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
        // Суудал эсвэл утас шилжсэн — зам руу харах чиглэлийг дахин хурдан түгжинэ.
        yawLocked = false;
        lockArmedAt = null;
        yawSamples = [];
        lockSamples = [];
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
