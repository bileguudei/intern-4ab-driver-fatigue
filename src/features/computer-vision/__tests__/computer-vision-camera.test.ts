import { describe, expect, it } from 'bun:test';

import { toComputerVisionObservation } from '../native-result-to-observation';

describe('toComputerVisionObservation', () => {
  it('keeps the native adapter payload behind the stable observation contract', () => {
    const observation = toComputerVisionObservation({
      timestampMs: 123,
      faceConfidence: null,
      landmarks: null,
      facialTransformationMatrix: null,
      brightness: 2,
      inferenceTimeMs: -1,
    });

    expect(observation).toEqual({
      timestampMs: 123,
      faceDetected: false,
      faceConfidence: null,
      leftEar: null,
      rightEar: null,
      averageEar: null,
      headPose: null,
      brightness: 1,
      inferenceTimeMs: 0,
      landmarkCount: 0,
    });
  });
});
