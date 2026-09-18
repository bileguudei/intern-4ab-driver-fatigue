import { describe, expect, it } from 'bun:test';

import type { ComputerVisionObservation } from '@/features/computer-vision';

import { createYawnTracker, type YawnState } from '../yawn';

function frame(t: number, jawOpen: number | null, faceDetected = true): ComputerVisionObservation {
  return {
    timestampMs: t, faceDetected, faceConfidence: null,
    leftEar: 0.26, rightEar: 0.26, averageEar: 0.26, leftBlink: 0.1, rightBlink: 0.1, jawOpen,
    headPose: { pitch: 0, yaw: 0, roll: 0 }, brightness: 0.5, inferenceTimeMs: 10, landmarkCount: 478,
  };
}

function feed(yawn: ReturnType<typeof createYawnTracker>, from: number, to: number, jaw: number | null, face = true): YawnState {
  let state: YawnState = { open: false, openMs: 0, yawns: 0 };
  for (let t = from; t < to; t += 66) state = yawn.update(frame(t, jaw, face));
  return state;
}

describe('createYawnTracker', () => {
  it('2 сек ангайсан амыг нэг эвшээлт гэж тоолно', () => {
    const yawn = createYawnTracker();
    feed(yawn, 0, 3_000, 0.05);
    expect(feed(yawn, 3_000, 5_000, 0.8).yawns).toBe(1);
    expect(feed(yawn, 5_000, 6_000, 0.05).yawns).toBe(1);
  });

  it('ярих үеийн богино ангайлтыг тоолохгүй', () => {
    const yawn = createYawnTracker();
    let state = feed(yawn, 0, 500, 0.05);
    for (let i = 0; i < 6; i++) {
      const start = 500 + i * 1_000;
      feed(yawn, start, start + 600, 0.7);
      state = feed(yawn, start + 600, start + 1_000, 0.05);
    }
    expect(state.yawns).toBe(0);
  });

  it('нэг эвшээлтийг үргэлжлэх хугацаагаар нь давхар тоолохгүй', () => {
    const yawn = createYawnTracker();
    expect(feed(yawn, 0, 6_000, 0.8).yawns).toBe(1);
  });

  it('5 минутаас өмнөх эвшээлтийг хаяна', () => {
    const yawn = createYawnTracker();
    feed(yawn, 0, 2_000, 0.8);
    feed(yawn, 2_000, 2_500, 0.05);
    expect(feed(yawn, 302_000, 302_500, 0.05).yawns).toBe(0);
  });

  it('нүүр алдагдсан, өгөгдөлгүй фрэймд ангайлт үргэлжлэхгүй', () => {
    const yawn = createYawnTracker();
    feed(yawn, 0, 1_000, 0.8);
    expect(feed(yawn, 1_000, 2_500, 0.8, false).yawns).toBe(0);
    expect(feed(yawn, 2_500, 4_000, null).yawns).toBe(0);
  });
});
