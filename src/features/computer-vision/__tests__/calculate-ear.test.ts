import { describe, expect, it } from 'bun:test';

import {
  calculateAverageEar,
  calculateEyeAspectRatio,
} from '../calculate-ear';
import type { NormalizedLandmark } from '../types';

const EYE_INDICES = [0, 1, 2, 3, 4, 5] as const;

function createEyeLandmarks(scale = 1): NormalizedLandmark[] {
  return [
    { x: 0 * scale, y: 0 * scale },
    { x: 1 * scale, y: -1 * scale },
    { x: 3 * scale, y: -1 * scale },
    { x: 4 * scale, y: 0 * scale },
    { x: 3 * scale, y: 1 * scale },
    { x: 1 * scale, y: 1 * scale },
  ];
}

describe('calculateEyeAspectRatio', () => {
  it('calculates EAR from the six eye landmarks', () => {
    expect(calculateEyeAspectRatio(createEyeLandmarks(), EYE_INDICES)).toBeCloseTo(0.5);
  });

  it('is invariant when landmark coordinates are scaled', () => {
    const original = calculateEyeAspectRatio(createEyeLandmarks(), EYE_INDICES);
    const scaled = calculateEyeAspectRatio(createEyeLandmarks(12), EYE_INDICES);

    expect(scaled).toBeCloseTo(original ?? Number.NaN);
  });

  it('returns null when an eye landmark is missing', () => {
    expect(calculateEyeAspectRatio(createEyeLandmarks().slice(0, 5), EYE_INDICES)).toBeNull();
  });

  it('returns null when the horizontal eye width is zero', () => {
    const landmarks = createEyeLandmarks();
    landmarks[3] = { ...landmarks[0] };

    expect(calculateEyeAspectRatio(landmarks, EYE_INDICES)).toBeNull();
  });
});

describe('calculateAverageEar', () => {
  it('averages valid left and right EAR values', () => {
    expect(calculateAverageEar(0.28, 0.32)).toBeCloseTo(0.3);
  });

  it('does not produce a combined EAR when either eye is unavailable', () => {
    expect(calculateAverageEar(0.28, null)).toBeNull();
    expect(calculateAverageEar(null, 0.32)).toBeNull();
  });
});
