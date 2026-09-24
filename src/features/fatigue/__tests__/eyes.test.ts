import { describe, expect, it } from 'bun:test';

import type { ComputerVisionObservation } from '@/features/computer-vision';

import type { Baseline } from '../calibration';
import { createEyeTracker, type EyeState } from '../eyes';

const BASELINE: Baseline = { blinkOpen: 0.2, blinkClosed: 0.55, earOpen: 0.26, earClosed: 0.1, headPitch: 0, headYaw: 0 };
const OPEN = 0.2;
const CLOSED = 0.75;

function frame(t: number, blink: number, faceDetected = true): ComputerVisionObservation {
  return {
    timestampMs: t, faceDetected, faceConfidence: null,
    faceBounds: faceDetected ? { x: 0.32, y: 0.24, width: 0.36, height: 0.45, centerX: 0.5, centerY: 0.465 } : null,
    leftEar: 0.26, rightEar: 0.26, averageEar: 0.26, leftBlink: blink, rightBlink: blink, jawOpen: 0,
    headPose: null, brightness: 0.5, inferenceTimeMs: 10, landmarkCount: 478,
  };
}

/** `from`-оос `to` хүртэл 15 фр/сек-т ижил eyeBlink-тэй фрэймүүдийг өгөөд сүүлийн төлвийг буцаана. */
function feed(tracker: ReturnType<typeof createEyeTracker>, from: number, to: number, blink: number | ((t: number) => number), face = true): EyeState {
  let state: EyeState = { closed: false, closureMs: 0, perclos: 0 };
  for (let t = from; t < to; t += 66) {
    state = tracker.update(frame(t, typeof blink === 'number' ? blink : blink(t), face), BASELINE);
  }
  return state;
}

describe('createEyeTracker', () => {
  it('2 сек аньсан хугацааг хэмжиж, нээгдэхэд 0 болгоно', () => {
    const eyes = createEyeTracker();
    feed(eyes, 0, 5_000, OPEN);
    expect(feed(eyes, 5_000, 7_000, CLOSED).closureMs).toBeGreaterThan(1_900);
    expect(feed(eyes, 7_000, 7_200, OPEN).closureMs).toBe(0);
  });

  it('босгыг шүргэх хэлбэлзэлд анилт тасрахгүй (гистерезис)', () => {
    const eyes = createEyeTracker();
    feed(eyes, 0, 1_000, CLOSED);
    const state = feed(eyes, 1_000, 3_000, (t) => (Math.round(t / 66) % 2 ? 0.5 : 0.6));
    expect(state.closed).toBe(true);
    expect(state.closureMs).toBeGreaterThan(2_800);
  });

  it('60 сек-ээс 6 сек аньсан бол PERCLOS ≈ 0.1', () => {
    const eyes = createEyeTracker();
    feed(eyes, 0, 54_000, OPEN);
    expect(feed(eyes, 54_000, 60_000, CLOSED).perclos).toBeCloseTo(0.1, 1);
  });

  it('фрэйм 8 сек тасарвал хуурамч урт анилт, PERCLOS үүсгэхгүй', () => {
    const eyes = createEyeTracker();
    feed(eyes, 0, 1_000, OPEN);
    feed(eyes, 1_000, 1_200, CLOSED);
    const state = feed(eyes, 9_200, 9_400, CLOSED);
    expect(state.closureMs).toBeLessThan(300);
    expect(state.perclos).toBeLessThan(0.5);
  });

  it('нүүр олдоогүй фрэймийг PERCLOS-д тоолохгүй', () => {
    const eyes = createEyeTracker();
    feed(eyes, 0, 30_000, CLOSED, false);
    expect(feed(eyes, 30_000, 60_000, OPEN).perclos).toBe(0);
  });

  it('толгой байрлалаасаа зөрсөн үед blink ба EAR хоёулаа анилт заавал батална', () => {
    const eyes = createEyeTracker();
    const falseBlink = frame(0, CLOSED);
    expect(
      eyes.update(falseBlink, BASELINE, { requireEarConfirmation: true }).closed,
    ).toBe(false);

    const trulyClosed = {
      ...frame(66, CLOSED),
      leftEar: 0.14,
      rightEar: 0.14,
      averageEar: 0.14,
    };
    expect(
      eyes.update(trulyClosed, BASELINE, { requireEarConfirmation: true }).closed,
    ).toBe(true);
  });
});
