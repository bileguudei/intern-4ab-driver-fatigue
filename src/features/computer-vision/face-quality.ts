import type { ComputerVisionObservation } from './types';

export type FaceQualityIssue = 'no-face' | 'too-far' | 'too-close' | 'off-center' | 'turned' | 'eyes-hidden' | 'eyes-closed' | null;

export type FaceQuality = Readonly<{ ready: boolean; issue: FaceQualityIssue }>;

const MAX_CENTER_OFFSET_X = 0.14;
const MAX_CENTER_OFFSET_Y = 0.16;
const MIN_FACE_HEIGHT = 0.24;
const MAX_FACE_HEIGHT = 0.72;
const MAX_HEAD_ANGLE = 18;
const MAX_OPEN_EYE_BLINK_SCORE = 0.45;
const MIN_OPEN_EYE_EAR = 0.1;

/** Setup болон calibration-д ашиглах байрлал, хэмжилтийн чанарын gate. */
export function evaluateFaceQuality(observation: ComputerVisionObservation | null): FaceQuality {
  if (!observation?.faceDetected || !observation.faceBounds) return { ready: false, issue: 'no-face' };
  if (observation.faceBounds.height < MIN_FACE_HEIGHT) return { ready: false, issue: 'too-far' };
  if (observation.faceBounds.height > MAX_FACE_HEIGHT) return { ready: false, issue: 'too-close' };
  if (Math.abs(observation.faceBounds.centerX - 0.5) > MAX_CENTER_OFFSET_X || Math.abs(observation.faceBounds.centerY - 0.48) > MAX_CENTER_OFFSET_Y) {
    return { ready: false, issue: 'off-center' };
  }
  if (!observation.headPose || Math.abs(observation.headPose.yaw) > MAX_HEAD_ANGLE || Math.abs(observation.headPose.pitch) > MAX_HEAD_ANGLE || Math.abs(observation.headPose.roll) > MAX_HEAD_ANGLE) {
    return { ready: false, issue: 'turned' };
  }
  if (observation.averageEar === null || observation.leftBlink === null || observation.rightBlink === null) return { ready: false, issue: 'eyes-hidden' };
  if (observation.leftBlink > MAX_OPEN_EYE_BLINK_SCORE || observation.rightBlink > MAX_OPEN_EYE_BLINK_SCORE || observation.averageEar < MIN_OPEN_EYE_EAR) {
    return { ready: false, issue: 'eyes-closed' };
  }
  return { ready: true, issue: null };
}

export const faceQualityMessage: Record<Exclude<FaceQualityIssue, null>, string> = {
  'no-face': 'Нүүр илэрсэнгүй',
  'too-far': 'Камерт арай ойртоно уу',
  'too-close': 'Камераас бага зэрэг холдоно уу',
  'off-center': 'Нүүрээ хүрээний голд байрлуулна уу',
  turned: 'Толгойгоо эгцлэн камер руу харна уу',
  'eyes-hidden': 'Хоёр нүд бүрэн харагдах ёстой',
  'eyes-closed': 'Нүдээ нээлттэй байлгана уу',
};
