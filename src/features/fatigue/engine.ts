import type { ComputerVisionObservation, VisionStatus } from '@/features/computer-vision';

import { type Baseline, calibrate, CALIBRATION_MS } from './calibration';

export type FatigueLevel = 'normal' | 'warning' | 'critical';

export type FatigueEvent = Readonly<{
  id: string;
  /** Unix мс — серверт хадгалагдана. */
  occurredAt: number;
  type: 'camera_stopped' | 'camera_resumed';
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

  const update = (next: Partial<FatigueEngineState>) => {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener(state));
  };

  const record = (type: FatigueEvent['type']) => {
    events.push({ id: createId(), occurredAt: now(), type });
  };

  return {
    accept(observation: ComputerVisionObservation) {
      const monitoring = state.cameraStatus === 'running' && observation.faceDetected;
      if (monitoring !== state.monitoring) update({ monitoring });
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
      update({ calibration: 'running', baseline: null });
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
