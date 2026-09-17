import { describe, expect, it } from 'bun:test';

import type { ComputerVisionObservation } from '@/features/computer-vision';

import type { Baseline } from '../calibration';
import { createHeadTracker, type HeadState } from '../head';

const BASELINE: Baseline = { blinkOpen: 0.2, blinkClosed: 0.55, earOpen: 0.26, earClosed: 0.1, headPitch: 3 };

function frame(t: number, pitch: number): ComputerVisionObservation {
  return {
    timestampMs: t, faceDetected: true, faceConfidence: null,
    leftEar: 0.26, rightEar: 0.26, averageEar: 0.26, leftBlink: 0.2, rightBlink: 0.2, jawOpen: 0,
    headPose: { pitch, yaw: 0, roll: 0 }, brightness: 0.5, inferenceTimeMs: 10, landmarkCount: 478,
  };
}

/** Толгойн өнцгийн хэлбэрийг [мс, градус] цэгүүдээр өгч, 15 фр/сек-т шугаман завсарлана. */
function motion(head: ReturnType<typeof createHeadTracker>, points: [number, number][]): HeadState {
  let state: HeadState = { downDeg: 0, droopMs: 0, quickNods: 0 };
  for (let i = 1; i < points.length; i++) {
    const [t0, p0] = points[i - 1];
    const [t1, p1] = points[i];
    for (let t = t0; t < t1; t += 66) state = head.update(frame(t, p0 + ((p1 - p0) * (t - t0)) / (t1 - t0)), BASELINE);
  }
  return state;
}

describe('createHeadTracker', () => {
  it('унжаад гэнэт өндийсөн дохилтыг тоолно', () => {
    const head = createHeadTracker();
    // Хэмжилт: −1°-аас +30° хүртэл 0.75 сек, буцаж 0.4 сек
    expect(motion(head, [[0, 3], [1_000, 3], [1_750, 33], [2_150, 3], [3_000, 3]]).quickNods).toBe(1);
  });

  it('утас руу удаан доош харахыг дохилт гэж тоолохгүй', () => {
    const head = createHeadTracker();
    const state = motion(head, [[0, 3], [800, 28], [6_000, 28], [7_500, 3], [8_000, 3]]);
    expect(state.quickNods).toBe(0);
  });

  it('удаан унжсан үед droopMs өснө', () => {
    const head = createHeadTracker();
    const state = motion(head, [[0, 3], [500, 33], [2_500, 33]]);
    expect(state.droopMs).toBeGreaterThan(1_700);
    expect(state.downDeg).toBeCloseTo(30, 0);
  });

  it('дээш харах, суурийн ойролцоо хазайлт дохилт биш', () => {
    const head = createHeadTracker();
    const state = motion(head, [[0, 3], [700, -25], [1_200, 3], [2_000, 14], [2_400, 3], [3_000, 3]]);
    expect(state).toEqual({ downDeg: 0, droopMs: 0, quickNods: 0 });
  });
});
