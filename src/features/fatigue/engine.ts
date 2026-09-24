import type { ComputerVisionObservation, VisionStatus } from '@/features/computer-vision';
import { evaluateFaceQuality } from '@/features/computer-vision/face-quality';

import { type BaselineTracker, createBaselineTracker } from './baseline-tracker';
import { type Baseline, calibrate, CALIBRATION_MS } from './calibration';
import { createEyeTracker } from './eyes';
import { createHeadTracker } from './head';
import { computeScore, CRITICAL_CLOSURE_MS, type FatigueLevel, HIGH_SPEED_KMH, nextLevel } from './score';
import { createYawnTracker } from './yawn';

export type { FatigueLevel };

/** Түвшин өсөх үед л явдал бүртгэхийн тулд эрэмбэлнэ. */
const LEVEL_RANK: Record<FatigueLevel, number> = { normal: 0, warning: 1, critical: 2 };

/**
 * Машин зогссон эсэх, км/ц. Зогсож байхад GPS хэдэн км/ц хэлбэлздэг тул
 * орох, гарах босгыг салгав.
 */
const STATIONARY = { enterKmh: 5, exitKmh: 10 };
/**
 * Тасралтгүй жолоодлого: ийм хугацааны дараа завсарлага сануулж, амрах хүртэл
 * давтана. Ийм удаан зогсвол амарсан гэж үзнэ. Богино зогсолт (гэрлэн дохио,
 * түгжрэл) амралт биш тул жолоодлогын хугацаанд орно.
 */
const BREAK = { afterMs: 2 * 60 * 60_000, repeatMs: 30 * 60_000, restMs: 15 * 60_000 };
/** GPS тасарвал хоёр хэмжилтийн хоорондох хугацааг ийм хэмжээгээр хязгаарлана. */
const MAX_SPEED_GAP_MS = 5_000;
/** Энгийн анивчилтаас удаан анилтыг л нүдээ аньж явсан зайд тооцно. */
const BLIND_CLOSURE_MS = 500;

