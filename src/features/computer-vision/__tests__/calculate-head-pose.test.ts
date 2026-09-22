import { describe, expect, it } from 'bun:test';

import { calculateHeadPose } from '../calculate-head-pose';

const IDENTITY_MATRIX_4X4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
] as const;

describe('calculateHeadPose', () => {
  it('returns zero rotation for an identity transformation matrix', () => {
    expect(calculateHeadPose(IDENTITY_MATRIX_4X4)).toEqual({
      pitch: 0,
      yaw: 0,
      roll: 0,
    });
  });

  it('normalizes a downward MediaPipe pitch to a positive angle', () => {
    const angle = -Math.PI / 6;
    const matrix = [
      1, 0, 0, 0,
      0, Math.cos(angle), Math.sin(angle), 0,
      0, -Math.sin(angle), Math.cos(angle), 0,
      0, 0, 0, 1,
    ];

    expect(calculateHeadPose(matrix)?.pitch).toBeCloseTo(30);
  });

  it('extracts yaw in degrees from a column-major rotation matrix', () => {
    const angle = Math.PI / 4;
    const matrix = [
      Math.cos(angle), 0, -Math.sin(angle), 0,
      0, 1, 0, 0,
      Math.sin(angle), 0, Math.cos(angle), 0,
      0, 0, 0, 1,
    ];

    expect(calculateHeadPose(matrix)?.yaw).toBeCloseTo(45);
  });

  it('extracts roll in degrees from a column-major rotation matrix', () => {
    const angle = -Math.PI / 3;
    const matrix = [
      Math.cos(angle), Math.sin(angle), 0, 0,
      -Math.sin(angle), Math.cos(angle), 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];

    expect(calculateHeadPose(matrix)?.roll).toBeCloseTo(-60);
  });

  it('returns null for a malformed matrix', () => {
    expect(calculateHeadPose([1, 0, 0])).toBeNull();
    expect(calculateHeadPose([...IDENTITY_MATRIX_4X4.slice(0, 15), Number.NaN])).toBeNull();
  });
});
