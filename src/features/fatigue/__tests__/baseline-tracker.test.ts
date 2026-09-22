import { describe, expect, it } from 'bun:test';

import type { ComputerVisionObservation } from '@/features/computer-vision';

import { createBaselineTracker } from '../baseline-tracker';
import { type Baseline, deriveBaseline } from '../calibration';

const CALIBRATED: Baseline = deriveBaseline(0.1, 0.26, 8.6);
const FRAME_MS = 66; // ~15 фр/сек

function frame(t: number, over: Partial<ComputerVisionObservation> = {}): ComputerVisionObservation {
  return {
    timestampMs: t, faceDetected: true, faceConfidence: 0.9,
    leftEar: 0.26, rightEar: 0.26, averageEar: 0.26, leftBlink: 0.1, rightBlink: 0.1, jawOpen: 0,
    headPose: { pitch: 8.6, yaw: 0, roll: 0 }, brightness: 0.5, inferenceTimeMs: 10, landmarkCount: 478,
    ...over,
  };
}

/** `seconds` секундийн турш фрэйм тэжээж, эцсийн суурийг буцаана. */
function feed(
  tracker: ReturnType<typeof createBaselineTracker>,
  from: number,
  seconds: number,
  shape: (t: number) => Partial<ComputerVisionObservation>,
): { baseline: Baseline; until: number } {
  let baseline = tracker.current();
  let t = from;
  for (; t < from + seconds * 1_000; t += FRAME_MS) baseline = tracker.update(frame(t, shape(t)));
  return { baseline, until: t };
}

const atPitch = (pitch: number) => () => ({ headPose: { pitch, yaw: 0, roll: 0 } });

describe('createBaselineTracker', () => {
  it('жижиг байрлалын drift үүсэхэд толгойн суурь дагаж засагдана', () => {
    const tracker = createBaselineTracker(CALIBRATED);
    const { baseline } = feed(tracker, 0, 25, atPitch(12.6));
    expect(baseline.headPitch).toBeCloseTo(12.6, 0);
  });

  it('суурийг нэг дор шидэхгүй — шилжилт хэдэн секундэд аажим засагдана', () => {
    const tracker = createBaselineTracker(CALIBRATED);
    const { headPitch } = feed(tracker, 0, 5, atPitch(12.6)).baseline;
    expect(headPitch).toBeGreaterThan(CALIBRATED.headPitch);
    expect(headPitch).toBeLessThan(12);
  });

  it('богино дохилт суурийг мэдэгдэхүйц хөдөлгөхгүй', () => {
    const tracker = createBaselineTracker(CALIBRATED);
    const settled = feed(tracker, 0, 10, atPitch(8.6));
    expect(settled.baseline.headPitch).toBeCloseTo(8.6, 1);
    // 0.75 сек толгой унжаад өндийв.
    const nod = feed(tracker, settled.until, 0.75, atPitch(38.6));
    expect(nod.baseline.headPitch).toBeLessThan(10);
  });

  it('нүд ихэвчлэн аньсан бол — жинхэнэ ядаргаа байж мэднэ — суурийг хөдөлгөхгүй', () => {
    const tracker = createBaselineTracker(CALIBRATED);
    const drowsy = { leftBlink: 0.8, rightBlink: 0.8, headPose: { pitch: 38.6, yaw: 0, roll: 0 } };
    const { baseline } = feed(tracker, 0, 25, () => drowsy);
    expect(baseline).toEqual(CALIBRATED);
  });

  it('нүд нээлттэй байсан ч удаан унжилтыг 5°-оос илүү хэвийн болгож сурахгүй', () => {
    const tracker = createBaselineTracker(CALIBRATED);
    const { baseline } = feed(tracker, 0, 25, atPitch(38.6));
    expect(baseline.headPitch).toBeCloseTo(13.6, 5);
    expect(38.6 - baseline.headPitch).toBeGreaterThan(24);
  });

  it('нүүр эргэсэн фрэймийг тооцохгүй', () => {
    const tracker = createBaselineTracker(CALIBRATED);
    const { baseline } = feed(tracker, 0, 25, () => ({ headPose: { pitch: 12.6, yaw: 40, roll: 0 } }));
    expect(baseline).toEqual(CALIBRATED);
  });

  it('нүүр олдоогүй фрэйм суурийг өөрчлөхгүй', () => {
    const tracker = createBaselineTracker(CALIBRATED);
    const { baseline } = feed(tracker, 0, 25, () => ({ faceDetected: false, headPose: { pitch: 12.6, yaw: 0, roll: 0 } }));
    expect(baseline).toEqual(CALIBRATED);
  });

  it('цонх дүүрэхээс өмнө суурийг хөдөлгөхгүй', () => {
    const tracker = createBaselineTracker(CALIBRATED);
    expect(feed(tracker, 0, 2, atPitch(12.6)).baseline).toEqual(CALIBRATED);
  });

  it('нүүр удаан алга болж буцаж ирэхэд хуучин байрлалын түүхийг хаяна', () => {
    const tracker = createBaselineTracker(CALIBRATED);
    const before = feed(tracker, 0, 10, atPitch(8.6));
    // 10 сек эзгүй, дараа нь шинэ байрлалд суув.
    const after = feed(tracker, before.until + 10_000, 4, atPitch(12.6));
    expect(after.baseline.headPitch).toBeGreaterThan(9);
  });

  it('аяллын дунд нүдний босгыг өөрчилж аажим ядаргааг хэвийн болгохгүй', () => {
    const tracker = createBaselineTracker(CALIBRATED);
    const { baseline } = feed(tracker, 0, 25, () => ({ leftBlink: 0.3, rightBlink: 0.3 }));
    expect(baseline.blinkOpen).toBe(CALIBRATED.blinkOpen);
    expect(baseline.blinkClosed).toBe(CALIBRATED.blinkClosed);
  });
});