/** Аяллын дүн болон AI зөвлөгөөнд хэрэглэх хэмжүүрүүд. */
const createSession = (startedAt: number) => ({
  startedAt,
  scoreSum: 0,
  scoreCount: 0,
  maxScore: 0,
  perclosSum: 0,
  longClosures: 0,
  inLongClosure: false,
  quickNods: 0,
  lastQuickNods: 0,
  distanceM: 0,
  movingMs: 0,
  maxSpeedKmh: null as number | null,
  /** Нүд аньсан хугацаанд машин явсан хамгийн их зай. */
  maxBlindDistanceM: 0,
});

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
  /** Явдал гарах үеийн хурд. Хурд тодорхойгүй бол байхгүй. */
  speedKmh?: number;
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
  /** Машин зогсож байгаа эсэх. Хурд тодорхойгүй бол false. */
  stationary: boolean;
  /** Тасралтгүй удаан жолоодсон тул завсарлага авах хэрэгтэй. */
  breakDue: boolean;
  /** Энэ аялалд завсарлагын сануулга хэдэн удаа гарсан. */
  breakReminders: number;
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
    stationary: false, breakDue: false, breakReminders: 0,
  };
  let samples: ComputerVisionObservation[] = [];
  let lastCalibrationTimestamp: number | null = null;
  let baselineTracker: BaselineTracker | null = null;
  let eyes = createEyeTracker();
  let head = createHeadTracker();
  let yawn = createYawnTracker();
  let session = createSession(now());
  /** Калибрацийн дараа нүүр тасралтгүй алга болсон эхний фрэймийн цаг. */
  let faceMissingSince: number | null = null;
  /** Сүүлийн хурд (км/ц) ба түүнийг авсан Unix цаг. Тодорхойгүй бол null. */
  let speedKmh: number | null = null;
  let lastSpeedAt: number | null = null;
  /**
   * Тасралтгүй жолоодлого эхэлсэн цаг. GPS байхгүй бол аялал эхэлснээс
   * тоолно — хурд мэдэхгүй үед явж байна гэж үзэх нь аюулгүй.
   */
  let drivingSince = now();
  /**
   * Машин зогссон цаг. Дараа нь GPS тасрах, апп ард гарахад зогсолтыг
   * үргэлжилсэн гэж үзнэ — амралтын газарт утсаа авч явсан ч амралт тоологдоно.
   */
  let stoppedSince: number | null = null;
  let nextBreakAtMs = BREAK.afterMs;

  const update = (next: Partial<FatigueEngineState>) => {
    const changed = (Object.keys(next) as (keyof FatigueEngineState)[]).some((key) => next[key] !== state[key]);
    if (!changed) return;
    state = { ...state, ...next };
    listeners.forEach((listener) => listener(state));
  };

  const record = (type: FatigueEvent['type']) => {
    events.push({ id: createId(), occurredAt: now(), type, ...(speedKmh !== null && { speedKmh }) });
  };

  const checkBreak = (t: number) => {
    // Хангалттай амарсан бол дахин хөдлөх хүртэл тоолуурыг тэглэсээр байна.
    if (stoppedSince !== null && t - stoppedSince >= BREAK.restMs) {
      drivingSince = t;
      nextBreakAtMs = BREAK.afterMs;
    }
    const drivingMs = t - drivingSince;
    const remind = drivingMs >= nextBreakAtMs;
    // Апп удаан ард байсан бол алгассан сануулгуудыг дараалуулан дуугаргахгүй.
    if (remind) nextBreakAtMs = drivingMs + BREAK.repeatMs;
    update({ breakDue: drivingMs >= BREAK.afterMs, breakReminders: state.breakReminders + (remind ? 1 : 0) });
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
    const level = nextLevel(state.level, score, eyeState, headState, yawnState, {
      faceMissingMs,
      stationary: state.stationary,
      highSpeed: speedKmh !== null && speedKmh >= HIGH_SPEED_KMH,
    });
    const longClosure = eyeState.closureMs >= CRITICAL_CLOSURE_MS;
    const blindDistanceM = speedKmh === null || eyeState.closureMs < BLIND_CLOSURE_MS ? 0 : (speedKmh / 3.6) * (eyeState.closureMs / 1000);
    session = {
      ...session,
      scoreSum: session.scoreSum + score,
      scoreCount: session.scoreCount + 1,
      maxScore: Math.max(session.maxScore, score),
      perclosSum: session.perclosSum + eyeState.perclos,
      // Нэг удаагийн урт анилтыг нүд нээгдэх хүртэл нэг л удаа тоолно.
      longClosures: session.longClosures + (longClosure && !session.inLongClosure ? 1 : 0),
      inLongClosure: longClosure || (session.inLongClosure && eyeState.closureMs > 0),
      // headState.quickNods нь сүүлийн 60 сек-ийн тоо тул зөвхөн өсөлтийг нэмнэ.
      quickNods: session.quickNods + Math.max(0, headState.quickNods - session.lastQuickNods),
      lastQuickNods: headState.quickNods,
      maxBlindDistanceM: Math.max(session.maxBlindDistanceM, blindDistanceM),
    };
    // Critical-аас warning руу буурах нь шинэ анхааруулга биш. Өмнө нь үүнийг
    // fatigue_warning гэж бүртгэдэг байсан тул анхааруулгын тоо хөөрөгддөг байв.
    const escalated = LEVEL_RANK[level] > LEVEL_RANK[state.level];
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
        checkBreak(now());
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
      session = createSession(now());
      speedKmh = null;
      lastSpeedAt = null;
      drivingSince = now();
      stoppedSince = null;
      nextBreakAtMs = BREAK.afterMs;
      update({
        calibration: 'running', calibrationProgress: 0, calibrationPhase: 'eye', baseline: null, level: 'normal', score: 0,
        stationary: false, breakDue: false, breakReminders: 0,
      });
    },

    /**
     * GPS-ийн хурдыг (км/ц) авна. Тодорхойгүй (зөвшөөрөлгүй, дохио тасарсан) бол
     * null. Зогссон эсэх, явсан зай, тасралтгүй жолоодсон хугацааг тооцно.
     */
    onSpeed(kmh: number | null) {
      const t = now();
      if (state.calibration !== 'done') return;
      // Өмнөх хурдаар өнгөрсөн хугацааг тооцно. GPS удаан тасарсан бол зайг таахгүй.
      const dt = lastSpeedAt === null ? 0 : Math.min(t - lastSpeedAt, MAX_SPEED_GAP_MS);
      if (speedKmh !== null && dt > 0) {
        session = {
          ...session,
          distanceM: session.distanceM + (speedKmh / 3.6) * (dt / 1000),
          movingMs: session.movingMs + (state.stationary ? 0 : dt),
        };
      }
      speedKmh = kmh;
      lastSpeedAt = kmh === null ? null : t;
      if (kmh !== null) session = { ...session, maxSpeedKmh: Math.max(session.maxSpeedKmh ?? 0, kmh) };

      const stationary = kmh !== null && (state.stationary ? kmh < STATIONARY.exitKmh : kmh <= STATIONARY.enterKmh);
      if (stationary) stoppedSince ??= t;
      else if (kmh !== null) stoppedSince = null;
      update({ stationary });
      checkBreak(t);
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
        /** Аяллын дундаж PERCLOS (0…1). Үнэлгээ хийгдээгүй бол null. */
        perclos: session.scoreCount > 0 ? Math.round((session.perclosSum / session.scoreCount) * 100) / 100 : null,
        /** 1.5 сек-ээс удаан аньсан удаа. */
        longClosureCount: session.longClosures,
        /** Жижиг, хурдан толгой дохилтын тоо. */
        quickNodCount: session.quickNods,
        /** GPS-ээр тооцсон явсан зай. */
        distanceKm: Math.round(session.distanceM / 100) / 10,
        /** Явж байх үеийн дундаж хурд. Хурд хэмжээгүй бол null. */
        avgSpeedKmh: session.movingMs > 0 ? Math.round((session.distanceM / session.movingMs) * 3_600) : null,
        maxSpeedKmh: session.maxSpeedKmh,
        /** Нүд аньсан хугацаанд машин явсан хамгийн их зай. */
        maxBlindDistanceM: Math.round(session.maxBlindDistanceM),
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
