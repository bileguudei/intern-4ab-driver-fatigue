import { describe, expect, it } from 'bun:test';

import { createComputerVisionObservation } from '../create-observation';
import type { NormalizedLandmark } from '../types';

function createLandmarkFixture(): NormalizedLandmark[] {
  const landmarks: NormalizedLandmark[] = Array.from(
    { length: 478 },
    () => ({ x: 0, y: 0, z: 0 }),
  );

  const values: Record<number, NormalizedLandmark> = {
    33: { x: 0, y: 0 },
    160: { x: 1, y: -1 },
    158: { x: 3, y: -1 },
    133: { x: 4, y: 0 },
    153: { x: 3, y: 1 },
    144: { x: 1, y: 1 },
    362: { x: 10, y: 0 },
    385: { x: 11, y: -1 },
    387: { x: 13, y: -1 },
    263: { x: 14, y: 0 },
    373: { x: 13, y: 1 },
    380: { x: 11, y: 1 },
  };

  for (const [index, value] of Object.entries(values)) {
    landmarks[Number(index)] = value;
  }

  return landmarks;
}

describe('createComputerVisionObservation', () => {
  it('normalizes a MediaPipe result into the shared CV contract', () => {
    const result = createComputerVisionObservation({
      timestampMs: 1_000,
      faceConfidence: 0.91,
      landmarks: createLandmarkFixture(),
      facialTransformationMatrix: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ],
      blendshapes: { eyeBlinkLeft: 0.12, eyeBlinkRight: 1.4, jawOpen: 0.05 },
      brightness: 0.7,
      inferenceTimeMs: 12,
    });

    expect(result).toEqual({
      timestampMs: 1_000,
      faceDetected: true,
      faceConfidence: 0.91,
      leftEar: 0.5,
      rightEar: 0.5,
      averageEar: 0.5,
      leftBlink: 0.12,
      rightBlink: 1,
      jawOpen: 0.05,
      headPose: { pitch: 0, yaw: 0, roll: 0 },
      brightness: 0.7,
      inferenceTimeMs: 12,
      landmarkCount: 478,
    });
  });

  it('returns safe nullable metrics when no face is detected', () => {
    expect(
      createComputerVisionObservation({
        timestampMs: 2_000,
        faceConfidence: null,
        landmarks: null,
        facialTransformationMatrix: null,
        blendshapes: { eyeBlinkLeft: 0.9 },
        brightness: 0.08,
        inferenceTimeMs: 8,
      }),
    ).toEqual({
      timestampMs: 2_000,
      faceDetected: false,
      faceConfidence: null,
      leftEar: null,
      rightEar: null,
      averageEar: null,
      leftBlink: null,
      rightBlink: null,
      jawOpen: null,
      headPose: null,
      brightness: 0.08,
      inferenceTimeMs: 8,
      landmarkCount: 0,
    });
  });
});
