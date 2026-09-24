import { describe, expect, it } from 'bun:test';

import type { ComputerVisionObservation } from '@/features/computer-vision';

import { createBaselineTracker } from '../baseline-tracker';
import { type Baseline, deriveBaseline } from '../calibration';

const CALIBRATED: Baseline = deriveBaseline(0.1, 0.26, 8.6, 0);
const FRAME_MS = 66; // ~15 фр/сек

function frame(t: number, over: Partial<ComputerVisionObservation> = {}): ComputerVisionObservation {
  return {
    timestampMs: t, faceDetected: true, faceConfidence: 0.9,
    faceBounds: { x: 0.32, y: 0.24, width: 0.36, height: 0.45, centerX: 0.5, centerY: 0.465 },
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
    // 15+ сек тасралтгүй нэг чиглэл нь утас хажууд байгааг илтгэх тул yaw-ийн
    // суурь түүнийг дагана (доорх yaw тестүүд). Түүнээс богино эргэлт pitch,
    // yaw-ийн аль алинд нөлөөлөхгүй.
    const tracker = createBaselineTracker(CALIBRATED);
    const { baseline } = feed(tracker, 0, 10, () => ({ headPose: { pitch: 12.6, yaw: 40, roll: 0 } }));
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

  it('нүүр түр алга болоод өөр байрлалд буцвал шинэ суурийг хурдан тогтооно', () => {
    const tracker = createBaselineTracker(CALIBRATED);
    const before = feed(tracker, 0, 4, atPitch(8.6));
    const lost = feed(tracker, before.until, 2, () => ({ faceDetected: false }));
    const moved = feed(tracker, lost.until, 1.5, () => ({
      faceBounds: { x: 0.44, y: 0.24, width: 0.36, height: 0.45, centerX: 0.62, centerY: 0.465 },
      headPose: { pitch: 28.6, yaw: 0, roll: 0 },
    }));

    expect(moved.baseline.headPitch).toBeCloseTo(28.6, 0);
  });

  it('нүүр алга болоод хуучин байрандаа унжсан буцвал шинэ суурь гэж сурахгүй', () => {
    const tracker = createBaselineTracker(CALIBRATED);
    const before = feed(tracker, 0, 4, atPitch(8.6));
    const lost = feed(tracker, before.until, 2, () => ({ faceDetected: false }));
    const drooped = feed(tracker, lost.until, 2, atPitch(38.6));

    expect(drooped.baseline.headPitch).toBe(CALIBRATED.headPitch);
  });

  it('нүүр тасралгүй харагдсан ч жолооч хажуу тийш шилжвэл шинэ суурьт дасна', () => {
    const tracker = createBaselineTracker(CALIBRATED);
    const before = feed(tracker, 0, 4, atPitch(8.6));
    const moved = feed(tracker, before.until, 1.5, () => ({
      faceBounds: { x: 0.47, y: 0.24, width: 0.36, height: 0.45, centerX: 0.65, centerY: 0.465 },
      headPose: { pitch: 28.6, yaw: 0, roll: 0 },
    }));

    expect(moved.baseline.headPitch).toBeCloseTo(28.6, 0);
  });

  it('нүүр буцаж ирэхдээ нүд аньсан бол шинэ байрлал гэж сурахгүй', () => {
    const tracker = createBaselineTracker(CALIBRATED);
    const before = feed(tracker, 0, 4, atPitch(8.6));
    const lost = feed(tracker, before.until, 2, () => ({ faceDetected: false }));
    const closed = feed(tracker, lost.until, 2, () => ({
      leftBlink: 0.8,
      rightBlink: 0.8,
      headPose: { pitch: 28.6, yaw: 0, roll: 0 },
    }));

    expect(closed.baseline).toEqual(CALIBRATED);
  });

  it('аяллын дунд нүдний босгыг өөрчилж аажим ядаргааг хэвийн болгохгүй', () => {
    const tracker = createBaselineTracker(CALIBRATED);
    const { baseline } = feed(tracker, 0, 25, () => ({ leftBlink: 0.3, rightBlink: 0.3 }));
    expect(baseline.blinkOpen).toBe(CALIBRATED.blinkOpen);
    expect(baseline.blinkClosed).toBe(CALIBRATED.blinkClosed);
  });

  describe('толгойн хэвтээ чиглэл (yaw)', () => {
    const atYaw = (yaw: number) => () => ({ headPose: { pitch: 8.6, yaw, roll: 0 } });

    it('утас хажуу талд байхад зам руу харах чиглэлийг 2 секундээс өмнө түгжинэ', () => {
      const tracker = createBaselineTracker(CALIBRATED);
      const { baseline } = feed(tracker, 0, 1.6, atYaw(30));
      expect(baseline.headYaw).toBeCloseTo(30, 0);
    });

    it('калибрацийн дараа утас руу харсан кадр холилдсон ч утасны чиглэлд түгжихгүй', () => {
      const tracker = createBaselineTracker(CALIBRATED);
      const phone = feed(tracker, 0, 1, atYaw(0));
      const { baseline } = feed(tracker, phone.until, 1.6, atYaw(30));
      expect(baseline.headYaw).toBeCloseTo(30, 0);
    });

    it('түгжсэний дараа толь харах, 10 секунд гадагш харах нь суурийг хөдөлгөхгүй', () => {
      const tracker = createBaselineTracker(CALIBRATED);
      const locked = feed(tracker, 0, 2, atYaw(0));
      const glances = feed(tracker, locked.until, 20, (t) => atYaw(t % 5_000 < 1_000 ? -40 : 0)());
      const { baseline } = feed(tracker, glances.until, 10, atYaw(30));
      expect(Math.abs(baseline.headYaw)).toBeLessThan(2);
    });

    it('35°-аас хол хажуу байрлалыг анхны түгжээгүй ч урт цонхоор засна', () => {
      const tracker = createBaselineTracker(CALIBRATED);
      const { baseline } = feed(tracker, 0, 30, atYaw(40));
      expect(baseline.headYaw).toBeCloseTo(40, 0);
    });

    it('калибрацаас 30 секундын дараа утас руу 1.5 секунд харахад суурь үсрэхгүй', () => {
      const tracker = createBaselineTracker(CALIBRATED);
      const road = feed(tracker, 0, 35, (t) => atYaw(t < 1_000 ? 40 : 40)());
      const { baseline } = feed(tracker, road.until, 1.6, atYaw(5));
      expect(baseline.headYaw).toBeGreaterThan(30);
    });

    it('шинэ чиглэл удаан давамгайлбал суурь түүнийг аажим дагана', () => {
      const tracker = createBaselineTracker(CALIBRATED);
      const locked = feed(tracker, 0, 2, atYaw(0));
      const { baseline } = feed(tracker, locked.until, 40, atYaw(10));
      expect(baseline.headYaw).toBeCloseTo(10, 0);
    });

    it('машин зогсож байхад чиглэл сурахгүй', () => {
      const tracker = createBaselineTracker(CALIBRATED);
      const locked = feed(tracker, 0, 2, atYaw(0));
      let baseline = tracker.current();
      for (let t = locked.until; t < locked.until + 40_000; t += FRAME_MS) {
        baseline = tracker.update(frame(t, atYaw(10)()), { stationary: true });
      }
      expect(baseline.headYaw).toBe(0);
    });
  });
});
