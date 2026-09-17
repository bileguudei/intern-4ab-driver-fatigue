import type { ComputerVisionObservation, VisionStatus } from '@/features/computer-vision';

import { type Baseline, calibrate, CALIBRATION_MS } from './calibration';
import { createEyeTracker } from './eyes';
import { createHeadTracker } from './head';
import { computeScore, type FatigueLevel, nextLevel } from './score';

export type { FatigueLevel };

/** Толгой ийм их бөхийсөн үед eyeBlink найдваргүй (хэмжилт) — анилтыг тоолохгүй. */
const HEAD_DOWN_IGNORE_EYES_DEG = 15;

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
    level: 'normal', score: 0, cameraStatus: 'idle', monitoring: false, calibration: 'idle', baseline: null,
  };
  let samples: ComputerVisionObservation[] = [];
  let eyes = createEyeTracker();
  let head = createHeadTracker();
  let session = { startedAt: now(), scoreSum: 0, scoreCount: 0, maxScore: 0 };

  const update = (next: Partial<FatigueEngineState>) => {
    const changed = (Object.keys(next) as (keyof FatigueEngineState)[]).some((key) => next[key] !== state[key]);
    if (!changed) return;
    state = { ...state, ...next };
    listeners.forEach((listener) => listener(state));
  };

  const record = (type: FatigueEvent['type']) => {
    events.push({ id: createId(), occurredAt: now(), type });
  };

  const assess = (observation: ComputerVisionObservation, baseline: Baseline) => {
    const headState = head.update(observation, baseline);
    const eyeUpdate = eyes.update(observation, baseline);
    const eyeState = headState.downDeg > HEAD_DOWN_IGNORE_EYES_DEG ? { ...eyeUpdate, closureMs: 0 } : eyeUpdate;
    const score = computeScore(eyeState, headState);
    const level = nextLevel(state.level, score, eyeState, headState);
    session = { ...session, scoreSum: session.scoreSum + score, scoreCount: session.scoreCount + 1, maxScore: Math.max(session.maxScore, score) };
    const escalated = level !== state.level && level !== 'normal';
    if (escalated) record(level === 'critical' ? 'fatigue_critical' : 'fatigue_warning');
    update({ score, level });
  };

  return {
    accept(observation: ComputerVisionObservation) {
      const monitoring = state.cameraStatus === 'running' && observation.faceDetected;
      if (monitoring !== state.monitoring) update({ monitoring });
      if (state.calibration === 'done' && state.baseline !== null) assess(observation, state.baseline);
      if (state.calibration !== 'running') return;

      samples.push(observation);
      // Монотон цагаар хэмжинэ — фрэйм тасарсан ч 10 сек-ийн цонх зөв байна.
      if (observation.timestampMs - samples[0].timestampMs < CALIBRATION_MS) return;
      const baseline = calibrate(samples);
      samples = [];
      update({ baseline, calibration: baseline ? 'done' : 'failed' });
    },

    /** Жолоочоос шулуун харж, хэвийн анивчихыг хүсээд дуудна. */
    startCalibration() {
      samples = [];
      eyes = createEyeTracker();
      head = createHeadTracker();
      session = { startedAt: now(), scoreSum: 0, scoreCount: 0, maxScore: 0 };
      update({ calibration: 'running', baseline: null, level: 'normal', score: 0 });
    },

    /** Жолоодлого дуусгах — UI-ийн SessionSummary хэлбэрээр. */
    finish() {
      const count = (type: FatigueEvent['type']) => events.filter((e) => e.type === type).length;
      return {
        durationSeconds: Math.round((now() - session.startedAt) / 1000),
        warningCount: count('fatigue_warning'),
        criticalCount: count('fatigue_critical'),
        maxScore: session.maxScore,
        avgScore: session.scoreCount > 0 ? Math.round(session.scoreSum / session.scoreCount) : 0,
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
