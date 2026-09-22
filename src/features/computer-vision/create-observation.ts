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

function calculateFaceBounds(landmarks: FaceLandmarkerFrameResult['landmarks']) {
  if (!landmarks?.length) return null;
  const xs = landmarks.map((point) => point.x).filter(Number.isFinite);
  const ys = landmarks.map((point) => point.y).filter(Number.isFinite);
  if (xs.length === 0 || ys.length === 0) return null;
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return {
    x: clampUnitInterval(minX),
    y: clampUnitInterval(minY),
    width: clampUnitInterval(maxX - minX),
    height: clampUnitInterval(maxY - minY),
    centerX: clampUnitInterval((minX + maxX) / 2),
    centerY: clampUnitInterval((minY + maxY) / 2),
  };
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

  const blendshape = (name: string): number | null => {
    const score = faceDetected ? result.blendshapes?.[name] : undefined;
    return score === undefined || !Number.isFinite(score) ? null : clampUnitInterval(score);
  };

  return {
    timestampMs: result.timestampMs,
    faceDetected,
    faceConfidence:
      result.faceConfidence === null
        ? null
        : clampUnitInterval(result.faceConfidence),
    faceBounds: calculateFaceBounds(landmarks),
    leftEar,
    rightEar,
    averageEar: calculateAverageEar(leftEar, rightEar),
    leftBlink: blendshape("eyeBlinkLeft"),
    rightBlink: blendshape("eyeBlinkRight"),
    jawOpen: blendshape("jawOpen"),
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
