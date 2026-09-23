import type { ComputerVisionObservation, VisionStatus } from '@/features/computer-vision';
import { evaluateFaceQuality } from '@/features/computer-vision/face-quality';

import { type BaselineTracker, createBaselineTracker } from './baseline-tracker';
import { type Baseline, calibrate, CALIBRATION_MS } from './calibration';
import { createEyeTracker } from './eyes';
import { createHeadTracker } from './head';
import { computeScore, type FatigueLevel, nextLevel } from './score';
import { createYawnTracker } from './yawn';

export type { FatigueLevel };

/** Толгой ийм их бөхийсөн үед eyeBlink-ийг EAR-аар давхар батална. */
const HEAD_DOWN_EAR_CONFIRM_DEG = 15;
/** Baseline-ийн маш жижиг алхам бүр UI-г дахин render хийхээс хамгаална. */
const BASELINE_PUBLISH_DELTA_DEG = 0.25;
/** Үүнээс урт frame gap гарвал калибрацийн тогтвортой хугацааг шинээр эхлүүлнэ. */
const MAX_CALIBRATION_FRAME_GAP_MS = 500;

export type FatigueEvent = Readonly<{
  id: string;
  /** Unix мс — серверт хадгалагдана. */
  occurredAt: number;
  type: 'camera_stopped' | 'camera_resumed' | 'fatigue_warning' | 'fatigue_critical';
}>;

export type FatigueEngineState = Readonly<{
  level: FatigueLevel;
  score: number;
  cameraStatus: VisionStatus;
  /** Камер ажиллаж, нүүрний өгөгдөл ирж байгаа эсэх. */
  monitoring: boolean;
  calibration: 'idle' | 'running' | 'done' | 'failed';
  calibrationProgress: number;
  calibrationPhase: 'eye' | 'head';
  baseline: Baseline | null;
}>;

export type FatigueEngineOptions = { now?: () => number; createId?: () => string };

/**
 * Ядаргааны логикийн нэг цэг. Камерын ажиглалт, камерын төлвийг хүлээн
 * авч дэлгэцэд төлөв, серверт явдал гаргана.
 *
 * Цагийн дүрэм: `observation.timestampMs` нь төхөөрөмжийн монотон цаг —
 * зөвхөн үргэлжлэх хугацаанд. Хадгалах явдлын цагт `now()` (Unix).
 */
