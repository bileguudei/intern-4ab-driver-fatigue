import { describe, expect, it } from 'bun:test';

import type { ComputerVisionObservation } from '@/features/computer-vision';

import { calibrate } from '../calibration';

function frame(
  blink: number,
  ear = 0.26,
  pitch = 4,
  faceDetected = true,
  yaw = 0,
  roll = 0,
): ComputerVisionObservation {
  return {
    timestampMs: 0, faceDetected, faceConfidence: null,
    leftEar: ear, rightEar: ear, averageEar: ear, leftBlink: blink, rightBlink: blink, jawOpen: 0,
    headPose: { pitch, yaw, roll }, brightness: 0.5, inferenceTimeMs: 10, landmarkCount: 478,
  };
}

const frames = (count: number, blink: number) => Array.from({ length: count }, () => frame(blink));

describe('calibrate', () => {
  it('нээлттэй нүднээс суурь ба аньсан босгыг гаргана', () => {
    const baseline = calibrate(frames(150, 0.2));
    expect(baseline?.blinkOpen).toBeCloseTo(0.2);
    expect(baseline?.blinkClosed).toBeCloseTo(0.55);
    expect(baseline?.earClosed).toBeCloseTo(0.104);
    expect(baseline?.headPitch).toBe(4);
  });

  it('калибрацийн үеийн анивчилт суурийг өөрчлөхгүй', () => {
    const baseline = calibrate([...frames(135, 0.2), ...frames(15, 0.75)]);
    expect(baseline?.blinkOpen).toBeCloseTo(0.2);
  });

  it('нарийн нүдтэй жолоочид босгыг хэт өндөр тавихгүй', () => {
    expect(calibrate(frames(150, 0.6))?.blinkClosed).toBe(0.85);
  });

  it('нүүр хангалттай олдоогүй бол null', () => {
    const lost = Array.from({ length: 100 }, () => frame(0.2, 0.26, 4, false));
    expect(calibrate([...frames(40, 0.2), ...lost])).toBeNull();
  });

  it('60-аас олон valid sample байсан ч ихэнх хугацаанд нүүр алдагдсан бол null', () => {
    const lost = Array.from({ length: 30 }, () => frame(0.2, 0.26, 4, false));
    expect(calibrate([...frames(70, 0.2), ...lost])).toBeNull();
  });

  it('хажуу тийш харсан калибрацийг хүлээж авахгүй', () => {
    const turned = Array.from({ length: 150 }, () => frame(0.2, 0.26, 4, true, 35));
    expect(calibrate(turned)).toBeNull();
  });

  it('толгой тогтворгүй хөдөлсөн калибрацийг хүлээж авахгүй', () => {
    const unstable = [
      ...Array.from({ length: 75 }, () => frame(0.2, 0.26, -10)),
      ...Array.from({ length: 75 }, () => frame(0.2, 0.26, 18)),
    ];
    expect(calibrate(unstable)).toBeNull();
  });
});
