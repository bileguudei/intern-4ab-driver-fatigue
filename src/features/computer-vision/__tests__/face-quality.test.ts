import { describe, expect, it } from 'bun:test';
import type { ComputerVisionObservation } from '../types';
import { evaluateFaceQuality } from '../face-quality';

const valid: ComputerVisionObservation = {
  timestampMs: 1_000,
  faceDetected: true,
  faceConfidence: null,
  faceBounds: { x: 0.32, y: 0.24, width: 0.36, height: 0.45, centerX: 0.5, centerY: 0.465 },
  leftEar: 0.3,
  rightEar: 0.3,
  averageEar: 0.3,
  leftBlink: 0.1,
  rightBlink: 0.1,
  jawOpen: 0,
  headPose: { pitch: 2, yaw: 1, roll: 0 },
  brightness: 0.5,
  inferenceTimeMs: 10,
  landmarkCount: 478,
};

describe('evaluateFaceQuality', () => {
  it('төвд, зөв хэмжээтэй, эгц нүүрийг зөвшөөрнө', () => {
    expect(evaluateFaceQuality(valid)).toEqual({ ready: true, issue: null });
  });

  it('хүрээнээс гарсан нүүрийг зөвшөөрөхгүй', () => {
    expect(evaluateFaceQuality({ ...valid, faceBounds: { ...valid.faceBounds!, centerX: 0.8 } }).issue).toBe('off-center');
  });

  it('өөр тийш харсан нүүрийг зөвшөөрөхгүй', () => {
    expect(evaluateFaceQuality({ ...valid, headPose: { pitch: 2, yaw: 30, roll: 0 } }).issue).toBe('turned');
  });

  it('нүүр алга бол зөвшөөрөхгүй', () => {
    expect(evaluateFaceQuality({ ...valid, faceDetected: false, faceBounds: null }).issue).toBe('no-face');
  });

  it('нүд анисан үед calibration-д зөвшөөрөхгүй', () => {
    expect(evaluateFaceQuality({ ...valid, leftBlink: 0.8, rightBlink: 0.8, averageEar: 0.06 }).issue).toBe('eyes-closed');
  });
});
