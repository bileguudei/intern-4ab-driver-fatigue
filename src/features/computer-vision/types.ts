export type NormalizedLandmark = Readonly<{
  x: number;
  y: number;
  z?: number;
}>;

export type EyeLandmarkIndices = readonly [number, number, number, number, number, number];

export type HeadPose = Readonly<{
  pitch: number;
  yaw: number;
  roll: number;
}>;

export type ComputerVisionObservation = Readonly<{
  timestampMs: number;
  faceDetected: boolean;
  faceConfidence: number | null;
  leftEar: number | null;
  rightEar: number | null;
  averageEar: number | null;
  headPose: HeadPose | null;
  brightness: number | null;
  inferenceTimeMs: number;
  landmarkCount: number;
}>;

export type FaceLandmarkerFrameResult = Readonly<{
  timestampMs: number;
  faceConfidence: number | null;
  landmarks: readonly NormalizedLandmark[] | null;
  facialTransformationMatrix: readonly number[] | null;
  brightness: number | null;
  inferenceTimeMs: number;
}>;

export interface FaceLandmarkerAdapter<TFrame> {
  initialize(): Promise<void>;
  processFrame(frame: TFrame, timestampMs: number): Promise<FaceLandmarkerFrameResult>;
  dispose(): Promise<void>;
}