export function createFatigueEngine({
  now = Date.now,
  createId = () => `${now()}-${Math.random().toString(36).slice(2, 10)}`,
}: FatigueEngineOptions = {}) {
  const listeners = new Set<(state: FatigueEngineState) => void>();
  const events: FatigueEvent[] = [];
  let state: FatigueEngineState = {
    level: 'normal', score: 0, cameraStatus: 'idle', monitoring: false, calibration: 'idle', calibrationProgress: 0, calibrationPhase: 'eye', baseline: null,
  };
  let samples: ComputerVisionObservation[] = [];
  let lastCalibrationTimestamp: number | null = null;
  let baselineTracker: BaselineTracker | null = null;
  let eyes = createEyeTracker();
  let head = createHeadTracker();
  let yawn = createYawnTracker();
  let session = { startedAt: now(), scoreSum: 0, scoreCount: 0, maxScore: 0 };
  /** Калибрацийн дараа нүүр тасралтгүй алга болсон эхний фрэймийн цаг. */
  let faceMissingSince: number | null = null;

  const update = (next: Partial<FatigueEngineState>) => {
    const changed = (Object.keys(next) as (keyof FatigueEngineState)[]).some((key) => next[key] !== state[key]);
    if (!changed) return;
    state = { ...state, ...next };
    listeners.forEach((listener) => listener(state));
  };

  const record = (type: FatigueEvent['type']) => {
    events.push({ id: createId(), occurredAt: now(), type });
  };

  const resetCalibrationWindow = () => {
    samples = [];
    lastCalibrationTimestamp = null;
    update({ calibrationProgress: 0, calibrationPhase: 'eye' });
  };

  const assess = (observation: ComputerVisionObservation, baseline: Baseline) => {
    faceMissingSince = observation.faceDetected ? null : (faceMissingSince ?? observation.timestampMs);
    const faceMissingMs = faceMissingSince === null ? null : observation.timestampMs - faceMissingSince;
    const headState = head.update(observation, baseline);
    const yawnState = yawn.update(observation);
    // Толгой калибрацийн байрлалаас их зөрөхөд eyeBlink дангаараа найдваргүй.
    // Гэхдээ анилтыг бүр мөсөн хаяхгүй: EAR мөн баталбал үргэлжлүүлэн тоолно.
    const eyeUpdate = eyes.update(observation, baseline, {
      requireEarConfirmation: headState.downDeg > HEAD_DOWN_EAR_CONFIRM_DEG,
    });
    // Эвшээх үед нүд аяндаа анилдаг тул зөвхөн энэ үед урт анилтыг тусгаарлана.
    const ignoreEyes = yawnState.open;
    const eyeState = ignoreEyes ? { ...eyeUpdate, closureMs: 0 } : eyeUpdate;
    const score = computeScore(eyeState, headState, yawnState);
    const level = nextLevel(state.level, score, eyeState, headState, yawnState, faceMissingMs);
    session = { ...session, scoreSum: session.scoreSum + score, scoreCount: session.scoreCount + 1, maxScore: Math.max(session.maxScore, score) };
    const escalated = level !== state.level && level !== 'normal';
    if (escalated) record(level === 'critical' ? 'fatigue_critical' : 'fatigue_warning');
    update({ score, level });
    return level;
  };

  return {
    accept(observation: ComputerVisionObservation) {
      const monitoring = state.cameraStatus === 'running' && observation.faceDetected;
      if (monitoring !== state.monitoring) update({ monitoring });
      if (state.calibration === 'done' && state.baseline !== null) {
        let currentBaseline = baselineTracker?.current() ?? state.baseline;
        if (baselineTracker !== null) {
          const adjusted = baselineTracker.update(observation);
          currentBaseline = adjusted;
          if (Math.abs(adjusted.headPitch - state.baseline.headPitch) >= BASELINE_PUBLISH_DELTA_DEG) {
            update({ baseline: adjusted });
          }
        }
        assess(observation, currentBaseline);
      }
      if (state.calibration !== 'running') return;

      // Буруу байрласан/эргэж харсан нүүрний өгөгдлөөр baseline үүсгэхгүй.
      // Нөхцөл алдагдвал 10 секундын тогтвортой хэмжилтийг шинээр эхлүүлнэ.
      const calibrationQuality = evaluateFaceQuality(observation);
      // Ердийн анивчилтыг зөвшөөрнө: calibrate() медиан ашигладаг тул цөөн
      // closed frame нээлттэй нүдний baseline-ийг гажуудуулахгүй.
      if (!calibrationQuality.ready && calibrationQuality.issue !== 'eyes-closed') {
        resetCalibrationWindow();
        return;
      }
      if (lastCalibrationTimestamp !== null && observation.timestampMs - lastCalibrationTimestamp > MAX_CALIBRATION_FRAME_GAP_MS) {
        resetCalibrationWindow();
      }
      samples.push(observation);
      lastCalibrationTimestamp = observation.timestampMs;
      const elapsed = observation.timestampMs - samples[0].timestampMs;
      update({ calibrationProgress: Math.min(elapsed / CALIBRATION_MS, 1), calibrationPhase: elapsed < CALIBRATION_MS / 2 ? 'eye' : 'head' });
      if (elapsed < CALIBRATION_MS) return;
      const baseline = calibrate(samples);
      const initialBounds = samples.at(-1)?.faceBounds ?? null;
      samples = [];
      lastCalibrationTimestamp = null;
      baselineTracker = baseline === null ? null : createBaselineTracker(baseline, initialBounds);
      head = createHeadTracker(baseline === null ? null : initialBounds);
      update({ baseline, calibration: baseline ? 'done' : 'failed', calibrationProgress: baseline ? 1 : 0 });
    },

    /** Жолоочоос шулуун харж, хэвийн анивчихыг хүсээд дуудна. */
    startCalibration() {
      samples = [];
      lastCalibrationTimestamp = null;
      baselineTracker = null;
      faceMissingSince = null;
      events.length = 0; // өмнөх аяллын явдал шинэ аяллын дүнд орохгүй
      eyes = createEyeTracker();
      head = createHeadTracker();
      yawn = createYawnTracker();
      session = { startedAt: now(), scoreSum: 0, scoreCount: 0, maxScore: 0 };
      update({ calibration: 'running', calibrationProgress: 0, calibrationPhase: 'eye', baseline: null, level: 'normal', score: 0 });
    },

    /** Жолоодлого дуусгах — UI-ийн SessionSummary хэлбэрээр. */
    finish() {
      const count = (type: FatigueEvent['type']) => events.filter((e) => e.type === type).length;
      const at = (type: FatigueEvent['type']) => events.filter((e) => e.type === type).map((e) => e.occurredAt);
      const resumes = at('camera_resumed');
      const unmonitoredMs = at('camera_stopped').reduce((sum, stop, i) => sum + (resumes[i] ?? now()) - stop, 0);
      return {
        durationSeconds: Math.round((now() - session.startedAt) / 1000),
        warningCount: count('fatigue_warning'),
        criticalCount: count('fatigue_critical'),
        maxScore: session.maxScore,
        avgScore: session.scoreCount > 0 ? Math.round(session.scoreSum / session.scoreCount) : 0,
        /** Апп ард гарч камер зогссон нийт хугацаа. */
        unmonitoredSeconds: Math.round(unmonitoredMs / 1000),
      };
    },

    /**
     * Апп ард гарах, камер тасрахыг бүртгэнэ. iOS ард камер ажиллуулдаггүй тул
     * жолоочид «хяналт зогссон» гэж мэдэгдэх нь дохионы хэсгийн ажил.
     */
    onCameraStatus(cameraStatus: VisionStatus) {
      const wasRunning = state.cameraStatus === 'running';
      const isRunning = cameraStatus === 'running';
      const stopped = wasRunning && !isRunning;
      const resumed = !wasRunning && isRunning && events.some((e) => e.type === 'camera_stopped');
      if (stopped) record('camera_stopped');
      // Камер зогссон хугацааг нүүр алга болсон хугацаанд оруулахгүй.
      if (!isRunning) faceMissingSince = null;
      if (!isRunning && state.calibration === 'running') resetCalibrationWindow();
      if (resumed) record('camera_resumed');
      update({ cameraStatus, monitoring: isRunning && state.monitoring });
    },

    subscribe(listener: (state: FatigueEngineState) => void) {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },

    getState: () => state,
    getEvents: (): readonly FatigueEvent[] => events,
  };
}

export type FatigueEngine = ReturnType<typeof createFatigueEngine>;
