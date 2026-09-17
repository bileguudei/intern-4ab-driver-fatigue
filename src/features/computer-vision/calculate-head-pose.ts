import type { HeadPose } from './types';

const MATRIX_ELEMENT_COUNT = 16;
const RADIANS_TO_DEGREES = 180 / Math.PI;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function toDegrees(radians: number): number {
  const degrees = radians * RADIANS_TO_DEGREES;
  return Math.abs(degrees) < 1e-10 ? 0 : degrees;
}

export function calculateHeadPose(matrix: readonly number[]): HeadPose | null {
  if (matrix.length !== MATRIX_ELEMENT_COUNT || matrix.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const r00 = matrix[0];
  const r10 = matrix[1];
  const r20 = matrix[2];
  const r21 = matrix[6];
  const r22 = matrix[10];

  const yawRadians = Math.asin(clamp(-r20, -1, 1));
  const pitchRadians = Math.atan2(r21, r22);
  const rollRadians = Math.atan2(r10, r00);

  return {
    pitch: toDegrees(pitchRadians),
    yaw: toDegrees(yawRadians),
    roll: toDegrees(rollRadians),
  };
}
