import { describe, expect, it } from 'bun:test';

import type { ComputerVisionObservation } from '@/features/computer-vision';

import type { Baseline } from '../calibration';
import { createHeadTracker, type HeadState } from '../head';

const BASELINE: Baseline = { blinkOpen: 0.2, blinkClosed: 0.55, earOpen: 0.26, earClosed: 0.1, headPitch: 8.6, headYaw: 0 };

function frame(t: number, pitch: number): ComputerVisionObservation {
  return {
    timestampMs: t, faceDetected: true, faceConfidence: null,
    leftEar: 0.26, rightEar: 0.26, averageEar: 0.26, leftBlink: 0.2, rightBlink: 0.2, jawOpen: 0,
    headPose: { pitch, yaw: 0, roll: 0 }, brightness: 0.5, inferenceTimeMs: 10, landmarkCount: 478,
  };
}

/** 1.2 сек-т толгой 40° эргэж буцах зуураа pitch 12° доошилно — толь харах хөдөлгөөн. */
function mirrorGlance(head: ReturnType<typeof createHeadTracker>, start: number, side: 1 | -1): HeadState {
  let state = head.update(frame(start, BASELINE.headPitch), BASELINE);
  for (let t = start; t <= start + 1_200; t += 66) {
    const s = Math.sin((Math.PI * (t - start)) / 1_200);
    state = head.update({ ...frame(t, BASELINE.headPitch + 12 * s), headPose: { pitch: BASELINE.headPitch + 12 * s, yaw: side * 40 * s, roll: 0 } }, BASELINE);
  }
  return state;
}

function missingFrame(t: number): ComputerVisionObservation {
  return {
    ...frame(t, BASELINE.headPitch),
    faceDetected: false,
    faceBounds: null,
    headPose: null,
  };
}

/** Толгойн өнцгийн хэлбэрийг [мс, градус] цэгүүдээр өгч, 15 фр/сек-т шугаман завсарлана. */
function motion(head: ReturnType<typeof createHeadTracker>, points: [number, number][]): HeadState {
  let state: HeadState = { downDeg: 0, forwardLean: 0, droopMs: 0, quickNods: 0, turnedAway: false };
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
    expect(motion(head, [[0, 8.6], [1_000, 8.6], [1_750, 38], [2_150, 8.6], [3_000, 8.6]]).quickNods).toBe(1);
  });

  it('утас руу удаан доош харахыг дохилт гэж тоолохгүй', () => {
    const head = createHeadTracker();
    const state = motion(head, [[0, 8.6], [800, 33], [6_000, 33], [7_500, 8.6], [8_000, 8.6]]);
    expect(state.quickNods).toBe(0);
  });

  it('удаан унжсан үед droopMs өснө', () => {
    const head = createHeadTracker();
    const state = motion(head, [[0, 8.6], [500, 38.6], [2_500, 38.6]]);
    expect(state.droopMs).toBeGreaterThan(1_700);
    expect(state.downDeg).toBeCloseTo(30, 0);
  });

  it('ганц буруу pose frame удаан унжилтыг таслахгүй', () => {
    const head = createHeadTracker();
    let state = head.update(frame(0, BASELINE.headPitch), BASELINE);
    for (let t = 100; t <= 2_000; t += 100) {
      const pitch = t === 1_000 ? BASELINE.headPitch : BASELINE.headPitch + 22;
      state = head.update(frame(t, pitch), BASELINE);
    }

    expect(state.downDeg).toBeGreaterThan(15);
    expect(state.droopMs).toBeGreaterThanOrEqual(1_800);
  });

  it('нүүр нэг frame түр алдагдахад удаан унжилтыг үргэлжлүүлнэ', () => {
    const head = createHeadTracker();
    let state = head.update(frame(0, BASELINE.headPitch), BASELINE);
    for (let t = 100; t <= 2_000; t += 100) {
      state = head.update(t === 1_000 ? missingFrame(t) : frame(t, BASELINE.headPitch + 22), BASELINE);
    }

    expect(state.downDeg).toBeGreaterThan(15);
    expect(state.droopMs).toBeGreaterThanOrEqual(1_800);
  });

  it('нүүр удаан алдагдвал хуучин унжилтыг үргэлжлүүлэхгүй', () => {
    const head = createHeadTracker();
    head.update(frame(0, BASELINE.headPitch), BASELINE);
    for (let t = 100; t <= 900; t += 100) head.update(frame(t, BASELINE.headPitch + 22), BASELINE);
    head.update(missingFrame(1_000), BASELINE);
    const state = head.update(missingFrame(1_800), BASELINE);

    expect(state.downDeg).toBe(0);
    expect(state.droopMs).toBe(0);
  });

  it('дээш харах, суурийн ойролцоо хазайлт дохилт биш', () => {
    const head = createHeadTracker();
    // Дээш харах (pitch буурна) ба суурийн ойролцоо бага хазайлт
    const state = motion(head, [[0, 8.6], [700, -20], [1_200, 8.6], [2_000, 15], [2_400, 8.6], [3_000, 8.6]]);
    expect(state.downDeg).toBeCloseTo(0, 5);
    expect(state.droopMs).toBe(0);
    expect(state.quickNods).toBe(0);
  });

  it('толь руу эргэх үеийн pitch-ийн савлагааг дохилт гэж тоолохгүй', () => {
    const head = createHeadTracker();
    mirrorGlance(head, 0, -1);
    const state = mirrorGlance(head, 3_000, 1);
    expect(state.quickNods).toBe(0);
  });

  it('хажуу тийш эргэхэд turnedAway болж, буцахад гистерезисээр л унтарна', () => {
    const head = createHeadTracker();
    const at = (t: number, yaw: number) =>
      head.update({ ...frame(t, BASELINE.headPitch), headPose: { pitch: BASELINE.headPitch, yaw, roll: 0 } }, BASELINE);
    expect(at(0, 18).turnedAway).toBe(false);
    expect(at(66, 25).turnedAway).toBe(true);
    expect(at(132, 18).turnedAway).toBe(true);
    expect(at(198, 10).turnedAway).toBe(false);
  });

  it('толь харсны дараа жинхэнэ дохилтыг тоолсоор байна', () => {
    const head = createHeadTracker();
    mirrorGlance(head, 0, 1);
    const state = motion(head, [[1_300, 8.6], [3_000, 8.6], [3_750, 38], [4_150, 8.6], [5_000, 8.6]]);
    expect(state.quickNods).toBe(1);
  });
});
