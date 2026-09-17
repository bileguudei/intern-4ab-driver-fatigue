import type { ComputerVisionObservation, VisionStatus } from '@/features/computer-vision';

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
  let state: FatigueEngineState = { level: 'normal', score: 0, cameraStatus: 'idle', monitoring: false };

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
      if (monitoring === state.monitoring) return;
      update({ monitoring });
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
