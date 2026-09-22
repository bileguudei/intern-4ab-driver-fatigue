import type { ComputerVisionObservation } from '@/features/computer-vision';

import type { Baseline } from './calibration';
import { MAX_FRAME_MS } from './eyes';

/**
 * Калибраци нь суурийг нэг л удаа, эхэнд хэмждэг. Жолооч суудлаа тохируулах,
 * утсаа шилжүүлэх, бүслүүрээ янзлахад толгойн өнцөг тэр суурьтай таарахаа
 * больдог. Тэгэхэд downDeg байнга HEAD_DOWN_IGNORE_EYES_DEG-ээс давж, engine
 * нүдийг огт тоохоо больдог — яг тэр үед анилт илрэхгүй өнгөрнө.
 *
 * Энэ модуль толгойн суурийн жижиг drift-ийг сүүлийн үеийн ажиглалтаар аажим
 * дагуулна. Том шилжилтийг автоматаар хэвийн болгохгүй: камер хөдөлсөн эсэх,
 * жолооч удаан унжсан эсэхийг зөвхөн pitch-ээс аюулгүй ялгах боломжгүй.
 */

/** Дүгнэлтийн цонх. Богино цонх шинэ байрлалд хурдан дасах ч шуугианд мэдрэг. */
const WINDOW_MS = 8_000;
/** Ийм хугацааг хамраагүй цонхонд итгэхгүй — хэдэн фрэйм суурийг хөдөлгөх ёсгүй. */
const MIN_SPAN_MS = 3_000;
const MIN_SAMPLES = 20;
/** Нүүр эргэсэн үед pitch найдваргүй — толин харцыг цонхонд оруулахгүй. */
const YAW_LIMIT_DEG = 25;
/** Нүүр ийм удаан алга бол дахин суусан гэж үзээд хуучин байрлалын түүхийг хаяна. */
const RESET_GAP_MS = 3_000;
/**
 * Цонхны фрэймийн ийм хувь аньсан бол суурийг хөдөлгөхгүй. Толгой унжуулаад
 * нойрмоглож буй жолоочийн төлвийг «хэвийн» гэж сурахаас хамгаалах гол хаалт.
 */
const MAX_CLOSED_RATIO = 0.2;
/** Эвшээлт, ярианы үеийн фрэймийг хэвийн байрлал гэж сурахгүй. */
const MAX_JAW_OPEN = 0.35;
/** Хэт налсан нүүрний pitch найдвартай бус. */
const ROLL_LIMIT_DEG = 20;
/** Анхны калибрациас ихдээ ийм хэмжээгээр л автоматаар засна. */
const MAX_PITCH_DRIFT_DEG = 5;
/**
 * Засварын хурд — алдааны хувиар. Том шилжилт хурдан, жижиг хэлбэлзэл зөөлөн
 * засагдана. Дээд хязгаар нь гэнэтийн үсрэлтээс хамгаална.
 */
const PITCH = { gainPerS: 0.3, maxDegPerS: 3 };

type Sample = { t: number; blink: number; pitch: number };

const isNumber = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const average = (a: number | null, b: number | null) =>
  isNumber(a) && isNumber(b) ? (a + b) / 2 : null;

/** Эрэмбэлсэн массивын q хувийн утга. */
function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

const median = (values: readonly number[]) => quantile([...values].sort((a, b) => a - b), 0.5);

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

export function createBaselineTracker(initial: Baseline): BaselineTracker {
  let baseline = initial;
  let samples: Sample[] = [];
  let lastAt: number | null = null;

  return {
    current: () => baseline,

    update(observation: ComputerVisionObservation): Baseline {
      const t = observation.timestampMs;
      const blink = average(observation.leftBlink, observation.rightBlink);
      const { pitch, yaw, roll } = observation.headPose ?? { pitch: null, yaw: null, roll: null };
      const usable =
        observation.faceDetected &&
        isNumber(blink) &&
        isNumber(observation.averageEar) &&
        isNumber(observation.jawOpen) &&
        isNumber(pitch) &&
        isNumber(yaw) &&
        isNumber(roll) &&
        Math.abs(yaw) <= YAW_LIMIT_DEG &&
        Math.abs(roll) <= ROLL_LIMIT_DEG &&
        observation.jawOpen <= MAX_JAW_OPEN;
      if (!usable) return baseline;

      const gap = lastAt === null ? 0 : t - lastAt;
      if (gap > RESET_GAP_MS) samples = [];
      const dt = samples.length === 0 ? 0 : Math.min(gap, MAX_FRAME_MS);
      lastAt = t;

      samples = [...samples, { t, blink, pitch }].filter(
        (s) => t - s.t <= WINDOW_MS,
      );
      if (samples.length < MIN_SAMPLES || t - samples[0].t < MIN_SPAN_MS) return baseline;

      const closedRatio = samples.filter((s) => s.blink > baseline.blinkClosed).length / samples.length;
      if (closedRatio > MAX_CLOSED_RATIO) return baseline;

      const targetPitch = median(samples.map((s) => s.pitch));
      const headPitch = clamp(
        approach(
          baseline.headPitch,
          targetPitch,
          { gain: PITCH.gainPerS, max: PITCH.maxDegPerS },
          dt,
        ),
        initial.headPitch - MAX_PITCH_DRIFT_DEG,
        initial.headPitch + MAX_PITCH_DRIFT_DEG,
      );

      // Нүдний босгыг аяллын дунд өөрчилбөл аажим нойрмоглолтыг хэвийн гэж
      // сурах эрсдэлтэй. Тэдгээрийг зөвхөн ил калибраци шинэчилнэ.
      baseline = { ...baseline, headPitch };
      return baseline;
    },
  };
}
