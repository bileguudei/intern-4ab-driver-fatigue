import { calculateAverageEar, calculateEyeAspectRatio } from "./calculate-ear";
import { calculateHeadPose } from "./calculate-head-pose";
import { LEFT_EYE_EAR_INDICES, RIGHT_EYE_EAR_INDICES } from "./constants";
import type {
  ComputerVisionObservation,
  FaceLandmarkerFrameResult,
} from "./types";

function clampUnitInterval(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

export function createComputerVisionObservation(
  result: FaceLandmarkerFrameResult,
): ComputerVisionObservation {
  const landmarks = result.landmarks;
  const faceDetected = landmarks !== null && landmarks.length > 0;

  const leftEar = faceDetected
    ? calculateEyeAspectRatio(landmarks, LEFT_EYE_EAR_INDICES)
    : null;
  const rightEar = faceDetected
    ? calculateEyeAspectRatio(landmarks, RIGHT_EYE_EAR_INDICES)
    : null;

  return {
    timestampMs: result.timestampMs,
    faceDetected,
    faceConfidence:
      result.faceConfidence === null
        ? null
        : clampUnitInterval(result.faceConfidence),
    leftEar,
    rightEar,
    averageEar: calculateAverageEar(leftEar, rightEar),
    headPose:
      faceDetected && result.facialTransformationMatrix !== null
        ? calculateHeadPose(result.facialTransformationMatrix)
        : null,
    brightness:
      result.brightness === null ? null : clampUnitInterval(result.brightness),
    inferenceTimeMs: Math.max(0, result.inferenceTimeMs),
    landmarkCount: landmarks?.length ?? 0,
  };
}
