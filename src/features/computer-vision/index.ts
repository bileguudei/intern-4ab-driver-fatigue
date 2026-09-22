export { calculateAverageEar, calculateEyeAspectRatio } from './calculate-ear';
export { calculateHeadPose } from './calculate-head-pose';
export {
  ComputerVisionCamera,
  getComputerVisionCameraPermissionStatus,
  isDriverFatigueVisionAvailable,
  requestComputerVisionCameraPermission,
} from './computer-vision-camera';
export type { ComputerVisionCameraProps } from './computer-vision-camera';
export { ComputerVisionDebugScreen } from './computer-vision-debug-screen';
export { toComputerVisionObservation } from './native-result-to-observation';
export {
  LEFT_EYE_EAR_INDICES,
  MEDIAPIPE_FACE_LANDMARK_COUNT,
  RIGHT_EYE_EAR_INDICES,
} from './constants';
export { createComputerVisionObservation } from './create-observation';
export { evaluateFaceQuality, faceQualityMessage } from './face-quality';
export type { FaceQuality, FaceQualityIssue } from './face-quality';
export type {
  ComputerVisionObservation,
  EyeLandmarkIndices,
  FaceBounds,
  FaceLandmarkerAdapter,
  FaceLandmarkerFrameResult,
  HeadPose,
  NormalizedLandmark,
} from './types';

export type {
  CameraPermissionStatus,
  VisionError,
  VisionStatus,
} from '../../../modules/driver-fatigue-vision';
