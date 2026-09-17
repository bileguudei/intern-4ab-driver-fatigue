import type { EyeLandmarkIndices, NormalizedLandmark } from './types';

const MINIMUM_EYE_WIDTH = 1e-8;

function isFiniteLandmark(value: NormalizedLandmark | undefined): value is NormalizedLandmark {
  return value !== undefined && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function distance2D(first: NormalizedLandmark, second: NormalizedLandmark): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

export function calculateEyeAspectRatio(
  landmarks: readonly NormalizedLandmark[],
  indices: EyeLandmarkIndices,
): number | null {
  const [outerIndex, upperOuterIndex, upperInnerIndex, innerIndex, lowerInnerIndex, lowerOuterIndex] =
    indices;

  const outer = landmarks[outerIndex];
  const upperOuter = landmarks[upperOuterIndex];
  const upperInner = landmarks[upperInnerIndex];
  const inner = landmarks[innerIndex];
  const lowerInner = landmarks[lowerInnerIndex];
  const lowerOuter = landmarks[lowerOuterIndex];

  if (
    !isFiniteLandmark(outer) ||
    !isFiniteLandmark(upperOuter) ||
    !isFiniteLandmark(upperInner) ||
    !isFiniteLandmark(inner) ||
    !isFiniteLandmark(lowerInner) ||
    !isFiniteLandmark(lowerOuter)
  ) {
    return null;
  }

  const horizontalDistance = distance2D(outer, inner);
  if (horizontalDistance <= MINIMUM_EYE_WIDTH) {
    return null;
  }

  const verticalDistance =
    distance2D(upperOuter, lowerOuter) + distance2D(upperInner, lowerInner);

  const ear = verticalDistance / (2 * horizontalDistance);
  return Number.isFinite(ear) ? ear : null;
}

export function calculateAverageEar(leftEar: number | null, rightEar: number | null): number | null {
  if (leftEar === null || rightEar === null || !Number.isFinite(leftEar) || !Number.isFinite(rightEar)) {
    return null;
  }

  return (leftEar + rightEar) / 2;
}
